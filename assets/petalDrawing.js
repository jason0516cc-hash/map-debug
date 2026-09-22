/**
 * petalDrawing.js — Math-based petal shape drawing.
 *
 * All petals are drawn with canvas 2D primitives — no images or spritesheets.
 * Each petal type has its own draw function keyed by spriteIndex so petalTypes.js
 * can stay unchanged.
 *
 * drawPetalShape(ctx, typeId, cx, cy, r)
 *   — used by the world renderer (orbiting petals, world drops)
 *
 * drawInventoryIcon(canvasEl, typeId)
 *   — used by the UI (hotbar + inventory icon canvases)
 *   — canvas must already be sized correctly (CSS size × DPR for physical px)
 *
 * Size scaling:
 *   DRAW_SCALE[spriteIndex] multiplies the incoming r before drawing.
 *   This lets light (~0.50) and faster (~0.60) appear visually smaller than
 *   basic (1.0) in both the world and the UI without touching petalTypes.js.
 *   basic  = 1.00  →  full radius
 *   faster = 0.60  →  20% bigger than light
 *   light  = 0.50  →  ~50% of basic
 *   all others = 1.0
 */

import { PETAL_TYPES } from './petalTypes.js';

// ── Icon overrides (inv / hotbar / drops only — world drawing is unaffected) ──
// rot   : rotation in degrees applied to the petal drawing
// scale : multiplier on top of DRAW_SCALE (1.0 = no extra change)
// ox/oy : pixel offset of the petal centre from the canvas centre (in CSS px,
//         automatically scaled by DPR inside drawInventoryIcon)
// nameSize : unused at runtime but kept for reference / future use
// ── Animated icons ────────────────────────────────────────────────────────
// Icons are normally drawn once and cached as a static canvas (see
// HotbarUI.js's getIcon()) since re-drawing every icon every frame would be
// wasteful. A handful of petals have genuinely time-based art (Powder's
// wandering/flickering dots being the first) that looks wrong frozen at
// whatever instant it happened to be cached — this registry tells the
// caching layer which typeIds to skip caching for, so they redraw fresh on
// every call instead (the hotbar/inventory already call drawInventoryIcon
// every frame via ctx.drawImage, so this alone is enough to "animate" them,
// no separate animation loop needed). Matched by the base petal id (the
// part before the rarity suffix), so every tier of an animated petal
// animates, not just one.
const ANIMATED_ICON_BASE_IDS = new Set(['powder']);

/** True if this typeId's icon should redraw fresh every call instead of
 *  being cached as a static image — see ANIMATED_ICON_BASE_IDS above. */
export function isAnimatedIcon(typeId) {
  if (!typeId) return false;
  const base = typeId.replace(/_(common|unusual|rare|epic|legendary|mythic|ultra|super|radiant|mystic|runic|seraphic|umbral|impracticality)$/, '');
  return ANIMATED_ICON_BASE_IDS.has(base);
}

