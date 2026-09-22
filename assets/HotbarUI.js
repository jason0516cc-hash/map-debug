/**
 * hotbarUI.js
 *
 * Canvas-drawn hotbar + bench rows, drag ghost overlay, swap animations.
 * All geometry helpers and petal-box drawing primitives live here so
 * every other UI module can import them without pulling in the whole manager.
 */

import { hotbar, benchBar, petalInstances, rebuildPetals } from './petals.js';
import { inventoryItems, addToInventory, removeFromInventory } from './inventory.js';
import { PETAL_TYPES }           from './petalTypes.js';
import { RARITY_BG, RARITY_BORDER } from './constants.js';
import { drawInventoryIcon, isAnimatedIcon }     from './petalDrawing.js';
import { setPetalHover }         from './petalTooltip.js';

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
export const SLOT_SIZE    = 52;
export const SLOT_GAP     = 6;
export const BENCH_SIZE   = 42;
export const BENCH_GAP    = 6;
export const BENCH_ROW_GAP = 8;
const HB_PAD_B  = 34;
const DRAG_THRESH = 10;
const SWAP_DUR    = 220; // ms

// Homescreen-specific larger slot sizes
export const HS_SLOT_SIZE   = 68;
export const HS_SLOT_GAP    = 8;
export const HS_BENCH_SIZE  = 54;
export const HS_BENCH_GAP   = 8;
export const HS_BENCH_ROW_GAP = 10;

// When true, updateHotbar draws the bigger homescreen hotbar positioned below center
export let homescreenMode = false;
export function setHomescreenMode(v) { homescreenMode = v; }

// Vertical offset (px, positive = slide down off-screen) applied to hotbar canvas drawing
export let hotbarSlideOffset = 0;
export function setHotbarSlideOffset(v) { hotbarSlideOffset = v; }

