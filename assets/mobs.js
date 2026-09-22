import { MOB_SAFE_RADIUS, RARITIES, HORNET_PREFERRED_DIST_BASE, AGGRO_TIER_SCALE, rarityTier } from './constants.js';
import { spawnWebField, getWebSlowdownFactor, getPincerSlowFactor, honeycombEntities } from './drops.js';
import { canMoveTo, findOpenSpawnPosition, getMapW, getMapH } from './map.js';
import { inputState } from './inputState.js';
import { player } from './player.js';

// ── Removed-systems compatibility shims ───────────────────────────────────────
// Waves mode, the old rarity-zone grid, ant-hole sub-maps, and the NPC have
// all been removed as part of the map rehaul. These shims keep the rest of
// this file (which still calls these names in hundreds of places) working
// against the new flat placeholder map instead of touching every call site.
// isWaveMapMode() always false ⇒ every "if (isWaveMapMode())" branch below
// is permanently inert; the plain-player-target / plain-canMoveTo paths run.
function isWaveMapMode() { return false; }
function getWaveMapW() { return getMapW(); }
function getWaveMapH() { return getMapH(); }
function addTrackedMob(_mobId) { /* no-op: no wave clear-tracking anymore */ }
function onWaveMobDied(_mobId) { /* no-op */ }

// A single implicit "zone" spanning the whole placeholder map — replaces the
// old 15-cell rarity grid. getZoneId/getZoneTier/getZoneBounds/ZONE_CONFIG
// keep their old call shapes so the rest of this file needs no rewrite.
const ZONE_CONFIG = [{ name: 'Overworld', rarity: 'Common', tier: 0, floor: '#4db85c', tint: 'rgba(0,0,0,0)' }];
function getZoneId(_x, _y) { return 0; }
function getZoneTier(_zoneId) { return 0; }
function getZoneBounds(_zoneId) { return { x0: 0, y0: 0, x1: getMapW(), y1: getMapH() }; }
function pickSpawnRarity(_zoneTier, RARITIES_LOCAL) { return RARITIES_LOCAL[0]; }
function findSpawnInZone(zoneId, radius, playerX, playerY, existingMobs, safeRadius) {
  for (let i = 0; i < 60; i++) {
    const pos = findOpenSpawnPosition(radius, existingMobs, 1);
    if (!pos) continue;
    if (playerX !== undefined && Math.hypot(pos.x - playerX, pos.y - playerY) < (safeRadius ?? 0)) continue;
    return pos;
  }
  return null;
}
function findWaveMobSpawn(radius, existingMobs) { return findOpenSpawnPosition(radius, existingMobs, 60); }

// Ant-hole sub-map: dormant along with the boss-entry flow in main.js (kept
// for reuse, not currently reachable — nothing calls getBossAntHoleAtPoint's
// caller anymore). These constants/getter just keep this file self-consistent.
const ANT_HOLE_OFFSET_X = 200_000;
const ANT_HOLE_OFFSET_Y = 0;
function getAntHoleSubMapW() { return Math.round(getMapW() * 1.6); }
function getAntHoleSubMapH() { return Math.round(getMapW() * 1.6); }
function getAntHoleCircleCenter() {
  const W = getAntHoleSubMapW();
  return { cx: ANT_HOLE_OFFSET_X + W / 2, cy: ANT_HOLE_OFFSET_Y + W / 2, r: W / 2 };
}

// ── Wave mode NPC target ──────────────────────────────────────────────────────
let _npcTarget = null;
export function setWaveNPCTarget(npc) { _npcTarget = npc; }
export function clearWaveNPCTarget()   { _npcTarget = null; }

// Mob aggro target in wave mode: whichever of the player or the NPC is
// currently closer, no bias toward either — aggroRange still gates whether a
// mob wakes up and starts chasing at all (see callers below); this only
// decides WHICH of the two a mob that's already alerted (or just entered
// aggro range) goes after. Replaces the old NPC-biased design where mobs
// always defaulted to the NPC and only switched to the player within a
// short radius; every wave-mode targeting site in this file now goes
// through this one function instead of re-deriving the choice locally.
function pickWaveTarget(mob, mobX, mobY, playerX, playerY) {
  const dPlayer = Math.hypot(playerX - mobX, playerY - mobY);
  if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
    const dNpc = Math.hypot(_npcTarget.x - mobX, _npcTarget.y - mobY);
    if (dNpc < dPlayer) {
      return { targetX: _npcTarget.x, targetY: _npcTarget.y, dist: dNpc, kind: 'npc' };
    }
  }
  return { targetX: playerX, targetY: playerY, dist: dPlayer, kind: 'player' };
}

// Bubble pop push-distance curve — piecewise, anchored at specific named
// rarities per an explicit design request rather than one flat linear scale:
// subtle rise Common(0)->Epic(3), a noticeable jump into Legendary(4), another
// noticeable jump into Mythic(5), a much bigger jump into Ultra(6), then a
// smaller step into Super(7), a steady "decent" climb across Super(7)->
// Umbral(12), and a final decent bump into Impracticality(13). Linearly
// interpolates between these named anchor points rather than the tiers in
// between having their own explicit values, so each labeled span reads as a
// single smooth ramp of the described intensity.
const BUBBLE_PUSH_ANCHORS = [
  [0,   150],  // Common
  [3,   190],  // Epic — end of the "subtle" span
  [4,   320],  // Legendary — first "noticeable" jump
  [5,   480],  // Mythic — second "noticeable" jump
  [6,   820],  // Ultra — "a lot more" jump
  [7,   900],  // Super — smaller step down from the Ultra jump
  [12, 1150],  // Umbral — end of the "decent" climb from Super
  [13, 1350],  // Impracticality — final "decent" increase
];
function bubblePushDistanceForTier(tier) {
  const t = Math.max(0, Math.min(13, tier));
  for (let i = 0; i < BUBBLE_PUSH_ANCHORS.length - 1; i++) {
    const [t0, v0] = BUBBLE_PUSH_ANCHORS[i];
    const [t1, v1] = BUBBLE_PUSH_ANCHORS[i + 1];
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return v0;
      const frac = (t - t0) / (t1 - t0);
      return v0 + frac * (v1 - v0);
    }
  }
  return BUBBLE_PUSH_ANCHORS[BUBBLE_PUSH_ANCHORS.length - 1][1];
}

// ── Snake-body trail + capsule hitbox system ────────────────────────────────
// Generic, reusable infrastructure — not leech-specific by construction, even
// though leech is the only current user. Any future non-circular mob can
// reuse getMobHitCapsules/pointHitsMob the same way. A capsule here means a
// line segment plus a radius (the simplest non-circle primitive there is —
// distance from a point to a capsule is just distance to the nearest point
// on the segment, clamped to the segment's ends). The mob's TRAIL of past
// positions is chopped into consecutive short segments, each one becoming
// its own small capsule — so the hitbox follows the actual curved body
// shape as it moves and turns, not a single straight stand-in for it.
const TRAIL_MAX_POINTS = 46; // targets a ~99-unit visible/hittable body length at Common (tier 0) — 1.5x the earlier 66-unit length. No exclusion-zone overhead needed, since the fangs are excluded from collision by simply having no hit-shape of their own (see getLeechBodyCapsules/drawLeech), not by reserving trail distance
// How far (in world units, scaled by the mob's own drawRadius) the leech must
// move before a new trail point gets recorded — see the trail-recording
// block in updateMobs for why this replaced simple once-per-tick recording.
// Solved so tier 0's body length still lands on the original 99-unit target:
// 99 / (TRAIL_MAX_POINTS-1) / drawRadius(tier0)=12 = 11/60.
const LEECH_TRAIL_MIN_STEP_MULT = 11/60;

/** Point-to-capsule distance: distance from (px,py) to the capsule defined
 *  by the segment (ax,ay)-(bx,by), MINUS the capsule's own radius. Negative
 *  or zero means the point is inside/touching the capsule. */
