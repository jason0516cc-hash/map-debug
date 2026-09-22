/**
 * homescreen.js
 *
 * Background layers:
 *   1. Moving equilateral-triangle tessellation grid (florr.io style)
 *   2. Mobs that slowly spiral inward from corners, shrinking to centre
 *
 * UI: title, name+play row, flower face preview.
 * The real in-game hotbar + all UI panels are shown on the homescreen
 * via the canvas overlay system already set up by main.js initUI().
 */

import {
  drawBee, drawQueenBee, drawSpider, drawLadybug, drawHornet,
  drawCentipedeHead, drawCentipedeBody,
  drawSoldierAnt, drawBabyAnt, drawWorkerAnt,
  drawDigger, drawBeekeeper, drawHive,
  makeLadybugSpots,
} from './mobDrawing.js';
import { player } from './player.js';
import { setHotbarSlideOffset } from './HotbarUI.js';
import { drawFlowerFaceParams, circle } from './renderer.js';
import { PLAYER_COLOR, PLAYER_BORDER, PLAYER_MAX_HP, PLAYER_BASE_BODY_DAMAGE } from './constants.js';
import { levelFromXp, xpForLevel, totalXpForLevel } from './leveling.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1.  SOFT TRIANGLES BACKGROUND (animated, like map decorations)
// ─────────────────────────────────────────────────────────────────────────────

function seededRng(seed) {
  let s = seed | 0;
  return () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0xFFFFFFFF; };
}

function drawSoftTriangle(ctx, cx, cy, r, rot, cr, bow) {
  const vx = [0,1,2].map(i => cx + Math.cos(rot + i * Math.PI * 2 / 3) * r);
  const vy = [0,1,2].map(i => cy + Math.sin(rot + i * Math.PI * 2 / 3) * r);

  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const ex = vx[j] - vx[i], ey = vy[j] - vy[i];
    const edgeLen = Math.hypot(ex, ey);
    const ux = ex / edgeLen, uy = ey / edgeLen;
    const nx = -uy, ny = ux;

    const t  = Math.min(cr, edgeLen * 0.42);
    const ax = vx[i] + ux * t, ay = vy[i] + uy * t;
    const bx = vx[j] - ux * t, by = vy[j] - uy * t;

    if (i === 0) ctx.moveTo(ax, ay);
    else         ctx.lineTo(ax, ay);

    const mx  = (ax + bx) / 2, my = (ay + by) / 2;
    const cpx = mx + nx * bow * edgeLen;
    const cpy = my + ny * bow * edgeLen;
    ctx.quadraticCurveTo(cpx, cpy, bx, by);

    const nj  = (j + 1) % 3;
    const e2x = vx[nj] - vx[j], e2y = vy[nj] - vy[j];
    const e2l = Math.hypot(e2x, e2y);
    const t2  = Math.min(cr, e2l * 0.42);
    ctx.quadraticCurveTo(vx[j], vy[j],
      vx[j] + (e2x / e2l) * t2,
      vy[j] + (e2y / e2l) * t2);
  }
  ctx.closePath();
}

// ── Triangle system ───────────────────────────────────────────────────────────
const TRI_MIN_R  = 15;
const TRI_MAX_R  = 120;
const TRI_TARGET = 70;
const TRI_PAD    = 150;

let bgTriangles = null;

function triProps() {
  const r = TRI_MIN_R + Math.random() * (TRI_MAX_R - TRI_MIN_R);
  return { r, rot: Math.random() * Math.PI * 2, cr: r * (0.25 + Math.random() * 0.15), bow: 0.04 + Math.random() * 0.08 };
}

function initTriangles(W, H) {
  bgTriangles = [];
  for (let i = 0; i < TRI_TARGET; i++) {
    bgTriangles.push({ sx: Math.random() * W, sy: Math.random() * H, ...triProps() });
  }
}

