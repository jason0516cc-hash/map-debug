// ── Petal Tooltip ─────────────────────────────────────────────────────────────
// Canvas-drawn tooltip shown when hovering hotbar slots or inventory slots.
// Matches the mob tooltip visual style: dark card, rarity-coloured outline.

import { PETAL_TYPES }                        from './petalTypes.js';
import { RARITY_BG, RARITY_BORDER, RARITY_TEXT } from './constants.js';
import { drawInventoryIcon }                  from './petalDrawing.js';

// ── State ─────────────────────────────────────────────────────────────────────
let hoveredTypeId = null;   // petal typeId currently hovered (null = none)
let hoveredRect   = null;   // { x, y, w, h } screen rect of the hovered slot
let lastRect      = null;   // last known rect, kept during fade-out so tooltip stays put
let tooltipAlpha  = 0;
let lastTypeId    = null;

const FADE_IN_MS  = 280;
const FADE_OUT_MS = 200;

// ── Public: call each frame to update hover state ────────────────────────────
let clearHoverTimeout = null;

export function setPetalHover(typeId, slotRect) {
  // Clear any existing timeout
  if (clearHoverTimeout) {
    clearTimeout(clearHoverTimeout);
    clearHoverTimeout = null;
  }
  
  if (typeId) {
    hoveredTypeId = typeId;
    hoveredRect   = slotRect;
    if (slotRect) lastRect = slotRect;
  } else {
    hoveredTypeId = null;
    hoveredRect   = null;
  }
}

// ── Layout constants ──────────────────────────────────────────────────────────
const PAD     = 13;
const RADIUS  = 9;
const MIN_W   = 170;
const MAX_W   = 300;
const LINE_H  = 15;


// ── Number formatting ─────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || n === undefined) return '—';
  n = +n;
  if (!isFinite(n)) return '—';
  if (n >= 1e9)  return (n / 1e9 ).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6)  return (n / 1e6 ).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4)  return (n / 1e3 ).toFixed(1).replace(/\.0$/, '') + 'k';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}

function fmtTime(ms) {
  if (!ms) return '—';
  const s = ms / 1000;
  return s.toFixed(s >= 10 ? 0 : 1) + 's';
}

