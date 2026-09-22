/**
 * MobGalleryUI.js
 *
 * Mob Gallery:
 *   - Grid of canvas tiles — rows = mob types (A-Z), columns = rarity tiers
 *   - Whole grid always shown; undiscovered tiles are dimmed empty boxes
 *   - Tiles use the exact same drawSingleMobBox rendering as the HUD
 *   - Kill count badge top-right, slightly tilted
 *   - Hovering a tile shows the full drawMobTooltip on the canvas to the right
 *     of the panel
 *   - centipede_body is merged into centipede_head row (not a separate row)
 *   - Kill data persisted in localStorage
 */

import { RARITIES, RARITY_BG, RARITY_BORDER } from './constants.js';
import {
  drawBee, drawQueenBee, drawHive, drawHornet, drawLadybug,
  drawSpider, drawCentipedeHead, drawCentipedeBody,
  drawDesertCentipedeHead, drawDesertCentipedeBody, drawCactus, drawRock, drawDandelion,
  drawSoldierAnt, drawWorkerAnt, drawBabyAnt, drawQueenAnt,
  drawAntEgg, drawAntHole, drawDigger, drawBeekeeper, drawSandstorm, drawBeetle,
  drawFireSoldierAnt, drawFireWorkerAnt, drawFireBabyAnt, drawFireQueenAnt,
  drawFireAntEgg, drawFireAntHole,
  drawScorpion, drawPyramid, drawMummifiedBeetle,
  drawJellyfish, drawSquid, drawAlligator, drawCrab, drawStarfish, drawShell, drawSponge,
  drawBubble, drawSeaCave, drawDebris, drawLeechPose, applyMobIconOverride,
  soldierAntOffsetX,
} from './mobDrawing.js';
import { getMobDropTable }  from './combat.js';
import { getMobStats }       from './mobs.js';
import { drawInventoryIcon } from './petalDrawing.js';
import { drawPetalBox }      from './HotbarUI.js';
import { PETAL_TYPES }       from './petalTypes.js';
import { RARITY_TEXT }       from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks
// ─────────────────────────────────────────────────────────────────────────────
let _craft    = { isCraftingOpen: () => false, closeCrafting: () => {} };
let _settings = { isSettingsOpen: () => false, closeSettings: () => {} };
let _inv      = { isInventoryOpen: () => false, closeInventory: () => {} };
let _updateLog = { isUpdateLogOpen: () => false, closeUpdateLog: () => {} };

