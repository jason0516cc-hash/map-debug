/**
 * craftingUI.js
 *
 * Crafting panel: pentagon ring, batch crafting, animated spin/explode,
 * rarity × petal grid with horizontal slider.
 *
 * Dependency graph (no circular imports):
 *   craftingUI → hotbarUI, inventoryUI, inventory, petals, petalTypes, constants,
 *                crafting, petalTooltip
 */

import { hotbar, benchBar }                                 from './petals.js';
import { inventoryItems, inventoryOpen, toggleInventory,
         addToInventory, removeFromInventory }               from './inventory.js';
import { PETAL_TYPES }                                       from './petalTypes.js';
import { RARITY_BG, RARITY_BORDER, RARITIES }               from './constants.js';
import { setPetalHover }                                     from './petalTooltip.js';
import { canCraft, getNextTypeId, getChanceLabel,
         performCraftSingle }                                from './crafting.js';
import { drawPetalBox, getDragJustEnded }                   from './HotbarUI.js';
import { registerCraftingWithInv, setInvDirty, setInvAnimate,
         renderInventory }                                   from './InventoryUI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks
// settingsUI calls registerSettingsWithCrafting() after its own setup so that
// the crafting button can close the settings panel without a circular import.
// ─────────────────────────────────────────────────────────────────────────────
let _settings = {
  isSettingsOpen: () => false,
  closeSettings:  () => {},
};
export function registerSettingsWithCrafting(cbs) { Object.assign(_settings, cbs); }

let _mobGal = {
  isMobGalOpen: () => false,
  closeMobGal:  () => {},
};
export function registerMobGalWithCrafting2(cbs) { Object.assign(_mobGal, cbs); }

