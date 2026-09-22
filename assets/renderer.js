import { toScreen, petalOrigin, zoomState } from './camera.js';
import { player, isMoving }              from './player.js';
import { levelHUD }                      from './LevelHUD.js';
import { petalInstances, currentOrbitR, orbitAngle, hotbar } from './petals.js';
import { PETAL_TYPES }                  from './petalTypes.js';
import { mobs, missiles, bossStingers, bossPeas, bossRoses, queenBeeEggs, queenBeePollenOrbit, getPetLeashDist, jellyfishBolts, explosionEffects, popEffects }               from './mobs.js';
import { worldDrops, webFields, pollenEntities, honeycombEntities, missileEntities, SPAWN_DUR } from './drops.js';
import { drawMap, getActiveBiome, getGridW, getGridH, isOpenTile, getMapW, getMapH } from './map.js';
import { drawMob, drawSpider, drawBee, drawQueenBee, drawLadybug, drawCentipedeHead, drawCentipedeBody, drawHornet, drawMissile,
         drawSoldierAnt, drawWorkerAnt, drawBabyAnt, drawQueenAnt, drawAntEgg, drawAntHole, drawDigger, drawBeekeeper, drawHive,
         drawDesertCentipedeHead, drawDesertCentipedeBody, drawBeetle, drawSandstorm, drawCactus, drawRock, drawDandelion,
         drawFireSoldierAnt, drawFireWorkerAnt, drawFireBabyAnt, drawFireQueenAnt, drawFireAntEgg, drawFireAntHole,
         drawScorpion, drawPyramid, drawMummifiedBeetle,
         drawJellyfish, drawSquid, drawAlligator, drawCrab, drawStarfish, drawShell, drawSponge,
         drawBubble, drawSeaCave, drawDebris, drawLeechPose, applyMobIconOverride,
         soldierAntOffsetX } from './mobDrawing.js';
import { updateHotbar, updateInventory, updateSettingsCog } from './uiManager.js';
import { drawPetalShape, drawPieceShape, drawThirdEyeAccessory, drawInventoryIcon } from './petalDrawing.js';
import { RARITY_COLORS, RARITY_BG, RARITY_BORDER, RARITY_TEXT, rarityTier } from './constants.js';
import { inputState }                   from './inputState.js';
import { wingState }                    from './wingState.js';
import { drawMobTooltip }               from './mobTooltip.js';
import { drawPetalTooltip }              from './petalTooltip.js';
import { drawDamagePopups } from './damagePopups.js';
import { settings } from './settings.js';

const GRID = 60;

// Reusable offscreen canvas for damage flash — avoids per-frame allocation
const _flashCanvas = document.createElement('canvas');

// ── Hitbox debug overlay ──────────────────────────────────────────────────────
export let showHitboxes = false;
export let cutterRot = 0;
let cutterSpeed = 0.0012;     // current rotation speed per ms
const CUTTER_DEFAULT_SPEED = 0.0012;  // default speed when not attacking
const CUTTER_MAX_SPEED = 0.005;       // max speed when attacking
const CUTTER_ACCEL = 0.000008;        // acceleration when starting attack
const CUTTER_DECEL = 0.000003;        // deceleration when stopping attack

// ── Petal animation state ─────────────────────────────────────────────────────
let diggerEggRot = 0;                  // cutter ring rotation (rad)
const DIGGER_EGG_ROT_SPEED = 0.0018;  // rad/ms

let wingRot = 0;                       // wing spin angle (rad)
const WING_SPIN_SPEED  = 0.004;      // rad/ms — moderate continuous 360° spin
const WING_EXTRA_R     = 84;          // game-units pushed outward during attack (matches petals.js)

window.addEventListener('keydown', e => { if (e.key === 'F' || e.key === 'f') showHitboxes = !showHitboxes; });

// ── Petal death pop effects ────────────────────────────────────────────────────
// Each entry: { sx, sy, r, age }  (screen-space, age 0→1)
const petalDeathPops = [];

/** Call once when player dies — captures current petal screen positions */
export function triggerPetalDeathPops(W, H) {
  for (const p of petalInstances) {
    const sx = p.worldX != null ? toScreen(p.worldX, p.worldY, W, H).sx : W / 2;
    const sy = p.worldX != null ? toScreen(p.worldX, p.worldY, W, H).sy : H / 2;
    const r  = (p.radius ?? 10) * zoomState.v * 2.2;
    petalDeathPops.push({ sx, sy, r, age: 0 });
  }
}

/** Reset pop effects (call on respawn) */
export function clearPetalDeathPops() { petalDeathPops.length = 0; }

// Track whether death was already processed this session
export let _playerWasDead = false;
export function setPlayerWasDead(v) { _playerWasDead = v; }

// ── Low-level helpers ─────────────────────────────────────────────────────────
export function circle(ctx, sx, sy, r, fill, stroke, lw = 2.5, zoomScale = 1) {
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle   = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = lw * zoomScale;
  ctx.stroke();
}

