/**
 * inventoryUI.js
 *
 * DOM inventory panel: renders petal slots grouped by rarity, handles
 * click-to-equip and drag-from-inventory, fly animation to hotbar.
 */

import { hotbar, benchBar, rebuildPetals }          from './petals.js';
import { inventoryItems, inventoryOpen, toggleInventory,
         addToInventory, removeFromInventory }        from './inventory.js';
import { PETAL_TYPES }                               from './petalTypes.js';
import { RARITY_BG, RARITY_BORDER, RARITY_COLORS }  from './constants.js';
import { drawInventoryIcon }                         from './petalDrawing.js';
import { setPetalHover }                             from './petalTooltip.js';
import {
  drag, octx, ensureOverlay,
  drawPetalBox,
  hbLeft, hbTop, benchLeft, benchTop,
  SLOT_SIZE, SLOT_GAP, BENCH_SIZE, BENCH_GAP,
  setInvSlotCSS, registerInvAccess,
} from './HotbarUI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks — registered by craftingUI to break the circular dep
// inventoryUI ↔ craftingUI
// ─────────────────────────────────────────────────────────────────────────────
let _craft = {
  getCraftSel:    () => null,
  getCraftSlots:  () => [0, 0, 0, 0, 0],
  isCraftingOpen: () => false,
  closeCrafting:  () => {},
  positionPanel:  () => {},
  renderPanel:    () => {},
};
export function registerCraftingWithInv(cbs) { Object.assign(_craft, cbs); }