let _updateLog = {
  isUpdateLogOpen: () => false,
  closeUpdateLog:  () => {},
};
export function registerUpdateLogWithCrafting(cbs) { Object.assign(_updateLog, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// Inject styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectCraftingStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* ── Crafting button ─────────────────────────────────────────────────── */
    #crafting-btn {
      position: fixed; width: 54px; height: 54px; border-radius: 10px;
      background: #da9b5b; border: 3px solid #986c40;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 5px; box-sizing: border-box; user-select: none;
    }
    #crafting-btn:active { transform: scale(0.95); }
    #crafting-btn img { width: 175%; height: 200%; object-fit: contain; display: block; mix-blend-mode: screen; }

    /* ── Crafting panel ──────────────────────────────────────────────────── */
    #crafting-panel {
      position: fixed; width: 420px; display: flex; flex-direction: column;
      background: #da9b5b; border: 3px solid #986c40; border-radius: 14px;
      font-family: 'UbuntuCustom', 'Ubuntu', Arial, sans-serif;
      z-index: 100; user-select: none; opacity: 0; pointer-events: none;
      transform: translateY(calc(100% + 24px)); transform-origin: left bottom;
      transition: opacity 0.22s cubic-bezier(0.22,1,0.36,1), transform 0.22s cubic-bezier(0.22,1,0.36,1);
      overflow: hidden;
    }
    #crafting-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0); }

    /* ── Header ──────────────────────────────────────────────────────────── */
    #crafting-panel .cr-hdr {
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      position: relative; padding: 8px 10px 7px;
      background: #c8874a; border-bottom: 2px solid #986c40;
    }
    #crafting-panel .cr-title {
      color: #fff; font-size: 18px; font-weight: 900; letter-spacing: 1px;
      text-align: center;
      text-shadow: -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000;
    }
    #crafting-panel .cr-close {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: #c1565e; border: 2px solid #90464b; border-radius: 6px;
      color: #ccc; cursor: pointer; font-size: 13px; font-weight: 900;
      width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
      padding: 0; line-height: 1; font-family: inherit; transition: background 0.12s;
    }
    #crafting-panel .cr-close:hover { background: #a03040; }

    /* ── Craft area ──────────────────────────────────────────────────────── */
    #crafting-panel .cr-craft-area {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px 14px;
    }
    #crafting-panel .cr-ring-wrap { flex-shrink: 0; width: 130px; height: 130px; }
    #crafting-panel .cr-ring-wrap svg { width: 130px; height: 130px; }
    #crafting-panel .cr-side {
      flex: 1; display: flex; flex-direction: column; align-items: flex-end;
      gap: 6px; margin-left: auto; padding-right: 4px;
    }
    #crafting-panel .cr-craft-btn {
      width: 80px; padding: 6px 0; background: #888; border: 2px solid #666;
      border-radius: 6px; color: #f0f0f0; font-size: 11px; font-weight: 900;
      font-family: inherit;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      cursor: pointer; transition: background 0.12s;
    }
    #crafting-panel .cr-craft-btn:hover { background: #999; }
    #crafting-panel .cr-hint {
      font-size: 10px; font-weight: 900; color: #f0f0f0;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      text-align: center;
    }

    /* ── Inventory area ──────────────────────────────────────────────────── */
    #crafting-panel .cr-divider { height: 2px; background: #986c40; margin: 8px 10px 0; }
    #crafting-panel .cr-inv-label {
      padding: 6px 12px 2px; font-size: 12px; font-weight: 900; color: #f0f0f0;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
    }

    /* ── Rarity×Petal grid ───────────────────────────────────────────────── */
    #crafting-panel .cr-grid-area { display: flex; flex-direction: column; padding: 0; gap: 2px; }
    #crafting-panel .cr-grid-scroll { height: 240px; overflow-y: auto; overflow-x: hidden; }
    #crafting-panel .cr-grid-scroll::-webkit-scrollbar { width: 5px; }
    #crafting-panel .cr-grid-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.15); }
    #crafting-panel .cr-grid-scroll::-webkit-scrollbar-thumb { background: #986c40; border-radius: 4px; }
    #crafting-panel .cr-slots {
      display: grid; grid-template-columns: repeat(14, var(--cr-slot-w, 46px));
      gap: 5px; padding: 5px 6px 8px 8px;
      will-change: transform;
    }

    /* ── Horizontal rarity slider ────────────────────────────────────────── */
    #crafting-panel .cr-bottom-slider-wrap {
      display: flex; align-items: center; gap: 4px; padding: 2px 8px 6px 8px;
    }
    #crafting-panel .cr-bottom-slider {
      -webkit-appearance: none; appearance: none; flex: 1;
      height: 10px; background: #7a5530; border-radius: 7px;
      outline: none; border: 1px solid #5a3a1a; cursor: pointer;
    }
    #crafting-panel .cr-bottom-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 24px; height: 10px; background: #e8b870;
      border: 2px solid #986c40; border-radius: 5px; cursor: pointer;
    }
    #crafting-panel .cr-bottom-slider::-moz-range-thumb {
      width: 24px; height: 10px; background: #e8b870;
      border: 2px solid #986c40; border-radius: 5px; cursor: pointer;
    }

    /* ── Crafting slot ───────────────────────────────────────────────────── */
    #crafting-panel .cr-slot {
      aspect-ratio: 1; background: #986c40; border-radius: 6px;
      overflow: hidden; position: relative; box-sizing: border-box;
      cursor: default; min-width: 0;
    }
    #crafting-panel .cr-slot.craftable  { cursor: pointer; }
    #crafting-panel .cr-slot.cr-empty   { opacity: 0.35; cursor: default; }
    #crafting-panel .cr-slot canvas     { display: block; width: 100% !important; height: 100% !important; pointer-events: none; }
    #crafting-panel .cr-slot-cnt {
      position: absolute; top: 3px; right: 3px;
      font-size: 8px; font-weight: 900; color: #fff;
      pointer-events: none; line-height: 1; z-index: 5;
      transform: rotate(15deg); transform-origin: top right;
    }

    /* ── Ring helpers ────────────────────────────────────────────────────── */
    #crafting-panel .cr-ring-wrap { position: relative !important; }
    .cr-ring-canvas { position: absolute; border-radius: 7px; display: block; }
    .cr-batch-badge {
      position: absolute; top: 3px; right: 3px;
      font-size: 8px; font-weight: 900; color: #fff;
      pointer-events: none; line-height: 1; z-index: 10;
      transform: rotate(15deg); transform-origin: top right;
    }
    .cr-ring-status-label {
      position: absolute; bottom: 3px; left: 0; right: 0;
      text-align: center; font-size: 9px; font-weight: 900;
      text-shadow: -1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;
      pointer-events: none;
    }
    .cr-success-count-badge {
      position: absolute;
      top: calc(50% - 55px + 5px); right: calc(50% - 55px + 5px);
      font-size: 9px; font-weight: 900; color: #fff;
      pointer-events: none; line-height: 1; z-index: 11;
      transform: rotate(15deg); transform-origin: top right;
    }
    .cr-fail-box { position: absolute; border-radius: 7px; overflow: hidden; cursor: pointer; }
    .cr-fail-box canvas { display: block; }
    .cr-fail-box:hover { filter: brightness(1.25); }
    .cr-lost-info {
      font-size: 9px; font-weight: 900; color: #f0c080;
      text-shadow: -1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;
      text-align: center; min-height: 12px;
    }

    /* ── Toast ───────────────────────────────────────────────────────────── */
    .cr-toast {
      position: absolute; top: 108px; left: 50%; transform: translateX(-50%);
      padding: 4px 12px; border-radius: 8px;
      font-size: 11px; font-weight: 900; color: #fff;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      white-space: nowrap; pointer-events: none;
      opacity: 1; transition: opacity 0.5s; z-index: 10;
    }
    .cr-toast.fade { opacity: 0; }

    /* ── Spin/result animations ──────────────────────────────────────────── */
    @keyframes cr-preview-pop {
      0%   { transform: translate(-50%,-50%) scale(0.1);  opacity: 0; }
      65%  { transform: translate(-50%,-50%) scale(0.9);  opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(0.78); opacity: 1; }
    }
    @keyframes cr-success-pulse {
      0%   { transform: translate(-50%,-50%) rotate(8deg) scale(1);    }
      50%  { transform: translate(-50%,-50%) rotate(8deg) scale(1.18); }
      100% { transform: translate(-50%,-50%) rotate(8deg) scale(1);    }
    }
    .cr-success-pulse { animation: cr-success-pulse 1.1s ease-in-out infinite; }
    #crafting-panel .cr-ring-wrap.cr-spinning { /* JS rAF drives movement */ }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Panel state
// ─────────────────────────────────────────────────────────────────────────────
let craftingPanelOpen = false;
let craftingPanel     = null;

export function isCraftingOpen() { return craftingPanelOpen; }