// ── Word-wrap ─────────────────────────────────────────────────────────────────
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Collect stat rows for a petal type ───────────────────────────────────────
function getStatRows(pt) {
  const rows = [];

  // HP
  rows.push({ label: 'HP', value: fmt(pt.maxHp), color: '#6EE86E' });

  // Damage — only show if non-zero
  if (pt.damage > 0) {
    rows.push({ label: 'DMG', value: fmt(pt.damage), color: '#FF5555' });
  }

  // ── Special stats ────────────────────────────────────────────────────────
  if (pt.armor) {
    rows.push({ label: 'Armor', value: fmt(pt.armor), color: '#AAAAAA' });
  }
  if (pt.healAmount) {
    rows.push({ label: 'Heal', value: fmt(pt.healAmount) + ' HP', color: '#FF88BB' });
  }
  if (pt.poisonDps) {
    rows.push({ label: 'Poison', value: fmt(pt.poisonDps) + '/s', color: '#55CC44' });
  }
  if (pt.passiveHeal) {
    rows.push({ label: 'Regen', value: fmt(pt.passiveHeal) + '/s', color: '#88FFAA' });
  }
  if (pt.damageBlock) {
    rows.push({ label: 'Block', value: Math.round(pt.damageBlock * 100) + '%', color: '#FFCC44' });
  }
  if (pt.bodyDamage) {
    rows.push({ label: 'Body DMG', value: '+' + fmt(pt.bodyDamage), color: '#FF7744' });
  }
  if (pt.maxHpBonus) {
    rows.push({ label: 'Max HP +', value: fmt(pt.maxHpBonus), color: '#AAFFCC' });
  }
  if (pt.spinBonus) {
    rows.push({ label: 'Spin', value: '+' + (pt.spinBonus * 60).toFixed(1) + ' r/s', color: '#AACCFF' });
  }
  if (pt.pickupBonus) {
    rows.push({ label: 'Pickup', value: '+' + Math.round(pt.pickupBonus * 100) + '%', color: '#FFDDAA' });
  }
  if (pt.flatPickupBonus) {
    rows.push({ label: 'Pickup Range', value: '+' + pt.flatPickupBonus, color: '#FFDDAA' });
  }
  if (pt.walkSpeedBonus) {
    rows.push({ label: 'Speed +', value: fmt(pt.walkSpeedBonus), color: '#55AAFF' });
  }
  if (pt.expandBonus) {
    rows.push({ label: 'Expand +', value: fmt(pt.expandBonus), color: '#bb88ff' });
  }
  if (pt.slowFactor) {
    rows.push({ label: 'Slow', value: Math.round(pt.slowFactor * 100) + '%', color: '#AACFE0' });
  }
  if (pt.attractRange) {
    rows.push({ label: 'Lure range', value: fmt(pt.attractRange), color: '#FFAA44' });
  }
  if (pt.shieldAmount) {
    rows.push({ label: 'Shield', value: fmt(pt.shieldAmount), color: '#66CCFF' });
  }
  if (pt.passiveShield) {
    rows.push({ label: 'Shield Regen', value: fmt(pt.passiveShield) + '/s', color: '#88DDFF' });
  }
  if (pt.passiveHealBelowHalf) {
    rows.push({ label: 'Regen (<50% HP)', value: fmt(pt.passiveHealBelowHalf) + '/s', color: '#88FFAA' });
  }
  if (pt.healOnHit) {
    rows.push({ label: 'Heal on Hit', value: fmt(pt.healOnHit) + ' HP', color: '#FF88BB' });
  }
  if (pt.critChance) {
    rows.push({ label: 'Crit Chance', value: (pt.critChance * 100).toFixed(1) + '%', color: '#FFDD44' });
    rows.push({ label: 'Crit DMG', value: fmt(pt.critMultiplier) + '\u00d7', color: '#FFDD44' });
  }
  if (pt.bleedTickFraction) {
    rows.push({ label: 'Bleed', value: Math.round(pt.bleedTickFraction * 100) + '% / ' + (pt.bleedTickInterval/1000).toFixed(2) + 's', color: '#FF6644' });
  }
  if (pt.knockbackStrength) {
    rows.push({ label: 'Knockback', value: fmt(Math.round(pt.knockbackStrength)), color: '#CCAAFF' });
  }
  if (pt.explosionRadius) {
    rows.push({ label: 'Blast Radius', value: fmt(pt.explosionRadius), color: '#FF9955' });
  }
  if (pt.selfDamageOnHit) {
    rows.push({ label: 'Self DMG', value: fmt(Math.round(pt.selfDamageOnHit * 10) / 10), color: '#CC3333' });
  }
  if (pt.passiveDamage) {
    rows.push({ label: 'Self DMG', value: fmt(Math.round(pt.passiveDamage * 10) / 10) + '/s', color: '#CC3333' });
  }
  if (pt.onHitDamage) {
    rows.push({ label: 'Bonus DMG', value: '+' + fmt(Math.round(pt.onHitDamage * 10) / 10), color: '#FF5555' });
  }
  if (pt.chainCap) {
    rows.push({ label: 'Chain', value: fmt(pt.chainCap) + ' mobs', color: '#5ec8ff' });
  }
  if (pt.reflectPercent) {
    rows.push({ label: 'Reflect', value: fmt(pt.reflectPercent) + '%', color: '#f4f4f4' });
  }
  if (pt.sizeBonus) {
    rows.push({ label: 'Size +', value: '+' + Math.round(pt.sizeBonus * 100) + '%', color: '#e8f4f8' });
  }
  if (pt.isSpongeAbsorb) {
    rows.push({ label: 'Spread Window', value: (pt.spongeWindowMs/1000).toFixed(0) + 's', color: '#c4945c' });
  }
  if (pt.isInkPool) {
    rows.push({ label: 'Pool Slow', value: Math.round(pt.inkSlowFactor * 100) + '%', color: '#26262e' });
    rows.push({ label: 'Pool Duration', value: (pt.inkPoolDuration/1000).toFixed(0) + 's', color: '#26262e' });
  }

  return rows;
}