let _otherPanels = {
  isSettingsOpen:  () => false, closeSettings:  () => {},
  isMobGalOpen:    () => false, closeMobGal:    () => {},
  isUpdateLogOpen: () => false, closeUpdateLog: () => {},
};
export function registerOtherPanelsWithInv(cbs) { Object.assign(_otherPanels, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
export let invPanel       = null;
export let invScroll      = null;
let invSearchEl           = null;
let invSearchTerm         = '';
export let invDirty       = true;
export let invAnimate     = true;
let invHasOpenedOnce      = false;
let invHovering           = false;
let invWasOpen            = false;

export function setInvDirty(v)   { invDirty  = v; }
export function setInvAnimate(v) { invAnimate = v; }

export const RARITY_ORDER = [
  'Common','Unusual','Rare','Epic','Legendary',
  'Mythic','Ultra','Super','Radiant','Mystic','Runic',
  'Seraphic','Umbral','Impracticality',
];

// ─────────────────────────────────────────────────────────────────────────────
// Inject styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectInvStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* ── Inventory toggle button ────────────────────────────────────────── */
    #inv-toggle-btn {
      position: fixed; width: 54px; height: 54px; border-radius: 10px;
      background: #1A4ABF; border: 3px solid #0d2d80;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 5px; box-sizing: border-box; user-select: none;
    }
    #inv-toggle-btn:active { transform: scale(0.95); }
    #inv-toggle-btn img { width:100%;height:100%;object-fit:contain;display:block;mix-blend-mode:screen; }

    /* ── Inventory panel ─────────────────────────────────────────────────── */
    #inv-panel {
      position: fixed; width: 280px; display: flex; flex-direction: column;
      max-height: min(490px, calc(100vh - 20px));
      background: #1A4ABF; border: 3px solid #0d2d80; border-radius: 14px;
      font-family: 'UbuntuCustom', 'Ubuntu', Arial, sans-serif;
      z-index: 100; user-select: none; opacity: 0; pointer-events: none;
      transform: translateY(calc(100% + 24px)); transform-origin: left bottom;
      transition: opacity 0.22s cubic-bezier(0.22,1,0.36,1), transform 0.22s cubic-bezier(0.22,1,0.36,1);
      overflow: hidden;
    }
    #inv-panel.open { opacity:1; pointer-events:auto; transform:translateY(0); }

    /* ── Header ──────────────────────────────────────────────────────────── */
    #inv-panel .inv-hdr {
      flex-shrink:0; display:flex; align-items:center; justify-content:center;
      position:relative; padding:8px 10px 7px; background:#1A4ABF;
    }
    #inv-panel .inv-title {
      color:#fff; font-size:15px; font-weight:900; letter-spacing:2px;
      text-align:center;
    }
    #inv-panel .inv-close {
      position:absolute; right:10px; background:#e05050; border:none;
      border-radius:5px; color:#fff; cursor:pointer; font-size:13px; font-weight:900;
      width:22px; height:22px; display:flex; align-items:center; justify-content:center;
      padding:0; line-height:1; transition:background 0.12s;
    }
    #inv-panel .inv-close:hover { background:#c03030; }

    /* ── Search ──────────────────────────────────────────────────────────── */
    #inv-panel .inv-search-wrap { flex-shrink:0; padding:6px 8px 5px; background:#1A4ABF; }
    #inv-panel .inv-search {
      width:100%; box-sizing:border-box; background:rgba(255,255,255,0.12);
      border:1.5px solid rgba(255,255,255,0.20); border-radius:7px; color:#fff;
      font-family:inherit; font-size:12px; font-weight:600; padding:5px 9px;
      outline:none; transition:background 0.15s,border-color 0.15s;
    }
    #inv-panel .inv-search::placeholder { color:rgba(255,255,255,0.38); }
    #inv-panel .inv-search:focus { background:rgba(255,255,255,0.18); border-color:rgba(255,255,255,0.45); }

    /* ── Scroll area ─────────────────────────────────────────────────────── */
    #inv-scroll {
      overflow-y:auto; flex:1; min-height:0; background:#1A4ABF;
    }
    #inv-scroll::-webkit-scrollbar { width:4px; }
    #inv-scroll::-webkit-scrollbar-track { background:transparent; }
    #inv-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.18); border-radius:4px; }

    /* ── Rarity label ────────────────────────────────────────────────────── */
    .inv-rar-label {
      font-size:9.5px; font-weight:900; letter-spacing:2px; text-transform:uppercase;
      text-align:center; padding:5px 0 2px; opacity:0.88;
    }

    /* ── 5-column petal grid ─────────────────────────────────────────────── */
    .inv-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:5px; padding:3px 8px 5px; }

    /* ── Slot animations ─────────────────────────────────────────────────── */
    @keyframes inv-slot-pop {
      0%   { opacity:0; transform:scale(0.55) translateY(6px); }
      70%  { transform:scale(1.08) translateY(-1px); }
      100% { opacity:1; transform:scale(1) translateY(0); }
    }
    @keyframes hotbar-return {
      0%   { opacity:0; transform:scale(0.2) rotate(320deg); }
      65%  { transform:scale(1.14) rotate(-8deg); }
      100% { opacity:1; transform:scale(1) rotate(0deg); }
    }
    .inv-slot.popping  { animation:inv-slot-pop    0.22s cubic-bezier(0.34,1.56,0.64,1) both; }
    .inv-slot.returning { animation:hotbar-return  0.35s cubic-bezier(0.34,1.56,0.64,1) both; }

    /* ── Individual petal slot ───────────────────────────────────────────── */
    .inv-slot {
      aspect-ratio:1; border-radius:8px; border:2px solid transparent;
      position:relative; cursor:pointer; box-sizing:border-box; overflow:hidden;
      transition:transform 0.10s, filter 0.10s;
    }
    .inv-slot canvas { display:block; width:100%!important; height:100%!important; pointer-events:none; }
    .inv-cnt {
      position:absolute; top:3px; right:3px; font-size:8px; font-weight:900; color:#fff;
      pointer-events:none; line-height:1;
      transform:rotate(15deg); transform-origin:top right;
    }
    .inv-empty {
      text-align:center; color:rgba(255,255,255,0.55); font-size:12px;
      padding:28px 0 20px; font-style:italic;
    }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Positioning