let craftSel        = null;   // currently selected typeId
let craftAnimState  = null;   // null | 'spinning' | 'result'
let craftAnimResult = null;
let craftAnimTimeout = null;
let craftSlots      = [0, 0, 0, 0, 0];  // per-pentagon-slot petal counts
let craftSpinRaf    = null;
let craftSpinStart  = null;

// ─────────────────────────────────────────────────────────────────────────────
// Grid scroll state
// ─────────────────────────────────────────────────────────────────────────────
const GRID_COLS = 8;
let craftGridRarityOffset = 0;  // target column (integer)
let craftGridScrollX      = 0;  // current animated position (float, in columns)
let craftGridScrollRaf    = null;

// ─────────────────────────────────────────────────────────────────────────────
// Pentagon ring layout constants
// ─────────────────────────────────────────────────────────────────────────────
const CR_RING_SLOTS = [
  { x: 46, y: 4  },
  { x: 4,  y: 44 },
  { x: 14, y: 94 },
  { x: 78, y: 94 },
  { x: 88, y: 44 },
];
const CR_SLOT_SIZE   = 38;
const CR_WRAP_CX     = 65;
const CR_WRAP_CY     = 65;
const CR_SPIN_RADIUS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Positioning
// ─────────────────────────────────────────────────────────────────────────────
export function positionCraftingButton() {
  const btn    = document.getElementById('crafting-btn');
  const invBtn = document.getElementById('inv-toggle-btn');
  if (!btn || !invBtn) return;
  const invRect = invBtn.getBoundingClientRect();
  btn.style.left = invRect.left + 'px';
  btn.style.top  = Math.round(invRect.bottom + 10) + 'px';
}