// ─────────────────────────────────────────────────────────────────────────────
// Inv-slot CSS size — written by inventoryUI via setInvSlotCSS(), read here
// ─────────────────────────────────────────────────────────────────────────────
export let invSlotCSS = 44;
export function setInvSlotCSS(v) { invSlotCSS = v; }

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks registered by inventoryUI after its own setup
// Breaks the hotbarUI ↔ inventoryUI circular dependency.
// ─────────────────────────────────────────────────────────────────────────────
let _inv = {
  getInvScroll:  () => null,
  setDirty:      () => {},
  setAnimate:    () => {},
  render:        () => {},
  getHovering:   () => false,
};
export function registerInvAccess(cbs) { Object.assign(_inv, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// Icon cache
// ─────────────────────────────────────────────────────────────────────────────
const iconCache = new Map();
export function getIcon(typeId, physSize) {
  // Animated icons (see isAnimatedIcon/ANIMATED_ICON_BASE_IDS in
  // petalDrawing.js) skip the cache entirely and redraw fresh every call —
  // the hotbar/inventory already call this every frame via drawImage, so
  // that alone is enough to animate them.
  if (isAnimatedIcon(typeId)) {
    const cv = document.createElement('canvas');
    cv.width = physSize; cv.height = physSize;
    drawInventoryIcon(cv, typeId);
    return cv;
  }
  const key = `${typeId}__${physSize}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = physSize; cv.height = physSize;
  drawInventoryIcon(cv, typeId);
  iconCache.set(key, cv);
  return cv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag state
// ─────────────────────────────────────────────────────────────────────────────
export const drag = {
  active: false, committed: false,
  slotIdx: -1, fromInv: false, fromBench: false,
  typeId: null, x: 0, y: 0, startX: 0, startY: 0,
};

// Guard so crafting slot clicks don't fire right after a drag-release
let _dragJustEnded = false;
export function getDragJustEnded() { return _dragJustEnded; }

// ─────────────────────────────────────────────────────────────────────────────
// Swap animations
// ─────────────────────────────────────────────────────────────────────────────
const swapAnims = [];

// ─────────────────────────────────────────────────────────────────────────────
// Overlay canvas (drag ghost)
// ─────────────────────────────────────────────────────────────────────────────
let oc = null;
export let octx = null;

export function ensureOverlay() {
  if (oc) return;
  oc = document.createElement('canvas');
  oc.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:500;';
  document.body.appendChild(oc);
  octx = oc.getContext('2d');
  _resizeOverlay();
  window.addEventListener('resize', _resizeOverlay);
}
function _resizeOverlay() {
  if (!oc) return;
  const dpr = window.devicePixelRatio || 1;
  oc.width  = Math.round(window.innerWidth  * dpr);
  oc.height = Math.round(window.innerHeight * dpr);
  oc.style.width  = window.innerWidth  + 'px';
  oc.style.height = window.innerHeight + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghost lerp state
// ─────────────────────────────────────────────────────────────────────────────
export const ghostLerp = { x: 0, y: 0, size: 44 };
export let ghostLerpInit = false;
export function setGhostLerpInit(v) { ghostLerpInit = v; }

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers  (exported so inventoryUI can compute fly-animation targets)
// ─────────────────────────────────────────────────────────────────────────────
export function hbLeft(W)    {
  const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
  const sg = homescreenMode ? HS_SLOT_GAP  : SLOT_GAP;
  return W / 2 - (hotbar.length * ss + (hotbar.length - 1) * sg) / 2;
}
export function benchLeft(W) {
  const bs = homescreenMode ? HS_BENCH_SIZE : BENCH_SIZE;
  const bg = homescreenMode ? HS_BENCH_GAP  : BENCH_GAP;
  return W / 2 - (hotbar.length * bs + (hotbar.length - 1) * bg) / 2;
}
export function hbTop(H)     {
  const ss  = homescreenMode ? HS_SLOT_SIZE    : SLOT_SIZE;
  const bs  = homescreenMode ? HS_BENCH_SIZE   : BENCH_SIZE;
  const brg = homescreenMode ? HS_BENCH_ROW_GAP : BENCH_ROW_GAP;
  return H - HB_PAD_B - ss - brg - bs;
}
export function benchTop(H)  {
  const bs  = homescreenMode ? HS_BENCH_SIZE : BENCH_SIZE;
  return H - HB_PAD_B - bs;
}

export function slotAtPoint(x, y, W, H) {
  const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
  const sg = homescreenMode ? HS_SLOT_GAP  : SLOT_GAP;
  const ox = hbLeft(W), oy = hbTop(H);
  for (let i = 0; i < hotbar.length; i++) {
    const sx = ox + i * (ss + sg);
    if (x >= sx && x < sx + ss && y >= oy && y < oy + ss) return i;
  }
  return -1;
}
export function benchSlotAtPoint(x, y, W, H) {
  const bs = homescreenMode ? HS_BENCH_SIZE : BENCH_SIZE;
  const bg = homescreenMode ? HS_BENCH_GAP  : BENCH_GAP;
  const ox = benchLeft(W), oy = benchTop(H);
  for (let i = 0; i < hotbar.length; i++) {
    const sx = ox + i * (bs + bg);
    if (x >= sx && x < sx + bs && y >= oy && y < oy + bs) return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing primitives  (exported so craftingUI can draw petal boxes too)
// ─────────────────────────────────────────────────────────────────────────────
export function drawPetalBox(ctx, x, y, size, typeId, reloadProgress, wobbleRad, reloadMsLeft = 0, hp = null, maxHp = null) {
  const pt  = typeId ? PETAL_TYPES[typeId] : null;
  const bg  = pt ? RARITY_BG[pt.rarity]     : null;
  const brd = pt ? RARITY_BORDER[pt.rarity] : null;
  const cr  = size * 0.16;
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  if (wobbleRad) {
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(wobbleRad);
    x = -size / 2; y = -size / 2;
  }

  ctx.beginPath(); ctx.roundRect(x, y, size, size, cr);

  if (!pt) {
    ctx.fillStyle = '#181c2a'; ctx.fill();
  } else if (pt.rarity === 'Impracticality') {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0.00, '#ff0000'); g.addColorStop(0.17, '#ff8800');
    g.addColorStop(0.33, '#ffff00'); g.addColorStop(0.50, '#00cc44');
    g.addColorStop(0.67, '#0088ff'); g.addColorStop(0.83, '#8800ff');
    g.addColorStop(1.00, '#ff00cc');
    ctx.fillStyle = g; ctx.fill();
  } else {
    ctx.fillStyle = '#0d1020'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(x, y, size, size, cr);
    ctx.fillStyle = bg; ctx.globalAlpha *= 0.42; ctx.fill(); ctx.globalAlpha /= 0.42;
  }

  ctx.beginPath(); ctx.roundRect(x, y, size, size, cr);
  ctx.strokeStyle = brd || '#3a3f5a'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.roundRect(x + 2.5, y + 2.5, size - 5, size - 5, cr * 0.65);
  ctx.strokeStyle = 'rgba(255,255,255,0.11)'; ctx.lineWidth = 1; ctx.stroke();

  if (pt) {
    const phys = Math.round(size * dpr);
    ctx.drawImage(getIcon(typeId, phys), x, y, size, size);
  }

  // HP overlay
  if (pt && hp !== null && maxHp !== null && maxHp > 0 && hp < maxHp) {
    const missingH = size * (1 - Math.max(0, Math.min(1, hp / maxHp)));
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, size, size, cr); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x, y, size, missingH);
    ctx.restore();
  }

  // Reload overlay
  if (pt && reloadProgress > 0 && reloadProgress < 1) {
    const fillH = size * (1 - reloadProgress);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, size, size, cr); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.68)'; ctx.fillRect(x, y, size, fillH);
    ctx.restore();
    if (reloadMsLeft > 0) {
      const secs  = reloadMsLeft / 1000;
      const label = secs >= 10 ? secs.toFixed(0) + 's' : secs >= 1 ? secs.toFixed(1) + 's' : secs.toFixed(2).replace(/^0/, '') + 's';
      const fontSize = Math.round(size * 0.22);
      ctx.save();
      ctx.font = `bold ${fontSize}px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      const textY = y + fillH / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.70)'; ctx.fillText(label, x + size / 2 + 0.8, textY + 0.8);
      ctx.fillStyle = '#ffffff';            ctx.fillText(label, x + size / 2, textY);
      ctx.restore();
    }
  }

  ctx.restore();
}