function updateAndDrawTriangles(ctx, W, H, velX, velY) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  for (const t of bgTriangles) {
    t.sx += velX;
    t.sy += velY;

    const pad = t.r + 2;
    if (t.sx > W + pad) t.sx = -pad;
    else if (t.sx < -pad) t.sx = W + pad;
    if (t.sy > H + pad) t.sy = -pad;
    else if (t.sy < -pad) t.sy = H + pad;

    drawSoftTriangle(ctx, t.sx, t.sy, t.r, t.rot, t.cr, t.bow);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  CORNER-SPIRAL MOBS (slow, staggered spawn)
// ─────────────────────────────────────────────────────────────────────────────

const BG_TYPES = [
  'bee', 'bee', 'bee',
  'queen_bee',
  'spider', 'spider',
  'ladybug', 'ladybug',
  'hornet', 'hornet',
  'ant', 'worker_ant', 'baby_ant',
  'beekeeper',
  'beehive',
];

function rand(a, b) { return a + Math.random() * (b - a); }

function makeMob(W, H) {
  const edge = Math.floor(Math.random() * 4);
  let cx, cy;
  const offscreen = 40;
  if (edge === 0)      { cx = Math.random() * W; cy = -offscreen; }
  else if (edge === 1) { cx = W + offscreen;     cy = Math.random() * H; }
  else if (edge === 2) { cx = Math.random() * W; cy = H + offscreen; }
  else                 { cx = -offscreen;         cy = Math.random() * H; }

  const mx  = W / 2;
  const my  = H / 2;

  const baseAngle = Math.atan2(my - cy, mx - cx);
  const turns     = rand(0.7, 1.3);
  const spinDir   = Math.random() < 0.5 ? 1 : -1;
  const dist      = Math.hypot(mx - cx, my - cy);

  let type = BG_TYPES[Math.floor(Math.random() * BG_TYPES.length)];
  if (Math.random() < 0.02) type = 'digger';
  else if (Math.random() < 0.03) type = 'centipede_head';

  const isCentipede = type === 'centipede_head';

  const mob = {
    type,
    cx, cy, mx, my, dist,
    baseAngle, turns, spinDir,
    startR:   rand(16, 28),
    speed:    isCentipede ? rand(0.0078, 0.01365) : rand(0.0006, 0.0024),
    t:        0,
    phase:    rand(0, Math.PI * 2),
    rot:      rand(0, Math.PI * 2),
    rotSpeed: rand(-0.018, 0.018),
    spots:    type === 'ladybug' ? makeLadybugSpots(5, Math.random()) : [],
    segmentIndex: 0,
    diggerKills:  0,
  };

  if (type === 'digger') { mob.rot = 0; mob.rotSpeed = 0; }

  if (type === 'centipede_head') {
    mob.segments = [];
    const numSegments = 7 + Math.floor(Math.random() * 9);
    const segSpacing = (2 * mob.startR) / mob.dist;
    for (let i = 0; i < numSegments; i++) {
      mob.segments.push({
        type: 'centipede_body',
        t: -(i + 1) * segSpacing,
        phase: rand(0, Math.PI * 2),
        segmentIndex: i + 1,
        rot: 0, rotSpeed: 0, dead: false,
      });
    }
  }

  return mob;
}

function mobPos(mob) {
  const { t, mx, my, dist, baseAngle, turns, spinDir, startR } = mob;
  const angle  = baseAngle + spinDir * turns * Math.PI * 2 * t;
  const radius = dist * (1 - t);
  return { x: mx + Math.cos(angle) * radius, y: my + Math.sin(angle) * radius, r: startR * (1 - t) };
}

function drawMob(ctx, mob) {
  const { x, y, r } = mobPos(mob);
  if (r < 1) return;
  ctx.save();
  ctx.globalAlpha = 1.0;
  ctx.translate(x, y);
  ctx.rotate(mob.rot);
  try {
    switch (mob.type) {
      case 'bee':            drawBee(ctx, 0, 0, r, 0, mob.phase);                        break;
      case 'queen_bee':      drawQueenBee(ctx, 0, 0, r, 0, mob.phase);                   break;
      case 'beehive':        drawHive(ctx, 0, 0, r);                                     break;
      case 'spider':         drawSpider(ctx, 0, 0, r, 0, mob.phase, 0.6);               break;
      case 'ladybug':        drawLadybug(ctx, 0, 0, r, 0, mob.spots);                   break;
      case 'hornet':         drawHornet(ctx, 0, 0, r, 0, mob.phase, 1);                 break;
      case 'centipede_head': drawCentipedeHead(ctx, 0, 0, r, 0);                        break;
      case 'centipede_body': drawCentipedeBody(ctx, 0, 0, r, 0, mob.phase, mob.segmentIndex, mob.phase); break;
      case 'ant':            drawSoldierAnt(ctx, 0, 0, r, 0, mob.phase, mob.phase*0.8); break;
      case 'worker_ant':     drawWorkerAnt(ctx, 0, 0, r, 0, mob.phase);                 break;
      case 'baby_ant':       drawBabyAnt(ctx, 0, 0, r, 0, mob.phase);                   break;
      case 'digger':         drawDigger(ctx, 0, 0, r, 'neutral', mob.phase * 0.5, mob.phase); break;
      case 'beekeeper':      drawBeekeeper(ctx, 0, 0, r, 'neutral', mob.phase * 0.5, mob.phase);break;
    }
  } catch (_) {}
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  CIRCLE-REVEAL TRANSITION
// ─────────────────────────────────────────────────────────────────────────────
function runTransition(onComplete) {
  const tc   = document.getElementById('transition-canvas');
  const tctx = tc.getContext('2d');
  tc.width   = window.innerWidth;
  tc.height  = window.innerHeight;
  tc.style.display = 'block';

  const W = tc.width, H = tc.height;
  tctx.fillStyle = 'black';
  tctx.fillRect(0, 0, W, H);

  const duration = 1500;
  const maxR     = Math.hypot(W, H) / 2 + 30;
  let   startTime = null;

  function frame(now) {
    if (!startTime) startTime = now;
    const t     = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);

    tctx.clearRect(0, 0, W, H);
    tctx.fillStyle = 'black';
    tctx.fillRect(0, 0, W, H);
    tctx.globalCompositeOperation = 'destination-out';
    tctx.beginPath();
    tctx.arc(W / 2, H / 2, eased * maxR, 0, Math.PI * 2);
    tctx.fill();
    tctx.globalCompositeOperation = 'source-over';

    if (t < 1) requestAnimationFrame(frame);
    else { tc.style.display = 'none'; if (onComplete) onComplete(); }
  }
  requestAnimationFrame(() => requestAnimationFrame(frame));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. IRIS TRANSITION — closes to black then reopens (used on death → homescreen)
// ─────────────────────────────────────────────────────────────────────────────
export function runIrisTransition(onMidpoint, onComplete) {
  const tc   = document.getElementById('transition-canvas');
  const tctx = tc.getContext('2d');
  tc.width   = window.innerWidth;
  tc.height  = window.innerHeight;
  tc.style.display = 'block';

  const W    = tc.width, H = tc.height;
  const maxR = Math.hypot(W, H) / 2 + 30;
  const CLOSE_DUR = 520;   // ms — iris closes (game → black)
  const OPEN_DUR  = 600;   // ms — iris opens  (black → homescreen)

  let startTime = null;
  let midpointFired = false;

  function easeInCubic(t)  { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function frame(now) {
    if (!startTime) startTime = now;
    const elapsed = now - startTime;
    const total   = CLOSE_DUR + OPEN_DUR;

    tctx.clearRect(0, 0, W, H);
    tctx.fillStyle = 'black';
    tctx.fillRect(0, 0, W, H);

    if (elapsed < CLOSE_DUR) {
      // Phase 1: iris closing — circle shrinks from maxR → 0
      const t      = elapsed / CLOSE_DUR;
      const eased  = 1 - easeInCubic(t);  // 1 → 0
      const radius = eased * maxR;
      tctx.globalCompositeOperation = 'destination-out';
      tctx.beginPath();
      tctx.arc(W / 2, H / 2, radius, 0, Math.PI * 2);
      tctx.fill();
      tctx.globalCompositeOperation = 'source-over';
    } else {
      // Midpoint: switch content once (show homescreen)
      if (!midpointFired) {
        midpointFired = true;
        if (onMidpoint) onMidpoint();
      }
      // Phase 2: iris opening — circle grows from 0 → maxR
      const t      = (elapsed - CLOSE_DUR) / OPEN_DUR;
      const eased  = easeOutCubic(Math.min(t, 1));
      const radius = eased * maxR;
      tctx.globalCompositeOperation = 'destination-out';
      tctx.beginPath();
      tctx.arc(W / 2, H / 2, radius, 0, Math.PI * 2);
      tctx.fill();
      tctx.globalCompositeOperation = 'source-over';
    }

    if (elapsed < total) {
      requestAnimationFrame(frame);
    } else {
      tc.style.display = 'none';
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(frame);
}


function runHomescreen() {
  const homeEl     = document.getElementById('home-screen');
  const bgCanvas   = document.getElementById('bg-canvas');
  const nameInput  = document.getElementById('player-name-input');
  const playBtn    = document.getElementById('play-btn');

  if (!homeEl || !bgCanvas || !nameInput || !playBtn) return;

  // ── Wire homescreen mouse events into hotbar system ─────────────────────
  // The window-level listeners in input.js already forward mouse events
  // to onHotbarMouseDown/Move/Up, so the hotbar works on the homescreen
  // without any extra wiring needed here.

  // ── Start the real hotbar animation on the game canvas ──────────────────
  // Dynamic import here (rather than a static import at the top of this file)
  // deliberately avoids a circular top-level dependency with main.js, which
  // itself calls into this file — a static cycle caused "Cannot access
  // before initialization" errors depending on which module loaded first.
  import('./main.js').then(({ startHomescreenHotbar }) => startHomescreenHotbar());

  // ── Home-screen level pill ────────────────────────────────────────────────
  const homePillEl = document.getElementById('home-level-pill-text');
  function updateHomePill() {
    if (!homePillEl) return;
    const xp      = player.xp ?? 0;
    const contLvl = levelFromXp(xp);
    const intLvl  = Math.floor(contLvl);
    const xpStart = totalXpForLevel(intLvl);
    const xpNext  = xpStart + xpForLevel(intLvl + 1);
    const f = n => Math.floor(n).toLocaleString('en-US');
    homePillEl.textContent = `${intLvl + 1} (${f(xp - xpStart)} / ${f(xpNext - xpStart)})`;
  }
  updateHomePill();
  // Expose for main.js to call after death-continue
  window._refreshHomePill = updateHomePill;

  // ── Mob canvas ─────────────────────────────────────────────────────────
  function resizeMob() {
    bgCanvas.width  = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resizeMob();
  window.addEventListener('resize', () => {
    resizeMob();
    initTriangles(bgCanvas.width, bgCanvas.height);
  });

  const bgCtx = bgCanvas.getContext('2d');

  const TOTAL_MOBS     = 60;
  const STAGGER_FRAMES = 10;

  let bgMobs     = [];
  let frameCount = 0;
  let bgFrame    = null;
  let bgOffsetX  = 0;
  let bgOffsetY  = 0;
  let bgVelX     = 4.0;
  let bgVelY     = 2.5;
  let targetVelX = 4.0;
  let targetVelY = 2.5;
  let dirChangeCounter = 0;

  const popEffects = [];

  function animateMobs() {
    const W = bgCanvas.width;
    const H = bgCanvas.height;

    bgCtx.fillStyle = '#1ea761';
    bgCtx.fillRect(0, 0, W, H);

    dirChangeCounter++;
    if (dirChangeCounter > 180 + Math.random() * 120) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3.0 + Math.random() * 3.0;
      targetVelX = Math.cos(angle) * speed;
      targetVelY = Math.sin(angle) * speed;
      dirChangeCounter = 0;
    }

    bgVelX += (targetVelX - bgVelX) * 0.02;
    bgVelY += (targetVelY - bgVelY) * 0.02;

    if (!bgTriangles) initTriangles(W, H);
    bgOffsetX += bgVelX;
    bgOffsetY += bgVelY;
    updateAndDrawTriangles(bgCtx, W, H, bgVelX, bgVelY);

    if (bgMobs.length < TOTAL_MOBS && frameCount % STAGGER_FRAMES === 0) {
      bgMobs.push(makeMob(W, H));
    }
    frameCount++;

    for (let i = bgMobs.length - 1; i >= 0; i--) {
      const mob = bgMobs[i];
      mob.t     += mob.speed;
      mob.rot   += mob.rotSpeed;
      mob.phase += 0.21;

      if (mob.segments) {
        for (const seg of mob.segments) {
          seg.phase += 0.21;
          if (!seg.dead) seg.t += mob.speed;
          if (seg.t >= 1) seg.dead = true;
        }
        mob.segments = mob.segments.filter(seg => !seg.dead);
      }

      if (mob.type === 'digger') {
        const dpos = mobPos(mob);
        for (let j = 0; j < bgMobs.length; j++) {
          if (j === i || bgMobs[j].type === 'digger' || bgMobs[j]._popping) continue;
          const tp = mobPos(bgMobs[j]);
          const d  = Math.hypot(tp.x - dpos.x, tp.y - dpos.y);
          if (d < dpos.r + tp.r) {
            popEffects.push({ x: tp.x, y: tp.y, r: tp.r * 2.5, age: 0 });
            bgMobs[j]._popping = true;
            mob.diggerKills++;
            if (mob.diggerKills >= 4) {
              popEffects.push({ x: dpos.x, y: dpos.y, r: dpos.r * 3, age: 0 });
              bgMobs[i] = makeMob(W, H);
              break;
            }
          }
        }
        if (bgMobs[i] !== mob) continue;
      }

      const headDone = mob.t >= 1;
      const segmentsDone = !mob.segments || mob.segments.length === 0;
      if (mob._popping || (headDone && segmentsDone)) {
        bgMobs[i] = makeMob(W, H);
        continue;
      }

      drawMob(bgCtx, mob);

      if (mob.segments) {
        const headPos = mobPos(mob);
        let prevPos = headPos;
        for (const seg of mob.segments) {
          if (seg.dead || seg.t <= 0) { prevPos = null; continue; }
          const segPos = mobPos({ ...mob, t: seg.t });
          if (segPos.r < 1) { prevPos = null; continue; }

          if (prevPos) {
            const sdx = prevPos.x - segPos.x;
            const sdy = prevPos.y - segPos.y;
            const facing = Math.atan2(sdy, sdx);
            bgCtx.save();
            bgCtx.globalAlpha = 1.0;
            bgCtx.translate(segPos.x, segPos.y);
            bgCtx.rotate(facing);
            drawCentipedeBody(bgCtx, 0, 0, segPos.r, 0, seg.phase, seg.segmentIndex, seg.phase);
            bgCtx.restore();
          } else {
            bgCtx.save();
            bgCtx.globalAlpha = 1.0;
            bgCtx.translate(segPos.x, segPos.y);
            drawCentipedeBody(bgCtx, 0, 0, segPos.r, 0, seg.phase, seg.segmentIndex, seg.phase);
            bgCtx.restore();
          }

          prevPos = segPos;
        }
      }
    }

    // ── Pop effects ────────────────────────────────────────────────────────
    for (let p = popEffects.length - 1; p >= 0; p--) {
      const pop = popEffects[p];
      pop.age += 0.07;
      if (pop.age >= 1) { popEffects.splice(p, 1); continue; }

      const alpha  = 1 - pop.age;
      const scale  = 1 + pop.age * 1.5;
      const radius = pop.r * scale;

      bgCtx.save();
      bgCtx.globalAlpha = alpha * 0.85;
      bgCtx.strokeStyle = '#ffffff';
      bgCtx.lineWidth   = radius * 0.18;
      bgCtx.beginPath();
      bgCtx.arc(pop.x, pop.y, radius, 0, Math.PI * 2);
      bgCtx.stroke();

      bgCtx.globalAlpha = alpha * 0.4;
      bgCtx.fillStyle   = '#ffffaa';
      bgCtx.beginPath();
      bgCtx.arc(pop.x, pop.y, radius * 0.55, 0, Math.PI * 2);
      bgCtx.fill();
      bgCtx.restore();
    }

    bgFrame = requestAnimationFrame(animateMobs);
  }
  bgFrame = requestAnimationFrame(animateMobs);

  // ── Flower face preview canvas ─────────────────────────────────────────────
  // Hoist so mode-select bar can call detachFlowerListeners regardless of flowerCanvas
  let detachFlowerListeners = () => {};

  const flowerCanvas = document.getElementById('flower-canvas');
  if (flowerCanvas) {
    const fctx = flowerCanvas.getContext('2d');
    const FW = 90, FH = 90;
    flowerCanvas.width  = FW * (window.devicePixelRatio || 1);
    flowerCanvas.height = FH * (window.devicePixelRatio || 1);
    flowerCanvas.style.width  = FW + 'px';
    flowerCanvas.style.height = FH + 'px';
    fctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const faceState = { attackT: 0, defendT: 0, eyeAngle: 0 };
    let mouseAngle = 0;
    let isAttacking = false;
    const FACE_SPEED = 0.012;
    const cx = FW / 2, cy = FH / 2;
    const flowerR = FW * 0.34;
    let lastFaceTime = performance.now();

    // Mouse tracking — angle from flower center to cursor
    function onMouseMove(e) {
      const rect = flowerCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - cx;
      const my = e.clientY - rect.top  - cy;
      // Only update if mouse is reasonably close (within 600px)
      const dist = Math.hypot(mx, my);
      if (dist < 600) mouseAngle = Math.atan2(my, mx);
    }
    function onMouseDown() { isAttacking = true; }
    function onMouseUp()   { isAttacking = false; }

    function animateFlower(now) {
      const dt = Math.min(now - lastFaceTime, 100);
      lastFaceTime = now;
      const k = 1 - Math.pow(1 - FACE_SPEED, dt);

      // Lerp eye toward mouse angle (shortest path)
      let da = mouseAngle - faceState.eyeAngle;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      faceState.eyeAngle += da * k * 2; // slightly snappier than in-game

      faceState.attackT += ((isAttacking ? 1 : 0) - faceState.attackT) * k;
      faceState.defendT  = 0;

      fctx.clearRect(0, 0, FW, FH);

      // Draw flower body
      circle(fctx, cx, cy, flowerR, PLAYER_COLOR, PLAYER_BORDER, 3, 1);

      // Draw face using the exact in-game function
      drawFlowerFaceParams(fctx, cx, cy, flowerR,
        faceState.attackT, faceState.defendT, faceState.eyeAngle, 1);

      _flowerRaf = requestAnimationFrame(animateFlower);
    }

    let _flowerRaf = requestAnimationFrame(animateFlower);

    // Stop flower mouse listeners when game starts, but keep the RAF so it's
    // ready when homescreen re-appears after death.
    // Re-attach listeners whenever homescreen becomes visible again.
    function attachFlowerListeners() {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup',   onMouseUp);
    }
    // Assign to the hoisted variable so the mode-select bar can call it too
    detachFlowerListeners = function() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup',   onMouseUp);
    };
    attachFlowerListeners();

    playBtn.addEventListener('click', () => {
      detachFlowerListeners();
    });

    // Exported so main.js can re-attach when Continue brings homescreen back
    window._reattachFlowerListeners = attachFlowerListeners;
  }

  // ── Stat preview ───────────────────────────────────────────────────────────
  const hpEl  = document.getElementById('stat-hp');
  const dmgEl = document.getElementById('stat-dmg');
  if (hpEl)  hpEl.textContent  = PLAYER_MAX_HP;
  if (dmgEl) dmgEl.textContent = PLAYER_BASE_BODY_DAMAGE;
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.trim();
    player.name = v.length > 0 ? v : 'Unnamed';
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') playBtn.click();
  });

  // ── Biome select bar — always visible, toggle group (Garden/Desert/Ocean) ──
  // Replaces the old Play → mode bar → Waves → biome bar flow entirely: one
  // of the three is always the active selection (default Garden), Play just
  // starts the game in whichever is currently selected.
  if (!document.getElementById('_biomeBarStyle')) {
    const bs = document.createElement('style');
    bs.id = '_biomeBarStyle';
    bs.textContent = `
      #biome-select-bar {
        position: fixed;
        left: 50%;
        top: 18px;
        transform: translateX(-50%);
        display: flex;
        gap: 10px;
        background: rgba(10,30,20,0.97);
        border: 1.5px solid rgba(255,255,255,0.13);
        border-radius: 12px;
        padding: 10px 16px;
        z-index: 9999;
      }
      .biome-btn {
        padding: 9px 26px;
        border-radius: 8px;
        border: 2px solid rgba(255,255,255,0.20);
        font-family: 'UbuntuCustom','Ubuntu',Arial,sans-serif;
        font-size: 15px;
        font-weight: 800;
        cursor: pointer;
        letter-spacing: 0.4px;
        opacity: 0.55;
        transition: filter 0.15s, transform 0.1s, border-color 0.15s, opacity 0.15s;
        white-space: nowrap;
      }
      .biome-btn:hover  { filter: brightness(1.18); transform: scale(1.05); }
      .biome-btn:active { transform: scale(0.96); }
      .biome-btn.selected {
        opacity: 1;
        border-color: rgba(255,255,255,0.85);
        box-shadow: 0 0 0 2px rgba(255,255,255,0.25);
      }
      #biome-btn-garden {
        background: #1ea761;
        color: #fff;
      }
      #biome-btn-desert {
        background: #d4a843;
        color: #3a2000;
      }
      #biome-btn-ocean {
        background: #2b8fc4;
        color: #fff;
      }
    `;
    document.head.appendChild(bs);
  }

  const biomeBar = document.createElement('div');
  biomeBar.id = 'biome-select-bar';

  const gardenBtn = document.createElement('button');
  gardenBtn.id = 'biome-btn-garden';
  gardenBtn.className = 'biome-btn';
  gardenBtn.textContent = 'Garden';

  const desertBtn = document.createElement('button');
  desertBtn.id = 'biome-btn-desert';
  desertBtn.className = 'biome-btn';
  desertBtn.textContent = 'Desert';

  const oceanBtn = document.createElement('button');
  oceanBtn.id = 'biome-btn-ocean';
  oceanBtn.className = 'biome-btn';
  oceanBtn.textContent = 'Ocean';

  biomeBar.appendChild(gardenBtn);
  biomeBar.appendChild(desertBtn);
  biomeBar.appendChild(oceanBtn);
  document.body.appendChild(biomeBar);

  const biomeButtons = { garden: gardenBtn, desert: desertBtn, ocean: oceanBtn };
  let selectedBiome = 'garden'; // default selection on load

  function _selectBiome(biome) {
    selectedBiome = biome;
    for (const [id, btn] of Object.entries(biomeButtons)) {
      btn.classList.toggle('selected', id === biome);
    }
  }
  gardenBtn.addEventListener('click', () => _selectBiome('garden'));
  desertBtn.addEventListener('click', () => _selectBiome('desert'));
  oceanBtn.addEventListener('click', () => _selectBiome('ocean'));
  _selectBiome('garden'); // apply default highlight on load

  // ── Play button — start the currently-selected biome directly ─────────────
  playBtn.addEventListener('click', () => {
    const v = nameInput.value.trim();
    player.name = v.length > 0 ? v : 'Unnamed';
    setHotbarSlideOffset(0);
    homeEl.style.display = 'none';
    if (typeof window.startGame === 'function') window.startGame(selectedBiome);
    runTransition(() => {});
  });
}

// Guard: this module must only initialize once. If it's ever evaluated twice
// (e.g. loaded under two different URLs like homescreen.js and
// homescreen.js?v=2, which ES modules treat as separate modules), a second
// run would stack a duplicate biome bar and a second Play handler — and
// one Play click would start the game twice.
if (!window.__homescreenInitialized) {
  window.__homescreenInitialized = true;
  runHomescreen();
}