// Abbreviate numbers >= 10 000
function abbrev(n) {
  n = Math.max(0, Math.floor(n));
  if (n >= 1_000_000_000_000_000) return (n / 1_000_000_000_000_000).toFixed(1).replace(/\.0$/, '') + 'Q';
  if (n >= 1_000_000_000_000)     return (n / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')     + 'T';
  if (n >= 1_000_000_000)         return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')         + 'B';
  if (n >= 1_000_000)             return (n / 1_000_000).toFixed(1).replace(/\.0$/, '')             + 'M';
  if (n >= 10_000)                return (n / 1_000).toFixed(1).replace(/\.0$/, '')                 + 'k';
  return String(n);
}

// ── Entity label + HP pill ────────────────────────────────────────────────────
// Base sizes at zoomState.v=1. Everything multiplies by zoomState.v so the label
// scales with the world exactly like the entity body does.
const PILL_W  = 64;
const PILL_H  = 12;
const NAME_SZ = 11;
const HP_SZ   = 8;
const RAR_SZ  = 10;
const GAP     = 2;

function drawEntityLabel(ctx, sx, sy, scaledR, name, hp, maxHp, rarity, rarityColor, isBoss = false, shield = 0, maxShield = 0, isPlayer = false) {
  // Raw world radius of the entity
  const radius = scaledR / zoomState.v;

  // Scale factor: grows with mob size and zoomState.v, but both dampened via sqrt
  // so a 4x bigger mob → 2x bigger bar, and 4x zoomState.v → 2x bigger bar.
  // Base radius of 22 (player) = scale 1.0 at zoomState.v 1.
  const BASE_R = 22;
  const s = Math.sqrt(radius / BASE_R) * Math.sqrt(zoomState.v);

  const pw     = PILL_W  * s;
  const ph     = PILL_H  * s;
  const pr     = ph / 2;
  const gap    = GAP     * s;
  const nameSz = NAME_SZ * s;
  const hpSz   = HP_SZ   * s;
  const rarSz  = RAR_SZ  * s;

  const hpRatio = Math.max(0, Math.min(1, hp / maxHp));
  const hpFill  = hpRatio > 0.5
    ? 'rgba(30, 210, 90, 0.90)'
    : hpRatio > 0.25
    ? 'rgba(220, 175, 0, 0.90)'
    : 'rgba(215, 45, 45, 0.90)';

  ctx.save();

  let y = sy + scaledR + 4 * s;

  // ── Name ──────────────────────────────────────────────────────────────────
  ctx.font         = `bold ${nameSz}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
  ctx.lineWidth    = nameSz * 0.22;
  ctx.lineJoin     = 'round';
  ctx.strokeText(name, sx, y);
  ctx.fillStyle    = '#ffffff';
  ctx.fillText(name, sx, y);

  // ── HP pill ───────────────────────────────────────────────────────────────
  y += nameSz + gap;
  const px = sx - pw / 2;
  const py = y;

  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, pr);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();

  if (hpRatio > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, pr);
    ctx.clip();
    ctx.fillStyle = hpFill;
    ctx.fillRect(px, py, pw * hpRatio, ph);
    ctx.restore();
  }

  // ── Shield overlay — clear/translucent gray layered on top of the HP
  // fill, same treatment as LevelHUD's own shield overlay in the top-left
  // HUD (see _drawShieldOverlay there) — covers the same fraction of the
  // bar as shield/maxShield, sitting visually in front of HP since it
  // absorbs damage first. Only the player ever passes a nonzero maxShield
  // here (mobs/NPCs call this with the defaults, so they're unaffected).
  if (maxShield > 0) {
    const shieldRatio = Math.max(0, Math.min(1, shield / maxShield));
    if (shieldRatio > 0.001) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, pr);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(px, py, pw * shieldRatio, ph);
      ctx.restore();
    }
  }

  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, pr);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth   = s * 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, pr);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = s * 0.6;
  ctx.stroke();

  ctx.font         = `bold ${hpSz}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  // Player: "X + X" (hp + shield) when a shield source is equipped, or just
  // "X" when there's none — per instruction, no maxHP shown in this format.
  // Mobs/NPCs keep the normal "hp/maxHp" format (they never pass isPlayer).
  const hpText = isPlayer
    ? (maxShield > 0 ? `${abbrev(hp)} + ${abbrev(shield)}` : `${abbrev(hp)}`)
    : `${abbrev(hp)}/${abbrev(maxHp)}`;
  ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
  ctx.lineWidth    = hpSz * 0.25;
  ctx.lineJoin     = 'round';
  ctx.strokeText(hpText, sx, py + ph / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(hpText, sx, py + ph / 2);

  // ── Rarity (mobs only) ────────────────────────────────────────────────────
  if (rarity && rarityColor) {
    y += ph + gap;
    ctx.font         = `bold ${rarSz}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin     = 'round';
    if (isBoss) {
      // Draw "Boss " in red then rarity name in rarity color
      const bossLabel  = 'Boss ';
      const rarLabel   = rarity;
      const bossW      = ctx.measureText(bossLabel).width;
      const rarW       = ctx.measureText(rarLabel).width;
      const totalW     = bossW + rarW;
      const startX     = sx - totalW / 2;
      ctx.textAlign    = 'left';
      // Outline pass
      ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
      ctx.lineWidth    = rarSz * 0.22;
      ctx.strokeText(bossLabel, startX, y);
      ctx.strokeText(rarLabel,  startX + bossW, y);
      // Color pass
      ctx.fillStyle    = '#ff3333';
      ctx.fillText(bossLabel, startX, y);
      ctx.fillStyle    = rarityColor;
      ctx.fillText(rarLabel,  startX + bossW, y);
      ctx.textAlign    = 'center';
    } else {
      ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
      ctx.lineWidth    = rarSz * 0.22;
      ctx.strokeText(rarity, sx, y);
      ctx.fillStyle    = rarityColor;
      ctx.fillText(rarity, sx, y);
    }
  }

  ctx.restore();
}

// ── Drop icon cache (same system as hotbar icon cache) ────────────────────────
const dropIconCache = new Map();

function getDropIcon(typeId, physSize) {
  const key = `${typeId}__${physSize}`;
  if (dropIconCache.has(key)) return dropIconCache.get(key);
  const cv  = document.createElement('canvas');
  cv.width  = physSize;
  cv.height = physSize;
  drawInventoryIcon(cv, typeId);
  dropIconCache.set(key, cv);
  return cv;
}

// ── Drop rendering ────────────────────────────────────────────────────────────

function drawDrops(ctx, W, H) {
  const dpr = window.devicePixelRatio || 1;

  for (const drop of worldDrops) {
    const pt = PETAL_TYPES[drop.typeId];
    if (!pt) continue;

    // Full world-space position (ox/oy are world offsets) → screen
    const { sx, sy } = toScreen(drop.x + drop.ox, drop.y + drop.oy, W, H);

    // Size scales with zoomState.v like every other world object, plus gentle pulse
    const pulse = 1 + 0.07 * Math.sin(drop.bobTimer);
    const sz    = drop.size * zoomState.v * pulse;
    const cr    = sz * 0.18;

    const bg  = RARITY_BG[pt.rarity]     || '#1d55cc';
    const brd = RARITY_BORDER[pt.rarity] || '#0a2a70';

    // Spawn pop-in (back-elastic scale)
    const t  = Math.min(1, drop.spawnTimer / SPAWN_DUR);
    const c1 = 1.70158, c3 = c1 + 1;
    const spawnScale = t >= 1 ? 1
      : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    const spinExtra = (1 - t) * Math.PI * 3;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(drop.rotation + spinExtra);
    ctx.scale(spawnScale, spawnScale);

    const hx = -sz / 2;
    const hy = -sz / 2;

    // ── Box fill — identical two-pass style to hotbar/inv/mob-HUD ────────────
    if (pt.rarity === 'Impracticality') {
      const grad = ctx.createLinearGradient(hx, hy, hx + sz, hy + sz);
      grad.addColorStop(0.00, '#ff0000'); grad.addColorStop(0.17, '#ff8800');
      grad.addColorStop(0.33, '#ffff00'); grad.addColorStop(0.50, '#00cc44');
      grad.addColorStop(0.67, '#0088ff'); grad.addColorStop(0.83, '#8800ff');
      grad.addColorStop(1.00, '#ff00cc');
      ctx.beginPath();
      ctx.roundRect(hx, hy, sz, sz, cr);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(hx, hy, sz, sz, cr);
      ctx.fillStyle = '#0d1020';
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(hx, hy, sz, sz, cr);
      ctx.fillStyle    = bg;
      ctx.globalAlpha *= 0.42;
      ctx.fill();
      ctx.globalAlpha /= 0.42;
    }

    // Border
    ctx.beginPath();
    ctx.roundRect(hx, hy, sz, sz, cr);
    ctx.strokeStyle = brd || '#3a3f5a';
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Inner highlight
    ctx.beginPath();
    ctx.roundRect(hx + 2.5, hy + 2.5, sz - 5, sz - 5, cr * 0.65);
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Skip drawing if too small to render (prevents negative-radius arc errors)
    if (sz < 8) { ctx.restore(); continue; }

    // ── Petal icon — round to nearest 4px so cache stays small ──────────────
    const physSize = Math.round(sz * dpr / 4) * 4;
    const icon     = getDropIcon(drop.typeId, Math.max(4, physSize));
    ctx.drawImage(icon, hx, hy, sz, sz);

    ctx.restore();
  }
}


function drawMissileEntities(ctx, W, H) {
  for (const me of missileEntities) {
    if (me.dead) continue;
    const { sx, sy } = toScreen(me.x, me.y, W, H);
    const r = me.radius * zoomState.v;
    ctx.save();
    ctx._missileAngle = me.flyAngle - Math.PI / 2;
    drawPetalShape(ctx, me.typeId, sx, sy, r);
    ctx.restore();
  }
}

function drawPollenEntities(ctx, W, H) {
  for (const pe of pollenEntities) {
    if (pe.dead) continue;
    const { sx, sy } = toScreen(pe.x, pe.y, W, H);
    const baseR = pe.radius * zoomState.v;

    // Pop scale: briefly grow when spawned, slightly pop-out when expiring
    const age     = pe.maxTimer - pe.timer; // ms since spawn (need maxTimer stored)
    const popIn   = Math.min(1, age / 120);           // quick scale-in over 120ms
    const popOut  = pe.timer < 300
      ? 1 + (1 - pe.timer / 300) * 0.35              // swell 35% in last 300ms
      : 1;
    const r = baseR * (0.5 + 0.5 * popIn) * popOut;

    // Fade only at the very end (last 80ms) for a sharp pop-then-vanish
    const alpha = pe.timer < 80 ? pe.timer / 80 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Body
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle   = '#d8e786';
    ctx.fill();
    ctx.strokeStyle = '#9aa83d';
    ctx.lineWidth   = Math.max(1.5, r * 0.18);
    ctx.stroke();

    // Small inner highlight
    ctx.beginPath();
    ctx.arc(sx - r * 0.25, sy - r * 0.25, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fill();

    ctx.restore();
  }
}


function drawHoneycombEntities(ctx, W, H) {
  for (const hc of honeycombEntities) {
    if (hc.dead) continue;
    const { sx, sy } = toScreen(hc.x, hc.y, W, H);
    const r = hc.radius * zoomState.v;

    // Fade out in the last 2s of its 10s life
    const alpha = Math.min(1, hc.timer / 2000);
    ctx.save();
    ctx.globalAlpha = alpha;

    // Draw attract range ring (subtle, desaturated)
    const rangeR = hc.attractRange * zoomState.v;
    ctx.beginPath();
    ctx.arc(sx, sy, rangeR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 186, 4, 0.12)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Shadow / glow base
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 130, 0, 0.35)';
    ctx.fill();

    // Hexagon body (honeycomb shape approximated as filled hex)
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = sx + Math.cos(a) * r;
      const py = sy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle   = '#ffba04';
    ctx.fill();
    ctx.strokeStyle = '#9a6200';
    ctx.lineWidth   = Math.max(1.5, r * 0.12);
    ctx.stroke();

    // Inner cell grid lines
    ctx.strokeStyle = 'rgba(154, 98, 0, 0.5)';
    ctx.lineWidth   = Math.max(0.8, r * 0.06);
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * r * 0.9, sy + Math.sin(a) * r * 0.9);
      ctx.stroke();
    }

    // HP bar
    const barW = r * 2.2;
    const barH = Math.max(3, r * 0.22);
    const barX = sx - barW / 2;
    const barY = sy - r * 1.6;
    const hpFrac = Math.max(0, hc.hp / hc.maxHp);
    ctx.beginPath();
    ctx.rect(barX, barY, barW, barH);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.rect(barX, barY, barW * hpFrac, barH);
    ctx.fillStyle = hpFrac > 0.5 ? '#2ecc40' : hpFrac > 0.2 ? '#ffdc00' : '#ff4136';
    ctx.fill();

    ctx.restore();
  }
}

function drawWebFields(ctx, W, H) {
  for (const web of webFields) {
    const { sx, sy } = toScreen(web.x, web.y, W, H);
    const alpha = Math.max(0, web.timer / (web.maxTimer ?? 5000)) * 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(sx, sy, web.radius * zoomState.v, 0, Math.PI * 2);
    ctx.fillStyle = '#82c2e8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,230,0.9)';
    ctx.lineWidth = 2 * zoomState.v;
    ctx.stroke();
    ctx.restore();
  }
}

// ── World-space petal rendering ───────────────────────────────────────────────
function drawPetalsWorld(ctx, W, H, dt) {
  if (petalInstances.length === 0) return;

  // Orbit ring — visual guide, always 1 ring regardless of piece count
  const { sx: ox, sy: oy } = toScreen(petalOrigin.x, petalOrigin.y, W, H);
  ctx.beginPath();
  ctx.arc(ox, oy, currentOrbitR * zoomState.v, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = zoomState.v;
  ctx.stroke();

  // ── Ant egg leash range overlay (shown when F / hitbox-debug is on) ───────
  if (showHitboxes) {
    // Mirror the formula from getPetLeashDist in mobs.js:
    //   RADIUS_SCALE per tier → antBaseRadius = 20 * scale → leash = max(900, antR * 9)
    const RENDERER_RADIUS_SCALE = [1.2,1.0,1.2,1.83,3.0,5.96,14.55,22.73,30.0,40.0,55.0,75.0,100.0,140.0];
    const leashTiers = new Set();
    for (const p of petalInstances) {
      if (PETAL_TYPES[p.typeId]?.isAntEgg) leashTiers.add(Math.max(0, Math.min(13, PETAL_TYPES[p.typeId].tier ?? 0)));
    }
    if (leashTiers.size > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2.5;
      for (const tier of leashTiers) {
        const leashDist = getPetLeashDist(tier);
        const leashR = leashDist * zoomState.v;
        ctx.beginPath();
        ctx.arc(ox, oy, leashR, 0, Math.PI * 2);
        // Blue tint that deepens slightly with tier
        const b = Math.round(220 - tier * 6);
        ctx.strokeStyle = `rgba(40,100,${b},0.65)`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Digger egg leash range overlay (same F toggle) ─────────────────────────
    const diggerLeashTiers = new Set();
    for (const p of petalInstances) {
      if (PETAL_TYPES[p.typeId]?.isDiggerEgg) diggerLeashTiers.add(Math.max(0, Math.min(13, PETAL_TYPES[p.typeId].tier ?? 0)));
    }
    if (diggerLeashTiers.size > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2.5;
      for (const tier of diggerLeashTiers) {
        const leashDist = getPetLeashDist(tier);
        const leashR = leashDist * zoomState.v;
        ctx.beginPath();
        ctx.arc(ox, oy, leashR, 0, Math.PI * 2);
        // Gray tint matching digger body color
        const v = Math.round(160 - tier * 5);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.70)`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Bee egg leash range overlay (same F toggle) ──────────────────────────
    const beeLeashTiers = new Set();
    for (const p of petalInstances) {
      if (PETAL_TYPES[p.typeId]?.isBeeEgg) beeLeashTiers.add(Math.max(0, Math.min(13, PETAL_TYPES[p.typeId].tier ?? 0)));
    }
    if (beeLeashTiers.size > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2.5;
      for (const tier of beeLeashTiers) {
        const leashDist = getPetLeashDist(tier);
        const leashR = leashDist * zoomState.v;
        ctx.beginPath();
        ctx.arc(ox, oy, leashR, 0, Math.PI * 2);
        // Amber tint that deepens with tier — matches bee colour
        const g = Math.round(160 - tier * 5);
        ctx.strokeStyle = `rgba(220,${g},20,0.65)`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  for (const p of petalInstances) {
    // Use the world position already computed by updatePetals (includes cluster offset)
    const { sx, sy } = toScreen(p.worldX, p.worldY, W, H);
    // Blood Corn/Leaf/Wing: visual-only size growth as their damage ramps up
    // (bloodVisualScale is computed in combat.js, capped at 1.6x — does not
    // affect the real hitbox, which stays at p.radius the whole time).
    // Ink: once placed, the pool's actual radius (inkCurRadius, tracking its
    // real slow/poison area from combat.js) IS the draw size — it's not a
    // small cosmetic multiplier like Blood's, the drawn pool should visually
    // match exactly how far its effect currently reaches.
    const displayR = p.inkCurRadius != null
      ? p.inkCurRadius * zoomState.v
      : p.radius * (p.bloodVisualScale ?? 1) * zoomState.v;

    // Choose draw function: piece-petals draw a single circle; normal petals
    // draw their full shape (cluster icons remain correct in inventory).
    const drawFn = p.isPiece
      ? (c, t, x, y, r) => drawPieceShape(c, t, x, y, r)
      : (c, t, x, y, r) => drawPetalShape(c, t, x, y, r);

    // ── Per-type animation — set ctx props, compute visual draw position ──────
    let drawSx = sx, drawSy = sy;
    const outAngle = Math.atan2(p.worldY - petalOrigin.y, p.worldX - petalOrigin.x);
    ctx._diggerEggRot = undefined;
    ctx._missileAngle = undefined;
    ctx._magnetAngle  = undefined;
    ctx._wingRot      = undefined;
    ctx._stingerAngle = undefined;
    const _pt_draw = PETAL_TYPES[p.typeId];
    switch (p.typeId) {
      case 'digger_egg':
        ctx._diggerEggRot = diggerEggRot;
        break;
      case 'magnet':
        // open end of horseshoe points outward
        ctx._magnetAngle = outAngle + Math.PI / 2;
        break;
      default:
        if (_pt_draw?.isMissilePetal) {
          // When flying: tip points in direction of travel
          // When orbiting: tip points outward from player
          ctx._missileAngle = (p.state === 'flying' ? (p.flyAngle ?? outAngle) : outAngle) - Math.PI / 2;
        } else if (_pt_draw?.isWing) {
          ctx._wingRot = wingRot;
        } else if (_pt_draw?.pieceShape === 'stinger') {
          ctx._stingerAngle = (p.pieceAngle ?? 0) * Math.PI / 180;
        }
        break;
    }

    if (p.state === 'reloading') {
      // Ghost silhouette + reload arc — hidden entirely when the player has
      // turned off "Show Reloading Petals" in Settings; the petal's slot
      // just stays empty in the ring until it's active again.
      if (settings.showReloadingPetals) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        drawFn(ctx, p.typeId, drawSx, drawSy, displayR);
        ctx.restore();

        // Per-piece reload arc — each piece reloads independently
        const progress = 1 - p.reloadTimer / PETAL_TYPES[p.typeId].reloadTime;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(sx, sy, (p.radius + 4) * zoomState.v, -Math.PI / 2,
                -Math.PI / 2 + progress * Math.PI * 2);
        ctx.strokeStyle = 'rgba(150,230,255,0.9)';
        ctx.lineWidth   = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // Dropped pollen petal: pop scale instead of fade
      let dropR = displayR;
      let dropAlpha = 1;
      if (p.state === 'dropped' && p.dropTimer != null) {
        if (p.dropTimer < 300) {
          // Swell then vanish
          dropR     = displayR * (1 + (1 - p.dropTimer / 300) * 0.35);
          dropAlpha = p.dropTimer < 80 ? p.dropTimer / 80 : 1;
        }
      }
      ctx.save();
      if (dropAlpha < 1) ctx.globalAlpha = dropAlpha;
      drawFn(ctx, p.typeId, drawSx, drawSy, dropR);
      ctx.restore();

      // ── Damage flash ────────────────────────────────────────────────────────
      if (p.hurtFlash > 0) {
        p.hurtFlash = Math.max(0, p.hurtFlash - dt);
        if (!settings.reduceDamageFlash && p.hurtFlash > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(drawSx, drawSy, displayR, 0, Math.PI * 2);
          ctx.clip();
          drawFn(ctx, p.typeId, drawSx, drawSy, displayR);
          ctx.globalCompositeOperation = 'source-atop';
          ctx.globalAlpha = (p.hurtFlash / 120) * 0.6;
          ctx.fillStyle = '#ff2200';
          ctx.fillRect(drawSx - displayR, drawSy - displayR, displayR * 2, displayR * 2);
          ctx.restore();
        }
      }
    }

    // ── Petal hitbox overlay (toggle with F, same key as mob hitboxes) ────────
    if (showHitboxes) {
      ctx.save();
      ctx.strokeStyle = 'rgba(80, 180, 255, 0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius * zoomState.v, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

// ── Face animation state ──────────────────────────────────────────────────────
// attackT / defendT lerp 0→1 for smooth expression blending.
// eyeAngle smoothly follows player.moveAngle via shortest-path lerp.
const face = {
  attackT:  0,
  defendT:  0,
  eyeAngle: 0,
};

// Per-ms lerp factor — ~120ms to fully transition
const FACE_SPEED = 0.012;

function updateFace(dt, moveAngle, isAttacking, isDefending, moving) {
  const k = 1 - Math.pow(1 - FACE_SPEED, dt);

  face.attackT += ((isAttacking ? 1 : 0) - face.attackT) * k;
  face.defendT += ((isDefending ? 1 : 0) - face.defendT) * k;

  // Shortest-path angle lerp so pupils don't spin the long way
  // Only update when moving; stay in place when stopped
  if (moving) {
    let da = moveAngle - face.eyeAngle;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    face.eyeAngle += da * k;
  }
}

// ── Player face drawing ───────────────────────────────────────────────────────
// Exported so homescreen can reuse the exact same draw calls with its own state.
export function drawFlowerFaceParams(ctx, sx, sy, r, attackT, defendT, eyeAngle, zoomScale = 1) {
  const at = attackT;
  const dt = defendT;

  const eyeOffsetX = r * 0.285;
  const eyeOffsetY = r * 0.21;
  const eyeRx      = r * 0.128;
  const eyeRy      = r * 0.249;
  const pupilR     = r * 0.124;

  const horizontalDrift = r * 0.11;
  const upDrift         = r * 0.13;
  const downDrift       = r * 0.18;
  const verticalDrift   = Math.sin(eyeAngle) < 0 ? upDrift : downDrift;
  const pdx = Math.cos(eyeAngle) * horizontalDrift;
  const pdy = Math.sin(eyeAngle) * verticalDrift;

  const eyes = [
    { cx: sx - eyeOffsetX, cy: sy - eyeOffsetY, browSign: -1 },
    { cx: sx + eyeOffsetX, cy: sy - eyeOffsetY, browSign:  1 },
  ];

  for (const eye of eyes) {
    // Dark iris oval
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#212219';
    ctx.fill();
    ctx.closePath();

    // White pupil clipped inside oval
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(eye.cx + pdx, eye.cy + pdy, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#eeeeee';
    ctx.fill();
    ctx.closePath();
    ctx.restore();
  }

  // ── Eyebrow (angry only, like digger) ──────────────────────────────────────
  // Single downward-pointing triangle that starts above eyes and slides down
  // Slower easing: square root for a more gradual, sustained animation
  const browEase = at < 1 
    ? Math.sqrt(at)  // square root: slower, more sustained motion
    : 1;
  
  if (browEase > 0.001) {
    const browBaseY = sy - eyeOffsetY - eyeRy - r * 0.05;  // Just above eyes
    const slideDown = browEase * r * 0.25;  // Slides down covering iris
    const browY = browBaseY + slideDown;

    ctx.save();
    ctx.globalAlpha = 1;  // Stay fully opaque, just move
    ctx.fillStyle = '#ffe840';

    // Single downward-pointing triangle in the middle
    const browW = r * 0.40;
    const browH = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(sx - browW, browY - browH);      // left top
    ctx.lineTo(sx + browW, browY - browH);       // right top
    ctx.lineTo(sx, browY + browH);               // point down
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ── Mouth ─────────────────────────────────────────────────────────────────
  // neutral   → slight smile  (cpY below mouthY, canvas Y-down so + = lower)
  // attacking → angry frown   (cpY above mouthY, deeper)
  // defending → sad frown     (cpY above mouthY, gentler)
  const smileCP =  r * 0.14;   // neutral: below endpoints
  const angryCP = -r * 0.20;   // attacking: above endpoints, sharp
  const sadCP   = -r * 0.13;   // defending: above endpoints, gentle

  const cpOffset = smileCP
    + (angryCP - smileCP) * at
    + (sadCP   - smileCP) * dt;

  const mouthY  = sy + r * 0.38;
  const mouthHW = r * 0.25;
  const cpY     = mouthY + cpOffset;

  ctx.save();
  ctx.strokeStyle = '#212219';
  ctx.lineWidth   = r * 0.072 * zoomScale;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(sx - mouthHW, mouthY);
  ctx.quadraticCurveTo(sx, cpY, sx + mouthHW, mouthY);
  ctx.stroke();
  ctx.restore();
}

/** Draw X eyes on a dead player */
function drawDeadFace(ctx, sx, sy, r) {
  const eyeOffsetX = r * 0.285;
  const eyeOffsetY = r * 0.21;
  const eyeSize    = r * 0.18;

  ctx.save();
  ctx.strokeStyle = '#212219';
  ctx.lineWidth   = r * 0.08 * zoomState.v;
  ctx.lineCap     = 'round';

  const eyeCenters = [
    { cx: sx - eyeOffsetX, cy: sy - eyeOffsetY },
    { cx: sx + eyeOffsetX, cy: sy - eyeOffsetY },
  ];
  for (const { cx, cy } of eyeCenters) {
    ctx.beginPath();
    ctx.moveTo(cx - eyeSize, cy - eyeSize);
    ctx.lineTo(cx + eyeSize, cy + eyeSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + eyeSize, cy - eyeSize);
    ctx.lineTo(cx - eyeSize, cy + eyeSize);
    ctx.stroke();
  }

  // Flat sad mouth
  const mouthY  = sy + r * 0.38;
  const mouthHW = r * 0.25;
  const cpY     = mouthY - r * 0.13;
  ctx.lineWidth = r * 0.072 * zoomState.v;
  ctx.beginPath();
  ctx.moveTo(sx - mouthHW, mouthY);
  ctx.quadraticCurveTo(sx, cpY, sx + mouthHW, mouthY);
  ctx.stroke();
  ctx.restore();
}

function drawFlowerFace(ctx, sx, sy, r) {
  drawFlowerFaceParams(ctx, sx, sy, r, face.attackT, face.defendT, face.eyeAngle, zoomState.v);
}

// ── Zone Mob Icon HUD ─────────────────────────────────────────────────────────
const HUD_BOX          = 58;    // box size in px (perfect square)
const HUD_GAP          = 7;     // gap between boxes
const HUD_PAD_TOP      = 5;     // screen top padding
const HUD_DIE_MS       = 420;   // exit animation duration (ms)
const HUD_ENTER_MS     = 300;   // enter animation duration (ms)
const HUD_COUNT_BOUNCE = 380;   // count badge bounce duration (ms)
const NE_FACING   = -Math.PI / 4;  // facing direction = northeast

// ── Boss announcement banner state ────────────────────────────────────────────
let _bossBanner = null; // { label, color, timer, totalTime, spawned }

/**
 * Show the boss announcement banner.
 * @param {string}  label       — e.g. "Ultra Soldier Ant Boss"
 * @param {string}  color       — rarity hex colour
 * @param {boolean} spawned     — false = INCOMING, true = HAS SPAWNED
 */
export function showBossAnnouncement(label, color, spawned) {
  _bossBanner = { label, color, timer: 0, totalTime: spawned ? 3500 : 3000, spawned };
}

// key -> { typeId, rarity, tier, count, cx, cy, targetCx, targetCy, enterT }
const hudLive = new Map();
// [ { typeId, rarity, count, cx, cy, t } ] — t: 0→1 = dying progress
const hudDying = [];

function computeHUDLayout(entries, W, startY) {
  // Sort ascending: lowest tier → left, highest tier → right
  const sorted = [...entries].sort((a, b) => a.tier - b.tier);

  let rows;
  if (sorted.length <= 7) {
    rows = [sorted];            // single row — lowest tier left, highest right
  } else {
    // Fill top row first (up to 7 lower-tier entries), overflow to bottom row
    const topItems    = sorted.slice(0, 7);   // first 7 = lower tiers
    const bottomItems = sorted.slice(7);      // remainder = higher tiers
    rows = [topItems, bottomItems];
  }

  const result = new Map();
  rows.forEach((row, ri) => {
    const totalW = row.length * HUD_BOX + (row.length - 1) * HUD_GAP;
    const startX = W / 2 - totalW / 2 + HUD_BOX / 2;
    const cy = startY + HUD_BOX / 2 + ri * (HUD_BOX + HUD_GAP);
    row.forEach((e, ci) => {
      result.set(e.key, {
        targetCx: startX + ci * (HUD_BOX + HUD_GAP),
        targetCy: cy,
      });
    });
  });
  return result;
}

function drawSingleMobBox(ctx, typeId, rarity, count, cx, cy, scaleAmt, spinAng, alpha, countBounceT = 1, isBoss = false) {
  const S    = HUD_BOX * scaleAmt;
  const half = S / 2;
  if (S < 1) return;

  ctx.save();
  ctx.globalAlpha = (alpha ?? 1);
  ctx.translate(cx, cy);
  ctx.rotate(spinAng ?? 0);

  // ── Box background — identical two-pass style to hotbar/inv petal boxes ────
  const cr = S * 0.16;
  if (rarity === 'Impracticality') {
    const grad = ctx.createLinearGradient(-half, -half, half, half);
    grad.addColorStop(0.00, '#ff0000'); grad.addColorStop(0.17, '#ff8800');
    grad.addColorStop(0.33, '#ffff00'); grad.addColorStop(0.50, '#00cc44');
    grad.addColorStop(0.67, '#0088ff'); grad.addColorStop(0.83, '#8800ff');
    grad.addColorStop(1.00, '#ff00cc');
    ctx.beginPath();
    ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    // Pass 1: dark base
    ctx.beginPath();
    ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = '#0d1020';
    ctx.fill();
    // Pass 2: rarity tint at 42%
    ctx.beginPath();
    ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle    = RARITY_BG[rarity] || '#333';
    ctx.globalAlpha *= 0.42;
    ctx.fill();
    ctx.globalAlpha /= 0.42;
  }
  // Border — red for boss, rarity color otherwise
  ctx.beginPath();
  ctx.roundRect(-half, -half, S, S, cr);
  ctx.strokeStyle = isBoss ? '#ff2222' : (RARITY_BORDER[rarity] || '#3a3f5a');
  ctx.lineWidth   = isBoss ? 3.5 : 2.5;
  ctx.stroke();
  // Inner highlight
  ctx.beginPath();
  ctx.roundRect(-half + 2.5, -half + 2.5, S - 5, S - 5, cr * 0.65);
  ctx.strokeStyle = isBoss ? 'rgba(255,80,80,0.18)' : 'rgba(255,255,255,0.11)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // ── Mob icon — clipped to inside of box ────────────────────────────────────
  const iconR = S * 0.155;   // reduced to keep every mob safely inside the square

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-half + 3, -half + 3, S - 6, S - 6, cr * 0.65);
  ctx.clip();

  switch (typeId) {
    case 'bee':
      drawBee(ctx, 0, 0, iconR, NE_FACING, 0);
      break;
    case 'queen_bee':
      drawQueenBee(ctx, 0, 0, iconR * 0.9, NE_FACING, 0);
      break;
    case 'beehive':
      drawHive(ctx, 0, 0, iconR * 1.125);
      break;
    case 'hornet':
      // Full stinger shown in HUD icon (stingerProgress=1)
      drawHornet(ctx, 0, 0, iconR, NE_FACING, 0, 1);
      break;
    case 'ladybug':
      drawLadybug(ctx, 0, 0, iconR, NE_FACING, []);
      break;
    case 'spider':
      drawSpider(ctx, 0, 0, iconR, NE_FACING, 0, 0);
      break;
    case 'centipede_head': {
      // Body segment trails behind the head at NE_FACING + PI
      const bodyR = iconR * 0.9;
      const bAngle = NE_FACING + Math.PI; // body trails behind head
      const bx = Math.cos(bAngle) * iconR * 1.55;
      const by = Math.sin(bAngle) * iconR * 1.55;
      // Draw body segment WITH legs (segIndex=1 for the first body segment)
      drawCentipedeBody(ctx, bx, by, bodyR, NE_FACING, 0, 1);
      drawCentipedeHead(ctx, 0, 0, iconR, NE_FACING);
      break;
    }
    case 'soldier_ant':
    case 'worker_ant':
    case 'baby_ant':
    case 'queen_ant': {
      // Draw to an offscreen canvas first so we can measure the actual pixel
      // bounding box and re-centre it exactly — avoids all hardcoded guess offsets.
      const OC_SIZE = 256;
      const oc   = new OffscreenCanvas(OC_SIZE, OC_SIZE);
      const octx = oc.getContext('2d');
      const mid  = OC_SIZE / 2;
      // Scale iconR up to offscreen space for enough pixel resolution to sample
      const ocScale = (OC_SIZE * 0.35) / iconR;
      const ocIconR = iconR * ocScale;
      
      // Animation phases for soldier ant HUD icon — slow 1-2 sec cycle
      const antAnimPhase = (Date.now() * 0.0015) % (Math.PI * 2);

      octx.clearRect(0, 0, OC_SIZE, OC_SIZE);
      if (typeId === 'soldier_ant') {
        const offsetScale = ocIconR / 22;
        drawSoldierAnt(octx, mid - soldierAntOffsetX * offsetScale, mid, ocIconR, NE_FACING, antAnimPhase, antAnimPhase);
      } else if (typeId === 'worker_ant') {
        drawWorkerAnt(octx, mid, mid, ocIconR, NE_FACING, antAnimPhase);
      } else if (typeId === 'baby_ant') {
        drawBabyAnt(octx, mid, mid, ocIconR, NE_FACING, antAnimPhase);
      } else if (typeId === 'queen_ant') {
        drawQueenAnt(octx, mid, mid, ocIconR * 0.72, NE_FACING, 0, 0);
      }

      // Find the bounding box of drawn pixels
      const imgData = octx.getImageData(0, 0, OC_SIZE, OC_SIZE);
      const pd = imgData.data;
      let minX = OC_SIZE, maxX = 0, minY = OC_SIZE, maxY = 0;
      for (let py = 0; py < OC_SIZE; py++) {
        for (let px = 0; px < OC_SIZE; px++) {
          if (pd[(py * OC_SIZE + px) * 4 + 3] > 8) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      if (maxX > minX && maxY > minY) {
        // Visual centre in offscreen space → shift needed to land at box (0,0)
        const visCX  = (minX + maxX) / 2;
        const visCY  = (minY + maxY) / 2;
        const shiftX = (mid - visCX) / ocScale;
        const shiftY = (mid - visCY) / ocScale;

        if (typeId === 'soldier_ant') {
          const offsetScale = iconR / 22;
          drawSoldierAnt(ctx, shiftX - soldierAntOffsetX * offsetScale - iconR * 0.8 + iconR * 0.5, shiftY, iconR, NE_FACING, antAnimPhase, antAnimPhase);
        } else if (typeId === 'worker_ant') {
          drawWorkerAnt(ctx, shiftX, shiftY, iconR, NE_FACING, antAnimPhase);
        } else if (typeId === 'baby_ant') {
          drawBabyAnt(ctx, shiftX, shiftY, iconR, NE_FACING, antAnimPhase);
        } else if (typeId === 'queen_ant') {
          drawQueenAnt(ctx, shiftX, shiftY, iconR * 0.72, NE_FACING, 0, 0);
        }
      }
      break;
    }
    case 'ant_egg':
      drawAntEgg(ctx, 0, 0, iconR);
      break;
    case 'ant_hole': {
      // Use bounding-box centering like ants to ensure proper alignment
      const OC_SIZE = 256;
      const oc   = new OffscreenCanvas(OC_SIZE, OC_SIZE);
      const octx = oc.getContext('2d');
      const mid  = OC_SIZE / 2;
      const ocScale = (OC_SIZE * 0.35) / iconR;
      const ocIconR = iconR * ocScale;
      octx.clearRect(0, 0, OC_SIZE, OC_SIZE);
      drawAntHole(octx, mid, mid, ocIconR);
      const imgData = octx.getImageData(0, 0, OC_SIZE, OC_SIZE);
      const pd = imgData.data;
      let minX = OC_SIZE, maxX = 0, minY = OC_SIZE, maxY = 0;
      for (let py = 0; py < OC_SIZE; py++) {
        for (let px = 0; px < OC_SIZE; px++) {
          if (pd[(py * OC_SIZE + px) * 4 + 3] > 8) {
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        const visCX = (minX + maxX) / 2;
        const visCY = (minY + maxY) / 2;
        drawAntHole(ctx, (mid - visCX) / ocScale, (mid - visCY) / ocScale, iconR);
      } else {
        drawAntHole(ctx, 0, 0, iconR);
      }
      break;
    }
    case 'fire_soldier_ant':
    case 'fire_worker_ant':
    case 'fire_baby_ant':
    case 'fire_queen_ant': {
      const OC_SIZE = 256;
      const oc   = new OffscreenCanvas(OC_SIZE, OC_SIZE);
      const octx = oc.getContext('2d');
      const mid  = OC_SIZE / 2;
      const ocScale = (OC_SIZE * 0.35) / iconR;
      const ocIconR = iconR * ocScale;
      const antAnimPhase = (Date.now() * 0.0015) % (Math.PI * 2);
      octx.clearRect(0, 0, OC_SIZE, OC_SIZE);
      if (typeId === 'fire_soldier_ant') {
        drawFireSoldierAnt(octx, mid, mid, ocIconR, NE_FACING, antAnimPhase, antAnimPhase);
      } else if (typeId === 'fire_worker_ant') {
        drawFireWorkerAnt(octx, mid, mid, ocIconR, NE_FACING, antAnimPhase);
      } else if (typeId === 'fire_baby_ant') {
        drawFireBabyAnt(octx, mid, mid, ocIconR, NE_FACING, antAnimPhase);
      } else if (typeId === 'fire_queen_ant') {
        drawFireQueenAnt(octx, mid, mid, ocIconR * 0.72, NE_FACING, 0, 0);
      }
      const imgData = octx.getImageData(0, 0, OC_SIZE, OC_SIZE);
      const pd = imgData.data;
      let minX = OC_SIZE, maxX = 0, minY = OC_SIZE, maxY = 0;
      for (let py = 0; py < OC_SIZE; py++) {
        for (let px = 0; px < OC_SIZE; px++) {
          if (pd[(py * OC_SIZE + px) * 4 + 3] > 8) {
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        const visCX = (minX + maxX) / 2;
        const visCY = (minY + maxY) / 2;
        const shiftX = (mid - visCX) / ocScale;
        const shiftY = (mid - visCY) / ocScale;
        if (typeId === 'fire_soldier_ant') {
          drawFireSoldierAnt(ctx, shiftX, shiftY, iconR, NE_FACING, antAnimPhase, antAnimPhase);
        } else if (typeId === 'fire_worker_ant') {
          drawFireWorkerAnt(ctx, shiftX, shiftY, iconR, NE_FACING, antAnimPhase);
        } else if (typeId === 'fire_baby_ant') {
          drawFireBabyAnt(ctx, shiftX, shiftY, iconR, NE_FACING, antAnimPhase);
        } else if (typeId === 'fire_queen_ant') {
          drawFireQueenAnt(ctx, shiftX, shiftY, iconR * 0.72, NE_FACING, 0, 0);
        }
      }
      break;
    }
    case 'fire_ant_egg':
      drawFireAntEgg(ctx, 0, 0, iconR);
      break;
    case 'fire_ant_hole': {
      const OC_SIZE = 256;
      const oc   = new OffscreenCanvas(OC_SIZE, OC_SIZE);
      const octx = oc.getContext('2d');
      const mid  = OC_SIZE / 2;
      const ocScale = (OC_SIZE * 0.35) / iconR;
      const ocIconR = iconR * ocScale;
      octx.clearRect(0, 0, OC_SIZE, OC_SIZE);
      drawFireAntHole(octx, mid, mid, ocIconR);
      const imgData = octx.getImageData(0, 0, OC_SIZE, OC_SIZE);
      const pd = imgData.data;
      let minX = OC_SIZE, maxX = 0, minY = OC_SIZE, maxY = 0;
      for (let py = 0; py < OC_SIZE; py++) {
        for (let px = 0; px < OC_SIZE; px++) {
          if (pd[(py * OC_SIZE + px) * 4 + 3] > 8) {
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        const visCX = (minX + maxX) / 2;
        const visCY = (minY + maxY) / 2;
        drawFireAntHole(ctx, (mid - visCX) / ocScale, (mid - visCY) / ocScale, iconR);
      } else {
        drawFireAntHole(ctx, 0, 0, iconR);
      }
      break;
    }
    case 'digger': {
      // Neutral face, animated cutter using wall-clock time so it spins in the HUD
      const hudCutterRot = (Date.now() * 0.0012) % (Math.PI * 2);
      drawDigger(ctx, 0, 0, iconR, 'neutral', hudCutterRot, 0, null);
      break;
    }
    case 'beekeeper': {
      // Neutral face, animated cutter using wall-clock time so it spins in the HUD
      const hudCutterRot = (Date.now() * 0.0012) % (Math.PI * 2);
      drawBeekeeper(ctx, 0, 0, iconR * 1.5, 'neutral', hudCutterRot, 0, null);
      break;
    }
    case 'beetle':
      drawBeetle(ctx, 0, 0, iconR, NE_FACING, 0);
      break;
    case 'sandstorm': {
      const hudHexRots = [(Date.now() * -0.001) % (Math.PI * 2), (Date.now() * -0.0008) % (Math.PI * 2), (Date.now() * 0.0012) % (Math.PI * 2)];
      drawSandstorm(ctx, 0, 0, iconR * 1.6, hudHexRots, false, false);
      break;
    }
    case 'desert_centipede_head': {
      const centipedeAnimPhase = (Date.now() * 0.0018) % (Math.PI * 2);
      const bodyR = iconR * 0.9;
      const bAngle = NE_FACING + Math.PI;
      const bx = Math.cos(bAngle) * iconR * 1.55;
      const by = Math.sin(bAngle) * iconR * 1.55;
      drawDesertCentipedeBody(ctx, bx, by, bodyR, NE_FACING, centipedeAnimPhase, 1);
      drawDesertCentipedeHead(ctx, 0, 0, iconR, NE_FACING);
      break;
    }
    case 'cactus':
      drawCactus(ctx, 0, 0, iconR * 1.1);
      break;
    case 'rock':
      drawRock(ctx, 0, 0, iconR * 1.2);
      break;
    case 'dandelion':
      drawDandelion(ctx, 0, 0, iconR);
      break;
    case 'scorpion': {
      const legPhase = (Date.now() * 0.006) % (Math.PI * 2);
      const pincerPhase = (Date.now() * 0.004) % (Math.PI * 2);
      drawScorpion(ctx, 0, 0, iconR * 1.3, NE_FACING, legPhase, pincerPhase);
      break;
    }
    case 'pyramid':
      drawPyramid(ctx, 0, 0, iconR * 1.3);
      break;
    case 'mummified_beetle': {
      const pincerPhase = (Date.now() * 0.004) % (Math.PI * 2);
      drawMummifiedBeetle(ctx, 0, 0, iconR, NE_FACING, pincerPhase);
      break;
    }
    case 'squid':
      applyMobIconOverride(ctx, 'squid', iconR, function(r) {
        const hudTentaclePhase = (Date.now() * 0.0015) % (Math.PI * 2);
        drawSquid(ctx, 0, 0, r, NE_FACING, hudTentaclePhase);
      });
      break;
    case 'alligator':
      applyMobIconOverride(ctx, 'alligator', iconR, function(r) {
        const hudTailPhase = (Date.now() * 0.0015) % (Math.PI * 2);
        drawAlligator(ctx, 0, 0, r, NE_FACING, hudTailPhase);
      });
      break;
    case 'jellyfish':
      applyMobIconOverride(ctx, 'jellyfish', iconR, function(r) {
        const hudTentaclePhase = (Date.now() * 0.0015) % (Math.PI * 2);
        drawJellyfish(ctx, 0, 0, r, hudTentaclePhase, NE_FACING);
      });
      break;
    case 'crab':
      applyMobIconOverride(ctx, 'crab', iconR, function(r) {
        const hudLegPhase = (Date.now() * 0.002) % (Math.PI * 2);
        // Flipped 180° to match the in-world sprite orientation — see the
        // comment on the 'crab' case in mobDrawing.js's drawMob switch.
        drawCrab(ctx, 0, 0, r, NE_FACING + Math.PI, hudLegPhase);
      });
      break;
    case 'starfish':
      applyMobIconOverride(ctx, 'starfish', iconR, function(r) {
        drawStarfish(ctx, 0, 0, r, 0, 0);
      });
      break;
    case 'shell':
      applyMobIconOverride(ctx, 'shell', iconR, function(r) {
        drawShell(ctx, 0, 0, r);
      });
      break;
    case 'sponge':
      applyMobIconOverride(ctx, 'sponge', iconR, function(r) {
        drawSponge(ctx, 0, 0, r);
      });
      break;
    case 'bubble':
      applyMobIconOverride(ctx, 'bubble', iconR, function(r) {
        drawBubble(ctx, 0, 0, r);
      });
      break;
    case 'sea_cave':
      applyMobIconOverride(ctx, 'sea_cave', iconR, function(r) {
        drawSeaCave(ctx, 0, 0, r);
      });
      break;
    case 'debris':
      applyMobIconOverride(ctx, 'debris', iconR, function(r) {
        drawDebris(ctx, 0, 0, r);
      });
      break;
    case 'leech':
      // drawLeechPose has no radius/facing params — see the note in mobDrawing.js's
      // drawMob switch. Same fixed-pose-scaled-to-fit approach here, with the
      // override's rot/scale/ox/oy applied around it same as every other mob.
      applyMobIconOverride(ctx, 'leech', iconR, function(r) {
        ctx.save();
        ctx.translate(-r, -r);
        ctx.scale(r / 150, r / 150);
        drawLeechPose(ctx, 150, 150);
        ctx.restore();
      });
      break;
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, iconR, 0, Math.PI * 2);
      ctx.fillStyle = '#aaaaaa';
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();

  // ── Mob name — white text at bottom of box, shrunk to fit if needed ────────
  const MOB_DISPLAY_NAMES = {
    centipede_head:        'Centipede',
    desert_centipede_head: 'Desert Centipede',
    soldier_ant:           'Soldier Ant',
    worker_ant:            'Worker Ant',
    baby_ant:              'Baby Ant',
    queen_ant:             'Queen Ant',
    ant_egg:               'Ant Egg',
    ant_hole:              'Ant Hole',
    fire_soldier_ant:      'Fire Soldier Ant',
    fire_worker_ant:       'Fire Worker Ant',
    fire_baby_ant:         'Fire Baby Ant',
    fire_queen_ant:        'Fire Queen Ant',
    fire_ant_egg:          'Fire Ant Egg',
    fire_ant_hole:         'Fire Ant Hole',
    queen_bee:             'Queen Bee',
    beehive:               'Beehive',
    beetle:                'Beetle',
    sandstorm:             'Sandstorm',
    cactus:                'Cactus',
    rock:                  'Rock',
    dandelion:             'Dandelion',
    jellyfish:             'Jellyfish',
    squid:                 'Squid',
    alligator:             'Alligator',
    crab:                  'Crab',
    starfish:              'Starfish',
    shell:                 'Shell',
    sponge:                'Sponge',
    bubble:                'Bubble',
    sea_cave:              'Sea Cave',
    debris:                'Debris',
    leech:                 'Leech',
  };
  const baseName  = MOB_DISPLAY_NAMES[typeId] ?? (typeId.charAt(0).toUpperCase() + typeId.slice(1));
  const mobName   = isBoss ? `Boss ${baseName}` : baseName;
  const maxNameW  = S - 6;   // 3px padding each side
  let nameSz      = Math.max(6, S * 0.165);
  ctx.font        = `bold ${nameSz}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  // Shrink font until text fits within the box width
  while (nameSz > 5 && ctx.measureText(mobName).width > maxNameW) {
    nameSz -= 0.5;
    ctx.font = `bold ${nameSz}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  }
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  const nameY = half - 4;   // 4 px gap from the bottom edge
  // Clip name text to box bounds
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-half + 2, -half + 2, S - 4, S - 4, S * 0.12);
  ctx.clip();
  ctx.strokeStyle  = 'rgba(0,0,0,0.9)';
  ctx.lineWidth    = nameSz * 0.22;
  ctx.lineJoin     = 'round';
  ctx.strokeText(mobName, 0, nameY);
  ctx.fillStyle    = '#ffffff';
  ctx.fillText(mobName, 0, nameY);
  ctx.restore();

  // ── Count badge — top-right corner, text rotated NE (45°) ─────────────────
  if (count > 1) {
    const bx = half - 5;
    const by = -half + 5;
    // Bounce scale: sin-based pop when count changes (countBounceT 0→1)
    const bounce = countBounceT < 1
      ? 1 + 0.55 * Math.sin(countBounceT * Math.PI) * Math.pow(1 - countBounceT, 0.5)
      : 1;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.PI / 4);  // 45° = northeast tilt
    ctx.scale(bounce, bounce);
    ctx.font         = `bold ${Math.max(7, S * 0.20)}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`x${count}`, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Update HUD state and draw all mob icon boxes.
 * Returns the Y pixel where the zone text should start (below the boxes).
 */
function drawMobHUD(ctx, W, playerX, playerY, dt, startY = 8) {
  // ── Gather all currently-live mobs (no zone concept anymore) ──────────────
  const groups = new Map(); // key -> { key, typeId, rarity, tier, count, isBoss }
  for (const mob of mobs) {
    if (mob.dead) continue;
    const rarity = mob.rarity || 'Common';
    // Centipede bodies display under the same card as the head
    const displayTypeId = mob.typeId === 'centipede_body' ? 'centipede_head'
                         : mob.typeId === 'desert_centipede_body' ? 'desert_centipede_head'
                         : mob.typeId;
    const isBoss = !!mob.isBoss;
    const key    = `${displayTypeId}_${rarity}${isBoss ? '_boss' : ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        typeId: displayTypeId,
        rarity,
        tier:  rarityTier(rarity),
        count: 0,
        isBoss,
      });
    }
    groups.get(key).count++;
  }

  // ── Compute desired layout ────────────────────────────────────────────────
  const layout = computeHUDLayout([...groups.values()], W, startY);

  // ── Retire live boxes whose mob group vanished → dying animation ──────────
  for (const [key, box] of hudLive) {
    if (!groups.has(key)) {
      hudDying.push({ typeId: box.typeId, rarity: box.rarity, count: box.count,
                      cx: box.cx, cy: box.cy, t: 0 });
      hudLive.delete(key);
    }
  }

  // ── Add new boxes / update existing ones ──────────────────────────────────
  for (const [key, grp] of groups) {
    const pos = layout.get(key);
    if (hudLive.has(key)) {
      const box = hudLive.get(key);
      // Detect count change → restart badge bounce
      if (grp.count !== box.prevCount) {
        box.countBounceT = 0;
        box.prevCount    = grp.count;
      }
      box.count     = grp.count;
      box.targetCx  = pos.targetCx;
      box.targetCy  = pos.targetCy;
      box.tier      = grp.tier;
      box.isBoss    = grp.isBoss;
    } else {
      hudLive.set(key, {
        typeId:  grp.typeId,
        rarity:  grp.rarity,
        tier:    grp.tier,
        count:   grp.count,
        isBoss:  grp.isBoss,
        cx:      pos.targetCx,
        cy:      pos.targetCy,
        targetCx: pos.targetCx,
        targetCy: pos.targetCy,
        enterT:       0,
        prevCount:    grp.count,
        countBounceT: 0,   // pop-in bounce on first appearance
      });
    }
  }

  // ── Animate live boxes (position lerp + enter scale + count bounce) ────────
  const lerpK = 1 - Math.pow(0.88, dt / 16.67);  // smooth position slide
  for (const box of hudLive.values()) {
    box.cx           += (box.targetCx - box.cx) * lerpK;
    box.cy           += (box.targetCy - box.cy) * lerpK;
    box.enterT        = Math.min(1, box.enterT + dt / HUD_ENTER_MS);
    box.countBounceT  = Math.min(1, (box.countBounceT ?? 1) + dt / HUD_COUNT_BOUNCE);
  }

  // ── Advance dying animations, remove finished ─────────────────────────────
  for (let i = hudDying.length - 1; i >= 0; i--) {
    hudDying[i].t += dt / HUD_DIE_MS;
    if (hudDying[i].t >= 1) hudDying.splice(i, 1);
  }

  // ── Draw dying boxes (spin + shrink + fade) ───────────────────────────────
  for (const d of hudDying) {
    const scaleAmt = 1 - d.t;
    const spin     = d.t * Math.PI * 2.5;
    const alpha    = 1 - d.t;
    drawSingleMobBox(ctx, d.typeId, d.rarity, d.count, d.cx, d.cy, scaleAmt, spin, alpha, 1, d.isBoss);
  }

  // ── Draw live boxes (with bounce-in scale) ────────────────────────────────
  for (const box of hudLive.values()) {
    const t  = box.enterT;
    const c1 = 1.70158, c3 = c1 + 1;
    const scaleAmt = t >= 1 ? 1 : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    drawSingleMobBox(ctx, box.typeId, box.rarity, box.count, box.cx, box.cy, scaleAmt, 0, 1, box.countBounceT ?? 1, box.isBoss);
  }

  // ── Return the Y pixel directly below the boxes ───────────────────────────
  if (hudLive.size === 0 && hudDying.length === 0) return startY;
  const numRows = groups.size <= 7 ? 1 : 2;
  return startY + numRows * HUD_BOX + (numRows - 1) * HUD_GAP + 6;
}

// ── Boss announcement banner (standalone — reusable once bossManager.js is
// reconnected to a new spawning system; not currently invoked by anything) ────
function _drawBossBanner(ctx, W, H, dt) {
  if (!_bossBanner) return;
  _bossBanner.timer += dt;
  const { label, color, timer, totalTime, spawned } = _bossBanner;

  const SLIDE_IN  = 320;
  const SLIDE_OUT = 500;
  let alpha = 1;
  if (timer < SLIDE_IN)             alpha = timer / SLIDE_IN;
  else if (timer > totalTime - SLIDE_OUT) alpha = Math.max(0, (totalTime - timer) / SLIDE_OUT);
  if (timer >= totalTime) { _bossBanner = null; return; }

  const slideY = (1 - Math.min(1, timer / SLIDE_IN)) * -60;
  const bannerY = 70 + slideY;
  const prefix  = spawned ? '⚠ BOSS SPAWNED — ' : '⚠ BOSS INCOMING — ';
  const text    = prefix + label;

  ctx.save();
  ctx.globalAlpha  = alpha;
  ctx.font         = 'bold 18px "UbuntuCustom","Ubuntu",Arial,sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';

  const tw    = ctx.measureText(text).width;
  const padX  = 20;
  const bw    = tw + padX * 2;
  const bh    = 36;
  const bx    = W / 2 - bw / 2;
  const by    = bannerY - bh / 2;

  // Background pill
  ctx.fillStyle = 'rgba(10,12,24,0.88)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();

  // Rarity-colored border
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.stroke();

  // Shadow then colored text
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(text, W / 2 + 1.5, bannerY + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, bannerY);

  ctx.restore();
}

// ── Main render entry ─────────────────────────────────────────────────────────
// ── Minimap (top-right) ─────────────────────────────────────────────────────
// The base black/white map image is expensive to build (one pixel per tile,
// up to ~660x590 tiles) so it's rendered once per biome to an offscreen
// canvas and cached; every frame just blits that cached image plus a player
// dot on top, instead of re-walking the whole tile grid each time.
const MINIMAP_SIZE = 160;   // on-screen box size in px
const MINIMAP_MARGIN = 14;  // gap from screen edges

let _minimapCache = null;       // offscreen canvas with the base black/white map
let _minimapCacheBiome = null;  // which biome the cache was built for

function _buildMinimapCache() {
  const gridW = getGridW(), gridH = getGridH();
  const off = document.createElement('canvas');
  off.width = MINIMAP_SIZE;
  off.height = MINIMAP_SIZE;
  const octx = off.getContext('2d');
  const img = octx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);

  for (let py = 0; py < MINIMAP_SIZE; py++) {
    const gy = Math.floor((py / MINIMAP_SIZE) * gridH);
    for (let px = 0; px < MINIMAP_SIZE; px++) {
      const gx = Math.floor((px / MINIMAP_SIZE) * gridW);
      const open = isOpenTile(gx, gy);
      const idx = (py * MINIMAP_SIZE + px) * 4;
      const v = open ? 255 : 0; // white = open, black = wall
      img.data[idx] = v; img.data[idx + 1] = v; img.data[idx + 2] = v; img.data[idx + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return off;
}

function _drawMinimap(ctx, W, H) {
  const biome = getActiveBiome();
  if (_minimapCacheBiome !== biome) {
    _minimapCache = _buildMinimapCache();
    _minimapCacheBiome = biome;
  }

  const boxX = W - MINIMAP_SIZE - MINIMAP_MARGIN;
  const boxY = MINIMAP_MARGIN;

  ctx.save();

  // Frame
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(boxX - 3, boxY - 3, MINIMAP_SIZE + 6, MINIMAP_SIZE + 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(boxX - 3, boxY - 3, MINIMAP_SIZE + 6, MINIMAP_SIZE + 6);

  // Base black/white map
  ctx.drawImage(_minimapCache, boxX, boxY, MINIMAP_SIZE, MINIMAP_SIZE);

  // Player dot
  const mapW = getMapW(), mapH = getMapH();
  const px = boxX + (player.x / mapW) * MINIMAP_SIZE;
  const py = boxY + (player.y / mapH) * MINIMAP_SIZE;
  ctx.beginPath();
  ctx.arc(px, py, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

export function render(ctx, W, H, cameraX, cameraY, dt = 16) {
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Smooth centipede legs rotation
  const ROTATION_SMOOTHING = 0.15;  // How quickly to lerp to target angle
  let diff = player.moveAngle - player.smoothRotation;
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  player.smoothRotation += diff * ROTATION_SMOOTHING;

  // Smooth cutter speed transitions
  if (inputState.expand) {
    // Attacking: accelerate smoothly to max speed
    cutterSpeed = Math.min(cutterSpeed + CUTTER_ACCEL * dt, CUTTER_MAX_SPEED);
  } else {
    // Not attacking: decelerate smoothly to default speed
    cutterSpeed = Math.max(cutterSpeed - CUTTER_DECEL * dt, CUTTER_DEFAULT_SPEED);
  }
  cutterRot += cutterSpeed * dt;

  // Petal animations
  diggerEggRot += DIGGER_EGG_ROT_SPEED * dt;
  wingRot      += WING_SPIN_SPEED * dt;

  drawMap(ctx, cameraX, cameraY, W, H, zoomState.v);

  drawDrops(ctx, W, H);
  drawWebFields(ctx, W, H);
  drawPollenEntities(ctx, W, H);
  drawHoneycombEntities(ctx, W, H);
  drawMissileEntities(ctx, W, H);

  // ── Queen Bee Eggs (behind mobs) ─────────────────────────────────────────
  for (const egg of queenBeeEggs) {
    if (egg.dead) continue;
    const { sx: esx, sy: esy } = toScreen(egg.x, egg.y, W, H);
    const er = egg.radius * zoomState.v;
    const popT = Math.min(1, (egg.spawnTimer ?? 0) / 320);
    const drawR = er * (0.3 + 0.7 * popT);
    // Pulse when close to hatching
    const hatchPct = 1 - egg.hatchTimer / 3000;
    const pulse = hatchPct > 0.7 ? 1 + Math.sin(Date.now() * 0.025) * 0.06 : 1;
    const finalR = drawR * pulse;
    // Simple oval — queen bee fill (#f5cf4b) and stroke (#ca9f25), no stripes/antennae/stinger
    const rx2 = finalR * 0.66;
    const ry2 = finalR;
    const bw2 = Math.max(1, finalR * 0.14);
    ctx.save();
    ctx.translate(esx, esy);
    // Border (stroke color)
    ctx.beginPath();
    ctx.ellipse(0, 0, rx2 + bw2, ry2 + bw2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ca9f25';  // queen bee border color
    ctx.fill();
    // Body (fill color)
    ctx.beginPath();
    ctx.ellipse(0, 0, rx2, ry2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f5cf4b';  // queen bee body color
    ctx.fill();
    // Hornet egg indicator — small dark X
    if (egg.isHornetEgg) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(1.5, finalR * 0.13);
      ctx.lineCap = 'round';
      const xs = finalR * 0.22;
      ctx.beginPath(); ctx.moveTo(-xs, -xs); ctx.lineTo(xs, xs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xs, -xs); ctx.lineTo(-xs, xs); ctx.stroke();
    }
    ctx.restore();
  }

  // ── Queen Bee Pollen Orbit (behind mobs) ──────────────────────────────────
  for (const p of queenBeePollenOrbit) {
    if (p.dead) continue;
    const { sx: psx, sy: psy } = toScreen(p.x, p.y, W, H);
    // Scale pollen radius relative to queen's draw radius (stored at spawn)
    const qdr = (p.queenDrawRadius ?? 27) * zoomState.v;
    const pr = qdr * 0.25;  // pollen is ~25% of queen's radius
    let alpha = 1;
    if (p.launched && p.totalTimer !== undefined) {
      alpha = Math.min(1, p.totalTimer / 2000);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(psx, psy, pr, 0, Math.PI * 2);
    ctx.fillStyle   = '#d8e786';
    ctx.fill();
    ctx.strokeStyle = '#9aa83d';
    ctx.lineWidth   = Math.max(1.5, pr * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(psx - pr*0.25, psy - pr*0.25, pr*0.28, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fill();
    ctx.restore();
  }

  // ── Mobs ──────────────────────────────────────────────────────────────────
  for (const mob of mobs) {
    const { sx, sy } = toScreen(mob.x, mob.y, W, H);
    const scaledR    = (mob.drawRadius ?? mob.radius) * zoomState.v;

    // ── Boss ability visuals (drawn behind the mob) ──────────────────────────
    if (mob.isBoss) {
      // Soldier ant lunge telegraph: pulsing red glow while winding up
      if (mob.typeId === 'soldier_ant' && mob.lungeState === 'telegraphing') {
        const pulse = 0.55 + 0.45 * Math.sin(Date.now() * 0.018);
        ctx.save();
        ctx.globalAlpha = pulse * 0.55;
        ctx.beginPath();
        ctx.arc(sx, sy, scaledR * 1.55, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2200';
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // Queen Bee boss: pollen spin glow ring
      if (mob.typeId === 'queen_bee') {
        if (mob.queenBeePollenState === 'shake' || mob.queenBeePollenState === 'spinning') {
          const glowR = scaledR * 2.8;
          const pulse = 0.4 + 0.3 * Math.sin(Date.now() * 0.014);
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
          ctx.strokeStyle = '#d8e786';
          ctx.lineWidth = Math.max(2, scaledR * 0.12);
          ctx.stroke();
          ctx.restore();
        }
        // Egg cooldown ring — brightens as next egg approaches
        if (mob.queenBeeEggTimer !== undefined) {
          const frac = 1 - mob.queenBeeEggTimer / 5000;
          if (frac > 0.7) {
            const pulse2 = 0.2 + 0.2 * Math.sin(Date.now() * 0.02);
            ctx.save();
            ctx.globalAlpha = pulse2;
            ctx.beginPath();
            ctx.arc(sx, sy, scaledR * 1.7, 0, Math.PI * 2);
            ctx.strokeStyle = '#fffbe6';
            ctx.lineWidth = Math.max(1, scaledR * 0.07);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
      // Bee boss: subtle orbit ring so player knows stingers are coming
      if (mob.typeId === 'bee' && mob.bossStingerTimer !== undefined) {
        const orbitR = scaledR * 2.2;
        const cooldownFrac = Math.max(0, mob.beeStingerTimer ?? 0) / 15000;
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(sx, sy, orbitR, 0, Math.PI * 2);
        ctx.strokeStyle = cooldownFrac < 0.15 ? '#ffdd00' : '#ffffff';
        ctx.lineWidth = Math.max(1, scaledR * 0.08);
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Apply queen bee boss shake offset
    let drawSx = sx, drawSy = sy;
    if (mob.isBoss && mob.typeId === 'queen_bee' && mob.queenBeeShakeAmp) {
      drawSx += (mob.queenBeeShakeOffset ?? 0) * zoomState.v;
    }

    if (mob.typeId === 'spider') {
      drawSpider(ctx, drawSx, drawSy, scaledR, mob.facing ?? 0, mob.legPhase ?? 0, mob.speed);
    } else if (mob.typeId === 'leech' && mob.trail && mob.trail.length >= 2) {
      // Convert the world-space trail to screen space here — mobDrawing.js
      // has no access to camera.js/toScreen itself (by design, it never
      // imports it), so this has to happen on the renderer.js side, same as
      // drawSx/drawSy above for the mob's own head position.
      const screenTrail = mob.trail.map(p => {
        const { sx: tsx, sy: tsy } = toScreen(p.x, p.y, W, H);
        return { x: tsx, y: tsy };
      });
      drawMob(ctx, mob, drawSx, drawSy, scaledR, screenTrail);
    } else {
      drawMob(ctx, mob, drawSx, drawSy, scaledR);
    }

    // ── Damage flash: redraw with red filter on top ──────────────────────────
    if (mob.hurtFlash > 0) {
      mob.hurtFlash = Math.max(0, mob.hurtFlash - dt);
      if (!settings.reduceDamageFlash && mob.hurtFlash > 0) {
        // Draw mob into small offscreen canvas, flood red via source-in, stamp back
        const _half = Math.ceil(scaledR * 2);
        const _size = _half * 2;
        if (_flashCanvas.width  !== _size) _flashCanvas.width  = _size;
        if (_flashCanvas.height !== _size) _flashCanvas.height = _size;
        const _fx = _flashCanvas.getContext('2d');
        _fx.clearRect(0, 0, _size, _size);
        _fx.save();
        _fx.translate(_half - drawSx, _half - drawSy);
        if (mob.typeId === 'spider') {
          drawSpider(_fx, drawSx, drawSy, scaledR, mob.facing ?? 0, mob.legPhase ?? 0, mob.speed);
        } else {
          drawMob(_fx, mob, drawSx, drawSy, scaledR);
        }
        _fx.restore();
        _fx.globalCompositeOperation = 'source-in';
        _fx.fillStyle = '#ff0000';
        _fx.fillRect(0, 0, _size, _size);
        ctx.save();
        ctx.globalAlpha = (mob.hurtFlash / 120) * 0.5;
        ctx.drawImage(_flashCanvas, drawSx - _half, drawSy - _half);
        ctx.restore();
      }
    }

    // ── Hitbox debug overlay (toggle with F) ────────────────────────────────
    if (showHitboxes) {
      const _hAngle = (mob.facing || 0) + Math.PI / 2;
      const _hOx = (mob.hitOffsetX||0) * Math.cos(_hAngle) - (mob.hitOffsetY||0) * Math.sin(_hAngle);
      const _hOy = (mob.hitOffsetX||0) * Math.sin(_hAngle) + (mob.hitOffsetY||0) * Math.cos(_hAngle);
      const hitSX = sx + _hOx * zoomState.v;
      const hitSY = sy + _hOy * zoomState.v;
      const hitR  = mob.radius * zoomState.v;
      ctx.save();
      ctx.strokeStyle = mob.isFriendlyPet ? 'rgba(50, 220, 80, 0.9)' : 'rgba(255, 40, 40, 0.85)';
      ctx.lineWidth   = 1.5;   // fixed screen-space width — never scales with zoomState.v
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(hitSX, hitSY, hitR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Skip health label for undamaged centipede body segments
    const skipLabel = mob.typeId === 'centipede_body' && mob.hp >= mob.maxHp;
    if (!skipLabel) {
      drawEntityLabel(
        ctx, sx, sy, scaledR,
        mob.name, mob.hp, mob.maxHp,
        mob.rarity || null,
        mob.rarity ? RARITY_COLORS[mob.rarity] : null,
        !!mob.isBoss
      );
    }
  }

  if (!player.dead) drawPetalsWorld(ctx, W, H, dt);

  // ── Petal death pop effects ───────────────────────────────────────────────
  for (let i = petalDeathPops.length - 1; i >= 0; i--) {
    const pop = petalDeathPops[i];
    pop.age += dt / 480;
    if (pop.age >= 1) { petalDeathPops.splice(i, 1); continue; }
    const alpha  = (1 - pop.age) * 0.9;
    const scale  = 1 + pop.age * 1.6;
    const radius = pop.r * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = Math.max(1.5, radius * 0.15);
    ctx.beginPath();
    ctx.arc(pop.sx, pop.sy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle   = '#ffffaa';
    ctx.beginPath();
    ctx.arc(pop.sx, pop.sy, radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Missiles (hornet stingers) ────────────────────────────────────────────
  for (const m of missiles) {
    if (m.dead) continue;
    const { sx, sy } = toScreen(m.x, m.y, W, H);
    // Use stingerR (the hornet's radius) so missile proportions match the stinger exactly
    const scaledMobR = (m.stingerR ?? m.radius) * zoomState.v;
    // m.x/y is body center; drawMissile expects the tip position, so offset forward by bodyHalfLen
    const angle = m.angle ?? 0;
    const halfLen = (m.bodyHalfLen ?? 0) * zoomState.v;
    const tipSx = sx + Math.cos(angle) * halfLen;
    const tipSy = sy + Math.sin(angle) * halfLen;
    drawMissile(ctx, tipSx, tipSy, scaledMobR, angle);

    if (showHitboxes) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 160, 40, 0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(sx, sy, m.radius * zoomState.v, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── Jellyfish lightning bolts ──────────────────────────────────────────────
  // Fading bluish line — see jellyfishBolts in mobs.js (pushed by combat.js's
  // updateCombat when it resolves a queued zap) and the fade timer in
  // updateMobs. Drawn as a simple jittered zigzag rather than a straight
  // line so it actually reads as lightning rather than a laser. Uses a
  // cheap two-pass stroke (wide translucent + thin bright core) for the glow
  // look instead of ctx.shadowBlur — shadowBlur is a full blur pass per draw
  // call and gets expensive fast with several bolts on screen at once.
  if (jellyfishBolts.length) {
    const segs = 5;
    for (const b of jellyfishBolts) {
      const alpha = Math.max(0, 1 - b.t / b.lifetime);
      if (alpha <= 0) continue;
      const { sx: bx1, sy: by1 } = toScreen(b.x1, b.y1, W, H);
      const { sx: bx2, sy: by2 } = toScreen(b.x2, b.y2, W, H);
      const jitter = 10 * zoomState.v;
      // Seeded off the bolt's own start point so a single bolt doesn't
      // re-jitter every frame while it fades (would look like static/flicker
      // rather than one crisp flash) — points computed once and reused for
      // both passes below, rather than re-walking the RNG twice.
      let seed = Math.floor(b.x1 * 13 + b.y1 * 7) % 1000;
      const pts = [[bx1, by1]];
      for (let i = 1; i < segs; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        const rx = seed / 233280;
        seed = (seed * 9301 + 49297) % 233280;
        const ry = seed / 233280;
        const t = i / segs;
        pts.push([bx1 + (bx2 - bx1) * t + (rx - 0.5) * jitter, by1 + (by2 - by1) * t + (ry - 0.5) * jitter]);
      }
      pts.push([bx2, by2]);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Wide, faint under-stroke for the glow
      ctx.strokeStyle = '#5ec8ff';
      ctx.globalAlpha = alpha * 0.35;
      ctx.lineWidth = Math.max(3, 6 * zoomState.v);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      // Thin bright core on top
      ctx.strokeStyle = '#c8ecff';
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1.2, 2 * zoomState.v);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Ink Sack explosion rings ───────────────────────────────────────────────
  // Fading, expanding ring at the impact point — see explosionEffects in
  // mobs.js (pushed by combat.js when the blast fires) and the fade timer
  // in updateMobs. Ring grows from 0 to its real explosionRadius over the
  // effect's lifetime so it visibly traces the actual blast area.
  if (explosionEffects.length) {
    for (const e of explosionEffects) {
      const progress = Math.min(1, e.t / e.lifetime);
      const alpha = Math.max(0, 1 - progress);
      if (alpha <= 0) continue;
      const { sx: ex, sy: ey } = toScreen(e.x, e.y, W, H);
      const curR = e.radius * progress * zoomState.v;
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = '#26262e';
      ctx.lineWidth = Math.max(2, 4 * zoomState.v);
      ctx.beginPath();
      ctx.arc(ex, ey, curR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = '#0d0d12';
      ctx.beginPath();
      ctx.arc(ex, ey, curR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Small pop visuals (Bubble breaking) ────────────────────────────────────
  // A quick expand+fade burst at the pop point — see popEffects in mobs.js
  // (pushed by combat.js when a Bubble fires its boost and breaks) and the
  // fade timer in updateMobs. Filled + a bright rim, not a stroked blast
  // ring like Ink Sack's — reads as a small pop, not an explosion.
  if (popEffects.length) {
    for (const p of popEffects) {
      const progress = Math.min(1, p.t / p.lifetime);
      const alpha = Math.max(0, 1 - progress);
      if (alpha <= 0) continue;
      const { sx: px, sy: py } = toScreen(p.x, p.y, W, H);
      const curR = p.radius * (0.4 + progress * 0.9) * zoomState.v;
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = 'rgba(191,232,242,0.9)';
      ctx.beginPath();
      ctx.arc(px, py, curR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, 2 * zoomState.v);
      ctx.beginPath();
      ctx.arc(px, py, curR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Boss bee orbiting stingers ────────────────────────────────────────────
  for (const s of bossStingers) {
    if (s.dead) continue;
    const { sx: ssx, sy: ssy } = toScreen(s.x, s.y, W, H);
    const sr = s.radius * zoomState.v;
    ctx.save();
    ctx.translate(ssx, ssy);
    ctx.rotate(s.orbitAngle + Math.PI / 2); // tip points outward from orbit center
    ctx.beginPath();
    ctx.moveTo(sr, 0);
    ctx.lineTo(-sr * 0.7, -sr * 0.85);
    ctx.lineTo(-sr * 0.7,  sr * 0.85);
    ctx.closePath();
    ctx.fillStyle   = '#181818';
    ctx.fill();
    ctx.strokeStyle = '#666666';
    ctx.lineWidth   = Math.max(1, sr * 0.14);
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.restore();

    if (showHitboxes) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 160, 40, 0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(ssx, ssy, sr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── Boss centipede peas ───────────────────────────────────────────────────
  for (const p of bossPeas) {
    if (p.dead) continue;
    const { sx: psx, sy: psy } = toScreen(p.x, p.y, W, H);
    const pr = p.radius * zoomState.v;
    const peaColor  = p.color  ?? '#66bb6a';
    const peaBorder = p.border ?? '#2e7d32';

    if (p.hurtFlash > 0) { p.hurtFlash = Math.max(0, p.hurtFlash - dt); }

    ctx.save();
    ctx.beginPath();
    ctx.arc(psx, psy, pr, 0, Math.PI * 2);
    ctx.fillStyle   = peaColor;
    ctx.fill();
    ctx.strokeStyle = peaBorder;
    ctx.lineWidth   = Math.max(1, pr * 0.18);
    ctx.stroke();
    ctx.restore();

    if (!settings.reduceDamageFlash && p.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (p.hurtFlash / 120) * 0.6;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ff2200';
      ctx.beginPath();
      ctx.arc(psx, psy, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // HP bar (only if damaged)
    if (p.hp < p.maxHp) {
      const bw = pr * 2.2, bh = Math.max(2, pr * 0.28);
      const bx = psx - bw / 2, by = psy - pr - bh - 3;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#55cc55';
      ctx.fillRect(bx, by, bw * (p.hp / p.maxHp), bh);
    }
  }

  // ── Boss ladybug roses ────────────────────────────────────────────────────
  for (const r of bossRoses) {
    if (r.dead) continue;
    const { sx: rsx, sy: rsy } = toScreen(r.x, r.y, W, H);
    const rr = r.radius * zoomState.v;

    if (r.hurtFlash > 0) { r.hurtFlash = Math.max(0, r.hurtFlash - dt); }

    ctx.save();
    ctx.beginPath();
    ctx.arc(rsx, rsy, rr, 0, Math.PI * 2);
    ctx.fillStyle   = '#f0287a';
    ctx.fill();
    ctx.strokeStyle = '#a0005a';
    ctx.lineWidth   = Math.max(1, rr * 0.18);
    ctx.stroke();
    ctx.restore();

    if (!settings.reduceDamageFlash && r.hurtFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (r.hurtFlash / 120) * 0.6;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = '#ff2200';
      ctx.beginPath();
      ctx.arc(rsx, rsy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // HP bar (only if damaged)
    if (r.hp < r.maxHp) {
      const bw = rr * 2.2, bh = Math.max(2, rr * 0.28);
      const bx = rsx - bw / 2, by = rsy - rr - bh - 3;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ff5566';
      ctx.fillRect(bx, by, bw * (r.hp / r.maxHp), bh);
    }
  }

  // ── Player ────────────────────────────────────────────────────────────────
  const { sx, sy } = toScreen(player.x, player.y, W, H);
  const scaledR    = player.radius * zoomState.v;

  ctx.save();
  if (player.dead && player.deathRotation !== 0) {
    ctx.translate(sx, sy);
    ctx.rotate(player.deathRotation);
    ctx.translate(-sx, -sy);
  }

  // ── Centipede legs accessory — draws under flower ────────────────────────────
  if (!player.dead && hotbar.some(id => id?.startsWith('centipede_legs'))) {
    ctx._legPhase = player.legPhase;
    ctx._legRotation = player.smoothRotation;
    ctx._isIcon = false;  // drawing in world, not icon
    drawPetalShape(ctx, 'centipede_legs', sx, sy, scaledR);
    ctx._legPhase = 0;
    ctx._legRotation = 0;
    ctx._isIcon = false;
  }

  // Disc makes the flower stroke black
  const borderColor = hotbar.some(id => id?.startsWith('disc')) ? '#000000' : player.border;
  // Flash player during spawn invincibility (visible every other 150ms)
  const showPlayer = !player.invincibleTimer || (Math.floor(Date.now() / 150) % 2 === 0);
  if (showPlayer) {
    circle(ctx, sx, sy, scaledR, player.color, borderColor, 3, zoomState.v);

    // ── Damage flash ──────────────────────────────────────────────────────────
    if (player.hurtFlash > 0) {
      player.hurtFlash = Math.max(0, player.hurtFlash - dt);
      if (!settings.reduceDamageFlash && player.hurtFlash > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, scaledR, 0, Math.PI * 2);
        ctx.clip();
        circle(ctx, sx, sy, scaledR, player.color, borderColor, 3, zoomState.v);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = (player.hurtFlash / 120) * 0.6;
        ctx.fillStyle = '#ff2200';
        ctx.fillRect(sx - scaledR, sy - scaledR, scaledR * 2, scaledR * 2);
        ctx.restore();
      }
    }
  }

  // ── Cutter accessory — animated saw ring around the flower body ─────────────
  if (!player.dead && hotbar.some(id => id?.startsWith('cutter'))) {
    ctx._cutterRot = cutterRot;
    if (showPlayer) drawPetalShape(ctx, 'cutter', sx, sy, scaledR * 1.14);
    ctx._cutterRot = 0;
  }

  if (player.dead) {
    drawDeadFace(ctx, sx, sy, scaledR);
  } else if (showPlayer) {
    // expand (Space/LMB) = attacking -> sad face
    // retract (Shift/RMB) = defending -> angry face
    updateFace(dt, player.moveAngle ?? 0, inputState.expand, inputState.retract, isMoving);
    drawFlowerFace(ctx, sx, sy, scaledR);
  } else {
    // still update face state even when flashed invisible
    updateFace(dt, player.moveAngle ?? 0, inputState.expand, inputState.retract, isMoving);
  }

  ctx.restore();

  // ── Third eye accessory — on forehead ─────────────────────────────────────────
  if (!player.dead && hotbar.some(id => id?.startsWith('third_eye'))) {
    drawThirdEyeAccessory(ctx, sx, sy, scaledR);
  }

  // ── Accessory petals — drawn on flower body, not in orbit ──────────────────
  if (!player.dead && hotbar.some(id => id && (id === 'antennae' || id.startsWith('antennae_')))) {
    drawPetalShape(ctx, 'antennae', sx, sy, scaledR);
  }

  // ── Player hitbox overlay ────────────────────────────────────────────────
  if (showHitboxes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 180, 255, 0.9)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(sx, sy, player.radius * zoomState.v, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawEntityLabel(ctx, sx, sy, scaledR, player.name, player.hp, player.maxHp, null, null, false, player.shield, player.maxShield, true);

  // ── HUD ────────────────────────────────────────────────────────────────────
  if (settings.statBoxes) {
    drawMobHUD(ctx, W, player.x, player.y, dt, HUD_PAD_TOP);
  }
  _drawBossBanner(ctx, W, H, dt);
  _drawMinimap(ctx, W, H);

  drawMobTooltip(ctx, W, H, hudLive, HUD_BOX, dt);
  drawPetalTooltip(ctx, W, H, dt);
  drawDamagePopups(ctx, W, H);
  updateHotbar(ctx, W, H);
  updateInventory();
  updateSettingsCog(performance.now());

  // ── Player level HUD (top-left) ───────────────────────────────────────────
  if (!player.dead) {
    levelHUD.draw(ctx, W, H, dt, player.hp, player.maxHp);
  }
}