export function drawEmptySlot(ctx, x, y, size, isDragSrc) {
  const cr = size * 0.16;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, size, size, cr); ctx.fillStyle = '#11151f'; ctx.fill();
  if (isDragSrc) {
    const pulse = 0.42 + 0.45 * Math.sin(performance.now() * 0.006);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = `rgba(255,255,255,${pulse})`; ctx.lineWidth = 2;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1.5;
  }
  ctx.beginPath(); ctx.roundRect(x, y, size, size, cr); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawIconOnly(ctx, x, y, size, typeId) {
  if (!typeId) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.drawImage(getIcon(typeId, Math.round(size * dpr)), x, y, size, size);
}

function drawSlotHighlight(ctx, x, y, size, mode) {
  const cr = size * 0.16;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, size, size, cr);
  if (mode === 'target') { ctx.strokeStyle = 'rgba(255,255,255,0.90)'; ctx.lineWidth = 2.5; ctx.stroke(); }
  else { ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fill(); }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover tracking
// ─────────────────────────────────────────────────────────────────────────────
let hoverSlot = -1;
let hoverRow  = 'top';

// ─────────────────────────────────────────────────────────────────────────────
// updateHotbar  — called every frame from renderer.js
// ─────────────────────────────────────────────────────────────────────────────
export function updateHotbar(ctx, W, H) {
  ensureOverlay();

  const bySlot = {};
  for (const p of petalInstances) {
    if (bySlot[p.slotIdx] === undefined) bySlot[p.slotIdx] = p;
  }

  // Use homescreen-specific sizes when in homescreen mode
  const slotSz  = homescreenMode ? HS_SLOT_SIZE    : SLOT_SIZE;
  const slotGp  = homescreenMode ? HS_SLOT_GAP     : SLOT_GAP;
  const benchSz = homescreenMode ? HS_BENCH_SIZE   : BENCH_SIZE;
  const benchGp = homescreenMode ? HS_BENCH_GAP    : BENCH_GAP;
  const benchRg = homescreenMode ? HS_BENCH_ROW_GAP : BENCH_ROW_GAP;

  const ox  = hbLeft(W), oy = hbTop(H);
  const bx  = benchLeft(W), by = benchTop(H);
  const now = performance.now();

  // Advance swap animations
  for (let i = swapAnims.length - 1; i >= 0; i--) {
    const sa = swapAnims[i];
    sa.t = Math.min(1, (now - sa.startTime) / SWAP_DUR);
    if (sa.t >= 1) swapAnims.splice(i, 1);
  }

  ctx.save();

  // ── Top (hotbar) row ────────────────────────────────────────────────────────
  for (let i = 0; i < hotbar.length; i++) {
    const sx        = ox + i * (slotSz + slotGp);
    const sy        = oy;
    const isDragSrc = drag.committed && drag.slotIdx === i && !drag.fromInv && !drag.fromBench;
    const typeId    = isDragSrc ? null : hotbar[i];
    const pt        = typeId ? PETAL_TYPES[typeId] : null;
    const p         = bySlot[i];
    const sa        = swapAnims.find(a => a.slotIdx === i);

    if (sa) {
      const ease = 1 - Math.pow(1 - sa.t, 3);
      const travel = benchRg + (slotSz + benchSz) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx - 4, Math.min(sy, benchTop(H)) - 4, slotSz + 8, benchRg + slotSz + benchSz + 8);
      ctx.clip();
      drawEmptySlot(ctx, sx, sy, slotSz, false);
      if (sa.topTypeId)   { ctx.globalAlpha = 1 - ease; drawPetalBox(ctx, sx, sy - travel * ease,          slotSz, sa.topTypeId,   0, 0); }
      if (sa.benchTypeId) { ctx.globalAlpha = ease;      drawPetalBox(ctx, sx, sy + travel * (1 - ease),   slotSz, sa.benchTypeId, 0, 0); }
      ctx.restore();
    } else if (!typeId) {
      drawEmptySlot(ctx, sx, sy, slotSz, isDragSrc);
    } else {
      const isReloading = p?.state === 'reloading' && pt;
      const reload   = isReloading ? 1 - p.reloadTimer / pt.reloadTime : 0;
      const reloadMs = isReloading ? p.reloadTimer : 0;
      drawPetalBox(ctx, sx, sy, slotSz, typeId, reload, 0, reloadMs, p?.hp ?? null, p?.maxHp ?? null);
    }

    if (drag.committed && hoverSlot === i && hoverRow === 'top' &&
        (drag.slotIdx !== i || drag.fromInv || drag.fromBench)) {
      drawSlotHighlight(ctx, sx, sy, slotSz, 'target');
    }
  }

  // ── Bench row ───────────────────────────────────────────────────────────────
  for (let i = 0; i < hotbar.length; i++) {
    const sx        = bx + i * (benchSz + benchGp);
    const sy        = by;
    const isDragSrc = drag.committed && drag.slotIdx === i && drag.fromBench;
    const typeId    = isDragSrc ? null : benchBar[i];
    const sa        = swapAnims.find(a => a.slotIdx === i);

    if (sa) {
      const ease = 1 - Math.pow(1 - sa.t, 3);
      const travel = benchRg + (slotSz + benchSz) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx - 4, Math.min(sy, hbTop(H)) - 4, benchSz + 8, benchRg + slotSz + benchSz + 8);
      ctx.clip();
      drawEmptySlot(ctx, sx, sy, benchSz, false);
      if (sa.benchTypeId) { ctx.globalAlpha = 1 - ease; drawPetalBox(ctx, sx, sy + travel * ease,        benchSz, sa.benchTypeId, 0, 0); }
      if (sa.topTypeId)   { ctx.globalAlpha = ease;      drawPetalBox(ctx, sx, sy - travel * (1 - ease), benchSz, sa.topTypeId,   0, 0); }
      ctx.restore();
    } else if (!typeId) {
      drawEmptySlot(ctx, sx, sy, benchSz, isDragSrc);
    } else {
      drawPetalBox(ctx, sx, sy, benchSz, typeId, 0, 0);
    }

    if (drag.committed && hoverSlot === i && hoverRow === 'bench' &&
        (drag.slotIdx !== i || !drag.fromBench)) {
      drawSlotHighlight(ctx, sx, sy, benchSz, 'target');
    }
  }

  ctx.restore();

  // ── Slot numbers under bench row ────────────────────────────────────────────
  if (!homescreenMode) {
    ctx.save();
    ctx.font = '700 11px "UbuntuCustom","Ubuntu",Arial,sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const numY = benchTop(H) + benchSz + 3;
    for (let i = 0; i < hotbar.length; i++) {
      const sx = benchLeft(W) + i * (benchSz + benchGp) + benchSz / 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth   = 2.5;
      ctx.strokeText(String(i + 1), sx, numY);
      ctx.fillStyle = 'rgba(255,255,255,0.80)';
      ctx.fillText(String(i + 1), sx, numY);
    }
    ctx.restore();
  }

  // ── Drag ghost ──────────────────────────────────────────────────────────────
  octx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (drag.committed && drag.typeId) {
    const wobble    = Math.sin(now * 0.010) * 0.10;
    const snapTop   = slotAtPoint(drag.x, drag.y, W, H);
    const snapBench = benchSlotAtPoint(drag.x, drag.y, W, H);
    const isSnapping = (drag.fromInv || drag.fromBench) && (snapTop !== -1 || snapBench !== -1);

    let targetX, targetY, targetSize;
    if (isSnapping) {
      const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
      const sg = homescreenMode ? HS_SLOT_GAP  : SLOT_GAP;
      const bs = homescreenMode ? HS_BENCH_SIZE : BENCH_SIZE;
      const bg = homescreenMode ? HS_BENCH_GAP  : BENCH_GAP;
      if (snapTop !== -1) { targetX = hbLeft(W) + snapTop * (ss + sg) + ss / 2; targetY = hbTop(H) + ss / 2; targetSize = ss; }
      else { targetX = benchLeft(W) + snapBench * (bs + bg) + bs / 2; targetY = benchTop(H) + bs / 2; targetSize = bs; }
    } else {
      const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
      targetX = drag.x; targetY = drag.y;
      targetSize = (drag.fromInv || drag.fromBench) ? invSlotCSS : ss + 10;
    }

    if (!ghostLerpInit) {
      const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
      ghostLerp.x = drag.x; ghostLerp.y = drag.y;
      ghostLerp.size = (drag.fromInv || drag.fromBench) ? invSlotCSS : ss + 10;
      ghostLerpInit = true;
    }
    const k = isSnapping ? 0.30 : 0.35;
    ghostLerp.x    += (targetX    - ghostLerp.x)    * k;
    ghostLerp.y    += (targetY    - ghostLerp.y)    * k;
    ghostLerp.size += (targetSize - ghostLerp.size) * k;

    const gs = ghostLerp.size;
    const gx = ghostLerp.x - gs / 2, gy = ghostLerp.y - gs / 2;
    const useWobble = (drag.fromInv || drag.fromBench) ? (isSnapping ? 0 : wobble) : wobble;

    octx.save(); octx.globalAlpha = 0.50;
    drawPetalBox(octx, gx, gy, gs, drag.typeId, 0, useWobble); octx.restore();
    octx.globalAlpha = 0.92; drawPetalBox(octx, gx, gy, gs, drag.typeId, 0, useWobble);
    octx.globalAlpha = 1;
  } else {
    ghostLerpInit = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Swap helper
// ─────────────────────────────────────────────────────────────────────────────
export function triggerSwap(slotIdx) {
  const existing = swapAnims.findIndex(a => a.slotIdx === slotIdx);
  if (existing !== -1) swapAnims.splice(existing, 1);
  swapAnims.push({ slotIdx, topTypeId: hotbar[slotIdx], benchTypeId: benchBar[slotIdx], startTime: performance.now(), t: 0 });
  hotbar[slotIdx]   = benchBar[slotIdx];
  benchBar[slotIdx] = swapAnims[swapAnims.length - 1].topTypeId;
  rebuildPetals();
}

// ─────────────────────────────────────────────────────────────────────────────
// Mouse event handlers
// ─────────────────────────────────────────────────────────────────────────────
export function onHotbarMouseMove(x, y, W, H) {
  drag.x = x; drag.y = y;
  const W_ = W || window.innerWidth, H_ = H || window.innerHeight;
  const topSlot   = slotAtPoint(x, y, W_, H_);
  const benchSlot = benchSlotAtPoint(x, y, W_, H_);

  if (topSlot !== -1)        { hoverSlot = topSlot;   hoverRow = 'top'; }
  else if (benchSlot !== -1) { hoverSlot = benchSlot; hoverRow = 'bench'; }
  else                       { hoverSlot = -1; }

  if (hoverSlot !== -1 && hoverRow === 'top' && hotbar[hoverSlot] && !drag.committed) {
    const ss = homescreenMode ? HS_SLOT_SIZE : SLOT_SIZE;
    const sg = homescreenMode ? HS_SLOT_GAP  : SLOT_GAP;
    const sx = hbLeft(W_) + hoverSlot * (ss + sg);
    setPetalHover(hotbar[hoverSlot], { x: sx, y: hbTop(H_), w: ss, h: ss });
  } else if (hoverSlot !== -1 && hoverRow === 'bench' && benchBar[hoverSlot] && !drag.committed) {
    const bs = homescreenMode ? HS_BENCH_SIZE : BENCH_SIZE;
    const bg = homescreenMode ? HS_BENCH_GAP  : BENCH_GAP;
    const sx = benchLeft(W_) + hoverSlot * (bs + bg);
    setPetalHover(benchBar[hoverSlot], { x: sx, y: benchTop(H_), w: bs, h: bs });
  } else if (!_inv.getHovering()) {
    setPetalHover(null, null);
  }

  if (drag.active && !drag.committed) {
    if (Math.hypot(x - drag.startX, y - drag.startY) > DRAG_THRESH) {
      drag.committed = true; ghostLerpInit = false;
      if (drag.fromInv) {
        const origSlot = _inv.getInvScroll()?.querySelector(`[data-type-id="${drag.typeId}"]`);
        if (origSlot) origSlot.style.visibility = 'hidden';
      }
    }
  }
}

export function onHotbarMouseDown(x, y, W, H) {
  const topSlot = slotAtPoint(x, y, W, H);
  if (topSlot !== -1 && hotbar[topSlot]) {
    Object.assign(drag, { active: true, committed: false, slotIdx: topSlot, fromInv: false, fromBench: false, typeId: hotbar[topSlot], x, y, startX: x, startY: y });
    return true;
  }
  const benchSlot = benchSlotAtPoint(x, y, W, H);
  if (benchSlot !== -1) {
    Object.assign(drag, { active: true, committed: false, slotIdx: benchSlot, fromInv: false, fromBench: true, typeId: benchBar[benchSlot], x, y, startX: x, startY: y });
    return true;
  }
  return false;
}

export function onHotbarMouseUp(x, y, W, H) {
  if (!drag.active) return;

  const wasCommitted = drag.committed, wasFromInv = drag.fromInv, wasFromBench = drag.fromBench;
  const typeId = drag.typeId, slotIdx = drag.slotIdx;
  Object.assign(drag, { active: false, committed: false, slotIdx: -1, fromInv: false, fromBench: false, typeId: null });

  if (!wasCommitted) {
    if (wasFromBench || (!wasFromInv && typeId)) triggerSwap(slotIdx);
    if (octx) octx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ghostLerpInit = false;
    return;
  }

  const targetTop   = slotAtPoint(x, y, W, H);
  const targetBench = benchSlotAtPoint(x, y, W, H);
  if (octx) octx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ghostLerpInit = false;

  _dragJustEnded = true;
  setTimeout(() => { _dragJustEnded = false; }, 50);

  if (wasFromInv) {
    const origSlot2 = _inv.getInvScroll()?.querySelector(`[data-type-id="${typeId}"]`);
    if (origSlot2) origSlot2.style.visibility = '';

    if (targetTop !== -1) {
      const displaced = hotbar[targetTop];
      removeFromInventory(typeId); hotbar[targetTop] = typeId;
      if (displaced) addToInventory(displaced);
      rebuildPetals(); _inv.setDirty(true); _inv.setAnimate(false);
    } else if (targetBench !== -1) {
      const displaced = benchBar[targetBench];
      removeFromInventory(typeId); benchBar[targetBench] = typeId;
      if (displaced) addToInventory(displaced);
      _inv.setDirty(true); _inv.setAnimate(false);
    }

  } else if (wasFromBench) {
    if (targetTop !== -1) {
      const displaced = hotbar[targetTop]; hotbar[targetTop] = typeId; benchBar[slotIdx] = displaced; rebuildPetals();
    } else if (targetBench !== -1 && targetBench !== slotIdx) {
      const tmp = benchBar[targetBench]; benchBar[targetBench] = benchBar[slotIdx]; benchBar[slotIdx] = tmp;
    } else if (targetTop === -1 && targetBench === -1) {
      benchBar[slotIdx] = null;
      _spinDropToInv(x, y, typeId, BENCH_SIZE);
    }

  } else {
    if (targetTop !== -1 && targetTop !== slotIdx) {
      const tmp = hotbar[targetTop]; hotbar[targetTop] = hotbar[slotIdx]; hotbar[slotIdx] = tmp; rebuildPetals();
    } else if (targetBench !== -1) {
      const displaced = benchBar[targetBench]; benchBar[targetBench] = hotbar[slotIdx]; hotbar[slotIdx] = displaced; rebuildPetals();
    } else if (targetTop === -1 && targetBench === -1) {
      hotbar[slotIdx] = null; rebuildPetals();
      _spinDropToInv(x, y, typeId, SLOT_SIZE);
    }
  }
}

/** Spin-shrink animation when a petal is dropped outside the hotbar/bench. */
function _spinDropToInv(dropX, dropY, typeId, gs) {
  const startTime = performance.now(), spinDur = 250;
  (function spinAnim(now) {
    const t = Math.min((now - startTime) / spinDur, 1);
    const ease = 1 - t * t, rot = t * Math.PI * 3.5;
    octx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (t < 1) {
      octx.save(); octx.globalAlpha = ease;
      octx.translate(dropX, dropY); octx.rotate(rot); octx.scale(ease, ease);
      drawPetalBox(octx, -gs / 2, -gs / 2, gs, typeId, 0, 0);
      octx.restore(); requestAnimationFrame(spinAnim);
    } else {
      octx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      addToInventory(typeId); _inv.setDirty(true); _inv.setAnimate(false);
      setTimeout(() => {
        _inv.render();
        requestAnimationFrame(() => {
          const el = _inv.getInvScroll()?.querySelector(`[data-type-id="${typeId}"]`);
          if (el) el.classList.add('returning');
        });
      }, 0);
    }
  })(performance.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// Keybind helpers
// ─────────────────────────────────────────────────────────────────────────────
export function onSwapKey(slotIdx) {
  if (slotIdx >= 0 && slotIdx < hotbar.length) triggerSwap(slotIdx);
}
export function onSwapAll() {
  for (let i = 0; i < hotbar.length; i++) triggerSwap(i);
}