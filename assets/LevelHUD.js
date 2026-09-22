/**
 * LevelHUD.js — top-left in-game status HUD
 *
 * Layout:
 *
 *   [● flower ●]  [██████████░░░  HP  ]
 *   [_________][████░░░  Lvl N  ]        ← connector pill bridges flower→lvl, no gap
 */

import { drawFlowerFaceParams, circle, cutterRot } from './renderer.js';
import { drawPetalShape, drawThirdEyeAccessory } from './petalDrawing.js';
import { mousePos }                      from './ui.js';
import { inputState }                    from './inputState.js';
import { player, isMoving }              from './player.js';
import { hotbar }                          from './petals.js';
import {
  levelFromXp,
  xpForLevel,
  totalXpForLevel,
} from './leveling.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

function fmt(n) {
  n = Math.max(0, Math.floor(n));
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
// Cog: top 16 + height 54 + border 3 = 73px bottom. We sit 17px below that.

const PAD_X    = 12;         // HUD left edge
const PAD_Y    = 92;         // HUD top edge

const FLOWER_R = 28;         // flower body radius
const GAP      = 8;          // gap between flower right edge and pill left edge

// HP pill
const HP_W     = 150;
const HP_H     = 24;
// Shield overlay — thin bar hugging the bottom edge of the HP pill, only
// drawn when the player actually has any shield capacity.
// Shield overlay — white layer painted on top of the HP fill
const SHIELD_FILL = 'rgba(255, 255, 255, 0.55)';
// LVL pill — narrower, centered under HP pill
const LVL_W    = 116;
const LVL_H    = 18;
const PILL_GAP = 0;          // no gap — strokes kiss, zero overlap

// Derived positions
const PILL_X    = PAD_X + FLOWER_R * 2 + GAP;     // left edge of both pills

// HP bar Y first — flower center is derived from it so eyes line up
const HP_Y      = PAD_Y + FLOWER_R;               // top of HP pill
// Flower center = HP bar vertical center  →  eyes level with HP bar
const FLOWER_CX = PAD_X + FLOWER_R;
const FLOWER_CY = HP_Y + HP_H / 2;                // eyes level with HP center

// LVL bar: directly below HP, no gap, centered horizontally under it
const LVL_Y     = HP_Y + HP_H + PILL_GAP;
const LVL_X     = PILL_X + (HP_W - LVL_W) / 2;

// Connector: same row as HP pill, extends from under the flower all the way to
// beyond the HP pill right edge. Taller than HP pill (overhangs top and bottom)
// so it reads as a visible backing plate. HP pill stroke renders on top.
const CONN_EXTRA_H   = 6;                          // extra height above+below HP pill
const CONN_OVERSHOOT = 4;                           // px past HP pill right edge stroke
const CONN_X  = FLOWER_CX;                         // left end hidden under flower
const CONN_W  = PILL_X - CONN_X + HP_W + CONN_OVERSHOOT; // full HP width + just past stroke
const CONN_Y  = HP_Y - CONN_EXTRA_H / 2;          // taller: hangs above HP pill
const CONN_H  = HP_H + CONN_EXTRA_H;              // taller: hangs below HP pill

// Colours
const HP_BG    = '#2a2a2a';
const HP_FILL  = '#75dd34';
const LVL_BG   = '#2a2a2a';
const LVL_FILL = '#e2eb67';

// ─────────────────────────────────────────────────────────────────────────────
// LevelHUD class
// ─────────────────────────────────────────────────────────────────────────────

class LevelHUD {
  constructor() {
    this.xp         = 0;
    this.level      = 0;
    this._renderXp  = 0;
    this._renderHp  = 0;
    this._initAnim  = 0;

    // Face state — mirrors renderer's face object exactly
    this._attackT     = 0;
    this._defendT     = 0;
    this._hudEyeAngle = 0;

    this._ready = false;
  }

  init(xp = 0) {
    this.xp        = xp;
    this.level     = Math.floor(levelFromXp(xp));
    this._renderXp = xp;
    this._ready    = true;
    this._initAnim = 0;
  }

  addXp(amount) {
    this.xp    = Math.max(0, this.xp + amount);
    this.level = Math.floor(levelFromXp(this.xp));
  }

  // ── Main draw ──────────────────────────────────────────────────────────────
  draw(ctx, W, H, dt, playerHp, maxHp) {
    if (!this._ready) return;

    // Slide-in from the left on init/respawn
    this._initAnim = lerp(this._initAnim, 1, 0.055);
    const slideX   = (1 - this._initAnim) * -220;

    ctx.save();
    ctx.translate(slideX, 0);

    // Smooth interpolation
    const spd      = Math.min(1, 0.07 * (dt / 16));
    this._renderXp = lerp(this._renderXp, this.xp,   spd);
    this._renderHp = lerp(this._renderHp, playerHp,  spd * 1.4);

    // ── Face expression + eye-direction state ────────────────────────────────
    const FACE_SPD = 0.012;
    const fk = 1 - Math.pow(1 - FACE_SPD, dt);

    this._attackT += ((inputState.expand  ? 1 : 0) - this._attackT) * fk;
    this._defendT += ((inputState.retract ? 1 : 0) - this._defendT) * fk;

    if (isMoving) {
      let da = player.moveAngle - this._hudEyeAngle;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this._hudEyeAngle += da * fk;
    }

    // ── Connector pill (drawn first so flower renders on top) ───────────────
    this._drawConnector(ctx);

    // ── Flower ──────────────────────────────────────────────────────────────
    this._drawFlower(ctx);

    // ── HP pill ─────────────────────────────────────────────────────────────
    const hpPct   = Math.max(0, Math.min(1, this._renderHp / maxHp));
    const adjMx   = mousePos.x - slideX;
    const hoverHp = this._isOver(adjMx, mousePos.y, PILL_X, HP_Y, HP_W, HP_H);
    const hasShield = player.maxShield > 0;
    // "X + X" (current HP + current shield) when a shield source is
    // equipped, or just "X" (current HP) when there's none — per
    // instruction. No maxHP/labels shown in this format.
    const hpLabel = hasShield
      ? `${fmt(hoverHp ? playerHp : this._renderHp)} + ${fmt(player.shield)}`
      : `${fmt(hoverHp ? playerHp : this._renderHp)}`;
    this._drawPill(ctx, PILL_X, HP_Y, HP_W, HP_H, hpPct, HP_FILL, HP_BG, hpLabel, 13, 'rgba(0,0,0,0.90)');

    // ── Shield overlay — clear gray layer painted on top of the HP fill,
    // covering the same fraction of the bar as shield/maxShield. Only shown
    // once the player has any shield capacity. ─────────────────────────────
    if (hasShield) {
      const shieldPct = Math.max(0, Math.min(1, player.shield / player.maxShield));
      this._drawShieldOverlay(ctx, PILL_X, HP_Y, HP_W, HP_H, shieldPct);
    }

    // ── Level / XP pill ─────────────────────────────────────────────────────
    const contLvl  = levelFromXp(this._renderXp);
    const intLvl   = Math.floor(contLvl);
    const xpFrac   = contLvl % 1;
    const xpStart  = totalXpForLevel(intLvl);
    const xpEnd    = xpStart + xpForLevel(intLvl + 1);
    const hoverLvl = this._isOver(adjMx, mousePos.y, LVL_X, LVL_Y, LVL_W, LVL_H);
    const lvlLabel = hoverLvl
      ? `${fmt(this.xp)} / ${fmt(xpEnd)} XP`
      : `Lvl ${intLvl + 1}`;
    this._drawPill(ctx, LVL_X, LVL_Y, LVL_W, LVL_H, xpFrac, LVL_FILL, LVL_BG, lvlLabel, 11, 'rgba(0,0,0,0.90)');

    ctx.restore();
  }

  // ── Flower draw ─────────────────────────────────────────────────────────────
  _drawFlower(ctx) {
    const cx = FLOWER_CX, cy = FLOWER_CY, r = FLOWER_R;

    // ── Centipede legs — drawn under body ──────────────────────────────────
    if (hotbar.some(id => id?.startsWith('centipede_legs'))) {
      ctx._legPhase    = player.legPhase;
      ctx._legRotation = player.smoothRotation;
      ctx._isIcon      = false;
      drawPetalShape(ctx, 'centipede_legs', cx, cy, r);
      ctx._legPhase = 0; ctx._legRotation = 0;
    }

    // ── Body — disc makes stroke black ─────────────────────────────────────
    const borderColor = hotbar.some(id => id?.startsWith('disc')) ? '#000000' : player.border;
    circle(ctx, cx, cy, r, player.color, borderColor, 3, 1);

    // ── Cutter — animated saw ring ─────────────────────────────────────────
    if (hotbar.some(id => id?.startsWith('cutter'))) {
      ctx._cutterRot = cutterRot;
      drawPetalShape(ctx, 'cutter', cx, cy, r * 1.14);
      ctx._cutterRot = 0;
    }

    // ── Face ───────────────────────────────────────────────────────────────
    drawFlowerFaceParams(ctx, cx, cy, r,
      this._attackT, this._defendT, this._hudEyeAngle, 1);

    // ── Third eye — on forehead (drawn after face) ─────────────────────────
    if (hotbar.some(id => id?.startsWith('third_eye'))) {
      drawThirdEyeAccessory(ctx, cx, cy, r);
    }

    // ── Antennae ───────────────────────────────────────────────────────────
    if (hotbar.some(id => id && (id === 'antennae' || id.startsWith('antennae_')))) {
      drawPetalShape(ctx, 'antennae', cx, cy, r);
    }
  }

  // ── Connector pill draw ─────────────────────────────────────────────────────
  // Fills the gap between the flower and the HP pill using HP_BG color.
  // Left end starts at FLOWER_CX and is hidden under the flower body.
  // Right end butts flush against the HP pill left edge.
  _drawConnector(ctx) {
    const r = CONN_H / 2;
    ctx.save();
    ctx.fillStyle = HP_BG;
    ctx.beginPath();
    ctx.roundRect(CONN_X, CONN_Y, CONN_W, CONN_H, r);
    ctx.fill();
    ctx.restore();
  }

  // ── Pill draw ───────────────────────────────────────────────────────────────
  _drawPill(ctx, x, y, w, h, fraction, fillColor, bgColor, label, fontSize, strokeColor = 'rgba(255,255,255,0.10)') {
    const r  = h / 2;
    const pd = 3;
    const iw = w - pd * 2;
    const ih = h - pd * 2;
    const ir = ih / 2;

    ctx.save();

    // Background pill
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // Subtle inner border ring
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();

    // Fill bar — clipped to inner pill shape
    if (fraction > 0.001) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + pd, y + pd, iw, ih, ir);
      ctx.clip();
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(x + pd, y + pd, Math.max(ir * 2, fraction * iw), ih, ir);
      ctx.fill();
      ctx.restore();
    }

    // Label
    ctx.font         = `900 ${fontSize}px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const lx = x + w / 2, ly = y + h / 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.80)';
    ctx.lineWidth   = 2.5;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillText(label, lx, ly);

    ctx.restore();
  }

  // ── Shield overlay — a clear/translucent gray layer painted directly on
  // top of the green HP fill (not a separate strip), covering the same
  // ── Shield overlay — white layer painted directly on top of the HP fill,
  // covering the same proportion of the bar as shield/maxShield. Reads as
  // "a white coating over your health" rather than a second resource track
  // — shield sits in front of HP in the damage order, so it visually sits
  // in front here too. Clips against the SAME inner rounded-rect the HP
  // fill itself clips against (x+pd, y+pd, iw, ih, ir) — not the pill's
  // outer shape — so its edges round off exactly like the HP bar's do.
  // `pct` is shield/maxShield, drawn left-to-right from the same origin the
  // HP fill uses so the two overlap rather than sitting side by side.
  _drawShieldOverlay(ctx, x, y, w, h, pct) {
    if (pct <= 0.001) return;
    const pd = 3;
    const iw = w - pd * 2;
    const ih = h - pd * 2;
    const ir = ih / 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + pd, y + pd, iw, ih, ir);
    ctx.clip();
    ctx.fillStyle = SHIELD_FILL;
    ctx.beginPath();
    ctx.roundRect(x + pd, y + pd, Math.max(ir * 2, pct * iw), ih, ir);
    ctx.fill();
    ctx.restore();
  }


  _isOver(mx, my, rx, ry, rw, rh) {
    return mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh;
  }
}

export const levelHUD = new LevelHUD();
