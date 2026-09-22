import './input.js';                                  // side-effect: registers all listeners

import { player, updatePlayer, respawnPlayer }  from './player.js';
import { updatePetals, hotbar, rebuildPetals, refreshAllPetals } from './petals.js';
import { setActiveBiome } from './map.js';
import { initCamera, updateCamera,
         camera, petalOrigin,
         zoomState, setZoom, getZoom,
         setMinZoom, DEFAULT_MIN_ZOOM, snapCamera }  from './camera.js';
import { render, triggerPetalDeathPops, clearPetalDeathPops, setPlayerWasDead } from './renderer.js';
import { drawDebugGridOverlay } from './mapDebug.js';
import { levelHUD } from './LevelHUD.js';
import { initMobs, updateMobs, mobs } from './mobs.js';
import { updateCombat }   from './combat.js';
import { updateDrops, checkPickups } from './drops.js';
import { updateDamagePopups } from './damagePopups.js';
import { addToInventory, clearInventory }                from './inventory.js';
import { initUI, notifyInventoryChanged,
         updateHotbar, updateInventory,
         updateSettingsCog }             from './uiManager.js';
import { setHomescreenMode, hotbarSlideOffset } from './HotbarUI.js';
import { runIrisTransition }             from './homescreen.js';
import { initTooltip }                   from './mobTooltip.js';
import { drawPetalTooltip } from './petalTooltip.js';
import { PETAL_TYPES, SCALABLE_PETAL_IDS } from './petalTypes.js';
import { settings }                      from './settings.js';
import { linkSettings }                  from './inputState.js';
linkSettings(settings);
import { benchBar }                      from './petals.js';
import { clearMobGallery } from './MobGalleryUI.js';

// ── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

// Track CSS-pixel dimensions separately — render logic works in CSS pixels
let canvasW = window.innerWidth;
let canvasH = window.innerHeight;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvasW   = window.innerWidth;
  canvasH   = window.innerHeight;

  canvas.width        = Math.round(canvasW * dpr);
  canvas.height       = Math.round(canvasH * dpr);
  canvas.style.width  = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

// ── Scroll wheel zoom ─────────────────────────────────────────────────────────
window.addEventListener('wheel', e => {
  // Don't hijack scroll events that originate inside a UI panel
  const UI_PANEL_IDS = ['inv-panel', 'crafting-panel', 'mobgal-panel', 'settings-panel', 'updatelog-panel'];
  if (UI_PANEL_IDS.some(id => document.getElementById(id)?.contains(e.target))) return;

  e.preventDefault();
  let factor;
  if (e.ctrlKey) {
    // Pinch-to-zoom on trackpad: deltaY is small, use proportionally
    factor = Math.pow(0.99, e.deltaY);
  } else if (e.deltaMode === 0) {
    // Mouse wheel: deltaMode 0 (pixels) with large deltaY — use fixed step
    factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  } else {
    // Trackpad two-finger scroll (line/page mode): scale gently
    factor = Math.pow(0.99, e.deltaY / 4);
  }
  setZoom(getZoom() * factor);
}, { passive: false });

// ── Early UI init — runs before play so panels exist on homescreen ────────────
initUI();
initTooltip(canvas);

// ── Death overlay ─────────────────────────────────────────────────────────────
let _deathOverlayVisible = false;

function showDeathOverlay() {
  if (_deathOverlayVisible) return;
  _deathOverlayVisible = true;
  const el = document.getElementById('death-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Force reflow then animate in
  el.getBoundingClientRect();
  el.style.transform = 'translateY(0)';
  el.style.opacity   = '1';
}

function hideDeathOverlay(onDone) {
  if (!_deathOverlayVisible) { if (onDone) onDone(); return; }
  _deathOverlayVisible = false;
  const el = document.getElementById('death-overlay');
  if (!el) { if (onDone) onDone(); return; }
  el.style.transform = 'translateY(-110%)';
  el.style.opacity   = '0';
  setTimeout(() => {
    el.style.display = 'none';
    if (onDone) onDone();
  }, 420);
}

// Wire death overlay buttons directly (modules execute after DOM parse)
{
  const continueBtn = document.getElementById('death-continue');
  const closeBtn    = document.getElementById('death-close');

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      hideDeathOverlay(() => {
        // Iris closes → show homescreen at midpoint → iris opens
        runIrisTransition(
          () => {
            // Midpoint: screen is black — swap content
            respawnPlayer();
            clearPetalDeathPops();
            setPlayerWasDead(false);
            _playerWasDeadLocal = false;
            stopGameLoop();
            const homeEl = document.getElementById('home-screen');
            if (homeEl) homeEl.style.display = 'flex';
            startHomescreenHotbar();
            // Refresh level pill with current XP
            if (typeof window._refreshHomePill === 'function') window._refreshHomePill();
            // Re-attach flower mouse listeners
            if (typeof window._reattachFlowerListeners === 'function') {
              window._reattachFlowerListeners();
            }
          },
          null
        );
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideDeathOverlay(null);
    });
  }
}

// ── Homescreen hotbar canvas loop (exported for homescreen.js) ────────────────
let _homebar_raf = null;

// Expose current virtualH so ui.js can use correct H for hit-testing on homescreen
let _homescreenVirtualH = 0;
export function getHomescreenVirtualH() { return _homescreenVirtualH; }