// ─────────────────────────────────────────────────────────────────────────────
export function positionInvButton() {
  const btn = document.getElementById('inv-toggle-btn');
  if (!btn) return;
  btn.style.left = '16px';
  btn.style.top  = Math.round(window.innerHeight * 0.68 - 27) + 'px';
}

export function positionInvPanel() {
  if (!invPanel) return;
  const btn = document.getElementById('inv-toggle-btn');
  if (!btn) return;
  const btnRect = btn.getBoundingClientRect();
  const panelH  = invPanel.offsetHeight;
  const screenH = window.innerHeight;
  let panelTop  = btnRect.top;
  if (panelTop + panelH > screenH - 8) panelTop = screenH - 8 - panelH;
  if (panelTop < 8) panelTop = 8;
  invPanel.style.left = Math.round(btnRect.right + 10) + 'px';
  invPanel.style.top  = Math.round(panelTop) + 'px';
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureInvDOM
// ─────────────────────────────────────────────────────────────────────────────
export function ensureInvDOM() {
  if (invPanel) return;

  invPanel = document.createElement('div');
  invPanel.id = 'inv-panel';
  invPanel.addEventListener('mousedown', e => e.stopPropagation());
  document.body.appendChild(invPanel);
  invPanel.innerHTML = `
    <div class="inv-hdr">
      <span class="inv-title">Inventory</span>
      <button class="inv-close" title="Close [X]">✕</button>
    </div>
    <div class="inv-search-wrap">
      <input class="inv-search" id="inv-search-input" type="text"
             placeholder="Search petals…" autocomplete="off" spellcheck="false"/>
    </div>
    <div id="inv-scroll"></div>
  `;
  invPanel.querySelector('.inv-close').addEventListener('click', () => toggleInventory());

  // Toggle button
  let invBtn = document.getElementById('inv-toggle-btn');
  if (!invBtn) {
    invBtn = document.createElement('div');
    invBtn.id = 'inv-toggle-btn';
    const img = document.createElement('img');
    img.src = './zicons/inv-icon.png'; img.draggable = false;
    invBtn.appendChild(img); document.body.appendChild(invBtn);
    invBtn.addEventListener('click', () => toggleInventory());
    invBtn.addEventListener('mousedown', e => e.stopPropagation());
  }
  positionInvButton();

  invSearchEl = invPanel.querySelector('#inv-search-input');
  invSearchEl.addEventListener('input', () => { invSearchTerm = invSearchEl.value.toLowerCase(); invDirty = true; invAnimate = true; });
  invSearchEl.addEventListener('keydown', e => e.stopPropagation());

  invScroll = document.getElementById('inv-scroll');

  // Register inv callbacks with hotbarUI so the drag system can access invScroll
  registerInvAccess({
    getInvScroll:  () => invScroll,
    setDirty:      v => { invDirty  = v; },
    setAnimate:    v => { invAnimate = v; },
    render:        renderInventory,
    getHovering:   () => invHovering,
  });

  // Click-to-equip
  invScroll.addEventListener('click', e => {
    if (drag.committed) return;
    const slot = e.target.closest('.inv-slot');
    if (!slot?.dataset.typeId) return;
    equipFromInventory(slot.dataset.typeId);
  });

  // Hover tooltips
  invScroll.addEventListener('mousemove', e => {
    const slot = e.target.closest('.inv-slot');
    if (slot?.dataset.typeId && !drag.committed) {
      invHovering = true;
      const rect = slot.getBoundingClientRect(), panelRect = invPanel.getBoundingClientRect();
      setPetalHover(slot.dataset.typeId, { x: panelRect.right, y: rect.top, w: 0, h: rect.height });
    } else if (!slot?.dataset.typeId && !drag.committed) {
      invHovering = false; setPetalHover(null, null);
    }
  });
  invScroll.addEventListener('mouseleave', () => { invHovering = false; setPetalHover(null, null); });

  // Drag from inventory
  invScroll.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const slot = e.target.closest('.inv-slot');
    if (!slot?.dataset.typeId) return;
    const typeId = slot.dataset.typeId;
    if (!PETAL_TYPES[typeId]) return;
    // Dupe guard: never start a drag when there are no free petals left
    if ((inventoryItems[typeId] ?? 0) <= 0) return;
    Object.assign(drag, { active: true, committed: false, slotIdx: -1, fromInv: true, typeId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// renderInventory
// ─────────────────────────────────────────────────────────────────────────────
export function renderInventory() {
  if (!invScroll) return;
  invScroll.innerHTML = '';

  const dpr     = window.devicePixelRatio || 1;
  const slotCSS = Math.floor((280 - 16 - 4 * 5) / 5);
  setInvSlotCSS(slotCSS);

  const doAnimate = invAnimate;
  invAnimate = false;

  const items = Object.entries(inventoryItems)
    .map(([typeId, count]) => ({ typeId, count, pt: PETAL_TYPES[typeId] }))
    .filter(({ pt }) => !!pt)
    .filter(({ count }) => count > 0)
    .filter(({ pt }) => !invSearchTerm || pt.name.toLowerCase().includes(invSearchTerm))
    .sort((a, b) =>
      (RARITY_ORDER.indexOf(b.pt.rarity) - RARITY_ORDER.indexOf(a.pt.rarity))
      || a.pt.name.localeCompare(b.pt.name)
    );

  if (items.length === 0) {
    const el = document.createElement('div');
    el.className   = 'inv-empty';
    el.textContent = invSearchTerm ? 'No petals match your search' : 'Your inventory is empty';
    invScroll.appendChild(el);
    return;
  }

  const byRarity = {};
  for (const it of items) (byRarity[it.pt.rarity] ??= []).push(it);
  const orderedRarities = [...RARITY_ORDER].reverse().filter(r => byRarity[r]);

  let slotIndex = 0;
  for (const rarity of orderedRarities) {
    const bg    = RARITY_BG[rarity]     || '#556';
    const brd   = RARITY_BORDER[rarity] || '#333';

    const grid = document.createElement('div');
    grid.className = 'inv-grid';

    for (const { typeId, count, pt } of byRarity[rarity]) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot'; slot.dataset.typeId = typeId;

      if (rarity === 'Impracticality') {
        slot.style.background  = 'linear-gradient(135deg,#ff0000,#ff8800,#ffff00,#00cc44,#0088ff,#8800ff,#ff00cc)';
        slot.style.borderColor = '#990099';
      } else {
        slot.style.background  = `color-mix(in srgb, ${bg} 38%, #0c1020)`;
        slot.style.borderColor = brd;
      }

      if (doAnimate) { slot.classList.add('popping'); slot.style.animationDelay = `${slotIndex * 28}ms`; }
      slotIndex++;

      const physSize = Math.round(slotCSS * dpr);
      const cv = document.createElement('canvas');
      cv.width = physSize; cv.height = physSize;
      drawInventoryIcon(cv, typeId); slot.appendChild(cv);

      if (count > 1) {
        const cnt = document.createElement('div');
        cnt.className = 'inv-cnt'; cnt.textContent = 'x' + count;
        slot.appendChild(cnt);
      }
      grid.appendChild(slot);
    }
    invScroll.appendChild(grid);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Click-to-equip (fly animation)
// ─────────────────────────────────────────────────────────────────────────────
export function equipFromInventory(typeId) {
  ensureOverlay();

  // Don't equip if this type is loaded in the crafting ring
  if (_craft.getCraftSel() === typeId && _craft.getCraftSlots().some(n => n > 0)) return;

  const W = window.innerWidth, H = window.innerHeight;
  const emptyTop   = hotbar.indexOf(null);
  const emptyBench = benchBar.indexOf(null);

  let targetRow, targetSlotIdx, targetX, targetY, targetSize;
  if (emptyTop !== -1) {
    targetRow = 'top'; targetSlotIdx = emptyTop;
    targetX = hbLeft(W) + emptyTop * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
    targetY = hbTop(H) + SLOT_SIZE / 2; targetSize = SLOT_SIZE;
  } else if (emptyBench !== -1) {
    targetRow = 'bench'; targetSlotIdx = emptyBench;
    targetX = benchLeft(W) + emptyBench * (BENCH_SIZE + BENCH_GAP) + BENCH_SIZE / 2;
    targetY = benchTop(H) + BENCH_SIZE / 2; targetSize = BENCH_SIZE;
  } else { return; }

  const srcSlotEl = invScroll?.querySelector(`[data-type-id="${typeId}"]`);
  let startX, startY, startSize;
  if (srcSlotEl) {
    const rect = srcSlotEl.getBoundingClientRect();
    startX = rect.left + rect.width / 2; startY = rect.top + rect.height / 2;
    startSize = rect.width; srcSlotEl.style.visibility = 'hidden';
  } else {
    startX = targetX; startY = targetY; startSize = 44;
  }

  if (!removeFromInventory(typeId)) { if (srcSlotEl) srcSlotEl.style.visibility = ''; return; }
  if (targetRow === 'bench') { benchBar[targetSlotIdx] = typeId; }
  else { hotbar[targetSlotIdx] = typeId; rebuildPetals(); }
  invDirty = true; invAnimate = false;

  const duration = 280, startTime = performance.now();
  (function flyAnim(now) {
    const rawT = Math.min((now - startTime) / duration, 1);
    const t    = 1 - Math.pow(1 - rawT, 3);
    octx.clearRect(0, 0, W, H);
    if (rawT < 1) {
      const cx   = startX + (targetX - startX) * t;
      const cy   = startY + (targetY - startY) * t;
      const arcY = cy - Math.sin(rawT * Math.PI) * 40;
      const size = startSize + (SLOT_SIZE - startSize) * t;
      const rot  = (1 - t) * 0.6;
      octx.save(); octx.globalAlpha = 0.35;
      drawPetalBox(octx, cx - size / 2, arcY - size / 2, size, typeId, 0, rot); octx.restore();
      octx.globalAlpha = 0.95; drawPetalBox(octx, cx - size / 2, arcY - size / 2, size, typeId, 0, rot);
      octx.globalAlpha = 1; requestAnimationFrame(flyAnim);
    } else {
      octx.clearRect(0, 0, W, H);
      if (srcSlotEl) srcSlotEl.style.visibility = '';
      setTimeout(renderInventory, 0);
    }
  })(performance.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// updateInventory  — called every frame (or on toggle) from uiManager
// ─────────────────────────────────────────────────────────────────────────────
export function updateInventory() {
  ensureInvDOM();
  const isOpen = inventoryOpen;

  if (isOpen && !invWasOpen) {
    // Close competing panels
    if (_craft.isCraftingOpen())        _craft.closeCrafting();
    if (_otherPanels.isSettingsOpen())  _otherPanels.closeSettings();
    if (_otherPanels.isMobGalOpen())    _otherPanels.closeMobGal();
    if (_otherPanels.isUpdateLogOpen()) _otherPanels.closeUpdateLog();
    if (!invHasOpenedOnce) { invAnimate = true; invHasOpenedOnce = true; }
    invDirty = true;
  }
  invWasOpen = isOpen;
  invPanel.classList.toggle('open', isOpen);
  positionInvButton();
  if (isOpen) positionInvPanel();

  if (_craft.isCraftingOpen()) {
    _craft.positionPanel();
    if (invDirty) _craft.renderPanel();
  }

  if (!isOpen) { invDirty = false; return; }
  if (!invDirty) return;
  invDirty = false;
  setTimeout(() => { renderInventory(); positionInvPanel(); }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// notifyInventoryChanged — called by external code (pickups, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export function notifyInventoryChanged() {
  invDirty = true;
  if (_craft.isCraftingOpen()) _craft.renderPanel();
}