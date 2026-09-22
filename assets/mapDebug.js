// mapDebug.js — wall-tagging debug tool.
//
// Purpose: let a human walk (freely — collision is bypassed while this is
// active) across every tile of a biome map and mark which ones are supposed
// to be walls but currently aren't blocking the player (or vice versa), so
// those exact tiles can be listed, copied, and sent back for correction.
//
// This is a standalone, self-contained tool — it draws its own overlay on
// top of the game canvas and its own UI box below it, and only takes effect
// once explicitly turned on. It intentionally does not touch renderer.js,
// GardenMap.js, or any biome file: everything it needs (getGridW/getGridH/
// getTileSize/worldToTile/isOpenTile/getActiveBiome) already exists on
// map.js's router.
//
// Controls:
//   H — turns the tool on/off (grid overlay, noclip, debug box).
//   G — while on, logs the tile the player is currently standing on.
//   The "Copy" button in the debug box copies the full list as plain text.
//
// Turn on/off from the browser console too if needed: window.__mapDebugOn = true/false
// (also flips window.__mapDebugNoclip, which player.js already checks).

import { player } from './player.js';
import { camera, zoomState } from './camera.js';
import { getActiveBiome, getGridW, getGridH, getTileSize, worldToTile, isOpenTile } from './map.js';

let enabled = false;
const loggedTiles = new Set(); // "gx,gy" — de-duplicated, insertion order preserved for display

// ── UI: debug box under the map, with a live list + copy button ─────────────
let boxEl = null, listEl = null, copyBtnEl = null, countEl = null;

function buildBox() {
  if (boxEl) return;

  // Matches the minimap's own box exactly (renderer.js: MINIMAP_SIZE=160,
  // MINIMAP_MARGIN=14, drawn with a 3px frame), so this sits flush underneath
  // it at the same width instead of floating separately across the screen.
  const MINIMAP_SIZE = 160, MINIMAP_MARGIN = 14, MINIMAP_FRAME = 3;
  const topOffset = MINIMAP_MARGIN + MINIMAP_SIZE + MINIMAP_FRAME * 2 + 8; // 8px gap below it

  const style = document.createElement('style');
  style.textContent = `
    #map-debug-box {
      position: fixed;
      right: ${MINIMAP_MARGIN}px;
      top: ${topOffset}px;
      width: ${MINIMAP_SIZE}px;
      max-height: 110px;
      background: rgba(10,10,10,0.92);
      border: 1.5px solid rgba(255,255,255,0.25);
      border-radius: 8px;
      padding: 6px 7px;
      font-family: 'UbuntuCustom','Ubuntu',Arial,sans-serif;
      color: #fff;
      z-index: 99999;
      display: none;
    }
    #map-debug-box.on { display: flex; flex-direction: column; gap: 4px; }
    #map-debug-box .md-header {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 9px; color: rgba(255,255,255,0.6);
      line-height: 1.3;
    }
    #map-debug-box .md-list {
      flex: 1;
      overflow-y: auto;
      background: rgba(255,255,255,0.06);
      border-radius: 5px;
      padding: 4px 5px;
      font-family: monospace;
      font-size: 9px;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 46px;
    }
    #map-debug-box .md-btns { display: flex; gap: 5px; }
    #map-debug-box button {
      flex: 1;
      padding: 3px 0;
      border-radius: 5px;
      border: 1.5px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.10);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      cursor: pointer;
    }
    #map-debug-box button:hover { background: rgba(255,255,255,0.2); }
    #map-debug-box button:active { transform: scale(0.97); }
    #map-debug-box .md-copied { color: #7CFC9A; }
  `;
  document.head.appendChild(style);

  boxEl = document.createElement('div');
  boxEl.id = 'map-debug-box';
  boxEl.innerHTML = `
    <div class="md-header">
      <span>G tag · R untag</span>
      <span id="map-debug-count">0</span>
    </div>
    <div class="md-list" id="map-debug-list"></div>
    <div class="md-btns">
      <button id="map-debug-copy">Copy</button>
      <button id="map-debug-clear">Clear</button>
    </div>
  `;
  document.body.appendChild(boxEl);

  listEl = boxEl.querySelector('#map-debug-list');
  countEl = boxEl.querySelector('#map-debug-count');
  copyBtnEl = boxEl.querySelector('#map-debug-copy');
  const clearBtnEl = boxEl.querySelector('#map-debug-clear');

  copyBtnEl.addEventListener('click', () => {
    const text = buildOutputText();
    navigator.clipboard.writeText(text).then(() => {
      copyBtnEl.textContent = 'Copied!';
      copyBtnEl.classList.add('md-copied');
      setTimeout(() => {
        copyBtnEl.textContent = 'Copy';
        copyBtnEl.classList.remove('md-copied');
      }, 1200);
    }).catch(() => {
      // Clipboard API can fail (insecure context, permissions) — fall back
      // to a manual-select prompt so the data isn't lost.
      window.prompt('Copy this text:', text);
    });
  });

  clearBtnEl.addEventListener('click', () => {
    loggedTiles.clear();
    refreshList();
  });
}