const ICON_OVERRIDES = {
  "Basic":          { rot: 0, scale: 0.54, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Faster":         { rot: 0, scale: 0.55, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Light":          { rot: 0, scale: 0.40, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Pollen":         { rot: 0, scale: 0.50, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Rose":           { rot: 0, scale: 0.50, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Stinger":        { rot: 0, scale: 0.40, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Web":            { rot: 0, scale: 0.55, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Poison":         { rot: 0, scale: 0.50, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Leaf":           { rot: 15, scale: 0.44, ox: 5.0, oy: -4.0, nameSize: 2.00 },
  "Centipede Legs": { rot: 0, scale: 0.50, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Peas":           { rot: -29, scale: 0.35, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Third Eye":      { rot: 0, scale: 0.25, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Clover":         { rot: 51, scale: 0.40, ox: 2.0, oy: -4.0, nameSize: 2.00 },
  "Wing":           { rot: 0, scale: 0.45, ox: 0.5, oy: 0.0, nameSize: 2.00 },
  "Rice":           { rot: 162, scale: 0.60, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Ant Egg":        { rot: 0, scale: 0.45, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Disc":           { rot: 0, scale: 0.39, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Cutter":         { rot: 0, scale: 0.40, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Digger Egg":     { rot: 0, scale: 0.52, ox: 0.0, oy: -1.0, nameSize: 2.00 },
  "Soil":           { rot: 36, scale: 0.40, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Magnet":         { rot: 0, scale: 0.40, ox: 0.5, oy: -3.0, nameSize: 2.00 },
  "Honey":          { rot: 0, scale: 0.45, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Bee Egg":        { rot: 0, scale: 0.45, ox: 0.0, oy: -1.0, nameSize: 2.00 },
  "Honeycomb":      { rot: 0, scale: 0.65, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Antennae":       { rot: 0, scale: 0.81, ox: 0.0, oy: 14.0, nameSize: 2.00 },
  "Orange":         { rot: -2, scale: 0.23, ox: -5.0, oy: -10.5, nameSize: 2.00 },
  "Missile":        { rot: 315, scale: 0.35, ox: 1.0, oy: -3.0, flipX: true, nameSize: 2.00 },
  "Beetle Egg":     { rot: 0, scale: 0.50, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Pincer":         { rot: 86, scale: 0.40, ox: 3.5, oy: -4.0, nameSize: 2.00 },
  "Bone":           { rot: 0, scale: 0.40, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Iris":           { rot: 0, scale: 0.35, ox: 0.0, oy: -5.0, nameSize: 2.00 },
  "Sand":           { rot: 0, scale: 0.35, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Stick":          { rot: 20, scale: 0.50, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Salt":           { rot: 115, scale: 0.50, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Corn":           { rot: 0, scale: 0.58, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Blood Corn":     { rot: 0, scale: 0.58, ox: 0.0, oy: -4.0, nameSize: 2.00 },
  "Blood Leaf":     { rot: 15, scale: 0.69, ox: 5.0, oy: -4.0, nameSize: 2.00 },
  "Blood Wing":     { rot: 0, scale: 0.52, ox: 0.5, oy: 0.0, nameSize: 2.00 },
  "Jellyfish Egg":  { rot: 0, scale: 0.40, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Jelly":          { rot: 0, scale: 0.46, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Ink":            { rot: 0, scale: 0.75, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Tentacle":       { rot: 217, scale: 0.86, ox: 0.0, oy: -5.0, nameSize: 2.00 },
  "Ink Sack":       { rot: 0, scale: 0.65, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Claw":           { rot: 141, scale: 1.05, ox: 0.0, oy: -2.5, nameSize: 2.00 },
  "Carapace":       { rot: 0, scale: 0.50, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Starfish":       { rot: 0, scale: 0.80, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Coral":          { rot: 345, scale: 0.58, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Pearl":          { rot: 0, scale: 0.60, ox: 0.0, oy: -3.0, nameSize: 2.00 },
  "Shell":          { rot: 267, scale: 0.60, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Ocean Artifact": { rot: 0, scale: 0.55, ox: 0.0, oy: -1.0, nameSize: 2.00 },
  "Sponge":         { rot: 0, scale: 0.50, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Air":            { rot: 0, scale: 1.00, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Bubble":         { rot: 0, scale: 0.46, ox: 0.0, oy: -4.5, nameSize: 2.00 },
  "Fang":           { rot: 0, scale: 0.86, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Rock":           { rot: 0, scale: 0.69, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Dandelion":      { rot: 0, scale: 0.90, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Compass":        { rot: 40, scale: 0.56, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Metal":          { rot: 102, scale: 0.63, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Scales":         { rot: 90, scale: 0.60, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Tooth":          { rot: 335, scale: 0.55, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Glass":          { rot: 330, scale: 0.45, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Powder":         { rot: 0, scale: 1.30, ox: 0.0, oy: -2.0, nameSize: 2.00 },
  "Moon":           { rot: 0, scale: 0.75, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Heavy":          { rot: 0, scale: 0.58, ox: 0.0, oy: 0.0, nameSize: 2.00 },
  "Lightning":      { rot: 0, scale: 0.40, ox: 0.0, oy: 0.0, nameSize: 2.00 },
};

// ── Visual size scale per spriteIndex ─────────────────────────────────────────
// 1.0 = use the full r passed in. Tune only where visuals should differ from
// the physics radius.
const DRAW_SCALE = [
  1.00, // ✅0 basic
  0.75, // ✅1 faster  
  0.95, // ✅2 light   
  0.95, // ✅3 pollen  
  0.80, // ✅4 rose    
  1.00, // ✅5 stinger
  1.00, // ✅6 web
  0.90, // ✅7 poison
  2.00, // ✅8 leaf
  1.00, // ✅9 centipede_legs
  1.50, // ✅10 peas
  1.00, // ✅11 third_eye
  1.50, // ✅12 clover
  1.00, // ✅13 wing
  1.00, // ✅14 rice
  1.00, // ✅15 ant_egg
  1.00, // ✅16 disc
  1.00, // ✅17 cutter
  1.00, // ✅18 digger_egg
  1.00, // ✅19 soil
  2.00, // ✅20 magnet
  1.00, // ✅21 honey
  1.00, // ✅22 bee_egg
  1.00, // ✅23 honeycomb
  1.00, // ✅24 antennae
  1.75, // ✅25 orange
  2.00, // ✅26 missile
  1.00, // 🆕27 beetle_egg
  1.50, // 🆕28 pincer — in-world size bumped 1.5x (icon size handled separately via ICON_OVERRIDES)
  2.00, // 🆕29 bone — in-world size doubled
  1.00, // 🆕30 iris
  1.50, // 🆕31 sand — matches peas' scale since drawSand now uses the same 4-circle layout/sizing
  1.65, // 🆕32 stick — bigger in-world (bumped up again)
  1.00, // 🆕33 salt
];

// ── Per-type draw functions ───────────────────────────────────────────────────
// Each receives (ctx, cx, cy, r) where r is already scaled by DRAW_SCALE.

function drawBasic(ctx, cx, cy, r) {
  // White fill, soft gray stroke — matches the in-game sprite.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#c8c8c8';
  ctx.lineWidth   = Math.max(1, r * 0.18);
  ctx.stroke();
}

function drawFaster(ctx, cx, cy, r) {
  // White fill like basic, stroke with slight orange tint
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#d8c8c8'; // Gray with slight orange tint
  ctx.lineWidth   = Math.max(1, r * 0.18);
  ctx.stroke();
}

function drawLight(ctx, cx, cy, r) {
  const count = ctx._lightCount ?? 1;

  function drawOnePellet(px, py, pr) {
    ctx.beginPath();
    ctx.arc(px, py, pr + pr * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#c8c8c8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  if (count === 1) { drawOnePellet(cx, cy, r); return; }

  const targetChord = 0.665;
  const off = (targetChord / (2 * Math.sin(Math.PI / count))) * r;
  const pr  = (count <= 3 ? 0.70 : count <= 5 ? 0.60 : count <= 6 ? 0.52 : 0.46) * r;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    drawOnePellet(cx + Math.cos(a) * off, cy + Math.sin(a) * off, pr);
  }
}

function drawPollen(ctx, cx, cy, r) {
  // Solid yellow circle with a darker orange-yellow stroke — matches sprite.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = '#f5c932';
  ctx.fill();
  ctx.strokeStyle = '#c8920a';
  ctx.lineWidth   = Math.max(1, r * 0.18);
  ctx.stroke();
}

function drawRose(ctx, cx, cy, r) {
  // Solid bright magenta/pink circle with a deeper pink stroke — matches sprite.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = '#f0287a';
  ctx.fill();
  ctx.strokeStyle = '#a0005a';
  ctx.lineWidth   = Math.max(1, r * 0.18);
  ctx.stroke();
}

function drawIris(ctx, cx, cy, r) {
  // Same build as Rose — solid circle with a stroke — but purple and
  // smaller, with a notably thick border relative to its size.
  const ir = r * 0.75;
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fillStyle   = '#8b3fc4';
  ctx.fill();
  ctx.strokeStyle = '#5e1a8f';
  ctx.lineWidth   = Math.max(1, ir * 0.5);
  ctx.stroke();
}

function drawSand(ctx, cx, cy, r) {
  // Four plain circles in a tight 2×2 grid, same layout/size as drawPeas,
  // using Sand's own yellow/gold palette. This is the icon + ground-drop
  // render; the actual orbiting in-game pieces use drawSandPiece instead.
  const sandR = r * 0.38; // slightly smaller than Peas' 0.43
  const off   = sandR * 1.15; // pulled a bit closer together than Peas' 1.4x spacing

  const positions = [
    [-off, -off],
    [ off, -off],
    [-off,  off],
    [ off,  off],
  ];

  for (const [px, py] of positions) {
    // border
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, sandR + sandR * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#d6b700';
    ctx.fill();
    // fill
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, sandR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdc00';
    ctx.fill();
  }
}

function drawStinger(ctx, cx, cy, r) {
  const angle = ctx._stingerAngle ?? 0;  // radians; 0 = tip points right
  const tipR  = r;
  const baseR = r * 0.7;
  const halfH = r * 0.85;

  ctx.save();
  ctx.translate(cx, cy);
  if (angle !== 0) ctx.rotate(angle);

  ctx.beginPath();
  ctx.moveTo( tipR, 0);
  ctx.lineTo(-baseR, -halfH);
  ctx.lineTo(-baseR,  halfH);
  ctx.closePath();

  ctx.fillStyle   = '#181818';
  ctx.fill();
  ctx.strokeStyle = '#666666';
  ctx.lineWidth   = Math.max(1, r * 0.14);
  ctx.lineJoin    = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawWeb(ctx, cx, cy, r) {
  // 5-pointed concave star with ~15 silk lines radiating inward to a small center circle.
  const N      = 5;
  const bulge  = r * 0.40;
  const rotate = -Math.PI / 2 - (Math.PI * 2 * 0.05);
  const innerR = r * 0.10;

  function tip(i) {
    const a = rotate + (Math.PI * 2 / N) * i;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }
  function concavePoint(i) {
    const a = rotate + (Math.PI * 2 / N) * i + Math.PI / N;
    return [cx + Math.cos(a) * (r - bulge), cy + Math.sin(a) * (r - bulge)];
  }

  // Build star path helper (reused for fill + clip)
  function starPath() {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const [x0, y0] = tip(i);
      const [x1, y1] = tip((i + 1) % N);
      const [cpx, cpy] = concavePoint(i);
      if (i === 0) ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cpx, cpy, x1, y1);
    }
    ctx.closePath();
  }

  // Fill star
  starPath();
  ctx.fillStyle   = '#e0e0e0';
  ctx.fill();
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth   = Math.max(1, r * 0.07);
  ctx.stroke();

  // Clip silk lines to star interior
  ctx.save();
  starPath();
  ctx.clip();

  ctx.lineCap     = 'round';
  ctx.strokeStyle = 'rgba(130,130,130,0.60)';
  ctx.lineWidth   = Math.max(0.6, r * 0.045);

  // ~20 source points: tips + concave points + 2 extras per segment
  const sources = [];
  for (let i = 0; i < N; i++) {
    sources.push(tip(i));
    sources.push(concavePoint(i));
    const ha1 = rotate + (Math.PI * 2 / N) * i + Math.PI / N * 0.5;
    const ha2 = rotate + (Math.PI * 2 / N) * i + Math.PI / N * 1.5;
    sources.push([cx + Math.cos(ha1) * r * 0.80, cy + Math.sin(ha1) * r * 0.80]);
    sources.push([cx + Math.cos(ha2) * r * 0.80, cy + Math.sin(ha2) * r * 0.80]);
  }

  for (const [sx, sy] of sources) {
    const angle = Math.atan2(sy - cy, sx - cx);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.stroke();
  }

  ctx.restore();

  // Small center circle
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle   = '#d0d0d0';
  ctx.fill();
  ctx.strokeStyle = '#999999';
  ctx.lineWidth   = Math.max(0.6, r * 0.04);
  ctx.stroke();
}

function drawClover(ctx, cx, cy, r) {
  // Three hearts with tips meeting at center, stem below.
  // Geometry ported from SVG (viewBox 680×340, cluster center 340,160).
  // All coords are normalized: subtract (340,160), then scale by r/50.
  const S = r / 50;

  // Draws one heart using its SVG matrix transform, origin shifted to (340,160).
  function drawHeart(mat) {
    const [a, b, c, d, e, f] = mat;
    const pt = (x, y) => [cx + (a * x + c * y + e) * S, cy + (b * x + d * y + f) * S];

    const [mx, my] = pt(11.22, 0);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    let p;
    p = [...pt(5.576,0), ...pt(0.192,4.775), ...pt(0.005,12.257)];
    ctx.bezierCurveTo(...p);
    p = [...pt(-0.182,19.764), ...pt(4.867,29.87), ...pt(20.13,40.173)];
    ctx.bezierCurveTo(...p);
    p = [...pt(35.401,29.879), ...pt(40.402,19.764), ...pt(40.165,12.257)];
    ctx.bezierCurveTo(...p);
    p = [...pt(39.913,4.301), ...pt(36.403,0.098), ...pt(27.753,0.098)];
    ctx.bezierCurveTo(...p);
    p = [...pt(22.801,0.098), ...pt(21.05,3.557), ...pt(20.032,5.994)];
    ctx.bezierCurveTo(...p);
    p = [...pt(19.022,3.557), ...pt(16.856,0), ...pt(11.22,0)];
    ctx.bezierCurveTo(...p);
    ctx.closePath();
  }

  // SVG matrices with origin shifted to cluster center (340, 160)
  const mats = [
    [-0.8192, -0.5736,  0.5736, -0.8192, 333.44 - 340, 204.24 - 160],
    [ 0.9063, -0.4226,  0.4226,  0.9063, 304.97 - 340, 132.20 - 160],
    [-0.0872,  0.9962, -0.9962, -0.0872, 381.59 - 340, 143.56 - 160],
  ];

  // Stem (polyline) — drawn first so hearts layer on top
  const stemPts = [
    [0, 0], [6.39, 8.36], [11.31, 17.22], [12.79, 28.04],
    [11.81, 38.86], [6.89, 48.2], [0.98, 56.57],
  ];
  ctx.beginPath();
  ctx.moveTo(cx + stemPts[0][0] * S, cy + stemPts[0][1] * S);
  for (let i = 1; i < stemPts.length; i++) {
    ctx.lineTo(cx + stemPts[i][0] * S, cy + stemPts[i][1] * S);
  }
  ctx.strokeStyle = '#689a10';
  ctx.lineWidth   = Math.max(0.5, r * 0.10);
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'miter';
  ctx.stroke();

  // Hearts — fill then stroke
  for (const mat of mats) {
    drawHeart(mat);
    ctx.fillStyle = '#83b925';
    ctx.fill();
    ctx.strokeStyle = '#689a10';
    ctx.lineWidth   = Math.max(1, r * 0.05);
    ctx.lineCap     = 'round';
    ctx.stroke();
  }
}

function drawWing(ctx, cx, cy, r) {
  // Wing drawn from the SVG path.
  // Bounding box of path: x[133.84, 350.02], y[97.10, 331.82]
  // True visual centre: x=241.93, y=214.46
  const SVG_CX = 241.93;
  const SVG_CY = 214.46;
  const SVG_SCALE = 90; // px per "r" unit

  const s = r / SVG_SCALE;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ctx._wingRot ?? 0);
  ctx.scale(s, s);

  // The single wing outline path, translated so its visual centre is at origin.
  const ox = -SVG_CX;
  const oy = -SVG_CY;

  ctx.beginPath();
  ctx.moveTo(133.83716 + ox, 281.13037 + oy);
  ctx.bezierCurveTo(
    133.83716 + ox, 281.13037 + oy,
    204.63279 + ox, 282.84173 + oy,
    250.06760 + ox, 225.92091 + oy
  );
  ctx.bezierCurveTo(
    296.50852 + ox, 167.73961 + oy,
    282.03097 + ox,  97.09884 + oy,
    282.03097 + ox,  97.09884 + oy
  );
  ctx.bezierCurveTo(
    282.03097 + ox,  97.09884 + oy,
    350.02443 + ox, 177.17357 + oy,
    299.46554 + ox, 248.19842 + oy
  );
  ctx.bezierCurveTo(
    239.94121 + ox, 331.81785 + oy,
    133.83716 + ox, 281.13037 + oy,
    133.83716 + ox, 281.13037 + oy
  );
  ctx.closePath();

  ctx.fillStyle = 'rgba(227, 213, 186, 0.55)';
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = 4.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawBloodWing(ctx, cx, cy, r) {
  // Same wing silhouette/path as drawWing, recolored: translucent red fill
  // instead of tan, dark red-black stroke instead of pure black.
  const SVG_CX = 241.93;
  const SVG_CY = 214.46;
  const SVG_SCALE = 90;

  const s = r / SVG_SCALE;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ctx._wingRot ?? 0);
  ctx.scale(s, s);

  const ox = -SVG_CX;
  const oy = -SVG_CY;

  ctx.beginPath();
  ctx.moveTo(133.83716 + ox, 281.13037 + oy);
  ctx.bezierCurveTo(
    133.83716 + ox, 281.13037 + oy,
    204.63279 + ox, 282.84173 + oy,
    250.06760 + ox, 225.92091 + oy
  );
  ctx.bezierCurveTo(
    296.50852 + ox, 167.73961 + oy,
    282.03097 + ox,  97.09884 + oy,
    282.03097 + ox,  97.09884 + oy
  );
  ctx.bezierCurveTo(
    282.03097 + ox,  97.09884 + oy,
    350.02443 + ox, 177.17357 + oy,
    299.46554 + ox, 248.19842 + oy
  );
  ctx.bezierCurveTo(
    239.94121 + ox, 331.81785 + oy,
    133.83716 + ox, 281.13037 + oy,
    133.83716 + ox, 281.13037 + oy
  );
  ctx.closePath();

  ctx.fillStyle = 'rgba(138, 15, 22, 0.65)';
  ctx.fill();
  ctx.strokeStyle = '#2a0304';
  ctx.lineWidth   = 4.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawRice(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-20 * Math.PI / 180);

  const rx = r;       // half-length of the grain
  const ry = r * 0.42; // control point vertical offset (belly height)

  ctx.beginPath();
  ctx.moveTo(-rx, 0);
  // Top arc
  ctx.bezierCurveTo(-rx * 0.98, -ry,  rx * 0.98, -ry,  rx, 0);
  // Bottom arc
  ctx.bezierCurveTo( rx * 0.98,  ry, -rx * 0.98,  ry, -rx, 0);
  ctx.closePath();

  ctx.fillStyle   = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#a0a0a0';
  ctx.lineWidth   = Math.max(0.5, r * 0.13);
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawAntEgg(ctx, cx, cy, r) {
  const count = ctx._antEggCount ?? 4;

  function drawOneEgg(px, py, eggR) {
    ctx.beginPath();
    ctx.arc(px, py, eggR + eggR * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, eggR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff3c2';
    ctx.fill();
  }

  if (count === 4) {
    const eggR = r * 0.62;
    const dist = r * 0.47;
    const N = [cx,        cy - dist];
    const W = [cx - dist, cy       ];
    const S = [cx,        cy + dist];
    const E = [cx + dist, cy       ];
    for (const [px, py] of [E, S, W, N]) drawOneEgg(px, py, eggR);
    return;
  }

  // 5 or 6 eggs — pentagon / hexagon
  const eggR      = count === 5 ? r * 0.55 : r * 0.50;
  const dist      = count === 5 ? r * 0.565 : r * 0.44;
  // New piece first (behind), N last (top) — matches pieces array order
  const drawAngles = count === 5
    ? [-18, 54, 126, -162, -90]   // NE, SE, SW, NW, N
    : [-30, 30, 90, 150, 210, -90]; // NE, SE, S, SW, NW, N
  for (const a of drawAngles) {
    const rad = a * Math.PI / 180;
    drawOneEgg(cx + Math.cos(rad) * dist, cy + Math.sin(rad) * dist, eggR);
  }
}

function drawBeetleEgg(ctx, cx, cy, r) {
  const rx = r * 0.73;
  const ry = r;
  const bw = Math.max(1, r * 0.13);

  ctx.save();
  ctx.translate(cx, cy);

  // Border ring
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + bw, ry + bw, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a2a';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff3c2';
  ctx.fill();

  ctx.restore();
}

function drawJellyfishEgg(ctx, cx, cy, r) {
  // Same silhouette as the beetle egg (rx = r*0.73, ry = r), just ~12%
  // bigger overall, with the beetle egg's black border/yolk swapped for the
  // jellyfish mob's own gray/white palette: gray body fill, white border
  // ring, and a handful of lighter squircle-shaped "spot" blobs scattered
  // inside — echoing the dot markings on the jellyfish mob's bell. Blob
  // positions/sizes were hand-tuned so none overlap each other, and a clip
  // against the body ellipse guarantees none of them cross the border ring.
  const rx = r * 0.8176;
  const ry = r * 1.1200;
  const bw = Math.max(1, r * 0.1456);

  ctx.save();
  ctx.translate(cx, cy);

  // Border ring
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + bw, ry + bw, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#b0b0b0';
  ctx.fill();

  // Clip everything below to the body so spots can never cross the border
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = '#d8d8d8';

  // Spot blobs — soft squircles, each a different size and rotation
  ctx.beginPath();
  ctx.moveTo(r * -0.1669, r * -0.6944);
  ctx.lineTo(r * -0.1691, r * -0.6039);
  ctx.lineTo(r * -0.1863, r * -0.5093);
  ctx.lineTo(r * -0.2371, r * -0.4245);
  ctx.lineTo(r * -0.3218, r * -0.3738);
  ctx.lineTo(r * -0.4164, r * -0.3566);
  ctx.lineTo(r * -0.5069, r * -0.3544);
  ctx.lineTo(r * -0.5974, r * -0.3566);
  ctx.lineTo(r * -0.6920, r * -0.3738);
  ctx.lineTo(r * -0.7768, r * -0.4245);
  ctx.lineTo(r * -0.8275, r * -0.5093);
  ctx.lineTo(r * -0.8448, r * -0.6039);
  ctx.lineTo(r * -0.8469, r * -0.6944);
  ctx.lineTo(r * -0.8448, r * -0.7849);
  ctx.lineTo(r * -0.8275, r * -0.8795);
  ctx.lineTo(r * -0.7768, r * -0.9643);
  ctx.lineTo(r * -0.6920, r * -1.0150);
  ctx.lineTo(r * -0.5974, r * -1.0322);
  ctx.lineTo(r * -0.5069, r * -1.0344);
  ctx.lineTo(r * -0.4164, r * -1.0322);
  ctx.lineTo(r * -0.3218, r * -1.0150);
  ctx.lineTo(r * -0.2371, r * -0.9643);
  ctx.lineTo(r * -0.1863, r * -0.8795);
  ctx.lineTo(r * -0.1691, r * -0.7849);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.6930, r * -0.5023);
  ctx.lineTo(r * 0.6467, r * -0.4582);
  ctx.lineTo(r * 0.5909, r * -0.4196);
  ctx.lineTo(r * 0.5233, r * -0.4026);
  ctx.lineTo(r * 0.4556, r * -0.4196);
  ctx.lineTo(r * 0.3998, r * -0.4582);
  ctx.lineTo(r * 0.3536, r * -0.5023);
  ctx.lineTo(r * 0.3094, r * -0.5486);
  ctx.lineTo(r * 0.2708, r * -0.6044);
  ctx.lineTo(r * 0.2539, r * -0.6720);
  ctx.lineTo(r * 0.2708, r * -0.7396);
  ctx.lineTo(r * 0.3094, r * -0.7954);
  ctx.lineTo(r * 0.3536, r * -0.8417);
  ctx.lineTo(r * 0.3998, r * -0.8858);
  ctx.lineTo(r * 0.4556, r * -0.9244);
  ctx.lineTo(r * 0.5233, r * -0.9414);
  ctx.lineTo(r * 0.5909, r * -0.9244);
  ctx.lineTo(r * 0.6467, r * -0.8858);
  ctx.lineTo(r * 0.6930, r * -0.8417);
  ctx.lineTo(r * 0.7371, r * -0.7954);
  ctx.lineTo(r * 0.7757, r * -0.7396);
  ctx.lineTo(r * 0.7927, r * -0.6720);
  ctx.lineTo(r * 0.7757, r * -0.6044);
  ctx.lineTo(r * 0.7371, r * -0.5486);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.8428, r * 0.4533);
  ctx.lineTo(r * 0.8218, r * 0.5248);
  ctx.lineTo(r * 0.7879, r * 0.5964);
  ctx.lineTo(r * 0.7295, r * 0.6530);
  ctx.lineTo(r * 0.6512, r * 0.6753);
  ctx.lineTo(r * 0.5723, r * 0.6688);
  ctx.lineTo(r * 0.4999, r * 0.6513);
  ctx.lineTo(r * 0.4283, r * 0.6303);
  ctx.lineTo(r * 0.3567, r * 0.5964);
  ctx.lineTo(r * 0.3001, r * 0.5379);
  ctx.lineTo(r * 0.2778, r * 0.4597);
  ctx.lineTo(r * 0.2843, r * 0.3808);
  ctx.lineTo(r * 0.3019, r * 0.3083);
  ctx.lineTo(r * 0.3229, r * 0.2368);
  ctx.lineTo(r * 0.3567, r * 0.1652);
  ctx.lineTo(r * 0.4152, r * 0.1086);
  ctx.lineTo(r * 0.4934, r * 0.0863);
  ctx.lineTo(r * 0.5723, r * 0.0928);
  ctx.lineTo(r * 0.6448, r * 0.1103);
  ctx.lineTo(r * 0.7163, r * 0.1313);
  ctx.lineTo(r * 0.7879, r * 0.1652);
  ctx.lineTo(r * 0.8445, r * 0.2237);
  ctx.lineTo(r * 0.8668, r * 0.3019);
  ctx.lineTo(r * 0.8604, r * 0.3808);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.0977, r * 0.1024);
  ctx.lineTo(r * 0.0755, r * 0.1388);
  ctx.lineTo(r * 0.0462, r * 0.1733);
  ctx.lineTo(r * 0.0056, r * 0.1959);
  ctx.lineTo(r * -0.0409, r * 0.1966);
  ctx.lineTo(r * -0.0835, r * 0.1814);
  ctx.lineTo(r * -0.1209, r * 0.1610);
  ctx.lineTo(r * -0.1573, r * 0.1388);
  ctx.lineTo(r * -0.1918, r * 0.1095);
  ctx.lineTo(r * -0.2144, r * 0.0689);
  ctx.lineTo(r * -0.2151, r * 0.0224);
  ctx.lineTo(r * -0.1999, r * -0.0202);
  ctx.lineTo(r * -0.1794, r * -0.0576);
  ctx.lineTo(r * -0.1573, r * -0.0940);
  ctx.lineTo(r * -0.1280, r * -0.1285);
  ctx.lineTo(r * -0.0874, r * -0.1511);
  ctx.lineTo(r * -0.0409, r * -0.1518);
  ctx.lineTo(r * 0.0017, r * -0.1366);
  ctx.lineTo(r * 0.0391, r * -0.1162);
  ctx.lineTo(r * 0.0755, r * -0.0940);
  ctx.lineTo(r * 0.1100, r * -0.0647);
  ctx.lineTo(r * 0.1326, r * -0.0241);
  ctx.lineTo(r * 0.1333, r * 0.0224);
  ctx.lineTo(r * 0.1181, r * 0.0650);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * -0.4529, r * 0.7493);
  ctx.lineTo(r * -0.5137, r * 0.7825);
  ctx.lineTo(r * -0.5829, r * 0.8073);
  ctx.lineTo(r * -0.6585, r * 0.8061);
  ctx.lineTo(r * -0.7245, r * 0.7693);
  ctx.lineTo(r * -0.7721, r * 0.7133);
  ctx.lineTo(r * -0.8081, r * 0.6542);
  ctx.lineTo(r * -0.8413, r * 0.5934);
  ctx.lineTo(r * -0.8661, r * 0.5242);
  ctx.lineTo(r * -0.8648, r * 0.4486);
  ctx.lineTo(r * -0.8281, r * 0.3826);
  ctx.lineTo(r * -0.7721, r * 0.3350);
  ctx.lineTo(r * -0.7129, r * 0.2990);
  ctx.lineTo(r * -0.6522, r * 0.2658);
  ctx.lineTo(r * -0.5829, r * 0.2410);
  ctx.lineTo(r * -0.5074, r * 0.2423);
  ctx.lineTo(r * -0.4414, r * 0.2790);
  ctx.lineTo(r * -0.3938, r * 0.3350);
  ctx.lineTo(r * -0.3578, r * 0.3942);
  ctx.lineTo(r * -0.3246, r * 0.4549);
  ctx.lineTo(r * -0.2998, r * 0.5242);
  ctx.lineTo(r * -0.3011, r * 0.5997);
  ctx.lineTo(r * -0.3378, r * 0.6657);
  ctx.lineTo(r * -0.3938, r * 0.7133);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.1262, r * 1.2633);
  ctx.lineTo(r * 0.0433, r * 1.2834);
  ctx.lineTo(r * -0.0469, r * 1.2908);
  ctx.lineTo(r * -0.1363, r * 1.2653);
  ctx.lineTo(r * -0.2031, r * 1.2006);
  ctx.lineTo(r * -0.2418, r * 1.1188);
  ctx.lineTo(r * -0.2658, r * 1.0371);
  ctx.lineTo(r * -0.2859, r * 0.9542);
  ctx.lineTo(r * -0.2932, r * 0.8641);
  ctx.lineTo(r * -0.2677, r * 0.7746);
  ctx.lineTo(r * -0.2031, r * 0.7078);
  ctx.lineTo(r * -0.1213, r * 0.6692);
  ctx.lineTo(r * -0.0395, r * 0.6451);
  ctx.lineTo(r * 0.0433, r * 0.6250);
  ctx.lineTo(r * 0.1335, r * 0.6177);
  ctx.lineTo(r * 0.2229, r * 0.6432);
  ctx.lineTo(r * 0.2897, r * 0.7078);
  ctx.lineTo(r * 0.3284, r * 0.7896);
  ctx.lineTo(r * 0.3524, r * 0.8714);
  ctx.lineTo(r * 0.3725, r * 0.9542);
  ctx.lineTo(r * 0.3799, r * 1.0444);
  ctx.lineTo(r * 0.3544, r * 1.1338);
  ctx.lineTo(r * 0.2897, r * 1.2006);
  ctx.lineTo(r * 0.2079, r * 1.2393);
  ctx.closePath();
  ctx.fill();

  ctx.restore(); // undo clip
  ctx.restore();
}

function drawJelly(ctx, cx, cy, r) {
  // A translucent gelatinous circle, same light gray/white family as the
  // jellyfish egg: a soft translucent gray fill, a solid white border ring,
  // and several small semi-transparent white bubbles scattered inside. All
  // bubbles are non-overlapping and kept within the body so none touch the
  // border.
  ctx.save();
  ctx.translate(cx, cy);

  // Body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(176, 176, 176, 0.35)';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();

  // Bubbles
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  const bubbles = [
    [-0.1800, -0.4950, 0.1260],
    [ 0.4500, -0.2700, 0.0900],
    [ 0.4050,  0.4050, 0.1350],
    [-0.4950,  0.0900, 0.1080],
    [-0.1800,  0.4950, 0.0810],
    [ 0.1098,  0.0648, 0.0720],
    [-0.0198, -0.0648, 0.0495],
  ];
  for (const [bx, by, br] of bubbles) {
    ctx.beginPath();
    ctx.arc(r * bx, r * by, r * br, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawInk(ctx, cx, cy, r) {
  // A wavy, ink-blot-like circle: still reads as an overall circle, but the
  // edge ripples in and out around it rather than being perfectly smooth.
  // Two-tone dark colors — a near-black outer layer and a lighter charcoal
  // inset fill sharing the same wave rhythm, scaled down ~14%.
  ctx.save();
  ctx.translate(cx, cy);

  // Outer (border) layer
  ctx.beginPath();
  ctx.moveTo(r * 0.8704, r * 0.1190);
  ctx.quadraticCurveTo(r * 0.8884, r * 0.2380, r * 0.8258, r * 0.3394);
  ctx.quadraticCurveTo(r * 0.7633, r * 0.4407, r * 0.7115, r * 0.5502);
  ctx.quadraticCurveTo(r * 0.6596, r * 0.6596, r * 0.5642, r * 0.7358);
  ctx.quadraticCurveTo(r * 0.4688, r * 0.8120, r * 0.3398, r * 0.7994);
  ctx.quadraticCurveTo(r * 0.2108, r * 0.7867, r * 0.1054, r * 0.7948);
  ctx.quadraticCurveTo(r * 0.0000, r * 0.8029, r * -0.1274, r * 0.8768);
  ctx.quadraticCurveTo(r * -0.2547, r * 0.9507, r * -0.3416, r * 0.8465);
  ctx.quadraticCurveTo(r * -0.4285, r * 0.7422, r * -0.5153, r * 0.6722);
  ctx.quadraticCurveTo(r * -0.6021, r * 0.6021, r * -0.7423, r * 0.5558);
  ctx.quadraticCurveTo(r * -0.8825, r * 0.5095, r * -0.8776, r * 0.3717);
  ctx.quadraticCurveTo(r * -0.8727, r * 0.2338, r * -0.9283, r * 0.1169);
  ctx.quadraticCurveTo(r * -0.9840, r * 0.0000, r * -0.9290, r * -0.1171);
  ctx.quadraticCurveTo(r * -0.8740, r * -0.2342, r * -0.8443, r * -0.3522);
  ctx.quadraticCurveTo(r * -0.8146, r * -0.4703, r * -0.7018, r * -0.5297);
  ctx.quadraticCurveTo(r * -0.5891, r * -0.5891, r * -0.5295, r * -0.7014);
  ctx.quadraticCurveTo(r * -0.4698, r * -0.8138, r * -0.3632, r * -0.8855);
  ctx.quadraticCurveTo(r * -0.2565, r * -0.9572, r * -0.1282, r * -0.9362);
  ctx.quadraticCurveTo(r * -0.0000, r * -0.9151, r * 0.1246, r * -0.9227);
  ctx.quadraticCurveTo(r * 0.2493, r * -0.9303, r * 0.3616, r * -0.8755);
  ctx.quadraticCurveTo(r * 0.4739, r * -0.8207, r * 0.5248, r * -0.6982);
  ctx.quadraticCurveTo(r * 0.5756, r * -0.5756, r * 0.7065, r * -0.5295);
  ctx.quadraticCurveTo(r * 0.8373, r * -0.4834, r * 0.8678, r * -0.3621);
  ctx.quadraticCurveTo(r * 0.8984, r * -0.2407, r * 0.8754, r * -0.1204);
  ctx.quadraticCurveTo(r * 0.8524, r * 0.0000, r * 0.8704, r * 0.1190);
  ctx.closePath();
  ctx.fillStyle = '#0d0d12';
  ctx.fill();

  // Inner (fill) layer — same wave pattern, scaled down ~14%
  ctx.beginPath();
  ctx.moveTo(r * 0.7485, r * 0.1024);
  ctx.quadraticCurveTo(r * 0.7640, r * 0.2047, r * 0.7102, r * 0.2919);
  ctx.quadraticCurveTo(r * 0.6564, r * 0.3790, r * 0.6119, r * 0.4731);
  ctx.quadraticCurveTo(r * 0.5673, r * 0.5673, r * 0.4852, r * 0.6328);
  ctx.quadraticCurveTo(r * 0.4032, r * 0.6984, r * 0.2922, r * 0.6874);
  ctx.quadraticCurveTo(r * 0.1813, r * 0.6765, r * 0.0906, r * 0.6835);
  ctx.quadraticCurveTo(r * 0.0000, r * 0.6905, r * -0.1095, r * 0.7540);
  ctx.quadraticCurveTo(r * -0.2191, r * 0.8176, r * -0.2938, r * 0.7280);
  ctx.quadraticCurveTo(r * -0.3685, r * 0.6383, r * -0.4432, r * 0.5781);
  ctx.quadraticCurveTo(r * -0.5178, r * 0.5178, r * -0.6384, r * 0.4780);
  ctx.quadraticCurveTo(r * -0.7590, r * 0.4382, r * -0.7547, r * 0.3196);
  ctx.quadraticCurveTo(r * -0.7505, r * 0.2011, r * -0.7984, r * 0.1005);
  ctx.quadraticCurveTo(r * -0.8463, r * 0.0000, r * -0.7989, r * -0.1007);
  ctx.quadraticCurveTo(r * -0.7516, r * -0.2014, r * -0.7261, r * -0.3029);
  ctx.quadraticCurveTo(r * -0.7005, r * -0.4045, r * -0.6036, r * -0.4555);
  ctx.quadraticCurveTo(r * -0.5066, r * -0.5066, r * -0.4553, r * -0.6032);
  ctx.quadraticCurveTo(r * -0.4041, r * -0.6998, r * -0.3123, r * -0.7615);
  ctx.quadraticCurveTo(r * -0.2206, r * -0.8232, r * -0.1103, r * -0.8051);
  ctx.quadraticCurveTo(r * -0.0000, r * -0.7870, r * 0.1072, r * -0.7935);
  ctx.quadraticCurveTo(r * 0.2144, r * -0.8000, r * 0.3109, r * -0.7529);
  ctx.quadraticCurveTo(r * 0.4075, r * -0.7058, r * 0.4513, r * -0.6004);
  ctx.quadraticCurveTo(r * 0.4951, r * -0.4951, r * 0.6076, r * -0.4554);
  ctx.quadraticCurveTo(r * 0.7201, r * -0.4157, r * 0.7463, r * -0.3114);
  ctx.quadraticCurveTo(r * 0.7726, r * -0.2070, r * 0.7528, r * -0.1035);
  ctx.quadraticCurveTo(r * 0.7330, r * 0.0000, r * 0.7485, r * 0.1024);
  ctx.closePath();
  ctx.fillStyle = '#26262e';
  ctx.fill();

  ctx.restore();
}

function drawTentacle(ctx, cx, cy, r) {
  // A single squid tentacle, lifted from squidTentacleOutline's geometry
  // (one of the mob's longer center tentacles, static resting pose) and
  // adapted into a standalone closed shape: the tip is sealed into a clean
  // point instead of the open taper used on the mob, and the fill is
  // properly inset inside the border outline (rather than offset outward)
  // so the lighter fill never pokes past the darker border, tip included.
  // Recentered/rescaled so the shape's tip-to-base span is 2r, same
  // normalization convention as other elongated petals in this file.
  ctx.save();
  ctx.translate(cx, cy);

  // Border (full silhouette)
  ctx.beginPath();
  ctx.moveTo(r * -0.2204, r * -0.9286);
  ctx.quadraticCurveTo(r * -0.2230, r * -0.8571, r * -0.2237, r * -0.7857);
  ctx.quadraticCurveTo(r * -0.2243, r * -0.7143, r * -0.2232, r * -0.6429);
  ctx.quadraticCurveTo(r * -0.2221, r * -0.5714, r * -0.2197, r * -0.5000);
  ctx.quadraticCurveTo(r * -0.2174, r * -0.4286, r * -0.2143, r * -0.3571);
  ctx.quadraticCurveTo(r * -0.2112, r * -0.2857, r * -0.2078, r * -0.2143);
  ctx.quadraticCurveTo(r * -0.2045, r * -0.1429, r * -0.2014, r * -0.0714);
  ctx.quadraticCurveTo(r * -0.1983, r * 0.0000, r * -0.1959, r * 0.0714);
  ctx.quadraticCurveTo(r * -0.1935, r * 0.1429, r * -0.1920, r * 0.2143);
  ctx.quadraticCurveTo(r * -0.1906, r * 0.2857, r * -0.1903, r * 0.3571);
  ctx.quadraticCurveTo(r * -0.1900, r * 0.4286, r * -0.1908, r * 0.5000);
  ctx.quadraticCurveTo(r * -0.1917, r * 0.5714, r * -0.1935, r * 0.6429);
  ctx.quadraticCurveTo(r * -0.1953, r * 0.7143, r * -0.1979, r * 0.7857);
  ctx.quadraticCurveTo(r * -0.2005, r * 0.8571, r * -0.2034, r * 0.9286);
  ctx.quadraticCurveTo(r * -0.2063, r * 1.0000, r * -0.1876, r * 0.9286);
  ctx.quadraticCurveTo(r * -0.1689, r * 0.8571, r * -0.1505, r * 0.7857);
  ctx.quadraticCurveTo(r * -0.1322, r * 0.7143, r * -0.1145, r * 0.6429);
  ctx.quadraticCurveTo(r * -0.0969, r * 0.5714, r * -0.0803, r * 0.5000);
  ctx.quadraticCurveTo(r * -0.0637, r * 0.4286, r * -0.0482, r * 0.3571);
  ctx.quadraticCurveTo(r * -0.0327, r * 0.2857, r * -0.0183, r * 0.2143);
  ctx.quadraticCurveTo(r * -0.0040, r * 0.1429, r * 0.0094, r * 0.0714);
  ctx.quadraticCurveTo(r * 0.0228, r * 0.0000, r * 0.0355, r * -0.0714);
  ctx.quadraticCurveTo(r * 0.0482, r * -0.1429, r * 0.0606, r * -0.2143);
  ctx.quadraticCurveTo(r * 0.0730, r * -0.2857, r * 0.0857, r * -0.3571);
  ctx.quadraticCurveTo(r * 0.0984, r * -0.4286, r * 0.1118, r * -0.5000);
  ctx.quadraticCurveTo(r * 0.1253, r * -0.5714, r * 0.1400, r * -0.6429);
  ctx.quadraticCurveTo(r * 0.1547, r * -0.7143, r * 0.1711, r * -0.7857);
  ctx.quadraticCurveTo(r * 0.1875, r * -0.8571, r * 0.2059, r * -0.9286);
  ctx.quadraticCurveTo(r * 0.2243, r * -1.0000, r * 0.0032, r * -1.0000);
  ctx.quadraticCurveTo(r * -0.2178, r * -1.0000, r * -0.2204, r * -0.9286);
  ctx.closePath();
  ctx.fillStyle = '#a85a1c';
  ctx.fill();

  // Fill (inset)
  ctx.beginPath();
  ctx.moveTo(r * -0.1565, r * -0.8891);
  ctx.quadraticCurveTo(r * -0.1615, r * -0.8203, r * -0.1644, r * -0.7515);
  ctx.quadraticCurveTo(r * -0.1674, r * -0.6827, r * -0.1687, r * -0.6139);
  ctx.quadraticCurveTo(r * -0.1700, r * -0.5451, r * -0.1700, r * -0.4763);
  ctx.quadraticCurveTo(r * -0.1700, r * -0.4075, r * -0.1693, r * -0.3387);
  ctx.quadraticCurveTo(r * -0.1685, r * -0.2699, r * -0.1676, r * -0.2011);
  ctx.quadraticCurveTo(r * -0.1666, r * -0.1323, r * -0.1659, r * -0.0635);
  ctx.quadraticCurveTo(r * -0.1651, r * 0.0053, r * -0.1651, r * 0.0741);
  ctx.quadraticCurveTo(r * -0.1650, r * 0.1429, r * -0.1660, r * 0.2117);
  ctx.quadraticCurveTo(r * -0.1669, r * 0.2805, r * -0.1690, r * 0.3492);
  ctx.quadraticCurveTo(r * -0.1710, r * 0.4180, r * -0.1742, r * 0.4868);
  ctx.quadraticCurveTo(r * -0.1774, r * 0.5556, r * -0.1816, r * 0.6244);
  ctx.quadraticCurveTo(r * -0.1858, r * 0.6932, r * -0.1908, r * 0.7620);
  ctx.quadraticCurveTo(r * -0.1957, r * 0.8308, r * -0.2010, r * 0.8996);
  ctx.quadraticCurveTo(r * -0.2063, r * 0.9684, r * -0.1900, r * 0.8996);
  ctx.quadraticCurveTo(r * -0.1736, r * 0.8308, r * -0.1576, r * 0.7620);
  ctx.quadraticCurveTo(r * -0.1416, r * 0.6932, r * -0.1264, r * 0.6244);
  ctx.quadraticCurveTo(r * -0.1111, r * 0.5556, r * -0.0969, r * 0.4868);
  ctx.quadraticCurveTo(r * -0.0826, r * 0.4180, r * -0.0695, r * 0.3492);
  ctx.quadraticCurveTo(r * -0.0564, r * 0.2805, r * -0.0444, r * 0.2117);
  ctx.quadraticCurveTo(r * -0.0324, r * 0.1429, r * -0.0214, r * 0.0741);
  ctx.quadraticCurveTo(r * -0.0104, r * 0.0053, r * -0.0001, r * -0.0635);
  ctx.quadraticCurveTo(r * 0.0103, r * -0.1323, r * 0.0203, r * -0.2011);
  ctx.quadraticCurveTo(r * 0.0304, r * -0.2699, r * 0.0407, r * -0.3387);
  ctx.quadraticCurveTo(r * 0.0510, r * -0.4075, r * 0.0621, r * -0.4763);
  ctx.quadraticCurveTo(r * 0.0732, r * -0.5451, r * 0.0855, r * -0.6139);
  ctx.quadraticCurveTo(r * 0.0978, r * -0.6827, r * 0.1119, r * -0.7515);
  ctx.quadraticCurveTo(r * 0.1259, r * -0.8203, r * 0.1419, r * -0.8891);
  ctx.quadraticCurveTo(r * 0.1580, r * -0.9579, r * 0.0032, r * -0.9579);
  ctx.quadraticCurveTo(r * -0.1515, r * -0.9579, r * -0.1565, r * -0.8891);
  ctx.closePath();
  ctx.fillStyle = '#e08a3a';
  ctx.fill();

  ctx.restore();
}

function drawInkSack(ctx, cx, cy, r) {
  // A small teardrop/pouch shape — narrow pinched neck at top, wide rounded
  // base at bottom — in the same dark two-tone palette as drawInk. The
  // fill is inset from the border using a true perpendicular offset (not a
  // percentage scale-down), so the border ring reads as an even width all
  // the way around instead of pinching thin at the neck.
  ctx.save();
  ctx.translate(cx, cy);

  // Border (full silhouette)
  ctx.beginPath();
  ctx.moveTo(r * -0.0907, r * -0.9735);
  ctx.quadraticCurveTo(r * -0.0608, r * -0.9891, r * -0.0304, r * -0.9946);
  ctx.quadraticCurveTo(r * 0.0000, r * -1.0000, r * 0.0304, r * -0.9946);
  ctx.quadraticCurveTo(r * 0.0608, r * -0.9891, r * 0.0907, r * -0.9735);
  ctx.quadraticCurveTo(r * 0.1206, r * -0.9578, r * 0.1489, r * -0.9332);
  ctx.quadraticCurveTo(r * 0.1771, r * -0.9085, r * 0.2026, r * -0.8762);
  ctx.quadraticCurveTo(r * 0.2282, r * -0.8439, r * 0.2505, r * -0.8045);
  ctx.quadraticCurveTo(r * 0.2727, r * -0.7651, r * 0.2923, r * -0.7192);
  ctx.quadraticCurveTo(r * 0.3118, r * -0.6733, r * 0.3298, r * -0.6220);
  ctx.quadraticCurveTo(r * 0.3477, r * -0.5706, r * 0.3651, r * -0.5149);
  ctx.quadraticCurveTo(r * 0.3825, r * -0.4593, r * 0.3999, r * -0.3998);
  ctx.quadraticCurveTo(r * 0.4172, r * -0.3403, r * 0.4341, r * -0.2776);
  ctx.quadraticCurveTo(r * 0.4509, r * -0.2150, r * 0.4661, r * -0.1504);
  ctx.quadraticCurveTo(r * 0.4813, r * -0.0858, r * 0.4938, r * -0.0206);
  ctx.quadraticCurveTo(r * 0.5063, r * 0.0445, r * 0.5156, r * 0.1097);
  ctx.quadraticCurveTo(r * 0.5248, r * 0.1749, r * 0.5301, r * 0.2392);
  ctx.quadraticCurveTo(r * 0.5353, r * 0.3035, r * 0.5351, r * 0.3651);
  ctx.quadraticCurveTo(r * 0.5350, r * 0.4267, r * 0.5279, r * 0.4837);
  ctx.quadraticCurveTo(r * 0.5208, r * 0.5407, r * 0.5062, r * 0.5924);
  ctx.quadraticCurveTo(r * 0.4915, r * 0.6440, r * 0.4698, r * 0.6899);
  ctx.quadraticCurveTo(r * 0.4480, r * 0.7358, r * 0.4203, r * 0.7754);
  ctx.quadraticCurveTo(r * 0.3926, r * 0.8151, r * 0.3600, r * 0.8480);
  ctx.quadraticCurveTo(r * 0.3274, r * 0.8808, r * 0.2905, r * 0.9066);
  ctx.quadraticCurveTo(r * 0.2535, r * 0.9325, r * 0.2130, r * 0.9511);
  ctx.quadraticCurveTo(r * 0.1724, r * 0.9698, r * 0.1297, r * 0.9811);
  ctx.quadraticCurveTo(r * 0.0869, r * 0.9924, r * 0.0435, r * 0.9962);
  ctx.quadraticCurveTo(r * 0.0000, r * 1.0000, r * -0.0435, r * 0.9962);
  ctx.quadraticCurveTo(r * -0.0869, r * 0.9924, r * -0.1297, r * 0.9811);
  ctx.quadraticCurveTo(r * -0.1724, r * 0.9698, r * -0.2130, r * 0.9511);
  ctx.quadraticCurveTo(r * -0.2535, r * 0.9325, r * -0.2905, r * 0.9066);
  ctx.quadraticCurveTo(r * -0.3274, r * 0.8808, r * -0.3600, r * 0.8480);
  ctx.quadraticCurveTo(r * -0.3926, r * 0.8151, r * -0.4203, r * 0.7754);
  ctx.quadraticCurveTo(r * -0.4480, r * 0.7358, r * -0.4698, r * 0.6899);
  ctx.quadraticCurveTo(r * -0.4915, r * 0.6440, r * -0.5062, r * 0.5924);
  ctx.quadraticCurveTo(r * -0.5208, r * 0.5407, r * -0.5279, r * 0.4837);
  ctx.quadraticCurveTo(r * -0.5350, r * 0.4267, r * -0.5351, r * 0.3651);
  ctx.quadraticCurveTo(r * -0.5353, r * 0.3035, r * -0.5301, r * 0.2392);
  ctx.quadraticCurveTo(r * -0.5248, r * 0.1749, r * -0.5156, r * 0.1097);
  ctx.quadraticCurveTo(r * -0.5063, r * 0.0445, r * -0.4938, r * -0.0206);
  ctx.quadraticCurveTo(r * -0.4813, r * -0.0858, r * -0.4661, r * -0.1504);
  ctx.quadraticCurveTo(r * -0.4509, r * -0.2150, r * -0.4341, r * -0.2776);
  ctx.quadraticCurveTo(r * -0.4172, r * -0.3403, r * -0.3999, r * -0.3998);
  ctx.quadraticCurveTo(r * -0.3825, r * -0.4593, r * -0.3651, r * -0.5149);
  ctx.quadraticCurveTo(r * -0.3477, r * -0.5706, r * -0.3298, r * -0.6220);
  ctx.quadraticCurveTo(r * -0.3118, r * -0.6733, r * -0.2923, r * -0.7192);
  ctx.quadraticCurveTo(r * -0.2727, r * -0.7651, r * -0.2505, r * -0.8045);
  ctx.quadraticCurveTo(r * -0.2282, r * -0.8439, r * -0.2026, r * -0.8762);
  ctx.quadraticCurveTo(r * -0.1771, r * -0.9085, r * -0.1489, r * -0.9332);
  ctx.quadraticCurveTo(r * -0.1206, r * -0.9578, r * -0.0907, r * -0.9735);
  ctx.closePath();
  ctx.fillStyle = '#0d0d12';
  ctx.fill();

  // Fill (evenly inset)
  ctx.beginPath();
  ctx.moveTo(r * -0.0316, r * -0.8528);
  ctx.quadraticCurveTo(r * -0.0186, r * -0.8612, r * -0.0093, r * -0.8637);
  ctx.quadraticCurveTo(r * 0.0000, r * -0.8663, r * 0.0093, r * -0.8637);
  ctx.quadraticCurveTo(r * 0.0186, r * -0.8612, r * 0.0316, r * -0.8528);
  ctx.quadraticCurveTo(r * 0.0447, r * -0.8444, r * 0.0614, r * -0.8287);
  ctx.quadraticCurveTo(r * 0.0782, r * -0.8131, r * 0.0961, r * -0.7897);
  ctx.quadraticCurveTo(r * 0.1141, r * -0.7663, r * 0.1315, r * -0.7347);
  ctx.quadraticCurveTo(r * 0.1489, r * -0.7032, r * 0.1657, r * -0.6630);
  ctx.quadraticCurveTo(r * 0.1825, r * -0.6229, r * 0.1991, r * -0.5749);
  ctx.quadraticCurveTo(r * 0.2157, r * -0.5269, r * 0.2325, r * -0.4729);
  ctx.quadraticCurveTo(r * 0.2494, r * -0.4190, r * 0.2664, r * -0.3608);
  ctx.quadraticCurveTo(r * 0.2834, r * -0.3027, r * 0.2997, r * -0.2418);
  ctx.quadraticCurveTo(r * 0.3161, r * -0.1809, r * 0.3308, r * -0.1189);
  ctx.quadraticCurveTo(r * 0.3454, r * -0.0568, r * 0.3573, r * 0.0053);
  ctx.quadraticCurveTo(r * 0.3693, r * 0.0674, r * 0.3780, r * 0.1288);
  ctx.quadraticCurveTo(r * 0.3867, r * 0.1903, r * 0.3917, r * 0.2495);
  ctx.quadraticCurveTo(r * 0.3967, r * 0.3087, r * 0.3968, r * 0.3631);
  ctx.quadraticCurveTo(r * 0.3969, r * 0.4174, r * 0.3913, r * 0.4651);
  ctx.quadraticCurveTo(r * 0.3857, r * 0.5127, r * 0.3742, r * 0.5539);
  ctx.quadraticCurveTo(r * 0.3627, r * 0.5950, r * 0.3459, r * 0.6306);
  ctx.quadraticCurveTo(r * 0.3291, r * 0.6662, r * 0.3081, r * 0.6963);
  ctx.quadraticCurveTo(r * 0.2872, r * 0.7265, r * 0.2631, r * 0.7509);
  ctx.quadraticCurveTo(r * 0.2390, r * 0.7754, r * 0.2121, r * 0.7942);
  ctx.quadraticCurveTo(r * 0.1852, r * 0.8131, r * 0.1555, r * 0.8266);
  ctx.quadraticCurveTo(r * 0.1259, r * 0.8401, r * 0.0947, r * 0.8484);
  ctx.quadraticCurveTo(r * 0.0634, r * 0.8567, r * 0.0317, r * 0.8595);
  ctx.quadraticCurveTo(r * 0.0000, r * 0.8623, r * -0.0317, r * 0.8595);
  ctx.quadraticCurveTo(r * -0.0634, r * 0.8567, r * -0.0947, r * 0.8484);
  ctx.quadraticCurveTo(r * -0.1259, r * 0.8401, r * -0.1555, r * 0.8266);
  ctx.quadraticCurveTo(r * -0.1852, r * 0.8131, r * -0.2121, r * 0.7942);
  ctx.quadraticCurveTo(r * -0.2390, r * 0.7754, r * -0.2631, r * 0.7509);
  ctx.quadraticCurveTo(r * -0.2872, r * 0.7265, r * -0.3081, r * 0.6963);
  ctx.quadraticCurveTo(r * -0.3291, r * 0.6662, r * -0.3459, r * 0.6306);
  ctx.quadraticCurveTo(r * -0.3627, r * 0.5950, r * -0.3742, r * 0.5539);
  ctx.quadraticCurveTo(r * -0.3857, r * 0.5127, r * -0.3913, r * 0.4651);
  ctx.quadraticCurveTo(r * -0.3969, r * 0.4174, r * -0.3968, r * 0.3631);
  ctx.quadraticCurveTo(r * -0.3967, r * 0.3087, r * -0.3917, r * 0.2495);
  ctx.quadraticCurveTo(r * -0.3867, r * 0.1903, r * -0.3780, r * 0.1288);
  ctx.quadraticCurveTo(r * -0.3693, r * 0.0674, r * -0.3573, r * 0.0053);
  ctx.quadraticCurveTo(r * -0.3454, r * -0.0568, r * -0.3308, r * -0.1189);
  ctx.quadraticCurveTo(r * -0.3161, r * -0.1809, r * -0.2997, r * -0.2418);
  ctx.quadraticCurveTo(r * -0.2834, r * -0.3027, r * -0.2664, r * -0.3608);
  ctx.quadraticCurveTo(r * -0.2494, r * -0.4190, r * -0.2325, r * -0.4729);
  ctx.quadraticCurveTo(r * -0.2157, r * -0.5269, r * -0.1991, r * -0.5749);
  ctx.quadraticCurveTo(r * -0.1825, r * -0.6229, r * -0.1657, r * -0.6630);
  ctx.quadraticCurveTo(r * -0.1489, r * -0.7032, r * -0.1315, r * -0.7347);
  ctx.quadraticCurveTo(r * -0.1141, r * -0.7663, r * -0.0961, r * -0.7897);
  ctx.quadraticCurveTo(r * -0.0782, r * -0.8131, r * -0.0614, r * -0.8287);
  ctx.quadraticCurveTo(r * -0.0447, r * -0.8444, r * -0.0316, r * -0.8528);
  ctx.closePath();
  ctx.fillStyle = '#26262e';
  ctx.fill();

  ctx.restore();
}

function drawClaw(ctx, cx, cy, r) {
  // The crab mob's big claw (CRAB_CLAW_BIG from mobDrawing.js), lifted out
  // as a standalone shape: the open/flat side stretched further outward for
  // a leaner, more elongated pincer profile, a proper evenly-inset border
  // (computed via polygon offset so the ring reads as a consistent width
  // all the way around, tip included), and recolored from the crab's own
  // dark reddish-brown limb tone into a two-tone brown (dark brown border,
  // slightly lighter warm-brown fill).
  ctx.save();
  ctx.translate(cx, cy);

  // Border (full silhouette)
  ctx.beginPath();
  ctx.moveTo(r * -0.9704, r * -0.2471);
  ctx.quadraticCurveTo(r * -1.0000, r * -0.1805, r * -0.9543, r * -0.1014);
  ctx.quadraticCurveTo(r * -0.9086, r * -0.0224, r * -0.8480, r * 0.0463);
  ctx.quadraticCurveTo(r * -0.7875, r * 0.1150, r * -0.7163, r * 0.1726);
  ctx.quadraticCurveTo(r * -0.6451, r * 0.2303, r * -0.5664, r * 0.2771);
  ctx.quadraticCurveTo(r * -0.4878, r * 0.3240, r * -0.4035, r * 0.3600);
  ctx.quadraticCurveTo(r * -0.3192, r * 0.3960, r * -0.2315, r * 0.4224);
  ctx.quadraticCurveTo(r * -0.1437, r * 0.4487, r * -0.0537, r * 0.4660);
  ctx.quadraticCurveTo(r * 0.0363, r * 0.4833, r * 0.1274, r * 0.4930);
  ctx.quadraticCurveTo(r * 0.2185, r * 0.5026, r * 0.3102, r * 0.5044);
  ctx.quadraticCurveTo(r * 0.4018, r * 0.5062, r * 0.4933, r * 0.5010);
  ctx.quadraticCurveTo(r * 0.5848, r * 0.4958, r * 0.6757, r * 0.4841);
  ctx.quadraticCurveTo(r * 0.7666, r * 0.4723, r * 0.8560, r * 0.4522);
  ctx.quadraticCurveTo(r * 0.9454, r * 0.4320, r * 0.9727, r * 0.3636);
  ctx.quadraticCurveTo(r * 1.0000, r * 0.2951, r * 0.9391, r * 0.2266);
  ctx.quadraticCurveTo(r * 0.8783, r * 0.1582, r * 0.8199, r * 0.0875);
  ctx.quadraticCurveTo(r * 0.7616, r * 0.0168, r * 0.7000, r * -0.0503);
  ctx.quadraticCurveTo(r * 0.6383, r * -0.1175, r * 0.5536, r * -0.1503);
  ctx.quadraticCurveTo(r * 0.4688, r * -0.1832, r * 0.3809, r * -0.2090);
  ctx.quadraticCurveTo(r * 0.2930, r * -0.2347, r * 0.2080, r * -0.2688);
  ctx.quadraticCurveTo(r * 0.1229, r * -0.3030, r * 0.0394, r * -0.3408);
  ctx.quadraticCurveTo(r * -0.0441, r * -0.3786, r * -0.1282, r * -0.4151);
  ctx.quadraticCurveTo(r * -0.2123, r * -0.4516, r * -0.2996, r * -0.4789);
  ctx.quadraticCurveTo(r * -0.3868, r * -0.5062, r * -0.4471, r * -0.4628);
  ctx.quadraticCurveTo(r * -0.5073, r * -0.4194, r * -0.4865, r * -0.3303);
  ctx.quadraticCurveTo(r * -0.4656, r * -0.2413, r * -0.5304, r * -0.2174);
  ctx.quadraticCurveTo(r * -0.5952, r * -0.1936, r * -0.6803, r * -0.2275);
  ctx.quadraticCurveTo(r * -0.7655, r * -0.2615, r * -0.8532, r * -0.2876);
  ctx.quadraticCurveTo(r * -0.9408, r * -0.3137, r * -0.9704, r * -0.2471);
  ctx.closePath();
  ctx.fillStyle = '#5a3a26';
  ctx.fill();

  // Fill (evenly inset)
  ctx.beginPath();
  ctx.moveTo(r * -0.9007, r * -0.1633);
  ctx.quadraticCurveTo(r * -0.8645, r * -0.0895, r * -0.8115, r * -0.0259);
  ctx.quadraticCurveTo(r * -0.7586, r * 0.0378, r * -0.6960, r * 0.0920);
  ctx.quadraticCurveTo(r * -0.6334, r * 0.1462, r * -0.5637, r * 0.1910);
  ctx.quadraticCurveTo(r * -0.4940, r * 0.2357, r * -0.4190, r * 0.2709);
  ctx.quadraticCurveTo(r * -0.3440, r * 0.3062, r * -0.2656, r * 0.3328);
  ctx.quadraticCurveTo(r * -0.1871, r * 0.3595, r * -0.1064, r * 0.3782);
  ctx.quadraticCurveTo(r * -0.0257, r * 0.3969, r * 0.0564, r * 0.4086);
  ctx.quadraticCurveTo(r * 0.1384, r * 0.4203, r * 0.2211, r * 0.4256);
  ctx.quadraticCurveTo(r * 0.3038, r * 0.4310, r * 0.3867, r * 0.4297);
  ctx.quadraticCurveTo(r * 0.4695, r * 0.4285, r * 0.5522, r * 0.4218);
  ctx.quadraticCurveTo(r * 0.6348, r * 0.4151, r * 0.7167, r * 0.4025);
  ctx.quadraticCurveTo(r * 0.7986, r * 0.3900, r * 0.8687, r * 0.3645);
  ctx.quadraticCurveTo(r * 0.9389, r * 0.3391, r * 0.8838, r * 0.2773);
  ctx.quadraticCurveTo(r * 0.8286, r * 0.2155, r * 0.7753, r * 0.1521);
  ctx.quadraticCurveTo(r * 0.7220, r * 0.0886, r * 0.6694, r * 0.0248);
  ctx.quadraticCurveTo(r * 0.6169, r * -0.0391, r * 0.5423, r * -0.0729);
  ctx.quadraticCurveTo(r * 0.4677, r * -0.1068, r * 0.3877, r * -0.1284);
  ctx.quadraticCurveTo(r * 0.3078, r * -0.1499, r * 0.2303, r * -0.1793);
  ctx.quadraticCurveTo(r * 0.1527, r * -0.2086, r * 0.0768, r * -0.2419);
  ctx.quadraticCurveTo(r * 0.0009, r * -0.2752, r * -0.0746, r * -0.3094);
  ctx.quadraticCurveTo(r * -0.1501, r * -0.3435, r * -0.2268, r * -0.3749);
  ctx.quadraticCurveTo(r * -0.3035, r * -0.4063, r * -0.3666, r * -0.4037);
  ctx.quadraticCurveTo(r * -0.4296, r * -0.4011, r * -0.4094, r * -0.3208);
  ctx.quadraticCurveTo(r * -0.3892, r * -0.2405, r * -0.4264, r * -0.1743);
  ctx.quadraticCurveTo(r * -0.4635, r * -0.1081, r * -0.5445, r * -0.1164);
  ctx.quadraticCurveTo(r * -0.6255, r * -0.1246, r * -0.7024, r * -0.1554);
  ctx.quadraticCurveTo(r * -0.7794, r * -0.1862, r * -0.8582, r * -0.2117);
  ctx.quadraticCurveTo(r * -0.9370, r * -0.2371, r * -0.9007, r * -0.1633);
  ctx.closePath();
  ctx.fillStyle = '#7a5540';
  ctx.fill();

  ctx.restore();
}

function drawCarapace(ctx, cx, cy, r) {
  // The crab mob's shell/body (drawCrab in mobDrawing.js), lifted out as a
  // standalone shape — same proportions (tall oval, bw:bh = 1:1.23), same
  // two-tone border/fill colors, and the same two curved detail strokes
  // across the shell, just without the legs, claws, or eyes attached.
  const shellColor  = '#de7048';
  const shellBorder = '#ac5a3a';
  const limbColor   = '#48201e';

  ctx.save();
  ctx.translate(cx, cy);

  const bw = r * 1.0;
  const bh = r * 1.23;

  ctx.beginPath();
  ctx.ellipse(0, 0, bw, bh, 0, 0, Math.PI * 2);
  ctx.fillStyle = shellBorder;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, 0, bw * 0.82, bh * 0.82, 0, 0, Math.PI * 2);
  ctx.fillStyle = shellColor;
  ctx.fill();

  ctx.strokeStyle = limbColor;
  ctx.lineWidth   = r * 0.16;
  ctx.lineCap     = 'round';

  ctx.beginPath();
  ctx.moveTo(r * -0.499, r * 0.452);
  ctx.quadraticCurveTo(r * -0.398, r * 0.402, r * -0.3460, r * 0.3780);
  ctx.quadraticCurveTo(r * -0.294, r * 0.354, r * -0.2340, r * 0.3340);
  ctx.quadraticCurveTo(r * -0.174, r * 0.314, r * -0.1090, r * 0.3005);
  ctx.quadraticCurveTo(r * -0.044, r * 0.287, r * 0.0250, r * 0.2790);
  ctx.quadraticCurveTo(r * 0.094, r * 0.271, r * 0.1605, r * 0.2725);
  ctx.quadraticCurveTo(r * 0.227, r * 0.274, r * 0.2860, r * 0.2820);
  ctx.quadraticCurveTo(r * 0.345, r * 0.29, r * 0.4000, r * 0.3030);
  ctx.quadraticCurveTo(r * 0.455, r * 0.316, r * 0.5100, r * 0.3320);
  ctx.lineTo(r * 0.565, r * 0.348);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(r * -0.555, r * -0.326);
  ctx.quadraticCurveTo(r * -0.453, r * -0.301, r * -0.3975, r * -0.2915);
  ctx.quadraticCurveTo(r * -0.342, r * -0.282, r * -0.2840, r * -0.2755);
  ctx.quadraticCurveTo(r * -0.226, r * -0.269, r * -0.1625, r * -0.2700);
  ctx.quadraticCurveTo(r * -0.099, r * -0.271, r * -0.0310, r * -0.2770);
  ctx.quadraticCurveTo(r * 0.037, r * -0.283, r * 0.1035, r * -0.2930);
  ctx.quadraticCurveTo(r * 0.17, r * -0.303, r * 0.2275, r * -0.3200);
  ctx.quadraticCurveTo(r * 0.285, r * -0.337, r * 0.3390, r * -0.3575);
  ctx.quadraticCurveTo(r * 0.393, r * -0.378, r * 0.4420, r * -0.4015);
  ctx.lineTo(r * 0.491, r * -0.425);
  ctx.stroke();

  ctx.restore();
}

function drawStarfishArm(ctx, cx, cy, r) {
  // A single starfish ray in a clean, simplified style (not a literal trace
  // of this game's own hand-drawn starfish mob): a smooth, continuous
  // superellipse-style taper from a flat (gently rounded-corner) base up to
  // a fully rounded dome tip — no sharp point, no hourglass pinch anywhere
  // along the sides. Same two-tone red as the starfish mob, with a
  // matching chain of surface dots down the centerline that shrink toward
  // the tip, each pair guaranteed a minimum gap so none of them touch.
  ctx.save();
  ctx.translate(cx, cy);

  // Border (full silhouette, base corners softened)
  ctx.beginPath();
  ctx.moveTo(r * -0.3176, r * 0.6959);
  ctx.lineTo(r * 0.3188, r * 0.7200);
  ctx.lineTo(r * 0.3199, r * 0.7188);
  ctx.lineTo(r * 0.3155, r * 0.6720);
  ctx.lineTo(r * 0.3109, r * 0.6240);
  ctx.lineTo(r * 0.3061, r * 0.5760);
  ctx.lineTo(r * 0.3013, r * 0.5280);
  ctx.lineTo(r * 0.2964, r * 0.4800);
  ctx.lineTo(r * 0.2914, r * 0.4320);
  ctx.lineTo(r * 0.2862, r * 0.3840);
  ctx.lineTo(r * 0.2809, r * 0.3360);
  ctx.lineTo(r * 0.2755, r * 0.2880);
  ctx.lineTo(r * 0.2699, r * 0.2400);
  ctx.lineTo(r * 0.2641, r * 0.1920);
  ctx.lineTo(r * 0.2582, r * 0.1440);
  ctx.lineTo(r * 0.2521, r * 0.0960);
  ctx.lineTo(r * 0.2458, r * 0.0480);
  ctx.lineTo(r * 0.2392, r * 0.0000);
  ctx.lineTo(r * 0.2323, r * -0.0480);
  ctx.lineTo(r * 0.2252, r * -0.0960);
  ctx.lineTo(r * 0.2178, r * -0.1440);
  ctx.lineTo(r * 0.2100, r * -0.1919);
  ctx.lineTo(r * 0.2017, r * -0.2399);
  ctx.lineTo(r * 0.1930, r * -0.2879);
  ctx.lineTo(r * 0.1837, r * -0.3359);
  ctx.lineTo(r * 0.1737, r * -0.3839);
  ctx.lineTo(r * 0.1628, r * -0.4319);
  ctx.lineTo(r * 0.1570, r * -0.4559);
  ctx.lineTo(r * 0.1508, r * -0.4799);
  ctx.lineTo(r * 0.1443, r * -0.5039);
  ctx.lineTo(r * 0.1373, r * -0.5279);
  ctx.lineTo(r * 0.1298, r * -0.5519);
  ctx.lineTo(r * 0.1217, r * -0.5758);
  ctx.lineTo(r * 0.1128, r * -0.5998);
  ctx.lineTo(r * 0.1027, r * -0.6237);
  ctx.lineTo(r * 0.0912, r * -0.6475);
  ctx.lineTo(r * 0.0772, r * -0.6712);
  ctx.lineTo(r * 0.0580, r * -0.6952);
  ctx.lineTo(r * 0.0564, r * -0.6964);
  ctx.lineTo(r * -0.0000, r * -0.7199);
  ctx.lineTo(r * -0.0564, r * -0.6964);
  ctx.lineTo(r * -0.0580, r * -0.6952);
  ctx.lineTo(r * -0.0772, r * -0.6712);
  ctx.lineTo(r * -0.0912, r * -0.6475);
  ctx.lineTo(r * -0.1027, r * -0.6237);
  ctx.lineTo(r * -0.1128, r * -0.5998);
  ctx.lineTo(r * -0.1217, r * -0.5758);
  ctx.lineTo(r * -0.1298, r * -0.5519);
  ctx.lineTo(r * -0.1373, r * -0.5279);
  ctx.lineTo(r * -0.1443, r * -0.5039);
  ctx.lineTo(r * -0.1508, r * -0.4799);
  ctx.lineTo(r * -0.1570, r * -0.4559);
  ctx.lineTo(r * -0.1628, r * -0.4319);
  ctx.lineTo(r * -0.1736, r * -0.3841);
  ctx.lineTo(r * -0.1837, r * -0.3361);
  ctx.lineTo(r * -0.1930, r * -0.2881);
  ctx.lineTo(r * -0.2017, r * -0.2401);
  ctx.lineTo(r * -0.2100, r * -0.1921);
  ctx.lineTo(r * -0.2178, r * -0.1440);
  ctx.lineTo(r * -0.2252, r * -0.0960);
  ctx.lineTo(r * -0.2323, r * -0.0480);
  ctx.lineTo(r * -0.2392, r * -0.0000);
  ctx.lineTo(r * -0.2457, r * 0.0480);
  ctx.lineTo(r * -0.2521, r * 0.0960);
  ctx.lineTo(r * -0.2582, r * 0.1440);
  ctx.lineTo(r * -0.2641, r * 0.1920);
  ctx.lineTo(r * -0.2699, r * 0.2400);
  ctx.lineTo(r * -0.2755, r * 0.2880);
  ctx.lineTo(r * -0.2809, r * 0.3360);
  ctx.lineTo(r * -0.2862, r * 0.3840);
  ctx.lineTo(r * -0.2914, r * 0.4320);
  ctx.lineTo(r * -0.2964, r * 0.4800);
  ctx.lineTo(r * -0.3013, r * 0.5280);
  ctx.lineTo(r * -0.3061, r * 0.5760);
  ctx.lineTo(r * -0.3109, r * 0.6240);
  ctx.lineTo(r * -0.3155, r * 0.6720);
  ctx.closePath();
  ctx.fillStyle = '#a8342f';
  ctx.fill();

  // Fill (inset)
  ctx.beginPath();
  ctx.moveTo(r * -0.2190, r * 0.6097);
  ctx.lineTo(r * 0.2189, r * 0.6088);
  ctx.lineTo(r * 0.2142, r * 0.5610);
  ctx.lineTo(r * 0.2094, r * 0.5132);
  ctx.lineTo(r * 0.2044, r * 0.4654);
  ctx.lineTo(r * 0.1993, r * 0.4176);
  ctx.lineTo(r * 0.1941, r * 0.3699);
  ctx.lineTo(r * 0.1888, r * 0.3221);
  ctx.lineTo(r * 0.1833, r * 0.2744);
  ctx.lineTo(r * 0.1777, r * 0.2267);
  ctx.lineTo(r * 0.1719, r * 0.1791);
  ctx.lineTo(r * 0.1659, r * 0.1314);
  ctx.lineTo(r * 0.1597, r * 0.0838);
  ctx.lineTo(r * 0.1533, r * 0.0362);
  ctx.lineTo(r * 0.1467, r * -0.0113);
  ctx.lineTo(r * 0.1398, r * -0.0588);
  ctx.lineTo(r * 0.1326, r * -0.1062);
  ctx.lineTo(r * 0.1251, r * -0.1535);
  ctx.lineTo(r * 0.1172, r * -0.2007);
  ctx.lineTo(r * 0.1089, r * -0.2478);
  ctx.lineTo(r * 0.1001, r * -0.2948);
  ctx.lineTo(r * 0.0907, r * -0.3415);
  ctx.lineTo(r * 0.0806, r * -0.3880);
  ctx.lineTo(r * 0.0696, r * -0.4341);
  ctx.lineTo(r * 0.0576, r * -0.4796);
  ctx.lineTo(r * 0.0443, r * -0.5240);
  ctx.lineTo(r * 0.0291, r * -0.5666);
  ctx.lineTo(r * 0.0116, r * -0.6053);
  ctx.lineTo(r * 0.0016, r * -0.6218);
  ctx.lineTo(r * -0.0016, r * -0.6218);
  ctx.lineTo(r * -0.0116, r * -0.6053);
  ctx.lineTo(r * -0.0289, r * -0.5670);
  ctx.lineTo(r * -0.0442, r * -0.5243);
  ctx.lineTo(r * -0.0576, r * -0.4797);
  ctx.lineTo(r * -0.0696, r * -0.4342);
  ctx.lineTo(r * -0.0805, r * -0.3882);
  ctx.lineTo(r * -0.0906, r * -0.3417);
  ctx.lineTo(r * -0.1000, r * -0.2949);
  ctx.lineTo(r * -0.1089, r * -0.2480);
  ctx.lineTo(r * -0.1172, r * -0.2008);
  ctx.lineTo(r * -0.1251, r * -0.1536);
  ctx.lineTo(r * -0.1326, r * -0.1062);
  ctx.lineTo(r * -0.1398, r * -0.0588);
  ctx.lineTo(r * -0.1467, r * -0.0114);
  ctx.lineTo(r * -0.1533, r * 0.0362);
  ctx.lineTo(r * -0.1597, r * 0.0838);
  ctx.lineTo(r * -0.1659, r * 0.1314);
  ctx.lineTo(r * -0.1719, r * 0.1790);
  ctx.lineTo(r * -0.1777, r * 0.2267);
  ctx.lineTo(r * -0.1833, r * 0.2744);
  ctx.lineTo(r * -0.1888, r * 0.3221);
  ctx.lineTo(r * -0.1941, r * 0.3698);
  ctx.lineTo(r * -0.1993, r * 0.4176);
  ctx.lineTo(r * -0.2044, r * 0.4654);
  ctx.lineTo(r * -0.2094, r * 0.5132);
  ctx.lineTo(r * -0.2142, r * 0.5610);
  ctx.lineTo(r * -0.2189, r * 0.6088);
  ctx.closePath();
  ctx.fillStyle = '#d9534f';
  ctx.fill();

  // Surface dots — biggest near the base, shrinking toward the tip, each
  // pair kept a guaranteed minimum gap apart so none of them touch.
  ctx.fillStyle = '#8a2620';
  const dots = [
    [0, 0.4320, 0.1249],
    [0, 0.1272, 0.1030],
    [0, -0.1330, 0.0803],
    [0, -0.3469, 0.0567],
  ];
  for (const [dx, dy, dr] of dots) {
    ctx.beginPath();
    ctx.arc(r * dx, r * dy, r * dr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCoral(ctx, cx, cy, r) {
  // A curved, thick base (like a coral holdfast/trunk) branching into two
  // symmetric arms that curve outward and upward, with curvature spread
  // evenly along their whole length from the base rather than concentrated
  // near the tips, and only a gentle inward ease at the very end rather
  // than a sharp hook. Built from unioned circles and capsules for a
  // smooth, organic silhouette; two-tone coral-pink palette.
  ctx.save();
  ctx.translate(cx, cy);

  // Border (full silhouette)
  ctx.beginPath();
  ctx.moveTo(r * -0.4026, r * -1.0000);
  ctx.lineTo(r * -0.5220, r * -0.9506);
  ctx.lineTo(r * -0.5550, r * -0.9046);
  ctx.lineTo(r * -0.5686, r * -0.8812);
  ctx.lineTo(r * -0.5842, r * -0.8522);
  ctx.lineTo(r * -0.6114, r * -0.7892);
  ctx.lineTo(r * -0.6228, r * -0.7573);
  ctx.lineTo(r * -0.6283, r * -0.7264);
  ctx.lineTo(r * -0.6363, r * -0.6587);
  ctx.lineTo(r * -0.6367, r * -0.6250);
  ctx.lineTo(r * -0.6341, r * -0.5907);
  ctx.lineTo(r * -0.6244, r * -0.5205);
  ctx.lineTo(r * -0.6168, r * -0.4864);
  ctx.lineTo(r * -0.6062, r * -0.4522);
  ctx.lineTo(r * -0.5787, r * -0.3841);
  ctx.lineTo(r * -0.5630, r * -0.3496);
  ctx.lineTo(r * -0.5442, r * -0.3156);
  ctx.lineTo(r * -0.5226, r * -0.2826);
  ctx.lineTo(r * -0.4758, r * -0.2206);
  ctx.lineTo(r * -0.4493, r * -0.1878);
  ctx.lineTo(r * -0.4197, r * -0.1559);
  ctx.lineTo(r * -0.3865, r * -0.1251);
  ctx.lineTo(r * -0.3208, r * -0.0735);
  ctx.lineTo(r * -0.2755, r * -0.0432);
  ctx.lineTo(r * -0.2217, r * -0.0126);
  ctx.lineTo(r * -0.1747, r * 0.0122);
  ctx.lineTo(r * -0.1315, r * 0.1949);
  ctx.lineTo(r * -0.1282, r * 0.4008);
  ctx.lineTo(r * -0.1839, r * 0.6315);
  ctx.lineTo(r * -0.2133, r * 0.8364);
  ctx.lineTo(r * -0.1104, r * 0.9704);
  ctx.lineTo(r * 0.0571, r * 0.9925);
  ctx.lineTo(r * 0.1912, r * 0.8896);
  ctx.lineTo(r * 0.2642, r * 0.6539);
  ctx.lineTo(r * 0.3020, r * 0.4156);
  ctx.lineTo(r * 0.2922, r * 0.1786);
  ctx.lineTo(r * 0.2492, r * -0.0279);
  ctx.lineTo(r * 0.2920, r * -0.0535);
  ctx.lineTo(r * 0.3622, r * -0.1053);
  ctx.lineTo(r * 0.3980, r * -0.1352);
  ctx.lineTo(r * 0.4299, r * -0.1664);
  ctx.lineTo(r * 0.4585, r * -0.1987);
  ctx.lineTo(r * 0.5066, r * -0.2607);
  ctx.lineTo(r * 0.5301, r * -0.2935);
  ctx.lineTo(r * 0.5508, r * -0.3269);
  ctx.lineTo(r * 0.5685, r * -0.3611);
  ctx.lineTo(r * 0.5975, r * -0.4294);
  ctx.lineTo(r * 0.6101, r * -0.4637);
  ctx.lineTo(r * 0.6197, r * -0.4977);
  ctx.lineTo(r * 0.6263, r * -0.5320);
  ctx.lineTo(r * 0.6353, r * -0.6022);
  ctx.lineTo(r * 0.6369, r * -0.6363);
  ctx.lineTo(r * 0.6355, r * -0.6696);
  ctx.lineTo(r * 0.6269, r * -0.7368);
  ctx.lineTo(r * 0.6196, r * -0.7678);
  ctx.lineTo(r * 0.5940, r * -0.8313);
  ctx.lineTo(r * 0.5790, r * -0.8623);
  ctx.lineTo(r * 0.5637, r * -0.8898);
  ctx.lineTo(r * 0.5516, r * -0.9106);
  ctx.lineTo(r * 0.4870, r * -0.9774);
  ctx.lineTo(r * 0.3589, r * -0.9942);
  ctx.lineTo(r * 0.2564, r * -0.9156);
  ctx.lineTo(r * 0.2395, r * -0.7875);
  ctx.lineTo(r * 0.2468, r * -0.7683);
  ctx.lineTo(r * 0.2678, r * -0.7179);
  ctx.lineTo(r * 0.2778, r * -0.6879);
  ctx.lineTo(r * 0.2789, r * -0.6696);
  ctx.lineTo(r * 0.2759, r * -0.6379);
  ctx.lineTo(r * 0.2670, r * -0.6042);
  ctx.lineTo(r * 0.2591, r * -0.5829);
  ctx.lineTo(r * 0.2414, r * -0.5499);
  ctx.lineTo(r * 0.2208, r * -0.5174);
  ctx.lineTo(r * 0.2016, r * -0.4948);
  ctx.lineTo(r * 0.1728, r * -0.4644);
  ctx.lineTo(r * 0.1408, r * -0.4348);
  ctx.lineTo(r * 0.1066, r * -0.4110);
  ctx.lineTo(r * 0.0558, r * -0.3832);
  ctx.lineTo(r * -0.0000, r * -0.3562);
  ctx.lineTo(r * -0.0558, r * -0.3832);
  ctx.lineTo(r * -0.1066, r * -0.4110);
  ctx.lineTo(r * -0.1408, r * -0.4348);
  ctx.lineTo(r * -0.1728, r * -0.4644);
  ctx.lineTo(r * -0.2016, r * -0.4948);
  ctx.lineTo(r * -0.2208, r * -0.5174);
  ctx.lineTo(r * -0.2414, r * -0.5499);
  ctx.lineTo(r * -0.2591, r * -0.5829);
  ctx.lineTo(r * -0.2670, r * -0.6042);
  ctx.lineTo(r * -0.2759, r * -0.6379);
  ctx.lineTo(r * -0.2789, r * -0.6696);
  ctx.lineTo(r * -0.2778, r * -0.6879);
  ctx.lineTo(r * -0.2678, r * -0.7179);
  ctx.lineTo(r * -0.2468, r * -0.7683);
  ctx.lineTo(r * -0.2395, r * -0.7875);
  ctx.lineTo(r * -0.2564, r * -0.9156);
  ctx.lineTo(r * -0.3589, r * -0.9942);
  ctx.closePath();
  ctx.fillStyle = '#b0453f';
  ctx.fill();

  // Fill (inset)
  ctx.beginPath();
  ctx.moveTo(r * -0.4026, r * -0.9476);
  ctx.lineTo(r * -0.4849, r * -0.9135);
  ctx.lineTo(r * -0.5066, r * -0.8846);
  ctx.lineTo(r * -0.5143, r * -0.8715);
  ctx.lineTo(r * -0.5282, r * -0.8471);
  ctx.lineTo(r * -0.5421, r * -0.8199);
  ctx.lineTo(r * -0.5673, r * -0.7599);
  ctx.lineTo(r * -0.5742, r * -0.7367);
  ctx.lineTo(r * -0.5828, r * -0.6743);
  ctx.lineTo(r * -0.5848, r * -0.6462);
  ctx.lineTo(r * -0.5843, r * -0.6168);
  ctx.lineTo(r * -0.5764, r * -0.5504);
  ctx.lineTo(r * -0.5714, r * -0.5197);
  ctx.lineTo(r * -0.5638, r * -0.4898);
  ctx.lineTo(r * -0.5535, r * -0.4594);
  ctx.lineTo(r * -0.5263, r * -0.3935);
  ctx.lineTo(r * -0.5112, r * -0.3627);
  ctx.lineTo(r * -0.4935, r * -0.3325);
  ctx.lineTo(r * -0.4728, r * -0.3023);
  ctx.lineTo(r * -0.4266, r * -0.2419);
  ctx.lineTo(r * -0.4013, r * -0.2119);
  ctx.lineTo(r * -0.3732, r * -0.1830);
  ctx.lineTo(r * -0.3418, r * -0.1554);
  ctx.lineTo(r * -0.2775, r * -0.1063);
  ctx.lineTo(r * -0.2320, r * -0.0779);
  ctx.lineTo(r * -0.1790, r * -0.0487);
  ctx.lineTo(r * -0.1448, r * -0.0302);
  ctx.lineTo(r * -0.1306, r * -0.0151);
  ctx.lineTo(r * -0.1240, r * 0.0005);
  ctx.lineTo(r * -0.0989, r * 0.0959);
  ctx.lineTo(r * -0.0750, r * 0.2272);
  ctx.lineTo(r * -0.0715, r * 0.3280);
  ctx.lineTo(r * -0.0846, r * 0.4584);
  ctx.lineTo(r * -0.1075, r * 0.5556);
  ctx.lineTo(r * -0.1624, r * 0.7336);
  ctx.lineTo(r * -0.1458, r * 0.8634);
  ctx.lineTo(r * -0.0436, r * 0.9419);
  ctx.lineTo(r * 0.0842, r * 0.9250);
  ctx.lineTo(r * 0.1642, r * 0.8190);
  ctx.lineTo(r * 0.2318, r * 0.5540);
  ctx.lineTo(r * 0.2532, r * 0.3254);
  ctx.lineTo(r * 0.2270, r * 0.0981);
  ctx.lineTo(r * 0.1978, r * -0.0201);
  ctx.lineTo(r * 0.1989, r * -0.0408);
  ctx.lineTo(r * 0.2079, r * -0.0594);
  ctx.lineTo(r * 0.2236, r * -0.0731);
  ctx.lineTo(r * 0.2638, r * -0.0972);
  ctx.lineTo(r * 0.3303, r * -0.1463);
  ctx.lineTo(r * 0.3631, r * -0.1737);
  ctx.lineTo(r * 0.3922, r * -0.2022);
  ctx.lineTo(r * 0.4184, r * -0.2318);
  ctx.lineTo(r * 0.4652, r * -0.2920);
  ctx.lineTo(r * 0.4870, r * -0.3225);
  ctx.lineTo(r * 0.5056, r * -0.3525);
  ctx.lineTo(r * 0.5216, r * -0.3832);
  ctx.lineTo(r * 0.5493, r * -0.4489);
  ctx.lineTo(r * 0.5607, r * -0.4797);
  ctx.lineTo(r * 0.5692, r * -0.5098);
  ctx.lineTo(r * 0.5749, r * -0.5397);
  ctx.lineTo(r * 0.5835, r * -0.6069);
  ctx.lineTo(r * 0.5849, r * -0.6365);
  ctx.lineTo(r * 0.5838, r * -0.6651);
  ctx.lineTo(r * 0.5756, r * -0.7289);
  ctx.lineTo(r * 0.5703, r * -0.7515);
  ctx.lineTo(r * 0.5463, r * -0.8107);
  ctx.lineTo(r * 0.5330, r * -0.8381);
  ctx.lineTo(r * 0.5187, r * -0.8638);
  ctx.lineTo(r * 0.5101, r * -0.8786);
  ctx.lineTo(r * 0.5053, r * -0.8870);
  ctx.lineTo(r * 0.4327, r * -0.9436);
  ctx.lineTo(r * 0.3444, r * -0.9320);
  ctx.lineTo(r * 0.2901, r * -0.8613);
  ctx.lineTo(r * 0.2920, r * -0.7949);
  ctx.lineTo(r * 0.3151, r * -0.7393);
  ctx.lineTo(r * 0.3194, r * -0.7280);
  ctx.lineTo(r * 0.3242, r * -0.7139);
  ctx.lineTo(r * 0.3292, r * -0.6965);
  ctx.lineTo(r * 0.3309, r * -0.6821);
  ctx.lineTo(r * 0.3309, r * -0.6681);
  ctx.lineTo(r * 0.3298, r * -0.6450);
  ctx.lineTo(r * 0.3265, r * -0.6261);
  ctx.lineTo(r * 0.3206, r * -0.6022);
  ctx.lineTo(r * 0.3164, r * -0.5881);
  ctx.lineTo(r * 0.3107, r * -0.5710);
  ctx.lineTo(r * 0.3054, r * -0.5595);
  ctx.lineTo(r * 0.2934, r * -0.5364);
  ctx.lineTo(r * 0.2860, r * -0.5232);
  ctx.lineTo(r * 0.2719, r * -0.5004);
  ctx.lineTo(r * 0.2632, r * -0.4875);
  ctx.lineTo(r * 0.2503, r * -0.4714);
  ctx.lineTo(r * 0.2400, r * -0.4598);
  ctx.lineTo(r * 0.2204, r * -0.4387);
  ctx.lineTo(r * 0.2089, r * -0.4271);
  ctx.lineTo(r * 0.1871, r * -0.4064);
  ctx.lineTo(r * 0.1742, r * -0.3950);
  ctx.lineTo(r * 0.1501, r * -0.3770);
  ctx.lineTo(r * 0.1327, r * -0.3661);
  ctx.lineTo(r * 0.0987, r * -0.3469);
  ctx.lineTo(r * 0.0790, r * -0.3367);
  ctx.lineTo(r * 0.0409, r * -0.3180);
  ctx.lineTo(r * 0.0160, r * -0.3068);
  ctx.lineTo(r * -0.0033, r * -0.3043);
  ctx.lineTo(r * -0.0221, r * -0.3092);
  ctx.lineTo(r * -0.0598, r * -0.3271);
  ctx.lineTo(r * -0.0798, r * -0.3371);
  ctx.lineTo(r * -0.1157, r * -0.3563);
  ctx.lineTo(r * -0.1343, r * -0.3671);
  ctx.lineTo(r * -0.1626, r * -0.3856);
  ctx.lineTo(r * -0.1752, r * -0.3959);
  ctx.lineTo(r * -0.1978, r * -0.4163);
  ctx.lineTo(r * -0.2097, r * -0.4279);
  ctx.lineTo(r * -0.2300, r * -0.4488);
  ctx.lineTo(r * -0.2407, r * -0.4605);
  ctx.lineTo(r * -0.2586, r * -0.4813);
  ctx.lineTo(r * -0.2640, r * -0.4885);
  ctx.lineTo(r * -0.2787, r * -0.5112);
  ctx.lineTo(r * -0.2866, r * -0.5243);
  ctx.lineTo(r * -0.2993, r * -0.5473);
  ctx.lineTo(r * -0.3060, r * -0.5606);
  ctx.lineTo(r * -0.3123, r * -0.5757);
  ctx.lineTo(r * -0.3169, r * -0.5895);
  ctx.lineTo(r * -0.3235, r * -0.6134);
  ctx.lineTo(r * -0.3268, r * -0.6276);
  ctx.lineTo(r * -0.3305, r * -0.6556);
  ctx.lineTo(r * -0.3309, r * -0.6697);
  ctx.lineTo(r * -0.3307, r * -0.6854);
  ctx.lineTo(r * -0.3282, r * -0.7006);
  ctx.lineTo(r * -0.3237, r * -0.7156);
  ctx.lineTo(r * -0.3165, r * -0.7360);
  ctx.lineTo(r * -0.3117, r * -0.7473);
  ctx.lineTo(r * -0.2904, r * -0.7990);
  ctx.lineTo(r * -0.3018, r * -0.8894);
  ctx.lineTo(r * -0.3725, r * -0.9436);
  ctx.closePath();
  ctx.fillStyle = '#f28b7a';
  ctx.fill();

  ctx.restore();
}

function drawPearl(ctx, cx, cy, r) {
  // A simple pearl: a soft pearly-cream circle with a thick tan border ring
  // (0.7 of r), for a rounded, lustrous look.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d8cbb8';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#f5efe3';
  ctx.fill();

  ctx.restore();
}

function drawShellShape(ctx, cx, cy, r) {
  // The shell mob's full silhouette (SHELL_OUTLINE from mobDrawing.js),
  // pre-rotated by the game's own SHELL_FACING_CORRECTION so the shell's
  // true front (the wide fan mouth) points right, same as facing=0 on the
  // mob. Single flat fill only — no border/fill two-tone inset and no
  // ridge-blob surface details.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(r * 0.7323, r * 0.5775);
  ctx.quadraticCurveTo(r * 0.7625, r * 0.5342, r * 0.7807, r * 0.5030);
  ctx.quadraticCurveTo(r * 0.7989, r * 0.4717, r * 0.8205, r * 0.4257);
  ctx.quadraticCurveTo(r * 0.8421, r * 0.3796, r * 0.8637, r * 0.3166);
  ctx.quadraticCurveTo(r * 0.8853, r * 0.2536, r * 0.8963, r * 0.1998);
  ctx.quadraticCurveTo(r * 0.9072, r * 0.1460, r * 0.9133, r * 0.0886);
  ctx.quadraticCurveTo(r * 0.9193, r * 0.0313, r * 0.9197, r * -0.0274);
  ctx.quadraticCurveTo(r * 0.9200, r * -0.0861, r * 0.9162, r * -0.1292);
  ctx.quadraticCurveTo(r * 0.9124, r * -0.1723, r * 0.9051, r * -0.2132);
  ctx.quadraticCurveTo(r * 0.8978, r * -0.2542, r * 0.8812, r * -0.3099);
  ctx.quadraticCurveTo(r * 0.8646, r * -0.3657, r * 0.8495, r * -0.4031);
  ctx.quadraticCurveTo(r * 0.8344, r * -0.4405, r * 0.8123, r * -0.4834);
  ctx.quadraticCurveTo(r * 0.7901, r * -0.5264, r * 0.7580, r * -0.5750);
  ctx.quadraticCurveTo(r * 0.7259, r * -0.6236, r * 0.6960, r * -0.6602);
  ctx.quadraticCurveTo(r * 0.6661, r * -0.6968, r * 0.6248, r * -0.7375);
  ctx.quadraticCurveTo(r * 0.5836, r * -0.7783, r * 0.5573, r * -0.8001);
  ctx.quadraticCurveTo(r * 0.5310, r * -0.8218, r * 0.4934, r * -0.8478);
  ctx.quadraticCurveTo(r * 0.4558, r * -0.8737, r * 0.4040, r * -0.9009);
  ctx.quadraticCurveTo(r * 0.3522, r * -0.9282, r * 0.2764, r * -0.9539);
  ctx.quadraticCurveTo(r * 0.2006, r * -0.9796, r * 0.1858, r * -0.9789);
  ctx.quadraticCurveTo(r * 0.1710, r * -0.9781, r * 0.1583, r * -0.9724);
  ctx.quadraticCurveTo(r * 0.1456, r * -0.9666, r * -0.1540, r * -0.6920);
  ctx.quadraticCurveTo(r * -0.4535, r * -0.4173, r * -0.4656, r * -0.4193);
  ctx.quadraticCurveTo(r * -0.4776, r * -0.4214, r * -0.5989, r * -0.4864);
  ctx.quadraticCurveTo(r * -0.7201, r * -0.5514, r * -0.7414, r * -0.5513);
  ctx.quadraticCurveTo(r * -0.7626, r * -0.5511, r * -0.7830, r * -0.5390);
  ctx.quadraticCurveTo(r * -0.8034, r * -0.5269, r * -0.8125, r * -0.5105);
  ctx.quadraticCurveTo(r * -0.8216, r * -0.4942, r * -0.8229, r * -0.4758);
  ctx.quadraticCurveTo(r * -0.8242, r * -0.4574, r * -0.8069, r * -0.3940);
  ctx.quadraticCurveTo(r * -0.7895, r * -0.3305, r * -0.7771, r * -0.2606);
  ctx.quadraticCurveTo(r * -0.7647, r * -0.1906, r * -0.7601, r * -0.1369);
  ctx.quadraticCurveTo(r * -0.7556, r * -0.0832, r * -0.7553, r * -0.0365);
  ctx.quadraticCurveTo(r * -0.7550, r * 0.0101, r * -0.7597, r * 0.0589);
  ctx.quadraticCurveTo(r * -0.7643, r * 0.1078, r * -0.7732, r * 0.1552);
  ctx.quadraticCurveTo(r * -0.7821, r * 0.2026, r * -0.7974, r * 0.2607);
  ctx.quadraticCurveTo(r * -0.8126, r * 0.3188, r * -0.8362, r * 0.3882);
  ctx.quadraticCurveTo(r * -0.8598, r * 0.4576, r * -0.8604, r * 0.4681);
  ctx.quadraticCurveTo(r * -0.8611, r * 0.4787, r * -0.8575, r * 0.4921);
  ctx.quadraticCurveTo(r * -0.8539, r * 0.5056, r * -0.8425, r * 0.5196);
  ctx.quadraticCurveTo(r * -0.8311, r * 0.5337, r * -0.8155, r * 0.5407);
  ctx.quadraticCurveTo(r * -0.7999, r * 0.5477, r * -0.7794, r * 0.5454);
  ctx.quadraticCurveTo(r * -0.7589, r * 0.5432, r * -0.6582, r * 0.4825);
  ctx.quadraticCurveTo(r * -0.5575, r * 0.4218, r * -0.5441, r * 0.4154);
  ctx.quadraticCurveTo(r * -0.5307, r * 0.4090, r * -0.5257, r * 0.4096);
  ctx.quadraticCurveTo(r * -0.5208, r * 0.4103, r * -0.3836, r * 0.5248);
  ctx.quadraticCurveTo(r * -0.2465, r * 0.6392, r * -0.0596, r * 0.8028);
  ctx.quadraticCurveTo(r * 0.1273, r * 0.9664, r * 0.1500, r * 0.9734);
  ctx.quadraticCurveTo(r * 0.1727, r * 0.9803, r * 0.2072, r * 0.9709);
  ctx.quadraticCurveTo(r * 0.2418, r * 0.9615, r * 0.2735, r * 0.9478);
  ctx.quadraticCurveTo(r * 0.3053, r * 0.9342, r * 0.3490, r * 0.9113);
  ctx.quadraticCurveTo(r * 0.3927, r * 0.8884, r * 0.4307, r * 0.8642);
  ctx.quadraticCurveTo(r * 0.4687, r * 0.8400, r * 0.5285, r * 0.7922);
  ctx.quadraticCurveTo(r * 0.5883, r * 0.7445, r * 0.6214, r * 0.7111);
  ctx.quadraticCurveTo(r * 0.6544, r * 0.6776, r * 0.6783, r * 0.6492);
  ctx.quadraticCurveTo(r * 0.7022, r * 0.6208, r * 0.7323, r * 0.5775);
  ctx.closePath();
  ctx.fillStyle = '#e8b96a';
  ctx.fill();

  ctx.restore();
}

function drawOceanArtifact(ctx, cx, cy, r) {
  // An original ocean-tech gem concept: an elongated faceted crystal
  // (hexagonal-prism silhouette, pointed top and bottom) in deep teal, with
  // a brighter cyan inner core and thin light facet lines radiating from
  // the center. The facet lines are drawn first and the inner core's own
  // outline is drawn on top of them, so the core's edge cleanly overlaps
  // where the facet lines would otherwise poke past it.
  ctx.save();
  ctx.translate(cx, cy);

  // Outer border/body
  ctx.beginPath();
  ctx.moveTo(r * 0.0000, r * -1.0000);
  ctx.lineTo(r * 0.4200, r * -0.5500);
  ctx.lineTo(r * 0.4800, r * 0.0000);
  ctx.lineTo(r * 0.4200, r * 0.5500);
  ctx.lineTo(r * 0.0000, r * 1.0000);
  ctx.lineTo(r * -0.4200, r * 0.5500);
  ctx.lineTo(r * -0.4800, r * 0.0000);
  ctx.lineTo(r * -0.4200, r * -0.5500);
  ctx.closePath();
  ctx.fillStyle = '#0d5c6b';
  ctx.strokeStyle = '#083f4a';
  ctx.lineWidth = r * 0.064;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  // Inner core fill
  const innerPts = [
    [0.0000, -0.9231], [0.3269, -0.5385], [0.3846, 0.0000], [0.3269, 0.5385],
    [0.0000, 0.9231], [-0.3269, 0.5385], [-0.3846, 0.0000], [-0.3269, -0.5385],
  ];
  ctx.beginPath();
  ctx.moveTo(r * innerPts[0][0], r * innerPts[0][1]);
  for (let i = 1; i < innerPts.length; i++) {
    ctx.lineTo(r * innerPts[i][0], r * innerPts[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = '#2fb8cc';
  ctx.fill();

  // Facet lines from each inner vertex to the center
  ctx.strokeStyle = '#7fe0ec';
  ctx.lineWidth = r * 0.026;
  ctx.beginPath();
  ctx.moveTo(r * innerPts[0][0], r * innerPts[0][1]);
  ctx.lineTo(r * innerPts[4][0], r * innerPts[4][1]);
  ctx.stroke();
  for (const [vx, vy] of [innerPts[1], innerPts[3], innerPts[5], innerPts[7]]) {
    ctx.beginPath();
    ctx.moveTo(r * vx, r * vy);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }

  // Inner core outline drawn on top, so it overlaps and covers where the
  // facet lines cross past the core's own edge
  ctx.beginPath();
  ctx.moveTo(r * innerPts[0][0], r * innerPts[0][1]);
  for (let i = 1; i < innerPts.length; i++) {
    ctx.lineTo(r * innerPts[i][0], r * innerPts[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = 'none';
  ctx.strokeStyle = '#2fb8cc';
  ctx.lineWidth = r * 0.051;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawSpongePetal(ctx, cx, cy, r) {
  // The sponge mob's scalloped-ridge silhouette (same math as
  // spongeScallopedPoints/drawSponge in mobDrawing.js) with the two-tone
  // inner fill, plus a fixed, hand-picked pore layout — NOT randomized —
  // using the exact dot positions generated by the pattern tool at seed
  // 889417082 with count=15, size=0.120, min gap=0.100, spread radius=0.50.
  // Every dot in this layout is verified clear of both its neighbors and
  // the inner fill's own edge.
  ctx.save();
  ctx.translate(cx, cy);

  // Outer border/body
  ctx.beginPath();
  ctx.moveTo(r * 1.0187, r * 0.0272);
  ctx.quadraticCurveTo(r * 1.0373, r * 0.0544, r * 1.0458, r * 0.0826);
  ctx.quadraticCurveTo(r * 1.0544, r * 0.1108, r * 1.0481, r * 0.1379);
  ctx.quadraticCurveTo(r * 1.0418, r * 0.1650, r * 1.0222, r * 0.1891);
  ctx.quadraticCurveTo(r * 1.0026, r * 0.2131, r * 0.9766, r * 0.2339);
  ctx.quadraticCurveTo(r * 0.9505, r * 0.2547, r * 0.9271, r * 0.2742);
  ctx.quadraticCurveTo(r * 0.9037, r * 0.2936, r * 0.8900, r * 0.3150);
  ctx.quadraticCurveTo(r * 0.8762, r * 0.3363, r * 0.8740, r * 0.3622);
  ctx.quadraticCurveTo(r * 0.8718, r * 0.3881, r * 0.8771, r * 0.4189);
  ctx.quadraticCurveTo(r * 0.8824, r * 0.4496, r * 0.8876, r * 0.4825);
  ctx.quadraticCurveTo(r * 0.8927, r * 0.5154, r * 0.8898, r * 0.5457);
  ctx.quadraticCurveTo(r * 0.8869, r * 0.5759, r * 0.8716, r * 0.5991);
  ctx.quadraticCurveTo(r * 0.8564, r * 0.6222, r * 0.8298, r * 0.6363);
  ctx.quadraticCurveTo(r * 0.8032, r * 0.6504, r * 0.7708, r * 0.6576);
  ctx.quadraticCurveTo(r * 0.7384, r * 0.6648, r * 0.7074, r * 0.6706);
  ctx.quadraticCurveTo(r * 0.6763, r * 0.6763, r * 0.6523, r * 0.6870);
  ctx.quadraticCurveTo(r * 0.6282, r * 0.6977, r * 0.6125, r * 0.7174);
  ctx.quadraticCurveTo(r * 0.5968, r * 0.7370, r * 0.5867, r * 0.7653);
  ctx.quadraticCurveTo(r * 0.5766, r * 0.7936, r * 0.5666, r * 0.8254);
  ctx.quadraticCurveTo(r * 0.5567, r * 0.8572, r * 0.5416, r * 0.8847);
  ctx.quadraticCurveTo(r * 0.5266, r * 0.9122, r * 0.5041, r * 0.9287);
  ctx.quadraticCurveTo(r * 0.4816, r * 0.9452, r * 0.4525, r * 0.9482);
  ctx.quadraticCurveTo(r * 0.4235, r * 0.9512, r * 0.3915, r * 0.9439);
  ctx.quadraticCurveTo(r * 0.3595, r * 0.9366, r * 0.3287, r * 0.9266);
  ctx.quadraticCurveTo(r * 0.2978, r * 0.9167, r * 0.2706, r * 0.9126);
  ctx.quadraticCurveTo(r * 0.2434, r * 0.9085, r * 0.2198, r * 0.9158);
  ctx.quadraticCurveTo(r * 0.1962, r * 0.9232, r * 0.1741, r * 0.9416);
  ctx.quadraticCurveTo(r * 0.1521, r * 0.9601, r * 0.1290, r * 0.9837);
  ctx.quadraticCurveTo(r * 0.1059, r * 1.0072, r * 0.0804, r * 1.0268);
  ctx.quadraticCurveTo(r * 0.0548, r * 1.0464, r * 0.0274, r * 1.0540);
  ctx.quadraticCurveTo(r * 0.0000, r * 1.0615, r * -0.0274, r * 1.0540);
  ctx.quadraticCurveTo(r * -0.0548, r * 1.0464, r * -0.0804, r * 1.0268);
  ctx.quadraticCurveTo(r * -0.1059, r * 1.0072, r * -0.1290, r * 0.9837);
  ctx.quadraticCurveTo(r * -0.1521, r * 0.9601, r * -0.1741, r * 0.9416);
  ctx.quadraticCurveTo(r * -0.1962, r * 0.9232, r * -0.2198, r * 0.9158);
  ctx.quadraticCurveTo(r * -0.2434, r * 0.9085, r * -0.2706, r * 0.9126);
  ctx.quadraticCurveTo(r * -0.2978, r * 0.9167, r * -0.3287, r * 0.9266);
  ctx.quadraticCurveTo(r * -0.3595, r * 0.9366, r * -0.3915, r * 0.9439);
  ctx.quadraticCurveTo(r * -0.4235, r * 0.9512, r * -0.4525, r * 0.9482);
  ctx.quadraticCurveTo(r * -0.4816, r * 0.9452, r * -0.5041, r * 0.9287);
  ctx.quadraticCurveTo(r * -0.5266, r * 0.9122, r * -0.5416, r * 0.8847);
  ctx.quadraticCurveTo(r * -0.5567, r * 0.8572, r * -0.5666, r * 0.8254);
  ctx.quadraticCurveTo(r * -0.5766, r * 0.7936, r * -0.5867, r * 0.7653);
  ctx.quadraticCurveTo(r * -0.5968, r * 0.7370, r * -0.6125, r * 0.7174);
  ctx.quadraticCurveTo(r * -0.6282, r * 0.6977, r * -0.6523, r * 0.6870);
  ctx.quadraticCurveTo(r * -0.6763, r * 0.6763, r * -0.7074, r * 0.6706);
  ctx.quadraticCurveTo(r * -0.7384, r * 0.6648, r * -0.7708, r * 0.6576);
  ctx.quadraticCurveTo(r * -0.8032, r * 0.6504, r * -0.8298, r * 0.6363);
  ctx.quadraticCurveTo(r * -0.8564, r * 0.6222, r * -0.8716, r * 0.5991);
  ctx.quadraticCurveTo(r * -0.8869, r * 0.5759, r * -0.8898, r * 0.5457);
  ctx.quadraticCurveTo(r * -0.8927, r * 0.5154, r * -0.8876, r * 0.4825);
  ctx.quadraticCurveTo(r * -0.8824, r * 0.4496, r * -0.8771, r * 0.4189);
  ctx.quadraticCurveTo(r * -0.8718, r * 0.3881, r * -0.8740, r * 0.3622);
  ctx.quadraticCurveTo(r * -0.8762, r * 0.3363, r * -0.8900, r * 0.3150);
  ctx.quadraticCurveTo(r * -0.9037, r * 0.2936, r * -0.9271, r * 0.2742);
  ctx.quadraticCurveTo(r * -0.9505, r * 0.2547, r * -0.9766, r * 0.2339);
  ctx.quadraticCurveTo(r * -1.0026, r * 0.2131, r * -1.0222, r * 0.1891);
  ctx.quadraticCurveTo(r * -1.0418, r * 0.1650, r * -1.0481, r * 0.1379);
  ctx.quadraticCurveTo(r * -1.0544, r * 0.1108, r * -1.0458, r * 0.0826);
  ctx.quadraticCurveTo(r * -1.0373, r * 0.0544, r * -1.0187, r * 0.0272);
  ctx.quadraticCurveTo(r * -1.0000, r * 0.0000, r * -0.9800, r * -0.0252);
  ctx.quadraticCurveTo(r * -0.9600, r * -0.0503, r * -0.9473, r * -0.0743);
  ctx.quadraticCurveTo(r * -0.9347, r * -0.0982, r * -0.9341, r * -0.1230);
  ctx.quadraticCurveTo(r * -0.9335, r * -0.1479, r * -0.9436, r * -0.1753);
  ctx.quadraticCurveTo(r * -0.9537, r * -0.2027, r * -0.9675, r * -0.2328);
  ctx.quadraticCurveTo(r * -0.9813, r * -0.2629, r * -0.9899, r * -0.2937);
  ctx.quadraticCurveTo(r * -0.9984, r * -0.3244, r * -0.9947, r * -0.3524);
  ctx.quadraticCurveTo(r * -0.9910, r * -0.3804, r * -0.9731, r * -0.4029);
  ctx.quadraticCurveTo(r * -0.9553, r * -0.4253, r * -0.9275, r * -0.4418);
  ctx.quadraticCurveTo(r * -0.8996, r * -0.4584, r * -0.8695, r * -0.4715);
  ctx.quadraticCurveTo(r * -0.8394, r * -0.4846, r * -0.8149, r * -0.4990);
  ctx.quadraticCurveTo(r * -0.7905, r * -0.5133, r * -0.7761, r * -0.5334);
  ctx.quadraticCurveTo(r * -0.7617, r * -0.5534, r * -0.7564, r * -0.5808);
  ctx.quadraticCurveTo(r * -0.7511, r * -0.6082, r * -0.7495, r * -0.6408);
  ctx.quadraticCurveTo(r * -0.7479, r * -0.6734, r * -0.7429, r * -0.7057);
  ctx.quadraticCurveTo(r * -0.7379, r * -0.7379, r * -0.7240, r * -0.7633);
  ctx.quadraticCurveTo(r * -0.7101, r * -0.7886, r * -0.6859, r * -0.8029);
  ctx.quadraticCurveTo(r * -0.6618, r * -0.8173, r * -0.6304, r * -0.8208);
  ctx.quadraticCurveTo(r * -0.5990, r * -0.8244, r * -0.5658, r * -0.8223);
  ctx.quadraticCurveTo(r * -0.5326, r * -0.8202, r * -0.5030, r * -0.8200);
  ctx.quadraticCurveTo(r * -0.4734, r * -0.8199, r * -0.4499, r * -0.8284);
  ctx.quadraticCurveTo(r * -0.4264, r * -0.8369, r * -0.4082, r * -0.8564);
  ctx.quadraticCurveTo(r * -0.3900, r * -0.8759, r * -0.3736, r * -0.9033);
  ctx.quadraticCurveTo(r * -0.3572, r * -0.9306, r * -0.3387, r * -0.9580);
  ctx.quadraticCurveTo(r * -0.3202, r * -0.9855, r * -0.2972, r * -1.0044);
  ctx.quadraticCurveTo(r * -0.2742, r * -1.0233, r * -0.2469, r * -1.0282);
  ctx.quadraticCurveTo(r * -0.2196, r * -1.0331, r * -0.1902, r * -1.0242);
  ctx.quadraticCurveTo(r * -0.1608, r * -1.0153, r * -0.1320, r * -0.9985);
  ctx.quadraticCurveTo(r * -0.1032, r * -0.9818, r * -0.0765, r * -0.9663);
  ctx.quadraticCurveTo(r * -0.0498, r * -0.9509, r * -0.0249, r * -0.9447);
  ctx.quadraticCurveTo(r * -0.0000, r * -0.9385, r * 0.0249, r * -0.9447);
  ctx.quadraticCurveTo(r * 0.0498, r * -0.9509, r * 0.0765, r * -0.9663);
  ctx.quadraticCurveTo(r * 0.1032, r * -0.9818, r * 0.1320, r * -0.9985);
  ctx.quadraticCurveTo(r * 0.1608, r * -1.0153, r * 0.1902, r * -1.0242);
  ctx.quadraticCurveTo(r * 0.2196, r * -1.0331, r * 0.2469, r * -1.0282);
  ctx.quadraticCurveTo(r * 0.2742, r * -1.0233, r * 0.2972, r * -1.0044);
  ctx.quadraticCurveTo(r * 0.3202, r * -0.9855, r * 0.3387, r * -0.9580);
  ctx.quadraticCurveTo(r * 0.3572, r * -0.9306, r * 0.3736, r * -0.9033);
  ctx.quadraticCurveTo(r * 0.3900, r * -0.8759, r * 0.4082, r * -0.8564);
  ctx.quadraticCurveTo(r * 0.4264, r * -0.8369, r * 0.4499, r * -0.8284);
  ctx.quadraticCurveTo(r * 0.4734, r * -0.8199, r * 0.5030, r * -0.8200);
  ctx.quadraticCurveTo(r * 0.5326, r * -0.8202, r * 0.5658, r * -0.8223);
  ctx.quadraticCurveTo(r * 0.5990, r * -0.8244, r * 0.6304, r * -0.8208);
  ctx.quadraticCurveTo(r * 0.6618, r * -0.8173, r * 0.6859, r * -0.8029);
  ctx.quadraticCurveTo(r * 0.7101, r * -0.7886, r * 0.7240, r * -0.7633);
  ctx.quadraticCurveTo(r * 0.7379, r * -0.7379, r * 0.7429, r * -0.7057);
  ctx.quadraticCurveTo(r * 0.7479, r * -0.6734, r * 0.7495, r * -0.6408);
  ctx.quadraticCurveTo(r * 0.7511, r * -0.6082, r * 0.7564, r * -0.5808);
  ctx.quadraticCurveTo(r * 0.7617, r * -0.5534, r * 0.7761, r * -0.5334);
  ctx.quadraticCurveTo(r * 0.7905, r * -0.5133, r * 0.8149, r * -0.4990);
  ctx.quadraticCurveTo(r * 0.8394, r * -0.4846, r * 0.8695, r * -0.4715);
  ctx.quadraticCurveTo(r * 0.8996, r * -0.4584, r * 0.9275, r * -0.4418);
  ctx.quadraticCurveTo(r * 0.9553, r * -0.4253, r * 0.9731, r * -0.4029);
  ctx.quadraticCurveTo(r * 0.9910, r * -0.3804, r * 0.9947, r * -0.3524);
  ctx.quadraticCurveTo(r * 0.9984, r * -0.3244, r * 0.9899, r * -0.2937);
  ctx.quadraticCurveTo(r * 0.9813, r * -0.2629, r * 0.9675, r * -0.2328);
  ctx.quadraticCurveTo(r * 0.9537, r * -0.2027, r * 0.9436, r * -0.1753);
  ctx.quadraticCurveTo(r * 0.9335, r * -0.1479, r * 0.9341, r * -0.1230);
  ctx.quadraticCurveTo(r * 0.9347, r * -0.0982, r * 0.9473, r * -0.0743);
  ctx.quadraticCurveTo(r * 0.9600, r * -0.0503, r * 0.9800, r * -0.0252);
  ctx.quadraticCurveTo(r * 1.0000, r * 0.0000, r * 1.0187, r * 0.0272);
  ctx.closePath();
  ctx.fillStyle = '#6b4a2e';
  ctx.fill();

  // Inner fill (same scalloped shape, scaled down)
  ctx.beginPath();
  ctx.moveTo(r * 0.8557, r * 0.0228);
  ctx.quadraticCurveTo(r * 0.8713, r * 0.0457, r * 0.8785, r * 0.0694);
  ctx.quadraticCurveTo(r * 0.8857, r * 0.0931, r * 0.8804, r * 0.1158);
  ctx.quadraticCurveTo(r * 0.8751, r * 0.1386, r * 0.8587, r * 0.1588);
  ctx.quadraticCurveTo(r * 0.8422, r * 0.1790, r * 0.8203, r * 0.1965);
  ctx.quadraticCurveTo(r * 0.7985, r * 0.2139, r * 0.7788, r * 0.2303);
  ctx.quadraticCurveTo(r * 0.7591, r * 0.2467, r * 0.7476, r * 0.2646);
  ctx.quadraticCurveTo(r * 0.7360, r * 0.2825, r * 0.7341, r * 0.3043);
  ctx.quadraticCurveTo(r * 0.7323, r * 0.3260, r * 0.7368, r * 0.3519);
  ctx.quadraticCurveTo(r * 0.7412, r * 0.3777, r * 0.7455, r * 0.4053);
  ctx.quadraticCurveTo(r * 0.7498, r * 0.4329, r * 0.7474, r * 0.4584);
  ctx.quadraticCurveTo(r * 0.7450, r * 0.4838, r * 0.7322, r * 0.5032);
  ctx.quadraticCurveTo(r * 0.7193, r * 0.5226, r * 0.6970, r * 0.5345);
  ctx.quadraticCurveTo(r * 0.6747, r * 0.5463, r * 0.6475, r * 0.5524);
  ctx.quadraticCurveTo(r * 0.6202, r * 0.5585, r * 0.5942, r * 0.5633);
  ctx.quadraticCurveTo(r * 0.5681, r * 0.5681, r * 0.5479, r * 0.5771);
  ctx.quadraticCurveTo(r * 0.5277, r * 0.5860, r * 0.5145, r * 0.6026);
  ctx.quadraticCurveTo(r * 0.5013, r * 0.6191, r * 0.4928, r * 0.6429);
  ctx.quadraticCurveTo(r * 0.4844, r * 0.6667, r * 0.4760, r * 0.6933);
  ctx.quadraticCurveTo(r * 0.4676, r * 0.7200, r * 0.4550, r * 0.7431);
  ctx.quadraticCurveTo(r * 0.4424, r * 0.7662, r * 0.4235, r * 0.7801);
  ctx.quadraticCurveTo(r * 0.4045, r * 0.7939, r * 0.3801, r * 0.7965);
  ctx.quadraticCurveTo(r * 0.3557, r * 0.7990, r * 0.3289, r * 0.7929);
  ctx.quadraticCurveTo(r * 0.3020, r * 0.7867, r * 0.2761, r * 0.7784);
  ctx.quadraticCurveTo(r * 0.2502, r * 0.7700, r * 0.2273, r * 0.7666);
  ctx.quadraticCurveTo(r * 0.2045, r * 0.7631, r * 0.1847, r * 0.7693);
  ctx.quadraticCurveTo(r * 0.1648, r * 0.7755, r * 0.1463, r * 0.7910);
  ctx.quadraticCurveTo(r * 0.1277, r * 0.8065, r * 0.1083, r * 0.8263);
  ctx.quadraticCurveTo(r * 0.0889, r * 0.8461, r * 0.0675, r * 0.8625);
  ctx.quadraticCurveTo(r * 0.0461, r * 0.8790, r * 0.0230, r * 0.8853);
  ctx.quadraticCurveTo(r * 0.0000, r * 0.8917, r * -0.0230, r * 0.8853);
  ctx.quadraticCurveTo(r * -0.0461, r * 0.8790, r * -0.0675, r * 0.8625);
  ctx.quadraticCurveTo(r * -0.0889, r * 0.8461, r * -0.1083, r * 0.8263);
  ctx.quadraticCurveTo(r * -0.1277, r * 0.8065, r * -0.1463, r * 0.7910);
  ctx.quadraticCurveTo(r * -0.1648, r * 0.7755, r * -0.1847, r * 0.7693);
  ctx.quadraticCurveTo(r * -0.2045, r * 0.7631, r * -0.2273, r * 0.7666);
  ctx.quadraticCurveTo(r * -0.2502, r * 0.7700, r * -0.2761, r * 0.7784);
  ctx.quadraticCurveTo(r * -0.3020, r * 0.7867, r * -0.3289, r * 0.7929);
  ctx.quadraticCurveTo(r * -0.3557, r * 0.7990, r * -0.3801, r * 0.7965);
  ctx.quadraticCurveTo(r * -0.4045, r * 0.7939, r * -0.4235, r * 0.7801);
  ctx.quadraticCurveTo(r * -0.4424, r * 0.7662, r * -0.4550, r * 0.7431);
  ctx.quadraticCurveTo(r * -0.4676, r * 0.7200, r * -0.4760, r * 0.6933);
  ctx.quadraticCurveTo(r * -0.4844, r * 0.6667, r * -0.4928, r * 0.6429);
  ctx.quadraticCurveTo(r * -0.5013, r * 0.6191, r * -0.5145, r * 0.6026);
  ctx.quadraticCurveTo(r * -0.5277, r * 0.5860, r * -0.5479, r * 0.5771);
  ctx.quadraticCurveTo(r * -0.5681, r * 0.5681, r * -0.5942, r * 0.5633);
  ctx.quadraticCurveTo(r * -0.6202, r * 0.5585, r * -0.6475, r * 0.5524);
  ctx.quadraticCurveTo(r * -0.6747, r * 0.5463, r * -0.6970, r * 0.5345);
  ctx.quadraticCurveTo(r * -0.7193, r * 0.5226, r * -0.7322, r * 0.5032);
  ctx.quadraticCurveTo(r * -0.7450, r * 0.4838, r * -0.7474, r * 0.4584);
  ctx.quadraticCurveTo(r * -0.7498, r * 0.4329, r * -0.7455, r * 0.4053);
  ctx.quadraticCurveTo(r * -0.7412, r * 0.3777, r * -0.7368, r * 0.3519);
  ctx.quadraticCurveTo(r * -0.7323, r * 0.3260, r * -0.7341, r * 0.3043);
  ctx.quadraticCurveTo(r * -0.7360, r * 0.2825, r * -0.7476, r * 0.2646);
  ctx.quadraticCurveTo(r * -0.7591, r * 0.2467, r * -0.7788, r * 0.2303);
  ctx.quadraticCurveTo(r * -0.7985, r * 0.2139, r * -0.8203, r * 0.1965);
  ctx.quadraticCurveTo(r * -0.8422, r * 0.1790, r * -0.8587, r * 0.1588);
  ctx.quadraticCurveTo(r * -0.8751, r * 0.1386, r * -0.8804, r * 0.1158);
  ctx.quadraticCurveTo(r * -0.8857, r * 0.0931, r * -0.8785, r * 0.0694);
  ctx.quadraticCurveTo(r * -0.8713, r * 0.0457, r * -0.8557, r * 0.0228);
  ctx.quadraticCurveTo(r * -0.8400, r * 0.0000, r * -0.8232, r * -0.0211);
  ctx.quadraticCurveTo(r * -0.8064, r * -0.0423, r * -0.7957, r * -0.0624);
  ctx.quadraticCurveTo(r * -0.7851, r * -0.0825, r * -0.7846, r * -0.1034);
  ctx.quadraticCurveTo(r * -0.7842, r * -0.1242, r * -0.7926, r * -0.1472);
  ctx.quadraticCurveTo(r * -0.8011, r * -0.1703, r * -0.8127, r * -0.1956);
  ctx.quadraticCurveTo(r * -0.8243, r * -0.2209, r * -0.8315, r * -0.2467);
  ctx.quadraticCurveTo(r * -0.8387, r * -0.2725, r * -0.8355, r * -0.2960);
  ctx.quadraticCurveTo(r * -0.8324, r * -0.3195, r * -0.8174, r * -0.3384);
  ctx.quadraticCurveTo(r * -0.8025, r * -0.3573, r * -0.7791, r * -0.3712);
  ctx.quadraticCurveTo(r * -0.7557, r * -0.3850, r * -0.7304, r * -0.3961);
  ctx.quadraticCurveTo(r * -0.7051, r * -0.4071, r * -0.6845, r * -0.4191);
  ctx.quadraticCurveTo(r * -0.6640, r * -0.4312, r * -0.6519, r * -0.4480);
  ctx.quadraticCurveTo(r * -0.6398, r * -0.4648, r * -0.6354, r * -0.4879);
  ctx.quadraticCurveTo(r * -0.6309, r * -0.5109, r * -0.6296, r * -0.5383);
  ctx.quadraticCurveTo(r * -0.6283, r * -0.5657, r * -0.6240, r * -0.5928);
  ctx.quadraticCurveTo(r * -0.6198, r * -0.6198, r * -0.6081, r * -0.6411);
  ctx.quadraticCurveTo(r * -0.5965, r * -0.6624, r * -0.5762, r * -0.6745);
  ctx.quadraticCurveTo(r * -0.5559, r * -0.6865, r * -0.5295, r * -0.6895);
  ctx.quadraticCurveTo(r * -0.5031, r * -0.6925, r * -0.4753, r * -0.6907);
  ctx.quadraticCurveTo(r * -0.4474, r * -0.6889, r * -0.4225, r * -0.6888);
  ctx.quadraticCurveTo(r * -0.3976, r * -0.6887, r * -0.3779, r * -0.6958);
  ctx.quadraticCurveTo(r * -0.3582, r * -0.7030, r * -0.3429, r * -0.7194);
  ctx.quadraticCurveTo(r * -0.3276, r * -0.7358, r * -0.3138, r * -0.7587);
  ctx.quadraticCurveTo(r * -0.3001, r * -0.7817, r * -0.2845, r * -0.8047);
  ctx.quadraticCurveTo(r * -0.2690, r * -0.8278, r * -0.2496, r * -0.8437);
  ctx.quadraticCurveTo(r * -0.2303, r * -0.8596, r * -0.2074, r * -0.8637);
  ctx.quadraticCurveTo(r * -0.1845, r * -0.8678, r * -0.1598, r * -0.8603);
  ctx.quadraticCurveTo(r * -0.1351, r * -0.8528, r * -0.1109, r * -0.8388);
  ctx.quadraticCurveTo(r * -0.0867, r * -0.8247, r * -0.0643, r * -0.8117);
  ctx.quadraticCurveTo(r * -0.0419, r * -0.7987, r * -0.0209, r * -0.7935);
  ctx.quadraticCurveTo(r * -0.0000, r * -0.7883, r * 0.0209, r * -0.7935);
  ctx.quadraticCurveTo(r * 0.0419, r * -0.7987, r * 0.0643, r * -0.8117);
  ctx.quadraticCurveTo(r * 0.0867, r * -0.8247, r * 0.1109, r * -0.8388);
  ctx.quadraticCurveTo(r * 0.1351, r * -0.8528, r * 0.1598, r * -0.8603);
  ctx.quadraticCurveTo(r * 0.1845, r * -0.8678, r * 0.2074, r * -0.8637);
  ctx.quadraticCurveTo(r * 0.2303, r * -0.8596, r * 0.2496, r * -0.8437);
  ctx.quadraticCurveTo(r * 0.2690, r * -0.8278, r * 0.2845, r * -0.8047);
  ctx.quadraticCurveTo(r * 0.3001, r * -0.7817, r * 0.3138, r * -0.7587);
  ctx.quadraticCurveTo(r * 0.3276, r * -0.7358, r * 0.3429, r * -0.7194);
  ctx.quadraticCurveTo(r * 0.3582, r * -0.7030, r * 0.3779, r * -0.6958);
  ctx.quadraticCurveTo(r * 0.3976, r * -0.6887, r * 0.4225, r * -0.6888);
  ctx.quadraticCurveTo(r * 0.4474, r * -0.6889, r * 0.4753, r * -0.6907);
  ctx.quadraticCurveTo(r * 0.5031, r * -0.6925, r * 0.5295, r * -0.6895);
  ctx.quadraticCurveTo(r * 0.5559, r * -0.6865, r * 0.5762, r * -0.6745);
  ctx.quadraticCurveTo(r * 0.5965, r * -0.6624, r * 0.6081, r * -0.6411);
  ctx.quadraticCurveTo(r * 0.6198, r * -0.6198, r * 0.6240, r * -0.5928);
  ctx.quadraticCurveTo(r * 0.6283, r * -0.5657, r * 0.6296, r * -0.5383);
  ctx.quadraticCurveTo(r * 0.6309, r * -0.5109, r * 0.6354, r * -0.4879);
  ctx.quadraticCurveTo(r * 0.6398, r * -0.4648, r * 0.6519, r * -0.4480);
  ctx.quadraticCurveTo(r * 0.6640, r * -0.4312, r * 0.6845, r * -0.4191);
  ctx.quadraticCurveTo(r * 0.7051, r * -0.4071, r * 0.7304, r * -0.3961);
  ctx.quadraticCurveTo(r * 0.7557, r * -0.3850, r * 0.7791, r * -0.3712);
  ctx.quadraticCurveTo(r * 0.8025, r * -0.3573, r * 0.8174, r * -0.3384);
  ctx.quadraticCurveTo(r * 0.8324, r * -0.3195, r * 0.8355, r * -0.2960);
  ctx.quadraticCurveTo(r * 0.8387, r * -0.2725, r * 0.8315, r * -0.2467);
  ctx.quadraticCurveTo(r * 0.8243, r * -0.2209, r * 0.8127, r * -0.1956);
  ctx.quadraticCurveTo(r * 0.8011, r * -0.1703, r * 0.7926, r * -0.1472);
  ctx.quadraticCurveTo(r * 0.7842, r * -0.1242, r * 0.7846, r * -0.1034);
  ctx.quadraticCurveTo(r * 0.7851, r * -0.0825, r * 0.7957, r * -0.0624);
  ctx.quadraticCurveTo(r * 0.8064, r * -0.0423, r * 0.8232, r * -0.0211);
  ctx.quadraticCurveTo(r * 0.8400, r * 0.0000, r * 0.8557, r * 0.0228);
  ctx.closePath();
  ctx.fillStyle = '#c4945c';
  ctx.fill();

  // Fixed pore dots (seed 889417082)
  ctx.fillStyle = '#6b4a2e';
  const dots = [
    [-0.2745, -0.0417, 0.1200],
    [-0.0086, -0.2500, 0.1200],
    [0.2456, -0.0507, 0.1200],
    [-0.0750, 0.2273, 0.1200],
    [-0.2768, -0.4582, 0.1200],
    [0.4347, -0.3236, 0.1200],
    [0.2531, 0.2825, 0.1200],
    [0.1128, 0.5887, 0.1200],
    [-0.4029, 0.3151, 0.1200],
    [0.1712, -0.5385, 0.1200],
    [0.5819, -0.0007, 0.1200],
    [0.5883, 0.3396, 0.1200],
    [-0.2258, 0.6020, 0.1200],
    [-0.6290, 0.0624, 0.1200],
    [-0.5588, -0.2702, 0.1200],
  ];
  for (const [dx, dy, dr] of dots) {
    ctx.beginPath();
    ctx.arc(r * dx, r * dy, r * dr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawAir(ctx, cx, cy, r) {
  // Air is intentionally invisible — there is nothing to draw. Unlike every
  // other petal in this file, this isn't a placeholder or an unfinished
  // stub; an empty function body IS the correct, final implementation for
  // this petal. Matches the (ctx, cx, cy, r) signature convention used by
  // every other draw* function here so it can be dropped into DRAW_FNS
  // like any other petal with no special-casing, should it ever be wired up.
}

function drawBubblePetal(ctx, cx, cy, r) {
  // Same translucent-body/bright-rim treatment as the bubble mob's
  // drawBubble in mobDrawing.js, minus its two sharp highlight-glint
  // ellipses. In their place: a single soft radial blur, positioned up and
  // to the right of center (ENE), and a thicker outer rim than the mob
  // uses (both changes approved for this petal specifically; the mob's own
  // border was separately thickened to match).
  ctx.save();
  ctx.translate(cx, cy);

  // Body — transparent fill, bright rim (thicker than the mob's rim)
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(191,232,242,0.16)';
  ctx.fill();
  ctx.lineWidth = r * 0.1375;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();

  // Thin teal edge underneath the white rim, for definition
  ctx.lineWidth = r * 0.03125;
  ctx.strokeStyle = 'rgba(143,214,232,0.5)';
  ctx.stroke();

  // Soft blur highlight, positioned up and to the right of center
  const glowX = r * 0.35;
  const glowY = r * -0.3125;
  const glowR = r * 0.275;
  const gradient = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowR);
  gradient.addColorStop(0, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(glowX, glowY, glowR, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.restore();
}

function drawFang(ctx, cx, cy, r) {
  // A diamond with straight edges and small rounded fillets at each of the
  // four points (not sharp corners, not fully smoothed edges), tilted 15°,
  // in a red two-tone. The tilt is baked directly into these coordinates
  // rather than applied as a runtime ctx.rotate, matching this file's
  // convention of pre-computing final geometry.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(r * 0.1956, r * -0.8715);
  ctx.quadraticCurveTo(r * 0.2588, r * -0.9659, r * 0.2664, r * -0.8525);
  ctx.lineTo(r * 0.3217, r * -0.0251);
  ctx.quadraticCurveTo(r * 0.3293, r * 0.0882, r * 0.2660, r * 0.1826);
  ctx.lineTo(r * -0.1956, r * 0.8715);
  ctx.quadraticCurveTo(r * -0.2588, r * 0.9659, r * -0.2664, r * 0.8525);
  ctx.lineTo(r * -0.3217, r * 0.0251);
  ctx.quadraticCurveTo(r * -0.3293, r * -0.0882, r * -0.2660, r * -0.1826);
  ctx.closePath();
  ctx.fillStyle = '#c0342f';
  ctx.strokeStyle = '#7a1a17';
  ctx.lineWidth = r * 0.125;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawRockPetal(ctx, cx, cy, r) {
  // A pentagon (not the rock mob's hexagon-plus-bumps), tilted 15° with the
  // rotation baked into these coordinates, using the rock mob's exact
  // two-tone palette but with a thicker border and each of the five points
  // rounded off with a fillet, same technique as drawFang.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(r * 0.0994, r * -0.9047);
  ctx.quadraticCurveTo(r * 0.2588, r * -0.9659, r * 0.3663, r * -0.8332);
  ctx.lineTo(r * 0.8912, r * -0.1850);
  ctx.quadraticCurveTo(r * 0.9986, r * -0.0523, r * 0.9056, r * 0.0909);
  ctx.lineTo(r * 0.4514, r * 0.7904);
  ctx.quadraticCurveTo(r * 0.3584, r * 0.9336, r * 0.1935, r * 0.8894);
  ctx.lineTo(r * -0.6122, r * 0.6735);
  ctx.quadraticCurveTo(r * -0.7771, r * 0.6293, r * -0.7861, r * 0.4588);
  ctx.lineTo(r * -0.8297, r * -0.3741);
  ctx.quadraticCurveTo(r * -0.8387, r * -0.5446, r * -0.6793, r * -0.6058);
  ctx.closePath();
  ctx.fillStyle = '#8a8580';
  ctx.strokeStyle = '#5c5852';
  ctx.lineWidth = r * 0.195;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawDandelionSeedPetal(ctx, cx, cy, r) {
  // A single dandelion seed, same white/gray-bordered circle style as the
  // dandelion mob's drawDandelionMissile, with one attached black rectangle
  // spoke pointing toward the bottom-left. The seed circle sits at the
  // front (drawn last, on top, at the shape's own origin/near end).
  ctx.save();
  ctx.translate(cx, cy);

  // Spoke, drawn first so the seed sits in front of its near end
  ctx.beginPath();
  ctx.moveTo(r * -0.1040, r * -0.1040);
  ctx.lineTo(r * 0.1040, r * 0.1040);
  ctx.lineTo(r * -0.6031, r * 0.8111);
  ctx.lineTo(r * -0.8111, r * 0.6031);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Seed (the front)
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.4412, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = r * 0.103;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawCompass(ctx, cx, cy, r) {
  // A compass: a circular body (darker steel-blue fill, gray border) with a
  // diamond needle pointing north/south, split into a red top half and a
  // blue bottom half, with a black outline traced around the diamond's
  // full silhouette so it reads cleanly against both halves.
  ctx.save();
  ctx.translate(cx, cy);

  // Body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#3a6ea5';
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = r * 0.1026;
  ctx.fill();
  ctx.stroke();

  const needleLen = r * 0.8333;
  const needleW = r * 0.2821;
  const top    = [0, -needleLen];
  const bottom = [0, needleLen];
  const left   = [-needleW, 0];
  const right  = [needleW, 0];

  // Needle halves
  ctx.fillStyle = '#c0342f';
  ctx.beginPath();
  ctx.moveTo(...top); ctx.lineTo(...right); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...top); ctx.lineTo(...left); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#2f5fa8';
  ctx.beginPath();
  ctx.moveTo(...bottom); ctx.lineTo(...right); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...bottom); ctx.lineTo(...left); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fill();

  // Outline over the whole diamond silhouette
  ctx.beginPath();
  ctx.moveTo(...top);
  ctx.lineTo(...right);
  ctx.lineTo(...bottom);
  ctx.lineTo(...left);
  ctx.closePath();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = r * 0.0513;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawMetal(ctx, cx, cy, r) {
  // A simple metal plate: an elongated rounded rectangle, steel-gray fill,
  // thick dark-gray border.
  ctx.save();
  ctx.translate(cx, cy);

  const halfW = r;
  const halfH = r * (35 / 75);
  const cornerR = r * 0.24;

  ctx.beginPath();
  ctx.moveTo(-halfW + cornerR, -halfH);
  ctx.lineTo(halfW - cornerR, -halfH);
  ctx.arcTo(halfW, -halfH, halfW, -halfH + cornerR, cornerR);
  ctx.lineTo(halfW, halfH - cornerR);
  ctx.arcTo(halfW, halfH, halfW - cornerR, halfH, cornerR);
  ctx.lineTo(-halfW + cornerR, halfH);
  ctx.arcTo(-halfW, halfH, -halfW, halfH - cornerR, cornerR);
  ctx.lineTo(-halfW, -halfH + cornerR);
  ctx.arcTo(-halfW, -halfH, -halfW + cornerR, -halfH, cornerR);
  ctx.closePath();

  ctx.fillStyle = '#9a9a9a';
  ctx.strokeStyle = '#4a4a4a';
  ctx.lineWidth = r * 0.16;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawScales(ctx, cx, cy, r) {
  // A small tiled patch of four sharp-edged, diamond-shaped alligator
  // scales (one on top, two below it side-by-side, one more below those),
  // in the alligator mob's own olive-green with a dark seam border. Each
  // diamond shares a full edge with its neighbors (not just a touching
  // corner point), so the cluster reads as one connected patch of hide
  // with no gaps.
  ctx.save();
  ctx.translate(cx, cy);

  const diamonds = [
    [[0, -0.7692], [0.5, -0.3846], [0, 0], [-0.5, -0.3846]],
    [[-0.5, -0.3846], [0, 0], [-0.5, 0.3846], [-1.0, 0]],
    [[0.5, -0.3846], [1.0, 0], [0.5, 0.3846], [0, 0]],
    [[0, 0], [0.5, 0.3846], [0, 0.7692], [-0.5, 0.3846]],
  ];

  ctx.fillStyle = '#3a6b2c';
  ctx.strokeStyle = '#1f3a17';
  ctx.lineWidth = r * 0.077;
  ctx.lineJoin = 'round';

  for (const pts of diamonds) {
    ctx.beginPath();
    ctx.moveTo(r * pts[0][0], r * pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(r * pts[i][0], r * pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawTooth(ctx, cx, cy, r) {
  // A tooth: wide rounded top (the root), gently curving sides that taper
  // inward, and a smoothly rounded point at the bottom rather than a
  // sharp tip.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(r * 0.0000, r * -1.0000);
  ctx.quadraticCurveTo(r * 0.7304, r * -1.0000, r * 0.5044, r * -0.4174);
  ctx.quadraticCurveTo(r * 0.2783, r * 0.1652, r * 0.1653, r * 0.5826);
  ctx.quadraticCurveTo(r * 0.0522, r * 1.0000, r * 0.0000, r * 1.0000);
  ctx.quadraticCurveTo(r * -0.0522, r * 1.0000, r * -0.1653, r * 0.5826);
  ctx.quadraticCurveTo(r * -0.2783, r * 0.1652, r * -0.5044, r * -0.4174);
  ctx.quadraticCurveTo(r * -0.7304, r * -1.0000, r * 0.0000, r * -1.0000);
  ctx.closePath();
  ctx.fillStyle = '#f5f0e8';
  ctx.strokeStyle = '#c9c0ac';
  ctx.lineWidth = r * 0.154;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawGlass(ctx, cx, cy, r) {
  // A sharp-cornered quadrilateral (not a perfect rectangle — each side a
  // noticeably different length), transparent white fill, thick near-white
  // border, for a clear/frosted glass shard look. No rounded corners, no
  // reflection streaks.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.moveTo(r * -0.8621, r * -1.0000);
  ctx.lineTo(r * 0.8621, r * -0.5862);
  ctx.lineTo(r * 0.7655, r * 0.7241);
  ctx.lineTo(r * -0.7517, r * 1.0000);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = r * 0.166;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

const POWDER_DOTS = [
  { base: [-0.1111, -0.1082], r: 0.0818, wander: [[0.0885, 0.0480], [0.0845, -0.0942], [-0.0069, 0.0887]], phaseOffset: 0.649 },
  { base: [0.0492, -0.0353],  r: 0.0688, wander: [[-0.0507, 0.0088], [0.0148, -0.0974], [-0.0567, -0.0441]], phaseOffset: 0.9163 },
  { base: [0.0071, -0.0716],  r: 0.0819, wander: [[-0.0722, 0.0235], [-0.0747, -0.0996], [0.0743, -0.0581]], phaseOffset: 0.2155 },
  { base: [0.1671, -0.0185],  r: 0.0616, wander: [[0.0923, 0.0078], [0.0356, -0.0590], [0.0882, 0.0381]], phaseOffset: 0.9666 },
  { base: [0.0773, -0.0609],  r: 0.0644, wander: [[-0.0668, -0.0709], [-0.0870, -0.0397], [0.0206, -0.0993]], phaseOffset: 0.6779 },
  { base: [-0.0526, 0.0853],  r: 0.0827, wander: [[-0.0039, -0.0368], [-0.0038, 0.0409], [-0.0886, 0.0950]], phaseOffset: 0.0229 },
  { base: [-0.0002, -0.1655], r: 0.0507, wander: [[0.0575, -0.0268], [0.0157, -0.0982], [-0.0907, -0.0638]], phaseOffset: 0.9552 },
];

function drawPowder(ctx, cx, cy, r) {
  // 7 white dots scattered in a small circular area, all flickering on/off
  // together (hard cut, not a fade) on a very fast cycle, while each dot
  // also wanders slowly around its own small loop within that area. Reads
  // time from Date.now() directly since this isn't wired into the
  // renderer's own phase-passing system yet.
  const now = Date.now();
  const wanderPeriod = 900;   // ms per full wander loop
  const flickerPeriod = 150;  // ms per flicker on/off cycle
  const flickerOnFrac = 0.55; // fraction of each flicker cycle spent visible

  const flickerT = (now % flickerPeriod) / flickerPeriod;
  const visible = flickerT < flickerOnFrac;
  if (!visible) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#ffffff';

  for (const dot of POWDER_DOTS) {
    // Wander: loop through [base, ...wander, base] via a simple 4-segment
    // Catmull-Rom-free linear interpolation (matches the SVG preview's
    // straight-line animateMotion path).
    const loopPts = [dot.base, ...dot.wander, dot.base];
    const wT = (((now / wanderPeriod) + dot.phaseOffset) % 1) * (loopPts.length - 1);
    const segIdx = Math.floor(wT);
    const segFrac = wT - segIdx;
    const p0 = loopPts[segIdx];
    const p1 = loopPts[Math.min(segIdx + 1, loopPts.length - 1)];
    const x = (p0[0] + (p1[0] - p0[0]) * segFrac) * r;
    const y = (p0[1] + (p1[1] - p0[1]) * segFrac) * r;

    ctx.beginPath();
    ctx.arc(x, y, dot.r * r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawMoon(ctx, cx, cy, r) {
  // A full circle in a dark gray "moon" tone with a thinner darker-gray
  // border, and a handful of semi-transparent gray crater dots scattered
  // across the face for detail.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#7c7c78';
  ctx.strokeStyle = '#383836';
  ctx.lineWidth = r * 0.0897;
  ctx.fill();
  ctx.stroke();

  const craters = [
    [0.0331, 0.4372, 0.1051],
    [-0.3826, -0.2926, 0.0821],
    [0.5918, 0.0491, 0.0974],
    [0.2081, -0.3445, 0.1256],
    [-0.5232, 0.0905, 0.1449],
  ];
  ctx.fillStyle = 'rgba(79, 79, 75, 0.75)';
  for (const [nx, ny, nr] of craters) {
    ctx.beginPath();
    ctx.arc(r * nx, r * ny, r * nr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHeavy(ctx, cx, cy, r) {
  // A circle — black border, dark gray inner fill, with a single light
  // gray dot placed in the upper-middle-right for a bit of surface detail.
  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3a3a';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = r * 0.1282;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(r * 0.3590, r * -0.4359, r * 0.1538, 0, Math.PI * 2);
  ctx.fillStyle = '#8a8a8a';
  ctx.fill();

  ctx.restore();
}

function drawPincer(ctx, cx, cy, r) {

  // Crescent shape (from sketch reference), normalized to a unit box
  // centered at origin, then scaled by r. Source bbox: 139.89 x 162.95,
  // centered at (108.159, 261.599) in source coordinates.
  const scale = (r * 2) / 162.94932; // fit longest dimension to 2r
  const ox = 108.15931450000001;
  const oy = 261.59946;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI); // flipped upside down
  ctx.scale(scale, scale);
  ctx.translate(-ox, -oy);

  ctx.beginPath();
  ctx.moveTo(131.0054, 180.1248);
  ctx.bezierCurveTo(178.10471, 240.36146, 143.92268, 343.07412, 38.213919, 284.78726);
  ctx.lineTo(105.25831, 283.4245);
  ctx.lineTo(128.49725, 226.58156);
  ctx.closePath();

  ctx.lineWidth = 13.1979;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#0e0e0e';
  ctx.strokeStyle = '#000000';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawBone(ctx, cx, cy, r) {
  // Dog-bone shape: straight bar with a rounded lobe fused to each end.
  // Authored at a reference size where the shape spans ~117 units from
  // center; scaled so that span maps to r.
  const s = r / 117;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-40 * Math.PI / 180);
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.moveTo(-70, -13);
  ctx.lineTo(70, -13);
  ctx.bezierCurveTo(70, -26, 81, -35, 93, -35);
  ctx.bezierCurveTo(106, -35, 117, -24, 117, -12);
  ctx.bezierCurveTo(117, -3, 111, 4, 104, 8);
  ctx.bezierCurveTo(111, 12, 117, 19, 117, 28);
  ctx.bezierCurveTo(117, 40, 106, 51, 93, 51);
  ctx.bezierCurveTo(81, 51, 70, 42, 70, 29);
  ctx.lineTo(-70, 29);
  ctx.bezierCurveTo(-70, 42, -81, 51, -93, 51);
  ctx.bezierCurveTo(-106, 51, -117, 40, -117, 28);
  ctx.bezierCurveTo(-117, 19, -111, 12, -104, 8);
  ctx.bezierCurveTo(-111, 4, -117, -3, -117, -12);
  ctx.bezierCurveTo(-117, -24, -106, -35, -93, -35);
  ctx.bezierCurveTo(-81, -35, -70, -26, -70, -13);
  ctx.closePath();

  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#f5f5f5';
  ctx.strokeStyle = '#d8d8d8';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawStick(ctx, cx, cy, r) {
  // Y-shaped stick: main branch with a smaller branch splitting off one
  // side, drawn as a single continuous outline, plus a small inward notch
  // for detail and a slight rounded curve at the top. A leaf (matching the
  // Leaf petal's design) sits partway up the main branch.
  // Authored at a reference size where the stick spans ~105 units above
  // and ~105 below center; scaled so that span maps to r.
  const s = r / 105;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(20 * Math.PI / 180);
  ctx.scale(s, s);

  // ── Stick outline ──────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(-14, 105);
  ctx.lineTo(-14, -13);
  ctx.lineTo(-60, -53);
  ctx.lineTo(-45, -68);
  ctx.lineTo(-14, -41);
  ctx.lineTo(-14, -95);
  ctx.quadraticCurveTo(-14, -105, 14, -105);
  ctx.quadraticCurveTo(14, -95, 14, -88);
  ctx.lineTo(14, -4);
  ctx.lineTo(6, 11);
  ctx.lineTo(14, 26);
  ctx.lineTo(14, 105);
  ctx.closePath();
  ctx.fillStyle = '#6e4a28';
  ctx.strokeStyle = '#4a2e18';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fill();
  ctx.stroke();

  // ── Leaf — same shape as the Leaf petal, scaled and placed on the stick ──
  ctx.save();
  ctx.translate(28, -86);
  ctx.rotate(72 * Math.PI / 180);
  ctx.scale(1.44, 1.44);

  // Stem
  ctx.beginPath();
  ctx.moveTo(-3.282, 7.366);
  ctx.bezierCurveTo(-4.2, 9.0, -5.5, 11.0, -8.126, 13.488);
  ctx.strokeStyle = '#008000';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Leaf body
  ctx.beginPath();
  ctx.moveTo(-3.639, 6.702);
  ctx.bezierCurveTo(-3.639, 6.702, -5.148, 5.441, -6.121, 3.494);
  ctx.bezierCurveTo(-6.16, 3.417, -6.573, 3.149, -6.61, 3.069);
  ctx.bezierCurveTo(-6.638, 3.009, -6.319, 3.138, -6.345, 3.076);
  ctx.bezierCurveTo(-6.777, 2.085, -7.048, 0.941, -6.925, -0.289);
  ctx.bezierCurveTo(-6.907, -0.465, -7.181, -1.749, -7.155, -1.921);
  ctx.bezierCurveTo(-7.119, -2.165, -6.78, -1.294, -6.729, -1.528);
  ctx.bezierCurveTo(-6.432, -2.899, -5.902, -4.092, -5.304, -5.091);
  ctx.bezierCurveTo(-5.217, -5.236, -5.171, -6.227, -5.082, -6.364);
  ctx.bezierCurveTo(-5.007, -6.478, -4.891, -5.739, -4.815, -5.848);
  ctx.bezierCurveTo(-4.121, -6.846, -3.397, -7.597, -2.873, -8.082);
  ctx.bezierCurveTo(-2.78, -8.168, -2.365, -9.057, -2.238, -9.152);
  ctx.bezierCurveTo(-2.082, -9.269, -2.205, -8.593, -2.007, -8.719);
  ctx.bezierCurveTo(-1.238, -9.209, -0.191, -9.759, 0.843, -10.266);
  ctx.bezierCurveTo(0.967, -10.327, 1.402, -11.035, 1.526, -11.095);
  ctx.bezierCurveTo(1.706, -11.182, 1.573, -10.619, 1.748, -10.701);
  ctx.bezierCurveTo(3.286, -11.427, 4.587, -11.978, 4.587, -11.978);
  ctx.bezierCurveTo(4.587, -11.978, 4.956, -10.655, 5.357, -9.019);
  ctx.bezierCurveTo(5.389, -8.89, 5.776, -9.314, 5.808, -9.182);
  ctx.bezierCurveTo(5.845, -9.029, 5.563, -8.32, 5.599, -8.164);
  ctx.bezierCurveTo(5.777, -7.403, 5.951, -6.615, 6.09, -5.886);
  ctx.bezierCurveTo(6.14, -5.622, 6.522, -5.996, 6.562, -5.751);
  ctx.bezierCurveTo(6.585, -5.61, 6.271, -4.843, 6.29, -4.71);
  ctx.bezierCurveTo(6.443, -3.634, 6.52, -2.602, 6.449, -1.598);
  ctx.bezierCurveTo(6.435, -1.4, 6.961, -1.833, 6.935, -1.637);
  ctx.bezierCurveTo(6.915, -1.483, 6.345, -0.701, 6.317, -0.549);
  ctx.bezierCurveTo(6.121, 0.514, 5.727, 1.553, 5.047, 2.587);
  ctx.bezierCurveTo(4.915, 2.787, 5.677, 2.313, 5.523, 2.513);
  ctx.bezierCurveTo(5.383, 2.696, 4.329, 3.554, 4.169, 3.737);
  ctx.bezierCurveTo(3.649, 4.332, 3.102, 4.822, 2.561, 5.226);
  ctx.bezierCurveTo(2.49, 5.278, 2.962, 5.474, 2.891, 5.524);
  ctx.bezierCurveTo(2.775, 5.607, 2.117, 5.54, 2.002, 5.615);
  ctx.bezierCurveTo(0.119, 6.835, -1.55, 7.05, -1.55, 7.05);
  ctx.bezierCurveTo(-1.55, 7.05, -3.639, 6.702, -3.639, 6.702);
  ctx.closePath();
  ctx.fillStyle = '#00C800';
  ctx.strokeStyle = '#008000';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fill();
  ctx.stroke();

  // Midrib vein
  ctx.beginPath();
  ctx.moveTo(3.045, -8.042);
  ctx.bezierCurveTo(0.303, -3.466, 0.303, -1.466, 0.303, -1.466);
  ctx.bezierCurveTo(0.303, 0.534, -2.444, 2.079, -2.444, 4.079);
  ctx.strokeStyle = '#008000';
  ctx.lineWidth = 7.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

function drawSalt(ctx, cx, cy, r) {
  // Salt crystal: a jagged near-circular outline with 7 randomly varied
  // spikes, generated once with a fixed seed so the shape is consistent
  // every time it's drawn. Authored at a reference size where points reach
  // up to ~46 units from center; scaled so that span maps to r.
  const s = r / 46;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.moveTo(42.7, 0.0);
  ctx.lineTo(27.5, 13.3);
  ctx.lineTo(30.2, 37.9);
  ctx.lineTo(7.1, 31.1);
  ctx.lineTo(-9.1, 39.9);
  ctx.lineTo(-18.2, 22.9);
  ctx.lineTo(-43.2, 20.8);
  ctx.lineTo(-33.9, 0.0);
  ctx.lineTo(-42.2, -20.3);
  ctx.lineTo(-21.3, -26.7);
  ctx.lineTo(-10.6, -46.3);
  ctx.lineTo(7.6, -33.1);
  ctx.lineTo(25.8, -32.4);
  ctx.lineTo(30.7, -14.8);
  ctx.closePath();

  ctx.fillStyle   = '#f4f4f4';
  ctx.strokeStyle = '#c9c9c9';
  ctx.lineWidth   = 5;
  ctx.lineJoin    = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawLightning(ctx, cx, cy, r) {
  // Lightning spark: an 8-point burst star — outward tips with shallow
  // concave notches cut between them (not a second ring of outward points).
  // A smaller matching burst is nested in the center as an accent, drawn in
  // the same dark color as the outer stroke so it reads as punched-in detail.
  // Authored at a reference size where the outer tips reach 46 units from
  // center; scaled so that span maps to r (same convention as drawSalt).
  const s = r / 46;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  // Outer burst
  ctx.beginPath();
  ctx.moveTo(0.00, -46.00);
  ctx.lineTo(10.38, -25.06);
  ctx.lineTo(32.53, -32.53);
  ctx.lineTo(25.06, -10.38);
  ctx.lineTo(46.00, 0.00);
  ctx.lineTo(25.06, 10.38);
  ctx.lineTo(32.53, 32.53);
  ctx.lineTo(10.38, 25.06);
  ctx.lineTo(0.00, 46.00);
  ctx.lineTo(-10.38, 25.06);
  ctx.lineTo(-32.53, 32.53);
  ctx.lineTo(-25.06, 10.38);
  ctx.lineTo(-46.00, 0.00);
  ctx.lineTo(-25.06, -10.38);
  ctx.lineTo(-32.53, -32.53);
  ctx.lineTo(-10.38, -25.06);
  ctx.closePath();

  ctx.fillStyle   = '#4dd8c8';
  ctx.strokeStyle = '#0e6e5c';
  ctx.lineWidth   = 5;
  ctx.lineJoin    = 'round';
  ctx.fill();
  ctx.stroke();

  // Inner accent burst — same shape, smaller and rotated 22.5°, filled in
  // the outer border color so it reads as a punched-in core rather than a
  // highlight.
  ctx.beginPath();
  ctx.moveTo(5.87, -14.17);
  ctx.lineTo(5.84, -5.84);
  ctx.lineTo(14.17, -5.87);
  ctx.lineTo(8.26, 0.00);
  ctx.lineTo(14.17, 5.87);
  ctx.lineTo(5.84, 5.84);
  ctx.lineTo(5.87, 14.17);
  ctx.lineTo(0.00, 8.26);
  ctx.lineTo(-5.87, 14.17);
  ctx.lineTo(-5.84, 5.84);
  ctx.lineTo(-14.17, 5.87);
  ctx.lineTo(-8.26, 0.00);
  ctx.lineTo(-14.17, -5.87);
  ctx.lineTo(-5.84, -5.84);
  ctx.lineTo(-5.87, -14.17);
  ctx.lineTo(-0.00, -8.26);
  ctx.closePath();

  ctx.fillStyle   = '#0e6e5c';
  ctx.strokeStyle = '#0e6e5c';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawDisc(ctx, cx, cy, r) {
  // In-world, Disc has no drawn shape of its own — it's a border-color tint
  // on the player (see the comment above). The icon needs SOME visual
  // though, so it gets a simple black outline ring, matching the "outline
  // only" character the in-world tint is going for.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();
  ctx.restore();
}

function drawCutter(ctx, cx, cy, r) {
  // Saw ring with filled body and teeth — unlike disc which is outline only
  ctx.save();
  ctx.translate(cx, cy);

  const rot = ctx._cutterRot ?? 0;

  const ringR     = r * 1.0;
  const ringThick = r * 0.11;
  const innerR    = ringR - ringThick;
  const toothCount = 14;
  const toothH    = r * 0.18;
  const toothHW   = (2 * Math.PI * ringR / toothCount) * 0.36;

  ctx.save();
  ctx.rotate(rot);
  for (let i = 0; i < toothCount; i++) {
    const a   = (i / toothCount) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    const px  = -sin, py = cos;

    const bl  = [cos * ringR - px * toothHW, sin * ringR - py * toothHW];
    const br  = [cos * ringR + px * toothHW, sin * ringR + py * toothHW];
    const tip = [cos * (ringR + toothH),     sin * (ringR + toothH)];

    ctx.beginPath();
    ctx.moveTo(bl[0], bl[1]);
    ctx.lineTo(br[0], br[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.closePath();
    ctx.fillStyle   = '#111111';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = Math.max(0.5, r * 0.025);
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.arc(0, 0, innerR, 0, Math.PI * 2, true);
  ctx.fillStyle = '#111111';
  ctx.fill('evenodd');

  ctx.restore();
}

function drawBeeEgg(ctx, cx, cy, r) {
  const rx = r * 0.66;
  const ry = r;
  const bw = Math.max(1, r * 0.13);

  ctx.save();
  ctx.translate(cx, cy);

  // Short stinger — drawn first (behind body)
  const tipR  = r * 0.06;
  const tipCY = ry + r * 0.28;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(-r * 0.22, ry - r * 0.05);
  ctx.quadraticCurveTo(-r * 0.08, ry + r * 0.18, -tipR, tipCY);
  ctx.arc(0, tipCY, tipR, Math.PI, 0, true);
  ctx.quadraticCurveTo(r * 0.08, ry + r * 0.18, r * 0.22, ry - r * 0.05);
  ctx.closePath();
  ctx.fill();

  // Border ring
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + bw, ry + bw, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c8960a';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f5cf4b';
  ctx.fill();

  // 4 stripes clipped to body
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1a1a1a';
  for (const sy of [-ry * 0.65, -ry * 0.22, ry * 0.22, ry * 0.65]) {
    ctx.fillRect(-rx - 2, sy - ry * 0.13, (rx + 2) * 2, ry * 0.26);
  }
  ctx.restore();

  // Antennae drawn last — queen bee style
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth   = Math.max(1, r * 0.12);
  ctx.lineCap     = 'round';

  ctx.beginPath();
  ctx.moveTo(-r * 0.18, -ry + r * 0.1);
  ctx.quadraticCurveTo(-r * 0.08, -ry - r * 0.32, -r * 0.52, -r * 0.52 - ry);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 0.52, -r * 0.52 - ry, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 0.18, -ry + r * 0.1);
  ctx.quadraticCurveTo(r * 0.08, -ry - r * 0.32, r * 0.52, -r * 0.52 - ry);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 0.52, -r * 0.52 - ry, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();

  ctx.restore();
}

function drawMagnet(ctx, cx, cy, r) {
  // Rotate the whole magnet around its centre to face outward from orbit.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ctx._magnetAngle ?? 0);
  ctx.translate(-cx, -cy);
  // Replicates the SVG magnet exactly — curved bar with red (+) and blue (-)
  // halves, black outline, white seam divider, and +/- labels at the tips.
  //
  // The SVG was designed in a 300×300 viewBox. We scale everything so the
  // magnet fits inside the given radius r, centred on (cx, cy).
  const S  = r / 115;   // 115 ≈ half the diagonal extent of the 300×300 shape
  const OX = cx - 150 * S; // map SVG x=150 → cx
  const OY = cy - 150 * S; // map SVG y=150 → cy

  // Transform an SVG-space point to canvas space.
  const T = (x, y) => [OX + x * S, OY + y * S];

  // Apply a 2-D matrix (a,b,c,d,e,f) to a local point and map to canvas.
  function applyMat(x, y, a, b, c, d, e, f) {
    return T(a * x + c * y + e, b * x + d * y + f);
  }

  // Build a canvas Path2D from a list of [x,y] canvas-space points (moveTo first,
  // then lineTo), closed at the end.
  function polyPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  // ── Helper: draw one SVG path piece with a given fill/stroke ────────────────
  // Each piece is defined by its matrix and a draw callback that builds the path
  // in SVG local coordinates using ctx primitives mapped through applyMat.

  function drawPiece(a, b, c, d, e, f, fillColor, strokeColor, strokeWidth, buildPath) {
    ctx.save();
    ctx.beginPath();
    buildPath(a, b, c, d, e, f);
    ctx.fillStyle   = fillColor;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = strokeWidth * S;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Outline pass (drawn first, slightly fatter) ──────────────────────────────
  // We draw each piece twice: once as a fat black outline, once with its colour.

  const outlineW = 10;

  // Shared path builders for each of the 6 SVG pieces:

  // 1. Red arc
  function redArcPath(a, b, c, d, e, f) {
    const p = (x, y) => applyMat(x, y, a, b, c, d, e, f);
    const [mx, my] = p(126.8, 25.648);
    ctx.moveTo(mx, my);
    // bezier approximating the SVG arc curve
    const [c1x,c1y] = p(139.74, 41.068);
    const [c2x,c2y] = p(145.611, 61.213);
    const [ex1,ey1] = p(142.984, 81.171);
    ctx.bezierCurveTo(c1x,c1y, c2x,c2y, ex1,ey1);
    const [c3x,c3y] = p(140.356, 101.129);
    const [c4x,c4y] = p(129.471, 119.067);
    const [ex2,ey2] = p(112.981, 130.613);
    ctx.bezierCurveTo(c3x,c3y, c4x,c4y, ex2,ey2);
    const [lx,ly]   = p(92.39, 101.206);
    ctx.lineTo(lx, ly);
    const [c5x,c5y] = p(100.635, 95.433);
    const [c6x,c6y] = p(106.078, 86.464);
    const [ex3,ey3] = p(107.392, 76.485);
    ctx.bezierCurveTo(c5x,c5y, c6x,c6y, ex3,ey3);
    const [c7x,c7y] = p(108.705, 66.506);
    const [c8x,c8y] = p(105.77, 56.434);
    const [ex4,ey4] = p(99.3, 48.723);
    ctx.bezierCurveTo(c7x,c7y, c8x,c8y, ex4,ey4);
    ctx.closePath();
  }

  // 2. Blue arc
  function blueArcPath(a, b, c, d, e, f) {
    const p = (x, y) => applyMat(x, y, a, b, c, d, e, f);
    const [mx, my] = p(126.767, 25.641);
    ctx.moveTo(mx, my);
    const [c1x,c1y] = p(139.703, 41.057);
    const [c2x,c2y] = p(145.573, 61.197);
    const [ex1,ey1] = p(142.946, 81.149);
    ctx.bezierCurveTo(c1x,c1y, c2x,c2y, ex1,ey1);
    const [c3x,c3y] = p(140.319, 101.102);
    const [c4x,c4y] = p(129.437, 119.036);
    const [ex2,ey2] = p(112.952, 130.579);
    ctx.bezierCurveTo(c3x,c3y, c4x,c4y, ex2,ey2);
    const [lx,ly]   = p(92.366, 101.18);
    ctx.lineTo(lx, ly);
    const [c5x,c5y] = p(100.609, 95.408);
    const [c6x,c6y] = p(106.05, 86.441);
    const [ex3,ey3] = p(107.363, 76.465);
    ctx.bezierCurveTo(c5x,c5y, c6x,c6y, ex3,ey3);
    const [c7x,c7y] = p(108.677, 66.488);
    const [c8x,c8y] = p(105.742, 56.419);
    const [ex4,ey4] = p(99.274, 48.71);
    ctx.bezierCurveTo(c7x,c7y, c8x,c8y, ex4,ey4);
    ctx.closePath();
  }

  // 3. Blue cap (pie wedge)
  function blueCapPath(a, b, c, d, e, f) {
    const p = (x, y) => applyMat(x, y, a, b, c, d, e, f);
    const scale = 0.83; // scale to match body width
    const [mx, my] = p(18.057 * scale + 0.2, 18.057 * scale);
    ctx.moveTo(mx, my);
    const [lx, ly] = p(18.057 * scale + 0.2, 0);
    ctx.lineTo(lx, ly);
    // arc: centre (18.057,18.057), r=18.057, from 270° to 0° in local
    // approximate with bezier
    const [c1x,c1y] = p(28.029 * scale + 0.2, 0);
    const [c2x,c2y] = p(36.113 * scale + 0.2, 8.084 * scale);
    const [ex1,ey1] = p(36.113 * scale + 0.2, 18.057 * scale);
    ctx.bezierCurveTo(c1x,c1y, c2x,c2y, ex1,ey1);
    const [c3x,c3y] = p(36.113 * scale + 0.2, 32.029 * scale);
    const [c4x,c4y] = p(26.029 * scale + 0.2, 44.113 * scale);
    const [ex2,ey2] = p(18.057 * scale + 0.2, 44.113 * scale);
    ctx.bezierCurveTo(c3x,c3y, c4x,c4y, ex2,ey2);
    ctx.closePath();
  }

  // 4. Red cap (pie wedge)
  function redCapPath(a, b, c, d, e, f) {
    const p = (x, y) => applyMat(x, y, a, b, c, d, e, f);
    const scale = 0.83; // scale to match body width
    const [mx, my] = p(18.057 * scale + 0.2, 18.057 * scale);
    ctx.moveTo(mx, my);
    const [lx, ly] = p(18.057 * scale + 0.2, 0);
    ctx.lineTo(lx, ly);
    const [c1x,c1y] = p(28.029 * scale + 0.2, 0);
    const [c2x,c2y] = p(36.113 * scale + 0.2, 8.084 * scale);
    const [ex1,ey1] = p(36.113 * scale + 0.2, 18.057 * scale);
    ctx.bezierCurveTo(c1x,c1y, c2x,c2y, ex1,ey1);
    const [c3x,c3y] = p(36.113 * scale + 0.2, 32.029 * scale);
    const [c4x,c4y] = p(26.029 * scale + 0.2, 44.113 * scale);
    const [ex2,ey2] = p(18.057 * scale + 0.2, 44.113 * scale);
    ctx.bezierCurveTo(c3x,c3y, c4x,c4y, ex2,ey2);
    ctx.closePath();
  }

  // 5 & 6. Rectangles — just 4 corners
  function rectPath(a, b, c, d, e, f, w, h) {
    const p = (x, y) => applyMat(x, y, a, b, c, d, e, f);
    const pts = [p(0,0), p(w,0), p(w,h), p(0,h)];
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[3][0], pts[3][1]);
    ctx.closePath();
  }

  // SVG matrices for each piece
  const RAm = [0.6058201566434469,0.7956016200363757,-0.795601620036376,0.6058201566434471,156.89454327115595,46.749948457235675];
  const BAm = [-0.8568887533689644,0.5155013718214356,-0.5155013718214356,-0.8568887533689644,241.78908279438832,171.87833947112847];
  const BCm = [0.3425501732458624,-0.7321554814027983,0.8832551114123374,0.4132444530154866,91.43810713359254,86.81832512217552];
  const RCm = [0.18458233186494152,-0.7969022324791276,0.9685275498643307,0.22433501418767698,185.33429480906224,121.98402587640474];
  const BRm = [0.9667070473457006,0.4317048276444321,-0.2860203535920907,0.6404790352020735,97.1318190302078,74.51857262355892];
  const RRm = [1.0332037768762286,0.2310444308959815,-0.15307544782607974,0.6845355684514638,188.5887146670764,108.73010957209424];

  // ── Draw black outlines first ─────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = outlineW * S;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  ctx.beginPath(); redArcPath(...RAm);  ctx.stroke();
  ctx.beginPath(); blueArcPath(...BAm); ctx.stroke();
  ctx.beginPath(); blueCapPath(...BCm); ctx.stroke();
  ctx.beginPath(); redCapPath(...RCm);  ctx.stroke();
  ctx.beginPath(); rectPath(...BRm, 33.918, 69.251); ctx.stroke();
  ctx.beginPath(); rectPath(...RRm, 33.918, 69.251); ctx.stroke();
  ctx.restore();

  // ── Draw filled colour pieces ─────────────────────────────────────────────
  const RED  = '#ff3737';
  const BLUE = '#074dff';

  ctx.save();
  ctx.fillStyle = RED;  ctx.beginPath(); redArcPath(...RAm);  ctx.fill();
  ctx.fillStyle = BLUE; ctx.beginPath(); blueArcPath(...BAm); ctx.fill();
  ctx.fillStyle = BLUE; ctx.beginPath(); blueCapPath(...BCm); ctx.fill();
  ctx.fillStyle = RED;  ctx.beginPath(); redCapPath(...RCm);  ctx.fill();
  ctx.fillStyle = BLUE; ctx.beginPath(); rectPath(...BRm, 33.918, 69.251); ctx.fill();
  ctx.fillStyle = RED;  ctx.beginPath(); rectPath(...RRm, 33.918, 69.251); ctx.fill();
  ctx.restore();


  // ── White seam divider ────────────────────────────────────────────────────
  ctx.save();
  const [sx1,sy1] = T(132.0, 181.4);
  const [sx2,sy2] = T(120.7, 215.5);
  ctx.beginPath();
  ctx.moveTo(sx1, sy1);
  ctx.lineTo(sx2, sy2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 3 * S;
  ctx.lineCap     = 'round';
  ctx.stroke();
  ctx.restore();

  // ── +/- labels (drawn last) ───────────────────────────────────────────────
  const fontSize = Math.max(6, 22 * S);
  ctx.save();
  ctx.font         = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // + on red tip: SVG pos (208,116), rotation -1°
  const [px, py] = T(208, 116);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-1 * Math.PI / 180);
  ctx.fillText('+', 0, 0);
  ctx.restore();

  // − on blue tip: SVG pos (110,83), rotation 32°
  const [mx2, my2] = T(110, 83);
  ctx.save();
  ctx.translate(mx2, my2);
  ctx.rotate(32 * Math.PI / 180);
  ctx.fillText('−', 0, 0);
  ctx.restore();

  ctx.restore(); // inner label save
  ctx.restore(); // outer rotate wrapper
}

function drawHoney(ctx, cx, cy, r) {
  const sides = 6;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#F9D71C';
  ctx.fill();
  ctx.strokeStyle = '#C8A51D';
  ctx.lineWidth = Math.max(0.5, r * 0.18);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawSoil(ctx, cx, cy, r) {
  const sides = 7;
  const jitter  = [0, 0.04, -0.05, 0.03, -0.03, 0.05, -0.02];
  const rJitter = [1, 0.95,  0.98, 0.96,  0.99, 0.94,  0.97];

  // Border
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a  = (Math.PI * 2 / sides) * i - Math.PI / 2 + jitter[i];
    const rr = (r + r * 0.18) * rJitter[i];
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
            : ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = '#4c3713';
  ctx.fill();

  // Fill
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a  = (Math.PI * 2 / sides) * i - Math.PI / 2 + jitter[i];
    const rr = r * rJitter[i];
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
            : ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = '#664b1d';
  ctx.fill();
}

// Map spriteIndex → draw function  (matches petalTypes.js spriteIndex values)

function drawLeaf(ctx, cx, cy, r) {
  // Leaf drawn from SVG path (original viewBox origin 231.803,166.494,
  // size 15.379×26.687). Visual centre of leaf body ≈ SVG (239.5, 179.5).
  // Scale so the leaf fits within radius r.
  const SVG_CX = 7.7;   // centre in normalised coords (subtract origin first)
  const SVG_CY = 13.0;
  const SVG_SCALE = 13; // normalised units per r

  const s = r / SVG_SCALE;

  // All path coords are already relative to the SVG origin (231.803, 166.494).
  // We shift by (-SVG_CX, -SVG_CY) so the leaf centres on (cx, cy).
  const ox = -SVG_CX;
  const oy = -SVG_CY;
  function p(x, y) { return [cx + (x + ox) * s, cy + (y + oy) * s]; }

  const outlineWidth = 8.0 / SVG_SCALE;            // 8px screen → local units
  const veinWidth    = 7.5 / SVG_SCALE;            // 7.5px screen → local units
  const stemWidth    = Math.max(1, r * 0.15);       // scales with zoom like the rest of the leaf

  ctx.save();

  // ── Stem (drawn first, behind leaf) ────────────────────────────────────
  const [stemSX, stemSY] = p(4.418, 20.366);
  const [stemEX, stemEY] = p(0.374 - 0.8, 26.488);
  ctx.beginPath();
  ctx.moveTo(stemSX, stemSY);
  ctx.bezierCurveTo(
    cx + (3.5  + ox) * s, cy + (22.0 + oy) * s,
    cx + (2.2  + ox) * s, cy + (24.0 + oy) * s,
    stemEX, stemEY
  );
  ctx.strokeStyle = '#008000';
  ctx.lineWidth   = stemWidth;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Leaf body ───────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(...p(4.061, 19.702));
  ctx.bezierCurveTo(...p(4.061,19.702), ...p(2.552,18.441), ...p(1.579,16.494));
  ctx.bezierCurveTo(...p(1.540,16.417), ...p(1.127,16.149), ...p(1.090,16.069));
  ctx.bezierCurveTo(...p(1.062,16.009), ...p(1.381,16.138), ...p(1.355,16.076));
  ctx.bezierCurveTo(...p(0.923,15.085), ...p(0.652,13.941), ...p(0.775,12.711));
  ctx.bezierCurveTo(...p(0.793,12.535), ...p(0.519,11.251), ...p(0.545,11.079));
  ctx.bezierCurveTo(...p(0.581,10.835), ...p(0.920,11.706), ...p(0.971,11.472));
  ctx.bezierCurveTo(...p(1.268,10.101), ...p(1.798, 8.908), ...p(2.396, 7.909));
  ctx.bezierCurveTo(...p(2.483, 7.764), ...p(2.529, 6.773), ...p(2.618, 6.636));
  ctx.bezierCurveTo(...p(2.693, 6.522), ...p(2.809, 7.261), ...p(2.885, 7.152));
  ctx.bezierCurveTo(...p(3.579, 6.154), ...p(4.303, 5.403), ...p(4.827, 4.918));
  ctx.bezierCurveTo(...p(4.920, 4.832), ...p(5.335, 3.943), ...p(5.462, 3.848));
  ctx.bezierCurveTo(...p(5.618, 3.731), ...p(5.495, 4.407), ...p(5.693, 4.281));
  ctx.bezierCurveTo(...p(6.462, 3.791), ...p(7.509, 3.241), ...p(8.543, 2.734));
  ctx.bezierCurveTo(...p(8.667, 2.673), ...p(9.102, 1.965), ...p(9.226, 1.905));
  ctx.bezierCurveTo(...p(9.406, 1.818), ...p(9.273, 2.381), ...p(9.448, 2.299));
  ctx.bezierCurveTo(...p(10.986, 1.573), ...p(12.287, 1.022), ...p(12.287, 1.022));
  ctx.bezierCurveTo(...p(12.287, 1.022), ...p(12.656, 2.345), ...p(13.057, 3.981));
  ctx.bezierCurveTo(...p(13.089, 4.110), ...p(13.476, 3.686), ...p(13.508, 3.818));
  ctx.bezierCurveTo(...p(13.545, 3.971), ...p(13.263, 4.680), ...p(13.299, 4.836));
  ctx.bezierCurveTo(...p(13.477, 5.597), ...p(13.651, 6.385), ...p(13.790, 7.114));
  ctx.bezierCurveTo(...p(13.840, 7.378), ...p(14.222, 7.004), ...p(14.262, 7.249));
  ctx.bezierCurveTo(...p(14.285, 7.390), ...p(13.971, 8.157), ...p(13.990, 8.290));
  ctx.bezierCurveTo(...p(14.143, 9.366), ...p(14.220,10.398), ...p(14.149,11.402));
  ctx.bezierCurveTo(...p(14.135,11.600), ...p(14.661,11.167), ...p(14.635,11.363));
  ctx.bezierCurveTo(...p(14.615,11.517), ...p(14.045,12.299), ...p(14.017,12.451));
  ctx.bezierCurveTo(...p(13.821,13.514), ...p(13.427,14.553), ...p(12.747,15.587));
  ctx.bezierCurveTo(...p(12.615,15.787), ...p(13.377,15.313), ...p(13.223,15.513));
  ctx.bezierCurveTo(...p(13.083,15.696), ...p(12.029,16.554), ...p(11.869,16.737));
  ctx.bezierCurveTo(...p(11.349,17.332), ...p(10.802,17.822), ...p(10.261,18.226));
  ctx.bezierCurveTo(...p(10.190,18.278), ...p(10.662,18.474), ...p(10.591,18.524));
  ctx.bezierCurveTo(...p(10.475,18.607), ...p(9.817,18.540), ...p(9.702,18.615));
  ctx.bezierCurveTo(...p(7.819,19.835), ...p(6.150,20.050), ...p(6.150,20.050));
  ctx.bezierCurveTo(...p(6.150,20.050), ...p(4.061,19.702), ...p(4.061,19.702));
  ctx.closePath();
  ctx.fillStyle   = '#00C800';
  ctx.fill();
  ctx.strokeStyle = '#008000';
  ctx.lineWidth   = outlineWidth * s;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Central midrib ──────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(...p(10.745, 4.958));
  ctx.bezierCurveTo(
    ...p(10.745, 4.958),
    ...p(8.003,  9.534),
    ...p(8.003, 11.534)
  );
  ctx.bezierCurveTo(
    ...p(8.003, 13.534),
    ...p(5.256, 15.079),
    ...p(5.256, 17.079)
  );
  ctx.strokeStyle = '#008000';
  ctx.lineWidth   = veinWidth * s;
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();
}

// ── Corn silhouette path ────────────────────────────────────────────────────
// Traced from a reference outline: a rounded, roughly triangular kernel shape
// with a sharp notch cut into the lower-left edge. Coordinates below are
// normalized (unit space, origin at shape centroid, max radius ≈ 1) and are
// scaled by r at draw time via cornPath().
const CORN_START = [-0.2131, -0.8842];
const CORN_SEGMENTS = [
  [-0.2627,-0.8821, -0.2975,-0.8718, -0.3386,-0.8566],
  [-0.3797,-0.8414, -0.4222,-0.8194, -0.4598,-0.7928],
  [-0.4974,-0.7662, -0.5308,-0.7354, -0.5641,-0.6971],
  [-0.5974,-0.6588, -0.6300,-0.6120, -0.6598,-0.5631],
  [-0.6896,-0.5142, -0.7112,-0.4766, -0.7427,-0.4036],
  [-0.7742,-0.3306, -0.8196,-0.2122, -0.8490,-0.1250],
  [-0.8784,-0.0378, -0.9025,0.0462, -0.9192,0.1196],
  [-0.9359,0.1930, -0.9486,0.2724, -0.9490,0.3153],
  [-0.9494,0.3582, -0.9366,0.3603, -0.9214,0.3769],
  [-0.9062,0.3936, -0.9161,0.4145, -0.8576,0.4152],
  [-0.7991,0.4159, -0.6466,0.3776, -0.5704,0.3812],
  [-0.4942,0.3847, -0.4407,0.4167, -0.4003,0.4365],
  [-0.3599,0.4563, -0.3496,0.4744, -0.3280,0.5003],
  [-0.3064,0.5262, -0.2908,0.5268, -0.2706,0.5917],
  [-0.2504,0.6566, -0.2245,0.8335, -0.2068,0.8895],
  [-0.1891,0.9455, -0.1844,0.9196, -0.1642,0.9278],
  [-0.1440,0.9359, -0.1564,0.9576, -0.0855,0.9384],
  [-0.0146,0.9193, 0.1587,0.8579, 0.2611,0.8129],
  [0.3635,0.7679, 0.4543,0.7137, 0.5291,0.6683],
  [0.6039,0.6229, 0.6528,0.5928, 0.7099,0.5407],
  [0.7670,0.4886, 0.8375,0.4039, 0.8715,0.3557],
  [0.9055,0.3075, 0.9049,0.2912, 0.9141,0.2515],
  [0.9233,0.2118, 0.9328,0.1710, 0.9268,0.1175],
  [0.9208,0.0640, 0.9006,-0.0137, 0.8779,-0.0697],
  [0.8552,-0.1257, 0.8300,-0.1637, 0.7907,-0.2186],
  [0.7513,-0.2735, 0.7010,-0.3366, 0.6418,-0.3993],
  [0.5826,-0.4620, 0.4986,-0.5404, 0.4355,-0.5950],
  [0.3724,-0.6496, 0.3193,-0.6893, 0.2633,-0.7269],
  [0.2073,-0.7645, 0.1502,-0.7967, 0.0995,-0.8204],
  [0.0488,-0.8441, 0.0112,-0.8588, -0.0409,-0.8694],
  [-0.0930,-0.8800, -0.1635,-0.8863, -0.2131,-0.8842],
];

function cornPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx + CORN_START[0] * r, cy + CORN_START[1] * r);
  for (const s of CORN_SEGMENTS) {
    ctx.bezierCurveTo(
      cx + s[0] * r, cy + s[1] * r,
      cx + s[2] * r, cy + s[3] * r,
      cx + s[4] * r, cy + s[5] * r
    );
  }
  ctx.closePath();
}

function drawCorn(ctx, cx, cy, r) {
  // Golden kernel — flat fill with a darker gold stroke.
  cornPath(ctx, cx, cy, r);
  ctx.fillStyle   = '#f7d94a';
  ctx.fill();
  ctx.strokeStyle = '#c9a11f';
  ctx.lineWidth   = Math.max(1, r * 0.14);
  ctx.lineJoin    = 'round';
  ctx.stroke();
}

function drawBloodCorn(ctx, cx, cy, r) {
  // Same kernel silhouette as drawCorn, recolored to a deep dried-blood
  // maroon with a near-black stroke, plus a soft highlight for a wet sheen.
  cornPath(ctx, cx, cy, r);
  ctx.fillStyle   = '#8a0f16';
  ctx.fill();
  ctx.strokeStyle = '#4a0508';
  ctx.lineWidth   = Math.max(1, r * 0.14);
  ctx.lineJoin    = 'round';
  ctx.stroke();

  ctx.save();
  cornPath(ctx, cx, cy, r);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy - r * 0.35, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  ctx.restore();
}

function drawBloodLeaf(ctx, cx, cy, r) {
  // Same path/build as drawLeaf, recolored to the blood palette
  // (deep red fill, near-black stroke/vein/stem) instead of green.
  const SVG_CX = 7.7;
  const SVG_CY = 13.0;
  const SVG_SCALE = 13;

  const s = r / SVG_SCALE;
  const ox = -SVG_CX;
  const oy = -SVG_CY;
  function p(x, y) { return [cx + (x + ox) * s, cy + (y + oy) * s]; }

  const outlineWidth = 8.0 / SVG_SCALE;
  const veinWidth    = 7.5 / SVG_SCALE;
  const stemWidth    = Math.max(1, r * 0.15);

  const FILL = '#8a0f16';
  const DARK = '#4a0508';

  ctx.save();

  // ── Stem ────────────────────────────────────────────────────────────────
  const [stemSX, stemSY] = p(4.418, 20.366);
  const [stemEX, stemEY] = p(0.374 - 0.8, 26.488);
  ctx.beginPath();
  ctx.moveTo(stemSX, stemSY);
  ctx.bezierCurveTo(
    cx + (3.5  + ox) * s, cy + (22.0 + oy) * s,
    cx + (2.2  + ox) * s, cy + (24.0 + oy) * s,
    stemEX, stemEY
  );
  ctx.strokeStyle = DARK;
  ctx.lineWidth   = stemWidth;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Leaf body ───────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(...p(4.061, 19.702));
  ctx.bezierCurveTo(...p(4.061,19.702), ...p(2.552,18.441), ...p(1.579,16.494));
  ctx.bezierCurveTo(...p(1.540,16.417), ...p(1.127,16.149), ...p(1.090,16.069));
  ctx.bezierCurveTo(...p(1.062,16.009), ...p(1.381,16.138), ...p(1.355,16.076));
  ctx.bezierCurveTo(...p(0.923,15.085), ...p(0.652,13.941), ...p(0.775,12.711));
  ctx.bezierCurveTo(...p(0.793,12.535), ...p(0.519,11.251), ...p(0.545,11.079));
  ctx.bezierCurveTo(...p(0.581,10.835), ...p(0.920,11.706), ...p(0.971,11.472));
  ctx.bezierCurveTo(...p(1.268,10.101), ...p(1.798, 8.908), ...p(2.396, 7.909));
  ctx.bezierCurveTo(...p(2.483, 7.764), ...p(2.529, 6.773), ...p(2.618, 6.636));
  ctx.bezierCurveTo(...p(2.693, 6.522), ...p(2.809, 7.261), ...p(2.885, 7.152));
  ctx.bezierCurveTo(...p(3.579, 6.154), ...p(4.303, 5.403), ...p(4.827, 4.918));
  ctx.bezierCurveTo(...p(4.920, 4.832), ...p(5.335, 3.943), ...p(5.462, 3.848));
  ctx.bezierCurveTo(...p(5.618, 3.731), ...p(5.495, 4.407), ...p(5.693, 4.281));
  ctx.bezierCurveTo(...p(6.462, 3.791), ...p(7.509, 3.241), ...p(8.543, 2.734));
  ctx.bezierCurveTo(...p(8.667, 2.673), ...p(9.102, 1.965), ...p(9.226, 1.905));
  ctx.bezierCurveTo(...p(9.406, 1.818), ...p(9.273, 2.381), ...p(9.448, 2.299));
  ctx.bezierCurveTo(...p(10.986, 1.573), ...p(12.287, 1.022), ...p(12.287, 1.022));
  ctx.bezierCurveTo(...p(12.287, 1.022), ...p(12.656, 2.345), ...p(13.057, 3.981));
  ctx.bezierCurveTo(...p(13.089, 4.110), ...p(13.476, 3.686), ...p(13.508, 3.818));
  ctx.bezierCurveTo(...p(13.545, 3.971), ...p(13.263, 4.680), ...p(13.299, 4.836));
  ctx.bezierCurveTo(...p(13.477, 5.597), ...p(13.651, 6.385), ...p(13.790, 7.114));
  ctx.bezierCurveTo(...p(13.840, 7.378), ...p(14.222, 7.004), ...p(14.262, 7.249));
  ctx.bezierCurveTo(...p(14.285, 7.390), ...p(13.971, 8.157), ...p(13.990, 8.290));
  ctx.bezierCurveTo(...p(14.143, 9.366), ...p(14.220,10.398), ...p(14.149,11.402));
  ctx.bezierCurveTo(...p(14.135,11.600), ...p(14.661,11.167), ...p(14.635,11.363));
  ctx.bezierCurveTo(...p(14.615,11.517), ...p(14.045,12.299), ...p(14.017,12.451));
  ctx.bezierCurveTo(...p(13.821,13.514), ...p(13.427,14.553), ...p(12.747,15.587));
  ctx.bezierCurveTo(...p(12.615,15.787), ...p(13.377,15.313), ...p(13.223,15.513));
  ctx.bezierCurveTo(...p(13.083,15.696), ...p(12.029,16.554), ...p(11.869,16.737));
  ctx.bezierCurveTo(...p(11.349,17.332), ...p(10.802,17.822), ...p(10.261,18.226));
  ctx.bezierCurveTo(...p(10.190,18.278), ...p(10.662,18.474), ...p(10.591,18.524));
  ctx.bezierCurveTo(...p(10.475,18.607), ...p(9.817,18.540), ...p(9.702,18.615));
  ctx.bezierCurveTo(...p(7.819,19.835), ...p(6.150,20.050), ...p(6.150,20.050));
  ctx.bezierCurveTo(...p(6.150,20.050), ...p(4.061,19.702), ...p(4.061,19.702));
  ctx.closePath();
  ctx.fillStyle   = FILL;
  ctx.fill();
  ctx.strokeStyle = DARK;
  ctx.lineWidth   = outlineWidth * s;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // ── Central midrib ──────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(...p(10.745, 4.958));
  ctx.bezierCurveTo(
    ...p(10.745, 4.958),
    ...p(8.003,  9.534),
    ...p(8.003, 11.534)
  );
  ctx.bezierCurveTo(
    ...p(8.003, 13.534),
    ...p(5.256, 15.079),
    ...p(5.256, 17.079)
  );
  ctx.strokeStyle = DARK;
  ctx.lineWidth   = veinWidth * s;
  ctx.lineCap     = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawCentipedeLegs(ctx, cx, cy, r) {
  // Draws animated centipede feet that rotate in movement direction.
  // Used as an accessory on the player.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ctx._legRotation ?? 0);

  const legR    = r * 0.32;    // matches mob
  const legDist = r * 1.08;    // matches mob
  const offsets = [-0.48, 0.48]; // matches mob
  const legPhase = ctx._legPhase ?? 0;

  [-1, 1].forEach(side => {
    offsets.forEach((off, i) => {
      const baseAngle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      const nudge = Math.sin(legPhase + i * 1.6 + (side > 0 ? Math.PI : 0)) * 0.13;
      const a  = baseAngle + off + nudge;
      const lx = Math.cos(a) * legDist;
      const ly = Math.sin(a) * legDist;

      // foot
      ctx.beginPath();
      ctx.arc(lx, ly, legR, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
    });
  });

  // Outline only in icon view, not on player
  if (ctx._isIcon) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPeas(ctx, cx, cy, r) {
  // Four plain circles in a tight 2×2 grid, no highlights.
  const peaR = r * 0.43;
  const off  = peaR * 1.4; // spread spacing

  const positions = [
    [-off, -off],
    [ off, -off],
    [-off,  off],
    [ off,  off],
  ];

  for (const [px, py] of positions) {
    // border
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, peaR + peaR * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#2e7d32';
    ctx.fill();
    // fill
    ctx.beginPath();
    ctx.arc(cx + px, cy + py, peaR, 0, Math.PI * 2);
    ctx.fillStyle = '#66bb6a';
    ctx.fill();
  }
}

function drawPoison(ctx, cx, cy, r) {
  // Dark green circle with toxic bubble dots
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle   = '#2e8b1a';
  ctx.fill();
  ctx.strokeStyle = '#1a5510';
  ctx.lineWidth   = Math.max(1, r * 0.18);
  ctx.stroke();

  // Three bubble highlights
  const dots = [[-0.30, -0.28], [0.22, -0.32], [-0.05, 0.30]];
  for (const [ox, oy] of dots) {
    ctx.beginPath();
    ctx.arc(cx + ox * r, cy + oy * r, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160, 255, 100, 0.70)';
    ctx.fill();
  }
}


function drawThirdEye(ctx, cx, cy, r) {
  // Black vertical lens with sharp top/bottom points and centered white oval.
  const lensH = r * 2;  // half-height (tip to center)
  const lensW = r;      // control point horizontal bulge

  // Outer black lens — tips at top and bottom, bulges left/right
  ctx.beginPath();
  ctx.moveTo(cx, cy - lensH);
  ctx.bezierCurveTo(cx + lensW, cy - lensH * 0.5, cx + lensW, cy + lensH * 0.5, cx, cy + lensH);
  ctx.bezierCurveTo(cx - lensW, cy + lensH * 0.5, cx - lensW, cy - lensH * 0.5, cx, cy - lensH);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Centered white oval
  const ovalRy = r * 0.55;
  const ovalRx = ovalRy * 0.71;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ovalRx, ovalRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

export function drawThirdEyeAccessory(ctx, sx, sy, r) {
  // Third eye on forehead - smaller than regular eyes, positioned above eyebrows
  const thirdEyeRx = r * 0.078;  // smaller than normal eyes
  const thirdEyeRy = r * 0.178;  // smaller than normal eyes
  const thirdEyePupilR = r * 0.075;
  const eyeOffsetY = r * 0.21;
  const eyeRy = r * 0.249;
  const browBaseY = sy - eyeOffsetY - eyeRy - r * 0.05;
  
  // Position: center X, above the eyebrow (further up on forehead)
  const teX = sx;
  const teY = browBaseY - r * 0.10//;  // well above the eyebrow

  // Dark iris
  ctx.beginPath();
  ctx.ellipse(teX, teY, thirdEyeRx, thirdEyeRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#212219';
  ctx.fill();
  ctx.closePath();

  // White pupil (centered, doesn't move)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(teX, teY, thirdEyeRx, thirdEyeRy, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(teX, teY, thirdEyePupilR, 0, Math.PI * 2);
  ctx.fillStyle = '#eeeeee';
  ctx.fill();
  ctx.closePath();
  ctx.restore();
}

function drawDiggerEgg(ctx, cx, cy, r) {
  const rx = r * 0.66;
  const ry = r;
  const bw = Math.max(1, r * 0.13);

  const toothCount = 14;
  const toothH  = r * 0.32;
  const toothHW = r * 0.20;

  // Arc-length-uniform t params so teeth are evenly spaced around the ellipse perimeter
  const steps = 3000;
  const lens = [0];
  for (let i = 1; i <= steps; i++) {
    const tm = ((i - 0.5) / steps) * Math.PI * 2;
    lens.push(lens[lens.length - 1] + Math.hypot(-rx * Math.sin(tm), ry * Math.cos(tm)) * (Math.PI * 2 / steps));
  }
  const total = lens[steps];
  const baseParams = [];
  for (let i = 0; i < toothCount; i++) {
    const target = (i / toothCount) * total;
    let lo = 0, hi = steps;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; lens[mid] < target ? lo = mid : hi = mid; }
    const frac = (target - lens[lo]) / ((lens[hi] - lens[lo]) || 1);
    baseParams.push(((lo + frac) / steps) * Math.PI * 2);
  }

  // Rotation driven by ctx._diggerEggRot (set per-frame by world renderer). 0 for static icons.
  const rot = ctx._diggerEggRot ?? 0;

  ctx.save();
  ctx.translate(cx, cy);

  // Teeth — drawn first, behind egg body
  for (const t of baseParams.map(t => t + rot)) {
    const ex =  rx * Math.cos(t);
    const ey =  ry * Math.sin(t);
    const tx_ = -rx * Math.sin(t);
    const ty_ =  ry * Math.cos(t);
    const tLen = Math.hypot(tx_, ty_);
    const tnx = tx_ / tLen;
    const tny = ty_ / tLen;
    let onx =  tny, ony = -tnx;
    if (onx * ex + ony * ey < 0) { onx = -onx; ony = -ony; }

    ctx.beginPath();
    ctx.moveTo(ex - tnx * toothHW, ey - tny * toothHW);
    ctx.lineTo(ex + tnx * toothHW, ey + tny * toothHW);
    ctx.lineTo(ex + onx * toothH,  ey + ony * toothH);
    ctx.closePath();
    ctx.fillStyle = '#000000';
    ctx.fill();
  }

  // Black border ring
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + bw, ry + bw, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();

  // Egg body — digger gray (#8c8c8c matches drawDigger body)
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#8c8c8c';
  ctx.fill();

  ctx.restore();
}

function drawHoneycomb(ctx, cx, cy, r) {
  const cellR   = r * 0.52;
  const W       = Math.sqrt(3) * cellR;
  const H       = 2 * cellR;
  const colStep = W;
  const rowStep = H * 0.75;
  const positions = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      positions.push({ x: col * colStep + (row % 2) * (colStep / 2), y: row * rowStep });
    }
  }
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const groupW = Math.max(...xs) - Math.min(...xs) + W;
  const groupH = Math.max(...ys) - Math.min(...ys) + H;
  const offX = cx - groupW / 2 + W / 2 - Math.min(...xs);
  const offY = cy - groupH / 2 + H / 2 - Math.min(...ys);
  function hex(hcx, hcy, hr) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (Math.PI / 3) * i;
      i === 0 ? ctx.moveTo(hcx + Math.cos(a) * hr, hcy + Math.sin(a) * hr)
              : ctx.lineTo(hcx + Math.cos(a) * hr, hcy + Math.sin(a) * hr);
    }
    ctx.closePath();
  }
  for (const { x, y } of positions) {
    const hcx = x + offX, hcy = y + offY;
    hex(hcx, hcy, cellR);         ctx.fillStyle = '#9a6200'; ctx.fill();
    hex(hcx, hcy, cellR * 0.88); ctx.fillStyle = '#d08800'; ctx.fill();
    hex(hcx, hcy, cellR * 0.68); ctx.fillStyle = '#ffba04'; ctx.fill();
    hex(hcx, hcy, cellR * 0.46); ctx.fillStyle = '#d08800'; ctx.fill();
    hex(hcx, hcy, cellR * 0.30); ctx.fillStyle = '#ffba04'; ctx.fill();
  }
}

function drawAntennae(ctx, cx, cy, r) {
  const antennaR      = r * 0.10;
  const antennaLength = r * 0.85;
  ctx.save();
  ctx.translate(cx, cy - r * 0.6);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth   = antennaR * 1.2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(-antennaR * 2, -antennaR * 2);
  ctx.quadraticCurveTo(-antennaLength * 0.6, -antennaLength * 0.8, -antennaLength, -antennaLength * 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(antennaR * 2, -antennaR * 2);
  ctx.quadraticCurveTo(antennaLength * 0.6, -antennaLength * 0.8, antennaLength, -antennaLength * 1.2);
  ctx.stroke();
  ctx.fillStyle = '#3d3d3d';
  ctx.beginPath(); ctx.arc(-antennaLength, -antennaLength * 1.2, antennaR, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( antennaLength, -antennaLength * 1.2, antennaR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawOrange(ctx, cx, cy, r) {
  const oranges = [
    { x: cx + r * 0.80, y: cy - r * 0.75, r: r * 0.52 },
    { x: cx - r * 0.55, y: cy + r * 0.25, r: r * 0.52 },
    { x: cx + r * 0.85, y: cy + r * 1.05, r: r * 0.52 },
  ];
  let leafRotations = [-0.5, 0.7, -0.4];
  let leafIndex = 0;
  for (const o of oranges) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r + o.r * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#a06820';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a030';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = Math.max(0.5, o.r * 0.07);
    ctx.stroke();
    // Draw leaf on each orange pellet
    ctx.save();
    ctx.translate(o.x, o.y - o.r * 0.85);
    ctx.rotate(leafRotations[leafIndex]);
    ctx.beginPath();
    ctx.ellipse(0, 0, o.r * 0.42, o.r, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1e6612';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, o.r * 0.34, o.r * 0.88, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3db830';
    ctx.fill();
    ctx.restore();
    leafIndex++;
  }
  function drawLeaf(lx, ly, angle, size) {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.42, size, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1e6612';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.34, size * 0.88, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3db830';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.75);
    ctx.lineTo(0, size * 0.75);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = size * 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
  drawLeaf(cx - r * 0.10, cy - r * 1.00, -0.5, r * 0.30);
  drawLeaf(cx - r * 0.85, cy + r * 0.30,  0.7, r * 0.28);
  drawLeaf(cx + r * 0.70, cy + r * 0.55, -0.4, r * 0.26);
}

function drawMissile(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ctx._missileAngle ?? 0);

  const s = r / 100;

  ctx.beginPath();
  ctx.moveTo(0,    70 * s);
  ctx.lineTo(-55 * s, -50 * s);
  ctx.quadraticCurveTo(0, -70 * s, 55 * s, -50 * s);
  ctx.closePath();

  ctx.fillStyle   = '#cccccc';
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = Math.max(1, r * 0.05);
  ctx.lineJoin    = 'round';
  ctx.stroke();

  ctx.restore();
}

export const DRAW_FNS = [
  drawBasic,          // 0
  drawFaster,         // 1
  drawLight,          // 2
  drawPollen,         // 3
  drawRose,           // 4
  drawStinger,        // 5
  drawWeb,            // 6
  drawPoison,         // 7
  drawLeaf,           // 8
  drawCentipedeLegs,  // 9
  drawPeas,           // 10
  drawThirdEye,       // 11
  drawClover,         // 12
  drawWing,           // 13
  drawRice,           // 14
  drawAntEgg,         // 15
  drawDisc,           // 16
  drawCutter,         // 17
  drawDiggerEgg,      // 18
  drawSoil,           // 19
  drawMagnet,         // 20
  drawHoney,          // 21
  drawBeeEgg,         // 22
  drawHoneycomb,      // 23
  drawAntennae,       // 24
  drawOrange,         // 25
  drawMissile,        // 26
  drawBeetleEgg,      // 27
  drawPincer,         // 28
  drawBone,           // 29
  drawIris,           // 30
  drawSand,           // 31
  drawStick,          // 32
  drawSalt,           // 33
  drawCorn,           // 34
  drawBloodCorn,      // 35
  drawBloodLeaf,      // 36
  drawBloodWing,      // 37
  drawJellyfishEgg,         // 38
  drawJelly,                // 39
  drawInk,                  // 40
  drawTentacle,             // 41
  drawInkSack,              // 42
  drawClaw,                 // 43
  drawCarapace,             // 44
  drawStarfishArm,          // 45
  drawCoral,                // 46
  drawPearl,                // 47
  drawShellShape,           // 48
  drawOceanArtifact,        // 49
  drawSpongePetal,          // 50
  drawAir,                  // 51
  drawBubblePetal,          // 52
  drawFang,                 // 53
  drawRockPetal,            // 54
  drawDandelionSeedPetal,   // 55
  drawCompass,              // 56
  drawMetal,                // 57
  drawScales,               // 58
  drawTooth,                // 59
  drawGlass,                // 60
  drawPowder,               // 61
  drawMoon,                 // 62
  drawHeavy,                // 63
  drawLightning,            // 64
];

// ── Individual piece draw functions ───────────────────────────────────────────
// Used when multi-piece petals (ant_egg, orange, peas) are split into
// independent piece-petal entities. Each draws one circle at (cx, cy, r).

function drawAntEggPiece(ctx, cx, cy, r) {
  // Black border ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2a2a';
  ctx.fill();
  // Cream fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff3c2';
  ctx.fill();
}

function drawOrangePiece(ctx, cx, cy, r) {
  // Dark border ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#a06820';
  ctx.fill();
  // Orange fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a030';
  ctx.fill();
  // Subtle stroke
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  ctx.stroke();
  // Leaf on piece
  ctx.save();
  ctx.translate(cx, cy - r * 0.85);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.42, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1e6612';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.34, r * 0.88, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3db830';
  ctx.fill();
  ctx.restore();
}

function drawPeaPiece(ctx, cx, cy, r) {
  // Dark border ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = '#2e7d32';
  ctx.fill();
  // Green fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#66bb6a';
  ctx.fill();
}

function drawSandPiece(ctx, cx, cy, r) {
  // Same build as drawPeaPiece (border ring + fill), using Sand's own
  // yellow/gold palette so the split pieces read as Sand, not Peas.
  ctx.beginPath();
  ctx.arc(cx, cy, r + r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = '#d6b700';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffdc00';
  ctx.fill();
}

/**
 * Draw a single piece-petal circle for multi-piece types.
 * Called by the world renderer when petal.isPiece === true.
 */
export function drawPieceShape(ctx, typeId, cx, cy, r) {
  const pt = PETAL_TYPES[typeId];
  const idx = pt?.spriteIndex ?? 0;
  const scaledR = r * (DRAW_SCALE[idx] ?? 1.0);
  ctx.save();
  const pieceShape = pt?.pieceShape ?? typeId;
  switch (pieceShape) {
    case 'stinger': drawStinger(ctx, cx, cy, scaledR);        break;
    case 'ant_egg': drawAntEggPiece(ctx, cx, cy, scaledR); break;
    case 'orange':  drawOrangePiece(ctx, cx, cy, scaledR); break;
    case 'peas':    drawPeaPiece(ctx, cx, cy, scaledR);    break;
    case 'sand':    drawSandPiece(ctx, cx, cy, scaledR);   break;
    default:        drawBasic(ctx, cx, cy, scaledR);        break; // safe fallback
  }
  ctx.restore();
}



/**
 * Draw a petal in world-space (orbiting petals, world drops).
 * ctx is the main game canvas 2D context.
 * (cx, cy) is the centre in screen pixels, r is the display radius.
 */
export function drawPetalShape(ctx, typeId, cx, cy, r) {
  const pt = PETAL_TYPES[typeId];
  if (!pt) return;
  const idx = pt.spriteIndex;
  const fn  = DRAW_FNS[idx];
  if (!fn) return;
  ctx.save();
  fn(ctx, cx, cy, r * (DRAW_SCALE[idx] ?? 1.0));
  ctx.restore();
}

/**
 * Draw a petal icon into a <canvas> element for the UI.
 * canvasEl must already have .width / .height set to the physical pixel size
 * (CSS size × devicePixelRatio).
 */
/** Icon layout positions for pollen dots — mirrors stinger piece positions. */
function _pollenIconPositions(n) {
  if (n === 1) return [{ dx: 0, dy: 0, pr: 1.0 }];
  if (n === 2) return [{ dx: -1.0, dy: -1.0, pr: 0.60 }, { dx: 1.0, dy: 1.0, pr: 0.60 }];
  if (n === 3) {
    const off = 0.75;
    return [
      { dx: -off * 0.866, dy:  off * 0.5, pr: 0.55 },
      { dx:  off * 0.866, dy:  off * 0.5, pr: 0.55 },
      { dx:  0,           dy: -off,        pr: 0.55 },
    ];
  }
  if (n === 4) return [
    { dx:  0.65, dy:  0,    pr: 0.50 },
    { dx:  0,    dy:  0.65, pr: 0.50 },
    { dx: -0.65, dy:  0,    pr: 0.50 },
    { dx:  0,    dy: -0.65, pr: 0.50 },
  ];
  if (n === 5) return [-18, 54, 126, 198, -90].map(a => ({
    dx: Math.cos(a * Math.PI / 180) * 0.62,
    dy: Math.sin(a * Math.PI / 180) * 0.62,
    pr: 0.46,
  }));
  if (n === 6) return [-30, 30, 90, 150, 210, -90].map(a => ({
    dx: Math.cos(a * Math.PI / 180) * 0.60,
    dy: Math.sin(a * Math.PI / 180) * 0.60,
    pr: 0.43,
  }));
  return [{ dx: 0, dy: 0, pr: 1.0 }];
}

export function drawInventoryIcon(canvasEl, typeId) {
  const pt = PETAL_TYPES[typeId];
  if (!pt) return;

  const pw  = canvasEl.width;
  const ph  = canvasEl.height;
  const ctx = canvasEl.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, pw, ph);

  const idx = pt.spriteIndex;
  const fn  = DRAW_FNS[idx];
  if (!fn) return;

  const cx = pw / 2;

  // Look up per-petal icon overrides (inv / hotbar / drops only).
  // World drawing (drawPetalShape) is completely unaffected.
  const ov      = ICON_OVERRIDES[pt.name] ?? {};
  const ovScale = ov.scale ?? 1.0;
  const ovRot   = (ov.rot ?? 0) * Math.PI / 180;
  // ox/oy are in logical CSS-like units; scale by pw/100 so they feel
  // consistent regardless of the physical canvas resolution.
  const ovOX    = (ov.ox ?? 0) * (pw / 100);
  const ovOY    = (ov.oy ?? 0) * (pw / 100);

  // Measure the name label so we know exactly how much vertical space it takes.
  let fontSize = Math.round(pw * 0.24);
  fontSize = Math.max(8, Math.min(fontSize, 26));
  ctx.font = `bold ${fontSize}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  const textW = ctx.measureText(pt.name).width;
  if (textW > pw - 6) {
    fontSize = Math.max(7, Math.floor(fontSize * (pw - 6) / textW));
    ctx.font = `bold ${fontSize}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  }
  // textTop = y where the name label begins (baseline = ph-1, ascent ≈ fontSize*0.8)
  const textTop  = ph - 1 - fontSize * 0.8;
  const gap      = ph * 0.04;   // small breathing room between petal and name

  // Radius: fill the space above the name, leaving a small gap.
  const availH   = textTop - gap;
  const baseR    = Math.min(pw * 0.46, availH * 0.46) * (DRAW_SCALE[idx] ?? 1.0);
  const r        = baseR * ovScale;

  // Default petal centre: vertically centred in the available space, horizontally centred.
  // Global nudge: shift all petals down toward the name.
  const petalNudgeDown = ph * 0.08;
  const petalCX  = cx + ovOX;
  const petalCY  = availH / 2 + ovOY + petalNudgeDown;

  const ovFlipX = ov.flipX ?? false;

  ctx.save();
  ctx._isIcon = true;
  if (ovRot !== 0 || ovFlipX) {
    // Transform around the petal's own centre so ox/oy positioning is preserved.
    ctx.translate(petalCX, petalCY);
    if (ovRot !== 0) ctx.rotate(ovRot);
    if (ovFlipX)    ctx.scale(-1, 1);
    ctx.translate(-petalCX, -petalCY);
  }

  if (pt.pieceShape === 'stinger' && pt.pieces) {
    // Draw each stinger piece at its offset with the correct inward-pointing angle
    for (const piece of pt.pieces) {
      ctx._stingerAngle = (piece.angle ?? 0) * Math.PI / 180;
      drawStinger(ctx,
        petalCX + piece.dx * r,
        petalCY + piece.dy * r,
        piece.pr * r
      );
    }
    ctx._stingerAngle = undefined;
  } else if (pt.pieceShape === 'orange' && pt.pieces) {
    // Orange: in-world, each piece is drawn independently (drawOrangePiece —
    // a single orange) at its own real orbit position, NOT fused into one
    // composite image like the old icon-only drawOrange did. Match reality:
    // draw each real piece at its own pt.pieces offset, same pattern as
    // Stinger just above.
    for (const piece of pt.pieces) {
      drawOrangePiece(ctx,
        petalCX + piece.dx * r,
        petalCY + piece.dy * r,
        piece.pr * r
      );
    }
  } else if (pt.dropsPollen && (pt.pollenCount ?? 1) > 1) {
    // Pollen: draw multiple dots arranged like stinger pieces (reuse stinger positions)
    const count = pt.pollenCount;
    const positions = _pollenIconPositions(count);
    for (const pos of positions) {
      fn(ctx, petalCX + pos.dx * r, petalCY + pos.dy * r, pos.pr * r);
    }
  } else {
    if (pt.isAntEgg) ctx._antEggCount = pt.pieces?.length ?? 4;
    if (pt.isLight)  ctx._lightCount  = pt.pieces?.length ?? 1;
    fn(ctx, petalCX, petalCY, r);
    if (pt.isAntEgg) ctx._antEggCount = undefined;
    if (pt.isLight)  ctx._lightCount  = undefined;
  }

  ctx._isIcon = false;
  ctx.restore();

  // Name text — font was already computed above; just render it.
  // Global nudge: raise names up from the very bottom edge.
  const nameNudgeUp = ph * 0.10;
  ctx.save();
  ctx.font         = `bold ${fontSize}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(pt.name, cx + 0.5, ph - 1 - nameNudgeUp + 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(pt.name, cx, ph - 1 - nameNudgeUp);
  ctx.restore();
}