export function registerMobGalWithCrafting(cbs)  { Object.assign(_craft,    cbs); }
export function registerMobGalWithSettings(cbs)  { Object.assign(_settings, cbs); }
export function registerInvWithMobGal(cbs)       { Object.assign(_inv,      cbs); }
export function registerUpdateLogWithMobGal(cbs) { Object.assign(_updateLog, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// All gallery mob types — A-Z order, centipede_body excluded (merged with head)
// ─────────────────────────────────────────────────────────────────────────────
const GALLERY_TYPES = [
  'alligator',
  'ant_egg',
  'ant_hole',
  'baby_ant',
  'bee',
  'beetle',
  'beekeeper',
  'beehive',
  'bubble',
  'cactus',
  'centipede_head',  // renders head+body together
  'crab',
  'dandelion',
  'debris',
  'desert_centipede_head',  // renders head+body together
  'digger',
  'fire_ant_egg',
  'fire_ant_hole',
  'fire_baby_ant',
  'fire_queen_ant',
  'fire_soldier_ant',
  'fire_worker_ant',
  'hornet',
  'jellyfish',
  'ladybug',
  'leech',
  'mummified_beetle',
  'pyramid',
  'queen_ant',
  'queen_bee',
  'rock',
  'sandstorm',
  'scorpion',
  'sea_cave',
  'shell',
  'soldier_ant',
  'sponge',
  'spider',
  'squid',
  'starfish',
  'worker_ant',
];

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
  mummified_beetle:      'Mummified Beetle',
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
function mobDisplayName(typeId) {
  return MOB_DISPLAY_NAMES[typeId] ?? (typeId.charAt(0).toUpperCase() + typeId.slice(1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill data — localStorage: { [typeId]: { [tier]: count } }
// centipede_body kills are credited to centipede_head
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = 'mobGalleryKills';

function loadKills() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
function saveKills(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

let killData = loadKills();

export function clearMobGallery() {
  killData = {};
  saveKills(killData);
  if (mobGalOpen) scheduleRender();
}

/** Unlocks every mob at every rarity tier — used by /fullindex. Sets a
 *  nonzero kill count for each so the discovery check (count > 0) passes
 *  and every tile renders fully revealed, same as if the player had
 *  actually killed one of each. */
export function fillMobGallery() {
  for (const typeId of GALLERY_TYPES) {
    if (!killData[typeId]) killData[typeId] = {};
    for (let tier = 0; tier < RARITIES.length; tier++) {
      killData[typeId][tier] = killData[typeId][tier] || 1;
    }
  }
  saveKills(killData);
  if (mobGalOpen) scheduleRender();
}

export function recordMobKill(typeId, tier) {
  // Centipede body → credit head
  const key = typeId === 'centipede_body' ? 'centipede_head'
            : typeId === 'desert_centipede_body' ? 'desert_centipede_head'
            : typeId;
  const t   = tier ?? 0;
  if (!killData[key]) killData[key] = {};
  killData[key][t] = (killData[key][t] || 0) + 1;
  saveKills(killData);
  if (mobGalOpen) scheduleRender();
}

window.__mobGalRecordKill = recordMobKill;

// ─────────────────────────────────────────────────────────────────────────────
// HUD box drawing — reused exactly from renderer.js
// ─────────────────────────────────────────────────────────────────────────────
const NE_FACING = -Math.PI / 4;
const TILE      = 45;   // px — matches crafting inv tile size

function drawTile(ctx, typeId, rarity, tier, cx, cy, discovered, killCount) {
  const S    = TILE;
  const half = S / 2;
  const cr   = S * 0.16;

  ctx.save();
  ctx.translate(cx, cy);

  // ── Box background ────────────────────────────────────────────────────────
  if (!discovered) {
    // Empty/undiscovered — muted dark yellow, no strokes
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = '#6b6614'; ctx.fill();
  } else if (rarity === 'Impracticality') {
    const grad = ctx.createLinearGradient(-half, -half, half, half);
    grad.addColorStop(0.00, '#ff0000'); grad.addColorStop(0.17, '#ff8800');
    grad.addColorStop(0.33, '#ffff00'); grad.addColorStop(0.50, '#00cc44');
    grad.addColorStop(0.67, '#0088ff'); grad.addColorStop(0.83, '#8800ff');
    grad.addColorStop(1.00, '#ff00cc');
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.strokeStyle = RARITY_BORDER[rarity]; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-half + 2.5, -half + 2.5, S - 5, S - 5, cr * 0.65);
    ctx.strokeStyle = 'rgba(255,255,255,0.11)'; ctx.lineWidth = 1; ctx.stroke();
  } else {
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = '#0d1020'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.fillStyle = RARITY_BG[rarity] || '#333';
    ctx.globalAlpha *= 0.42; ctx.fill();
    ctx.globalAlpha /= 0.42;
    ctx.beginPath(); ctx.roundRect(-half, -half, S, S, cr);
    ctx.strokeStyle = RARITY_BORDER[rarity] || '#3a3f5a';
    ctx.lineWidth   = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-half + 2.5, -half + 2.5, S - 5, S - 5, cr * 0.65);
    ctx.strokeStyle = 'rgba(255,255,255,0.11)'; ctx.lineWidth = 1; ctx.stroke();
  }

  if (discovered) {
    // ── Mob icon ──────────────────────────────────────────────────────────
    const iconR = S * 0.175;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-half + 3, -half + 3, S - 6, S - 6, cr * 0.65);
    ctx.clip();

    switch (typeId) {
      case 'bee':        drawBee(ctx, 0, 0, iconR, NE_FACING, 0); break;
      case 'queen_bee':  drawQueenBee(ctx, 0, 0, iconR * 0.9, NE_FACING, 0); break;
      case 'beehive':    drawHive(ctx, 0, 0, iconR * 1.125); break;
      case 'hornet':     drawHornet(ctx, 0, 0, iconR, NE_FACING, 0, 1); break;
      case 'ladybug':    drawLadybug(ctx, 0, 0, iconR, NE_FACING, []); break;
      case 'spider':     drawSpider(ctx, 0, 0, iconR, NE_FACING, 0, 0); break;
      case 'centipede_head': {
        const bodyR  = iconR * 0.9;
        const bAngle = NE_FACING + Math.PI;
        drawCentipedeBody(ctx, Math.cos(bAngle)*iconR*1.55, Math.sin(bAngle)*iconR*1.55, bodyR, NE_FACING, 0, 1);
        drawCentipedeHead(ctx, 0, 0, iconR, NE_FACING);
        break;
      }
      case 'soldier_ant':
      case 'worker_ant':
      case 'baby_ant':
      case 'queen_ant': {
        const OC = 256, mid = OC / 2;
        const oc = new OffscreenCanvas(OC, OC);
        const oc2 = oc.getContext('2d');
        const ocScale = (OC * 0.35) / iconR;
        const ocR = iconR * ocScale;
        oc2.clearRect(0, 0, OC, OC);
        if (typeId === 'soldier_ant') {
          const os = ocR / 22;
          drawSoldierAnt(oc2, mid - soldierAntOffsetX * os, mid, ocR, NE_FACING, 0, 0);
        } else if (typeId === 'worker_ant') { drawWorkerAnt(oc2, mid, mid, ocR, NE_FACING, 0);
        } else if (typeId === 'baby_ant')   { drawBabyAnt(oc2, mid, mid, ocR, NE_FACING, 0);
        } else                              { drawQueenAnt(oc2, mid, mid, ocR * 0.72, NE_FACING, 0, 0); }
        const img = oc2.getImageData(0, 0, OC, OC).data;
        let mnX=OC,mxX=0,mnY=OC,mxY=0;
        for (let py=0;py<OC;py++) for (let px=0;px<OC;px++)
          if (img[(py*OC+px)*4+3]>8){if(px<mnX)mnX=px;if(px>mxX)mxX=px;if(py<mnY)mnY=py;if(py>mxY)mxY=py;}
        if (mxX>mnX && mxY>mnY) {
          const sx=(mid-(mnX+mxX)/2)/ocScale, sy=(mid-(mnY+mxY)/2)/ocScale;
          if (typeId==='soldier_ant') {
            const os=iconR/22;
            drawSoldierAnt(ctx,sx-soldierAntOffsetX*os-iconR*0.8+iconR*0.5,sy,iconR,NE_FACING,0,0);
          } else if (typeId==='worker_ant') { drawWorkerAnt(ctx,sx,sy,iconR,NE_FACING,0);
          } else if (typeId==='baby_ant')   { drawBabyAnt(ctx,sx,sy,iconR,NE_FACING,0);
          } else                            { drawQueenAnt(ctx,sx,sy,iconR*0.72,NE_FACING,0,0); }
        }
        break;
      }
      case 'ant_egg':    drawAntEgg(ctx, 0, 0, iconR); break;
      case 'ant_hole':   drawAntHole(ctx, 0, 0, iconR); break;
      case 'fire_soldier_ant':
      case 'fire_worker_ant':
      case 'fire_baby_ant':
      case 'fire_queen_ant': {
        const OC = 256, mid = OC / 2;
        const oc = new OffscreenCanvas(OC, OC);
        const oc2 = oc.getContext('2d');
        const ocScale = (OC * 0.35) / iconR;
        const ocR = iconR * ocScale;
        oc2.clearRect(0, 0, OC, OC);
        if (typeId === 'fire_soldier_ant')      { drawFireSoldierAnt(oc2, mid, mid, ocR, NE_FACING, 0, 0);
        } else if (typeId === 'fire_worker_ant') { drawFireWorkerAnt(oc2, mid, mid, ocR, NE_FACING, 0);
        } else if (typeId === 'fire_baby_ant')   { drawFireBabyAnt(oc2, mid, mid, ocR, NE_FACING, 0);
        } else                                   { drawFireQueenAnt(oc2, mid, mid, ocR * 0.72, NE_FACING, 0, 0); }
        const img = oc2.getImageData(0, 0, OC, OC).data;
        let mnX=OC,mxX=0,mnY=OC,mxY=0;
        for (let py=0;py<OC;py++) for (let px=0;px<OC;px++)
          if (img[(py*OC+px)*4+3]>8){if(px<mnX)mnX=px;if(px>mxX)mxX=px;if(py<mnY)mnY=py;if(py>mxY)mxY=py;}
        if (mxX>mnX && mxY>mnY) {
          const sx=(mid-(mnX+mxX)/2)/ocScale, sy=(mid-(mnY+mxY)/2)/ocScale;
          if (typeId==='fire_soldier_ant')      { drawFireSoldierAnt(ctx, sx, sy, iconR, NE_FACING, 0, 0);
          } else if (typeId==='fire_worker_ant') { drawFireWorkerAnt(ctx, sx, sy, iconR, NE_FACING, 0);
          } else if (typeId==='fire_baby_ant')   { drawFireBabyAnt(ctx, sx, sy, iconR, NE_FACING, 0);
          } else                                 { drawFireQueenAnt(ctx, sx, sy, iconR*0.72, NE_FACING, 0, 0); }
        }
        break;
      }
      case 'fire_ant_egg':  drawFireAntEgg(ctx, 0, 0, iconR); break;
      case 'fire_ant_hole': drawFireAntHole(ctx, 0, 0, iconR); break;
      case 'beetle':     drawBeetle(ctx, 0, 0, iconR, NE_FACING, 0); break;
      case 'digger':     drawDigger(ctx, 0, 0, iconR, 'neutral', 0, 0, null); break;
      case 'beekeeper':  drawBeekeeper(ctx, 0, 0, iconR * 1.5, 'neutral', 0, 0, null); break;
      case 'sandstorm': {
        const hudHexRots = [(Date.now() * -0.001) % (Math.PI * 2), (Date.now() * -0.0008) % (Math.PI * 2), (Date.now() * 0.0012) % (Math.PI * 2)];
        drawSandstorm(ctx, 0, 0, iconR * 1.6, hudHexRots, false, false);
        break;
      }
      case 'desert_centipede_head': {
        const centipedeAnimPhase = (Date.now() * 0.0018) % (Math.PI * 2);
        const bodyR  = iconR * 0.9;
        const bAngle = NE_FACING + Math.PI;
        const bx = Math.cos(bAngle)*iconR*1.55;
        const by = Math.sin(bAngle)*iconR*1.55;
        drawDesertCentipedeBody(ctx, bx, by, bodyR, NE_FACING, centipedeAnimPhase, 1);
        drawDesertCentipedeHead(ctx, 0, 0, iconR, NE_FACING);
        break;
      }
      case 'cactus': drawCactus(ctx, 0, 0, iconR * 1.1); break;
      case 'rock': drawRock(ctx, 0, 0, iconR * 1.2); break;
      case 'dandelion': drawDandelion(ctx, 0, 0, iconR); break;
      case 'scorpion': {
        const legPhase = (Date.now() * 0.006) % (Math.PI * 2);
        const pincerPhase = (Date.now() * 0.004) % (Math.PI * 2);
        drawScorpion(ctx, 0, 0, iconR * 1.3, NE_FACING, legPhase, pincerPhase);
        break;
      }
      case 'pyramid': drawPyramid(ctx, 0, 0, iconR * 1.3); break;
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
        applyMobIconOverride(ctx, 'starfish', iconR, function(r) { drawStarfish(ctx, 0, 0, r, 0, 0); });
        break;
      case 'shell':
        applyMobIconOverride(ctx, 'shell', iconR, function(r) { drawShell(ctx, 0, 0, r); });
        break;
      case 'sponge':
        applyMobIconOverride(ctx, 'sponge', iconR, function(r) { drawSponge(ctx, 0, 0, r); });
        break;
      case 'bubble':
        applyMobIconOverride(ctx, 'bubble', iconR, function(r) { drawBubble(ctx, 0, 0, r); });
        break;
      case 'sea_cave':
        applyMobIconOverride(ctx, 'sea_cave', iconR, function(r) { drawSeaCave(ctx, 0, 0, r); });
        break;
      case 'debris':
        applyMobIconOverride(ctx, 'debris', iconR, function(r) { drawDebris(ctx, 0, 0, r); });
        break;
      case 'leech': {
        // drawLeechPose has no radius/facing params — see the note in
        // mobDrawing.js's drawMob switch. Same fixed-pose-scaled-to-fit here,
        // with the override's rot/scale/ox/oy applied around it same as
        // every other mob.
        applyMobIconOverride(ctx, 'leech', iconR, function(r) {
          ctx.save();
          ctx.translate(-r, -r);
          ctx.scale(r / 150, r / 150);
          drawLeechPose(ctx, 150, 150);
          ctx.restore();
        });
        break;
      }
      default: {
        ctx.beginPath(); ctx.arc(0, 0, iconR, 0, Math.PI*2);
        ctx.fillStyle='#aaa'; ctx.strokeStyle='#555'; ctx.lineWidth=1.5;
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();

    // ── Kill badge — top-right, tilted 15° ───────────────────────────────
    if (killCount > 0) {
      const bx = half - 6;
      const by = -half + 6;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.PI / 12);  // 15° tilt
      const label = killCount >= 1000 ? Math.floor(killCount/1000)+'k' : String(killCount);
      const fsz   = Math.max(7, S * 0.185);
      ctx.font         = `900 ${fsz}px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'rgba(0,0,0,0.85)';
      ctx.fillText(label, 0.7, 0.7);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip — drawn on a separate overlay canvas to the right of the panel
// ─────────────────────────────────────────────────────────────────────────────

// Number formatter (same as mobTooltip.js)
function fmt(n) {
  n = Math.max(0, n);
  if (n >= 1e15) return (n/1e15).toFixed(1).replace(/\.0$/,'')+' Q';
  if (n >= 1e12) return (n/1e12).toFixed(1).replace(/\.0$/,'')+' T';
  if (n >= 1e9)  return (n/1e9).toFixed(1).replace(/\.0$/,'')+ ' B';
  if (n >= 1e6)  return (n/1e6).toFixed(1).replace(/\.0$/,'')+ ' M';
  if (n >= 1e4)  return (n/1e3).toFixed(1).replace(/\.0$/,'')+ 'k';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/,'');
}

const PAD          = 14;
const RADIUS_TIP   = 8;
const MIN_TIP_W    = 240;
const MAX_TIP_W    = 420;
const LINE_H       = 16;
const DROP_ICON_SZ = 34;
const DROP_GAP     = 4;
const DROP_ROW_H   = DROP_ICON_SZ + 14;
const DROP_ROW_GAP = 5;
const STAT_ROWS_TIP = [
  { key:'hp',         label:'HP',          color:'#6EE86E' },
  { key:'damage',     label:'DMG',         color:'#FF5555' },
  { key:'speed',      label:'Speed',       color:'#55AAFF' },
  { key:'mass',       label:'Mass',        color:'#AAAAAA' },
  { key:'aggroRange', label:'Aggro Range', color:'#FFCC44' },
];

const iconCanvasCache = new Map();
function getDropIcon(typeId, size) {
  const k = `${typeId}__${size}`;
  if (iconCanvasCache.has(k)) return iconCanvasCache.get(k);
  const cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width  = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  cv.style.width  = size + 'px';
  cv.style.height = size + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // drawPetalBox draws the rarity-coloured box + the petal icon inside
  drawPetalBox(ctx, 0, 0, size, typeId, 0, 0);
  iconCanvasCache.set(k, cv);
  return cv;
}

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line+' '+w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function measureTip(ctx, stats, hov, slots) {
  const textW = MAX_TIP_W - PAD*2;
  ctx.font = `bold 18px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  const nw = ctx.measureText(stats.name).width;
  ctx.font = `bold 13px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  const rw = ctx.measureText(hov.rarity).width;
  ctx.font = `13px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  let msw = 0;
  for (const row of STAT_ROWS_TIP) {
    let v;
    if (row.key==='aggroRange') {
      if (hov.typeId==='baby_ant') v='Always passive';
      else if (['bee','centipede_head','worker_ant','desert_centipede_head'].includes(hov.typeId)) v='Passive (until hit)';
      else if (['cactus','ant_hole','beehive','rock','dandelion'].includes(hov.typeId)) v='Static (always hostile)';
      else v=fmt(stats[row.key]);
    } else v=fmt(stats[row.key]);
    msw = Math.max(msw, ctx.measureText(row.label+':  '+v).width);
  }
  if (stats.poisonTotal!=null) msw=Math.max(msw,ctx.measureText('Poison:  '+fmt(stats.poisonTotal)+' ('+fmt(Math.round(stats.poisonTotal/3))+'/s)').width);
  let mdw=0;
  for(const s of slots) mdw=Math.max(mdw, s.variants.length*(DROP_ICON_SZ+DROP_GAP));
  const cw=Math.min(MAX_TIP_W,Math.max(MIN_TIP_W,Math.max(nw,rw,msw,mdw)+PAD*2));
  const tw2=cw-PAD*2;
  let h=PAD+22+8+16+10;
  let descLines=[];
  if(stats.description){ctx.font=`12px "UbuntuCustom","Ubuntu",Arial,sans-serif`;descLines=wrapText(ctx,stats.description,tw2);h+=descLines.length*LINE_H+10;}
  h+=STAT_ROWS_TIP.length*20;
  if(stats.poisonTotal!=null) h+=20;
  if(slots.length>0){h+=12+14+6+slots.length*DROP_ROW_H+(slots.length-1)*DROP_ROW_GAP+6;}
  h+=PAD;
  return {cw,ch:h,descLines};
}

function drawTooltipOnCanvas(ctx, W, H, hov) {
  if (!hov) return;
  const stats = getMobStats(hov.typeId, hov.tier);
  if (!stats) return;
  const slots = getMobDropTable(hov.typeId, hov.tier ?? 0) ?? [];
  const {cw,ch,descLines} = measureTip(ctx, stats, hov, slots);

  // Position: to the right of the mob gallery panel, vertically centred on the hovered tile
  const panel = document.getElementById('mobgal-panel');
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  let tx = panelRect ? panelRect.right + 10 : hov.screenX + hov.tileSize/2 + 10;
  let ty = hov.screenY - ch/2;
  if (tx+cw > W-8) tx = panelRect ? panelRect.left - cw - 10 : hov.screenX - cw - 10;
  if (ty+ch > H-8) ty = H-8-ch;
  if (ty < 8) ty = 8;

  // Card bg
  ctx.save();
  ctx.beginPath(); ctx.roundRect(tx,ty,cw,ch,RADIUS_TIP);
  ctx.fillStyle='rgba(10,10,20,0.94)'; ctx.fill();
  ctx.beginPath(); ctx.roundRect(tx,ty,cw,ch,RADIUS_TIP);
  const border = RARITY_BORDER[hov.rarity]||'#000';
  if (hov.rarity==='Impracticality'){
    const g=ctx.createLinearGradient(tx,ty,tx+cw,ty);
    g.addColorStop(0,'#ff0000');g.addColorStop(0.17,'#ff8800');g.addColorStop(0.33,'#ffff00');
    g.addColorStop(0.5,'#00cc44');g.addColorStop(0.67,'#0088ff');g.addColorStop(0.83,'#8800ff');g.addColorStop(1,'#ff00cc');
    ctx.strokeStyle=g;
  } else ctx.strokeStyle=border;
  ctx.lineWidth=2; ctx.stroke();

  let cy2=ty+PAD;

  // Name
  ctx.font=`bold 18px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillStyle='#ffffff'; ctx.fillText(stats.name,tx+PAD,cy2);
  cy2+=22+8;

  // Rarity badge
  const rbg=RARITY_BG[hov.rarity]||'#333';
  const rbord=RARITY_BORDER[hov.rarity]||'#555';
  ctx.font=`bold 12px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  const rw2=ctx.measureText(hov.rarity).width;
  ctx.beginPath(); ctx.roundRect(tx+PAD,cy2,rw2+12,18,4);
  ctx.fillStyle=rbg; ctx.fill();
  ctx.strokeStyle=rbord; ctx.lineWidth=1.5; ctx.stroke();
  ctx.fillStyle='#111'; ctx.textBaseline='middle';
  ctx.fillText(hov.rarity,tx+PAD+6,cy2+9);
  cy2+=16+10;

  // Description
  if(stats.description && descLines.length>0){
    ctx.font=`12px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
    ctx.fillStyle='rgba(200,200,200,0.80)'; ctx.textBaseline='top';
    for(const ln of descLines){ctx.fillText(ln,tx+PAD,cy2);cy2+=LINE_H;}
    cy2+=10;
  }

  // Stats
  ctx.font=`13px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
  ctx.textBaseline='top';
  for(const row of STAT_ROWS_TIP){
    let v;
    if(row.key==='aggroRange'){
      if(hov.typeId==='baby_ant') v='Always passive';
      else if(['bee','centipede_head','worker_ant'].includes(hov.typeId)) v='Passive (until hit)';
      else v=fmt(stats[row.key]);
    } else v=fmt(stats[row.key]);
    ctx.fillStyle='rgba(200,200,200,0.70)'; ctx.textAlign='left';
    ctx.fillText(row.label+':',tx+PAD,cy2);
    ctx.fillStyle=row.color; ctx.textAlign='right';
    ctx.fillText(v,tx+cw-PAD,cy2);
    cy2+=20;
  }
  if(stats.poisonTotal!=null){
    const pv=fmt(stats.poisonTotal)+' ('+fmt(Math.round(stats.poisonTotal/3))+'/s)';
    ctx.fillStyle='rgba(200,200,200,0.70)'; ctx.textAlign='left';
    ctx.fillText('Poison:',tx+PAD,cy2);
    ctx.fillStyle='#6a0bbd'; ctx.textAlign='right';
    ctx.fillText(pv,tx+cw-PAD,cy2);
    cy2+=20;
  }

  // Drops
  if(slots.length>0){
    cy2+=12;
    ctx.font=`bold 12px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
    ctx.fillStyle='rgba(200,200,200,0.60)'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('Drops:',tx+PAD,cy2); cy2+=14+6;
    for(const slot of slots){
      let sx=tx+PAD;
      for(const v of slot.variants){
        const ic=getDropIcon(v.typeId,DROP_ICON_SZ);
        ctx.drawImage(ic,sx,cy2,DROP_ICON_SZ,DROP_ICON_SZ);
        const pct=v.chance<1?`${Math.round(v.chance*100)}%`:'—';
        ctx.font=`bold 10px "UbuntuCustom","Ubuntu",Arial,sans-serif`;
        ctx.fillStyle='rgba(200,200,200,0.75)'; ctx.textAlign='center'; ctx.textBaseline='top';
        ctx.fillText(pct,sx+DROP_ICON_SZ/2,cy2+DROP_ICON_SZ+2);
        sx+=DROP_ICON_SZ+DROP_GAP;
      }
      cy2+=DROP_ROW_H+DROP_ROW_GAP;
    }
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel state
// ─────────────────────────────────────────────────────────────────────────────
let mobGalOpen   = false;
let mobGalPanel  = null;
let renderPending = false;

// Hover state — set by mousemove on the grid canvas
let hoveredEntry = null;  // { typeId, tier, rarity, screenX, screenY, tileSize }

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export function isMobGalOpen()  { return mobGalOpen; }

export function closeMobGal() {
  mobGalOpen = false;
  if (mobGalPanel) mobGalPanel.classList.remove('open');
}

export function openMobGal() {
  mobGalOpen = true;
  if (mobGalPanel) {
    positionMobGalPanel();
    scheduleRender();
    mobGalPanel.classList.add('open');
  }
}

export function toggleMobGal() {
  if (mobGalOpen) { closeMobGal(); return; }
  if (_craft.isCraftingOpen())       _craft.closeCrafting();
  if (_settings.isSettingsOpen())    _settings.closeSettings();
  if (_inv.isInventoryOpen())        _inv.closeInventory();
  if (_updateLog.isUpdateLogOpen())  _updateLog.closeUpdateLog();
  openMobGal();
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderGrid(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid rendering onto the <canvas> inside the panel
// ─────────────────────────────────────────────────────────────────────────────
const TOTAL_TIERS = RARITIES.length;   // 14
const GAP         = 5;
const PAD_GRID    = 8;
const SCROLL_W    = 6;

// Store tile hit-rects for hover detection
let tileHitRects = [];  // [{ typeId, tier, rarity, x1, y1, x2, y2 }]

function renderGrid() {
  if (!mobGalPanel) return;

  const canvas = mobGalPanel.querySelector('.mg-canvas');
  if (!canvas) return;

  const dpr      = window.devicePixelRatio || 1;
  const scrollEl = mobGalPanel.querySelector('.mg-canvas-scroll');

  // Full grid dimensions
  const cols     = TOTAL_TIERS;
  const rows     = GALLERY_TYPES.length;
  const gridW    = cols * TILE + (cols - 1) * GAP + PAD_GRID * 2;
  const gridH    = rows * TILE + (rows - 1) * GAP + PAD_GRID * 2;

  canvas.width        = Math.round(gridW * dpr);
  canvas.height       = Math.round(gridH * dpr);
  canvas.style.width  = gridW + 'px';
  canvas.style.height = gridH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, gridW, gridH);

  tileHitRects = [];

  for (let ri = 0; ri < GALLERY_TYPES.length; ri++) {
    const typeId = GALLERY_TYPES[ri];
    for (let ti = 0; ti < TOTAL_TIERS; ti++) {
      const rarity    = RARITIES[ti];
      const count     = killData[typeId]?.[ti] ?? 0;
      const discovered = count > 0;

      const cx = PAD_GRID + ti * (TILE + GAP) + TILE / 2;
      const cy = PAD_GRID + ri * (TILE + GAP) + TILE / 2;

      drawTile(ctx, typeId, rarity, ti, cx, cy, discovered, count);

      tileHitRects.push({
        typeId, tier: ti, rarity,
        discovered,
        x1: cx - TILE/2, y1: cy - TILE/2,
        x2: cx + TILE/2, y2: cy + TILE/2,
        cx, cy,
      });
    }
  }

  // Re-render tooltip overlay after grid update
  renderTooltipOverlay();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip overlay canvas — sits over everything, drawn each hover update
// ─────────────────────────────────────────────────────────────────────────────
function renderTooltipOverlay() {
  const ov = mobGalPanel.querySelector('.mg-tooltip-overlay');
  if (!ov) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = window.innerWidth;
  const H   = window.innerHeight;

  if (ov.width !== Math.round(W*dpr) || ov.height !== Math.round(H*dpr)) {
    ov.width  = Math.round(W*dpr);
    ov.height = Math.round(H*dpr);
    ov.style.width  = W+'px';
    ov.style.height = H+'px';
  }
  const ctx = ov.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (hoveredEntry) {
    drawTooltipOnCanvas(ctx, W, H, hoveredEntry);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mouse handling on the grid canvas
// ─────────────────────────────────────────────────────────────────────────────
function onGridMouseMove(e) {
  const canvas   = mobGalPanel.querySelector('.mg-canvas');
  if (!canvas) return;
  const scrollEl = mobGalPanel.querySelector('.mg-canvas-scroll');
  const rect     = canvas.getBoundingClientRect();
  const mx       = e.clientX - rect.left;
  const my       = e.clientY - rect.top;

  let hit = null;
  for (const r of tileHitRects) {
    if (r.discovered && mx >= r.x1 && mx <= r.x2 && my >= r.y1 && my <= r.y2) {
      hit = r; break;
    }
  }

  if (!hit) {
    if (hoveredEntry) { hoveredEntry = null; renderTooltipOverlay(); }
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  hoveredEntry = {
    typeId:  hit.typeId,
    tier:    hit.tier,
    rarity:  hit.rarity,
    // Screen coords of tile centre for tooltip positioning
    screenX: canvasRect.left + hit.cx,
    screenY: canvasRect.top  + hit.cy,
    tileSize: TILE,
  };
  renderTooltipOverlay();
}

function onGridMouseLeave() {
  if (hoveredEntry) { hoveredEntry = null; renderTooltipOverlay(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Positioning
// ─────────────────────────────────────────────────────────────────────────────
export function positionMobGalButton() {
  const btn      = document.getElementById('mobgal-btn');
  const craftBtn = document.getElementById('crafting-btn');
  if (!btn || !craftBtn) return;
  const r = craftBtn.getBoundingClientRect();
  btn.style.left = r.left + 'px';
  btn.style.top  = Math.round(r.bottom + 10) + 'px';
}

export function positionMobGalPanel() {
  if (!mobGalPanel) return;
  const settingsBtn = document.getElementById('settings-btn');
  if (!settingsBtn) return;
  const sr      = settingsBtn.getBoundingClientRect();
  const screenH = window.innerHeight;
  const screenW = window.innerWidth;
  const panelW  = mobGalPanel.offsetWidth;
  let   top     = Math.round(sr.bottom + 10);
  let   left    = sr.left;

  // Cap panel height so it doesn't overlap the inventory button
  const invBtn = document.getElementById('inv-toggle-btn');
  let maxBottom = screenH - 8;
  if (invBtn) {
    const ir = invBtn.getBoundingClientRect();
    maxBottom = Math.min(maxBottom, ir.top - 8);
  }
  const scrollEl = mobGalPanel.querySelector('.mg-canvas-scroll');
  if (scrollEl) {
    const titlebarEl = mobGalPanel.querySelector('.mg-titlebar');
    const titlebarH  = titlebarEl ? titlebarEl.offsetHeight : 34;
    const available  = maxBottom - top - titlebarH - 6;
    scrollEl.style.maxHeight = Math.max(80, available) + 'px';
  }

  const panelH = mobGalPanel.offsetHeight;
  if (top + panelH > maxBottom) top = maxBottom - panelH;
  if (top < 8) top = 8;
  if (left + panelW > screenW - 8) left = screenW - 8 - panelW;
  mobGalPanel.style.left = Math.round(left) + 'px';
  mobGalPanel.style.top  = Math.round(top)  + 'px';
  if (mobGalOpen) renderTooltipOverlay();
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #mobgal-btn {
      position: fixed; width: 54px; height: 54px; border-radius: 10px;
      background: #DBD74D; border: 3px solid #A8A41A;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 5px; box-sizing: border-box;
      transition: background 0.12s; user-select: none;
    }
    #mobgal-btn:hover  { background: #E8E455; }
    #mobgal-btn:active { transform: scale(0.95); }
    #mobgal-btn img    { width: 150%; height: 150%; object-fit: contain; display: block; }

    #mobgal-panel {
      position: fixed; width: 400px;
      background: #DBD74D; border: 3px solid #A8A41A; border-radius: 10px;
      font-family: 'UbuntuCustom','Ubuntu',Arial,sans-serif;
      z-index: 100; user-select: none; box-sizing: border-box;
      opacity: 0; pointer-events: none;
      transform: translateX(calc(-100% - 32px));
      transition: opacity 0.20s cubic-bezier(0.22,1,0.36,1),
                  transform 0.22s cubic-bezier(0.22,1,0.36,1);
      overflow: hidden;
    }
    #mobgal-panel.open { opacity: 1; pointer-events: auto; transform: translateX(0); }

    #mobgal-panel .mg-titlebar {
      display: flex; align-items: center; justify-content: center;
      position: relative; padding: 7px 10px 6px;
      background: linear-gradient(to bottom, #EDE94E, #C8C43A);
      border-bottom: 2px solid #A8A41A; border-radius: 7px 7px 0 0;
    }
    #mobgal-panel .mg-title {
      font-size: 15px; font-weight: 900; color: #1a1a00; letter-spacing: 0.6px;
    }
    #mobgal-panel .mg-close {
      position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
      background: #c1565e; border: 2px solid #90464b; border-radius: 5px;
      color: #ccc; font-size: 12px; font-weight: 900;
      width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; line-height: 1; font-family: inherit;
      transition: background 0.12s;
    }
    #mobgal-panel .mg-close:hover { background: #a03040; }

    #mobgal-panel .mg-canvas-scroll {
      background: #C8C43A;
      max-height: 360px;
      overflow: auto;
    }
    #mobgal-panel .mg-canvas-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    #mobgal-panel .mg-canvas-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.15); }
    #mobgal-panel .mg-canvas-scroll::-webkit-scrollbar-thumb { background: #A8A41A; border-radius: 4px; }

    /* Tooltip overlay — full-viewport, pointer-events none, above everything */
    .mg-tooltip-overlay {
      position: fixed; inset: 0; z-index: 9999;
      pointer-events: none;
    }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// DOM setup
// ─────────────────────────────────────────────────────────────────────────────
export function ensureMobGalDOM() {
  if (document.getElementById('mobgal-btn')) return;

  // ── Button ────────────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'mobgal-btn';
  const img = document.createElement('img');
  img.src = './zicons/mobgal-icon.png'; img.draggable = false;
  btn.appendChild(img);
  document.body.appendChild(btn);
  btn.addEventListener('mousedown', e => e.stopPropagation());

  // ── Tooltip overlay (full-page canvas, sits above the panel) ─────────────
  const ov = document.createElement('canvas');
  ov.className = 'mg-tooltip-overlay';
  document.body.appendChild(ov);

  // ── Panel ─────────────────────────────────────────────────────────────────
  mobGalPanel = document.createElement('div');
  mobGalPanel.id = 'mobgal-panel';
  mobGalPanel.innerHTML = `
    <div class="mg-titlebar">
      <span class="mg-title">Mob Gallery</span>
      <button class="mg-close" title="Close">✕</button>
    </div>
    <div class="mg-canvas-scroll">
      <canvas class="mg-canvas"></canvas>
    </div>
  `;
  // Store overlay ref on panel for easy access
  mobGalPanel._tooltipOverlay = ov;
  // Override querySelector to find the overlay
  Object.defineProperty(mobGalPanel, '_ov', { get: () => ov });

  document.body.appendChild(mobGalPanel);
  mobGalPanel.addEventListener('mousedown', e => e.stopPropagation());
  mobGalPanel.querySelector('.mg-close').addEventListener('click', closeMobGal);

  // Patch querySelector to also return the overlay canvas
  const origQS = mobGalPanel.querySelector.bind(mobGalPanel);
  mobGalPanel.querySelector = (sel) => {
    if (sel === '.mg-tooltip-overlay') return ov;
    return origQS(sel);
  };

  // Grid canvas mouse events
  const gridCanvas = mobGalPanel.querySelector('.mg-canvas');
  gridCanvas.addEventListener('mousemove',  onGridMouseMove);
  gridCanvas.addEventListener('mouseleave', onGridMouseLeave);

  // ── Toggle ────────────────────────────────────────────────────────────────
  btn.addEventListener('click', toggleMobGal);

  window.addEventListener('keydown', e => {
    if (e.key === 'v' || e.key === 'V') toggleMobGal();
  });

  window.addEventListener('resize', () => {
    if (mobGalOpen) renderTooltipOverlay();
    positionMobGalPanel();
  });

  // Close tooltip when panel closes
  const observer = new MutationObserver(() => {
    if (!mobGalOpen) { hoveredEntry = null; renderTooltipOverlay(); }
  });
  observer.observe(mobGalPanel, { attributes: true, attributeFilter: ['class'] });

  requestAnimationFrame(() => {
    positionMobGalButton();
    positionMobGalPanel();
  });
}