// ── Measure card ──────────────────────────────────────────────────────────────
function measureCard(ctx, pt, statRows, descLines) {
  const font13 = '13px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  const fontB  = 'bold 13px "UbuntuCustom","Ubuntu",Arial,sans-serif';

  ctx.font = 'bold 15px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  const nameW = ctx.measureText(pt.name).width;

  ctx.font = font13;
  let reloadLabel = '';
  if (!pt.isAccessory) {
    if (pt.isAntEgg || pt.isBeeEgg || pt.isDiggerEgg) {
      reloadLabel = `1s + ${(pt.hatchTime / 1000).toFixed(0)}s hatch`;
    } else {
      reloadLabel = pt.cooldownText || fmtTime(pt.reloadTime);
    }
  }
  const reloadW = reloadLabel ? ctx.measureText(reloadLabel).width : 0;

  let maxDescW = 0;
  if (descLines.length) {
    ctx.font = '11px "UbuntuCustom","Ubuntu",Arial,sans-serif';
    for (const l of descLines) {
      const w = ctx.measureText(l).width;
      if (w > maxDescW) maxDescW = w;
    }
  }

  ctx.font = fontB;
  const rarW = ctx.measureText(pt.rarity).width;

  const contentW = Math.max(nameW + reloadW + 20, maxDescW, rarW);
  const cw = Math.min(MAX_W, Math.max(MIN_W, contentW + PAD * 2));

  // Height
  let h = PAD;
  h += 20;                    // name + reload line
  h += 15;                    // rarity name under petal name
  if (descLines.length) {
    h += descLines.length * LINE_H;
  }
  h += 8;                     // gap before separator
  h += 2;                     // separator line
  h += 8;                     // gap after separator
  h += statRows.length * 19;  // stat rows
  h += PAD;

  return { cw, ch: h };
}