function pointToCapsulePenetration(px, py, ax, ay, bx, by, capRadius) {
  const abx = bx - ax, aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = 0;
  if (abLenSq > 1e-9) {
    t = ((px - ax) * abx + (py - ay) * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy) - capRadius;
}

/** Builds the leech's current body capsules from its trail buffer — one
 *  capsule per consecutive pair of trail points, oldest (tail) to newest
 *  (head). Deliberately STOPS short of the very newest point(s) so the
 *  fangs/head region is excluded from the hitbox, per the design ask that
 *  "the body is the hitbox except the fangs" — only the body should be
 *  hittable, not the mouth. Returns [] if there isn't enough trail yet
 *  (e.g. the instant after spawning) so callers can safely fall back. */
// (fangs are excluded from collision entirely differently now — see
// getLeechBodyCapsules — so there is no longer a head-exclusion point count
// here at all.)
function getLeechBodyCapsules(mob) {
  const trail = mob.trail;
  if (!trail || trail.length < 2) return [];
  // Matches drawLeech's own visible outer-border half-width EXACTLY: that
  // function uses bodyWidthOuter = 41 * s where s = r/20, i.e. r * 2.05 — so
  // the hitbox's edge lands exactly on the visible black border the player
  // sees, not somewhere well inside it.
  //
  // Covers the ENTIRE trail, right up to the head — no distance-based
  // exclusion zone. Excluding whole trail points ate into a large fraction
  // of the visible body (a real, measured bug: ~32% of the body was
  // non-hittable, not just "the fangs" as intended), because a distance-based
  // cutoff scales with how far apart trail points are, which has nothing to
  // do with how big the fangs themselves are. The fangs are excluded from
  // collision a completely different way instead — they simply have no
  // collision shape of their own at all (see drawLeech: they're drawn, never
  // tested against) — so there's no longer any reason to sacrifice body
  // length just to keep them clear.
  const bodyRadius = (mob.drawRadius ?? mob.radius ?? 20) * 2.05;
  const usable = trail;
  const capsules = [];
  for (let i = 0; i < usable.length - 1; i++) {
    capsules.push({ ax: usable[i].x, ay: usable[i].y, bx: usable[i + 1].x, by: usable[i + 1].y, r: bodyRadius });
  }
  return capsules;
}

/** True if a query circle (px,py,testRadius) overlaps the mob. Capsule-aware
 *  for leech (tests against every body-segment capsule, taking the closest);
 *  every other mob type falls through to the exact same offset-rotated
 *  circle math used in combat.js's main petal-vs-mob loop (mobHitX/mobHitY),
 *  reproduced here byte-for-byte so behavior for every existing mob is
 *  completely unchanged. */
export function pointHitsMob(mob, px, py, testRadius) {
  if (mob.typeId === 'leech') {
    const capsules = getLeechBodyCapsules(mob);
    if (capsules.length > 0) {
      for (const c of capsules) {
        if (pointToCapsulePenetration(px, py, c.ax, c.ay, c.bx, c.by, c.r) < testRadius) return true;
      }
      return false;
    }
    // Not enough trail yet (just spawned) — fall through to the normal
    // circle check below so it's never hit-less in the first instant.
  }
  const hAngle = (mob.facing || 0) + Math.PI / 2;
  const swayX = mob.swayHitX || 0;
  const hOx = ((mob.hitOffsetX || 0) + swayX) * Math.cos(hAngle) - (mob.hitOffsetY || 0) * Math.sin(hAngle);
  const hOy = ((mob.hitOffsetX || 0) + swayX) * Math.sin(hAngle) + (mob.hitOffsetY || 0) * Math.cos(hAngle);
  const dx = px - (mob.x + hOx), dy = py - (mob.y + hOy);
  return Math.hypot(dx, dy) < testRadius + mob.radius;
}

// ── Mob type base definitions ──────────────────────────────────────────────────
export const MOB_DEFS = {
  bee: {
    name:'Bee', description:'Eek! don\'t ram this guy!',
    radius:18, hitRadiusFactor:1.71, speed:3.84, alertSpeed:4.284, color:'#f5cf4b', border:'#ca9f25',
    xp:4, aggroRange:420, mass:80, dpsFactor:0.89,
  },
  ladybug: {
    name:'Ladybug', description:'Spots danger from surprisingly far away. Hits harder than it looks.',
    radius:18, hitRadiusFactor:1.123, speed:1.824, alertSpeed:3.2, color:'#e84040', border:'#991a1a',
    xp:3, aggroRange:260, mass:120, dpsFactor:0.86,
  },
  spider: {
    name:'Spider', description:'Yikes! Haci dolor! this little fella doesn\'t feel too good..',
    radius:18, hitRadiusFactor:1.06, speed:3.84, alertSpeed:3.84, color:'#5c3b1c', border:'#42280f',
    xp:5, aggroRange:320, mass:220, dpsFactor:1.00,
  },
  centipede_head: {
    name:'Centipede', description:'Sure is a an interesting specimen isn\'t it? It also kinda tickes with the touch..',
    radius:20, hitRadiusFactor:1.13, speed:2.1, alertSpeed:3.2, color:'#7ed62a', border:'#3a6b1a',
    xp:10, aggroRange:300, mass:180, dpsFactor:1.0,
  },
  centipede_body: {
    name:'Centipede', description:'',
    radius:20, hitRadiusFactor:1.13, speed:2.1, alertSpeed:3.2, color:'#7ed62a', border:'#3a6b1a',
    xp:4, aggroRange:0, mass:140, dpsFactor:1.0,
  },
  hornet: {
    name:'Hornet', description:'It shoots pokey things up the flowers stem..',
    radius:18, hitRadiusFactor:1.47, speed:5.8, alertSpeed:5.8, color:'#f5cf4b', border:'#ca9f25',
    xp:7, aggroRange:450, mass:70, dpsFactor:1.0,  // body damage enabled
  },
  soldier_ant: {
    name:'Soldier Ant', description:'Gah damn, this ants a visious little guy aint he?',
    radius:20, hitRadiusFactor:1.145, hitOffsetY:-5.5, speed:3.2, alertSpeed:3.2, color:'#3d3d3d', border:'#1a1a1a',
    xp:8, aggroRange:280, mass:100, dpsFactor:1.0,
  },
  worker_ant: {
    name:'Worker Ant', description:'seems like this guys just hanging around, peaceful untill hit..',
    radius:18, hitRadiusFactor:1.125, hitOffsetY:-8.5, speed:2.8, alertSpeed:2.8, color:'#3d3d3d', border:'#1a1a1a',
    xp:5, aggroRange:0, mass:90, dpsFactor:1.0,
  },
  baby_ant: {
    name:'Baby Ant', description:'Aww, what a cute baby! Gooh gooh gah gah..',
    radius:13, hitRadiusFactor:0.82, hitOffsetY:0, speed:1.5, alertSpeed:1.5, color:'#3d3d3d', border:'#1a1a1a',
    xp:2, aggroRange:0, mass:50, dpsFactor:0.0,
  },
  queen_ant: {
    name:'Queen Ant', description:'Such royalty that she can make slav- i mean soldiers at her own will..',
    radius:42, hitRadiusFactor:1.058, hitOffsetX:0, hitOffsetY:-8.5, speed:3.5, alertSpeed:3.5, color:'#3d3d3d', border:'#1a1a1a',
    xp:20, aggroRange:300, mass:220, dpsFactor:1.0,
  },
  digger: {
    name:'Digger', description:'Youch! Spikey! But he does make a good comrade..',
    radius:25, hitRadiusFactor:1.535, speed:3.2, alertSpeed:5, color:'#8c8c8c', border:'#1a1a1a',
    xp:12, aggroRange:350, mass:160, dpsFactor:1.0,
  },
  beekeeper: {
    name:'Beekeeper', description:'Spikey.. also a good comrade as well! but has stick honey lingering on it that spills off as honey tiles..',
    radius:25, hitRadiusFactor:1.188, speed:3.5, alertSpeed:5.5, color:'#F0A830', border:'#A86820',
    xp:12, aggroRange:350, mass:280, dpsFactor:1.0,
  },
  ant_hole: {
    name:'Ant Hole', description:'The beating heart of the colony. Spawns defenders when damaged. Erupts violently when destroyed.',
    radius:38, hitRadiusFactor:1.0, speed:0, alertSpeed:0, color:'#b8750a', border:'#7a4d08',
    xp:50, aggroRange:0, mass:6000, dpsFactor:1.0,
  },
  ant_egg: {
    name:'Ant Egg', description:'Turns into a slav- i mean Soldier ant',
    radius:14, hitRadiusFactor:1.04, speed:0, alertSpeed:0, color:'#e8e8e8', border:'#1a1a1a',
    xp:4, aggroRange:0, mass:180, dpsFactor:0.0,
  },
  beehive: {
    name:'Beehive', description:'Eww.. Why is it so oohy goohy icky and sticky?',
    radius:28, hitRadiusFactor:1.57, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:0, color:'#e8a820', border:'#a06010',
    xp:60, aggroRange:0, mass:4500, dpsFactor:1.0,
  },
  rock: {
    name:'Rock', description:'Just an ordinary garden rock. Not going anywhere.',
    radius:20, hitRadiusFactor:1.075, hitOffsetX:0.0, hitOffsetY:0.2, speed:0, alertSpeed:0, color:'#8a8580', border:'#5c5852',
    xp:10, aggroRange:0, mass:5000, dpsFactor:1.0,
  },
  dandelion: {
    name:'Dandelion', description:'A dandelion, seeds and all. Fragile-looking, but it holds its ground.',
    radius:24, hitRadiusFactor:1.0, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:0, color:'#ffffff', border:'#8a8a8a',
    xp:14, aggroRange:0, mass:800, dpsFactor:1.0,
  },
  queen_bee: {
    name:'Queen Bee', description:'Same as queen ant.. Can also poo out slav- i mean gaurdians with her own free willl.. Don\'t forget, she also hurts!',
    radius:27, hitRadiusFactor:1.71, hitOffsetX:0.0, hitOffsetY:0.0, speed:3.84, alertSpeed:4.284, color:'#f5cf4b', border:'#ca9f25',
    xp:20, aggroRange:380, mass:120, dpsFactor:1.0,
  },
  beetle: {
    name:'Beetle', description:'Those mandibles look sharp.. maybe don\'t get too close.',
    radius:20, hitRadiusFactor:1.277, hitOffsetX:0.0, hitOffsetY:0.0, speed:2.6, alertSpeed:4.7, color:'#8E44AD', border:'#7D3C98',
    xp:5, aggroRange:280, mass:140, dpsFactor:1.0,
  },
  sandstorm: {
    name:'Sandstorm', description:'A swirling vortex of hexagonal sand shards. It drifts lazily... until it spots you.',
    radius:23, hitRadiusFactor:0.82, hitOffsetX:0.0, hitOffsetY:0.0, speed:1.8, alertSpeed:3.2, color:'#c8a84b', border:'#8a6820',
    xp:8, aggroRange:320, mass:160, dpsFactor:1.0,
  },
  desert_centipede_head: {
    name:'Desert Centipede', description:'A pale desert centipede that wanders the sands. It may not come straight for you, but it knows you\'re there.',
    radius:20, hitRadiusFactor:1.13, speed:5.2, alertSpeed:5.2, color:'#C5B357', border:'#8a7a30',
    xp:10, aggroRange:300, mass:180, dpsFactor:1.0,
  },
  desert_centipede_body: {
    name:'Desert Centipede', description:'',
    radius:20, hitRadiusFactor:1.13, speed:5.2, alertSpeed:5.2, color:'#C5B357', border:'#8a7a30',
    xp:4, aggroRange:0, mass:140, dpsFactor:1.0,
  },
  cactus: {
    name:'Cactus', description:'A prickly desert cactus. Don\'t get too close.',
    radius:32, hitRadiusFactor:1.0, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:0, color:'#689a10', border:'#3a5c0a',
    xp:12, aggroRange:0, mass:3000, dpsFactor:1.0,
  },

  // ── Desert / Egypt tier — NEW, all fields locked ────────────────────────────
  scorpion: {
    name:'Scorpion', description:'Its tail never stops twitching — it can smell you from here.',
    radius:22, hitRadiusFactor:0.80, hitOffsetX:-0.5, hitOffsetY:0.0,
    speed:1.56, alertSpeed:2.82, color:'#9a7412', border:'#6e5308',
    xp:6, aggroRange:350, mass:100, dpsFactor:1.0,
  },
  pyramid: {
    name:'Pyramid', description:'Ancient stone, still guarded. Something inside keeps sending more.',
    radius:24, hitRadiusFactor:1.20, hitOffsetX:0.0, hitOffsetY:0.0,
    speed:0, alertSpeed:0, color:'#d4a24a', border:'#8a651f',   // static structure
    xp:65, aggroRange:0, mass:6500, dpsFactor:1.0,
  },
  mummified_beetle: {
    name:'Mummified Beetle', description:'Wrapped tight and still walking. Whatever put it here didn\'t finish the job.',
    radius:20, hitRadiusFactor:1.25, hitOffsetX:0.0, hitOffsetY:0.0,
    speed:2.6, alertSpeed:4.7, color:'#e8dcc0', border:'#9e8b5e',
    xp:8, aggroRange:280, mass:165, dpsFactor:1.0,
  },

  // ── Fire Ants (desert) ────────────────────────────────────────────────────
  fire_soldier_ant: {
    name:'Fire Soldier Ant', description:'A vicious desert warrior — its bite burns like an ember.',
    radius:20, hitRadiusFactor:1.145, hitOffsetY:-5.5, speed:3.2, alertSpeed:3.2, color:'#8b1a00', border:'#5a0d00',
    xp:14, aggroRange:280, mass:100, dpsFactor:1.0,
  },
  fire_worker_ant: {
    name:'Fire Worker Ant', description:'Industrious and aggressive — don\'t let the name fool you.',
    radius:18, hitRadiusFactor:1.125, hitOffsetY:-8.5, speed:2.8, alertSpeed:2.8, color:'#8b1a00', border:'#5a0d00',
    xp:9, aggroRange:0, mass:90, dpsFactor:1.0,
  },
  fire_baby_ant: {
    name:'Fire Baby Ant', description:'Small, warm to the touch, and utterly harmless.',
    radius:13, hitRadiusFactor:0.82, hitOffsetY:0, speed:1.5, alertSpeed:1.5, color:'#8b1a00', border:'#5a0d00',
    xp:3, aggroRange:0, mass:50, dpsFactor:0.0,
  },
  fire_queen_ant: {
    name:'Fire Queen Ant', description:'Rules with fire. Lays eggs that hatch into burning soldiers.',
    radius:42, hitRadiusFactor:1.058, hitOffsetX:0, hitOffsetY:-8.5, speed:3.5, alertSpeed:3.5, color:'#8b1a00', border:'#5a0d00',
    xp:35, aggroRange:300, mass:220, dpsFactor:1.0,
  },
  fire_ant_egg: {
    name:'Fire Ant Egg', description:'Pulsing with heat — soon it will hatch.',
    radius:14, hitRadiusFactor:1.04, speed:0, alertSpeed:0, color:'#c0392b', border:'#5a0d00',
    xp:7, aggroRange:0, mass:180, dpsFactor:0.0,
  },
  fire_ant_hole: {
    name:'Fire Ant Hole', description:'A smoldering crater in the desert sand. The colony within does not welcome visitors.',
    radius:38, hitRadiusFactor:1.0, speed:0, alertSpeed:0, color:'#7a1f00', border:'#3d0d00',
    xp:88, aggroRange:0, mass:6000, dpsFactor:1.0,
  },

  // ── Ocean tier — NEW, all fields DRAFT (hitboxes measured against real sprites,
  //    everything else — speed/aggro/xp/mass/stats — is a first pass for polish later) ──
  jellyfish: {
    name:'Jellyfish', description:'Drifts along on its own. Brushing its tendrils stings more than you\'d expect.',
    radius:22, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:1.4, alertSpeed:2.0, color:'#d68ce8', border:'#8c4aa0',
    xp:6, aggroRange:300, mass:60, dpsFactor:0.9,
  },
  squid: {
    name:'Squid', description:'Jets backward in short bursts, trailing ink when it gets spooked.',
    radius:24, hitRadiusFactor:0.640, hitOffsetX:0.0, hitOffsetY:-1.8, speed:3.96, alertSpeed:5.04, color:'#7a4fc9', border:'#4a2d80',
    xp:9, aggroRange:340, mass:110, dpsFactor:1.0,
  },
  alligator: {
    name:'Alligator', description:'Low, patient, and a lot faster than it looks once it commits to a lunge.',
    radius:33, hitRadiusFactor:1.538, hitOffsetX:0.0, hitOffsetY:0.0, speed:3.0, alertSpeed:6.2, color:'#4a7a3a', border:'#274018',
    xp:16, aggroRange:360, mass:260, dpsFactor:1.0,
  },
  crab: {
    name:'Crab', description:'Skitters sideways and snaps with a pincer that\'s stronger than its size suggests.',
    radius:20, hitRadiusFactor:1.022, hitOffsetX:0.0, hitOffsetY:0.0, speed:2.6, alertSpeed:4.4, color:'#e0693c', border:'#973f1e',
    xp:9, aggroRange:260, mass:140, dpsFactor:1.0,
  },
  starfish: {
    name:'Starfish', description:'Barely moves, barely fights back — mostly just sits there and takes it.',
    // hitRadiusFactor is set to the sprite's shortest-arm silhouette (all 5
    // arms fully retracted via the low-HP shrink in mobDrawing.js), not the
    // full-health outline — measured directly from STARFISH_OUTLINE at max
    // shrink (0.6067x the full-health radius), and kept fixed at that size
    // regardless of the starfish's current HP/shrink state.
    radius:20, hitRadiusFactor:0.607, hitOffsetX:0.0, hitOffsetY:0.0, speed:0.4, alertSpeed:0.6, color:'#e8934b', border:'#a3601f',
    xp:4, aggroRange:0, mass:90, dpsFactor:0.5,
  },
  shell: {
    name:'Shell', description:'Sits on the sea floor. Whatever used to live in it is long gone.',
    // Sits completely motionless until hit (aggroRange:0, same "passive until
    // touched" pattern as bee/starfish/leech), then every 0.7s gets pushed
    // toward its target in a real walked burst (not a teleport) — see the
    // dedicated Shell AI block in updateMobs. speed/alertSpeed here are the
    // walk speed used DURING that push; it is otherwise fully stationary.
    radius:18, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:6, color:'#f0dcc0', border:'#a88860',
    xp:3, aggroRange:0, mass:70, dpsFactor:1.0,
  },
  sponge: {
    name:'Sponge', description:'A soft, porous lump that doesn\'t react to much of anything.',
    radius:22, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:0, color:'#e8a848', border:'#a06e1e',
    xp:4, aggroRange:0, mass:80, dpsFactor:0.0,
  },
  bubble: {
    name:'Bubble', description:'Pops the instant anything touches it. Doesn\'t put up a fight.',
    radius:16, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:0.6, alertSpeed:0.6, color:'#bfe8f2', border:'#8fd6e8',
    xp:1, aggroRange:0, mass:5, dpsFactor:0.0,
  },
  sea_cave: {
    name:'Sea Cave', description:'A dark opening in the reef. Best not to find out what\'s inside the hard way.',
    radius:38, hitRadiusFactor:1.0, hitOffsetX:0.0, hitOffsetY:0.0, speed:0, alertSpeed:0, color:'#3d7ea6', border:'#0a1f33',
    xp:40, aggroRange:0, mass:5500, dpsFactor:1.0,
  },
  debris: {
    name:'Debris', description:'Waterlogged junk that drifts slowly with the current, tumbling as it goes. Harmless, never aggressive.',
    radius:20, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:0.5, alertSpeed:0.5, color:'#7a6a52', border:'#4a3e2c',
    xp:2, aggroRange:0, mass:60, dpsFactor:0.0,
  },
  leech: {
    name:'Leech', description:'Latches on fast. The gallery pose is fixed for now — no live movement animation yet.',
    // radius halved (20 -> 10) per a "make it a lot smaller" request — this
    // does NOT shrink the body's overall length, since body length is driven
    // purely by TRAIL_MAX_POINTS * speed (see mobs.js), completely
    // independent of radius. Only the body's thickness/width and the
    // head/fang size scale down with this, which is exactly the intended
    // "smaller and longer-looking" snake proportions.
    radius:10, hitRadiusFactor:1.000, hitOffsetX:0.0, hitOffsetY:0.0, speed:2.2, alertSpeed:3.6, color:'#3d3d3d', border:'#1a1a1a',
    xp:7, aggroRange:220, mass:100, dpsFactor:0.8,
  },
};

const MOB_TYPE_IDS = ['bee','ladybug','spider','hornet','beetle','sandstorm','desert_centipede_head','cactus'];  // Diggers/beekeepers only spawn from special events

// Spider poison total damage per tier (total over 3s).
// Scales with damage multiplier — big jump at Ultra like all damage stats.
const SPIDER_POISON_TOTAL = [
  10,13,18,25,38,60,10000,20000,40000,80000,160000,320000,640000,1280000
];

// ── Stat scaling reference ────────────────────────────────────────────────────
// health_mult: [1, 2.2, 5, 11, 30, 80, 1000, 3000, 9000, 27000, 81000, 243000, 729000, 2187000]
// damage_mult: [1, 1.3, 1.8, 2.5, 3.8, 6, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000]
// armor_mult = health_mult (armor scales with HP so it stays proportional)
// Big jump at Ultra (tier 6) — gentle curve Common→Mythical, then ×3/×2 per tier after.

const MOB_STATS = {
  // base hp:90  dmg:30  armor:1
  spider: {
    hp:    [90,198,450,990,2700,7200,90000,270000,810000,2430000,7290000,21870000,65610000,196830000],
    dmg:   [30,39,54,75,114,180,30000,60000,120000,240000,480000,960000,1920000,3840000],
    armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  },
  // base hp:65  dmg:28→31  armor:0  (bee dmg buffed 10%)
  bee: {
    hp:    [65,143,325,715,1950,5200,65000,195000,585000,1755000,5265000,15795000,47385000,142155000],
    dmg:   [31,40,55,77,117,185,31000,62000,124000,248000,496000,992000,1984000,3968000],
    armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  },
  // base hp:110  dmg:28  armor:1  (ladybug dmg lowered to not exceed bee)
  ladybug: {
    hp:    [110,242,550,1210,3300,8800,110000,330000,990000,2970000,8910000,26730000,80190000,240570000],
    dmg:   [28,36,50,70,106,168,28000,56000,112000,224000,448000,896000,1792000,3584000],
    armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  },
  // base hp:125  dmg:28  armor:1
  centipede_head: {
    hp:    [125,275,625,1375,3750,10000,125000,375000,1125000,3375000,10125000,30375000,91125000,273375000],
    dmg:   [28,36,50,70,106,168,28000,56000,112000,224000,448000,896000,1792000,3584000],
    armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  },
};
MOB_STATS.centipede_body = MOB_STATS.centipede_head;

// base hp:75  dmg:40  armor:1
MOB_STATS.hornet = {
  hp:         [75,165,375,825,2250,6000,75000,225000,675000,2025000,6075000,18225000,54675000,164025000],
  dmg:        [40,52,72,100,152,240,40000,80000,160000,320000,640000,1280000,2560000,5120000],
  armor:      [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  missileHp:  [8,18,40,88,240,640,8000,24000,72000,216000,648000,1944000,5832000,17496000],
  missileDmg: [20,26,36,50,76,120,20000,40000,80000,160000,320000,640000,1280000,2560000],
};

// base hp:145  dmg:35  armor:2
MOB_STATS.soldier_ant = {
  hp:    [145,319,725,1595,4350,11600,145000,435000,1305000,3915000,11745000,35235000,105705000,317115000],
  dmg:   [35,46,63,88,133,210,35000,70000,140000,280000,560000,1120000,2240000,4480000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// base hp:85  dmg:28  armor:1
MOB_STATS.worker_ant = {
  hp:    [85,187,425,935,2550,6800,85000,255000,765000,2295000,6885000,20655000,61965000,185895000],
  dmg:   [28,36,50,70,106,168,28000,56000,112000,224000,448000,896000,1792000,3584000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:22  dmg:8  armor:0
MOB_STATS.baby_ant = {
  hp:    [22,48,110,242,660,1760,22000,66000,198000,594000,1782000,5346000,16038000,48114000],
  dmg:   [8,10,14,20,30,48,8000,16000,32000,64000,128000,256000,512000,1024000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:22  dmg:14  armor:0  (baby_ant dmg 8 × 1.75 = 14)
MOB_STATS.fire_baby_ant = {
  hp:    [22,48,110,242,660,1760,22000,66000,198000,594000,1782000,5346000,16038000,48114000],
  dmg:   [14,18,24,35,52,84,14000,28000,56000,112000,224000,448000,896000,1792000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:275  dmg:45  armor:2
MOB_STATS.queen_ant = {
  hp:    [275,605,1375,3025,8250,22000,275000,825000,2475000,7425000,22275000,66825000,200475000,601425000],
  dmg:   [45,58,81,112,171,270,45000,90000,180000,360000,720000,1440000,2880000,5760000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// base hp:750  dmg:20  armor:5
MOB_STATS.ant_hole = {
  hp:    [750,1650,3750,8250,22500,60000,750000,2250000,6750000,20250000,60750000,182250000,546750000,1640250000],
  dmg:   [20,26,36,50,76,120,20000,40000,80000,160000,320000,640000,1280000,2560000],
  armor: [5,11,25,55,150,400,5000,15000,45000,135000,405000,1215000,3645000,10935000],
};

// base hp:145  dmg:10  armor:0
MOB_STATS.ant_egg = {
  hp:    [145,319,725,1595,4350,11600,145000,435000,1305000,3915000,11745000,35235000,105705000,317115000],
  dmg:   [10,13,18,25,38,60,10000,20000,40000,80000,160000,320000,640000,1280000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// ── Fire Ant stats — same HP/armor as normal ants, damage ×1.75 ──────────────

// base hp:145  dmg:61  armor:2  (soldier_ant dmg 35 × 1.75 = ~61)
MOB_STATS.fire_soldier_ant = {
  hp:    [145,319,725,1595,4350,11600,145000,435000,1305000,3915000,11745000,35235000,105705000,317115000],
  dmg:   [61,80,111,154,233,368,61000,122000,244000,488000,976000,1952000,3904000,7808000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// base hp:85  dmg:49  armor:1  (worker_ant dmg 28 × 1.75 = ~49)
MOB_STATS.fire_worker_ant = {
  hp:    [85,187,425,935,2550,6800,85000,255000,765000,2295000,6885000,20655000,61965000,185895000],
  dmg:   [49,64,88,123,186,294,49000,98000,196000,392000,784000,1568000,3136000,6272000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:275  dmg:79  armor:2  (queen_ant dmg 45 × 1.75 = ~79)
MOB_STATS.fire_queen_ant = {
  hp:    [275,605,1375,3025,8250,22000,275000,825000,2475000,7425000,22275000,66825000,200475000,601425000],
  dmg:   [79,103,142,196,299,473,79000,158000,316000,632000,1264000,2528000,5056000,10112000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// base hp:145  dmg:0  armor:0  (eggs deal no damage)
MOB_STATS.fire_ant_egg = {
  hp:    [145,319,725,1595,4350,11600,145000,435000,1305000,3915000,11745000,35235000,105705000,317115000],
  dmg:   [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:750  dmg:35  armor:5  (ant_hole dmg 20 × 1.75 = 35)
MOB_STATS.fire_ant_hole = {
  hp:    [750,1650,3750,8250,22500,60000,750000,2250000,6750000,20250000,60750000,182250000,546750000,1640250000],
  dmg:   [35,46,63,88,133,210,35000,70000,140000,280000,560000,1120000,2240000,4480000],
  armor: [5,11,25,55,150,400,5000,15000,45000,135000,405000,1215000,3645000,10935000],
};

// base hp:370  dmg:55  armor:1
MOB_STATS.digger = {
  hp:    [370,814,1850,4070,11100,29600,370000,1110000,3330000,9990000,29970000,89910000,269730000,809190000],
  dmg:   [55,72,99,138,209,330,55000,110000,220000,440000,880000,1760000,3520000,7040000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:330  dmg:60  armor:1
MOB_STATS.beekeeper = {
  hp:    [330,726,1650,3630,9900,26400,330000,990000,2970000,8910000,26730000,80190000,240570000,721710000],
  dmg:   [60,78,108,150,228,360,60000,120000,240000,480000,960000,1920000,3840000,7680000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:520  dmg:180  armor:5
MOB_STATS.beehive = {
  hp:    [520,1144,2600,5720,15600,41600,520000,1560000,4680000,14040000,42120000,126360000,379080000,1137240000],
  dmg:   [30,39,54,75,114,180,30000,60000,120000,240000,480000,960000,1920000,3840000],
  armor: [5,11,25,55,150,400,5000,15000,45000,135000,405000,1215000,3645000,10935000],
};

// base hp:179  dmg:62  armor:2  (placeholder — scaled down from Cactus by xp ratio 10/12; not yet balanced)
MOB_STATS.rock = {
  hp:    [179,394,896,1971,5375,14333,179167,537500,1612500,4837500,14512500,43537500,130612500,391837500],
  dmg:   [62,81,112,157,238,375,62500,125000,250000,500000,1000000,2000000,4000000,8000000],
  armor: [2,3,8,18,50,133,1667,5000,15000,45000,135000,405000,1215000,3645000],
};

// base hp:150  dmg:88  armor:1  (placeholder — fragile: low HP/armor, scaled from Cactus by xp ratio 14/12 then reduced; not yet balanced)
MOB_STATS.dandelion = {
  hp:    [150,331,752,1656,4515,12040,150500,451500,1354500,4063500,12190500,36571500,109714500,329143500],
  dmg:   [88,113,158,219,332,525,87500,175000,350000,700000,1400000,2800000,5600000,11200000],
  armor: [1,1,4,8,21,56,700,2100,6300,18900,56700,170100,510300,1530900],
};

// base hp:330  dmg:200  armor:0
MOB_STATS.queen_bee = {
  hp:    [330,726,1650,3630,9900,26400,330000,990000,2970000,8910000,26730000,80190000,240570000,721710000],
  dmg:   [55,72,99,138,209,330,55000,110000,220000,440000,880000,1760000,3520000,7040000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:45  dmg:30  armor:1
// base hp:130  dmg:30  armor:1  — buffed above most garden roamers (was 45, an outlier ~half every peer's HP)
MOB_STATS.beetle = {
  hp:    [130,286,650,1430,3900,10400,130000,390000,1170000,3510000,10530000,31590000,94770000,284310000],
  dmg:   [30,39,54,75,114,180,30000,60000,120000,240000,480000,960000,1920000,3840000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:438  dmg:50  armor:1
MOB_STATS.sandstorm = {
  hp:    [438,963,2190,4818,13140,35040,438000,1314000,3942000,11826000,35478000,106434000,319302000,957906000],
  dmg:   [50,65,90,125,190,300,50000,100000,200000,400000,800000,1600000,3200000,6400000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:215  dmg:75  armor:2
MOB_STATS.desert_centipede_head = {
  hp:    [215,473,1075,2365,6450,17200,215000,645000,1935000,5805000,17415000,52245000,156735000,470205000],
  dmg:   [75,97,135,188,285,450,75000,150000,300000,600000,1200000,2400000,4800000,9600000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};
MOB_STATS.desert_centipede_body = MOB_STATS.desert_centipede_head;

// base hp:215  dmg:75  armor:2
MOB_STATS.cactus = {
  hp:    [215,473,1075,2365,6450,17200,215000,645000,1935000,5805000,17415000,52245000,156735000,470205000],
  dmg:   [75,97,135,188,285,450,75000,150000,300000,600000,1200000,2400000,4800000,9600000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// ── Desert / Egypt tier — NEW mobs ────────────────────────────────────────

// base hp:38  dmg:22  armor:1  (HP -15% vs Beetle, DMG -27% vs Beetle; armor matches Beetle)
// base hp:38  dmg:29  armor:1  — dmg buffed to sit alongside Beetle/Hornet (was 22, lowest of any garden roamer)
// missileHp gives the stinger projectile real durability (was hardcoded to 1, destroyed
// by a single petal touch — a likely cause of shots appearing to never fire, since
// Scorpion holds much closer to the player than Hornet does).
MOB_STATS.scorpion = {
  hp:        [38,84,190,418,1140,3040,38000,114000,342000,1026000,3078000,9234000,27702000,83106000],
  dmg:       [29,38,52,72,110,174,29000,58000,116000,232000,464000,928000,1856000,3712000],
  armor:     [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  missileHp: [8,18,40,88,240,640,8000,24000,72000,216000,648000,1944000,5832000,17496000],
};

// base hp:915  dmg:24  armor:5  (HP/DMG +22% vs Ant Hole; armor matches Ant Hole)
MOB_STATS.pyramid = {
  hp:    [915,2013,4575,10065,27450,73200,915000,2745000,8235000,24705000,74115000,222345000,667035000,2001105000],
  dmg:   [24,31,43,60,91,144,24000,48000,96000,192000,384000,768000,1536000,3072000],
  armor: [5,11,25,55,150,400,5000,15000,45000,135000,405000,1215000,3645000,10935000],
};

// base hp:68  dmg:35  armor:1  (HP +50% vs Beetle, DMG +15% vs Beetle; armor matches Beetle)
// base hp:195  dmg:35  armor:1  (HP +50% vs Beetle's new 130, DMG +15% vs Beetle's 30; armor matches Beetle)
MOB_STATS.mummified_beetle = {
  hp:    [195,429,975,2145,5850,15600,195000,585000,1755000,5265000,15795000,47385000,142155000,426465000],
  dmg:   [35,46,63,88,133,210,35000,70000,140000,280000,560000,1120000,2240000,4480000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// ── Ocean tier — NEW mobs, DRAFT stats (weight-classed against Garden/Desert peers) ──

// base hp:70  dmg:30  armor:0  (~bee weight class)
MOB_STATS.jellyfish = {
  hp:    [70,154,350,770,2100,5600,70000,210000,630000,1890000,5670000,17010000,51030000,153090000],
  dmg:   [30,39,54,75,114,180,30000,60000,120000,240000,480000,960000,1920000,3840000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:110  dmg:42  armor:1  (~hornet weight class)
MOB_STATS.squid = {
  hp:    [110,242,550,1210,3300,8800,110000,330000,990000,2970000,8910000,26730000,80190000,240570000],
  dmg:   [42,55,76,105,160,252,42000,84000,168000,336000,672000,1344000,2688000,5376000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:280  dmg:55  armor:3  (~digger/beekeeper weight class, heaviest roamer)
MOB_STATS.alligator = {
  hp:    [280,616,1400,3080,8400,22400,280000,840000,2520000,7560000,22680000,68040000,204120000,612360000],
  dmg:   [55,72,99,138,209,330,55000,110000,220000,440000,880000,1760000,3520000,7040000],
  armor: [3,7,15,33,90,240,3000,9000,27000,81000,243000,729000,2187000,6561000],
};

// base hp:150  dmg:34  armor:2  (~soldier_ant weight class)
MOB_STATS.crab = {
  hp:    [150,330,750,1650,4500,12000,150000,450000,1350000,4050000,12150000,36450000,109350000,328050000],
  dmg:   [34,44,61,85,129,204,34000,68000,136000,272000,544000,1088000,2176000,4352000],
  armor: [2,4,10,22,60,160,2000,6000,18000,54000,162000,486000,1458000,4374000],
};

// base hp:55  dmg:16  armor:1  (weakest roamer — low threat, barely moves)
MOB_STATS.starfish = {
  hp:    [55,121,275,605,1650,4400,55000,165000,495000,1485000,4455000,13365000,40095000,120285000],
  dmg:   [16,21,29,40,61,96,16000,32000,64000,128000,256000,512000,1024000,2048000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:60  dmg:0  armor:1  (static, no bite — dpsFactor 0 like ant_egg)
MOB_STATS.shell = {
  hp:    [60,132,300,660,1800,4800,60000,180000,540000,1620000,4860000,14580000,43740000,131220000],
  dmg:   [30,39,54,75,114,180,30000,60000,120000,240000,480000,960000,1920000,3840000],
  armor: [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
};

// base hp:90  dmg:0  armor:0  (static)
MOB_STATS.sponge = {
  hp:    [90,198,450,990,2700,7200,90000,270000,810000,2430000,7290000,21870000,65610000,196830000],
  dmg:   [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:1  dmg:0  armor:0  (pops instantly — one petal touch kills it at any tier)
MOB_STATS.bubble = {
  hp:    [1,2,5,11,30,80,1000,3000,9000,27000,81000,243000,729000,2187000],
  dmg:   [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:700  dmg:0  armor:4  (static structure, ~ant_hole weight but no minions defined yet)
MOB_STATS.sea_cave = {
  hp:    [700,1540,3500,7700,21000,56000,700000,2100000,6300000,18900000,56700000,170100000,510300000,1530900000],
  dmg:   [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  armor: [4,9,20,44,120,320,4000,12000,36000,108000,324000,972000,2916000,8748000],
};

// base hp:40  dmg:0  armor:0  (static clutter)
MOB_STATS.debris = {
  hp:    [40,88,200,440,1200,3200,40000,120000,360000,1080000,3240000,9720000,29160000,87480000],
  dmg:   [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// base hp:80  dmg:26  armor:0  (draft only — drawLeechPose has no live-animation params yet, see mobDrawing.js)
MOB_STATS.leech = {
  hp:    [80,176,400,880,2400,6400,80000,240000,720000,2160000,6480000,19440000,58320000,174960000],
  dmg:   [26,34,47,65,99,156,26000,52000,104000,208000,416000,832000,1664000,3328000],
  armor: [0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// Radius is capped at Runic (tier 10 = 55.0) — tiers 11-13 keep the same visual size.
// Mass still scales freely above Runic (see MASS_SCALE).
// Tiers 0–5: original curve. Tier 6 (Ultra) onward: gentle ~1.3x growth per tier instead of massive jumps.
export const RADIUS_SCALE = [1.2, 1.0, 1.2, 1.83, 3.0, 5.96, 7.75, 10.1, 13.1, 17.0, 22.0, 22.0, 22.0, 22.0];
// Mass scale per tier — derived from the intended growth examples.
// Tiers 0–8 match the provided series exactly; tiers 9–13 continue at ×2.25 per tier.
const MASS_SCALE = [1, 1.3222, 1.7556, 2.5556, 4.4, 10.2333, 49.0, 100.0, 225.0, 506.25, 1139.06, 2562.89, 5766.5, 12974.6];

function getRandomMobType() { return MOB_TYPE_IDS[Math.floor(Math.random()*MOB_TYPE_IDS.length)]; }

export function getMobStats(typeId, tier) {
  const lookupId = (typeId === 'centipede_body' ? 'centipede_head' : typeId === 'desert_centipede_body' ? 'desert_centipede_head' : typeId);
  const d = MOB_DEFS[lookupId];
  const s = MOB_STATS[lookupId];
  if (!d) return null;
  const t = Math.max(0,Math.min(13,tier));
  const scale = RADIUS_SCALE[t] ?? 1;
  const aggroRange = d.aggroRange>0 ? Math.round(d.aggroRange * (1 + t * AGGRO_TIER_SCALE)) : 0;
  const out = {
    name:d.name, description:d.description||'',
    hp:s?s.hp[t]:50, damage:s?s.dmg[t]:10, armor:s?s.armor[t]:0,
    speed:d.speed*Math.sqrt(scale), alertSpeed:(d.alertSpeed||d.speed)*Math.sqrt(scale),
    mass:Math.round(d.mass*(MASS_SCALE[t]??1)), aggroRange,
  };
  // Spider poison info (total over 3s and per-second)
  if (lookupId === 'spider'){
    const total = SPIDER_POISON_TOTAL[t] ?? 0;
    out.poisonTotal = total;
    out.poisonDps = Math.round(total / 3);
  }
  return out;
}

const ZONE_CHECK_INTERVAL=5*60*1000, SPAWN_DRIP_INTERVAL=1000/3;

// Mob cap per zone — high-tier zones spawn fewer but tougher mobs
function getZoneMobMax(zoneId) {
  const cfg = ZONE_CONFIG[zoneId];
  if (!cfg) return 25;
  if (cfg.tier >= 13) return 8;   // Impracticality
  if (cfg.tier >= 12) return 12;  // Umbral
  if (cfg.tier >= 10) return 18;  // Runic / Seraphic
  return 25;
}

// Death trigger = half the zone cap (so zones always can refill naturally)
function getDeathTrigger(zoneId) {
  return Math.max(3, Math.floor(getZoneMobMax(zoneId) / 2));
}

export const zoneStates = Array.from({length:15},(_,zoneId)=>({
  zoneId, mobIds:new Set(), deaths:0, spawning:false, spawnAccum:0, checkTimer:ZONE_CHECK_INTERVAL, activated:false,
  centipedeCount:0, antHoleCount:0, beehiveCount:0, fireAntHoleCount:0,
}));

let nextMobId=0, nextChainId=0, _bossStingerNextId=0;
export const mobs=[];
export const missiles=[];      // active hornet missiles
export const bossStingers=[];  // orbiting stingers spawned by boss bee ability
export const bossPeas=[];      // pea projectiles shot by boss centipede segments
export const bossRoses=[];     // rose minions spawned by boss ladybug
export const queenBeeEggs=[];  // bee eggs laid by boss queen bee
export const queenBeePollenOrbit=[]; // pollen orbiting boss queen bee before launch
export const jellyfishBolts=[]; // fading lightning-strike visuals — see updateJellyfishBolts
export const explosionEffects=[]; // fading blast-radius rings — see the decay loop near jellyfishBolts' own
export const popEffects=[]; // small expand+fade pop visuals (e.g. Bubble breaking) — same decay pattern
/** Queue of jellyfish zap decisions made this frame in updateMobs, drained
 *  and resolved (real damage applied) by combat.js's updateCombat right
 *  after — see the jellyfish AI block below for why damage isn't applied
 *  directly here. Each entry: { jellyfishId, fromX, fromY, targetKind,
 *  targetX, targetY, damage, chainMobId, chainX, chainY }. */
export const pendingJellyfishZaps=[];
const centipedeChains=new Map();
const desertCentipedeChains=new Map();

function generateSpots(radius) {
  const spots=[], count=3+Math.floor(Math.random()*4);
  for(let i=0;i<count;i++){
    const angle=(Math.PI*0.3)+Math.random()*(Math.PI*1.4);
    const dist=Math.random()*radius*0.58, r=radius*(0.1+Math.random()*0.16);
    spots.push({ox:Math.cos(angle)*dist,oy:Math.sin(angle)*dist,r});
  }
  return spots;
}

function spawnMob(typeId,x,y,homeZoneId,tier=0) {
  const d=MOB_DEFS[typeId], stats=MOB_STATS[typeId];
  const t=Math.max(0,Math.min(13,tier));
  const maxHp=stats?stats.hp[t]:50, damage=stats?stats.dmg[t]:10, armor=stats?stats.armor[t]:0;
  const contactDps=damage*(d.dpsFactor??1.0), rarity=RARITIES[t];
  const xp=Math.ceil(d.xp*(1+t*3));
  const scale=RADIUS_SCALE[t]??1;
  const baseRadius=Math.max(1,Math.round(d.radius*scale));
  // For mobs with an oval body, hitbox circle is sized to match body front-to-back extent
  const hitFactor=d.hitRadiusFactor??1.0;
  const radius=Math.max(1,Math.round(baseRadius*hitFactor));
  const drawRadius=baseRadius;  // visual drawing size is always the base
  const mass=Math.max(1,Math.round(d.mass*(MASS_SCALE[t]??1)));
  const mob={
    id:nextMobId++, typeId, name:d.name, rarity, homeZoneId, x, y,
    radius, drawRadius, hp:maxHp, maxHp, damage, contactDps, armor,
    baseSpeed:d.speed*Math.sqrt(scale), speed:d.speed*Math.sqrt(scale), alertSpeed:(d.alertSpeed||d.speed)*Math.sqrt(scale),
    color:d.color, border:d.border, xp,
    aggroRange: d.aggroRange>0 ? Math.max(radius*2, Math.round(d.aggroRange * (1 + t * AGGRO_TIER_SCALE))) : 0,
    mass,
    hitOffsetX: (d.hitOffsetX || 0) * scale,
    hitOffsetY: (d.hitOffsetY || 0) * scale,
    wanderAngle:Math.random()*Math.PI*2, wanderTimer:Math.random()*2000,
    webTimer:1500, alerted:false, dead:false,
    facing:Math.random()*Math.PI*2, targetFacing:0,
    legPhase:0, wobblePhase:0,
    tentaclePhase:Math.random()*Math.PI*2, tailPhase:0,
    hitArm:0, hitPhase:0,
    spots:typeId==='ladybug'?generateSpots(d.radius):[],
    chainId:null, segIndex:null, isCentipede:false,
    tier:t,
    hurtFlash: 0,   // ms remaining of red damage flash
  };
  // ── Hornet-specific state ──────────────────────────────────────────────────
  if (typeId==='hornet') {
    mob.shootState    = 'idle';   // 'idle' | 'approach' | 'aim' | 'fire' | 'reset'
    mob.shootTimer    = 0;
    mob.stingerProgress = 1;      // 1 = full stinger, 0 = just fired (regrowing)
  }
  // ── Ant colony specific state ──────────────────────────────────────────────
  if (typeId==='ant_hole') {
    mob.nextMilestoneHp = Math.round(maxHp * 0.85);  // first milestone at 85% HP
    mob.isAntHole = true;
  }
  if (typeId==='baby_ant') {
    mob.nextMilestoneHp = Math.round(maxHp * 0.75);  // first milestone at 75% HP (every 25%)
  }
  if (typeId==='beehive') {
    mob.nextMilestoneHp = Math.round(maxHp * 0.75);  // first milestone at 75% HP (25% intervals)
    mob.isBeehive = true;
  }
  if (typeId==='pyramid') {
    mob.nextMilestoneHp = Math.round(maxHp * 0.85);  // first milestone at 85% HP (every 15%)
    mob.isPyramid = true;
  }
  if (typeId==='leech') {
    // Explicitly start with a single-point trail (== spawn position) rather
    // than leaving it undefined for the movement loop to lazily create.
    // Guarantees the body always starts short (a lone point renders as the
    // small fallback dot in drawLeech, since its "trail.length>=2" check
    // fails) and grows naturally to full length over its first ~40 ticks of
    // movement, instead of any chance of appearing already fully stretched
    // out the instant it spawns.
    mob.trail = [{ x, y }];
  }
  if (typeId==='queen_ant') {
    mob.queenLayTimer = 5000;
    mob.queenLayState = 'moving';   // 'moving' | 'pausing'
    mob.queenLayPause = 0;
  }
  if (typeId==='ant_egg') {
    mob.eggHatchTimer = 3500;  // hatches into soldier ant after 3.5s
  }
  if (['soldier_ant','worker_ant','baby_ant','queen_ant','ant_egg','ant_hole'].includes(typeId)) {
    mob.pincerPhase = 0;
    mob.wingPhase   = 0;
    mob.isAntMob    = true;
  }
  // ── Fire Ant colony specific state ────────────────────────────────────────
  if (typeId==='fire_ant_hole') {
    mob.nextMilestoneHp = Math.round(maxHp * 0.85);
    mob.isFireAntHole = true;
  }
  if (typeId==='fire_queen_ant') {
    mob.queenLayTimer = 5000;
    mob.queenLayState = 'moving';
    mob.queenLayPause = 0;
  }
  if (typeId==='fire_ant_egg') {
    mob.eggHatchTimer = 3500;
  }
  if (['fire_soldier_ant','fire_worker_ant','fire_queen_ant','fire_ant_egg','fire_ant_hole'].includes(typeId)) {
    mob.pincerPhase = 0;
    mob.wingPhase   = 0;
    mob.isFireAntMob = true;
  }
  if (typeId === 'beetle' || typeId === 'mummified_beetle') {
    mob.pincerPhase = 0;
  }
  if (typeId === 'sandstorm') {
    // Starting rotations match the sketch: outer slightly CCW, mid strongly CW, inner slightly CW
    mob.hexRotations = [-0.033, 0.365, 0.0];  // radians: outer, mid, inner (SVG tilts baked in)
    mob.hexRotSpeeds = [-0.003, -0.008, 0.007];  // fastest ring (inner) slowed down from 0.012
    mob.driftVx = (Math.random() - 0.5) * 0.8;  // gentle drift velocity
    mob.driftVy = (Math.random() - 0.5) * 0.8;
    mob.driftTimer = 1000 + Math.random() * 2000;
    mob.ramTimer = 0;      // cooldown before next ram
    mob.ramVx = 0;
    mob.ramVy = 0;
    mob.isRamming = false;
  }
  if (typeId==='digger') {
    mob.state = 'neutral';  // 'neutral' | 'sad' | 'angry'
    mob.cutterRot = 0;
    mob.eyeAngle = 0;
    mob.browT = 0;          // 0 = no eyebrows, 1 = full angry eyebrows
    // Animation state for smooth transitions
    mob.animPdx = 0;
    mob.animPdy = 0;
    mob.animCpOffset = mob.drawRadius * 0.14; // Start with neutral smile (world units)
  }
  if (typeId==='beekeeper') {
    mob.state = 'neutral';  // 'neutral' | 'sad' | 'angry'
    mob.cutterRot = 0;
    mob.eyeAngle = 0;
    mob.browT = 0;          // 0 = neutral mouth (circle), 1 = angry mouth (frown)
    mob.animPdx = 0;
    mob.animPdy = 0;
  }
  mobs.push(mob);
  return mob;
}

function spawnCentipede(x,y,homeZoneId,tier,isBossSpawn=false) {
  const segCount=4+Math.floor(Math.random()*7);  // 4–10 body segments (not counting head)
  const chainId=nextChainId++;
  const chainArr=[];
  const initAngle=Math.random()*Math.PI*2;

  const head=spawnMob('centipede_head',x,y,homeZoneId,tier);
  head.chainId=chainId; head.segIndex=0; head.isCentipede=true;
  head.facing=initAngle; head.wanderAngle=initAngle;
  chainArr.push(head);
  if (zoneStates[homeZoneId]) zoneStates[homeZoneId].mobIds.add(head.id);

  const segSpacing=head.radius*2.05;
  // Place each segment behind the previous one, stepping in small increments
  // to avoid clipping through walls — if blocked, try adjacent angles
  let prevX=x, prevY=y;
  for(let i=0;i<segCount;i++){
    let placed=false;
    // Try the natural trailing direction first, then small angle offsets
    for(let attempt=0;attempt<12;attempt++){
      const tryAngle = initAngle + Math.PI + (attempt===0?0:(attempt%2===0?1:-1)*Math.ceil(attempt/2)*0.25);
      const bx=prevX+Math.cos(tryAngle)*segSpacing;
      const by=prevY+Math.sin(tryAngle)*segSpacing;
      if(canMoveTo(bx,by,head.radius)){
        const body=spawnMob('centipede_body',bx,by,homeZoneId,tier);
        body.chainId=chainId; body.segIndex=i+1; body.isCentipede=true;
        body.facing=initAngle;
        // If this is a boss spawn, immediately mark segments as boss so stats
        // can be applied correctly by applyBossStatsToCentipedeChain
        if (isBossSpawn) body.isBoss = true;
        chainArr.push(body);
        prevX=bx; prevY=by;
        placed=true;
        break;
      }
    }
    if(!placed) break; // can't fit more segments — stop early
  }
  centipedeChains.set(chainId,{id:chainId,mobs:chainArr,alerted:false});
  const headZoneState = zoneStates[homeZoneId];
  if(headZoneState) headZoneState.centipedeCount = (headZoneState.centipedeCount||0)+1;
  return head;
}

function spawnDesertCentipede(x,y,homeZoneId,tier) {
  const segCount=4+Math.floor(Math.random()*7);  // 4–10 body segments
  const chainId=nextChainId++;
  const chainArr=[];
  const initAngle=Math.random()*Math.PI*2;

  const head=spawnMob('desert_centipede_head',x,y,homeZoneId,tier);
  head.chainId=chainId; head.segIndex=0; head.isDesertCentipede=true;
  head.facing=initAngle; head.wanderAngle=initAngle;
  chainArr.push(head);
  if (zoneStates[homeZoneId]) zoneStates[homeZoneId].mobIds.add(head.id);

  const segSpacing=head.radius*2.05;
  let prevX=x, prevY=y;
  for(let i=0;i<segCount;i++){
    let placed=false;
    for(let attempt=0;attempt<12;attempt++){
      const tryAngle = initAngle + Math.PI + (attempt===0?0:(attempt%2===0?1:-1)*Math.ceil(attempt/2)*0.25);
      const bx=prevX+Math.cos(tryAngle)*segSpacing;
      const by=prevY+Math.sin(tryAngle)*segSpacing;
      if(canMoveTo(bx,by,head.radius)){
        const body=spawnMob('desert_centipede_body',bx,by,homeZoneId,tier);
        body.chainId=chainId; body.segIndex=i+1; body.isDesertCentipede=true;
        body.facing=initAngle;
        chainArr.push(body);
        prevX=bx; prevY=by;
        placed=true;
        break;
      }
    }
    if(!placed) break;
  }
  desertCentipedeChains.set(chainId,{id:chainId,mobs:chainArr,alerted:false});
  if(zoneStates[homeZoneId]) zoneStates[homeZoneId].mobIds.add(head.id);
  return head;
}

function triggerZoneDeath(mob) {
  const state=zoneStates[mob.homeZoneId];
  if(!state) return;
  state.mobIds.delete(mob.id);
  state.deaths++;
  if(state.deaths>=getDeathTrigger(mob.homeZoneId)&&!state.spawning){
    state.spawning=true; state.spawnAccum=0; state.deaths=0;
  }
}

// Apply boss stat multipliers to a mob (mirrors bossManager._applyBossStats)
function _applyBossStatsToMob(mob) {
  mob.isBoss      = true;
  mob.maxHp      *= 10;
  mob.hp          = mob.maxHp;
  mob.damage     *= 2;
  mob.contactDps *= 2;
  // Scale drawRadius and radius independently so hitRadiusFactor (bee/hornet oval hitbox) is preserved.
  // Boss is always exactly 1.5x the size of the regular mob at that tier.
  const preDraw    = mob.drawRadius;
  const hitFactor  = mob.radius / mob.drawRadius;
  mob.drawRadius   = Math.round(preDraw * 1.5);
  mob.radius       = Math.round(mob.drawRadius * hitFactor);
  const actualScale = 1.5;
  mob.mass        = Math.round(mob.mass * 3);
  mob.baseSpeed  *= 0.9;
  mob.speed      *= 0.9;
  mob.alertSpeed *= 0.9;
  mob.hitOffsetX  = (mob.hitOffsetX || 0) * actualScale;
  mob.hitOffsetY  = (mob.hitOffsetY || 0) * actualScale;
  if (mob.aggroRange > 0) mob.aggroRange = Math.round(mob.aggroRange * 1.5);
}

// Spawn an ant minion near a position, NOT tracked by the zone mob cap
function spawnAntMinion(typeId, nearX, nearY, homeX, homeY, zoneId, tier) {
  const def=MOB_DEFS[typeId];
  if(!def) return null;
  let mx=nearX, my=nearY;
  for(let attempt=0;attempt<16;attempt++){
    const angle=Math.random()*Math.PI*2;
    const dist=50+Math.random()*130;
    const tx=nearX+Math.cos(angle)*dist, ty=nearY+Math.sin(angle)*dist;
    if(canMoveTo(tx,ty,def.radius)){mx=tx;my=ty;break;}
  }
  const mob=spawnMob(typeId,mx,my,zoneId,tier);
  // homeX/homeY still set for mobs whose AI leashes back to a point (ants, bees).
  // isZoneTracked defaults to true now — these are enemy minions, not player pets
  // (real player pets are spawned separately via spawnFriendly*Pet and opt out
  // themselves), so they should count toward the zone cap and run their own
  // type-specific onMobDied handler like any other mob.
  mob.homeX=homeX; mob.homeY=homeY; mob.isZoneTracked=true;
  return mob;
}

// Spawn ant hole initial minions
function spawnAntHoleMinions(holeX, holeY, zoneId, tier, isBossHole = false) {
  if (isBossHole) {
    // Boss ant hole initial minions: 1 boss soldier ant + 1 boss worker ant (wave-tracked)
    const s = spawnAntMinion('soldier_ant', holeX, holeY, holeX, holeY, zoneId, tier);
    const w = spawnAntMinion('worker_ant',  holeX, holeY, holeX, holeY, zoneId, tier);
    if (s) { _applyBossStatsToMob(s); if (isWaveMapMode()) { s.waveTarget = 'npc'; s.alerted = true; addTrackedMob(s.id); } }
    if (w) { _applyBossStatsToMob(w); if (isWaveMapMode()) { w.waveTarget = 'npc'; w.alerted = true; addTrackedMob(w.id); } }
  } else {
    spawnAntMinion('soldier_ant', holeX, holeY, holeX, holeY, zoneId, tier);
    spawnAntMinion('worker_ant',  holeX, holeY, holeX, holeY, zoneId, tier);
    spawnAntMinion('baby_ant',    holeX, holeY, holeX, holeY, zoneId, tier);
  }
}

// Spawn a fire ant minion near a position, NOT tracked by the zone mob cap
function spawnFireAntMinion(typeId, nearX, nearY, homeX, homeY, zoneId, tier) {
  const def = MOB_DEFS[typeId];
  if (!def) return null;
  let mx = nearX, my = nearY;
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 50 + Math.random() * 130;
    const tx = nearX + Math.cos(angle) * dist, ty = nearY + Math.sin(angle) * dist;
    if (canMoveTo(tx, ty, def.radius)) { mx = tx; my = ty; break; }
  }
  const mob = spawnMob(typeId, mx, my, zoneId, tier);
  mob.homeX = homeX; mob.homeY = homeY; mob.isZoneTracked = false;
  return mob;
}

// Spawn fire ant hole initial minions
function spawnFireAntHoleMinions(holeX, holeY, zoneId, tier) {
  spawnFireAntMinion('fire_soldier_ant', holeX, holeY, holeX, holeY, zoneId, tier);
  spawnFireAntMinion('fire_worker_ant',  holeX, holeY, holeX, holeY, zoneId, tier);
  spawnFireAntMinion('fire_baby_ant',    holeX, holeY, holeX, holeY, zoneId, tier);
}

// Spawn a mob near the sea cave, NOT zone-tracked (these are periodic bonus
// spawns triggered by the cave taking damage, not initial zone population —
// same "not tracked" convention as spawnFireAntMinion). Same position-finding
// as spawnAntMinion: try nearby random angles/distances, fall back to the
// cave's own position if every attempt is blocked.
function spawnSeaCaveMinion(typeId, nearX, nearY, zoneId, tier) {
  const def = MOB_DEFS[typeId];
  if (!def) return null;
  let mx = nearX, my = nearY;
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 50 + Math.random() * 130;
    const tx = nearX + Math.cos(angle) * dist, ty = nearY + Math.sin(angle) * dist;
    if (canMoveTo(tx, ty, def.radius)) { mx = tx; my = ty; break; }
  }
  const mob = spawnMob(typeId, mx, my, zoneId, tier);
  mob.isZoneTracked = false;
  return mob;
}

// Sea cave's every-15%-HP-lost spawn wave: one crab AND one jellyfish always,
// each of those two spawn events independently rolling a 12% chance for a
// bonus mob — bubble by default, flipped to leech 50% of the time when that
// 12% hits. "Each... independently" means up to 2 bonus mobs total (one
// attached to the crab spawn, one to the jellyfish spawn), not one shared
// roll for the pair.
const SEA_CAVE_BONUS_CHANCE = 0.12;
const SEA_CAVE_BONUS_LEECH_CHANCE = 0.5; // of the bonus mobs that do spawn, half are leech instead of bubble
function spawnSeaCaveWave(caveX, caveY, zoneId, tier) {
  spawnSeaCaveMinion('crab', caveX, caveY, zoneId, tier);
  if (Math.random() < SEA_CAVE_BONUS_CHANCE) {
    const bonusType = Math.random() < SEA_CAVE_BONUS_LEECH_CHANCE ? 'leech' : 'bubble';
    spawnSeaCaveMinion(bonusType, caveX, caveY, zoneId, tier);
  }
  spawnSeaCaveMinion('jellyfish', caveX, caveY, zoneId, tier);
  if (Math.random() < SEA_CAVE_BONUS_CHANCE) {
    const bonusType = Math.random() < SEA_CAVE_BONUS_LEECH_CHANCE ? 'leech' : 'bubble';
    spawnSeaCaveMinion(bonusType, caveX, caveY, zoneId, tier);
  }
}

// Sea cave's on-death wave: always one jellyfish, one crab, AND one debris —
// distinct from spawnSeaCaveWave above (the periodic every-15%-HP-lost
// wave, which spawns crab+jellyfish only, no debris). Also rolls the same
// 12% bonus-mob chance, once, using the same bubble/leech split — reuses
// SEA_CAVE_BONUS_CHANCE/SEA_CAVE_BONUS_LEECH_CHANCE above rather than
// introducing separate constants, since it's the same "bonus mob" concept.
function spawnSeaCaveDeathWave(caveX, caveY, zoneId, tier) {
  spawnSeaCaveMinion('jellyfish', caveX, caveY, zoneId, tier);
  spawnSeaCaveMinion('crab', caveX, caveY, zoneId, tier);
  spawnSeaCaveMinion('debris', caveX, caveY, zoneId, tier);
  if (Math.random() < SEA_CAVE_BONUS_CHANCE) {
    const bonusType = Math.random() < SEA_CAVE_BONUS_LEECH_CHANCE ? 'leech' : 'bubble';
    spawnSeaCaveMinion(bonusType, caveX, caveY, zoneId, tier);
  }
}

function handleCentipedeSegmentDeath(deadMob) {
  const chain=centipedeChains.get(deadMob.chainId);
  if(!chain) return;
  const idx=chain.mobs.indexOf(deadMob);
  if(idx===-1) return;
  chain.mobs.splice(idx,1);

  if(chain.mobs.length===0){
    centipedeChains.delete(deadMob.chainId);
    triggerZoneDeath(deadMob); // dead was the head, is in mobIds
    const st=zoneStates[deadMob.homeZoneId];
    if(st) st.centipedeCount=Math.max(0,(st.centipedeCount||1)-1);
    return;
  }

  if(idx===0){
    // Head died — promote next segment as chain leader, but keep its body drawing
    const newHead=chain.mobs[0];
    newHead.isChainHead=true;       // AI treats this as head
    newHead.isCentipede=true;
    newHead.alerted=chain.alerted;
    newHead.segIndex=0;
    newHead.aggroRange=MOB_DEFS.centipede_head.aggroRange;
    // typeId stays 'centipede_body' — drawing does NOT change
    // Update remaining body segment indices
    for(let i=1;i<chain.mobs.length;i++) chain.mobs[i].segIndex=i;
    const state=zoneStates[deadMob.homeZoneId];
    if(state){ state.mobIds.delete(deadMob.id); state.mobIds.add(newHead.id); }
  } else if(idx<chain.mobs.length){
    // Middle segment died — split into two chains
    const rightMobs=chain.mobs.splice(idx);
    if(rightMobs.length>0){
      const newChainId=nextChainId++;
      // First right-side segment becomes chain leader — body drawing stays
      const newHead=rightMobs[0];
      newHead.isChainHead=true;
      newHead.isCentipede=true;
      newHead.alerted=chain.alerted;
      newHead.segIndex=0;
      newHead.aggroRange=MOB_DEFS.centipede_head.aggroRange;
      // Ensure all right-side segments are body type
      for(let i=0;i<rightMobs.length;i++){
        rightMobs[i].segIndex=i;
        rightMobs[i].typeId='centipede_body';
        rightMobs[i].isChainHead=(i===0);
      }
      const newChain={id:newChainId,mobs:rightMobs,alerted:chain.alerted};
      centipedeChains.set(newChainId,newChain);
      for(const m of rightMobs) m.chainId=newChainId;
      const state=zoneStates[newHead.homeZoneId];
      if(state) { state.mobIds.add(newHead.id); state.centipedeCount=(state.centipedeCount||1)+1; }
      // Fix left-side segment indices
      for(let i=0;i<chain.mobs.length;i++) chain.mobs[i].segIndex=i;
    }
  }
  // tail died: nothing extra needed
}

function handleDesertCentipedeSegmentDeath(deadMob) {
  const chain=desertCentipedeChains.get(deadMob.chainId);
  if(!chain) return;
  const idx=chain.mobs.indexOf(deadMob);
  if(idx===-1) return;
  chain.mobs.splice(idx,1);

  if(chain.mobs.length===0){
    desertCentipedeChains.delete(deadMob.chainId);
    triggerZoneDeath(deadMob);
    const st=zoneStates[deadMob.homeZoneId];
    if(st) st.desertCentipedeCount=Math.max(0,(st.desertCentipedeCount||1)-1);
    return;
  }

  if(idx===0){
    const newHead=chain.mobs[0];
    newHead.isDesertCentipede=true;
    newHead.alerted=chain.alerted;
    newHead.segIndex=0;
    newHead.aggroRange=MOB_DEFS.desert_centipede_head.aggroRange;
    for(let i=1;i<chain.mobs.length;i++) chain.mobs[i].segIndex=i;
    const state=zoneStates[deadMob.homeZoneId];
    if(state){ state.mobIds.delete(deadMob.id); state.mobIds.add(newHead.id); }
  } else if(idx<chain.mobs.length){
    const rightMobs=chain.mobs.splice(idx);
    if(rightMobs.length>0){
      const newChainId=nextChainId++;
      const newHead=rightMobs[0];
      newHead.isDesertCentipede=true;
      newHead.alerted=chain.alerted;
      newHead.segIndex=0;
      newHead.aggroRange=MOB_DEFS.desert_centipede_head.aggroRange;
      for(let i=0;i<rightMobs.length;i++){
        rightMobs[i].segIndex=i;
        rightMobs[i].typeId='desert_centipede_body';
        rightMobs[i].isDesertCentipede=true;
      }
      const newChain={id:newChainId,mobs:rightMobs,alerted:chain.alerted};
      desertCentipedeChains.set(newChainId,newChain);
      for(const m of rightMobs) m.chainId=newChainId;
      const state=zoneStates[newHead.homeZoneId];
      if(state){ state.mobIds.add(newHead.id); state.desertCentipedeCount=(state.desertCentipedeCount||1)+1; }
      for(let i=0;i<chain.mobs.length;i++) chain.mobs[i].segIndex=i;
    }
  }
}

function onMobDied(mob) {
  // Notify wave manager so it can clear tracked mob IDs
  if (isWaveMapMode()) onWaveMobDied(mob.id);

  // ── Sea cave death wave: always spawns one jellyfish, one crab, and one
  // debris right where it died, plus the same 12% bonus-mob roll used by
  // its periodic every-15%-HP-lost wave (see spawnSeaCaveDeathWave). This
  // is a separate, one-time event from that periodic wave — dying doesn't
  // ALSO trigger the 100%-HP-lost periodic wave, since sea cave's HP-
  // threshold tracking only fires from the per-frame HP check further
  // down, and a mob that just died is removed before that check runs again.
  if (mob.typeId === 'sea_cave') {
    spawnSeaCaveDeathWave(mob.x, mob.y, mob.homeZoneId, rarityTier(mob.rarity));
  }

  // ── Bubble pop: pushes the player and any nearby friendly pets outward from
  // where it died. Push distance is derived from the bubble's own mass (i.e.
  // its rarity tier — a max-rarity bubble gives a noticeably strong shove,
  // scaled up 4x from an earlier pass, but linear-with-tier stays well clear
  // of a map-spanning launch (max push below is 1200 of the map's 6000-unit
  // width — 20%, still short of "a quarter of the map"). Player uses the
  // existing knockback velocity system (vx/vy + a dedicated cap, see
  // BUBBLE_MAX_KB below); pets have no velocity system at all, so they get a
  // direct one-time position nudge instead, clamped to valid ground via
  // canMoveTo exactly like every other mob repositioning in this file.
  if (mob.typeId === 'bubble') {
    const BLAST_RADIUS = (mob.drawRadius ?? mob.radius ?? 16) * 5; // scales mildly with the bubble's own size
    // Push distance follows a piecewise curve anchored at specific rarities
    // (see bubblePushDistanceForTier) rather than one flat linear scale —
    // subtle through Epic, noticeable jumps into Legendary and Mythic, a much
    // bigger jump into Ultra, then a steady decent climb from Super to Umbral
    // and a final decent bump into Impracticality. Tops out at 1350 units —
    // 22.5% of the 6000-unit map width, still short of "a quarter of the map."
    const tier = rarityTier(mob.rarity);
    const pushDist = bubblePushDistanceForTier(tier);

    const pdx = player.x - mob.x, pdy = player.y - mob.y, pdist = Math.hypot(pdx, pdy);
    if (!player.dead && pdist < BLAST_RADIUS && pdist > 0.001) {
      const nx = pdx / pdist, ny = pdy / pdist;
      // Convert the target push distance into a velocity impulse. pushDist
      // above (150-1350) is calibrated for the PET position-nudge below,
      // which is a direct one-time displacement in world units — safe at
      // that scale relative to the 6000-unit map. Applying that same
      // magnitude directly as PLAYER VELOCITY was a real bug (fixed here):
      // player.speed is only ~4.2/frame, so even the lowest tier's old
      // impulse was ~20x normal movement speed in one frame. Rescaled to a
      // sane range instead (~6 at Common up to ~55 at Impracticality,
      // matching the player's own movement scale and the rest of the
      // game's existing knockback magnitudes).
      const PLAYER_PUSH_LO = 6, PLAYER_PUSH_HI = 55;
      const CURVE_LO = 150, CURVE_HI = 1350; // bubblePushDistanceForTier's own range
      const curveNorm = Math.max(0, Math.min(1, (pushDist - CURVE_LO) / (CURVE_HI - CURVE_LO)));
      const impulse = PLAYER_PUSH_LO + curveNorm * (PLAYER_PUSH_HI - PLAYER_PUSH_LO);
      // Second real bug, also fixed here: a plain player.vx += only ADDS to
      // whatever velocity the player already has. If they were already
      // moving opposite the push (very plausible — e.g. still carrying
      // knockback velocity from something else, up to 14-16 elsewhere in
      // this game), the add could partially or fully cancel out, so the pop
      // sometimes did nothing at low tiers where the impulse was smaller
      // than realistic opposing velocity. Fixed by first stripping out any
      // velocity component that opposes the push direction (parallel
      // component only — perpendicular motion is left untouched, so it
      // still feels like a knockback and not a hard velocity override),
      // THEN adding the full impulse — guaranteeing the pop always applies
      // its full intended strength regardless of what the player was doing.
      const parallel = player.vx * nx + player.vy * ny;
      if (parallel < 0) { player.vx -= parallel * nx; player.vy -= parallel * ny; }
      player.vx += nx * impulse;
      player.vy += ny * impulse;
      const BUBBLE_MAX_KB = 58; // just above the true max (55) — a safety ceiling, not an active clamp
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > BUBBLE_MAX_KB) { player.vx = (player.vx / speed) * BUBBLE_MAX_KB; player.vy = (player.vy / speed) * BUBBLE_MAX_KB; }
    }
    for (const pet of mobs) {
      if (pet.dead || !pet.isFriendlyPet) continue;
      const dx = pet.x - mob.x, dy = pet.y - mob.y, dist = Math.hypot(dx, dy);
      if (dist >= BLAST_RADIUS || dist <= 0.001) continue;
      const nx = dx / dist, ny = dy / dist;
      const nxPos = pet.x + nx * pushDist, nyPos = pet.y + ny * pushDist;
      if (canMoveTo(nxPos, nyPos, pet.radius)) { pet.x = nxPos; pet.y = nyPos; }
      else if (canMoveTo(nxPos, pet.y, pet.radius)) { pet.x = nxPos; }
      else if (canMoveTo(pet.x, nyPos, pet.radius)) { pet.y = nyPos; }
    }
  }

  // ── Boss baby ant death → spawns 1 queen ant at one tier lower ─────────────
  if(mob.typeId === 'baby_ant' && mob.isBoss){
    const zid = mob.homeZoneId ?? -1;
    const t   = Math.max(0, (mob.tier ?? 0) - 1);
    const q = spawnAntMinion('queen_ant', mob.x, mob.y, mob.x, mob.y, zid, t);
    if(q && isWaveMapMode()){ q.waveTarget = 'npc'; q.alerted = true; addTrackedMob(q.id); }
  }

  // Kill any orbiting stingers belonging to this boss (bee and cactus both use bossStingers)
  if (mob.isBoss && (mob.typeId === 'bee' || mob.typeId === 'cactus')) {
    for (const s of bossStingers) { if (s.ownerId === mob.id) s.dead = true; }
  }
  // Kill any roses belonging to this ladybug boss
  if (mob.isBoss && mob.typeId === 'ladybug') {
    for (const r of bossRoses) { if (r.ownerId === mob.id) r.dead = true; }
  }
  // Kill queen bee eggs and pollen orbits belonging to this queen bee boss
  if (mob.isBoss && mob.typeId === 'queen_bee') {
    for (const e of queenBeeEggs) { if (e.ownerId === mob.id) e.dead = true; }
    for (const p of queenBeePollenOrbit) { if (p.ownerId === mob.id) p.dead = true; }
  }

  if(mob.homeZoneId==null) return;
  if(mob.isCentipede){ handleCentipedeSegmentDeath(mob); return; }
  if(mob.isDesertCentipede){ handleDesertCentipedeSegmentDeath(mob); return; }
  // Ant minions not tracked by zone cap — no zone bookkeeping needed
  if(mob.isZoneTracked===false) return;

  // ── Ant hole death wave — fire regardless of zone state (covers wave mode) ──
  if(mob.isAntHole){
    // Death wave: different for boss and normal holes.
    // Boss holes killed via interior victory skip the death wave (the interior fight IS the event).
    const zid = mob.homeZoneId;
    if(mob.isBoss){
      if(!mob.clearedByInterior){
        // Killed externally: spawn boss queen + boss soldier as a death wave
        const bq=spawnAntMinion('queen_ant',  mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        const bs=spawnAntMinion('soldier_ant',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(bq){ _applyBossStatsToMob(bq); if(isWaveMapMode()){ bq.waveTarget='npc'; bq.alerted=true; addTrackedMob(bq.id); } }
        if(bs){ _applyBossStatsToMob(bs); if(isWaveMapMode()){ bs.waveTarget='npc'; bs.alerted=true; addTrackedMob(bs.id); } }
        if(Math.random()<0.15) spawnAntMinion('digger',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
      }
    } else {
      // Normal ant hole death wave: 3 soldiers, 3 workers, 1 queen, 15% digger
      for(let i=0;i<3;i++){
        const ds=spawnAntMinion('soldier_ant',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(ds&&isWaveMapMode()){ ds.waveTarget='npc'; ds.alerted=true; addTrackedMob(ds.id); }
      }
      for(let i=0;i<3;i++){
        const dw=spawnAntMinion('worker_ant',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(dw&&isWaveMapMode()){ dw.waveTarget='npc'; dw.alerted=true; addTrackedMob(dw.id); }
      }
      const dq=spawnAntMinion('queen_ant',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
      if(dq&&isWaveMapMode()){ dq.waveTarget='npc'; dq.alerted=true; addTrackedMob(dq.id); }
      if(Math.random()<0.15) spawnAntMinion('digger',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
    }
    // Zone bookkeeping (only when zone state exists)
    const state=zoneStates[zid];
    if(state){
      state.mobIds.delete(mob.id);
      state.antHoleCount=Math.max(0,(state.antHoleCount||1)-1);
      state.deaths++;
      if(state.deaths>=getDeathTrigger(zid)&&!state.spawning){
        state.spawning=true; state.spawnAccum=0; state.deaths=0;
      }
    }
    return;
  }
  // ── Fire Ant Hole death wave ───────────────────────────────────────────────
  if (mob.isFireAntHole) {
    const zid = mob.homeZoneId;
    // Death wave: 3 fire soldiers, 3 fire workers, 1 fire queen
    for (let i = 0; i < 3; i++) {
      const ds = spawnFireAntMinion('fire_soldier_ant', mob.x, mob.y, mob.x, mob.y, zid, mob.tier);
      if (ds && isWaveMapMode()) { ds.waveTarget = 'npc'; ds.alerted = true; addTrackedMob(ds.id); }
    }
    for (let i = 0; i < 3; i++) {
      const dw = spawnFireAntMinion('fire_worker_ant', mob.x, mob.y, mob.x, mob.y, zid, mob.tier);
      if (dw && isWaveMapMode()) { dw.waveTarget = 'npc'; dw.alerted = true; addTrackedMob(dw.id); }
    }
    const dq = spawnFireAntMinion('fire_queen_ant', mob.x, mob.y, mob.x, mob.y, zid, mob.tier);
    if (dq && isWaveMapMode()) { dq.waveTarget = 'npc'; dq.alerted = true; addTrackedMob(dq.id); }
    // Zone bookkeeping
    const state = zoneStates[zid];
    if (state) {
      state.mobIds.delete(mob.id);
      state.fireAntHoleCount = Math.max(0, (state.fireAntHoleCount || 1) - 1);
      state.deaths++;
      if (state.deaths >= getDeathTrigger(zid) && !state.spawning) {
        state.spawning = true; state.spawnAccum = 0; state.deaths = 0;
      }
    }
    return;
  }
  // ── Beehive death swarm — fire regardless of zone state (covers wave mode) ──
  if(mob.isBeehive){
    const zid = mob.homeZoneId;
    if(mob.isBoss) {
      // Boss beehive death: spawn 1 boss queen bee at same tier
      const bossQueenBee = spawnAntMinion('queen_bee',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
      if(bossQueenBee) _applyBossStatsToMob(bossQueenBee);
      // Add to wave tracking if in wave mode
      if(isWaveMapMode() && bossQueenBee) {
        bossQueenBee.waveTarget = 'npc'; bossQueenBee.alerted = true; addTrackedMob(bossQueenBee.id);
      }
      // 5% chance for boss beekeeper like normal hive
      if(Math.random()<0.05) {
        const bossBeekeeper = spawnAntMinion('beekeeper',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(bossBeekeeper) _applyBossStatsToMob(bossBeekeeper);
        // Add to wave tracking if in wave mode
        if(isWaveMapMode() && bossBeekeeper) {
          bossBeekeeper.waveTarget = 'npc'; bossBeekeeper.alerted = true; addTrackedMob(bossBeekeeper.id);
        }
      }
    } else {
      // Normal beehive death swarm: 3 bees, 2 hornets, 1 queen bee, 5% chance for beekeeper
      for(let i=0;i<3;i++){
        const db=spawnAntMinion('bee',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(db&&isWaveMapMode()){ db.waveTarget='npc'; db.alerted=true; addTrackedMob(db.id); }
      }
      for(let i=0;i<2;i++){
        const dh=spawnAntMinion('hornet',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(dh&&isWaveMapMode()){ dh.waveTarget='npc'; dh.alerted=true; addTrackedMob(dh.id); }
      }
      const dqb=spawnAntMinion('queen_bee',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
      if(dqb&&isWaveMapMode()){ dqb.waveTarget='npc'; dqb.alerted=true; addTrackedMob(dqb.id); }
      if(Math.random()<0.05){
        const dbk=spawnAntMinion('beekeeper',mob.x,mob.y,mob.x,mob.y,zid,mob.tier);
        if(dbk&&isWaveMapMode()){ dbk.waveTarget='npc'; dbk.alerted=true; addTrackedMob(dbk.id); }
      }
    }
    // Zone bookkeeping (only when zone state exists)
    const state=zoneStates[zid];
    if(state){
      state.mobIds.delete(mob.id);
      state.beehiveCount=Math.max(0,(state.beehiveCount||1)-1);
      state.deaths++;
      if(state.deaths>=getDeathTrigger(zid)&&!state.spawning){
        state.spawning=true; state.spawnAccum=0; state.deaths=0;
      }
    }
    return;
  }

  const state=zoneStates[mob.homeZoneId];
  // Wave mobs have homeZoneId=-1 and no zone state — skip zone bookkeeping
  if(!state) return;
  state.mobIds.delete(mob.id);
  state.deaths++;
  if(state.deaths>=getDeathTrigger(mob.homeZoneId)&&!state.spawning){
    state.spawning=true; state.spawnAccum=0; state.deaths=0;
  }
}

// ── Friendly ant pet spawner (called by petals.js ant egg logic) ──────────────
// Hand-tuned leash distances per tier — Common-Legendary stay tight (900),
// Mythical+ opens up without the ring going off-screen.
const PET_LEASH_BY_TIER = [900,900,900,900,900,1500,2500,3500,4200,5000,6500,7000,7000,7000];
export function getPetLeashDist(tier) {
  return PET_LEASH_BY_TIER[Math.max(0,Math.min(13,tier??0))];
}

/**
 * Apply boss stat multipliers to every body segment in the centipede chain whose
 * head has the given id.  The head itself is already patched by bossManager, so
 * we skip it here to avoid double-scaling.
 */
export function applyBossStatsToCentipedeChain(headId) {
  const head = mobs.find(m => m.id === headId);
  if (!head || head.chainId == null) return; // chainId can legitimately be 0 — check for null/undefined, not falsy
  const chain = centipedeChains.get(head.chainId);
  if (!chain) return;
  for (const seg of chain.mobs) {
    if (seg.id === headId) continue; // head already patched by bossManager — skip to avoid double-scaling
    _applyBossStatsToMob(seg);
  }
}

export function applyBossStatsToDesertCentipedeChain(headId) {
  const head = mobs.find(m => m.id === headId);
  if (!head || head.chainId == null) return; // chainId can legitimately be 0 — check for null/undefined, not falsy
  const chain = desertCentipedeChains.get(head.chainId);
  if (!chain) return;
  for (const seg of chain.mobs) {
    if (seg.id === headId) continue; // head already patched by bossManager — skip to avoid double-scaling
    _applyBossStatsToMob(seg);
  }
}

// ── Chat-command spawn helper ───────────────────────────────────────────────
/**
 * Spawns a mob near a given point (used by the /spawn chat command).
 * Handles centipede chains and optional boss stat scaling, mirroring the
 * logic spawnWaveMob uses for wave mode, but works in any mode and doesn't
 * require the wave map spawn-finder.
 *
 * @param {string} typeId   - key into MOB_DEFS (underscored form, e.g. 'baby_ant')
 * @param {number} tier     - rarity tier index (0-13)
 * @param {boolean} isBoss  - apply boss stat multipliers
 * @param {number} nearX    - world x to spawn around
 * @param {number} nearY    - world y to spawn around
 * @returns {number|null} the id of the spawned mob (head, for centipedes), or null if the typeId is invalid
 */
export function spawnMobByCommand(typeId, tier, isBoss, nearX, nearY) {
  const def = MOB_DEFS[typeId];
  if (!def) return null;

  // Find a nearby open spot so the mob doesn't spawn stacked on top of the player.
  let pos = null;
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 60 + Math.random() * 120;
    const tx = nearX + Math.cos(angle) * dist;
    const ty = nearY + Math.sin(angle) * dist;
    if (canMoveTo(tx, ty, def.radius)) { pos = { x: tx, y: ty }; break; }
  }
  if (!pos) pos = { x: nearX, y: nearY };

  // Use the real zone at the spawn position, not -1 — homeZoneId=-1 reads as
  // zone tier 99 in the despawn check (getZoneTier's "unknown" fallback), so
  // a command-spawned mob would get marked dead on the very next tick unless
  // the player happened to be standing in an actual tier-99 zone.
  const zoneId = getZoneId(pos.x, pos.y);

  if (typeId === 'centipede_head') {
    const head = spawnCentipede(pos.x, pos.y, zoneId, tier, isBoss);
    if (!head) return null;
    head.alerted = true;
    const chain = centipedeChains.get(head.chainId);
    if (chain) chain.alerted = true;
    if (isBoss) {
      _applyBossStatsToMob(head);
      applyBossStatsToCentipedeChain(head.id);
    }
    return head.id;
  }

  if (typeId === 'desert_centipede_head') {
    const head = spawnDesertCentipede(pos.x, pos.y, zoneId, tier);
    if (!head) return null;
    head.alerted = true;
    const chain = desertCentipedeChains.get(head.chainId);
    if (chain) chain.alerted = true;
    if (isBoss) {
      _applyBossStatsToMob(head);
      for (const seg of chain.mobs) { if (seg.id !== head.id) _applyBossStatsToMob(seg); }
    }
    return head.id;
  }

  const mob = spawnMob(typeId, pos.x, pos.y, zoneId, tier);
  mob.alerted = true;

  if (typeId === 'ant_hole') spawnAntHoleMinions(pos.x, pos.y, zoneId, tier, isBoss);
  if (typeId === 'beehive' && !isBoss) {
    for (let i = 0; i < 2; i++) spawnAntMinion('bee', pos.x, pos.y, pos.x, pos.y, zoneId, tier);
  }
  if (typeId === 'beehive' && isBoss) {
    const bossBee    = spawnAntMinion('bee', pos.x, pos.y, pos.x, pos.y, zoneId, tier);
    const bossHornet = spawnAntMinion('hornet', pos.x, pos.y, pos.x, pos.y, zoneId, tier);
    if (bossBee)    _applyBossStatsToMob(bossBee);
    if (bossHornet) _applyBossStatsToMob(bossHornet);
  }

  if (isBoss) _applyBossStatsToMob(mob);

  return mob.id;
}

// Called by combat.js when a centipede segment takes damage — immediately alerts
// the whole chain so the propagation doesn't have to wait until next tick.
export function alertChainByMob(mob) {
  if (!mob.chainId) return;
  const chain = centipedeChains.get(mob.chainId) || desertCentipedeChains.get(mob.chainId);
  if (!chain || chain.alerted) return;
  chain.alerted = true;
  for (const m of chain.mobs) { m.alerted = true; }
}

const MAX_FRIENDLY_PETS = 20;
function countLivingPets() {
  return mobs.filter(m => !m.dead && m.isFriendlyPet).length;
}
function countLivingPetsOfType(typeId) {
  return mobs.filter(m => !m.dead && m.isFriendlyPet && m.typeId === typeId).length;
}

// ── Boss ant hole player-collision detection ──────────────────────────────────
/**
 * Returns the living boss ant_hole mob whose hitbox overlaps the given circle,
 * or null if none. Used to trigger the "enter sub-map" teleport.
 */
export function getBossAntHoleAtPoint(px, py, pr) {
  for (const mob of mobs) {
    if (mob.dead || !mob.isBoss || mob.typeId !== 'ant_hole') continue;
    const dx = px - mob.x, dy = py - mob.y;
    if (Math.hypot(dx, dy) < pr + mob.radius) return mob;
  }
  return null;
}

// ── Interior mob spawning (ant hole sub-map) ──────────────────────────────────
/**
 * Spawns the interior mobs for the boss ant hole sub-map.
 * All mobs are placed randomly inside the sub-map at ANT_HOLE_OFFSET coords.
 * Returns an array of mob IDs for the caller to track.
 * @param {number} tier - mob tier matching the boss ant hole
 * @returns {number[]} array of spawned mob IDs
 */
export function spawnAntHoleInteriorMobs(tier, playerSpawnX, playerSpawnY) {
  const { cx, cy, r: arenaR } = getAntHoleCircleCenter();
  const ids = [];
  // Keep mobs this far from the player's entry point so they don't insta-contact
  const PLAYER_CLEAR = 250;

  /** Place a mob at a random interior position inside the circular arena. */
  function _placeInteriorMob(typeId, isDigger = false) {
    const margin = 80;
    const safeR = arenaR - margin;
    let x = cx, y = cy;
    let placed = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * safeR;
      const cx2 = cx + Math.cos(angle) * dist;
      const cy2 = cy + Math.sin(angle) * dist;
      if (playerSpawnX !== undefined &&
          Math.hypot(cx2 - playerSpawnX, cy2 - playerSpawnY) < PLAYER_CLEAR) continue;
      x = cx2; y = cy2; placed = true; break;
    }
    if (!placed) {
      // Fallback: place on the far side of the arena from the player
      const awayAngle = playerSpawnX !== undefined
        ? Math.atan2(cy - playerSpawnY, cx - playerSpawnX)
        : Math.random() * Math.PI * 2;
      x = cx + Math.cos(awayAngle) * safeR * 0.8;
      y = cy + Math.sin(awayAngle) * safeR * 0.8;
    }
    const m = spawnAntMinion(typeId, x, y, x, y, -1, tier);
    if (!m) return;
    if (!isDigger) {
      _applyBossStatsToMob(m);
      // Target player (not NPC — NPC is far away in overworld)
      m.waveTarget = 'player';
      m.alerted    = true;
      ids.push(m.id);
    }
    // Diggers stay friendly — no boss stats, no id tracking
  }

  // 6 boss soldier ants
  for (let i = 0; i < 6; i++) _placeInteriorMob('soldier_ant');
  // 3 boss worker ants
  for (let i = 0; i < 3; i++) _placeInteriorMob('worker_ant');
  // 1 boss queen ant
  _placeInteriorMob('queen_ant');
  // 1 boss baby ant
  _placeInteriorMob('baby_ant');
  // 15% chance for a friendly digger inside
  if (Math.random() < 0.15) _placeInteriorMob('digger', true);

  return ids;
}

export function spawnFriendlyAntPet(tier, x, y, slotIdx, pieceIdx) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  const zoneId = getZoneId(x, y);  // use the actual zone the player is in, not hardcoded 0
  const mob = spawnMob('soldier_ant', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  return mob;
}

export function spawnFriendlyBeePet(tier, x, y, slotIdx, pieceIdx) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  const zoneId = getZoneId(x, y);
  const mob = spawnMob('bee', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  return mob;
}

export function spawnFriendlyBeetlePet(tier, x, y, slotIdx, pieceIdx) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  const zoneId = getZoneId(x, y);
  const mob = spawnMob('beetle', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  return mob;
}

export function spawnFriendlyJellyfishPet(tier, x, y, slotIdx, pieceIdx) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  const zoneId = getZoneId(x, y);
  const mob = spawnMob('jellyfish', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  return mob;
}

export function spawnFriendlyDiggerPet(tier, x, y, slotIdx, pieceIdx, bodyColor) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  const zoneId = getZoneId(x, y);
  const mob = spawnMob('digger', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  mob.bodyColor            = bodyColor;  // player's inner color
  return mob;
}

const STICK_MAX_SANDSTORM_PETS = 9; // overall safety ceiling across every Stick combined — per-Stick cap of 3 is enforced in petals.js
export function spawnFriendlySandstormPet(tier, x, y, slotIdx, pieceIdx) {
  if (countLivingPets() >= MAX_FRIENDLY_PETS) return null;
  if (countLivingPetsOfType('sandstorm') >= STICK_MAX_SANDSTORM_PETS) return null;
  const zoneId = getZoneId(x, y);
  const mob = spawnMob('sandstorm', x, y, zoneId, tier);
  mob.isFriendlyPet        = true;
  mob.isZoneTracked        = false;
  mob.linkedPieceSlotIdx   = slotIdx;
  mob.linkedPieceIdx       = pieceIdx;
  mob.homeX                = undefined;
  mob.homeY                = undefined;
  mob.border               = '#22cc55';  // green border — visually friendly
  return mob;
}

export function initMobs(playerX,playerY) {
  mobs.length=0; missiles.length=0; bossStingers.length=0; bossPeas.length=0; bossRoses.length=0; queenBeeEggs.length=0; queenBeePollenOrbit.length=0; centipedeChains.clear(); desertCentipedeChains.clear(); nextMobId=0; nextChainId=0; _bossStingerNextId=0;
  for(const state of zoneStates){
    state.mobIds.clear(); state.deaths=0; state.spawning=false;
    state.spawnAccum=0; state.checkTimer=ZONE_CHECK_INTERVAL; state.centipedeCount=0; state.antHoleCount=0; state.beehiveCount=0; state.fireAntHoleCount=0;
    state.activated=false;
  }
  // Zones start empty — they activate and fill when a player first enters them
}

// ── Wave-mode mob spawning ────────────────────────────────────────────────────
/**
 * Spawn a mob for wave mode.  Returns the mob's id (for tracking) or null.
 * @param {string}  typeId      - mob type key
 * @param {number}  tier        - RARITIES index (0=Common … 13=Impracticality)
 * @param {boolean} isStructure - if true, allows ant_hole / beehive
 */
export function spawnWaveMob(typeId, tier, isStructure, spawnAtCenter = false) {
  const def = MOB_DEFS[typeId];
  if (!def) return null;

  let pos;
  if (spawnAtCenter) {
    pos = { x: getWaveMapW() / 2, y: getWaveMapH() / 2 };
  } else {
    pos = findWaveMobSpawn(def.radius, mobs);
  }
  if (!pos) return null;

  // Centipede: spawn the full chain
  if (typeId === 'centipede_head') {
    const head = spawnCentipede(pos.x, pos.y, -1, tier, !!spawnAtCenter); // homeZoneId = -1 (wave, no zone); boss if spawnAtCenter
    if (head) {
      head.waveTarget = 'npc';
      if (!spawnAtCenter) {
        // Pre-alert normal mobs so they march; bosses start unalerted (aggro naturally)
        head.alerted = true;
        const chain = centipedeChains.get(head.chainId);
        if (chain) { chain.alerted = true; for (const m of chain.mobs) m.alerted = true; }
      }
      return head.id;
    }
    return null;
  }

  // Desert centipede: spawn the full chain (wanders, turns toward target when nearby)
  if (typeId === 'desert_centipede_head') {
    const head = spawnDesertCentipede(pos.x, pos.y, -1, tier);
    if (head) {
      head.waveTarget = 'npc';
      if (!spawnAtCenter) {
        // Pre-alert normal mobs so they drift toward the NPC; bosses start
        // unalerted and aggro naturally, same as every other boss type.
        head.alerted = true;
        const chain = desertCentipedeChains.get(head.chainId);
        if (chain) { chain.alerted = true; for (const m of chain.mobs) m.alerted = true; }
      }
      return head.id;
    }
    return null;
  }

  const mob = spawnMob(typeId, pos.x, pos.y, -1, tier);
  mob.waveTarget = 'npc';
  if (!spawnAtCenter && typeId !== 'cactus' && typeId !== 'shell') {
    mob.alerted = true; // Pre-alert normal mobs: march toward NPC immediately
  }
  // Boss (spawnAtCenter=true) starts un-alerted — aggros naturally when player/NPC gets close
  // Cactus and shell are static-until-hit — never pre-alerted, they just sit there

  // Ant hole — also spawn initial minions but they DON'T count toward wave total
  if (typeId === 'ant_hole') spawnAntHoleMinions(pos.x, pos.y, -1, tier, !!mob.isBoss);
  // Beehive — spawn 2 guard bees (not wave-counted), but NOT for boss beehives
  if (typeId === 'beehive' && !mob.isBoss) {
    for (let i = 0; i < 2; i++) spawnAntMinion('bee', pos.x, pos.y, pos.x, pos.y, -1, tier);
  }
  // Boss beehive — spawn 1 boss bee and 1 boss hornet at same tier
  if (typeId === 'beehive' && mob.isBoss) {
    const bossBee = spawnAntMinion('bee', pos.x, pos.y, pos.x, pos.y, -1, tier);
    const bossHornet = spawnAntMinion('hornet', pos.x, pos.y, pos.x, pos.y, -1, tier);
    if (bossBee) _applyBossStatsToMob(bossBee);
    if (bossHornet) _applyBossStatsToMob(bossHornet);
    // Add to wave tracking if in wave mode
    if (isWaveMapMode()) {
      if (bossBee) { bossBee.waveTarget = 'npc'; bossBee.alerted = true; addTrackedMob(bossBee.id); }
      if (bossHornet) { bossHornet.waveTarget = 'npc'; bossHornet.alerted = true; addTrackedMob(bossHornet.id); }
    }
  }

  return mob.id;
}

function trySpawnInZone(zoneId,playerX,playerY) {
  const cfg=ZONE_CONFIG[zoneId];
  if(!cfg||cfg.rarity===null) return false;
  const targetRar=pickSpawnRarity(cfg.tier,RARITIES);
  const targetTier=RARITIES.indexOf(targetRar);

  const CENTI_MAX_PER_ZONE = 4;
  const ANT_HOLE_MAX_PER_ZONE = 1;
  const BEEHIVE_MAX_PER_ZONE = 1;
  const roll=Math.random();

  if(roll<0.08){
    // Ant hole spawn
    const state=zoneStates[zoneId];
    if((state?.antHoleCount||0)>=ANT_HOLE_MAX_PER_ZONE) return false;
    const pos=findSpawnInZone(zoneId,60,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const hole=spawnMob('ant_hole',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(hole.id);
    zoneStates[zoneId].antHoleCount=(zoneStates[zoneId].antHoleCount||0)+1;
    spawnAntHoleMinions(pos.x,pos.y,zoneId,targetTier);
    return true;
  }

  if(roll<0.15){
    // Beehive spawn
    const state=zoneStates[zoneId];
    if((state?.beehiveCount||0)>=BEEHIVE_MAX_PER_ZONE) return false;
    const pos=findSpawnInZone(zoneId,80,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const hive=spawnMob('beehive',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(hive.id);
    zoneStates[zoneId].beehiveCount=(zoneStates[zoneId].beehiveCount||0)+1;
    // Spawn 2 bees as initial guards, but NOT for boss beehives
    if(!hive.isBoss) {
      for(let i=0;i<2;i++) spawnAntMinion('bee',pos.x,pos.y,pos.x,pos.y,zoneId,targetTier);
    }
    return true;
  }

  if(roll<0.28){
    const state=zoneStates[zoneId];
    if((state?.centipedeCount||0)>=CENTI_MAX_PER_ZONE) return false;
    // Use a large clearance so the full chain tail doesn't land on another mob
    const pos=findSpawnInZone(zoneId,500,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    spawnCentipede(pos.x,pos.y,zoneId,targetTier);
    return true;
  }

  if(roll<0.36){
    // Desert centipede chain
    const DESERT_CENTI_MAX = 4;
    const state=zoneStates[zoneId];
    if((state?.desertCentipedeCount||0)>=DESERT_CENTI_MAX) return false;
    const pos=findSpawnInZone(zoneId,500,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    spawnDesertCentipede(pos.x,pos.y,zoneId,targetTier);
    if(state) state.desertCentipedeCount=(state.desertCentipedeCount||0)+1;
    return true;
  }

  if(roll<0.42){
    // Cactus
    const CACTUS_MAX = 3;
    const state=zoneStates[zoneId];
    if((state?.cactusCount||0)>=CACTUS_MAX) return false;
    const pos=findSpawnInZone(zoneId,50,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const cactus=spawnMob('cactus',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(cactus.id);
    if(state) state.cactusCount=(state.cactusCount||0)+1;
    return true;
  }

  if(roll<0.46){
    // Rock — static garden structure
    const ROCK_MAX = 3;
    const state=zoneStates[zoneId];
    if((state?.rockCount||0)>=ROCK_MAX) return false;
    const pos=findSpawnInZone(zoneId,40,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const rock=spawnMob('rock',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(rock.id);
    if(state) state.rockCount=(state.rockCount||0)+1;
    return true;
  }

  if(roll<0.50){
    // Dandelion — static garden structure
    const DANDELION_MAX = 3;
    const state=zoneStates[zoneId];
    if((state?.dandelionCount||0)>=DANDELION_MAX) return false;
    const pos=findSpawnInZone(zoneId,40,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const dandelion=spawnMob('dandelion',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(dandelion.id);
    if(state) state.dandelionCount=(state.dandelionCount||0)+1;
    return true;
  }

  if(roll<0.54){
    // Fire ant hole — desert colony
    const FIRE_ANT_HOLE_MAX = 1;
    const state=zoneStates[zoneId];
    if((state?.fireAntHoleCount||0)>=FIRE_ANT_HOLE_MAX) return false;
    const pos=findSpawnInZone(zoneId,60,playerX,playerY,mobs,MOB_SAFE_RADIUS);
    if(!pos) return false;
    const hole=spawnMob('fire_ant_hole',pos.x,pos.y,zoneId,targetTier);
    zoneStates[zoneId].mobIds.add(hole.id);
    zoneStates[zoneId].fireAntHoleCount=(zoneStates[zoneId].fireAntHoleCount||0)+1;
    spawnFireAntHoleMinions(pos.x,pos.y,zoneId,targetTier);
    return true;
  }

  const typeId=getRandomMobType(), def=MOB_DEFS[typeId];
  // skip chain-mob typeIds from random — handled above
  if(typeId==='desert_centipede_head'||typeId==='cactus') return false;
  const pos=findSpawnInZone(zoneId,def.radius,playerX,playerY,mobs,MOB_SAFE_RADIUS);
  if(!pos) return false;
  const mob=spawnMob(typeId,pos.x,pos.y,zoneId,targetTier);
  zoneStates[zoneId].mobIds.add(mob.id);
  return true;
}

function updateZoneSpawning(dt,playerX,playerY) {
  for(const state of zoneStates){
    // Activate zone the first time a player enters it
    if(!state.activated){
      const b=getZoneBounds(state.zoneId);
      if(playerX>=b.x0&&playerX<=b.x1&&playerY>=b.y0&&playerY<=b.y1){
        state.activated=true;
        state.spawning=true; state.spawnAccum=0;
      } else {
        continue; // zone not yet visited — skip entirely
      }
    }
    const zoneMax=getZoneMobMax(state.zoneId);
    state.checkTimer-=dt;
    if(state.checkTimer<=0){
      state.checkTimer=ZONE_CHECK_INTERVAL;
      if(state.mobIds.size<zoneMax&&!state.spawning){ state.spawning=true; state.spawnAccum=0; }
    }
    if(!state.spawning) continue;
    state.spawnAccum+=dt;
    while(state.spawnAccum>=SPAWN_DRIP_INTERVAL){
      state.spawnAccum-=SPAWN_DRIP_INTERVAL;
      if(state.mobIds.size>=zoneMax){ state.spawning=false; state.deaths=0; break; }
      trySpawnInZone(state.zoneId,playerX,playerY);
    }
  }
}

export function updateMobs(dt,playerX,playerY) {
  const AI_CULL_DIST=9000;

  // ── Push mobs out of walls ────────────────────────────────────────────────
  // Any mob whose center is inside a wall gets nudged outward so it can move again.
  for (const mob of mobs) {
    if (mob.dead) continue;
    if (!canMoveTo(mob.x, mob.y, mob.radius)) {
      if (isWaveMapMode()) {
        // Wave map: directly clamp to valid area — instant teleport out of walls.
        // The radial nudge (max step 80) fails for mobs spawned far outside bounds.
        const W = getWaveMapW(), H = getWaveMapH(), r = mob.radius;
        mob.x = Math.max(r, Math.min(W - r, mob.x));
        mob.y = Math.max(r, Math.min(H - r, mob.y));
      } else {
        // Zone map: try nudging in 16 directions to find the nearest clear spot
        let pushed = false;
        for (let step = 4; step <= 80; step += 4) {
          for (let a = 0; a < 16; a++) {
            const angle = (a / 16) * Math.PI * 2;
            const nx = mob.x + Math.cos(angle) * step;
            const ny = mob.y + Math.sin(angle) * step;
            if (canMoveTo(nx, ny, mob.radius)) {
              mob.x = nx; mob.y = ny;
              pushed = true;
              break;
            }
          }
          if (pushed) break;
        }
      }
    }
  }

  // Despawn check (skip in wave mode — no zone system)
  if (!isWaveMapMode()) {
    for(const mob of mobs){
      if(mob.dead) continue;
      if(Math.abs(getZoneTier(mob.homeZoneId)-getZoneTier(getZoneId(mob.x,mob.y)))>=2) mob.dead=true;
    }
  }

  // ── Centipede chain AI ────────────────────────────────────────────────────
  const DEAGGRO_DIST = 1200; // player must get this far away to lose aggro
  // Collect live diggers once — used by centipede AI and other mob AI loops
  const diggers = mobs.filter(m => !m.dead && (m.typeId === 'digger' || m.typeId === 'beekeeper' || m.isFriendlyPet));
  // No PET_VIEW_RADIUS cap — enemy mobs aggro to friendly pets at any distance
  for(const [,chain] of centipedeChains){
    if(chain.mobs.length===0) continue;
    // Propagate alerted state
    if(!chain.alerted&&chain.mobs.some(m=>m.alerted)){
      chain.alerted=true; for(const m of chain.mobs) m.alerted=true;
    }
    const head=chain.mobs[0];
    if(!head||head.dead) continue;

    // Pick nearest target: player, NPC (wave mode — whichever is closer), or any live digger
    let chainTargetX=playerX,chainTargetY=playerY;
    let chainBestDist=Math.hypot(playerX-head.x,playerY-head.y);

    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const pick = pickWaveTarget(head, head.x, head.y, playerX, playerY);
      chainTargetX = pick.targetX; chainTargetY = pick.targetY; chainBestDist = pick.dist;
      if (head.waveTarget !== pick.kind) {
        head.waveTarget = pick.kind;
        // Sync all segments to the same target
        const ch = centipedeChains.get(head.chainId);
        if (ch) for (const m of ch.mobs) m.waveTarget = pick.kind;
      }
    } else {
      for(const dg of diggers){const dd=Math.hypot(dg.x-head.x,dg.y-head.y);if(dd<chainBestDist){chainTargetX=dg.x;chainTargetY=dg.y;chainBestDist=dd;}}
    }

    const dx=chainTargetX-head.x, dy=chainTargetY-head.y, dist=Math.hypot(dx,dy);

    // Auto-aggro if any chain segment is within range of the target
    if(!chain.alerted){
      const aggroR=head.aggroRange||280;
      for(const seg of chain.mobs){
        if(Math.hypot(chainTargetX-seg.x,chainTargetY-seg.y)<aggroR){
          chain.alerted=true; for(const m of chain.mobs) m.alerted=true; break;
        }
      }
    }

    // De-aggro if player escapes leash distance
    const isWaveCentiNPCChase = isWaveMapMode() && head.waveTarget !== 'player';
    if(chain.alerted && dist>DEAGGRO_DIST && !isWaveCentiNPCChase){
      chain.alerted=false; for(const m of chain.mobs){ m.alerted=false; m.wanderAngle=m.facing; m.wanderTimer=800; }
    }

    if(dist<=AI_CULL_DIST){
      const chasing=chain.alerted&&dist>0.01;
      head.speed=chasing?head.alertSpeed:head.baseSpeed;
      
      // Apply web slowdown
      const slowFactorC = Math.max(getWebSlowdownFactor(head.x, head.y), getPincerSlowFactor(head.id));
      head.speed *= (1 - slowFactorC);
      
      let newX=head.x, newY=head.y;

      // Max turn per frame — prevents head from doing U-turns into its own body
      const MAX_TURN=2.7;

      if(chasing){
        let wantFacing=Math.atan2(dy,dx);
        let tdiff=wantFacing-head.facing;
        if(tdiff>Math.PI) tdiff-=Math.PI*2; if(tdiff<-Math.PI) tdiff+=Math.PI*2;
        tdiff=Math.max(-MAX_TURN,Math.min(MAX_TURN,tdiff));
        head.targetFacing=head.facing+tdiff;
        newX=head.x+Math.cos(head.targetFacing)*head.speed;
        newY=head.y+Math.sin(head.targetFacing)*head.speed;
      } else {
        head.wanderTimer-=dt;
        if(head.wanderTimer<=0){
          // New wander direction: at most 90° turn from current facing to prevent U-turns
          const turn=(Math.random()-0.5)*Math.PI*0.9;
          head.wanderAngle=head.facing+turn;
          head.wanderTimer=1200+Math.random()*2500;
        }
        head.targetFacing=head.wanderAngle;
        newX=head.x+Math.cos(head.wanderAngle)*head.speed*0.45;
        newY=head.y+Math.sin(head.wanderAngle)*head.speed*0.45;
      }
      if(canMoveTo(newX,newY,head.radius)){ head.x=newX; head.y=newY; }
      else {
        // Head hit a wall — pick a new wander direction away from it
        head.wanderAngle=head.facing+Math.PI*(0.5+Math.random());
        head.wanderTimer=600+Math.random()*800;
      }

      // Smooth head facing
      let diff=head.targetFacing-head.facing;
      if(diff>Math.PI) diff-=Math.PI*2; if(diff<-Math.PI) diff+=Math.PI*2;
      head.facing+=diff*0.08;
      const legSpeed = chasing ? 0.14 : 0.06;
      head.legPhase=(head.legPhase||0)+legSpeed;

      // Body following — segments smoothly follow their parent
      for(let i=1;i<chain.mobs.length;i++){
        const seg=chain.mobs[i], parent=chain.mobs[i-1];
        if(!seg||seg.dead||!parent||parent.dead) continue;
        const ddx=parent.x-seg.x, ddy=parent.y-seg.y, ddist=Math.hypot(ddx,ddy);
        const desired=(parent.radius+seg.radius)*1.05;
        const prevX=seg.x, prevY=seg.y;
        if(ddist>desired&&ddist>0.001){
          const excess=ddist-desired;
          const nx=ddx/ddist, ny=ddy/ddist;
          const tx=seg.x+nx*excess, ty=seg.y+ny*excess;
          // Only move if the new position is valid (not in a wall)
          if(canMoveTo(tx,ty,seg.radius)){ seg.x=tx; seg.y=ty; }
          else {
            // Try moving only on x or y axis to slide along walls
            if(canMoveTo(tx,seg.y,seg.radius)) seg.x=tx;
            else if(canMoveTo(seg.x,ty,seg.radius)) seg.y=ty;
          }
          // Smoothly rotate toward travel direction
          const wantFacing=Math.atan2(ddy,ddx);
          let fd=wantFacing-seg.facing;
          if(fd>Math.PI) fd-=Math.PI*2; if(fd<-Math.PI) fd+=Math.PI*2;
          seg.facing+=fd*0.18;
        }
        seg.targetFacing=seg.facing;
        // Only animate legs if this segment actually moved this frame
        const moved=Math.hypot(seg.x-prevX,seg.y-prevY)>0.05;
        if(moved) seg.legPhase=(seg.legPhase||0)+legSpeed;

        // Soft collision: head (i=0) and segment 1 — prevent full overlap without flinging
        if(i===1){
          const hx=head.x-seg.x, hy=head.y-seg.y, hd=Math.hypot(hx,hy);
          const minSep=head.radius+seg.radius;
          if(hd<minSep&&hd>0.001){
            // Gently push segment away from head (soft, low-strength)
            const overlap=(minSep-hd)*0.3;
            const nx=hx/hd, ny=hy/hd;
            const tx=seg.x-nx*overlap, ty=seg.y-ny*overlap;
            if(canMoveTo(tx,ty,seg.radius)){ seg.x=tx; seg.y=ty; }
          }
        }
      }
    }
  }

  // ── Centipede boss — per-segment pea shooting ─────────────────────────────
  const CENTI_PEA_INTERVAL = 7000; // ms between shots per segment (4s + 3s extra)
  const CENTI_PEA_SPEED    = 6;    // px per ms tick
  const CENTI_PEA_LIFETIME = 10000;// ms before despawn
  const CENTI_PEA_SQUISH_DUR = 180;// ms for shoot squish anim
  const CENTI_PEA_MAX      = 20;   // global cap — wait until ≤10 alive before shooting again

  for(const mob of mobs){
    if(mob.dead || !mob.isCentipede || !mob.isBoss) continue;

    // Random initial delay 1-10s before first shot
    if(mob.peaShootTimer === undefined){
      mob.peaShootTimer = 1000 + Math.random() * 9000;
      mob.peaSquishTimer = 0;
      mob.peaSquishPhase = 0; // 0=none 1=shrink 2=grow 3=done
    }
    mob.peaShootTimer -= dt;

    // Squish animation state
    if(mob.peaSquishPhase > 0){
      mob.peaSquishTimer -= dt;
      if(mob.peaSquishTimer <= 0){
        if(mob.peaSquishPhase === 1){ mob.peaSquishPhase = 2; mob.peaSquishTimer = CENTI_PEA_SQUISH_DUR; }
        else if(mob.peaSquishPhase === 2){ mob.peaSquishPhase = 3; mob.peaSquishTimer = CENTI_PEA_SQUISH_DUR; }
        else { mob.peaSquishPhase = 0; mob.drawRadius = mob._baseDrawRadius ?? mob.drawRadius; mob.radius = mob._baseRadius ?? mob.radius; }
      }
      const baseR = mob._baseDrawRadius ?? mob.drawRadius;
      if(mob.peaSquishPhase === 1) mob.drawRadius = baseR * (0.78 + 0.22 * (mob.peaSquishTimer / CENTI_PEA_SQUISH_DUR));
      else if(mob.peaSquishPhase === 2) mob.drawRadius = baseR * (0.78 + 0.30 * (1 - mob.peaSquishTimer / CENTI_PEA_SQUISH_DUR));
      else if(mob.peaSquishPhase === 3) mob.drawRadius = baseR * (1.08 - 0.08 * (1 - mob.peaSquishTimer / CENTI_PEA_SQUISH_DUR));
      mob.radius = Math.round(mob.drawRadius * (mob.hitRadiusFactor ?? 1));
    }

    if(mob.peaShootTimer <= 0){
      // Don't shoot if 10+ peas already alive (wait until count drops below 10)
      const livePeas = bossPeas.filter(p => !p.dead).length;
      if(livePeas >= 10){
        // Keep timer at 0 so we shoot immediately once count drops
        mob.peaShootTimer = 0;
      } else if(livePeas < CENTI_PEA_MAX){
        mob.peaShootTimer = CENTI_PEA_INTERVAL;
        // Cache base size for squish
        if(!mob._baseDrawRadius){ mob._baseDrawRadius = mob.drawRadius; mob._baseRadius = mob.radius; }
        // Start squish
        mob.peaSquishPhase = 1; mob.peaSquishTimer = CENTI_PEA_SQUISH_DUR;

        // Fire pea outward perpendicular to segment facing
        const t = mob.tier ?? 0;
        const cStats = MOB_STATS.centipede_head;
        const peaHp  = Math.round(cStats.hp[t] * 0.5);
        const peaDmg = cStats.dmg[t] * 1.5;
        const peaR   = Math.max(5, Math.round((mob.drawRadius ?? mob.radius) * 0.38));
        // Shoot sideways from segment (perpendicular to its facing)
        const fireAngle = (mob.facing ?? 0) + Math.PI * 0.5 * (Math.random() < 0.5 ? 1 : -1);
        bossPeas.push({
          id: ++_bossStingerNextId,
          x: mob.x, y: mob.y,
          vx: Math.cos(fireAngle) * CENTI_PEA_SPEED,
          vy: Math.sin(fireAngle) * CENTI_PEA_SPEED,
          radius: peaR,
          hp: peaHp, maxHp: peaHp,
          damage: peaDmg,
          lifetime: CENTI_PEA_LIFETIME,
          dead: false,
          fromMobId: mob.id,
          tier: t,
          color: '#66bb6a',
          border: '#2e7d32',
          hurtFlash: 0,
        });
      }
    }
  }

  // ── Boss pea physics — bounce off walls, move each tick ───────────────────
  for(let i = bossPeas.length - 1; i >= 0; i--){
    const p = bossPeas[i];
    if(p.dead){ bossPeas.splice(i,1); continue; }
    p.lifetime -= dt;
    if(p.lifetime <= 0){ p.dead = true; bossPeas.splice(i,1); continue; }

    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;
    // Bounce off walls using canMoveTo
    const canX = canMoveTo(nx, p.y, p.radius);
    const canY = canMoveTo(p.x, ny, p.radius);
    if(canX) p.x = nx; else p.vx = -p.vx;
    if(canY) p.y = ny; else p.vy = -p.vy;
  }

  // ── Regular mob AI ───────────────────────────────────────────────────────-

  for(const mob of mobs){
    if(mob.dead||mob.isCentipede) continue;
    if(mob.typeId==='hornet') continue;  // handled below
    if(mob.typeId==='digger'||mob.typeId==='beekeeper') continue;  // friendly mobs handled separately
    if(mob.isAntMob) continue;  // ants handled in dedicated section below
    if(mob.isFireAntMob) continue;  // fire ants handled in dedicated section below
    if(mob.typeId==='beehive') continue;  // static, no AI needed
    if(mob.typeId==='queen_bee') continue;  // handled in dedicated section below
    if(mob.isFriendlyPet) continue;  // friendly pets handled in dedicated section below
    if(mob.typeId==='sandstorm') continue;  // handled in dedicated section below
    if(mob.isDesertCentipede) continue;  // handled in dedicated section below
    if(mob.typeId==='cactus') continue;  // static, no AI needed
    if(mob.typeId==='rock') continue;  // static, no AI needed
    if(mob.typeId==='dandelion') continue;  // static, no AI needed
    if(mob.typeId==='scorpion') continue;  // handled in dedicated section below
    if(mob.typeId==='pyramid') continue;  // static, no AI needed
    if(mob.typeId==='sponge'||mob.typeId==='sea_cave') continue;  // static ocean scenery, no AI needed
    if(mob.typeId==='shell') continue;  // motionless until hit, then periodic push-toward-target — handled in its own dedicated AI loop below
    if(mob.typeId==='debris') continue;  // drifts only, handled in dedicated section below — never aggros/chases
    if(mob.typeId==='bubble') continue;  // drifts only, handled in dedicated section below — never aggros/chases, even after being hit
    if(mob.typeId==='starfish') continue;  // handled in dedicated section below
    if(mob.typeId==='crab') continue;  // handled in dedicated section below, scorpion-style stand-and-dodge
    // Honeycomb override: if attracted to a honeycomb entity, target it instead
    if (mob.honeycombTargetId != null) {
      const hc = honeycombEntities.find(e => e.id === mob.honeycombTargetId && !e.dead);
      if (hc) {
        const hcDx = hc.x - mob.x, hcDy = hc.y - mob.y;
        const hcDist = Math.hypot(hcDx, hcDy);
        mob.alerted = true;
        mob.speed   = mob.alertSpeed || mob.baseSpeed;
        const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
        mob.speed *= (1 - slowFactor);
        mob.targetFacing = Math.atan2(hcDy, hcDx);
        if (hcDist > mob.radius + hc.radius && hcDist > 0.001) {
          const nx = hcDx / hcDist, ny = hcDy / hcDist;
          const nx2 = mob.x + nx * mob.speed, ny2 = mob.y + ny * mob.speed;
          if (canMoveTo(nx2, ny2, mob.radius)) { mob.x = nx2; mob.y = ny2; }
        }
        continue;
      } else {
        mob.honeycombTargetId = null;
      }
    }
    // Pick nearest target: player, NPC (wave mode — whichever is closer, no
    // bias), or any live digger (non-wave mode).
    let targetX=playerX,targetY=playerY;
    let tDist2=Math.hypot(playerX-mob.x,playerY-mob.y);

    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const pick = pickWaveTarget(mob, mob.x, mob.y, playerX, playerY);
      targetX = pick.targetX; targetY = pick.targetY; tDist2 = pick.dist;
      mob.waveTarget = pick.kind;
    } else if (!isWaveMapMode()) {
      for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y);if(dd<tDist2){targetX=dg.x;targetY=dg.y;tDist2=dd;}}
    }
    const dx=targetX-mob.x, dy=targetY-mob.y, dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;

    // De-aggro if the current target gets far enough away
    // Wave mobs targeting the NPC never de-aggro (NPC is always far away)
    const isWaveNPCChase = isWaveMapMode() && mob.waveTarget !== 'player';
    if(mob.alerted && dist>DEAGGRO_DIST && !isWaveNPCChase){
      mob.alerted=false; mob.wanderAngle=mob.facing; mob.wanderTimer=800;
    }

    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;
    
    // Apply web slowdown
    const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactor);
    
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    if(mob.typeId==='spider'&&chasing){
      mob.webTimer-=dt;
      if(mob.webTimer<=0){
        // Spawn a web slightly smaller than the spider's visible body
        spawnWebField(mob.x, mob.y, mob.tier ?? 0, (mob.drawRadius ?? mob.radius) * 0.65);
        mob.webTimer += 1500;
      }

      // ── Boss spider egg-laying ──────────────────────────────────────────
      if(mob.isBoss){
        mob.spiderEggTimer = (mob.spiderEggTimer ?? 4000) - dt;
        if(mob.spiderEggTimer <= 0){
          mob.spiderEggTimer = 4000;
          const eggRadius = Math.max(6, Math.round((mob.drawRadius ?? mob.radius) * 0.5));
          const t = mob.tier ?? 0;
          const aeStats = MOB_STATS.ant_egg;
          const spiderEgg = {
            id: ++nextMobId,
            typeId: 'spider_egg',
            name: 'Spider Egg',
            x: mob.x, y: mob.y,
            homeZoneId: mob.homeZoneId,
            tier: t,
            rarity: mob.rarity,
            radius: eggRadius,
            drawRadius: eggRadius,
            hitRadiusFactor: 1.0,
            hitOffsetX: 0, hitOffsetY: 0,
            hp: aeStats.hp[t],
            maxHp: aeStats.hp[t],
            damage: aeStats.dmg[t],
            contactDps: aeStats.dmg[t],
            armor: aeStats.armor[t] ?? 0,
            speed: 0, baseSpeed: 0, alertSpeed: 0,
            aggroRange: 0,
            mass: 120,
            facing: 0, targetFacing: 0,
            alerted: false,
            dead: false,
            isBoss: false,
            isZoneTracked: false,
            spiderEggHatchTimer: 4000,
            ownerTier: t,
            ownerRarity: mob.rarity,
          };
          mobs.push(spiderEgg);
        }
      }
      // ───────────────────────────────────────────────────────────────────
    }

    // ── Boss Beetle: dash (same telegraph/lunge as boss Soldier Ant) + periodic spawn ──
    if(mob.isBoss && mob.typeId==='beetle'){
      // Same numbers as boss Soldier Ant's lunge (that block declares its own
      // identically-valued consts later in this function, out of scope here).
      const BEETLE_LUNGE_COOLDOWN  = 15000;
      const BEETLE_LUNGE_RANGE     = 600;
      const BEETLE_LUNGE_DIST      = 300;
      const BEETLE_LUNGE_TELEGRAPH = 700;
      const BEETLE_LUNGE_SPEED     = 28;
      const BEETLE_BOSS_LUNGE_MULT = 2.5;
      const bossLungeRange = BEETLE_LUNGE_RANGE * BEETLE_BOSS_LUNGE_MULT;
      const bossLungeDist  = BEETLE_LUNGE_DIST  * BEETLE_BOSS_LUNGE_MULT;
      mob.lungeTimer=(mob.lungeTimer??BEETLE_LUNGE_COOLDOWN) - dt;

      if(mob.lungeState==='telegraphing'){
        mob.targetFacing=mob.lungeAngle??mob.facing;
        mob.lungeWaitTimer=(mob.lungeWaitTimer??0)-dt;
        if(mob.lungeWaitTimer<=0){
          mob.lungeState='lunging';
          mob.lungeStartX=mob.x; mob.lungeStartY=mob.y;
          const la=mob.lungeAngle??mob.facing;
          mob.lungeDestX=mob.x+Math.cos(la)*bossLungeDist;
          mob.lungeDestY=mob.y+Math.sin(la)*bossLungeDist;
        }
      } else if(mob.lungeState==='lunging'){
        const ldx=mob.lungeDestX-mob.x, ldy=mob.lungeDestY-mob.y, ldist=Math.hypot(ldx,ldy);
        if(ldist<BEETLE_LUNGE_SPEED||ldist<2){
          mob.x=mob.lungeDestX; mob.y=mob.lungeDestY;
          mob.lungeState='idle';
          mob.lungeTimer=BEETLE_LUNGE_COOLDOWN;
        } else {
          const lnx=ldx/ldist, lny=ldy/ldist;
          const lnx2=mob.x+lnx*BEETLE_LUNGE_SPEED, lny2=mob.y+lny*BEETLE_LUNGE_SPEED;
          if(canMoveTo(lnx2,lny2,mob.radius)){mob.x=lnx2;mob.y=lny2;}
          else{mob.lungeState='idle';mob.lungeTimer=BEETLE_LUNGE_COOLDOWN;}
        }
      } else if(mob.lungeTimer<=0 && mob.alerted && dist<=bossLungeRange && dist>0.01){
        mob.lungeState='telegraphing';
        mob.lungeAngle=Math.atan2(dy,dx);
        mob.lungeWaitTimer=BEETLE_LUNGE_TELEGRAPH;
      }

      // Every 22s, spawn 2 beetles at the boss's own rarity — independent of the dash timer
      mob.beetleSpawnTimer = (mob.beetleSpawnTimer ?? 22000) - dt;
      if(mob.beetleSpawnTimer <= 0){
        mob.beetleSpawnTimer = 22000;
        for(let i=0;i<2;i++) spawnAntMinion('beetle', mob.x, mob.y, mob.x, mob.y, mob.homeZoneId, mob.tier);
      }

      // Skip normal movement entirely while telegraphing or lunging, same as boss Soldier Ant
      if(mob.lungeState==='telegraphing'||mob.lungeState==='lunging') continue;
    }

    let newX=mob.x, newY=mob.y;
    if(chasing&&dist>0.01){newX=mob.x+(dx/dist)*mob.speed;newY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      newX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      newY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(newX,newY,mob.radius)){mob.x=newX;mob.y=newY;}
    else if(canMoveTo(newX,mob.y,mob.radius)){mob.x=newX;}
    else if(canMoveTo(mob.x,newY,mob.radius)){mob.y=newY;}
    else if(isWaveMapMode()){const W=getWaveMapW(),H=getWaveMapH(),r=mob.radius;mob.x=Math.max(r,Math.min(W-r,newX));mob.y=Math.max(r,Math.min(H-r,newY));}
    // Trail buffer: records the head's own position for any mob whose body
    // needs to visually/physically follow behind it, like a snake --
    // currently just leech. See TRAIL_MAX_POINTS and the leech
    // capsule-hitbox helpers earlier in this file for how this buffer
    // becomes both the drawn body curve and its hitbox.
    //
    // IMPORTANT: only pushes a new point once the mob has moved at least
    // LEECH_TRAIL_MIN_STEP_MULT * drawRadius since the last recorded point,
    // rather than unconditionally once per tick. A fixed-tick recording rate
    // means the body's real-world LENGTH is driven by movement SPEED, which
    // only scales by sqrt(RADIUS_SCALE[tier]) -- but the body's WIDTH scales
    // by the full RADIUS_SCALE[tier] (it's tied to drawRadius directly). Those
    // two different growth rates meant higher-rarity leeches looked
    // progressively shorter and stubbier relative to their own thickness
    // (verified: length/width ratio dropped from 2.2 at Common to 0.51 at
    // max rarity -- the body was literally wider than it was long by then).
    // Scaling the recording step by drawRadius instead keeps length and
    // width growing at the exact same rate, so the ratio (~2.0) now stays
    // constant across every tier.
    if(mob.typeId==='leech'){
      if(!mob.trail) mob.trail=[];
      const minStep=(mob.drawRadius??mob.radius??20)*LEECH_TRAIL_MIN_STEP_MULT;
      const last=mob.trail[mob.trail.length-1];
      if(!last || Math.hypot(mob.x-last.x, mob.y-last.y)>=minStep){
        mob.trail.push({x:mob.x,y:mob.y});
        if(mob.trail.length>TRAIL_MAX_POINTS) mob.trail.shift();
      }
    }
  }

  // ── Sandstorm AI — drifts lazily, slowly closes on target, rams when close ─
  const SANDSTORM_RAM_DIST     = 120;  // start ramming within this range
  const SANDSTORM_RAM_SPEED    = 7.5;  // ram burst speed
  const SANDSTORM_RAM_DURATION = 320;  // ms the ram lasts
  const SANDSTORM_RAM_COOLDOWN = 2200; // ms before next ram
  const SANDSTORM_DRIFT_BLEND  = 0.04; // how much drift contributes when aggroed
  const SANDSTORM_PELLET_SPEED = 2.5;  // boss pellet speed — about half Centi's pea speed (6)
  const SANDSTORM_PULL_DURATION = 7500; // ms the boss pull effect lasts once triggered (was 2500, +5s)

  for(const mob of mobs){
    if(mob.dead || mob.typeId !== 'sandstorm') continue;

    // Friendly sandstorm pets (Stick petal) are driven entirely by the generic
    // pet-AI block further down — only the purely-cosmetic hex spin runs here,
    // so they don't also get pulled toward the player by this hostile-only logic.
    if(mob.isFriendlyPet){
      for(let i = 0; i < 3; i++){
        mob.hexRotations[i] = (mob.hexRotations[i] || 0) + mob.hexRotSpeeds[i] * dt;
      }
      continue;
    }

    // ── Boss Sandstorm: pellet burst (every 12s) + pull (every 30s) ──────────
    // Both timers run regardless of AI_CULL_DIST, since the pull is unlimited
    // range and should trigger even if the boss itself is far off-screen.
    if(mob.isBoss){
      // Pellet burst — 15 shots over ~2s, random directions, half Centi's pea speed
      mob.sandPelletBurstTimer = (mob.sandPelletBurstTimer ?? 12000) - dt;
      if(mob.sandPelletBurstTimer <= 0 && (mob.sandPelletsFired ?? 0) === 0){
        mob.sandPelletsFired = 15;
        mob.sandPelletShotTimer = 0;
      }
      if((mob.sandPelletsFired ?? 0) > 0){
        mob.sandPelletShotTimer -= dt;
        if(mob.sandPelletShotTimer <= 0){
          mob.sandPelletShotTimer = 140; // ~15 shots over ~2.1s
          mob.sandPelletsFired--;
          const t = mob.tier ?? 0;
          const sStats = MOB_STATS.sandstorm;
          const pelletHp  = Math.round(sStats.hp[t] * 0.5);
          const pelletDmg = sStats.dmg[t] * 1.5;
          const pelletR   = Math.max(5, Math.round((mob.drawRadius ?? mob.radius) * 0.32));
          const fireAngle = Math.random() * Math.PI * 2; // fully random direction, unlike Centi's perpendicular-to-facing
          bossPeas.push({
            id: ++_bossStingerNextId,
            x: mob.x, y: mob.y,
            vx: Math.cos(fireAngle) * SANDSTORM_PELLET_SPEED,
            vy: Math.sin(fireAngle) * SANDSTORM_PELLET_SPEED,
            radius: pelletR,
            hp: pelletHp, maxHp: pelletHp,
            damage: pelletDmg,
            lifetime: CENTI_PEA_LIFETIME,
            dead: false,
            fromMobId: mob.id,
            tier: t,
            color: '#ffdc00',
            border: '#d6b700',
            hurtFlash: 0,
          });
          if(mob.sandPelletsFired <= 0) mob.sandPelletBurstTimer = 12000;
        }
      }

      // Pull — every 30s, drags the player and every friendly pet toward the
      // boss for a few seconds. Actual velocity application happens in
      // combat.js (player.vx/vy + pet mob.x/y are updated there each tick);
      // this just owns the timer and the isPulling/pullTimer flag it reads.
      mob.sandstormPullTimer = (mob.sandstormPullTimer ?? 30000) - dt;
      if(mob.sandstormPullTimer <= 0){
        mob.sandstormPullTimer = 30000;
        mob.isPulling = true;
        mob.pullDuration = SANDSTORM_PULL_DURATION;
      }
      if(mob.isPulling){
        mob.pullDuration -= dt;
        if(mob.pullDuration <= 0) mob.isPulling = false;
      }
    }

    const pdist = Math.hypot(playerX - mob.x, playerY - mob.y);
    if(pdist > AI_CULL_DIST) continue;

    // Spin each hex layer every tick — same speed whether wandering or aggroed
    for(let i = 0; i < 3; i++){
      mob.hexRotations[i] = (mob.hexRotations[i] || 0) + mob.hexRotSpeeds[i] * dt;
    }

    // Target selection (player, or NPC in wave mode — whichever is closer)
    let targetX = playerX, targetY = playerY;
    if(isWaveMapMode() && _npcTarget && !_npcTarget.dead){
      const pick = pickWaveTarget(mob, mob.x, mob.y, playerX, playerY);
      targetX = pick.targetX; targetY = pick.targetY; mob.waveTarget = pick.kind;
    }
    const dx = targetX - mob.x, dy = targetY - mob.y;
    const dist = Math.hypot(dx, dy);

    // Aggro detection / de-aggro
    if(!mob.alerted && mob.aggroRange > 0 && dist < mob.aggroRange) mob.alerted = true;
    if(mob.alerted && dist > DEAGGRO_DIST) { mob.alerted = false; mob.wanderAngle = mob.facing; mob.wanderTimer = 800; }

    // Ram cooldown tick
    if(mob.ramTimer > 0) mob.ramTimer -= dt;

    // Start a ram when close enough and cooldown is done
    if(mob.alerted && !mob.isRamming && dist < SANDSTORM_RAM_DIST && mob.ramTimer <= 0 && dist > 0.01){
      mob.isRamming = true;
      mob.ramDuration = SANDSTORM_RAM_DURATION;
      const nx = dx / dist, ny = dy / dist;
      mob.ramVx = nx * SANDSTORM_RAM_SPEED;
      mob.ramVy = ny * SANDSTORM_RAM_SPEED;
    }

    let newX = mob.x, newY = mob.y;

    if(mob.isRamming){
      // Ram: slide in the ram direction, decaying
      mob.ramDuration -= dt;
      newX = mob.x + mob.ramVx;
      newY = mob.y + mob.ramVy;
      mob.ramVx *= 0.88;
      mob.ramVy *= 0.88;
      mob.targetFacing = Math.atan2(mob.ramVy, mob.ramVx);
      if(mob.ramDuration <= 0){
        mob.isRamming = false;
        mob.ramTimer = SANDSTORM_RAM_COOLDOWN;
        mob.ramVx = 0; mob.ramVy = 0;
        mob.driftTimer = 400; // reset drift after ram
        mob.driftVx = (Math.random() - 0.5) * 0.6;
        mob.driftVy = (Math.random() - 0.5) * 0.6;
      }
    } else if(mob.alerted){
      // Alerted: slowly drift toward target, mixing in wander drift for floaty feel
      mob.driftTimer -= dt;
      if(mob.driftTimer <= 0){
        mob.driftVx = (Math.random() - 0.5) * 1.0;
        mob.driftVy = (Math.random() - 0.5) * 1.0;
        mob.driftTimer = 800 + Math.random() * 1200;
      }
      const chaseSpeed = mob.alertSpeed || mob.baseSpeed;
      const chaseVx = dist > 0.01 ? (dx / dist) * chaseSpeed * 0.55 : 0;
      const chaseVy = dist > 0.01 ? (dy / dist) * chaseSpeed * 0.55 : 0;
      const totalVx = chaseVx + mob.driftVx * SANDSTORM_DRIFT_BLEND * chaseSpeed;
      const totalVy = chaseVy + mob.driftVy * SANDSTORM_DRIFT_BLEND * chaseSpeed;
      newX = mob.x + totalVx;
      newY = mob.y + totalVy;
      mob.targetFacing = Math.atan2(totalVy, totalVx);
    } else {
      // Wander: gentle drift with random angle changes
      mob.driftTimer -= dt;
      if(mob.driftTimer <= 0){
        mob.wanderAngle = Math.random() * Math.PI * 2;
        mob.driftVx = Math.cos(mob.wanderAngle) * (0.3 + Math.random() * 0.5);
        mob.driftVy = Math.sin(mob.wanderAngle) * (0.3 + Math.random() * 0.5);
        mob.driftTimer = 1500 + Math.random() * 2500;
      }
      const wspd = mob.baseSpeed * 0.38;
      newX = mob.x + Math.cos(mob.wanderAngle) * wspd + mob.driftVx * 0.12;
      newY = mob.y + Math.sin(mob.wanderAngle) * wspd + mob.driftVy * 0.12;
      mob.targetFacing = mob.wanderAngle;
    }

    // Smooth facing rotation
    let fDiff = mob.targetFacing - mob.facing;
    if(fDiff > Math.PI) fDiff -= Math.PI * 2;
    if(fDiff < -Math.PI) fDiff += Math.PI * 2;
    mob.facing += fDiff * 0.05;

    const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    if(slowFactor > 0){ newX = mob.x + (newX - mob.x) * (1 - slowFactor); newY = mob.y + (newY - mob.y) * (1 - slowFactor); }

    if(canMoveTo(newX, newY, mob.radius)){ mob.x = newX; mob.y = newY; }
    else if(canMoveTo(newX, mob.y, mob.radius)){ mob.x = newX; mob.driftVx *= -0.5; }
    else if(canMoveTo(mob.x, newY, mob.radius)){ mob.y = newY; mob.driftVy *= -0.5; }
    else { mob.driftVx = (Math.random() - 0.5) * 1.2; mob.driftVy = (Math.random() - 0.5) * 1.2; mob.driftTimer = 300; }
  }

  // ── Friendly Sandstorm pet AI (Stick petal) ────────────────────────────────
  // Drifts around near the player like a real sandstorm idly wandering — never
  // aggros or chases anything — but if a hostile mob happens to end up close
  // by, it rams it exactly like the hostile version does. Stays within a
  // leash of the player so it doesn't wander off entirely. Holding shift
  // (retract) pulls every friendly sandstorm in fast to form a shield around
  // the player, same trigger as normal petal retract.
  const FRIENDLY_SANDSTORM_LEASH = 500;   // wander freely within this radius of the player
  const FRIENDLY_SANDSTORM_RAM_SCAN = SANDSTORM_RAM_DIST; // same proximity trigger as the real mob
  const FRIENDLY_SANDSTORM_SHIELD_SPEED = 9; // fast — noticeably quicker than normal drift/ram
  const isShielding = inputState.retract;

  for(const mob of mobs){
    if(mob.dead||!mob.isFriendlyPet||mob.typeId!=='sandstorm') continue;

    // Spin each hex layer every tick, same as the hostile version
    for(let i = 0; i < 3; i++){
      mob.hexRotations[i] = (mob.hexRotations[i] || 0) + mob.hexRotSpeeds[i] * dt;
    }

    const anchorX = (mob.isNPCPet && _npcTarget && !_npcTarget.dead) ? _npcTarget.x : playerX;
    const anchorY = (mob.isNPCPet && _npcTarget && !_npcTarget.dead) ? _npcTarget.y : playerY;

    // ── Shield mode: rush straight to the player's centre, overriding ram/drift ──
    if(isShielding){
      mob.isRamming = false; mob.ramVx = 0; mob.ramVy = 0; mob.ramTimer = 0;
      const dx = anchorX-mob.x, dy = anchorY-mob.y, dist = Math.hypot(dx,dy);
      let newX = mob.x, newY = mob.y;
      if(dist > 1){
        const step = Math.min(dist, FRIENDLY_SANDSTORM_SHIELD_SPEED);
        newX = mob.x + (dx/dist)*step;
        newY = mob.y + (dy/dist)*step;
        mob.targetFacing = Math.atan2(dy,dx);
      }
      let fDiff = mob.targetFacing - mob.facing;
      if(fDiff > Math.PI) fDiff -= Math.PI * 2;
      if(fDiff < -Math.PI) fDiff += Math.PI * 2;
      mob.facing += fDiff * 0.12; // turns a bit snappier than normal while rushing in
      const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
      if(slowFactor > 0){ newX = mob.x + (newX - mob.x) * (1 - slowFactor); newY = mob.y + (newY - mob.y) * (1 - slowFactor); }
      if(canMoveTo(newX, newY, mob.radius)){ mob.x = newX; mob.y = newY; }
      continue;
    }

    // Ram cooldown tick
    if(mob.ramTimer > 0) mob.ramTimer -= dt;

    // Look for the nearest hostile mob close enough to ram — no aggro range,
    // no chasing; it only reacts once something is already right next to it.
    let target = null, bestDist = Infinity;
    if(!mob.isRamming && mob.ramTimer <= 0){
      for(const other of mobs){
        if(other.dead||other.id===mob.id||other.isFriendlyPet) continue;
        if(other.typeId==='digger'||other.typeId==='beekeeper') continue;
        if(other.typeId==='ant_egg'||other.typeId==='spider_egg'||other.typeId==='fire_ant_egg') continue;
        const td = Math.hypot(other.x-mob.x, other.y-mob.y);
        if(td < FRIENDLY_SANDSTORM_RAM_SCAN && td < bestDist){ bestDist = td; target = other; }
      }
    }

    if(target && !mob.isRamming){
      mob.isRamming = true;
      mob.ramDuration = SANDSTORM_RAM_DURATION;
      const dx = target.x-mob.x, dy = target.y-mob.y, dist = Math.hypot(dx,dy) || 1;
      mob.ramVx = (dx/dist) * SANDSTORM_RAM_SPEED;
      mob.ramVy = (dy/dist) * SANDSTORM_RAM_SPEED;
    }

    let newX = mob.x, newY = mob.y;

    if(mob.isRamming){
      mob.ramDuration -= dt;
      newX = mob.x + mob.ramVx;
      newY = mob.y + mob.ramVy;
      mob.ramVx *= 0.88;
      mob.ramVy *= 0.88;
      mob.targetFacing = Math.atan2(mob.ramVy, mob.ramVx);
      if(mob.ramDuration <= 0){
        mob.isRamming = false;
        mob.ramTimer = SANDSTORM_RAM_COOLDOWN;
        mob.ramVx = 0; mob.ramVy = 0;
        mob.driftTimer = 400;
        mob.driftVx = (Math.random() - 0.5) * 0.6;
        mob.driftVy = (Math.random() - 0.5) * 0.6;
      }
    } else {
      // Idle drift — identical feel to the hostile mob's own wander, no player bias
      mob.driftTimer -= dt;
      if(mob.driftTimer <= 0){
        mob.wanderAngle = Math.random() * Math.PI * 2;
        mob.driftVx = Math.cos(mob.wanderAngle) * (0.3 + Math.random() * 0.5);
        mob.driftVy = Math.sin(mob.wanderAngle) * (0.3 + Math.random() * 0.5);
        mob.driftTimer = 1500 + Math.random() * 2500;
      }
      const wspd = mob.baseSpeed * 0.38;
      newX = mob.x + Math.cos(mob.wanderAngle) * wspd + mob.driftVx * 0.12;
      newY = mob.y + Math.sin(mob.wanderAngle) * wspd + mob.driftVy * 0.12;
      mob.targetFacing = mob.wanderAngle;

      // Soft leash — if drifting has carried it too far from the player, bias
      // the wander angle back inward rather than hard-snapping it home.
      const pdist = Math.hypot(anchorX-mob.x, anchorY-mob.y);
      if(pdist > FRIENDLY_SANDSTORM_LEASH){
        const homeAngle = Math.atan2(anchorY-mob.y, anchorX-mob.x);
        let aDiff = homeAngle - mob.wanderAngle;
        if(aDiff>Math.PI) aDiff-=Math.PI*2; if(aDiff<-Math.PI) aDiff+=Math.PI*2;
        mob.wanderAngle += aDiff * 0.15;
      }
    }

    // Smooth facing rotation
    let fDiff = mob.targetFacing - mob.facing;
    if(fDiff > Math.PI) fDiff -= Math.PI * 2;
    if(fDiff < -Math.PI) fDiff += Math.PI * 2;
    mob.facing += fDiff * 0.05;

    const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    if(slowFactor > 0){ newX = mob.x + (newX - mob.x) * (1 - slowFactor); newY = mob.y + (newY - mob.y) * (1 - slowFactor); }

    if(canMoveTo(newX, newY, mob.radius)){ mob.x = newX; mob.y = newY; }
    else if(canMoveTo(newX, mob.y, mob.radius)){ mob.x = newX; mob.driftVx *= -0.5; }
    else if(canMoveTo(mob.x, newY, mob.radius)){ mob.y = newY; mob.driftVy *= -0.5; }
    else { mob.driftVx = (Math.random() - 0.5) * 1.2; mob.driftVy = (Math.random() - 0.5) * 1.2; mob.driftTimer = 300; }
  }

  // ── Desert Centipede AI — wanders freely, turns toward target when nearby but never chases ──
  const DESERT_CENTI_TURN_DIST = 280;  // distance at which it starts biasing toward target
  for(const [,chain] of desertCentipedeChains){
    if(chain.mobs.length===0) continue;
    if(!chain.alerted&&chain.mobs.some(m=>m.alerted)){
      chain.alerted=true; for(const m of chain.mobs) m.alerted=true;
    }
    const head=chain.mobs[0];
    if(!head||head.dead) continue;

    // ── Boss Desert Centipede: straight-line dash, turns away when it hits a wall ──
    // Completely replaces the normal wander/track-toward-target behavior below —
    // no player-seeking at all, just fast constant travel that avoids walls.
    if(head.isBoss){
      const DESERT_CENTI_BOSS_SPEED_MULT = 2.5;
      if(head.bossDashAngle === undefined) head.bossDashAngle = head.facing;
      const bossSpeed = head.baseSpeed * DESERT_CENTI_BOSS_SPEED_MULT;
      const slowFactorCB = Math.max(getWebSlowdownFactor(head.x, head.y), getPincerSlowFactor(head.id));
      const moveSpeed = bossSpeed * (1 - slowFactorCB);
      const bnx = head.x + Math.cos(head.bossDashAngle) * moveSpeed;
      const bny = head.y + Math.sin(head.bossDashAngle) * moveSpeed;
      if(canMoveTo(bnx, bny, head.radius)){
        head.x = bnx; head.y = bny;
      } else {
        // Blocked — turn to a new direction generally away from the wall it hit,
        // same "roughly-opposite-half" pattern the normal wander fallback uses.
        head.bossDashAngle = head.bossDashAngle + Math.PI * (0.5 + Math.random());
      }
      let bdiff = head.bossDashAngle - head.facing;
      if(bdiff>Math.PI) bdiff-=Math.PI*2; if(bdiff<-Math.PI) bdiff+=Math.PI*2;
      head.facing += bdiff * 0.15;
      head.legPhase = (head.legPhase || 0) + 0.14; // legs scramble faster during the dash

      // Body following — same chain-follow logic as the normal segments below
      for(let i=1;i<chain.mobs.length;i++){
        const seg=chain.mobs[i], parent=chain.mobs[i-1];
        if(!seg||seg.dead||!parent||parent.dead) continue;
        const ddx=parent.x-seg.x, ddy=parent.y-seg.y, ddist=Math.hypot(ddx,ddy);
        const desired=(parent.radius+seg.radius)*1.05;
        if(ddist>desired&&ddist>0.001){
          const excess=ddist-desired;
          const nx=ddx/ddist, ny=ddy/ddist;
          const tx=seg.x+nx*excess, ty=seg.y+ny*excess;
          if(canMoveTo(tx,ty,seg.radius)){ seg.x=tx; seg.y=ty; }
          else if(canMoveTo(tx,seg.y,seg.radius)){ seg.x=tx; }
          else if(canMoveTo(seg.x,ty,seg.radius)){ seg.y=ty; }
        }
        seg.facing=Math.atan2(parent.y-seg.y,parent.x-seg.x);
        seg.legPhase=head.legPhase;
      }
      continue;
    }

    let targetX=playerX,targetY=playerY;
    let targetDist=Math.hypot(playerX-head.x,playerY-head.y);
    for(const dg of diggers){const dd=Math.hypot(dg.x-head.x,dg.y-head.y);if(dd<targetDist){targetX=dg.x;targetY=dg.y;targetDist=dd;}}

    const dx=targetX-head.x, dy=targetY-head.y, dist=Math.hypot(dx,dy);

    // Aggro / de-aggro
    if(!chain.alerted && head.aggroRange>0 && dist<head.aggroRange){
      chain.alerted=true; for(const m of chain.mobs) m.alerted=true;
    }
    if(chain.alerted && dist>DEAGGRO_DIST){
      chain.alerted=false; for(const m of chain.mobs){ m.alerted=false; m.wanderAngle=m.facing; m.wanderTimer=800; }
    }

    if(targetDist<=AI_CULL_DIST){
      const MAX_TURN=2.7;
      head.wanderTimer-=dt;
      if(head.wanderTimer<=0){
        const turn=(Math.random()-0.5)*Math.PI*0.9;
        head.wanderAngle=head.facing+turn;
        head.wanderTimer=1200+Math.random()*2500;
      }

      // When near target, blend wander angle toward target direction
      if(chain.alerted && dist < DESERT_CENTI_TURN_DIST && dist > 0.01){
        const toTarget=Math.atan2(dy,dx);
        let angleDiff=toTarget-head.wanderAngle;
        if(angleDiff>Math.PI) angleDiff-=Math.PI*2;
        if(angleDiff<-Math.PI) angleDiff+=Math.PI*2;
        // Blend strength increases as it gets closer
        const blend=0.3*(1-(dist/DESERT_CENTI_TURN_DIST));
        head.wanderAngle+=angleDiff*blend;
      }

      let wantFacing=head.wanderAngle;
      let tdiff=wantFacing-head.facing;
      if(tdiff>Math.PI) tdiff-=Math.PI*2; if(tdiff<-Math.PI) tdiff+=Math.PI*2;
      tdiff=Math.max(-MAX_TURN,Math.min(MAX_TURN,tdiff));
      head.targetFacing=head.facing+tdiff;

      const slowFactorC = Math.max(getWebSlowdownFactor(head.x, head.y), getPincerSlowFactor(head.id));
      head.speed=head.baseSpeed*(1-slowFactorC);

      let newX=head.x+Math.cos(head.targetFacing)*head.speed*0.55;
      let newY=head.y+Math.sin(head.targetFacing)*head.speed*0.55;

      if(canMoveTo(newX,newY,head.radius)){ head.x=newX; head.y=newY; }
      else { head.wanderAngle=head.facing+Math.PI*(0.5+Math.random()); head.wanderTimer=600+Math.random()*800; }

      let diff=head.targetFacing-head.facing;
      if(diff>Math.PI) diff-=Math.PI*2; if(diff<-Math.PI) diff+=Math.PI*2;
      head.facing+=diff*0.08;
      head.legPhase=(head.legPhase||0)+0.08;

      // Body following
      for(let i=1;i<chain.mobs.length;i++){
        const seg=chain.mobs[i], parent=chain.mobs[i-1];
        if(!seg||seg.dead||!parent||parent.dead) continue;
        const ddx=parent.x-seg.x, ddy=parent.y-seg.y, ddist=Math.hypot(ddx,ddy);
        const desired=(parent.radius+seg.radius)*1.05;
        if(ddist>desired&&ddist>0.001){
          const excess=ddist-desired;
          const nx=ddx/ddist, ny=ddy/ddist;
          const tx=seg.x+nx*excess, ty=seg.y+ny*excess;
          if(canMoveTo(tx,ty,seg.radius)){ seg.x=tx; seg.y=ty; }
          else if(canMoveTo(tx,seg.y,seg.radius)){ seg.x=tx; }
          else if(canMoveTo(seg.x,ty,seg.radius)){ seg.y=ty; }
        }
        const segFacing=Math.atan2(parent.y-seg.y,parent.x-seg.x);
        seg.facing=segFacing;
        seg.legPhase=head.legPhase;
      }
    }
  }

  // ── Desert Centipede: remove dead chains ──
  for(const [chainId,chain] of desertCentipedeChains){
    chain.mobs=chain.mobs.filter(m=>!m.dead);
    if(chain.mobs.length===0) desertCentipedeChains.delete(chainId);
  }

  // Digger AI — friendly to player, targets nearest hostile mob
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='digger'||mob.isFriendlyPet) continue;
    const pdist=Math.hypot(playerX-mob.x,playerY-mob.y);
    if(pdist>AI_CULL_DIST) continue;

    const DIGGER_LEASH = getPetLeashDist(mob.tier);
    const DIGGER_LEASH_GRACE = DIGGER_LEASH * 1.35;

    // Leash return — overrides everything else if too far from player
    if(pdist > DIGGER_LEASH_GRACE){
      mob.alerted=false;
      const ldx=playerX-mob.x, ldy=playerY-mob.y;
      mob.targetFacing=Math.atan2(ldy,ldx);
      const overleash=Math.min((pdist-DIGGER_LEASH_GRACE)/300,1);
      mob.speed=mob.baseSpeed+(mob.alertSpeed-mob.baseSpeed)*overleash;
      const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
      mob.speed*=(1-slowFactor);
      const excess=pdist-DIGGER_LEASH;
      const step=Math.min(mob.speed,excess);
      const lnx=mob.x+(ldx/pdist)*step, lny=mob.y+(ldy/pdist)*step;
      if(canMoveTo(lnx,lny,mob.radius)){mob.x=lnx;mob.y=lny;}
      mob.eyeAngle=mob.targetFacing;
      const targetPdxL=Math.cos(mob.eyeAngle)*mob.drawRadius*0.09;
      const targetPdyL=Math.sin(mob.eyeAngle)*mob.drawRadius*0.09;
      mob.animPdx=mob.animPdx*0.85+targetPdxL*0.15;
      mob.animPdy=mob.animPdy*0.85+targetPdyL*0.15;
      mob.state='neutral';
      const targetBrowTL=0;
      mob.browT=(mob.browT??0)*0.88+targetBrowTL*0.12;
      const drL=mob.drawRadius;
      mob.animCpOffset=mob.animCpOffset*0.85+(drL*0.14)*0.15;
      mob.cutterRot=(mob.cutterRot||0)+0.03;
      continue;
    }

    // Find nearest non-digger, non-egg mob to chase
    let target=null, targetDist=Infinity;
    for(const other of mobs){
      if(other.dead||other.id===mob.id||other.typeId==='digger'||other.typeId==='beekeeper'||other.typeId==='ant_egg'||other.typeId==='spider_egg'||other.isFriendlyPet) continue;
      const td=Math.hypot(other.x-mob.x,other.y-mob.y);
      if(td<targetDist){targetDist=td;target=other;}
    }

    let chasing=false;
    let tdx=0,tdy=0,dist=0;
    if(target&&targetDist<mob.aggroRange){
      tdx=target.x-mob.x; tdy=target.y-mob.y; dist=targetDist;
      chasing=true; mob.alerted=true; mob.speed=mob.alertSpeed||mob.baseSpeed;
    } else if(mob.alerted&&(!target||targetDist>DEAGGRO_DIST)){
      mob.alerted=false; mob.wanderAngle=mob.facing; mob.wanderTimer=800; mob.state='neutral';
      mob.speed=mob.baseSpeed;
    } else {
      mob.speed=mob.baseSpeed;
    }
    
    // Apply web slowdown
    const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactor);
    
    mob.targetFacing=chasing?Math.atan2(tdy,tdx):mob.wanderAngle;

    // Eye tracking follows movement direction
    const moveX=chasing?tdx/(dist||1):Math.cos(mob.wanderAngle);
    const moveY=chasing?tdy/(dist||1):Math.sin(mob.wanderAngle);
    if(moveX!==0||moveY!==0) mob.eyeAngle=Math.atan2(moveY,moveX);

    // Smooth eye animation
    const targetPdx=Math.cos(mob.eyeAngle)*mob.drawRadius*0.09;
    const targetPdy=Math.sin(mob.eyeAngle)*mob.drawRadius*0.09;
    mob.animPdx=mob.animPdx*0.85+targetPdx*0.15;
    mob.animPdy=mob.animPdy*0.85+targetPdy*0.15;

    // State based on HP + chasing
    const hpPct=mob.hp/mob.maxHp;
    if(hpPct<0.3){ mob.state='sad'; }
    else if(chasing){ mob.state='angry'; }
    else { mob.state='neutral'; }

    // Animate eyebrows (browT: 0=hidden → 1=angry)
    const targetBrowT=mob.state==='angry'?1:0;
    mob.browT=(mob.browT??0)*0.88+targetBrowT*0.12;

    // Smooth mouth animation
    const dr=mob.drawRadius;
    const targetCpOffset=mob.state==='angry'?-dr*0.20:mob.state==='sad'?-dr*0.13:dr*0.14;
    mob.animCpOffset=mob.animCpOffset*0.85+targetCpOffset*0.15;

    // Cutter rotation — faster when chasing
    mob.cutterRot=(mob.cutterRot||0)+(chasing?0.08:0.03);

    let newX=mob.x, newY=mob.y;
    if(chasing&&dist>0.01){newX=mob.x+(tdx/dist)*mob.speed;newY=mob.y+(tdy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      // Soft drift back toward player when outside leash ring
      if(pdist>DIGGER_LEASH){
        const excess=pdist-DIGGER_LEASH;
        const toPlayerAngle=Math.atan2(playerY-mob.y,playerX-mob.x);
        let aDiff=toPlayerAngle-mob.wanderAngle;
        if(aDiff>Math.PI) aDiff-=Math.PI*2; if(aDiff<-Math.PI) aDiff+=Math.PI*2;
        mob.wanderAngle+=aDiff*(0.08+0.12*Math.min(excess/300,1));
      }
      newX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      newY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(newX,newY,mob.radius)){mob.x=newX;mob.y=newY;}
    else if(canMoveTo(newX,mob.y,mob.radius)){mob.x=newX;}
    else if(canMoveTo(mob.x,newY,mob.radius)){mob.y=newY;}
    else if(isWaveMapMode()){const W=getWaveMapW(),H=getWaveMapH(),r=mob.radius;mob.x=Math.max(r,Math.min(W-r,newX));mob.y=Math.max(r,Math.min(H-r,newY));}
  }

  // Beekeeper AI — friendly to player, targets nearest hostile mob (like digger)
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='beekeeper') continue;
    const pdist=Math.hypot(playerX-mob.x,playerY-mob.y);
    if(pdist>AI_CULL_DIST) continue;

    // Find nearest non-beekeeper, non-egg mob to chase
    let target=null, targetDist=Infinity;
    for(const other of mobs){
      if(other.dead||other.id===mob.id||other.typeId==='beekeeper'||other.typeId==='digger'||other.typeId==='ant_egg'||other.typeId==='spider_egg'||other.isFriendlyPet) continue;
      const td=Math.hypot(other.x-mob.x,other.y-mob.y);
      if(td<targetDist){targetDist=td;target=other;}
    }

    let chasing=false;
    let tdx=0,tdy=0,dist=0;
    if(target&&targetDist<mob.aggroRange){
      tdx=target.x-mob.x; tdy=target.y-mob.y; dist=targetDist;
      chasing=true; mob.alerted=true; mob.speed=mob.alertSpeed||mob.baseSpeed;
    } else if(mob.alerted&&(!target||targetDist>DEAGGRO_DIST)){
      mob.alerted=false; mob.wanderAngle=mob.facing; mob.wanderTimer=800; mob.state='neutral';
      mob.speed=mob.baseSpeed;
    } else {
      mob.speed=mob.baseSpeed;
    }
    
    // Apply web slowdown
    const slowFactorBK = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactorBK);
    
    mob.targetFacing=chasing?Math.atan2(tdy,tdx):mob.wanderAngle;

    // Eye tracking follows movement direction
    const moveX=chasing?tdx/(dist||1):Math.cos(mob.wanderAngle);
    const moveY=chasing?tdy/(dist||1):Math.sin(mob.wanderAngle);
    if(moveX!==0||moveY!==0) mob.eyeAngle=Math.atan2(moveY,moveX);

    // Smooth eye animation (pupils drift to edges — 0.15 lets them reach iris edge)
    const targetPdx=Math.cos(mob.eyeAngle)*mob.drawRadius*0.15;
    const targetPdy=Math.sin(mob.eyeAngle)*mob.drawRadius*0.15;
    mob.animPdx=mob.animPdx*0.85+targetPdx*0.15;
    mob.animPdy=mob.animPdy*0.85+targetPdy*0.15;
    const hpPct=mob.hp/mob.maxHp;
    if(hpPct<0.3){ mob.state='sad'; }
    else if(chasing){ mob.state='angry'; }
    else { mob.state='neutral'; }

    // Mouth animation (browT: 0=neutral → 1=frown/angry)
    const targetBrowT=mob.state==='angry'?1:0;
    mob.browT=(mob.browT??0)*0.88+targetBrowT*0.12;

    // Cutter rotation — faster when chasing
    mob.cutterRot=(mob.cutterRot||0)+(chasing?0.08:0.03);

    let newX=mob.x, newY=mob.y;
    if(chasing&&dist>0.01){newX=mob.x+(tdx/dist)*mob.speed;newY=mob.y+(tdy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      newX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      newY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(newX,newY,mob.radius)){mob.x=newX;mob.y=newY;}
    else if(canMoveTo(newX,mob.y,mob.radius)){mob.x=newX;}
    else if(canMoveTo(mob.x,newY,mob.radius)){mob.y=newY;}
    else if(isWaveMapMode()){const W=getWaveMapW(),H=getWaveMapH(),r=mob.radius;mob.x=Math.max(r,Math.min(W-r,newX));mob.y=Math.max(r,Math.min(H-r,newY));}
  }

  // ── Queen Bee AI — hostile to player/beekeeper, heals nearby friendly swarm ──
  // Friendly swarm = bee, hornet, queen_bee (they won't be attacked by her either)
  const QUEEN_BEE_HEAL_INTERVAL = 500; // ms between heal ticks
  const BEE_FRIENDLY_TYPES = new Set(['bee','hornet','queen_bee']);
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='queen_bee') continue;
    const pdist=Math.hypot(playerX-mob.x,playerY-mob.y);
    if(pdist>AI_CULL_DIST) continue;

    // Target: player or beekeeper/digger (whichever is closest)
    let targetX=playerX,targetY=playerY;
    let tDist2q=pdist;
    for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y);if(dd<tDist2q){targetX=dg.x;targetY=dg.y;tDist2q=dd;}}
    const dx=targetX-mob.x,dy=targetY-mob.y,dist=Math.hypot(dx,dy);

    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}
    let chasing=false;
    if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed;}
    else if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed;}
    else mob.speed=mob.baseSpeed;
    
    // Apply web slowdown
    const slowFactorQ = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactorQ);
    
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;

    let nqX=mob.x,nqY=mob.y;
    if(chasing&&dist>0.01){nqX=mob.x+(dx/dist)*mob.speed;nqY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      nqX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      nqY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(nqX,nqY,mob.radius)){mob.x=nqX;mob.y=nqY;}
    else if(canMoveTo(nqX,mob.y,mob.radius)){mob.x=nqX;}
    else if(canMoveTo(mob.x,nqY,mob.radius)){mob.y=nqY;}
    else if(isWaveMapMode()){const W=getWaveMapW(),H=getWaveMapH(),r=mob.radius;mob.x=Math.max(r,Math.min(W-r,nqX));mob.y=Math.max(r,Math.min(H-r,nqY));}

    // Heal aura: every tick heal nearby friendly swarm mobs
    mob.healTimer=(mob.healTimer??0)-dt;
    if(mob.healTimer<=0){
      mob.healTimer=QUEEN_BEE_HEAL_INTERVAL;
      const healAmt=30*(MOB_STATS.queen_bee.dmg[mob.tier??0]/80)*(QUEEN_BEE_HEAL_INTERVAL/1000);
      for(const other of mobs){
        if(other.dead||other.id===mob.id) continue;
        if(!BEE_FRIENDLY_TYPES.has(other.typeId)) continue;
        const hd=Math.hypot(other.x-mob.x,other.y-mob.y);
        if(hd<mob.aggroRange){
          other.hp=Math.min(other.maxHp,other.hp+healAmt);
        }
      }
    }

    // ── Boss Queen Bee abilities ────────────────────────────────────────────
    if(mob.isBoss){
      // ── Egg laying every 5s ──────────────────────────────────────────────
      if(mob.queenBeeEggTimer === undefined){ mob.queenBeeEggTimer = 5000; mob.queenBeeEggCount = 0; }
      mob.queenBeeEggTimer -= dt;
      if(mob.queenBeeEggTimer <= 0){
        mob.queenBeeEggTimer = 5000;
        mob.queenBeeEggCount = (mob.queenBeeEggCount ?? 0) + 1;
        const isHornetEgg = (mob.queenBeeEggCount % 5 === 0);
        const eggAngle = Math.random() * Math.PI * 2;
        const dr = mob.drawRadius ?? mob.radius;
        const eggR = Math.max(10, Math.round(dr * 0.45));
        const ex = mob.x + Math.cos(eggAngle) * dr * 1.3;
        const ey = mob.y + Math.sin(eggAngle) * dr * 1.3;
        queenBeeEggs.push({
          id: ++_bossStingerNextId,
          x: ex, y: ey,
          radius: eggR,
          hatchTimer: 3000,
          tier: mob.tier ?? 0,
          isHornetEgg,
          ownerId: mob.id,
          dead: false,
          spawnTimer: 0,
        });
      }

      // ── Pollen spin + launch every 20s ───────────────────────────────────
      if(mob.queenBeePollenCooldown === undefined) mob.queenBeePollenCooldown = 20000;
      if(mob.queenBeePollenState === undefined)    mob.queenBeePollenState = 'idle';

      if(mob.queenBeePollenState === 'idle'){
        mob.queenBeePollenCooldown -= dt;
        if(mob.queenBeePollenCooldown <= 0 && mob.alerted){
          mob.queenBeePollenState = 'shake';
          mob.queenBeeShakeTimer = 600;
          mob.queenBeeShakeAmp = 0;
          for(let i=0;i<3;i++){
            queenBeePollenOrbit.push({
              id: ++_bossStingerNextId,
              ownerId: mob.id,
              orbitAngle: (Math.PI * 2 / 3) * i,
              orbitR: (mob.drawRadius ?? mob.radius) * 2.0,
              queenDrawRadius: mob.drawRadius ?? mob.radius, // for scaled rendering
              spinTimer: 5000,
              launched: false,
              x: mob.x, y: mob.y,
              vx: 0, vy: 0,
              dead: false,
            });
          }
        }
      } else if(mob.queenBeePollenState === 'shake'){
        mob.queenBeeShakeTimer -= dt;
        const t01 = 1 - mob.queenBeeShakeTimer / 600;
        mob.queenBeeShakeAmp = Math.sin(t01 * Math.PI) * 4;
        mob.queenBeeShakeOffset = (Math.random() - 0.5) * mob.queenBeeShakeAmp * 2;
        if(mob.queenBeeShakeTimer <= 0){
          mob.queenBeePollenState = 'spinning';
          mob.queenBeeShakeAmp = 0;
        }
      } else if(mob.queenBeePollenState === 'spinning'){
        const hasOrbit = queenBeePollenOrbit.some(p => !p.dead && p.ownerId === mob.id && !p.launched);
        if(!hasOrbit){
          mob.queenBeePollenState = 'idle';
          mob.queenBeePollenCooldown = 20000;
        }
      }
    }
  }

  // ── Ant AI ────────────────────────────────────────────────────────────────
  // Home radius scales with tier and mob size so ants always have room to roam
  function getAntHomeRadius(tier) {
    const scale = RADIUS_SCALE[tier ?? 0] ?? 1;
    return Math.max(500, (350 + (tier ?? 0) * 80) * Math.sqrt(scale));
  }

  // Ant hole: damage milestone check
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='ant_hole') continue;
    // Suppress overworld milestone spawns while the player is fighting inside this hole
    if(mob.interiorActive) continue;
    if(mob.nextMilestoneHp>0 && mob.hp<=mob.nextMilestoneHp){
      if(mob.isBoss){
        // Boss ant hole: every 25% HP loss → 2 boss soldier ants + 1 boss worker ant (all wave-tracked)
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.25);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        for(let i=0;i<2;i++){
          const bs=spawnAntMinion('soldier_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
          if(bs){ _applyBossStatsToMob(bs); if(isWaveMapMode()){ bs.waveTarget='npc'; bs.alerted=true; addTrackedMob(bs.id); } }
        }
        const bw=spawnAntMinion('worker_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        if(bw){ _applyBossStatsToMob(bw); if(isWaveMapMode()){ bw.waveTarget='npc'; bw.alerted=true; addTrackedMob(bw.id); } }
      } else {
        // Normal ant hole: spawn 3 soldiers every 15% HP lost
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.15);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        for(let i=0;i<3;i++){
          const ms=spawnAntMinion('soldier_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
          if(ms&&isWaveMapMode()){ ms.waveTarget='npc'; ms.alerted=true; addTrackedMob(ms.id); }
        }
      }
    }
  }

  // Fire ant hole: damage milestone check
  for(const mob of mobs){
    if(mob.dead||!mob.isFireAntHole) continue;
    if(mob.nextMilestoneHp>0 && mob.hp<=mob.nextMilestoneHp){
      if(mob.isBoss){
        // Boss fire ant hole: every 25% HP loss → 2 boss fire soldiers + 1 boss fire worker (same escalation as boss ant hole)
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.25);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        for(let i=0;i<2;i++){
          const bs=spawnFireAntMinion('fire_soldier_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
          if(bs){ _applyBossStatsToMob(bs); if(isWaveMapMode()){ bs.waveTarget='npc'; bs.alerted=true; addTrackedMob(bs.id); } }
        }
        const bw=spawnFireAntMinion('fire_worker_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        if(bw){ _applyBossStatsToMob(bw); if(isWaveMapMode()){ bw.waveTarget='npc'; bw.alerted=true; addTrackedMob(bw.id); } }
      } else {
        // Normal fire ant hole: spawn 3 fire soldiers every 15% HP lost
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.15);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        for(let i=0;i<3;i++){
          const ms=spawnFireAntMinion('fire_soldier_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
          if(ms&&isWaveMapMode()){ ms.waveTarget='npc'; ms.alerted=true; addTrackedMob(ms.id); }
        }
      }
    }
  }

  // Boss baby ant: every 25% HP lost → spawn 1 boss queen ant at same tier
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='baby_ant'||!mob.isBoss) continue;
    if(mob.nextMilestoneHp>0 && mob.hp<=mob.nextMilestoneHp){
      mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.25);
      if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
      const t = mob.tier??0;
      const q = spawnAntMinion('queen_ant',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId??-1,t);
      if(q){ _applyBossStatsToMob(q); if(isWaveMapMode()){ q.waveTarget='npc'; q.alerted=true; addTrackedMob(q.id); } }
    }
  }

  // Pyramid: damage milestone check — spawn 2 beetles + 1 scorpion every 15% HP lost
  for(const mob of mobs){
    if(mob.dead||!mob.isPyramid) continue;
    if(mob.nextMilestoneHp>0 && mob.hp<=mob.nextMilestoneHp){
      mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.15);
      if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
      for(let i=0;i<2;i++){
        const mb=spawnAntMinion('beetle',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        if(mb&&isWaveMapMode()){ mb.waveTarget='npc'; mb.alerted=true; addTrackedMob(mb.id); }
      }
      const ms=spawnAntMinion('scorpion',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
      if(ms&&isWaveMapMode()){ ms.waveTarget='npc'; ms.alerted=true; addTrackedMob(ms.id); }
    }
  }

  // Beehive: damage milestone check — spawn 2 bees + 1 hornet every 15% HP lost (normal), or 1 boss bee + 1 boss hornet every 25% HP loss (boss)
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='beehive') continue;
    if(mob.nextMilestoneHp>0 && mob.hp<=mob.nextMilestoneHp){
      if(mob.isBoss) {
        // Boss beehive: every 25% HP loss spawns 1 boss bee and 1 boss hornet at its level
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.25);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        const bossBee = spawnAntMinion('bee',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        const bossHornet = spawnAntMinion('hornet',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        if(bossBee) _applyBossStatsToMob(bossBee);
        if(bossHornet) _applyBossStatsToMob(bossHornet);
        // Add to wave tracking if in wave mode
        if(isWaveMapMode()) {
          if(bossBee) { bossBee.waveTarget = 'npc'; bossBee.alerted = true; addTrackedMob(bossBee.id); }
          if(bossHornet) { bossHornet.waveTarget = 'npc'; bossHornet.alerted = true; addTrackedMob(bossHornet.id); }
        }
      } else {
        // Normal beehive: spawn 2 bees + 1 hornet every 15% HP lost
        mob.nextMilestoneHp=Math.round(mob.nextMilestoneHp - mob.maxHp*0.15);
        if(mob.nextMilestoneHp<0) mob.nextMilestoneHp=0;
        for(let i=0;i<2;i++){
          const mb=spawnAntMinion('bee',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
          if(mb&&isWaveMapMode()){ mb.waveTarget='npc'; mb.alerted=true; addTrackedMob(mb.id); }
        }
        const mh=spawnAntMinion('hornet',mob.x,mob.y,mob.x,mob.y,mob.homeZoneId,mob.tier);
        if(mh&&isWaveMapMode()){ mh.waveTarget='npc'; mh.alerted=true; addTrackedMob(mh.id); }
      }
    }
  }

  // Baby ant — always passive, slow wandering, idles a lot
  for(const mob of mobs){
    if(mob.dead||(mob.typeId!=='baby_ant'&&mob.typeId!=='fire_baby_ant')) continue;
    const dx=playerX-mob.x,dy=playerY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    mob.alerted=false;
    mob.wanderTimer-=dt;
    if(mob.wanderTimer<=0){
      mob.wanderAngle=Math.random()*Math.PI*2;
      mob.wanderTimer=2500+Math.random()*4500;
    }
    if(mob.homeX!==undefined){
      const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
      if(Math.hypot(hdx,hdy)>getAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
    }
    mob.targetFacing=mob.wanderAngle;
    // Apply web slowdown to baby ant
    const slowFactorBaby = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    const slowBabySpeed = mob.speed * (1 - slowFactorBaby);
    const nbX=mob.x+Math.cos(mob.wanderAngle)*slowBabySpeed*0.35;
    const nbY=mob.y+Math.sin(mob.wanderAngle)*slowBabySpeed*0.35;
    if(canMoveTo(nbX,nbY,mob.radius)){mob.x=nbX;mob.y=nbY;}
    else if(canMoveTo(nbX,mob.y,mob.radius)){mob.x=nbX;}
    else if(canMoveTo(mob.x,nbY,mob.radius)){mob.y=nbY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // Soldier / worker ant lunge constants (shared by both mob types)
  const SOLDIER_LUNGE_COOLDOWN  = 15000; // ms between lunge attempts
  const SOLDIER_LUNGE_RANGE     = 600;   // max dist to trigger lunge (normal)
  const SOLDIER_LUNGE_DIST      = 300;   // how far the lunge travels (normal)
  const SOLDIER_LUNGE_TELEGRAPH = 700;   // ms pause before launching
  const SOLDIER_LUNGE_SPEED     = 28;    // px/frame equivalent (applied per-frame)
  const BOSS_LUNGE_MULT         = 2.5;   // boss versions trigger from & travel 2.5x further

  // Worker ant — passive until hit, then chases + boss lunge (same as soldier)
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='worker_ant') continue;
    let targetX=playerX,targetY=playerY;
    let tDist2w=Math.hypot(playerX-mob.x,playerY-mob.y);
    for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y);if(dd<tDist2w){targetX=dg.x;targetY=dg.y;tDist2w=dd;}}
    const dx=targetX-mob.x,dy=targetY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}
    let chasing=false;
    if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed;}else mob.speed=mob.baseSpeed;

    // ── Boss lunge ability (same as soldier ant; 2.5x trigger range & travel distance) ──
    if(mob.isBoss){
      const bossLungeRange = SOLDIER_LUNGE_RANGE * BOSS_LUNGE_MULT;
      const bossLungeDist  = SOLDIER_LUNGE_DIST  * BOSS_LUNGE_MULT;
      mob.lungeTimer=(mob.lungeTimer??SOLDIER_LUNGE_COOLDOWN) - dt;

      if(mob.lungeState==='telegraphing'){
        mob.targetFacing=mob.lungeAngle??mob.facing;
        mob.lungeWaitTimer=(mob.lungeWaitTimer??0)-dt;
        if(mob.lungeWaitTimer<=0){
          mob.lungeState='lunging';
          mob.lungeStartX=mob.x; mob.lungeStartY=mob.y;
          const la=mob.lungeAngle??mob.facing;
          mob.lungeDestX=mob.x+Math.cos(la)*bossLungeDist;
          mob.lungeDestY=mob.y+Math.sin(la)*bossLungeDist;
        }
        continue;
      }

      if(mob.lungeState==='lunging'){
        const ldx=mob.lungeDestX-mob.x, ldy=mob.lungeDestY-mob.y, ldist=Math.hypot(ldx,ldy);
        if(ldist<SOLDIER_LUNGE_SPEED||ldist<2){
          mob.x=mob.lungeDestX; mob.y=mob.lungeDestY;
          mob.lungeState='idle';
          mob.lungeTimer=SOLDIER_LUNGE_COOLDOWN;
        } else {
          const nx=ldx/ldist, ny=ldy/ldist;
          const nx2=mob.x+nx*SOLDIER_LUNGE_SPEED, ny2=mob.y+ny*SOLDIER_LUNGE_SPEED;
          if(canMoveTo(nx2,ny2,mob.radius)){mob.x=nx2;mob.y=ny2;}
          else{mob.lungeState='idle';mob.lungeTimer=SOLDIER_LUNGE_COOLDOWN;}
        }
        continue;
      }

      if(mob.lungeTimer<=0 && mob.alerted && dist<=bossLungeRange && dist>0.01){
        mob.lungeState='telegraphing';
        mob.lungeAngle=Math.atan2(dy,dx);
        mob.lungeWaitTimer=SOLDIER_LUNGE_TELEGRAPH;
      }
    }
    // ─────────────────────────────────────────────────────────────────────
    
    // Apply web slowdown
    const slowFactorW = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactorW);
    
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nwX=mob.x,nwY=mob.y;
    if(chasing&&dist>0.01){nwX=mob.x+(dx/dist)*mob.speed;nwY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nwX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      nwY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(nwX,nwY,mob.radius)){mob.x=nwX;mob.y=nwY;}
    else if(canMoveTo(nwX,mob.y,mob.radius)){mob.x=nwX;}
    else if(canMoveTo(mob.x,nwY,mob.radius)){mob.y=nwY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // Soldier ant — aggros at range
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='soldier_ant'||mob.isFriendlyPet) continue;
    let targetX=playerX,targetY=playerY;
    let tDist2s=Math.hypot(playerX-mob.x,playerY-mob.y);
    for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y);if(dd<tDist2s){targetX=dg.x;targetY=dg.y;tDist2s=dd;}}
    const dx=targetX-mob.x,dy=targetY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}
    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;

    // ── Boss lunge ability (2.5x trigger range & travel distance) ────────
    if(mob.isBoss){
      const bossLungeRange = SOLDIER_LUNGE_RANGE * BOSS_LUNGE_MULT;
      const bossLungeDist  = SOLDIER_LUNGE_DIST  * BOSS_LUNGE_MULT;
      mob.lungeTimer=(mob.lungeTimer??SOLDIER_LUNGE_COOLDOWN) - dt;

      if(mob.lungeState==='telegraphing'){
        // Freeze in place during telegraph, face target
        mob.targetFacing=mob.lungeAngle??mob.facing;
        mob.lungeWaitTimer=(mob.lungeWaitTimer??0)-dt;
        if(mob.lungeWaitTimer<=0){
          mob.lungeState='lunging';
          // Lock in launch origin and destination
          mob.lungeStartX=mob.x; mob.lungeStartY=mob.y;
          const la=mob.lungeAngle??mob.facing;
          mob.lungeDestX=mob.x+Math.cos(la)*bossLungeDist;
          mob.lungeDestY=mob.y+Math.sin(la)*bossLungeDist;
        }
        continue; // skip normal movement this tick
      }

      if(mob.lungeState==='lunging'){
        // Rocket toward destination
        const ldx=mob.lungeDestX-mob.x, ldy=mob.lungeDestY-mob.y, ldist=Math.hypot(ldx,ldy);
        if(ldist<SOLDIER_LUNGE_SPEED||ldist<2){
          // Arrived — snap and end lunge
          mob.x=mob.lungeDestX; mob.y=mob.lungeDestY;
          mob.lungeState='idle';
          mob.lungeTimer=SOLDIER_LUNGE_COOLDOWN;
        } else {
          const nx=ldx/ldist, ny=ldy/ldist;
          const nx2=mob.x+nx*SOLDIER_LUNGE_SPEED, ny2=mob.y+ny*SOLDIER_LUNGE_SPEED;
          if(canMoveTo(nx2,ny2,mob.radius)){mob.x=nx2;mob.y=ny2;}
          else{mob.lungeState='idle';mob.lungeTimer=SOLDIER_LUNGE_COOLDOWN;}
        }
        continue; // skip normal movement this tick
      }

      // Ready to lunge?
      if(mob.lungeTimer<=0 && mob.alerted && dist<=bossLungeRange && dist>0.01){
        mob.lungeState='telegraphing';
        mob.lungeAngle=Math.atan2(dy,dx);
        mob.lungeWaitTimer=SOLDIER_LUNGE_TELEGRAPH;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Apply web slowdown
    const slowFactorS = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactorS);

    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nsX=mob.x,nsY=mob.y;
    if(chasing&&dist>0.01){nsX=mob.x+(dx/dist)*mob.speed;nsY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nsX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      nsY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(nsX,nsY,mob.radius)){mob.x=nsX;mob.y=nsY;}
    else if(canMoveTo(nsX,mob.y,mob.radius)){mob.x=nsX;}
    else if(canMoveTo(mob.x,nsY,mob.radius)){mob.y=nsY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // ── Fire Ant AI ───────────────────────────────────────────────────────────
  function getFireAntHomeRadius(tier) {
    const scale = RADIUS_SCALE[tier ?? 0] ?? 1;
    return Math.max(500, (350 + (tier ?? 0) * 80) * Math.sqrt(scale));
  }

  // Fire worker ant — passive until hit, then chases
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='fire_worker_ant') continue;
    const dx=playerX-mob.x,dy=playerY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}
    let chasing=false;
    if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed;}else mob.speed=mob.baseSpeed;

    // ── Boss lunge ability (same as fire soldier ant / worker ant; 2.5x trigger range & travel distance) ──
    if(mob.isBoss){
      const FW_LUNGE_COOLDOWN  = 15000;
      const FW_LUNGE_RANGE     = 600;
      const FW_LUNGE_DIST      = 300;
      const FW_LUNGE_TELEGRAPH = 700;
      const FW_LUNGE_SPEED     = 28;
      const FW_BOSS_LUNGE_MULT = 2.5;
      const bossLungeRange = FW_LUNGE_RANGE * FW_BOSS_LUNGE_MULT;
      const bossLungeDist  = FW_LUNGE_DIST  * FW_BOSS_LUNGE_MULT;
      mob.lungeTimer=(mob.lungeTimer??FW_LUNGE_COOLDOWN) - dt;

      if(mob.lungeState==='telegraphing'){
        mob.targetFacing=mob.lungeAngle??mob.facing;
        mob.lungeWaitTimer=(mob.lungeWaitTimer??0)-dt;
        if(mob.lungeWaitTimer<=0){
          mob.lungeState='lunging';
          mob.lungeStartX=mob.x; mob.lungeStartY=mob.y;
          const la=mob.lungeAngle??mob.facing;
          mob.lungeDestX=mob.x+Math.cos(la)*bossLungeDist;
          mob.lungeDestY=mob.y+Math.sin(la)*bossLungeDist;
        }
        continue;
      }
      if(mob.lungeState==='lunging'){
        const ldx=mob.lungeDestX-mob.x, ldy=mob.lungeDestY-mob.y, ldist=Math.hypot(ldx,ldy);
        if(ldist<FW_LUNGE_SPEED||ldist<2){
          mob.x=mob.lungeDestX; mob.y=mob.lungeDestY;
          mob.lungeState='idle';
          mob.lungeTimer=FW_LUNGE_COOLDOWN;
        } else {
          const lnx=ldx/ldist, lny=ldy/ldist;
          const lnx2=mob.x+lnx*FW_LUNGE_SPEED, lny2=mob.y+lny*FW_LUNGE_SPEED;
          if(canMoveTo(lnx2,lny2,mob.radius)){mob.x=lnx2;mob.y=lny2;}
          else{mob.lungeState='idle';mob.lungeTimer=FW_LUNGE_COOLDOWN;}
        }
        continue;
      }
      if(mob.lungeTimer<=0 && mob.alerted && dist<=bossLungeRange && dist>0.01){
        mob.lungeState='telegraphing';
        mob.lungeAngle=Math.atan2(dy,dx);
        mob.lungeWaitTimer=FW_LUNGE_TELEGRAPH;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    const slowFW = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed*=(1-slowFW);
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nwX=mob.x,nwY=mob.y;
    if(chasing&&dist>0.01){nwX=mob.x+(dx/dist)*mob.speed;nwY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getFireAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nwX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      nwY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(nwX,nwY,mob.radius)){mob.x=nwX;mob.y=nwY;}
    else if(canMoveTo(nwX,mob.y,mob.radius)){mob.x=nwX;}
    else if(canMoveTo(mob.x,nwY,mob.radius)){mob.y=nwY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // Fire soldier ant — aggros at range, chases
  const FIRE_SOLDIER_LUNGE_COOLDOWN  = 15000;
  const FIRE_SOLDIER_LUNGE_RANGE     = 600;
  const FIRE_SOLDIER_LUNGE_DIST      = 300;
  const FIRE_SOLDIER_LUNGE_TELEGRAPH = 700;
  const FIRE_SOLDIER_LUNGE_SPEED     = 28;
  const FIRE_BOSS_LUNGE_MULT         = 2.5;

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='fire_soldier_ant') continue;
    const dx=playerX-mob.x,dy=playerY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}
    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;

    if(mob.isBoss){
      const bossLungeRange=FIRE_SOLDIER_LUNGE_RANGE*FIRE_BOSS_LUNGE_MULT;
      const bossLungeDist =FIRE_SOLDIER_LUNGE_DIST *FIRE_BOSS_LUNGE_MULT;
      mob.lungeTimer=(mob.lungeTimer??FIRE_SOLDIER_LUNGE_COOLDOWN)-dt;
      if(mob.lungeState==='telegraphing'){
        mob.targetFacing=mob.lungeAngle??mob.facing;
        mob.lungeWaitTimer=(mob.lungeWaitTimer??0)-dt;
        if(mob.lungeWaitTimer<=0){
          mob.lungeState='lunging';
          mob.lungeStartX=mob.x;mob.lungeStartY=mob.y;
          const la=mob.lungeAngle??mob.facing;
          mob.lungeDestX=mob.x+Math.cos(la)*bossLungeDist;
          mob.lungeDestY=mob.y+Math.sin(la)*bossLungeDist;
        }
        continue;
      }
      if(mob.lungeState==='lunging'){
        const ldx=mob.lungeDestX-mob.x,ldy=mob.lungeDestY-mob.y,ldist=Math.hypot(ldx,ldy);
        if(ldist<FIRE_SOLDIER_LUNGE_SPEED||ldist<2){
          mob.x=mob.lungeDestX;mob.y=mob.lungeDestY;mob.lungeState='idle';mob.lungeTimer=FIRE_SOLDIER_LUNGE_COOLDOWN;
        } else {
          const nx=ldx/ldist,ny=ldy/ldist;
          const nx2=mob.x+nx*FIRE_SOLDIER_LUNGE_SPEED,ny2=mob.y+ny*FIRE_SOLDIER_LUNGE_SPEED;
          if(canMoveTo(nx2,ny2,mob.radius)){mob.x=nx2;mob.y=ny2;}
          else{mob.lungeState='idle';mob.lungeTimer=FIRE_SOLDIER_LUNGE_COOLDOWN;}
        }
        continue;
      }
      if(mob.lungeTimer<=0&&mob.alerted&&dist<=bossLungeRange&&dist>0.01){
        mob.lungeState='telegraphing';mob.lungeAngle=Math.atan2(dy,dx);mob.lungeWaitTimer=FIRE_SOLDIER_LUNGE_TELEGRAPH;
      }
    }

    const slowFS = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed*=(1-slowFS);
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nsX=mob.x,nsY=mob.y;
    if(chasing&&dist>0.01){nsX=mob.x+(dx/dist)*mob.speed;nsY=mob.y+(dy/dist)*mob.speed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getFireAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nsX=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      nsY=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
    }
    if(canMoveTo(nsX,nsY,mob.radius)){mob.x=nsX;mob.y=nsY;}
    else if(canMoveTo(nsX,mob.y,mob.radius)){mob.x=nsX;}
    else if(canMoveTo(mob.x,nsY,mob.radius)){mob.y=nsY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // Fire queen ant — aggros, stops to lay fire eggs
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='fire_queen_ant') continue;
    const dx=playerX-mob.x,dy=playerY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}

    // ── Boss fire queen ant: spin + egg burst every 15s (same as boss queen ant) ──
    if(mob.isBoss){
      if(mob.queenSpinCooldown === undefined) mob.queenSpinCooldown = 15000;
      mob.queenSpinCooldown -= dt;

      if(mob.queenSpinState === 'spinning'){
        const SPIN_RATE = 0.062;
        mob.facing += SPIN_RATE * (dt / 16.67);
        mob.queenSpinTimer = (mob.queenSpinTimer ?? 0) - dt;
        mob.targetFacing = mob.facing;
        if(mob.queenSpinTimer <= 0){
          mob.queenSpinState = 'done';
          const BOSS_QUEEN_MAX_ANTS = 45;
          const FIRE_ANT_TYPES = new Set(['fire_soldier_ant','fire_worker_ant','fire_queen_ant','fire_ant_egg']);
          const liveAntCount = mobs.filter(m => !m.dead && FIRE_ANT_TYPES.has(m.typeId) && m !== mob).length;
          const slotsAvailable = Math.max(0, BOSS_QUEEN_MAX_ANTS - liveAntCount);
          const EGG_COUNT   = Math.min(25, slotsAvailable);
          const LAUNCH_SPEED = 18;
          const HIGHER_TIER_COUNT = 3;
          const higherIndices = new Set();
          if(EGG_COUNT > 0) {
            while(higherIndices.size < Math.min(HIGHER_TIER_COUNT, EGG_COUNT)) higherIndices.add(Math.floor(Math.random() * EGG_COUNT));
          }
          for(let ei = 0; ei < EGG_COUNT; ei++){
            const angle  = Math.random() * Math.PI * 2;
            const spawnDist = (mob.drawRadius ?? mob.radius) * 1.1;
            const ex = mob.x + Math.cos(angle) * spawnDist;
            const ey = mob.y + Math.sin(angle) * spawnDist;
            const eggTier = mob.tier ?? 0;
            let egg = null;
            if(Math.random() < 0.2){
              egg = spawnMob('fire_ant_egg', mob.x, mob.y, mob.homeZoneId, eggTier);
            } else {
              egg = spawnMob('fire_ant_egg', ex, ey, mob.homeZoneId, eggTier);
            }
            if(egg){
              egg.isZoneTracked = false;
              egg.homeX = mob.homeX ?? mob.x;
              egg.homeY = mob.homeY ?? mob.y;
              egg.isHigherTierEgg = higherIndices.has(ei);
              egg._launchVx = Math.cos(angle) * LAUNCH_SPEED;
              egg._launchVy = Math.sin(angle) * LAUNCH_SPEED;
              if(isWaveMapMode()) addTrackedMob(egg.id);
            }
          }
          mob.queenSpinCooldown = 15000;
        }
        continue;
      }

      if(mob.queenSpinState === 'done') mob.queenSpinState = null;

      if(mob.queenSpinCooldown <= 0 && mob.alerted){
        mob.queenSpinState = 'spinning';
        mob.queenSpinTimer = 600;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if(mob.queenLayState==='pausing'){
      mob.queenLayPause-=dt;
      if(mob.queenLayPause<=0){
        const egg=spawnMob('fire_ant_egg',mob.x,mob.y,mob.homeZoneId,mob.tier);
        egg.isZoneTracked=false;
        egg.homeX=mob.homeX??mob.x;egg.homeY=mob.homeY??mob.y;
        mob.queenLayState='moving';mob.queenLayTimer=5000;
      }
      mob.targetFacing=mob.facing;
      continue;
    }
    mob.queenLayTimer-=dt;
    if(mob.queenLayTimer<=0&&!mob.alerted){
      mob.queenLayState='pausing';mob.queenLayPause=500;continue;
    }
    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;
    const slowFQ = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    const fqEff=mob.speed*(1-slowFQ);
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nqX=mob.x,nqY=mob.y;
    if(chasing&&dist>0.01){nqX=mob.x+(dx/dist)*fqEff;nqY=mob.y+(dy/dist)*fqEff;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getFireAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nqX=mob.x+Math.cos(mob.wanderAngle)*fqEff*0.45;
      nqY=mob.y+Math.sin(mob.wanderAngle)*fqEff*0.45;
    }
    if(canMoveTo(nqX,nqY,mob.radius)){mob.x=nqX;mob.y=nqY;}
    else if(canMoveTo(nqX,mob.y,mob.radius)){mob.x=nqX;}
    else if(canMoveTo(mob.x,nqY,mob.radius)){mob.y=nqY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // ── Friendly ant pet AI ───────────────────────────────────────────────────────
  // Friendly pets chase enemies within aggro range, idle/wander near player otherwise.
  // They never attack diggers, beekeepers, or other friendly pets.
  const PET_FOLLOW_DIST   = 180;   // idle within this radius of player
  const PET_AGGRO_RANGE   = 1400;  // scan for enemies within this distance of the pet itself
  const PET_DEAGGRO_RANGE = 1700;  // hysteresis — keep chasing until target is this far from the pet

  for(const mob of mobs){
    if(mob.dead||!mob.isFriendlyPet) continue;
    if(mob.typeId==='sandstorm') continue;  // handled in its own dedicated section below — drifts + rams instead of chasing
    // NPC-owned pets orbit the NPC; player pets orbit the player
    const anchorX = (mob.isNPCPet && _npcTarget && !_npcTarget.dead) ? _npcTarget.x : playerX;
    const anchorY = (mob.isNPCPet && _npcTarget && !_npcTarget.dead) ? _npcTarget.y : playerY;
    const pdist=Math.hypot(anchorX-mob.x,anchorY-mob.y);
    if(pdist>AI_CULL_DIST) continue;

    const PET_LEASH_DIST       = getPetLeashDist(mob.tier);
    // Grace zone: if the pet already has a live target it can chase up to this
    // far from the player before being forced home — prevents twitch at boundary.
    const PET_LEASH_GRACE_DIST = PET_LEASH_DIST * 1.35;

    // --- Target selection — sticky, pet-relative range, no player-distance filter ---
    let target=null;
    if(mob.petTargetId!=null){
      const prev=mobs.find(m=>m.id===mob.petTargetId&&!m.dead);
      if(prev&&Math.hypot(prev.x-mob.x,prev.y-mob.y)<=PET_DEAGGRO_RANGE) target=prev;
    }
    if(!target){
      // Aggro anything inside or slightly outside the leash ring (player-relative),
      // so the pet defends its territory rather than a fixed pet-relative range.
      const PET_AGGRO_RING = PET_LEASH_DIST + 120;
      let bestDist=Infinity;
      for(const other of mobs){
        if(other.dead||other.id===mob.id) continue;
        if(other.isFriendlyPet) continue;
        if(other.typeId==='digger'||other.typeId==='beekeeper') continue;
        if(other.typeId==='ant_egg'||other.typeId==='spider_egg'||other.typeId==='fire_ant_egg') continue;
        // beehive and ant_hole are valid targets for pets
        const distFromPlayer=Math.hypot(other.x-anchorX,other.y-anchorY);
        if(distFromPlayer>PET_AGGRO_RING) continue;
        const td=Math.hypot(other.x-mob.x,other.y-mob.y);
        if(td<bestDist){bestDist=td;target=other;}
      }
      mob.petTargetId=target?target.id:null;
    }

    const isChasing = target != null;
    // Hard leash: chasing pets get a grace zone; idle pets get a small soft buffer so
    // random wander steps just past the ring don't cause jitter.
    const PET_LEASH_SOFT_IDLE = PET_LEASH_DIST + 80;
    const leashLimit = isChasing ? PET_LEASH_GRACE_DIST : PET_LEASH_SOFT_IDLE;

    if(pdist > leashLimit){
      // Return toward ring edge — drop any target, no combat during return
      if(isChasing){ mob.petTargetId=null; mob.alerted=false; }
      const dx=anchorX-mob.x,dy=anchorY-mob.y;
      mob.targetFacing=Math.atan2(dy,dx);
      const overleash=Math.min((pdist-leashLimit)/300,1);
      mob.speed=mob.baseSpeed+(mob.alertSpeed-mob.baseSpeed)*overleash;
      // Stop at the ring edge, not at the player
      const excess=pdist-PET_LEASH_DIST;
      const step=Math.min(mob.speed,excess);
      const nx=mob.x+(dx/pdist)*step,ny=mob.y+(dy/pdist)*step;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      let lfd=mob.targetFacing-mob.facing;
      if(lfd>Math.PI) lfd-=Math.PI*2; if(lfd<-Math.PI) lfd+=Math.PI*2;
      mob.facing+=lfd*0.08;
      const rspd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      if(rspd>0.05){const sf=Math.min(4.0,rspd/mob.baseSpeed*2.5);mob.pincerPhase=(mob.pincerPhase||0)+0.18*sf;mob.wingPhase=(mob.wingPhase||0)+0.14*sf;}
      mob.lastX=mob.x;mob.lastY=mob.y;
      continue;
    }

    if(target){
      // Chase target
      const dx=target.x-mob.x,dy=target.y-mob.y,dist=Math.hypot(dx,dy);
      mob.alerted=true;
      mob.speed=mob.alertSpeed;
      mob.targetFacing=Math.atan2(dy,dx);
      if(dist>mob.radius+target.radius&&dist>0.001){
        const nx=mob.x+(dx/dist)*mob.speed,ny=mob.y+(dy/dist)*mob.speed;
        if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
        else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
        else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      }
    } else {
      // Idle — wander freely near player, never explicitly face the player
      mob.alerted=false;
      mob.petTargetId=null;
      if(pdist>PET_LEASH_DIST){
        // Outside leash ring — drift back to the ring edge, not all the way to player
        const excess=pdist-PET_LEASH_DIST;
        const followT=Math.min(excess/300,1);
        mob.speed=mob.baseSpeed*(0.35+0.4*followT);
        const dx=anchorX-mob.x,dy=anchorY-mob.y;
        // Blend wander angle toward anchor direction proportionally — soft pull, no snap
        const toPlayerAngle=Math.atan2(dy,dx);
        let aDiff=toPlayerAngle-mob.wanderAngle;
        if(aDiff>Math.PI) aDiff-=Math.PI*2; if(aDiff<-Math.PI) aDiff+=Math.PI*2;
        mob.wanderAngle+=aDiff*(0.08+0.12*followT);
        mob.targetFacing=mob.wanderAngle;
        // Cap step so the pet stops at the ring edge, not at the player
        const step=Math.min(mob.speed,excess);
        const nx=mob.x+Math.cos(mob.wanderAngle)*step,ny=mob.y+Math.sin(mob.wanderAngle)*step;
        if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
        else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
        else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
        else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
      } else {
        // Fully idle: slow random wander, no player direction bias at all
        mob.speed=mob.baseSpeed;
        mob.wanderTimer-=dt;
        if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
        mob.targetFacing=mob.wanderAngle;
        const nx=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
        const ny=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
        if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
        else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
        else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
        else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
      }
    }

    // Facing + leg/wing animation
    let facingDiff=mob.targetFacing-mob.facing;
    if(facingDiff>Math.PI) facingDiff-=Math.PI*2; if(facingDiff<-Math.PI) facingDiff+=Math.PI*2;
    mob.facing+=facingDiff*0.08;
    const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
    if(spd>0.05){const sf=Math.min(4.0,spd/mob.baseSpeed*2.5);mob.pincerPhase=(mob.pincerPhase||0)+0.18*sf;mob.wingPhase=(mob.wingPhase||0)+0.14*sf;}
    mob.lastX=mob.x;mob.lastY=mob.y;
  }

  // ── Digger pet animation update — runs after pet AI loop gives movement data ──
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='digger'||!mob.isFriendlyPet) continue;

    const target = mob.petTargetId != null ? mobs.find(m=>m.id===mob.petTargetId&&!m.dead) : null;
    if(target){
      const tdx=target.x-mob.x, tdy=target.y-mob.y;
      const td=Math.hypot(tdx,tdy);
      if(td>0.01){ mob.eyeAngle=Math.atan2(tdy,tdx); }
    } else {
      mob.eyeAngle=mob.facing ?? mob.wanderAngle ?? 0;
    }

    const moveX=Math.cos(mob.eyeAngle), moveY=Math.sin(mob.eyeAngle);
    const targetPdx=moveX*mob.drawRadius*0.09, targetPdy=moveY*mob.drawRadius*0.09;
    mob.animPdx=(mob.animPdx??0)*0.85+targetPdx*0.15;
    mob.animPdy=(mob.animPdy??0)*0.85+targetPdy*0.15;

    const hpPct=mob.hp/mob.maxHp;
    if(hpPct<0.3){ mob.state='sad'; }
    else if(target){ mob.state='angry'; }
    else { mob.state='neutral'; }

    const targetBrowT=mob.state==='angry'?1:0;
    mob.browT=(mob.browT??0)*0.88+targetBrowT*0.12;

    const dr=mob.drawRadius;
    const targetCpOffset=mob.state==='angry'?-dr*0.20:mob.state==='sad'?-dr*0.13:dr*0.14;
    mob.animCpOffset=(mob.animCpOffset??dr*0.14)*0.85+targetCpOffset*0.15;

    mob.cutterRot=(mob.cutterRot??0)+(target?0.08:0.03);
  }

  // Queen ant — aggros at range + stops every ~5 s to lay an egg
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='queen_ant') continue;
    let targetX=playerX,targetY=playerY;
    let tDist2q=Math.hypot(playerX-mob.x,playerY-mob.y);
    for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y);if(dd<tDist2q){targetX=dg.x;targetY=dg.y;tDist2q=dd;}}
    const dx=targetX-mob.x,dy=targetY-mob.y,dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;
    if(mob.alerted&&dist>DEAGGRO_DIST){mob.alerted=false;mob.wanderAngle=mob.facing;mob.wanderTimer=800;}

    // ── Boss queen ant: spin + egg burst every 15s ──────────────────────────
    if(mob.isBoss){
      if(mob.queenSpinCooldown === undefined) mob.queenSpinCooldown = 15000;
      mob.queenSpinCooldown -= dt;

      if(mob.queenSpinState === 'spinning'){
        // Spin for 600ms (full 360° × ~1.3 so it looks deliberate)
        const SPIN_RATE = 0.062; // rad per ms-tick at 60fps equivalent
        mob.facing += SPIN_RATE * (dt / 16.67);
        mob.queenSpinTimer = (mob.queenSpinTimer ?? 0) - dt;
        mob.targetFacing = mob.facing;
        if(mob.queenSpinTimer <= 0){
          mob.queenSpinState = 'done';
          // Count live ants near this boss queen (max 45 total)
          const BOSS_QUEEN_MAX_ANTS = 45;
          const ANT_TYPES = new Set(['soldier_ant','worker_ant','baby_ant','queen_ant','ant_egg']);
          const liveAntCount = mobs.filter(m => !m.dead && ANT_TYPES.has(m.typeId) && m !== mob).length;
          const slotsAvailable = Math.max(0, BOSS_QUEEN_MAX_ANTS - liveAntCount);
          // Spawn up to 25 ant eggs — but only as many as there are slots
          const EGG_COUNT   = Math.min(25, slotsAvailable);
          const LAUNCH_SPEED = 18; // fast shoot-out speed
          const HIGHER_TIER_COUNT = 3;
          // Pick 3 random indices that will hatch at tier+1 (one tier higher, not two)
          const higherIndices = new Set();
          if(EGG_COUNT > 0) {
            while(higherIndices.size < Math.min(HIGHER_TIER_COUNT, EGG_COUNT)) higherIndices.add(Math.floor(Math.random() * EGG_COUNT));
          }
          for(let ei = 0; ei < EGG_COUNT; ei++){
            const angle  = Math.random() * Math.PI * 2;
            // Spawn right at queen's edge — eggs shoot outward from her
            const spawnDist = (mob.drawRadius ?? mob.radius) * 1.1;
            const ex = mob.x + Math.cos(angle) * spawnDist;
            const ey = mob.y + Math.sin(angle) * spawnDist;
            // All eggs spawn at queen's tier; isHigherTierEgg adds +1 at hatch time
            const eggTier = mob.tier ?? 0;
            // Sometimes let eggs spawn in walls (about 20% chance per egg)
            let egg = null;
            if(Math.random() < 0.2){
              // Force-spawn ignoring wall check by spawning at queen's position
              egg = spawnMob('ant_egg', mob.x, mob.y, mob.homeZoneId, eggTier);
            } else {
              egg = spawnMob('ant_egg', ex, ey, mob.homeZoneId, eggTier);
            }
            if(egg){
              egg.isZoneTracked = false;
              egg.homeX = mob.homeX ?? mob.x;
              egg.homeY = mob.homeY ?? mob.y;
              egg.isHigherTierEgg = higherIndices.has(ei); // flag for hatching at tier+1
              // Shoot egg outward at high speed
              egg._launchVx = Math.cos(angle) * LAUNCH_SPEED;
              egg._launchVy = Math.sin(angle) * LAUNCH_SPEED;
              if(isWaveMapMode()) addTrackedMob(egg.id);
            }
          }
          mob.queenSpinCooldown = 15000;
        }
        continue; // freeze movement during spin
      }

      if(mob.queenSpinState === 'done') mob.queenSpinState = null;

      if(mob.queenSpinCooldown <= 0 && mob.alerted){
        mob.queenSpinState = 'spinning';
        mob.queenSpinTimer = 600;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    if(mob.queenLayState==='pausing'){
      mob.queenLayPause-=dt;
      if(mob.queenLayPause<=0){
        const egg=spawnMob('ant_egg',mob.x,mob.y,mob.homeZoneId,mob.tier);
        egg.isZoneTracked=false;
        // Egg inherits queen's home so hatched soldier knows where the colony is
        egg.homeX=mob.homeX??mob.x; egg.homeY=mob.homeY??mob.y;
        mob.queenLayState='moving';
        mob.queenLayTimer=5000;
      }
      mob.targetFacing=mob.facing;
      continue;
    }

    mob.queenLayTimer-=dt;
    if(mob.queenLayTimer<=0&&!mob.alerted){
      mob.queenLayState='pausing'; mob.queenLayPause=500; continue;
    }

    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;
    
    // Apply web slowdown — compute effective speed fresh, never modify permanently
    const slowFactorQA = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    const qaEffSpeed = mob.speed * (1 - slowFactorQA);
    
    mob.targetFacing=chasing?Math.atan2(dy,dx):mob.wanderAngle;
    let nqX=mob.x,nqY=mob.y;
    if(chasing&&dist>0.01){nqX=mob.x+(dx/dist)*qaEffSpeed;nqY=mob.y+(dy/dist)*qaEffSpeed;}
    else{
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=1200+Math.random()*2500;}
      if(mob.homeX!==undefined){
        const hdx=mob.homeX-mob.x,hdy=mob.homeY-mob.y;
        if(Math.hypot(hdx,hdy)>getAntHomeRadius(mob.tier)){mob.wanderAngle=Math.atan2(hdy,hdx);mob.wanderTimer=600;}
      }
      nqX=mob.x+Math.cos(mob.wanderAngle)*qaEffSpeed*0.45;
      nqY=mob.y+Math.sin(mob.wanderAngle)*qaEffSpeed*0.45;
    }
    if(canMoveTo(nqX,nqY,mob.radius)){mob.x=nqX;mob.y=nqY;}
    else if(canMoveTo(nqX,mob.y,mob.radius)){mob.x=nqX;}
    else if(canMoveTo(mob.x,nqY,mob.radius)){mob.y=nqY;}
    else{mob.wanderAngle=Math.random()*Math.PI*2;mob.wanderTimer=400+Math.random()*600;}
  }

  // ── Hornet AI ─────────────────────────────────────────────────────────────
  const HORNET_AIM_HOLD_MS    = 120;    // brief hold at fully-aimed before firing
  const HORNET_REGROW_MS      = 900;    // stinger regrow duration
  const MISSILE_SPEED         = 20;    // px/frame at 60fps
  const MISSILE_LIFETIME      = 3800;   // ms
  const TURN_RATE             = 0.08;  // radians per frame — smooth rotation
  const HORNET_SPIN_COOLDOWN  = 20000; // ms between spin attacks
  const HORNET_SPIN_REVS      = 2;     // full 360s
  const HORNET_SPIN_SHOOT_MS  = 500;   // shoot every 500ms during spin

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='hornet') continue;
    const hornetPreferredDist = (mob.drawRadius ?? 22) * 11;  // always ~11 body-radii away, scales with rarity
    // Hornets target nearest enemy: player, NPC, digger, or beekeeper
    let targetX = playerX, targetY = playerY;
    let dist = Math.hypot(playerX-mob.x, playerY-mob.y);
    // Check NPC as additional target (wave mode)
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const dnpc = Math.hypot(_npcTarget.x-mob.x, _npcTarget.y-mob.y);
      if (dnpc < dist) { targetX = _npcTarget.x; targetY = _npcTarget.y; dist = dnpc; }
    }
    for(const dg of diggers){const dd=Math.hypot(dg.x-mob.x,dg.y-mob.y); if(dd<dist){targetX=dg.x;targetY=dg.y;dist=dd;} }
    const dx = targetX-mob.x;
    const dy = targetY-mob.y;
    if(dist>AI_CULL_DIST) continue;

    // De-aggro
    if(mob.alerted && dist>DEAGGRO_DIST){
      mob.alerted=false; mob.shootState='idle';
      mob.stingerProgress=1; mob.wanderAngle=mob.facing; mob.wanderTimer=800;
    }
    // Aggro check
    if(!mob.alerted && dist<mob.aggroRange){
      mob.alerted=true; mob.shootState='approach'; mob.shootTimer=0; mob.stingerProgress=1;
    }

    // Apply web slowdown — compute effective speed fresh, never modify baseSpeed/alertSpeed permanently
    const slowFactorH = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    const hEffSpeed = mob.speed * (1 - slowFactorH);

    if(mob.isStationary){
      // Stationary turret hornet (spawned from boss queen bee egg) — stays put, just aims and shoots
      if(!mob.alerted && dist < mob.aggroRange){ mob.alerted = true; mob.shootState = 'aim'; }
      // fall through to shootState machine below (no movement)
    } else if(!mob.alerted){
      // Wander
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=1200+Math.random()*2500; }
      const nx=mob.x+Math.cos(mob.wanderAngle)*hEffSpeed*0.45;
      const ny=mob.y+Math.sin(mob.wanderAngle)*hEffSpeed*0.45;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      let fd=mob.wanderAngle-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),TURN_RATE);
      mob.wobblePhase=(mob.wobblePhase||0)+0.12;
      continue;
    }

    // ── Boss spin attack ────────────────────────────────────────────────────
    if(mob.isBoss){
      if(mob.hornetSpinCooldown === undefined) mob.hornetSpinCooldown = HORNET_SPIN_COOLDOWN;
      if(mob.shootState !== 'spin') mob.hornetSpinCooldown -= dt;

      if(mob.shootState === 'spin'){
        // Spin at the normal turn rate but full-throttle every frame
        const SPIN_RATE = 0.08; // same as TURN_RATE
        mob.facing += SPIN_RATE * (dt / 16.67); // framerate-independent
        mob.hornetSpinRotated = (mob.hornetSpinRotated ?? 0) + SPIN_RATE * (dt / 16.67);
        mob.wobblePhase = (mob.wobblePhase || 0) + 0.08;

        // Shoot every 500ms during spin — in direction mob is facing (stinger side)
        mob.hornetSpinShootTimer = (mob.hornetSpinShootTimer ?? 0) - dt;
        if(mob.hornetSpinShootTimer <= 0){
          mob.hornetSpinShootTimer = HORNET_SPIN_SHOOT_MS;
          const fireAngle = mob.facing + Math.PI; // stinger side
          const dr = mob.drawRadius ?? mob.radius;
          const stingerTipDist = dr * (1.35 + 0.90);
          const sx2 = mob.x + Math.cos(fireAngle) * stingerTipDist;
          const sy2 = mob.y + Math.sin(fireAngle) * stingerTipDist;
          const t2 = mob.tier ?? 0;
          const hs2 = MOB_STATS.hornet;
          missiles.push({
            x: sx2, y: sy2,
            vx: Math.cos(fireAngle) * MISSILE_SPEED,
            vy: Math.sin(fireAngle) * MISSILE_SPEED,
            hp: hs2.missileHp[t2], maxHp: hs2.missileHp[t2],
            damage: hs2.missileDmg[t2],
            armor: hs2.armor[t2],
            radius: Math.max(4, Math.round((mob.drawRadius ?? mob.radius) * 0.38)),
            stingerR: mob.drawRadius ?? mob.radius,
            fromMobId: mob.id,
            rarity: mob.rarity,
            tier: t2,
            lifetime: MISSILE_LIFETIME,
            dead: false,
            angle: fireAngle,
          });
          mob.stingerProgress = 0;
        }

        // Done after HORNET_SPIN_REVS full rotations
        if(mob.hornetSpinRotated >= Math.PI * 2 * HORNET_SPIN_REVS){
          mob.shootState = 'reset';
          mob.shootTimer = 0;
          mob.stingerProgress = 0;
          mob.hornetSpinCooldown = HORNET_SPIN_COOLDOWN;
        }
        continue; // skip normal state machine this tick
      }

      // Trigger spin when cooldown elapsed and alerted
      if(mob.hornetSpinCooldown <= 0 && mob.alerted){
        mob.shootState = 'spin';
        mob.hornetSpinRotated = 0;
        mob.hornetSpinShootTimer = 0; // shoot immediately on first frame
        continue;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const angleToTarget=Math.atan2(dy,dx);
    // Stinger toward target → antenna points AWAY → facing = angleToTarget + PI
    const aimFacing=angleToTarget+Math.PI;

    // Helper: fixed-rate rotation toward a target angle, returns remaining error
    function rotateTo(target) {
      let fd=target-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),TURN_RATE);
      return Math.abs(fd);
    }

    switch(mob.shootState){
      case 'approach': {
        // Move to preferred distance — stationary hornets skip movement
        if(!mob.isStationary && dist>hornetPreferredDist+40){
          const nx=mob.x+(dx/dist)*hEffSpeed;
          const ny=mob.y+(dy/dist)*hEffSpeed;
          if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
          else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
          else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
        }
        rotateTo(mob.isStationary ? aimFacing : angleToTarget);
        mob.wobblePhase=(mob.wobblePhase||0)+0.12;
        if(mob.isStationary || dist<=hornetPreferredDist+40){ mob.shootState='aim'; mob.shootTimer=0; }
        break;
      }
      case 'aim': {
        // Rotate stinger to face player — stop moving entirely
        const err=rotateTo(aimFacing);
        mob.wobblePhase=(mob.wobblePhase||0)+0.06;
        // Only count hold time when fully aimed; reset timer if still turning
        if(err<0.03){
          mob.shootTimer+=dt;
          if(mob.shootTimer>=HORNET_AIM_HOLD_MS){ mob.shootState='fire'; mob.shootTimer=0; }
        } else {
          mob.shootTimer=0; // keep waiting until truly aimed
        }
        break;
      }
      case 'fire': {
        // Spawn missile from stinger tip (updated proportions: ry=1.35, stinger ext=0.90)
        const dr=mob.drawRadius??mob.radius;
        const stingerTipDist=dr*(1.35+0.90); // = 2.25 * drawRadius
        const fireAngle=mob.facing+Math.PI;           // tip points at player
        const tipX=mob.x+Math.cos(fireAngle)*stingerTipDist;
        const tipY=mob.y+Math.sin(fireAngle)*stingerTipDist;
        // Center hitbox on the body midpoint (len = dr*0.90, so half = dr*0.45 back from tip)
        const bodyHalfLen = dr * 0.45;
        const sx=tipX - Math.cos(fireAngle)*bodyHalfLen;
        const sy=tipY - Math.sin(fireAngle)*bodyHalfLen;
        const t=mob.tier??0;
        const hs=MOB_STATS.hornet;
        const mScale=RADIUS_SCALE[t]??1;
        missiles.push({
          x:sx, y:sy,
          vx:Math.cos(fireAngle)*MISSILE_SPEED,
          vy:Math.sin(fireAngle)*MISSILE_SPEED,
          hp:hs.missileHp[t], maxHp:hs.missileHp[t],
          damage:hs.missileDmg[t],
          armor:hs.armor[t],
          // Match visual stinger proportions: width = mobR * 0.38 (use drawRadius for exact match)
          radius: Math.max(4, Math.round((mob.drawRadius ?? mob.radius) * 0.38)),
          stingerR:mob.drawRadius??mob.radius,                 // visual scale = match hornet stinger exactly
          bodyHalfLen,                                         // offset tip draw position from center
          fromMobId:mob.id,
          rarity:mob.rarity,
          tier:t,
          lifetime:MISSILE_LIFETIME,
          dead:false,
          angle:fireAngle,
        });
        mob.stingerProgress=0;
        mob.shootState='reset';
        mob.shootTimer=0;
        break;
      }
      case 'reset': {
        // Rotate back to normal facing (antenna toward target) while regrowing stinger
        const err=rotateTo(angleToTarget);
        mob.shootTimer+=dt;
        mob.stingerProgress=Math.min(1, mob.shootTimer/HORNET_REGROW_MS);
        mob.wobblePhase=(mob.wobblePhase||0)+0.05;
        // Must BOTH fully rotate back AND fully regrow before firing again
        if(mob.stingerProgress>=1 && err<0.04){
          mob.shootState=(dist>hornetPreferredDist+80)?'approach':'aim';
          mob.shootTimer=0;
        }
        break;
      }
      default: mob.shootState='approach';
    }
  }

  // ── Scorpion AI ───────────────────────────────────────────────────────────
  // Ranged like a hornet (fires the same stinger-style missile), but:
  //  - holds a much closer preferred distance (~140 units, "3 players away")
  //  - never retreats once at range, even if the player closes in further
  //  - fires irregularly rather than on a steady aim/hold/fire cycle
  //  - drifts side-to-side subtly while at range
  //  - occasionally lunges forward unpredictably; a lunge that connects with
  //    the player deals contact damage (contactDps, same as normal mob touch)
  const SCORPION_PREFERRED_DIST_MULT = 6.4;  // ×drawRadius — scales with rarity/size (was a flat 140, wrong for bigger tiers)
  const SCORPION_FIRE_MIN_MS    = 1400;  // irregular fire — min gap between shots
  const SCORPION_FIRE_MAX_MS    = 3600;  // irregular fire — max gap between shots
  const SCORPION_LUNGE_MIN_MS   = 2200;  // min gap between lunges
  const SCORPION_LUNGE_MAX_MS   = 6000;  // max gap between lunges
  const SCORPION_LUNGE_DIST_MULT = 1.15; // lunge reaches 15% further out than the preferred stand-away distance

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='scorpion') continue;

    // ── Boss Scorpion: missile-circle burst every 15s — fires 3 rings, 0.3s
    // apart, while still able to move/act normally the rest of the time (not
    // a blocking state, just a parallel timer checked every tick regardless
    // of what the approach/hold/lunge state machine is doing).
    if(mob.isBoss){
      const SCORPION_CIRCLE_COOLDOWN   = 15000;
      const SCORPION_CIRCLE_COUNT      = 30;
      const SCORPION_CIRCLE_VOLLEYS    = 3;
      const SCORPION_CIRCLE_VOLLEY_GAP = 1000; // ms between each of the 3 rings

      function fireScorpionRing(){
        const dr=mob.drawRadius??mob.radius;
        const t=mob.tier??0;
        const ss=MOB_STATS.scorpion;
        const muzzleDist=dr*0.5; // fired from the body center outward, not the mandible muzzle — it's an all-around burst
        for(let i=0;i<SCORPION_CIRCLE_COUNT;i++){
          const angle=(Math.PI*2/SCORPION_CIRCLE_COUNT)*i;
          const sx=mob.x+Math.cos(angle)*muzzleDist;
          const sy=mob.y+Math.sin(angle)*muzzleDist;
          missiles.push({
            x:sx, y:sy,
            vx:Math.cos(angle)*MISSILE_SPEED,
            vy:Math.sin(angle)*MISSILE_SPEED,
            hp:ss.missileHp[t], maxHp:ss.missileHp[t],
            damage:ss.dmg[t],
            armor:ss.armor[t],
            radius: Math.max(2.5, Math.round(dr*0.18)),
            stingerR:dr*0.45,
            bodyHalfLen:dr*0.09,
            fromMobId:mob.id,
            rarity:mob.rarity,
            tier:t,
            lifetime:MISSILE_LIFETIME,
            dead:false,
            angle,
          });
        }
      }

      if(mob.scorpionCircleTimer === undefined) mob.scorpionCircleTimer = SCORPION_CIRCLE_COOLDOWN;
      if(mob.scorpionCircleVolleysLeft === undefined) mob.scorpionCircleVolleysLeft = 0;

      if(mob.scorpionCircleVolleysLeft > 0){
        // Mid-sequence: count down the gap between rings, independent of the main cooldown
        mob.scorpionCircleVolleyGapTimer -= dt;
        if(mob.scorpionCircleVolleyGapTimer <= 0){
          fireScorpionRing();
          mob.scorpionCircleVolleysLeft--;
          mob.scorpionCircleVolleyGapTimer = SCORPION_CIRCLE_VOLLEY_GAP;
        }
      } else {
        mob.scorpionCircleTimer -= dt;
        if(mob.scorpionCircleTimer <= 0){
          mob.scorpionCircleTimer = SCORPION_CIRCLE_COOLDOWN;
          // Fire the first ring immediately, queue the remaining 2 on the gap timer
          fireScorpionRing();
          mob.scorpionCircleVolleysLeft = SCORPION_CIRCLE_VOLLEYS - 1;
          mob.scorpionCircleVolleyGapTimer = SCORPION_CIRCLE_VOLLEY_GAP;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Scales with the mob's actual drawn size, same pattern as hornetPreferredDist —
    // otherwise a high-rarity (visually much bigger) scorpion ends up standing
    // closer than its own body width, which looked wrong. Bosses get an extra
    // dampening factor here — their drawRadius is already 1.5x bigger, and
    // applying the same multiplier on top of that made them hold so far back
    // it looked like they weren't approaching/chasing normally. Dampened so a
    // boss only stands ~7-8% further than a normal scorpion, not the full 50%.
    const BOSS_PREFERRED_DIST_DAMPEN = 0.7167;
    const scorpionPreferredDist = (mob.drawRadius ?? mob.radius ?? 22) * SCORPION_PREFERRED_DIST_MULT * (mob.isBoss ? BOSS_PREFERRED_DIST_DAMPEN : 1);
    const scorpionLungeDist = scorpionPreferredDist * SCORPION_LUNGE_DIST_MULT;

    let targetX = playerX, targetY = playerY;
    let dist = Math.hypot(playerX-mob.x, playerY-mob.y);
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const dnpc = Math.hypot(_npcTarget.x-mob.x, _npcTarget.y-mob.y);
      if (dnpc < dist) { targetX = _npcTarget.x; targetY = _npcTarget.y; dist = dnpc; }
    }
    const dx = targetX-mob.x, dy = targetY-mob.y;
    if(dist>9000) continue; // AI_CULL_DIST, matches hornet's culling range

    // De-aggro / aggro, same thresholds as other ranged mobs
    if(mob.alerted && dist>1200){
      mob.alerted=false; mob.scorpionState='idle';
      mob.wanderAngle=mob.facing; mob.wanderTimer=800;
    }
    if(!mob.alerted && dist<mob.aggroRange){
      mob.alerted=true; mob.scorpionState='approach';
      mob.scorpionFireTimer = SCORPION_FIRE_MIN_MS + Math.random()*(SCORPION_FIRE_MAX_MS-SCORPION_FIRE_MIN_MS);
      mob.scorpionLungeTimer = SCORPION_LUNGE_MIN_MS + Math.random()*(SCORPION_LUNGE_MAX_MS-SCORPION_LUNGE_MIN_MS);
    }

    if(!mob.alerted){
      // Wander, matching the generic idle-wander pattern used elsewhere
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=1200+Math.random()*2500; }
      const nx=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      const ny=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      let fd=mob.wanderAngle-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),0.08);
      continue;
    }

    const angleToTarget=Math.atan2(dy,dx);
    // Mandibles lead: default facing points straight at the target, matching
    // the ant/centipede convention (see drawCentipedeHead's "+x = forward").
    // No separate aim/turn step exists anymore — it fires straight out of
    // whatever direction it's currently facing/moving in.

    function scorpionRotateTo(target){
      let fd=target-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),0.08);
      return Math.abs(fd);
    }

    // Mandible chatter runs continuously regardless of state or movement,
    // same as the ants' constant pincer animation.
    mob.pincerPhase=(mob.pincerPhase??0)+0.10;

    // ── Lunge takes priority over everything else while active ────────────────
    if(mob.scorpionState==='lunge'){
      const preLx=mob.x, preLy=mob.y;
      mob.scorpionLungeElapsed=(mob.scorpionLungeElapsed??0)+dt;
      // Walks forward at normal speed until it's covered scorpionLungeDist (15%
      // further than its own stand-away distance), then walks back the same
      // way — a real step, not a fast teleport-lerp, and its reach scales with
      // body size/rarity same as the stand-away distance does.
      // Fully committed once started: facing is locked to the lunge angle for
      // the whole thing, no turning or re-steering mid-lunge.
      mob.scorpionLungeTraveled=(mob.scorpionLungeTraveled??0);
      const movingOut = !mob.scorpionLungeReturning;
      mob.facing=mob.scorpionLungeAngle; // locked, mandibles point the lunge direction throughout
      const stepAngle = movingOut ? mob.scorpionLungeAngle : mob.scorpionLungeAngle+Math.PI;
      const lx=mob.x+Math.cos(stepAngle)*mob.speed;
      const ly=mob.y+Math.sin(stepAngle)*mob.speed;
      // Moving mob.x/y into the player here is enough — the generic mob→player
      // contact-damage pass in combat.js applies contactDps on overlap for any
      // mob, so a connecting lunge already deals damage with no extra wiring.
      const moved = canMoveTo(lx,ly,mob.radius);
      if(moved){ mob.x=lx; mob.y=ly; mob.scorpionLungeTraveled+=mob.speed; }
      else { mob.scorpionLungeTraveled=scorpionLungeDist; } // blocked — treat as having reached the end, don't get stuck
      if(movingOut && mob.scorpionLungeTraveled>=scorpionLungeDist){
        mob.scorpionLungeReturning=true;
        mob.scorpionLungeTraveled=0;
      }
      // Leg speed scales with how fast it's actually moving this tick, same
      // pattern as the ants/beetle (speedFactor off actual displacement).
      {
        const lspd=Math.hypot(mob.x-preLx, mob.y-preLy);
        const speedFactor=Math.min(4.0, lspd/mob.baseSpeed*2.5);
        mob.legPhase=(mob.legPhase??0)+0.24*Math.max(1, speedFactor);
      }
      // Lunge ends once it's walked back the same distance it went out, or as
      // a safety net if something's preventing it from ever completing normally.
      const lungeStuck = mob.scorpionLungeElapsed > 4000;
      if((mob.scorpionLungeReturning && mob.scorpionLungeTraveled>=scorpionLungeDist) || lungeStuck){
        mob.scorpionState='hold';
        mob.scorpionLungeElapsed=0;
        mob.scorpionLungeTraveled=0;
        mob.scorpionLungeReturning=false;
        mob.scorpionLungeTimer = SCORPION_LUNGE_MIN_MS + Math.random()*(SCORPION_LUNGE_MAX_MS-SCORPION_LUNGE_MIN_MS);
      }
      continue;
    }

    switch(mob.scorpionState){
      case 'approach': {
        if(dist>scorpionPreferredDist){
          const preAx=mob.x, preAy=mob.y;
          const nx=mob.x+(dx/dist)*mob.speed;
          const ny=mob.y+(dy/dist)*mob.speed;
          if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
          else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
          else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
          const aspd=Math.hypot(mob.x-preAx, mob.y-preAy);
          const speedFactor=Math.min(4.0, aspd/mob.baseSpeed*2.5);
          mob.legPhase=(mob.legPhase??0)+0.16*Math.max(1, speedFactor);
        }
        scorpionRotateTo(angleToTarget); // mandibles-first while closing distance
        // Once inside preferred range, hold ground permanently — no retreat state exists
        if(dist<=scorpionPreferredDist){ mob.scorpionState='hold'; }
        break;
      }
      case 'hold': {
        // Never approaches or retreats WHILE the player stays within roughly
        // double the preferred distance — but if they get meaningfully
        // further than that, it resumes walking/chasing rather than just
        // standing there relying on the occasional lunge to close distance.
        if(dist > scorpionPreferredDist * 2){
          mob.scorpionState='approach';
          break;
        }
        scorpionRotateTo(angleToTarget);

        // Irregular fire — counts down on its own clock, independent of lunges.
        // Fires immediately from wherever it's currently facing/moving — no
        // reorientation step, so it never stops and turns to aim.
        mob.scorpionFireTimer=(mob.scorpionFireTimer??2000)-dt;
        if(mob.scorpionFireTimer<=0){
          mob.scorpionState='fire';
          mob.scorpionFireTimer=0;
        }

        // Rare random lunge — infrequent, per your "not often"
        mob.scorpionLungeTimer=(mob.scorpionLungeTimer??3000)-dt;
        if(mob.scorpionLungeTimer<=0){
          mob.scorpionState='lunge';
          mob.scorpionLungeElapsed=0;
          // Lunges are semi-random in direction, biased toward the player
          mob.scorpionLungeAngle=angleToTarget+(Math.random()-0.5)*0.9;
        }
        break;
      }
      case 'fire': {
        // Fires from the front of the body (between the mandibles), straight
        // in whatever direction the scorpion currently faces — no aim/turn
        // step, so it keeps standing put right through the shot. Doesn't
        // guarantee a hit; the player has to actually be in front of it.
        const dr=mob.drawRadius??mob.radius;
        const fireAngle=mob.facing;
        const muzzleDist=dr*0.95; // roughly the mandible tips, front-center
        const sx=mob.x+Math.cos(fireAngle)*muzzleDist;
        const sy=mob.y+Math.sin(fireAngle)*muzzleDist;
        const bodyHalfLen=dr*0.09; // small forward offset so drawMissile's tip sits just past the muzzle point (scaled down to match the smaller stingerR)
        const t=mob.tier??0;
        const ss=MOB_STATS.scorpion;
        missiles.push({
          x:sx, y:sy,
          vx:Math.cos(fireAngle)*MISSILE_SPEED,
          vy:Math.sin(fireAngle)*MISSILE_SPEED,
          hp:ss.missileHp[t], maxHp:ss.missileHp[t], // real durability now — was 1, died to a single petal touch
          damage:ss.dmg[t],
          armor:ss.armor[t],
          radius: Math.max(2.5, Math.round(dr*0.18)), // quite a bit smaller than hornet's stinger (was 0.38)
          stingerR:dr*0.45, // shrinks the drawn size to match — was the full body radius, made it look oversized
          bodyHalfLen,
          fromMobId:mob.id,
          rarity:mob.rarity,
          tier:t,
          lifetime:MISSILE_LIFETIME,
          dead:false,
          angle:fireAngle,
        });
        mob.scorpionState='hold';
        mob.scorpionFireTimer = SCORPION_FIRE_MIN_MS + Math.random()*(SCORPION_FIRE_MAX_MS-SCORPION_FIRE_MIN_MS);
        break;
      }
      default: mob.scorpionState='approach';
    }
  }

  // ── Starfish AI: passive wander/chase like any normal mob, but once HP
  // drops below 40% it turns and retreats a short distance from its target
  // instead, healing 5% max HP per second until it's back to full (100%)
  // HP. Pulled out of the generic movement loop (see the 'starfish' continue
  // above) purely because that loop has no concept of "flee" — normal
  // movement here otherwise mirrors the generic wander/chase pattern
  // exactly. ─────────────────────────────────────────────────────────────
  const STARFISH_FLEE_HP_FRAC   = 0.40;  // below this fraction of max HP, START fleeing
  const STARFISH_FLEE_HP_RECOVER= 1.00;  // heals all the way to full HP before it STOPS fleeing
  // (a gap between start/stop thresholds — "hysteresis" — so it doesn't
  // flicker in and out of flee state every tick right at the 40% line while
  // its own healing pushes HP back and forth across a single threshold)
  const STARFISH_FLEE_DIST      = 220;   // retreats to roughly this far from its target, then holds
  const STARFISH_HEAL_PCT_PER_S = 0.05;  // 5% of max HP per second while fleeing

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='starfish') continue;

    let targetX=playerX, targetY=playerY;
    let tDist=Math.hypot(playerX-mob.x, playerY-mob.y);
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const pick = pickWaveTarget(mob, mob.x, mob.y, playerX, playerY);
      targetX = pick.targetX; targetY = pick.targetY; tDist = pick.dist; mob.waveTarget = pick.kind;
    }
    const dx=targetX-mob.x, dy=targetY-mob.y, dist=Math.hypot(dx,dy);
    if(dist>AI_CULL_DIST) continue;

    const isWaveNPCChase = isWaveMapMode() && mob.waveTarget !== 'player';
    if(mob.alerted && dist>DEAGGRO_DIST && !isWaveNPCChase){
      mob.alerted=false; mob.wanderAngle=mob.facing; mob.wanderTimer=800;
      mob.starfishFleeing=false;
    }

    const hpFrac = mob.maxHp>0 ? mob.hp/mob.maxHp : 1;
    // Sticky flee state: once triggered below STARFISH_FLEE_HP_FRAC, stays
    // fleeing until healed back up to STARFISH_FLEE_HP_RECOVER, rather than
    // re-checking the raw threshold every tick (see hysteresis note above).
    if(!mob.starfishFleeing && hpFrac < STARFISH_FLEE_HP_FRAC) mob.starfishFleeing = true;
    else if(mob.starfishFleeing && hpFrac >= STARFISH_FLEE_HP_RECOVER) mob.starfishFleeing = false;
    const fleeing = mob.alerted && mob.starfishFleeing && dist>0.01;

    if(fleeing){
      // Heal while fleeing, same "% of max HP per second" convention used
      // elsewhere (see regen-style effects) — capped at maxHp.
      mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp*STARFISH_HEAL_PCT_PER_S*(dt/1000));
      // Retreat directly away from the target until STARFISH_FLEE_DIST clear,
      // then hold that distance (still healing) rather than fleeing forever.
      if(dist < STARFISH_FLEE_DIST){
        const nx=mob.x-(dx/dist)*mob.baseSpeed, ny=mob.y-(dy/dist)*mob.baseSpeed;
        if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
        else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
        else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      }
      mob.lastX=mob.x; mob.lastY=mob.y;
      continue;
    }

    let chasing=false;
    if(mob.aggroRange>0&&dist<mob.aggroRange&&dist>0.01){chasing=true;mob.alerted=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else if(mob.alerted){chasing=true;mob.speed=mob.alertSpeed||mob.baseSpeed;}
    else mob.speed=mob.baseSpeed;

    const slowFactor = Math.max(getWebSlowdownFactor(mob.x, mob.y), getPincerSlowFactor(mob.id));
    mob.speed *= (1 - slowFactor);

    if(chasing && dist>0.01){
      const nx=mob.x+(dx/dist)*mob.speed, ny=mob.y+(dy/dist)*mob.speed;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
    } else {
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=1200+Math.random()*2500; }
      const nx=mob.x+Math.cos(mob.wanderAngle)*mob.speed, ny=mob.y+Math.sin(mob.wanderAngle)*mob.speed;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
    }
    mob.lastX=mob.x; mob.lastY=mob.y;
  }

  // ── Debris AI: pure drift, no aggro, no target, no chase — ever. Picks a
  // random direction, holds it for a while, picks a new one, forever. Spins
  // continuously and slowly the whole time, independent of drift direction
  // (junk tumbling in the current doesn't necessarily face the way it's
  // moving). Deliberately has no aggroRange/alerted/waveTarget handling at
  // all — unlike jellyfish/crab/starfish, which all engage something once
  // in range, debris is inert scenery that merely happens to move. ────────
  const DEBRIS_SPIN_RATE = 0.006; // slow, lazy tumble — about 1 full turn every 1000 ticks
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='debris') continue;
    mob.wanderTimer-=dt;
    if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=1500+Math.random()*3000; }
    const nx=mob.x+Math.cos(mob.wanderAngle)*mob.speed, ny=mob.y+Math.sin(mob.wanderAngle)*mob.speed;
    if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
    else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
    else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
    mob.facing=(mob.facing||0)+DEBRIS_SPIN_RATE;
    mob.lastX=mob.x; mob.lastY=mob.y;
  }

  // ── Bubble AI: pure drift, no aggro, no target, no chase — ever, even
  // after being hit. Same "inert scenery that merely happens to move"
  // design as debris above, but noticeably gentler/subtler: slower wander
  // speed, longer holds between direction changes, and no spin at all
  // (a bubble doesn't tumble the way a chunk of junk does). Previously
  // bubble had aggroRange:0 (so it never woke up UNTIL hit) but nothing
  // stopped it from chasing once mob.alerted got set by taking damage —
  // this removes that possibility entirely by never giving it a chasing
  // branch at all, matching "should never aggro, just drift" exactly. ────
  const BUBBLE_DRIFT_SPEED_MULT = 0.5; // drifts at half its already-slow base speed, for a subtler feel
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='bubble') continue;
    mob.wanderTimer-=dt;
    if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=2500+Math.random()*4000; }
    const driftSpeed=mob.baseSpeed*BUBBLE_DRIFT_SPEED_MULT;
    const nx=mob.x+Math.cos(mob.wanderAngle)*driftSpeed, ny=mob.y+Math.sin(mob.wanderAngle)*driftSpeed;
    if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
    else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
    else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
    mob.lastX=mob.x; mob.lastY=mob.y;
  }

  // ── Shell AI: sits completely motionless until hit (aggroRange:0, so the
  // generic loop's proximity check never wakes it — only a petal hit setting
  // mob.alerted=true does). Once alerted, every SHELL_PUSH_INTERVAL (measured
  // from the START of one push to the START of the next, not gap-between-
  // pushes) it gets shoved toward its target: a real WALKED burst at
  // alertSpeed for SHELL_PUSH_DURATION, using the same canMoveTo checks
  // every other mob uses, NOT a teleport/position-snap — so it can genuinely
  // be blocked by a wall or held back mid-push, same as any other moving
  // mob. Between pushes it's fully still again, not sliding or drifting.
  // Also rotates to face its target once aggroed, using the same diff*0.08
  // smoothing convergence every other rotating mob (squid, alligator,
  // jellyfish) in this file already uses — this runs every tick it's
  // alerted, not just during the push windows, so it visibly turns to face
  // its target the instant it wakes up, before its first push even fires. ──
  const SHELL_PUSH_INTERVAL = 700;  // ms from one push's start to the next push's start
  const SHELL_PUSH_DURATION = 300;  // ms each push's walked burst lasts — bumped from 200 (+50%) for a "1.5x further per jump" request; same alertSpeed, just held for longer, so it still reads as walking rather than a faster dash
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='shell') continue;
    if(!mob.alerted) continue; // stays fully motionless until a hit sets this externally

    let targetX=playerX, targetY=playerY;
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const pick = pickWaveTarget(mob, mob.x, mob.y, playerX, playerY);
      targetX = pick.targetX; targetY = pick.targetY;
    }

    const facingDx=targetX-mob.x, facingDy=targetY-mob.y;
    if(Math.hypot(facingDx,facingDy)>0.01){
      const targetFacing=Math.atan2(facingDy,facingDx);
      let facingDiff=targetFacing-(mob.facing||0);
      if(facingDiff>Math.PI) facingDiff-=Math.PI*2;
      if(facingDiff<-Math.PI) facingDiff+=Math.PI*2;
      mob.facing=(mob.facing||0)+facingDiff*0.08;
    }

    // shellPushTimer counts down continuously (every tick, whether currently
    // pushing or idle) and fires a new push each time it crosses zero — this
    // is what makes SHELL_PUSH_INTERVAL a true "every 0.7s" cadence measured
    // start-to-start, rather than accidentally adding the push's own
    // duration on top of the gap between pushes.
    if(mob.shellPushTimer===undefined) mob.shellPushTimer = SHELL_PUSH_INTERVAL;
    if(mob.shellPushRemaining===undefined) mob.shellPushRemaining = 0;

    mob.shellPushTimer-=dt;
    if(mob.shellPushTimer<=0){
      mob.shellPushTimer+=SHELL_PUSH_INTERVAL; // += (not =) so any overshoot this tick doesn't drift the cadence
      mob.shellPushRemaining=SHELL_PUSH_DURATION;
      const ddx=targetX-mob.x, ddy=targetY-mob.y, ddist=Math.hypot(ddx,ddy);
      if(ddist>0.01){ mob.shellPushDirX=ddx/ddist; mob.shellPushDirY=ddy/ddist; }
      else { mob.shellPushDirX=0; mob.shellPushDirY=0; }
    }

    if(mob.shellPushRemaining>0){
      // Mid-push: walk toward the locked push direction at alertSpeed, same
      // canMoveTo fallback pattern as every other mob — a wall or being
      // otherwise blocked genuinely stops/holds it back, no forced movement.
      const dx=mob.shellPushDirX??0, dy=mob.shellPushDirY??0;
      const nx=mob.x+dx*mob.alertSpeed, ny=mob.y+dy*mob.alertSpeed;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      mob.shellPushRemaining-=dt;
    }
    mob.lastX=mob.x; mob.lastY=mob.y;
  }

  // ── Crab AI: scorpion-style stand-and-poke, but melee instead of ranged.
  // Approaches to a preferred distance and holds it, juking left-right while
  // it waits (facing stays locked on the target throughout, only the crab's
  // position slides side to side — same silhouette-facing convention as the
  // sideways-skitter its sprite/legPhase animation already implies), then
  // occasionally charges straight forward through the target and back,
  // structurally identical to scorpion's lunge (a real walked step at normal
  // speed, not a lerp/teleport) but melee: connecting relies on the generic
  // mob→player contact-damage pass in combat.js, no missile involved. ──────
  const CRAB_PREFERRED_DIST_MULT = 1.6;   // ×drawRadius — melee range: close enough that the side-to-side dodge stays a real threat, not scorpion's ranged stand-off
  const CRAB_DODGE_MIN_MS  = 700;         // irregular side-to-side dodge — min gap between direction flips
  const CRAB_DODGE_MAX_MS  = 1400;        // irregular side-to-side dodge — max gap between direction flips
  const CRAB_DODGE_SPEED_MULT = 1.6;      // dodge steps are quicker than its normal walk speed
  const CRAB_CHARGE_MIN_MS = 2400;        // min gap between charges
  const CRAB_CHARGE_MAX_MS = 5200;        // max gap between charges
  const CRAB_CHARGE_DIST_MULT = 1.2;      // charge reaches 20% further than the preferred stand-away distance

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='crab') continue;

    const crabPreferredDist = (mob.drawRadius ?? mob.radius ?? 22) * CRAB_PREFERRED_DIST_MULT;
    const crabChargeDist = crabPreferredDist * CRAB_CHARGE_DIST_MULT;

    let targetX=playerX, targetY=playerY;
    let dist=Math.hypot(playerX-mob.x, playerY-mob.y);
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead) {
      const dnpc=Math.hypot(_npcTarget.x-mob.x, _npcTarget.y-mob.y);
      if(dnpc<dist){ targetX=_npcTarget.x; targetY=_npcTarget.y; dist=dnpc; }
    }
    const dx=targetX-mob.x, dy=targetY-mob.y;
    if(dist>AI_CULL_DIST) continue;

    if(mob.alerted && dist>DEAGGRO_DIST){
      mob.alerted=false; mob.crabState='idle';
      mob.wanderAngle=mob.facing; mob.wanderTimer=800;
    }
    if(!mob.alerted && dist<mob.aggroRange){
      mob.alerted=true; mob.crabState='approach';
      mob.crabDodgeTimer = CRAB_DODGE_MIN_MS + Math.random()*(CRAB_DODGE_MAX_MS-CRAB_DODGE_MIN_MS);
      mob.crabDodgeDir = Math.random()<0.5 ? -1 : 1;
      mob.crabChargeTimer = CRAB_CHARGE_MIN_MS + Math.random()*(CRAB_CHARGE_MAX_MS-CRAB_CHARGE_MIN_MS);
    }

    if(!mob.alerted){
      mob.wanderTimer-=dt;
      if(mob.wanderTimer<=0){ mob.wanderAngle=Math.random()*Math.PI*2; mob.wanderTimer=1200+Math.random()*2500; }
      const preWx=mob.x, preWy=mob.y;
      const nx=mob.x+Math.cos(mob.wanderAngle)*mob.speed*0.45;
      const ny=mob.y+Math.sin(mob.wanderAngle)*mob.speed*0.45;
      if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
      else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
      else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
      let fd=mob.wanderAngle-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),0.08);
      // Legs keep shuffling while wandering too, not just while aggroed —
      // same speed-scaled convention used everywhere else in this block.
      const wspd=Math.hypot(mob.x-preWx, mob.y-preWy);
      if(wspd>0.05){
        const speedFactor=Math.min(4.0, wspd/mob.baseSpeed*2.5);
        mob.legPhase=(mob.legPhase??0)+0.20*Math.max(1, speedFactor);
      }
      continue;
    }

    const angleToTarget=Math.atan2(dy,dx);
    function crabRotateTo(target){
      let fd=target-mob.facing;
      if(fd>Math.PI)fd-=Math.PI*2; if(fd<-Math.PI)fd+=Math.PI*2;
      mob.facing+=Math.sign(fd)*Math.min(Math.abs(fd),0.08);
    }

    // ── Charge takes priority over everything else while active ───────────
    if(mob.crabState==='charge'){
      const preCx=mob.x, preCy=mob.y;
      mob.crabChargeElapsed=(mob.crabChargeElapsed??0)+dt;
      mob.crabChargeTraveled=(mob.crabChargeTraveled??0);
      const movingOut = !mob.crabChargeReturning;
      mob.facing=mob.crabChargeAngle; // locked for the whole charge, same as scorpion's lunge
      const stepAngle = movingOut ? mob.crabChargeAngle : mob.crabChargeAngle+Math.PI;
      const lx=mob.x+Math.cos(stepAngle)*mob.speed;
      const ly=mob.y+Math.sin(stepAngle)*mob.speed;
      const moved=canMoveTo(lx,ly,mob.radius);
      if(moved){ mob.x=lx; mob.y=ly; mob.crabChargeTraveled+=mob.speed; }
      else { mob.crabChargeTraveled=crabChargeDist; }
      if(movingOut && mob.crabChargeTraveled>=crabChargeDist){
        mob.crabChargeReturning=true;
        mob.crabChargeTraveled=0;
      }
      {
        const cspd=Math.hypot(mob.x-preCx, mob.y-preCy);
        const speedFactor=Math.min(4.0, cspd/mob.baseSpeed*2.5);
        mob.legPhase=(mob.legPhase??0)+0.24*Math.max(1, speedFactor);
      }
      const chargeStuck = mob.crabChargeElapsed > 4000;
      if((mob.crabChargeReturning && mob.crabChargeTraveled>=crabChargeDist) || chargeStuck){
        mob.crabState='hold';
        mob.crabChargeElapsed=0;
        mob.crabChargeTraveled=0;
        mob.crabChargeReturning=false;
        mob.crabChargeTimer = CRAB_CHARGE_MIN_MS + Math.random()*(CRAB_CHARGE_MAX_MS-CRAB_CHARGE_MIN_MS);
      }
      continue;
    }

    switch(mob.crabState){
      case 'approach': {
        if(dist>crabPreferredDist){
          const preAx=mob.x, preAy=mob.y;
          const nx=mob.x+(dx/dist)*mob.speed, ny=mob.y+(dy/dist)*mob.speed;
          if(canMoveTo(nx,ny,mob.radius)){mob.x=nx;mob.y=ny;}
          else if(canMoveTo(nx,mob.y,mob.radius)){mob.x=nx;}
          else if(canMoveTo(mob.x,ny,mob.radius)){mob.y=ny;}
          const aspd=Math.hypot(mob.x-preAx, mob.y-preAy);
          const speedFactor=Math.min(4.0, aspd/mob.baseSpeed*2.5);
          mob.legPhase=(mob.legPhase??0)+0.20*Math.max(1, speedFactor);
        }
        crabRotateTo(angleToTarget);
        if(dist<=crabPreferredDist){ mob.crabState='hold'; }
        break;
      }
      case 'hold': {
        if(dist > crabPreferredDist * 2){
          mob.crabState='approach';
          break;
        }
        crabRotateTo(angleToTarget);

        // Quick side-to-side dodge while holding ground: steps mostly
        // perpendicular to the facing direction, flipping which way every
        // CRAB_DODGE_MIN/MAX_MS. Also gently corrects toward crabPreferredDist
        // (blended in alongside the perpendicular step, not a separate
        // accept/reject gate) so a charge that comes back slightly off
        // distance — e.g. the target moved mid-charge — self-corrects over
        // the next dodge or two instead of ever getting permanently stuck
        // between the preferred distance and the 2x re-approach threshold.
        mob.crabDodgeTimer=(mob.crabDodgeTimer??1000)-dt;
        if(mob.crabDodgeTimer<=0){
          mob.crabDodgeDir = -(mob.crabDodgeDir ?? 1); // flip direction
          mob.crabDodgeTimer = CRAB_DODGE_MIN_MS + Math.random()*(CRAB_DODGE_MAX_MS-CRAB_DODGE_MIN_MS);
        }
        {
          const perpAngle = mob.facing + Math.PI/2;
          const preDx=mob.x, preDy=mob.y;
          const dodgeSpeed = mob.speed * CRAB_DODGE_SPEED_MULT;
          // Radial correction toward crabPreferredDist, capped at a fraction
          // of the dodge step so it reads as a lateral juke with a slight
          // drift-correction, not a snap back to distance.
          const distErr = dist - crabPreferredDist; // >0 too far, <0 too close
          const radialStep = Math.max(-dodgeSpeed*0.6, Math.min(dodgeSpeed*0.6, distErr*0.15));
          const radialX = dist>0.01 ? (dx/dist)*radialStep : 0;
          const radialY = dist>0.01 ? (dy/dist)*radialStep : 0;
          const nx=mob.x+Math.cos(perpAngle)*mob.crabDodgeDir*dodgeSpeed+radialX;
          const ny=mob.y+Math.sin(perpAngle)*mob.crabDodgeDir*dodgeSpeed+radialY;
          if(canMoveTo(nx,ny,mob.radius)){ mob.x=nx; mob.y=ny; }
          else if(canMoveTo(nx,mob.y,mob.radius)){ mob.x=nx; }
          else if(canMoveTo(mob.x,ny,mob.radius)){ mob.y=ny; }
          const dspd=Math.hypot(mob.x-preDx, mob.y-preDy);
          const speedFactor=Math.min(4.0, dspd/mob.baseSpeed*2.5);
          if(dspd>0.05) mob.legPhase=(mob.legPhase??0)+0.20*Math.max(1, speedFactor);
        }

        // Occasional forward charge, biased toward the target like scorpion's lunge
        mob.crabChargeTimer=(mob.crabChargeTimer??3000)-dt;
        if(mob.crabChargeTimer<=0){
          mob.crabState='charge';
          mob.crabChargeElapsed=0;
          mob.crabChargeAngle=angleToTarget+(Math.random()-0.5)*0.5;
        }
        break;
      }
      default: mob.crabState='approach';
    }
  }

  // ── Jellyfish AI: fires an instant lightning zap at whatever it's aggroed
  // to once in range — can fire while drifting/moving (unlike scorpion, no
  // need to hold still first). Movement itself is still handled entirely by
  // the generic wander/chase loop above; this only layers a ranged attack on
  // top, so jellyfish is not excluded from that loop the way crab/starfish
  // are. Damage is NOT applied directly here — mobs.js has no existing path
  // that touches player.hp/npc.hp/pet.hp, and preserving that boundary means
  // invincibility/disc-block/game-over all stay handled in one place. Instead
  // this just queues the strike; combat.js's updateCombat (which runs right
  // after updateMobs, same frame — see main.js) resolves it and applies the
  // real damage, exactly like every other player-damage path already does.
  //
  // Fires on a fixed 0.5s cadence (no randomized gap, unlike scorpion/crab).
  // Zap and chain range both scale off mob.aggroRange, which is already
  // tier-scaled by AGGRO_TIER_SCALE in spawnMob — so a higher-rarity
  // jellyfish naturally reaches further with both its initial strike and its
  // chain, in the same proportion its aggro range grows. Ratios below match
  // the original fixed values at tier 0 (aggroRange 300): 260/300 for zap,
  // 140/300 for chain. ──────────────────────────────────────────────────
  const JELLYFISH_ZAP_INTERVAL_MS = 500;   // fixed cadence — fires every 0.5s once in range
  const JELLYFISH_ZAP_RANGE_FRAC   = 260/300; // × mob.aggroRange
  const JELLYFISH_CHAIN_RANGE_FRAC = 140/300; // × mob.aggroRange — a friendly pet within this range of the PRIMARY target also gets zapped

  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='jellyfish'||!mob.alerted) continue;
    // Never queue a zap while the player is dead — combat.js's updateCombat
    // (the only place that drains pendingJellyfishZaps) is skipped entirely
    // while player.dead, so without this guard the queue grows unbounded
    // for as long as the death screen is up and any jellyfish stays alerted.
    if(player.dead) continue;

    let targetX=playerX, targetY=playerY, targetKind='player';
    let dist=Math.hypot(playerX-mob.x, playerY-mob.y);
    // mob.waveTarget is already maintained by the generic wander/chase loop
    // above (which jellyfish still passes through for movement) — just read
    // it here rather than re-deriving the player/NPC choice.
    if (isWaveMapMode() && _npcTarget && !_npcTarget.dead && mob.waveTarget!=='player') {
      targetX=_npcTarget.x; targetY=_npcTarget.y; targetKind='npc';
      dist=Math.hypot(_npcTarget.x-mob.x, _npcTarget.y-mob.y);
    }

    const zapRange = (mob.aggroRange||300) * JELLYFISH_ZAP_RANGE_FRAC;
    const chainRange = (mob.aggroRange||300) * JELLYFISH_CHAIN_RANGE_FRAC;

    if(mob.jellyfishZapTimer===undefined){
      mob.jellyfishZapTimer = JELLYFISH_ZAP_INTERVAL_MS;
    }
    // Only counts down while actually in range — same convention as
    // scorpion's fire timer, which only ticks in its 'hold' state. Without
    // this, a jellyfish walking toward its target could "bank" cooldown
    // progress while still out of range and fire almost immediately the
    // instant it arrives, rather than a clean 0.5s cadence from first contact.
    if(dist>zapRange) continue;
    mob.jellyfishZapTimer -= dt;
    if(mob.jellyfishZapTimer>0) continue;
    mob.jellyfishZapTimer = JELLYFISH_ZAP_INTERVAL_MS;

    // Chain target: nearest living friendly pet within chainRange of the
    // PRIMARY target (not the jellyfish, not the player specifically — it
    // bounces off whoever/whatever got hit first).
    let chainMobId=null, chainX=null, chainY=null, bestD=chainRange;
    for(const pet of mobs){
      if(pet.dead||!pet.isFriendlyPet) continue;
      const pd=Math.hypot(pet.x-targetX, pet.y-targetY);
      if(pd<bestD){ bestD=pd; chainMobId=pet.id; chainX=pet.x; chainY=pet.y; }
    }

    pendingJellyfishZaps.push({
      jellyfishId: mob.id,
      fromX: mob.x, fromY: mob.y,
      targetKind, targetX, targetY,
      damage: mob.damage*0.8,
      chainMobId, chainX, chainY,
    });
  }

  // ── Missile updates ───────────────────────────────────────────────────────
  for(let i=missiles.length-1;i>=0;i--){
    const m=missiles[i];
    if(m.dead){missiles.splice(i,1);continue;}
    m.x+=m.vx; m.y+=m.vy;
    m.lifetime-=dt;
    if(m.lifetime<=0||m.hp<=0){missiles.splice(i,1);}
  }

  // ── Mob-mob pushing ──────────────────────────────────────────────────────
  // CELL=6000: at Runic the largest collision radius is ~2100 (spider).
  // Two Runic spiders touching = ~4200 gap. 3×3 neighbor search covers ±12000,
  // so every possible overlapping pair is found in a single neighbor hop.
  // Grid is rebuilt each iteration so mobs that crossed cell boundaries are found.
  //
  // Wall-pinning fix: when one mob is blocked by a wall it can't absorb its share
  // of the overlap, so the free mob now absorbs the FULL overlap instead of just
  // its proportional share. This makes crowds properly push things against walls
  // rather than phasing through them.
  const CELL=6000;
  for(let iter=0;iter<10;iter++){
    const grid=new Map();
    for(const mob of mobs){
      if(mob.dead) continue;
      const cx=Math.floor(mob.x/CELL), cy=Math.floor(mob.y/CELL), key=cx*100000+cy;
      if(!grid.has(key)) grid.set(key,[]);
      grid.get(key).push(mob);
    }
    for(const [key,cell] of grid){
      const cx=Math.floor(key/100000), cy=key%100000;
      const neighbours=[cell];
      for(let ox=-1;ox<=1;ox++) for(let oy=-1;oy<=1;oy++){
        if(ox===0&&oy===0) continue;
        const n=grid.get((cx+ox)*100000+(cy+oy)); if(n) neighbours.push(n);
      }
      for(let ni=0;ni<neighbours.length;ni++){
        const other=neighbours[ni];
        for(let i=0;i<cell.length;i++){
          const a=cell[i];
          for(let j=(ni===0?i+1:0);j<other.length;j++){
            const b=other[j];
            if(a===b||a.dead||b.dead) continue;
            // ant_hole, beehive and pyramid have no mob-mob collision — EXCEPT friendly pets do collide with them
            const aIsStructure = a.typeId==='ant_hole'||a.typeId==='beehive'||a.typeId==='fire_ant_hole'||a.typeId==='pyramid'||a.typeId==='shell'||a.typeId==='sponge'||a.typeId==='sea_cave'||a.typeId==='debris'||a.typeId==='rock'||a.typeId==='dandelion';
            const bIsStructure = b.typeId==='ant_hole'||b.typeId==='beehive'||b.typeId==='fire_ant_hole'||b.typeId==='pyramid'||b.typeId==='shell'||b.typeId==='sponge'||b.typeId==='sea_cave'||b.typeId==='debris'||b.typeId==='rock'||b.typeId==='dandelion';
            if((aIsStructure||bIsStructure)&&!(a.isFriendlyPet||b.isFriendlyPet)) continue;
            // Other friendly pets pass straight through friendly sandstorm pets (Stick's shield) —
            // hostile mobs still collide with them normally.
            const aIsFriendlySandstorm = a.isFriendlyPet && a.typeId==='sandstorm';
            const bIsFriendlySandstorm = b.isFriendlyPet && b.typeId==='sandstorm';
            if(aIsFriendlySandstorm && b.isFriendlyPet && b.typeId!=='sandstorm') continue;
            if(bIsFriendlySandstorm && a.isFriendlyPet && a.typeId!=='sandstorm') continue;
            if(a.typeId==='ant_egg'||b.typeId==='ant_egg'||a.typeId==='spider_egg'||b.typeId==='spider_egg'||a.typeId==='fire_ant_egg'||b.typeId==='fire_ant_egg') continue;
            const sameChain=a.chainId!=null&&a.chainId===b.chainId;
            const dx=b.x-a.x, dy=b.y-a.y, dist=Math.hypot(dx,dy), minD=a.radius+b.radius;
            if(dist>=minD||dist<0.001) continue;
            if(sameChain){
              const idxDiff=Math.abs((a.segIndex??0)-(b.segIndex??0));
              if(idxDiff<=1){
                // Adjacent segments — soft push at reduced strength to prevent clipping without fighting the follow logic
                const nx=dx/dist, ny=dy/dist, overlap=minD-dist, total=a.mass+b.mass;
                const strength=0.35; // gentler than full push
                const ax2=a.x-nx*overlap*(b.mass/total)*strength, ay2=a.y-ny*overlap*(b.mass/total)*strength;
                const bx2=b.x+nx*overlap*(a.mass/total)*strength, by2=b.y+ny*overlap*(a.mass/total)*strength;
                if(canMoveTo(ax2,ay2,a.radius)){a.x=ax2;a.y=ay2;}
                if(canMoveTo(bx2,by2,b.radius)){b.x=bx2;b.y=by2;}
                continue;
              }
              // Non-adjacent same-chain segments — full collision push (fall through)
            }
            const nx=dx/dist, ny=dy/dist, overlap=minD-dist, total=a.mass+b.mass;
            const ax=a.x-nx*overlap*(b.mass/total), ay=a.y-ny*overlap*(b.mass/total);
            const bx=b.x+nx*overlap*(a.mass/total), by=b.y+ny*overlap*(a.mass/total);
            const aCanMove=canMoveTo(ax,ay,a.radius);
            const bCanMove=canMoveTo(bx,by,b.radius);
            if(aCanMove&&bCanMove){
              a.x=ax;a.y=ay;b.x=bx;b.y=by;
            } else if(aCanMove&&!bCanMove){
              // b is wall-blocked — push a the full overlap so nothing is lost
              const ax2=a.x-nx*overlap, ay2=a.y-ny*overlap;
              if(canMoveTo(ax2,ay2,a.radius)){a.x=ax2;a.y=ay2;}
              else{a.x=ax;a.y=ay;} // wall on both sides, take a's share at minimum
            } else if(!aCanMove&&bCanMove){
              // a is wall-blocked — push b the full overlap so nothing is lost
              const bx2=b.x+nx*overlap, by2=b.y+ny*overlap;
              if(canMoveTo(bx2,by2,b.radius)){b.x=bx2;b.y=by2;}
              else{b.x=bx;b.y=by;} // wall on both sides, take b's share at minimum
            }
            // both wall-blocked: nothing to be done
          }
        }
      }
    }
  }

  // ── Facing & animation for regular mobs ───────────────────────────────────
  for(const mob of mobs){
    if(mob.dead||mob.isCentipede||mob.typeId==='hornet') continue;
    if(mob.typeId==='ant_hole'||mob.typeId==='ant_egg'||mob.typeId==='spider_egg'||mob.typeId==='beehive'||mob.typeId==='fire_ant_hole'||mob.typeId==='fire_ant_egg') continue;
    if(mob.typeId==='scorpion'||mob.typeId==='pyramid'||mob.typeId==='rock'||mob.typeId==='dandelion') continue;  // facing handled in their own AI loops
    if(mob.typeId==='crab') continue;  // facing/legPhase handled in its own AI loop, scorpion-style
    if(mob.typeId==='sponge'||mob.typeId==='sea_cave') continue;  // static ocean scenery
    if(mob.typeId==='shell') continue;  // facing handled in its own dedicated AI loop below
    if(mob.typeId==='debris') continue;  // facing (constant slow spin) handled in its own AI loop, no target-facing convergence
    if(mob.typeId==='bubble') continue;  // round with no directional art — no facing rotation needed at all
    let diff=mob.targetFacing-mob.facing;
    if(diff>Math.PI) diff-=Math.PI*2; if(diff<-Math.PI) diff+=Math.PI*2;
    if(mob.typeId==='spider'){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      if(spd>0.05) mob.legPhase+=0.07;
    } else if(mob.typeId==='bee'||mob.typeId==='queen_bee'){
      // Face targetFacing (set by AI) with smooth rotation.
      // Do NOT derive facing from (x - lastX) — collision pushes corrupt those deltas
      // and cause random rotation flips when touching other mobs.
      let diff2 = mob.targetFacing - mob.facing;
      if(diff2 > Math.PI) diff2 -= Math.PI*2; if(diff2 < -Math.PI) diff2 += Math.PI*2;
      mob.facing += diff2 * 0.08;
      mob.wobblePhase = (mob.wobblePhase || 0) + 0.20;
      // Sway ±15 degrees left/right (0.26 radians)
      const swayAmp = 0.26;
      mob.swayHitX = Math.sin(mob.wobblePhase) * swayAmp * (mob.drawRadius || mob.radius) * 0.55;
    } else if(mob.isAntMob){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      if(spd>0.05){
        // Scale animation speed with movement: faster movement = faster mandible chatter & wing flap
        const speedFactor=Math.min(4.0, spd/mob.baseSpeed * 2.5);
        mob.pincerPhase=(mob.pincerPhase||0)+0.18*speedFactor;
        mob.wingPhase  =(mob.wingPhase  ||0)+0.14*speedFactor;
      }
    } else if(mob.isFireAntMob){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      if(spd>0.05){
        const speedFactor=Math.min(4.0, spd/mob.baseSpeed * 2.5);
        mob.pincerPhase=(mob.pincerPhase||0)+0.18*speedFactor;
        mob.wingPhase  =(mob.wingPhase  ||0)+0.14*speedFactor;
      }
    } else if(mob.typeId==='beetle'||mob.typeId==='mummified_beetle'){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      if(spd>0.05){
        // Pincer animation: scale with speed so faster movement = faster clacking.
        // Shared with Mummified Beetle since it uses the identical draw code/animation.
        const speedFactor=Math.min(4.0, spd/mob.baseSpeed * 2.5);
        mob.pincerPhase=(mob.pincerPhase||0)+0.22*speedFactor;
      }
    } else if(mob.typeId==='squid'){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      // Tentacles keep a slow idle sway even at rest, and speed up when jetting.
      const speedFactor=spd>0.05 ? Math.min(4.0, spd/mob.baseSpeed * 2.5) : 1;
      mob.tentaclePhase=(mob.tentaclePhase||0)+0.05*speedFactor;
    } else if(mob.typeId==='alligator'){
      mob.facing+=diff*0.08;
      const spd=Math.hypot(mob.x-(mob.lastX||mob.x),mob.y-(mob.lastY||mob.y));
      // Tail swing + foot shuffle keep a slow idle motion even at rest, same
      // as squid's tentacles, and speed up when lunging.
      const speedFactor=spd>0.05 ? Math.min(4.0, spd/mob.baseSpeed * 2.5) : 1;
      mob.tailPhase=(mob.tailPhase||0)+0.05*speedFactor;
    } else if(mob.typeId==='jellyfish'){
      // Rotates toward whatever it's chasing, same smoothing rate as every
      // other mob (squid/alligator/etc. above) — now that drawJellyfish
      // accepts a facing param, this is visible even though the tentacle
      // ring and dot marking don't individually have a "front" (see the
      // comment on drawJellyfish for why the combined shape still reads).
      mob.facing+=diff*0.08;
      // Tentacles always undulate, whether it's drifting or holding still.
      mob.tentaclePhase=(mob.tentaclePhase||0)+0.06;
    } else if(mob.typeId==='starfish'){
      // Barely moves and has no real "direction of travel", so instead of
      // chasing targetFacing, spin continuously in place.
      mob.facing=(mob.facing||0)+0.03;
    } else if(mob.typeId==='leech'){
      // Turns toward its target same as every other regular mob; the
      // fang-vibration jitter (leechAnimPhase) runs continuously and
      // independently of movement, same convention as tentaclePhase above —
      // pincers twitch at the head whether or not the body is currently moving.
      mob.facing+=diff*0.08;
      mob.leechAnimPhase=(mob.leechAnimPhase||0)+0.05;
    } else if(mob.typeId==='sandstorm'){
      // Sandstorm facing is already smoothed in its own AI loop; skip generic update
    } else if(mob.isDesertCentipede || mob.typeId==='cactus'){
      // Desert centipede facing handled in its own AI loop; cactus is static
    } else {
      mob.facing+=diff*0.07;
    }
    mob.lastX=mob.x; mob.lastY=mob.y;
  }

  // ── Spider egg hatching ────────────────────────────────────────────────────
  // After 4s, spider eggs despawn and spawn 3 spiders one tier below (min tier 0).
  for(const mob of mobs){
    if(mob.dead || mob.typeId !== 'spider_egg') continue;
    mob.spiderEggHatchTimer -= dt;
    if(mob.spiderEggHatchTimer <= 0){
      mob.dead = true;
      const spawnTier = Math.max(0, (mob.ownerTier ?? mob.tier ?? 0) - 1);
      for(let i = 0; i < 3; i++){
        const angle = (Math.PI * 2 / 3) * i;
        const ox = Math.cos(angle) * (mob.radius * 2);
        const oy = Math.sin(angle) * (mob.radius * 2);
        const baby = spawnMob('spider', mob.x + ox, mob.y + oy, mob.homeZoneId, spawnTier);
        if(baby) baby.alerted = true;
      }
    }
  }

  // ── Ant egg hatching ──────────────────────────────────────────────────────
  // After 3.5s, each egg dies and spawns a soldier ant of the same tier.
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='ant_egg') continue;
    // Apply outward launch drift from queen spin burst
    if(mob._launchVx || mob._launchVy){
      const lnx = mob.x + (mob._launchVx ?? 0), lny = mob.y + (mob._launchVy ?? 0);
      // ~25% chance to pass through walls (egg lands inside wall)
      if(canMoveTo(lnx, lny, mob.radius) || Math.random() < 0.25){
        mob.x = lnx; mob.y = lny;
      }
      // Decay velocity so egg settles (slower decay = travels farther)
      mob._launchVx = (mob._launchVx ?? 0) * 0.88;
      mob._launchVy = (mob._launchVy ?? 0) * 0.88;
      if(Math.hypot(mob._launchVx, mob._launchVy) < 0.1){ mob._launchVx = 0; mob._launchVy = 0; }
    }
    mob.eggHatchTimer=(mob.eggHatchTimer??3500)-dt;
    if(mob.eggHatchTimer<=0){
      // isHigherTierEgg flag: hatch soldier one tier higher (from queen boss spin burst)
      const hatchTier = mob.isHigherTierEgg ? Math.min(13, (mob.tier ?? 0) + 1) : (mob.tier ?? 0);
      const soldier=spawnAntMinion('soldier_ant',mob.x,mob.y,mob.homeX??mob.x,mob.homeY??mob.y,mob.homeZoneId,hatchTier);
      if(soldier && isWaveMapMode()) addTrackedMob(soldier.id);
      mob.dead=true;
    }
  }

  // ── Fire ant egg hatching ─────────────────────────────────────────────────
  for(const mob of mobs){
    if(mob.dead||mob.typeId!=='fire_ant_egg') continue;
    // Apply outward launch drift from fire queen spin burst (same as ant_egg)
    if(mob._launchVx || mob._launchVy){
      const lnx = mob.x + (mob._launchVx ?? 0), lny = mob.y + (mob._launchVy ?? 0);
      if(canMoveTo(lnx, lny, mob.radius) || Math.random() < 0.25){
        mob.x = lnx; mob.y = lny;
      }
      mob._launchVx = (mob._launchVx ?? 0) * 0.88;
      mob._launchVy = (mob._launchVy ?? 0) * 0.88;
      if(Math.hypot(mob._launchVx, mob._launchVy) < 0.1){ mob._launchVx = 0; mob._launchVy = 0; }
    }
    mob.eggHatchTimer=(mob.eggHatchTimer??3500)-dt;
    if(mob.eggHatchTimer<=0){
      // isHigherTierEgg flag: hatch soldier one tier higher (from fire queen boss spin burst)
      const hatchTier = mob.isHigherTierEgg ? Math.min(13, (mob.tier ?? 0) + 1) : (mob.tier ?? 0);
      const soldier=spawnFireAntMinion('fire_soldier_ant',mob.x,mob.y,mob.homeX??mob.x,mob.homeY??mob.y,mob.homeZoneId,hatchTier);
      if(soldier && isWaveMapMode()) addTrackedMob(soldier.id);
      mob.dead=true;
    }
  }

  // ── Bee boss — orbiting stinger ability ───────────────────────────────────
  const BEE_STINGER_COOLDOWN  = 15000; // ms between spawns
  const BEE_STINGER_COUNT     = 4;
  const BEE_STINGER_ORBIT_SPD = 0.0022; // radians per ms (~2 full rotations per 15s)

  for(const mob of mobs){
    if(mob.dead || mob.typeId !== 'bee' || !mob.isBoss) continue;

    // Init timer
    if(mob.beeStingerTimer === undefined) mob.beeStingerTimer = BEE_STINGER_COOLDOWN;
    mob.beeStingerTimer -= dt;

    // Advance orbit angle for any stingers already bound to this bee
    for(const s of bossStingers){
      if(s.dead || s.ownerId !== mob.id) continue;
      s.orbitAngle += BEE_STINGER_ORBIT_SPD * dt;
      const orbitR = (mob.drawRadius ?? mob.radius) * 2.2;
      s.x = mob.x + Math.cos(s.orbitAngle) * orbitR;
      s.y = mob.y + Math.sin(s.orbitAngle) * orbitR;
    }

    if(mob.beeStingerTimer <= 0){
      mob.beeStingerTimer = BEE_STINGER_COOLDOWN;

      // Collect surviving stingers from previous cycle
      const survivors = bossStingers.filter(s => !s.dead && s.ownerId === mob.id);
      const total = survivors.length + BEE_STINGER_COUNT;
      const orbitR = (mob.drawRadius ?? mob.radius) * 2.2;
      // Redistribute all (survivors + new) evenly around the orbit
      const allStingers = [...survivors];
      for(let i = 0; i < BEE_STINGER_COUNT; i++){
        const startAngle = (Math.PI * 2 / total) * (survivors.length + i);
        const stingerR = Math.max(5, Math.round((mob.drawRadius ?? mob.radius) * 0.35));
        const dmg = (mob.damage ?? 10) * 2; // high damage
        const hp  = 1; // single hit to destroy
        bossStingers.push({
          id: ++_bossStingerNextId,
          ownerId: mob.id,
          orbitAngle: startAngle,
          x: mob.x + Math.cos(startAngle) * orbitR,
          y: mob.y + Math.sin(startAngle) * orbitR,
          radius: stingerR,
          hp, maxHp: hp,
          damage: dmg,
          dead: false,
        });
        allStingers.push(bossStingers[bossStingers.length - 1]);
      }
      // Re-space all (survivors included) evenly
      for(let i = 0; i < allStingers.length; i++){
        allStingers[i].orbitAngle = (Math.PI * 2 / allStingers.length) * i;
      }
    }
  }

  // Clean up dead boss stingers
  for(let i = bossStingers.length - 1; i >= 0; i--){
    if(bossStingers[i].dead) bossStingers.splice(i, 1);
  }

  // ── Cactus boss — orbiting stingers (same as boss bee) + unlimited-range ram ──
  const CACTUS_STINGER_COOLDOWN  = 15000; // ms between spawns, same cadence as boss bee
  const CACTUS_STINGER_COUNT     = 4;
  const CACTUS_STINGER_ORBIT_SPD = 0.0022; // radians per ms, same as boss bee
  const CACTUS_RAM_COOLDOWN      = 10000; // ms between rams
  const CACTUS_RAM_SPEED         = 31.25; // px/frame — crosses the wave map diagonal (7500) in ~4s

  for(const mob of mobs){
    if(mob.dead || mob.typeId !== 'cactus' || !mob.isBoss) continue;

    // Orbiting stingers — identical mechanic to boss bee, just owned by the cactus
    if(mob.cactusStingerTimer === undefined) mob.cactusStingerTimer = CACTUS_STINGER_COOLDOWN;
    mob.cactusStingerTimer -= dt;

    for(const s of bossStingers){
      if(s.dead || s.ownerId !== mob.id) continue;
      s.orbitAngle += CACTUS_STINGER_ORBIT_SPD * dt;
      const orbitR = (mob.drawRadius ?? mob.radius) * 2.2;
      s.x = mob.x + Math.cos(s.orbitAngle) * orbitR;
      s.y = mob.y + Math.sin(s.orbitAngle) * orbitR;
    }

    if(mob.cactusStingerTimer <= 0){
      mob.cactusStingerTimer = CACTUS_STINGER_COOLDOWN;
      const survivors = bossStingers.filter(s => !s.dead && s.ownerId === mob.id);
      const total = survivors.length + CACTUS_STINGER_COUNT;
      const orbitR = (mob.drawRadius ?? mob.radius) * 2.2;
      const allStingers = [...survivors];
      for(let i = 0; i < CACTUS_STINGER_COUNT; i++){
        const startAngle = (Math.PI * 2 / total) * (survivors.length + i);
        const stingerR = Math.max(5, Math.round((mob.drawRadius ?? mob.radius) * 0.35));
        const dmg = (mob.damage ?? 10) * 2;
        const hp  = 1;
        bossStingers.push({
          id: ++_bossStingerNextId,
          ownerId: mob.id,
          orbitAngle: startAngle,
          x: mob.x + Math.cos(startAngle) * orbitR,
          y: mob.y + Math.sin(startAngle) * orbitR,
          radius: stingerR,
          hp, maxHp: hp,
          damage: dmg,
          dead: false,
        });
        allStingers.push(bossStingers[bossStingers.length - 1]);
      }
      for(let i = 0; i < allStingers.length; i++){
        allStingers[i].orbitAngle = (Math.PI * 2 / allStingers.length) * i;
      }
    }

    // Unlimited-range ram — every 10s, zooms straight to whoever it's "aggroed"
    // to (player, or the nearer NPC in wave mode, same targeting every other
    // boss uses) from wherever it currently sits. Permanently relocates to
    // wherever the ram ends — it does not snap back afterward.
    if(mob.cactusRamTimer === undefined) mob.cactusRamTimer = CACTUS_RAM_COOLDOWN;

    if(mob.isRamming){
      const rdx = mob.cactusRamTargetX - mob.x, rdy = mob.cactusRamTargetY - mob.y;
      const rdist = Math.hypot(rdx, rdy);
      if(rdist <= CACTUS_RAM_SPEED || rdist < 1){
        mob.x = mob.cactusRamTargetX; mob.y = mob.cactusRamTargetY;
        mob.isRamming = false;
        mob.cactusRamTimer = CACTUS_RAM_COOLDOWN;
      } else {
        const rnx = rdx / rdist, rny = rdy / rdist;
        const nrx = mob.x + rnx * CACTUS_RAM_SPEED, nry = mob.y + rny * CACTUS_RAM_SPEED;
        mob.x = nrx; mob.y = nry; // structure — no canMoveTo wall-blocking check, matches its own static hitbox never needing one before
        mob.facing = Math.atan2(rny, rnx);
      }
    } else {
      mob.cactusRamTimer -= dt;
      if(mob.cactusRamTimer <= 0){
        let targetX = playerX, targetY = playerY;
        if(isWaveMapMode() && _npcTarget && !_npcTarget.dead){
          const dNpc = Math.hypot(_npcTarget.x - mob.x, _npcTarget.y - mob.y);
          const dPlayer = Math.hypot(playerX - mob.x, playerY - mob.y);
          if(dNpc < dPlayer){ targetX = _npcTarget.x; targetY = _npcTarget.y; }
        }
        mob.isRamming = true;
        mob.cactusRamTargetX = targetX;
        mob.cactusRamTargetY = targetY;
      }
    }
  }

  // ── Ladybug boss — rose minion ability ────────────────────────────────────
  const LADY_ROSE_COOLDOWN  = 15000; // ms between rose spawns
  const LADY_ROSE_PAUSE_DUR = 1000;  // ms freeze before spawning
  const LADY_ROSE_LIFETIME  = 20000; // ms before despawning and healing
  const LADY_ROSE_HEAL_PCT  = 0.10;  // heal per surviving rose (10% max HP)
  // Rose size matches the rose petal base radius (9) scaled the same way
  const LADY_ROSE_BASE_R    = 9;

  for(const mob of mobs){
    if(mob.dead || mob.typeId !== 'ladybug' || !mob.isBoss) continue;

    if(mob.ladyRoseCooldown === undefined) mob.ladyRoseCooldown = LADY_ROSE_COOLDOWN;
    mob.ladyRoseCooldown -= dt;

    // Advance stationary roses — just tick lifetime, no movement
    for(const r of bossRoses){
      if(r.dead || r.ownerId !== mob.id) continue;
      // Lifetime tick
      r.lifetime -= dt;
      if(r.lifetime <= 0){
        r.dead = true;
        // Heal the ladybug
        if(!mob.dead) mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp * LADY_ROSE_HEAL_PCT);
      }
    }

    // Pause phase before spawn
    if(mob.ladyRosePausing){
      mob.ladyRosePauseTimer -= dt;
      if(mob.ladyRosePauseTimer <= 0){
        mob.ladyRosePausing = false;
        // Spawn 4-8 roses scattered around her — stationary, no orbit
        const count = 4 + Math.floor(Math.random() * 5);
        // Rose radius: same as rose petal base radius scaled by boss tier
        const t = mob.tier ?? 0;
        const roseR = Math.max(6, Math.round((mob.drawRadius ?? mob.radius) * 0.5));
        const roseHp = Math.round(mob.maxHp * 0.75);
        // Spread spawn positions around the ladybug at varying distances
        const spawnR = (mob.drawRadius ?? mob.radius) * 1.8;
        for(let i = 0; i < count; i++){
          const angle = (Math.PI * 2 / count) * i + Math.random() * 0.4;
          const dist2  = spawnR * (0.8 + Math.random() * 0.6);
          bossRoses.push({
            id: ++_bossStingerNextId,
            ownerId: mob.id,
            orbitAngle: angle, // keep for render reference, but not used for movement
            x: mob.x + Math.cos(angle) * dist2,
            y: mob.y + Math.sin(angle) * dist2,
            radius: roseR,
            hp: roseHp, maxHp: roseHp,
            damage: 0,
            lifetime: LADY_ROSE_LIFETIME,
            dead: false,
            spawnAngle: angle, // for renderer petal orientation
            hurtFlash: 0,
          });
        }
      }
      continue; // frozen while pausing
    }

    if(mob.ladyRoseCooldown <= 0){
      mob.ladyRoseCooldown = LADY_ROSE_COOLDOWN;
      mob.ladyRosePausing = true;
      mob.ladyRosePauseTimer = LADY_ROSE_PAUSE_DUR;
    }
  }

  // Clean up dead boss roses
  for(let i = bossRoses.length - 1; i >= 0; i--){
    if(bossRoses[i].dead) bossRoses.splice(i, 1);
  }

  // ── Queen Bee Egg hatching ────────────────────────────────────────────────
  for(const egg of queenBeeEggs){
    if(egg.dead) continue;
    egg.spawnTimer = Math.min(320, (egg.spawnTimer ?? 0) + dt); // pop-in anim
    egg.hatchTimer -= dt;
    if(egg.hatchTimer <= 0){
      egg.dead = true;
      // Spawn a bee or a stationary turret hornet
      if(egg.isHornetEgg){
        const h = spawnAntMinion('hornet', egg.x, egg.y, egg.x, egg.y, -1, egg.tier);
        if(h){
          h.isStationary = true;  // won't wander or approach — shoots in place
          h.alerted = true;
          h.shootState = 'aim';
          h.stingerProgress = 1;
          h.isZoneTracked = false;
          if(isWaveMapMode()) addTrackedMob(h.id);
        }
      } else {
        const b = spawnAntMinion('bee', egg.x, egg.y, egg.x, egg.y, -1, egg.tier);
        if(b){ b.alerted = true; b.isZoneTracked = false; if(isWaveMapMode()) addTrackedMob(b.id); }
      }
    }
  }
  for(let i = queenBeeEggs.length - 1; i >= 0; i--){
    if(queenBeeEggs[i].dead) queenBeeEggs.splice(i, 1);
  }

  // ── Queen Bee Pollen Orbit update ─────────────────────────────────────────
  const POLLEN_ORBIT_SPEED = 0.0035; // rad/ms
  const POLLEN_LAUNCH_SPEED = 8;
  for(const p of queenBeePollenOrbit){
    if(p.dead) continue;
    if(!p.launched){
      // Find owner queen
      const owner = mobs.find(m => m.id === p.ownerId && !m.dead);
      if(!owner){ p.dead = true; continue; }
      p.spinTimer -= dt;
      p.orbitAngle += POLLEN_ORBIT_SPEED * dt;
      p.x = owner.x + Math.cos(p.orbitAngle) * p.orbitR;
      p.y = owner.y + Math.sin(p.orbitAngle) * p.orbitR;
      if(p.spinTimer <= 0){
        // Launch outward from queen
        p.launched = true;
        const launchAngle = p.orbitAngle;
        p.vx = Math.cos(launchAngle) * POLLEN_LAUNCH_SPEED;
        p.vy = Math.sin(launchAngle) * POLLEN_LAUNCH_SPEED;
        p.settleTimer = 1500; // after 1.5s decay to rest
      }
    } else {
      // Fly outward then settle
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if(p.settleTimer !== undefined) p.settleTimer -= dt;
      if(p.settleTimer !== undefined && p.settleTimer <= 0 && Math.hypot(p.vx, p.vy) < 0.3){
        p.vx = 0; p.vy = 0; p.settled = true;
      }
      // Die after 6s settled or 8s total
      if(p.totalTimer === undefined) p.totalTimer = 8000;
      p.totalTimer -= dt;
      if(p.totalTimer <= 0) p.dead = true;
    }
  }
  for(let i = queenBeePollenOrbit.length - 1; i >= 0; i--){
    if(queenBeePollenOrbit[i].dead) queenBeePollenOrbit.splice(i, 1);
  }

  // ── Sea cave: spawn a crab + jellyfish (each with its own 12% bonus-mob
  // roll) every time it drops another 15% of its own max HP. Checked here,
  // once per frame against current HP, rather than at each of the many
  // individual damage-application sites in combat.js — a mob's HP can drop
  // from missiles, poison, contact damage, boss projectiles, etc., and
  // catching the threshold in one place after all of them have applied this
  // frame is far more robust than trying to hook every damage source
  // individually. seaCaveThresholdsSpawned counts how many 15% steps have
  // already triggered a wave; a single big hit that skips past more than one
  // threshold in one frame still spawns a wave for each step crossed, so a
  // one-shot kill from 100% to 0% doesn't get away with only firing once.
  for(const mob of mobs){
    if(mob.dead || mob.typeId!=='sea_cave' || mob.maxHp<=0) continue;
    const hpLostFrac = 1 - Math.max(0, mob.hp) / mob.maxHp;
    const thresholdsCrossed = Math.floor(hpLostFrac / 0.15);
    const alreadySpawned = mob.seaCaveThresholdsSpawned || 0;
    if(thresholdsCrossed > alreadySpawned){
      const tier = rarityTier(mob.rarity);
      for(let i=alreadySpawned; i<thresholdsCrossed; i++){
        spawnSeaCaveWave(mob.x, mob.y, mob.homeZoneId, tier);
      }
      mob.seaCaveThresholdsSpawned = thresholdsCrossed;
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for(let i=mobs.length-1;i>=0;i--){
    if(mobs[i].dead){ onMobDied(mobs[i]); mobs.splice(i,1); }
  }

  // ── Jellyfish lightning bolt visuals: fade out and expire ──────────────────
  // Runs unconditionally (like the mob cleanup above) so bolts still fade
  // out smoothly even the instant the player dies, rather than freezing.
  for(let i=jellyfishBolts.length-1;i>=0;i--){
    const b=jellyfishBolts[i];
    b.t+=dt;
    if(b.t>=b.lifetime) jellyfishBolts.splice(i,1);
  }

  // ── Explosion ring visuals (Ink Sack): fade out and expire, same pattern ───
  for(let i=explosionEffects.length-1;i>=0;i--){
    const e=explosionEffects[i];
    e.t+=dt;
    if(e.t>=e.lifetime) explosionEffects.splice(i,1);
  }

  // ── Small pop visuals (Bubble breaking, etc.): fade out and expire ─────────
  for(let i=popEffects.length-1;i>=0;i--){
    const p=popEffects[i];
    p.t+=dt;
    if(p.t>=p.lifetime) popEffects.splice(i,1);
  }

  // Zone-based mob spawning is disabled for now — per instructions, phase 2
  // (the new biome maps) ships with map geometry + player only, no mob spawns
  // yet. The old zone grid this system was built for no longer exists (map.js
  // is a router over GardenMap.js/DesertMap.js/OceanMap.js now), and its
  // getZoneBounds shim covers the WHOLE active map for every one of the 15
  // legacy zone ids — so leaving this call live would activate all 15 zones
  // simultaneously and spawn mobs across the entire map at once. Re-enable
  // once real spawn-zone logic (tiers/rarities per region, per your notes)
  // replaces this.
  // if (!isWaveMapMode()) updateZoneSpawning(dt,playerX,playerY);
}