export function startHomescreenHotbar() {
  setHomescreenMode(true);

  // Seed inventory at homescreen so player can set up hotbar before choosing a mode
  clearInventory();
  clearMobGallery();
  addToInventory('magnet_impracticality');
  addToInventory('ant_egg_umbral');
  addToInventory('cutter_umbral');
  addToInventory('stinger_super');
  notifyInventoryChanged();

  let lastFrameTime = performance.now();
  function frame(now) {
    const dt = Math.min(now - lastFrameTime, 100);
    lastFrameTime = now;
    canvasW = window.innerWidth;
    canvasH = window.innerHeight;
    ctx.clearRect(0, 0, canvasW, canvasH);
    const homeContent = document.querySelector('.home-content');
    const rect = homeContent ? homeContent.getBoundingClientRect() : null;
    const hotbarGap = 28;
    const hotbarOffset = 18 + 68 + 10 + 54;
    const desiredTop = rect ? rect.bottom + hotbarGap : canvasH * 0.65;
    const virtualH = desiredTop + hotbarOffset + hotbarSlideOffset;
    _homescreenVirtualH = virtualH;
    updateHotbar(ctx, canvasW, virtualH);
    drawPetalTooltip(ctx, canvasW, canvasH, dt);
    updateInventory();
    updateSettingsCog(now);
    _homebar_raf = requestAnimationFrame(frame);
  }
  _homebar_raf = requestAnimationFrame(frame);
}

function stopHomescreenHotbar() {
  if (_homebar_raf) { cancelAnimationFrame(_homebar_raf); _homebar_raf = null; }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTime = performance.now();
let _lastMinZoom = DEFAULT_MIN_ZOOM;
let _loopRaf = null;
let _loopToken = 0; // bumped on every start/stop — any loop holding an old token exits
let _playerWasDeadLocal = false;

// Only ONE game loop may ever run. Player movement is applied per update call
// (not scaled by dt), so a second loop silently doubles player speed — and
// since stopGameLoop() could only cancel the most recent rAF id, an extra
// loop was never stopped and piled up on every death -> Play cycle.
function stopGameLoop() {
  _loopToken++;
  if (_loopRaf) { cancelAnimationFrame(_loopRaf); _loopRaf = null; }
}

function startGameLoop() {
  stopGameLoop();
  const token = _loopToken;
  const tick = (now) => {
    if (token !== _loopToken) return; // superseded by a newer start/stop
    loop(now);
    if (token === _loopToken) _loopRaf = requestAnimationFrame(tick);
  };
  _loopRaf = requestAnimationFrame(tick);
}

function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;

  // ── Player death → death overlay ──────────────────────────────────────────
  if (player.dead && !_playerWasDeadLocal) {
    _playerWasDeadLocal = true;
    setPlayerWasDead(true);
    player.deathRotation = (Math.random() * 2 - 1) * (15 * Math.PI / 180);
    triggerPetalDeathPops(canvasW, canvasH);
    setTimeout(showDeathOverlay, 350);
  }

  if (!player.dead) updatePlayer(dt);
  updateCamera(player.x, player.y);

  if (!player.dead) {
    updatePetals(dt, petalOrigin.x, petalOrigin.y);
  }
  updateMobs(dt, player.x, player.y);
  if (!player.dead) {
    updateCombat(dt);
  }
  updateDrops(dt);
  updateDamagePopups(dt);

  // ── Antennae vision bonus ────────────────────────────────────────────────
  let totalVisionBonus = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.visionBonus) totalVisionBonus += pt.visionBonus;
  }
  const newMinZoom = DEFAULT_MIN_ZOOM / (1 + totalVisionBonus);
  if (Math.abs(newMinZoom - _lastMinZoom) > 0.0001) {
    const wasAtMin = Math.abs(zoomState.v - _lastMinZoom) < 0.01;
    setMinZoom(newMinZoom);
    if (wasAtMin) setZoom(newMinZoom);
    _lastMinZoom = newMinZoom;
  }

  let pickupMult = 1;
  let flatPickupBonus = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.pickupBonus) pickupMult += pt.pickupBonus;
    if (pt?.flatPickupBonus) flatPickupBonus += pt.flatPickupBonus;
  }

  checkPickups(player.x, player.y, typeId => {
    if (typeId === 'rose') {
      player.hp = Math.min(player.maxHp, player.hp + 22);
      return;
    }
    if (settings.equipDrops) {
      const emptyTop = hotbar.indexOf(null);
      if (emptyTop !== -1) {
        hotbar[emptyTop] = typeId;
        rebuildPetals();
        return;
      }
      const emptyBench = benchBar.indexOf(null);
      if (emptyBench !== -1) {
        benchBar[emptyBench] = typeId;
        return;
      }
    }
    addToInventory(typeId);
    notifyInventoryChanged();
  }, pickupMult, flatPickupBonus);

  render(ctx, canvasW, canvasH, camera.x, camera.y, dt);
  drawDebugGridOverlay(ctx, canvasW, canvasH);
}

// ── startGame — enter play from the homescreen ────────────────────────────────
// `biome` selects which of GardenMap.js/DesertMap.js/OceanMap.js becomes the
// active map (see map.js's router) before the player is placed — respawnPlayer()
// re-queries the map for a safe spawn point every time it's called, so calling
// it here after setActiveBiome() lands the player at that biome's own marked
// spawn point rather than wherever the previous biome (or the default) put them.
async function startGame(biome = 'garden') {
  stopHomescreenHotbar();
  setHomescreenMode(false);
  _playerWasDeadLocal = false;
  setPlayerWasDead(false);

  setActiveBiome(biome);
  respawnPlayer();

  initCamera(player.x, player.y);
  initMobs(player.x, player.y);

  // Inventory was seeded at homescreen — player configured hotbar before entering
  clearMobGallery();

  lastTime = performance.now();
  levelHUD.init(player.xp);
  startGameLoop();
}

window.startGame = startGame;
window._getHomescreenVirtualH = getHomescreenVirtualH;