// ── Main draw ─────────────────────────────────────────────────────────────────
export function drawPetalTooltip(ctx, W, H, dt = 16) {
  // Fade
  if (hoveredTypeId) {
    if (hoveredTypeId !== lastTypeId) lastTypeId = hoveredTypeId;
    tooltipAlpha = Math.min(1, tooltipAlpha + dt / FADE_IN_MS);
  } else {
    tooltipAlpha = Math.max(0, tooltipAlpha - dt / FADE_OUT_MS);
  }
  if (tooltipAlpha <= 0) return;

  // Use last known typeId during fade-out
  const typeId = hoveredTypeId || lastTypeId;
  if (!typeId) return;

  const pt = PETAL_TYPES[typeId];
  if (!pt) return;

  const statRows  = getStatRows(pt);
  const innerW    = MAX_W - PAD * 2;

  // Pre-measure description
  ctx.font = '11px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  const descLines = pt.description ? wrapText(ctx, pt.description, innerW) : [];

  const { cw, ch } = measureCard(ctx, pt, statRows, descLines);

  // ── Position ─────────────────────────────────────────────────────────────
  let tx, ty;
  const OFFSET = 15;

  if (hoveredRect) {
    // Inventory slots are identified by w === 0 (panel-right anchor, no width)
    // Hotbar slots pass their full rect with w = SLOT_SIZE
    const isInventorySlot = hoveredRect.w === 0;

    if (isInventorySlot) {
      // Show to the right of the inventory panel
      tx = hoveredRect.x + OFFSET;
      ty = hoveredRect.y + hoveredRect.h / 2 - ch / 2;
      // Clamp vertically
      if (ty < 8) ty = 8;
      if (ty + ch > H - 8) ty = H - 8 - ch;
    } else {
      // Hotbar: prefer above the slot
      tx = hoveredRect.x + hoveredRect.w / 2 - cw / 2;
      ty = hoveredRect.y - ch - OFFSET;
      if (ty < 8) {
        // Try below
        ty = hoveredRect.y + hoveredRect.h + OFFSET;
      }
      if (ty + ch > H - 8) {
        // Fall back above (clamp)
        ty = 8;
      }
      // Horizontal bounds
      if (tx + cw > W - 8) tx = W - 8 - cw;
      if (tx < 8)          tx = 8;
    }
  } else {
    // Fade-out: use last known position so tooltip doesn't jump to center
    const r = lastRect;
    if (r) {
      const isInventorySlot = r.w === 0;
      if (isInventorySlot) {
        tx = r.x + OFFSET;
        ty = r.y + r.h / 2 - ch / 2;
        if (ty < 8) ty = 8;
        if (ty + ch > H - 8) ty = H - 8 - ch;
      } else {
        tx = r.x + r.w / 2 - cw / 2;
        ty = r.y - ch - OFFSET;
        if (ty < 8) ty = r.y + r.h + OFFSET;
        if (ty + ch > H - 8) ty = 8;
        if (tx + cw > W - 8) tx = W - 8 - cw;
        if (tx < 8) tx = 8;
      }
    } else {
      tx = W / 2 - cw / 2;
      ty = H / 2 - ch / 2;
    }
  }

  
  // ── Draw ─────────────────────────────────────────────────────────────────
  ctx.save();
  ctx.globalAlpha = tooltipAlpha;

  // Background
  ctx.beginPath();
  ctx.roundRect(tx, ty, cw, ch, RADIUS);
  ctx.fillStyle = 'rgba(8,10,20,0.95)';
  ctx.fill();

  // Rarity border
  const borderColor = RARITY_BORDER[pt.rarity] || '#444';
  ctx.beginPath();
  ctx.roundRect(tx, ty, cw, ch, RADIUS);
  if (pt.rarity === 'Impracticality') {
    const g = ctx.createLinearGradient(tx, ty, tx + cw, ty + ch);
    g.addColorStop(0.00, '#ff0000'); g.addColorStop(0.17, '#ff8800');
    g.addColorStop(0.33, '#ffff00'); g.addColorStop(0.50, '#00cc44');
    g.addColorStop(0.67, '#0088ff'); g.addColorStop(0.83, '#8800ff');
    g.addColorStop(1.00, '#ff00cc');
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = borderColor;
  }
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner subtle highlight
  ctx.beginPath();
  ctx.roundRect(tx + 2, ty + 2, cw - 4, ch - 4, RADIUS * 0.7);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Content ───────────────────────────────────────────────────────────────
  const lx  = tx + PAD;
  const rx  = tx + cw - PAD;
  let   ly  = ty + PAD;

  // Name and reload on same line
  ctx.font         = 'bold 15px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.fillText(pt.name, lx, ly);

  // Reload on the right — omit for accessories, smart text for eggs
  if (!pt.isAccessory) {
    let reloadLabel;
    if (pt.isAntEgg || pt.isBeeEgg || pt.isDiggerEgg) {
      const hatchSec = (pt.hatchTime / 1000).toFixed(0);
      reloadLabel = `1s + ${hatchSec}s hatch`;
    } else {
      reloadLabel = pt.cooldownText || fmtTime(pt.reloadTime);
    }
    ctx.font      = '13px "UbuntuCustom","Ubuntu",Arial,sans-serif';
    ctx.fillStyle = '#55AAFF';
    ctx.textAlign = 'right';
    ctx.fillText(reloadLabel, rx, ly);
  }
  ly += 20;

  // Rarity name under petal name — bold 13px matching mob tooltip style
  ctx.font      = 'bold 13px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  ctx.textAlign = 'left';
  if (pt.rarity === 'Impracticality') {
    const rg = ctx.createLinearGradient(lx, ly, lx + 130, ly);
    rg.addColorStop(0.0, '#ff0000'); rg.addColorStop(0.2, '#ff8800');
    rg.addColorStop(0.4, '#ffff00'); rg.addColorStop(0.6, '#00cc44');
    rg.addColorStop(0.8, '#0088ff'); rg.addColorStop(1.0, '#ff00cc');
    ctx.fillStyle = rg;
  } else {
    ctx.fillStyle = RARITY_TEXT[pt.rarity] || '#ffffff';
  }
  ctx.fillText(pt.rarity, lx, ly);
  ly += 15;

  // Description
  if (descLines.length > 0) {
    ctx.font      = '11px "UbuntuCustom","Ubuntu",Arial,sans-serif';
    ctx.fillStyle = 'rgba(200,200,220,0.72)';
    ctx.textAlign = 'left';
    for (const line of descLines) {
      ctx.fillText(line, lx, ly);
      ly += LINE_H;
    }
  }

  // Separator line
  ly += 8;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ly);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ly += 10;

  // Stat rows
  ctx.font = '13px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  for (const row of statRows) {
    ctx.fillStyle = row.color;
    ctx.textAlign = 'left';
    ctx.fillText(row.label + ':', lx, ly);
    ctx.fillStyle = '#e0e0e0';
    ctx.textAlign = 'right';
    ctx.fillText(row.value, rx, ly);
    ly += 19;
  }


  ctx.restore();
}