export function positionCraftingPanel() {
  if (!craftingPanel) return;
  const btn = document.getElementById('crafting-btn');
  if (!btn) return;
  const btnRect  = btn.getBoundingClientRect();
  const panelH   = craftingPanel.offsetHeight;
  const screenH  = window.innerHeight;
  const panelLeft = btnRect.right + 10;
  let panelTop    = btnRect.top;
  if (panelTop + panelH > screenH - 8) panelTop = screenH - 8 - panelH;
  if (panelTop < 8) panelTop = 8;
  craftingPanel.style.left = Math.round(panelLeft) + 'px';
  craftingPanel.style.top  = Math.round(panelTop)  + 'px';
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle / close
// ─────────────────────────────────────────────────────────────────────────────
export function toggleCraftingPanel() {
  if (!craftingPanel) return;
  craftingPanelOpen = !craftingPanelOpen;
  if (craftingPanelOpen) {
    // Close competing panels (mirrors button click handler)
    if (inventoryOpen) toggleInventory();
    if (_settings.isSettingsOpen())   _settings.closeSettings();
    if (_mobGal.isMobGalOpen())       _mobGal.closeMobGal();
    if (_updateLog.isUpdateLogOpen()) _updateLog.closeUpdateLog();
    craftingPanel.classList.add('open');
    positionCraftingPanel();
    requestAnimationFrame(() => renderCraftingPanel());
  } else {
    craftingPanel.classList.remove('open');
  }
}

export function closeCraftingPanel() {
  craftingPanelOpen = false;
  if (craftingPanel) craftingPanel.classList.remove('open');

  // If a craft is actively spinning, let it finish in the background so petals
  // are never lost. The timeout will add results to inventory and render into
  // the hidden panel; the player will see the result next time they open.
  if (craftAnimState === 'spinning') return;

  stopSpinAnimation();
  if (craftAnimTimeout) { clearTimeout(craftAnimTimeout); craftAnimTimeout = null; }
  // Return any committed-but-unspun petals to inventory
  if (craftSel && craftSlots.some(n => n > 0) && craftAnimState !== 'result') {
    const total = craftSlots.reduce((a, b) => a + b, 0);
    for (let i = 0; i < total; i++) addToInventory(craftSel);
    setInvDirty(true);
    craftSlots = [0, 0, 0, 0, 0];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spin animation
// ─────────────────────────────────────────────────────────────────────────────
function startSpinAnimation(wrap, spinSlotCounts) {
  stopSpinAnimation();
  const dpr = window.devicePixelRatio || 1;
  wrap.innerHTML = '';
  wrap.classList.remove('cr-spinning');

  const wrappers = [];
  for (let i = 0; i < 5; i++) {
    const div  = document.createElement('div');
    div.style.cssText = `position:absolute;width:${CR_SLOT_SIZE}px;height:${CR_SLOT_SIZE}px;`;
    const cv   = document.createElement('canvas');
    const phys = Math.round(CR_SLOT_SIZE * dpr);
    cv.width  = phys; cv.height = phys;
    cv.style.cssText = `display:block;width:${CR_SLOT_SIZE}px;height:${CR_SLOT_SIZE}px;border-radius:7px;`;
    const rctx = cv.getContext('2d');
    rctx.scale(dpr, dpr);
    if (craftSel) drawPetalBox(rctx, 0, 0, CR_SLOT_SIZE, craftSel, 0, 0);
    else {
      rctx.fillStyle = '#b17f49';
      rctx.beginPath(); rctx.roundRect(0, 0, CR_SLOT_SIZE, CR_SLOT_SIZE, 7); rctx.fill();
    }
    div.appendChild(cv);

    const slotCount = Array.isArray(spinSlotCounts) ? spinSlotCounts[i] : spinSlotCounts;
    if (slotCount > 1) {
      const badge = document.createElement('div');
      badge.className = 'cr-batch-badge'; badge.textContent = 'x' + slotCount;
      div.appendChild(badge);
    }
    wrap.appendChild(div);
    wrappers.push(div);
  }

  craftSpinStart = null;
  function frame(now) {
    if (!craftSpinStart) craftSpinStart = now;
    const t      = now - craftSpinStart;
    const radius = CR_SPIN_RADIUS * Math.sin(t / 300);
    for (let i = 0; i < 5; i++) {
      const angle = t / 150 + (Math.PI * 2 * i / 5) - Math.PI / 2;
      wrappers[i].style.left = (CR_WRAP_CX + Math.cos(angle) * radius - CR_SLOT_SIZE / 2) + 'px';
      wrappers[i].style.top  = (CR_WRAP_CY + Math.sin(angle) * radius - CR_SLOT_SIZE / 2) + 'px';
    }
    craftSpinRaf = requestAnimationFrame(frame);
  }
  craftSpinRaf = requestAnimationFrame(frame);
}

function stopSpinAnimation() {
  if (craftSpinRaf) { cancelAnimationFrame(craftSpinRaf); craftSpinRaf = null; }
  craftSpinStart = null;
}

function explodeSpinAnimation(wrap, explodeMs, onDone) {
  stopSpinAnimation();
  const wrappers = Array.from(wrap.children);
  if (!wrappers.length) { onDone(); return; }

  const starts = wrappers.map(div => {
    const l  = parseFloat(div.style.left);
    const t  = parseFloat(div.style.top);
    const dx = (l + CR_SLOT_SIZE / 2) - CR_WRAP_CX;
    const dy = (t + CR_SLOT_SIZE / 2) - CR_WRAP_CY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return { l, t, nx: dx / dist, ny: dy / dist };
  });
  const EXPLODE_DIST = 55;
  const startTime = performance.now();

  function explodeFrame(now) {
    const p    = Math.min((now - startTime) / explodeMs, 1);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    for (let i = 0; i < wrappers.length; i++) {
      const s = starts[i];
      wrappers[i].style.left    = (s.l + s.nx * EXPLODE_DIST * ease) + 'px';
      wrappers[i].style.top     = (s.t + s.ny * EXPLODE_DIST * ease) + 'px';
      wrappers[i].style.opacity = (1 - ease);
    }
    if (p < 1) {
      craftSpinRaf = requestAnimationFrame(explodeFrame);
    } else {
      craftSpinRaf = null; onDone();
    }
  }
  craftSpinRaf = requestAnimationFrame(explodeFrame);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ring rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderCraftingRing() {
  const wrap = craftingPanel?.querySelector('.cr-ring-wrap');
  if (!wrap) return;
  const dpr = window.devicePixelRatio || 1;

  if (craftAnimState === 'spinning') return; // rAF owns it

  stopSpinAnimation();
  wrap.innerHTML = '';
  wrap.classList.remove('cr-spinning');

  // ── RESULT ─────────────────────────────────────────────────────────────────
  if (craftAnimState === 'result' && craftAnimResult) {
    const { srcTypeId, successCount, returnedTotal, failCount, nextTypeId } = craftAnimResult;

    const onCollect = () => {
      const held = (craftAnimResult.returnedTotal ?? 0) - (craftAnimResult.returnedUsed ?? 0);
      for (let r = 0; r < held; r++) addToInventory(srcTypeId);
      setInvDirty(true);
      craftAnimState  = null;
      craftAnimResult = null;
      craftSlots      = [0, 0, 0, 0, 0];
      craftSel        = null;
      updateLostLabel(null);
      renderCraftingPanel();
    };

    if ((failCount > 0 || returnedTotal > 0) && successCount === 0) {
      for (let i = 0; i < CR_RING_SLOTS.length; i++) {
        const pos = CR_RING_SLOTS[i];
        const box = document.createElement('div');
        box.className = 'cr-fail-box';
        box.style.left = pos.x + 'px'; box.style.top = pos.y + 'px';
        box.style.width = CR_SLOT_SIZE + 'px'; box.style.height = CR_SLOT_SIZE + 'px';
        box.style.zIndex = '1';
        const cv   = document.createElement('canvas');
        const phys = Math.round(CR_SLOT_SIZE * dpr);
        cv.width = phys; cv.height = phys;
        cv.style.width = CR_SLOT_SIZE + 'px'; cv.style.height = CR_SLOT_SIZE + 'px';
        const rctx = cv.getContext('2d');
        rctx.scale(dpr, dpr);
        if (i < returnedTotal) drawPetalBox(rctx, 0, 0, CR_SLOT_SIZE, srcTypeId, 0, 0);
        else                   drawEmptySlot(rctx, 0, 0, CR_SLOT_SIZE);
        box.appendChild(cv);
        box.addEventListener('click', onCollect);
        wrap.appendChild(box);
      }
    }

    if (successCount > 0) {
      const SIZE = 52;
      const phys = Math.round(SIZE * dpr);
      const cv   = document.createElement('canvas');
      cv.className = 'cr-preview-canvas cr-success-pulse';
      cv.width = phys; cv.height = phys;
      cv.style.cssText = `width:${SIZE}px;height:${SIZE}px;position:absolute;left:50%;top:50%;z-index:10;border-radius:10px;`;
      const rctx = cv.getContext('2d');
      rctx.scale(dpr, dpr);
      drawPetalBox(rctx, 0, 0, SIZE, nextTypeId, 0, 0);
      cv.addEventListener('click', onCollect);
      wrap.appendChild(cv);
      if (successCount > 1) {
        const badge = document.createElement('div');
        badge.className = 'cr-success-count-badge';
        badge.textContent = 'x' + successCount; badge.style.zIndex = '11';
        wrap.appendChild(badge);
      }
    }
    return;
  }

  // ── IDLE: 5 pentagon slots ─────────────────────────────────────────────────
  for (let i = 0; i < CR_RING_SLOTS.length; i++) {
    const pos   = CR_RING_SLOTS[i];
    const count = craftSlots[i];
    const div   = document.createElement('div');
    div.style.cssText = `position:absolute;left:${pos.x}px;top:${pos.y}px;width:${CR_SLOT_SIZE}px;height:${CR_SLOT_SIZE}px;`;

    const cv   = document.createElement('canvas');
    cv.className = 'cr-ring-canvas';
    const phys = Math.round(CR_SLOT_SIZE * dpr);
    cv.width = phys; cv.height = phys;
    cv.style.width = CR_SLOT_SIZE + 'px'; cv.style.height = CR_SLOT_SIZE + 'px';
    const rctx = cv.getContext('2d');
    rctx.scale(dpr, dpr);
    if (craftSel && count > 0) drawPetalBox(rctx, 0, 0, CR_SLOT_SIZE, craftSel, 0, 0);
    else {
      rctx.fillStyle = '#b17f49';
      rctx.beginPath(); rctx.roundRect(0, 0, CR_SLOT_SIZE, CR_SLOT_SIZE, 7); rctx.fill();
    }
    div.appendChild(cv);
    if (count > 1) {
      const badge = document.createElement('div');
      badge.className = 'cr-batch-badge'; badge.textContent = 'x' + count;
      div.appendChild(badge);
    }

    div.style.cursor = 'pointer';
    div.addEventListener('click', () => {
      if (craftAnimState !== null || !craftSel) return;
      if (count > 0) {
        for (let s = 0; s < 5; s++) {
          for (let j = 0; j < craftSlots[s]; j++) addToInventory(craftSel);
          craftSlots[s] = 0;
        }
        craftSel = null;
      }
      setInvDirty(true);
      renderCraftingPanel();
    });
    wrap.appendChild(div);
  }
}

// Minimal empty-slot helper used only in the ring result view
function drawEmptySlot(ctx, x, y, size) {
  const cr = size * 0.16;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, size, size, cr);
  ctx.fillStyle = '#11151f'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid rendering (rarity × petal, horizontally scrollable by rarity)
// ─────────────────────────────────────────────────────────────────────────────
function getCraftGridPetals() {
  const baseIds = new Map();
  for (const [typeId, pt] of Object.entries(PETAL_TYPES)) {
    if (!pt || pt.tier !== 0) continue;
    baseIds.set(pt.name, typeId);
  }
  return Array.from(baseIds.entries())
    .map(([name, baseId]) => ({ name, baseId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getTypeIdForBaseTier(baseId, tier) {
  const suffix = tier === 0 ? '' : '_' + RARITIES[tier].toLowerCase().replace(/[^a-z0-9]/g, '_');
  const id = baseId + suffix;
  return PETAL_TYPES[id] ? id : null;
}

// Compute slot width from panel width (matches slotCSS in renderCraftingInv)
function getSlotCSS() {
  return Math.floor((420 - 6 - 8 - 6 - 7 * 5) / 8);
}

// Apply current craftGridScrollX (in px) to the slots element
function applyCraftScrollX() {
  const slotsEl   = craftingPanel?.querySelector('.cr-slots');
  const botSlider = craftingPanel?.querySelector('.cr-bottom-slider');
  if (!slotsEl) return;
  slotsEl.style.transform = `translateX(${-craftGridScrollX}px)`;
  // Sync slider: map px offset to column index
  const slotCSS = getSlotCSS();
  const step    = slotCSS + 5;
  if (botSlider) botSlider.value = Math.round(craftGridScrollX / step);
}

function scrollCraftGrid(newOffset) {
  const totalCols = RARITIES.length;
  craftGridRarityOffset = Math.max(0, Math.min(Math.max(0, totalCols - GRID_COLS), newOffset));
  const slotCSS = getSlotCSS();
  const step    = slotCSS + 5;
  craftGridScrollX = craftGridRarityOffset * step;
  applyCraftScrollX();
}

function renderCraftingInv() {
  const slotsEl   = craftingPanel?.querySelector('.cr-slots');
  const botSlider = craftingPanel?.querySelector('.cr-bottom-slider');
  if (!slotsEl) return;

  slotsEl.innerHTML = '';
  // Render GRID_COLS + extra columns so content exists to slide into view
  const RENDER_COLS = GRID_COLS + (RARITIES.length - GRID_COLS); // = all 14
  const dpr     = window.devicePixelRatio || 1;
  const slotCSS = getSlotCSS();

  const allPetals = getCraftGridPetals();
  const totalCols = RARITIES.length; // 14

  craftGridRarityOffset = Math.max(0, Math.min(craftGridRarityOffset, Math.max(0, totalCols - GRID_COLS)));
  if (botSlider) { botSlider.max = Math.max(0, totalCols - GRID_COLS); botSlider.value = Math.round(craftGridScrollX); }

  for (let r = 0; r < allPetals.length; r++) {
    const petalInfo = allPetals[r];
    for (let c = 0; c < totalCols; c++) {
      const slot      = document.createElement('div');
      const rarityIdx = c;
      const typeId    = getTypeIdForBaseTier(petalInfo.baseId, rarityIdx);

      const rawCount   = typeId ? (inventoryItems[typeId] ?? 0) : 0;
      const inHotbar   = typeId ? [...hotbar, ...benchBar].filter(t => t === typeId).length : 0;
      const count      = Math.max(0, rawCount - inHotbar);

      const isCraftable = typeId && canCraft(typeId) && count > 0;
      const isSelected  = typeId && typeId === craftSel;

      slot.className = 'cr-slot' +
        (isCraftable ? ' craftable' : '') +
        (isSelected  ? ' cr-selected' : '') +
        (!typeId || count === 0 ? ' cr-empty' : '');
      if (typeId) slot.dataset.typeId = typeId;

      if (typeId && count > 0) {
        const phys = Math.round(slotCSS * dpr);
        const cv   = document.createElement('canvas');
        cv.width = phys; cv.height = phys;
        const sctx = cv.getContext('2d');
        sctx.scale(dpr, dpr);
        drawPetalBox(sctx, 0, 0, slotCSS, typeId, 0, 0);
        slot.appendChild(cv);
        const cnt = document.createElement('div');
        cnt.className = 'cr-slot-cnt';
        cnt.textContent = 'x' + count;
        slot.appendChild(cnt);
      }

      if (isCraftable) {
        slot.addEventListener('click', e => _onCraftSlotClick(e, typeId));
      }
      slotsEl.appendChild(slot);
    }
  }

  // Set slot width CSS var so grid columns match JS calculations
  slotsEl.style.setProperty('--cr-slot-w', slotCSS + 'px');
  // Immediately apply current scroll position
  slotsEl.style.transform = `translateX(${-craftGridScrollX}px)`;

  if (botSlider && !botSlider._wired) {
    botSlider._wired = true;
    botSlider.addEventListener('input', () => scrollCraftGrid(+botSlider.value));
  }

  const crScroll = craftingPanel?.querySelector('.cr-grid-scroll');
  if (crScroll && !crScroll._wheelWired) {
    crScroll._wheelWired = true;
    crScroll.addEventListener('wheel', e => {
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
      if (!isHorizontal) return;
      e.preventDefault();
      e.stopPropagation();
      const slotCSS = getSlotCSS();
      const step    = slotCSS + 5;
      const totalCols = RARITIES.length;
      const maxPx   = Math.max(0, totalCols - GRID_COLS) * step;
      const rawDelta = e.shiftKey ? e.deltaY : e.deltaX;
      craftGridScrollX = Math.max(0, Math.min(maxPx, craftGridScrollX + rawDelta));
      craftGridRarityOffset = Math.round(craftGridScrollX / step);
      applyCraftScrollX();
    }, { passive: false });
  }
}

function _onCraftSlotClick(e, typeId) {
  if (getDragJustEnded()) return;
  if (craftAnimState === 'spinning') return;

  // In result state: use held returned petals to refill empty slots
  if (craftAnimState === 'result' && craftAnimResult && typeId === craftAnimResult.srcTypeId) {
    const heldLeft = (craftAnimResult.returnedTotal ?? 0) - (craftAnimResult.returnedUsed ?? 0);
    const invAvail = inventoryItems[typeId] ?? 0;
    if (heldLeft + invAvail < 1) return;

    let filled = 0;
    for (let s = 0; s < 5; s++) {
      if (craftSlots[s] === 0) {
        const stillHeld = (craftAnimResult.returnedTotal ?? 0) - (craftAnimResult.returnedUsed ?? 0);
        if (stillHeld > 0) {
          craftAnimResult.returnedUsed = (craftAnimResult.returnedUsed ?? 0) + 1;
        } else if ((inventoryItems[typeId] ?? 0) > 0) {
          removeFromInventory(typeId);
        } else { break; }
        craftSlots[s] = 1; filled++;
      }
    }
    if (filled > 0) {
      const remainingHeld = (craftAnimResult.returnedTotal ?? 0) - (craftAnimResult.returnedUsed ?? 0);
      for (let r = 0; r < remainingHeld; r++) addToInventory(craftAnimResult.srcTypeId);
      craftSel = typeId; craftAnimState = null; craftAnimResult = null;
      updateLostLabel(null); setInvDirty(true); renderCraftingPanel();
    }
    return;
  }

  if (craftAnimState !== null) return;

  const inHotbarNow = [...hotbar, ...benchBar].filter(t => t === typeId).length;
  const avail = Math.max(0, (inventoryItems[typeId] ?? 0) - inHotbarNow);
  if (avail < 1) return;

  // Switching petal type → return queued petals first
  if (craftSel !== null && craftSel !== typeId && craftSlots.some(n => n > 0)) {
    const total = craftSlots.reduce((a, b) => a + b, 0);
    for (let i = 0; i < total; i++) addToInventory(craftSel);
    craftSlots = [0, 0, 0, 0, 0];
  }
  craftSel = typeId;

  if (e.shiftKey) {
    // Shift+click: fill ALL available petals
    let toAdd = avail;
    while (toAdd > 0 && (inventoryItems[typeId] ?? 0) - inHotbarNow > 0) {
      const minVal = Math.min(...craftSlots);
      const idx    = craftSlots.indexOf(minVal);
      craftSlots[idx]++; removeFromInventory(typeId); toAdd--;
    }
  } else {
    // Normal click: add 1 to each slot
    for (let s = 0; s < 5; s++) {
      if ((inventoryItems[typeId] ?? 0) - inHotbarNow < 1) break;
      craftSlots[s]++; removeFromInventory(typeId);
    }
  }

  setInvDirty(true);
  renderCraftingPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hint / label updates
// ─────────────────────────────────────────────────────────────────────────────
function updateCraftingHints() {
  const btn   = craftingPanel?.querySelector('.cr-craft-btn');
  const hints = craftingPanel?.querySelectorAll('.cr-hint');
  if (!btn || !hints) return;

  if (craftAnimState === 'spinning' || craftAnimState === 'result') {
    btn.style.background = '#888'; btn.style.borderColor = '#666'; btn.style.color = '#f0f0f0';
    btn.disabled = true;
    if (hints[0]) hints[0].textContent = craftAnimState === 'spinning' ? 'Crafting…' : 'Click result to collect';
    if (hints[1]) hints[1].textContent = '';
    return;
  }

  if (!craftSel) {
    btn.style.background = '#888'; btn.style.borderColor = '#666'; btn.style.color = '#f0f0f0';
    btn.disabled = true;
    if (hints[0]) hints[0].textContent = 'Click a petal to add it';
    if (hints[1]) hints[1].textContent = '— % success';
    return;
  }

  const count       = inventoryItems[craftSel] ?? 0;
  const nextId      = getNextTypeId(craftSel);
  const nextPt      = nextId ? PETAL_TYPES[nextId] : null;
  const totalQueued = craftSlots.reduce((a, b) => a + b, 0);
  const minSlot     = Math.min(...craftSlots);
  const canCraftNow = minSlot > 0;

  btn.disabled = !canCraftNow;
  if (nextPt && canCraftNow) {
    btn.style.background  = RARITY_BG[nextPt.rarity]     ?? '#1c15d6';
    btn.style.borderColor = RARITY_BORDER[nextPt.rarity] ?? '#0a0866';
    btn.style.color = '#fff';
  } else {
    btn.style.background = '#888'; btn.style.borderColor = '#666'; btn.style.color = '#f0f0f0';
  }

  if (hints[0]) {
    hints[0].textContent = totalQueued > 0
      ? (minSlot === 1 ? `${totalQueued} petals queued` : `${totalQueued} petals queued (${minSlot} attempts)`)
      : (count >= 1 ? `${count} available — click to add` : 'No petals available');
  }
  if (hints[1]) hints[1].textContent = getChanceLabel(craftSel) + ' success';
}

function updateLostLabel(result) {
  const el = craftingPanel?.querySelector('.cr-lost-info');
  if (!el) return;
  if (!result) { el.textContent = ''; return; }
  const { successCount, failCount, returnedTotal } = result;
  const parts = [];
  if (successCount > 0) parts.push(`✓ lost ${successCount * 5}`);
  if (failCount   > 0) parts.push(`✗ lost ${failCount * 5 - returnedTotal}, returned ${returnedTotal}`);
  el.textContent = parts.join('  |  ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Full panel re-render
// ─────────────────────────────────────────────────────────────────────────────
export function renderCraftingPanel() {
  renderCraftingRing();
  renderCraftingInv();
  updateCraftingHints();
  if (craftAnimState !== 'result') updateLostLabel(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function showCraftToast(msg, color) {
  if (!craftingPanel) return;
  craftingPanel.querySelector('.cr-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'cr-toast'; t.textContent = msg; t.style.background = color;
  craftingPanel.appendChild(t);
  setTimeout(() => t.classList.add('fade'), 1200);
  setTimeout(() => t.remove(), 1700);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM setup
// ─────────────────────────────────────────────────────────────────────────────
export function ensureCraftingDOM() {
  if (craftingPanel) return;

  // ── Button ────────────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'crafting-btn';
  const img = document.createElement('img');
  img.src = './zicons/crafting-icon.png'; img.draggable = false;
  btn.appendChild(img);
  document.body.appendChild(btn);
  btn.addEventListener('mousedown', e => e.stopPropagation());

  // ── Panel ─────────────────────────────────────────────────────────────────
  craftingPanel = document.createElement('div');
  craftingPanel.id = 'crafting-panel';
  craftingPanel.innerHTML = `
    <div class="cr-hdr">
      <span class="cr-title">Craft</span>
      <button class="cr-close" title="Close">✕</button>
    </div>
    <div class="cr-craft-area">
      <div class="cr-ring-wrap" style="width:130px;height:130px;flex-shrink:0;position:relative;"></div>
      <div class="cr-side">
        <button class="cr-craft-btn" disabled>Craft</button>
        <span class="cr-hint">Select a petal</span>
        <span class="cr-hint">— % success</span>
        <span class="cr-lost-info"></span>
      </div>
    </div>
    <div class="cr-divider"></div>
    <div class="cr-inv-label">Inventory</div>
    <div class="cr-grid-area">
      <div class="cr-grid-scroll"><div class="cr-slots"></div></div>
      <div class="cr-bottom-slider-wrap">
        <input type="range" class="cr-bottom-slider" min="0" value="0" step="1">
      </div>
    </div>
  `;
  document.body.appendChild(craftingPanel);

  craftingPanel.querySelector('.cr-close').addEventListener('click', closeCraftingPanel);
  craftingPanel.addEventListener('mousedown', e => e.stopPropagation());

  // ── Grid tooltip ──────────────────────────────────────────────────────────
  const crScroll = craftingPanel.querySelector('.cr-grid-scroll');
  crScroll.addEventListener('mousemove', e => {
    const slot = e.target.closest('.cr-slot');
    if (!slot?.dataset.typeId) { setPetalHover(null, null); return; }
    if ((inventoryItems[slot.dataset.typeId] ?? 0) === 0) { setPetalHover(null, null); return; }
    const panelRect = craftingPanel.getBoundingClientRect();
    const slotRect  = slot.getBoundingClientRect();
    setPetalHover(slot.dataset.typeId, { x: panelRect.right, y: slotRect.top, w: 0, h: slotRect.height });
  });
  crScroll.addEventListener('mouseleave', () => setPetalHover(null, null));

  // ── Craft button ──────────────────────────────────────────────────────────
  craftingPanel.querySelector('.cr-craft-btn').addEventListener('click', () => {
    if (!craftSel || craftAnimState === 'spinning' || craftAnimState === 'result') return;
    const minSlot = Math.min(...craftSlots);
    if (minSlot === 0) return;

    const srcTypeId  = craftSel;
    const batchCount = minSlot;

    // Return extra petals above minSlot
    for (let i = 0; i < 5; i++) {
      const extra = craftSlots[i] - minSlot;
      for (let j = 0; j < extra; j++) addToInventory(srcTypeId);
    }
    craftSlots     = [0, 0, 0, 0, 0];
    craftAnimState = 'spinning';

    const wrap = craftingPanel?.querySelector('.cr-ring-wrap');
    startSpinAnimation(wrap, batchCount);
    updateCraftingHints();

    if (craftAnimTimeout) clearTimeout(craftAnimTimeout);
    craftAnimTimeout = setTimeout(() => {
      craftAnimTimeout = null;

      let successCount = 0, failCount = 0, returnedTotal = 0;
      let nextTypeId   = getNextTypeId(srcTypeId);

      for (let b = 0; b < batchCount; b++) {
        const res = performCraftSingle(srcTypeId);
        if (!res) continue;
        nextTypeId = res.nextTypeId;
        if (res.success) { successCount++; addToInventory(res.nextTypeId); }
        else             { failCount++; returnedTotal += res.returned; }
      }

      setInvDirty(true);
      returnedTotal   = Math.min(returnedTotal, 4); // cap at 4
      craftAnimResult = { srcTypeId, successCount, failCount, returnedTotal, batchCount, nextTypeId };
      updateLostLabel({ successCount, failCount, returnedTotal, batchCount });

      const currentWrap = craftingPanel?.querySelector('.cr-ring-wrap');
      if (successCount > 0) {
        // Scale slots to centre → snap result
        const SCALE_DUR = 380;
        const wrappers  = Array.from(currentWrap.children);
        const startTime = performance.now();
        stopSpinAnimation();
        const starts = wrappers.map(div => ({ l: parseFloat(div.style.left), t: parseFloat(div.style.top) }));
        function scaleInFrame(now) {
          const p    = Math.min((now - startTime) / SCALE_DUR, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          for (let i = 0; i < wrappers.length; i++) {
            const tx = CR_WRAP_CX - CR_SLOT_SIZE / 2;
            const ty = CR_WRAP_CY - CR_SLOT_SIZE / 2;
            wrappers[i].style.left    = (starts[i].l + (tx - starts[i].l) * ease) + 'px';
            wrappers[i].style.top     = (starts[i].t + (ty - starts[i].t) * ease) + 'px';
            wrappers[i].style.opacity = (1 - ease);
          }
          if (p < 1) { craftSpinRaf = requestAnimationFrame(scaleInFrame); }
          else       { craftSpinRaf = null; craftAnimState = 'result'; renderCraftingPanel(); }
        }
        craftSpinRaf = requestAnimationFrame(scaleInFrame);
      } else {
        explodeSpinAnimation(currentWrap, 420, () => { craftAnimState = 'result'; renderCraftingPanel(); });
      }
    }, 2750 + batchCount * 60);
  });

  // ── Toggle button click ───────────────────────────────────────────────────
  btn.addEventListener('click', () => {
    craftingPanelOpen = !craftingPanelOpen;
    if (craftingPanelOpen) {
      if (inventoryOpen) toggleInventory();
      if (_settings.isSettingsOpen())   _settings.closeSettings();
      if (_mobGal.isMobGalOpen())       _mobGal.closeMobGal();
      if (_updateLog.isUpdateLogOpen()) _updateLog.closeUpdateLog();
      craftingPanel.classList.add('open');
      positionCraftingPanel();
      // Defer render so the panel is visible/laid-out in the DOM first
      if (craftAnimState !== 'spinning' && craftAnimState !== 'result') {
        requestAnimationFrame(() => renderCraftingPanel());
      } else {
        requestAnimationFrame(() => renderCraftingPanel());
      }
      return;
    }
    craftingPanel.classList.remove('open');
  });

  positionCraftingButton();
  positionCraftingPanel();

  // Register with inventoryUI so it can keep crafting in sync
  registerCraftingWithInv({
    getCraftSel:    () => craftSel,
    getCraftSlots:  () => craftSlots,
    isCraftingOpen: () => craftingPanelOpen,
    closeCrafting:  closeCraftingPanel,
    positionPanel:  positionCraftingPanel,
    renderPanel:    renderCraftingPanel,
  });
}