function buildOutputText() {
  const biome = getActiveBiome();
  const header = `biome=${biome} tileSize=${getTileSize()} grid=${getGridW()}x${getGridH()}`;
  const tiles = [...loggedTiles].map(k => {
    const [gx, gy] = k.split(',');
    return `(${gx},${gy})`;
  }).join(', ');
  return `${header}\n${tiles}`;
}

function refreshList() {
  if (!listEl) return;
  listEl.textContent = [...loggedTiles].map(k => {
    const [gx, gy] = k.split(',');
    return `(${gx},${gy})`;
  }).join(', ');
  countEl.textContent = `${loggedTiles.size}`;
}

// ── Keybinds ───────────────────────────────────────────────────────────────
// H — toggles the whole tool on/off (grid overlay, noclip, debug box).
// G — while on, tags the tile the player is standing on (walls only; an open
//     floor tile can't be tagged, since the point is flagging bad wall data).
// R — untags the tile the player is currently standing on.
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // don't fire while typing

  if (e.key === 'h' || e.key === 'H') {
    setMapDebugEnabled(!enabled);
    return;
  }

  if (!enabled) return;

  if (e.key === 'g' || e.key === 'G') {
    const { gx, gy } = worldToTile(player.x, player.y);
    if (isOpenTile(gx, gy)) return; // open floor — nothing to flag, ignore
    loggedTiles.add(`${gx},${gy}`); // Set — re-tagging the same tile is a no-op
    refreshList();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    const { gx, gy } = worldToTile(player.x, player.y);
    loggedTiles.delete(`${gx},${gy}`);
    refreshList();
    return;
  }
});

// ── Grid overlay — black box border drawn around every tile on screen ───────
// Called from main.js's render pass, after the normal game render, so it
// draws on top without touching renderer.js itself.
export function drawDebugGridOverlay(ctx, canvasW, canvasH) {
  if (!enabled) return;

  const tileSize = getTileSize();
  const zoom = zoomState.v;
  const hw = canvasW / 2, hh = canvasH / 2;
  const wx2sx = wx => (wx - camera.x) * zoom + hw;
  const wy2sy = wy => (wy - camera.y) * zoom + hh;

  const gridW = getGridW(), gridH = getGridH();
  const worldLeft   = camera.x - hw / zoom;
  const worldRight  = camera.x + hw / zoom;
  const worldTop    = camera.y - hh / zoom;
  const worldBottom = camera.y + hh / zoom;

  const gx0 = Math.max(0, Math.floor(worldLeft / tileSize) - 1);
  const gx1 = Math.min(gridW - 1, Math.ceil(worldRight / tileSize) + 1);
  const gy0 = Math.max(0, Math.floor(worldTop / tileSize) - 1);
  const gy1 = Math.min(gridH - 1, Math.ceil(worldBottom / tileSize) + 1);

  const tileScreenSize = tileSize * zoom;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const sx = wx2sx(gx * tileSize);
      const sy = wy2sy(gy * tileSize);
      ctx.strokeRect(sx, sy, tileScreenSize, tileScreenSize);
    }
  }

  // Highlight tagged tiles so it's obvious which ones you've already logged
  ctx.fillStyle = 'rgba(255,60,60,0.35)';
  for (const key of loggedTiles) {
    const [gx, gy] = key.split(',').map(Number);
    if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) continue;
    const sx = wx2sx(gx * tileSize);
    const sy = wy2sy(gy * tileSize);
    ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
  }

  // Current-tile highlight
  const cur = worldToTile(player.x, player.y);
  const csx = wx2sx(cur.gx * tileSize);
  const csy = wy2sy(cur.gy * tileSize);
  ctx.strokeStyle = 'rgba(255,255,0,0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(csx, csy, tileScreenSize, tileScreenSize);

  ctx.restore();
}

// ── On/off switch ────────────────────────────────────────────────────────────
export function setMapDebugEnabled(on) {
  enabled = !!on;
  window.__mapDebugNoclip = enabled; // player.js checks this to bypass canMoveTo
  buildBox();
  boxEl.classList.toggle('on', enabled);
  if (enabled) refreshList();
}

export function isMapDebugEnabled() { return enabled; }

// Console-friendly toggle: window.__mapDebugOn = true/false also works,
// without re-entering setMapDebugEnabled (the setter below updates `enabled`
// directly — setMapDebugEnabled updates `enabled` too, they just both read
// from the same variable rather than one calling the other).
Object.defineProperty(window, '__mapDebugOn', {
  get() { return enabled; },
  set(v) { setMapDebugEnabled(v); },
  configurable: true,
});
