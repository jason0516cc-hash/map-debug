import { petalInstances, damagePetal, hotbar, makePetal, orbitAngle, currentOrbitR } from './petals.js';
import { mobs, missiles, bossStingers, bossPeas, bossRoses, getMobStats, alertChainByMob, pendingJellyfishZaps, jellyfishBolts, explosionEffects, popEffects, pointHitsMob }               from './mobs.js';
import { player, addXp }                                from './player.js';
import { spawnDrop, spawnWebField, pollenEntities, spawnPollenEntity, honeycombEntities, spawnHoneycombEntity, missileEntities, spawnMissileEntity, pincerSlowedMobs } from './drops.js';
import { PLAYER_MASS, PLAYER_RADIUS, PLAYER_BASE_BODY_DAMAGE, RARITIES, rarityTier, ORBIT_SPEED } from './constants.js';
import { spawnDamage }                               from './damagePopups.js';
import { PETAL_TYPES }                               from './petalTypes.js';
import { inputState }                                from './inputState.js';
import { zoomState }                                      from './camera.js';
import { canMoveTo }                                 from './map.js';
import { mobXpValue }                                from './leveling.js';

// hitCooldowns removed: every collision now deals damage immediately
const poisonedMobs = new Map(); // mobId → { dps, timer }
// Player poison state
let playerPoison = { dps: 0, timer: 0 };

// Bleed DoT (Tooth, Glass) — separate from poison so both can be active on the
// same mob at once. Unlike poison's smooth per-frame DPS, bleed deals a fixed
// chunk of damage on a fixed tick interval (spec: "5% of its damage every
// 0.05s for 1s" — i.e. a flat per-tick amount, not a rate to integrate over
// dt), so it tracks its own tick countdown independently of frame length.
const bleedingMobs = new Map(); // mobId → { tickDamage, tickInterval, tickTimer, ticksLeft }

/**
 * Applies (or refreshes) a bleed DoT on a mob. `hitDamage` is the triggering
 * hit's raw damage — tickDamage is computed as tickFraction * hitDamage, and
 * repeats every tickIntervalMs for durationMs total (refreshing replaces any
 * bleed already on the mob, same "refresh on reapply" behavior as poison).
 */
function applyBleed(mobId, hitDamage, tickFraction, tickIntervalMs, durationMs) {
  const ticksLeft = Math.round(durationMs / tickIntervalMs);
  bleedingMobs.set(mobId, {
    tickDamage:   hitDamage * tickFraction,
    tickInterval: tickIntervalMs,
    tickTimer:    tickIntervalMs,
    ticksLeft,
  });
}

/**
 * Generic chain lightning — used by the Lightning petal (on-hit) and by
 * Jellyfish Egg's pet (its own periodic zap). Starts at `originMob` (already
 * hit/zapped by the caller, NOT re-hit here) and jumps to the nearest
 * not-yet-hit hostile mob whose HITBOX is within `buffer` units of the last
 * mob's own hitbox — i.e. eligibility is fromMob.radius + toMob.radius +
 * buffer, not a flat world-space distance, so a chain between two huge boss
 * mobs reaches further than one between two tiny mobs, matching how close
 * they actually look on screen. Deals `damage` to each, up to `maxChain`
 * additional mobs total. Pushes a fading bolt visual (jellyfishBolts) for
 * each jump, same shape/lifetime as the jellyfish mob's own zap-chain visual.
 * Handles mob death (drops/xp) the same way every other damage source here does.
 */
function chainLightning(originMob, damage, maxChain, buffer) {
  const hitIds = new Set([originMob.id]);
  let fromX = originMob.x, fromY = originMob.y, fromRadius = originMob.radius;

  for (let hop = 0; hop < maxChain; hop++) {
    let best = null, bestGap = Infinity;
    for (const mob of mobs) {
      if (mob.dead || hitIds.has(mob.id)) continue;
      if (mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      const d = Math.hypot(mob.x - fromX, mob.y - fromY);
      const gap = d - (fromRadius + mob.radius); // <=0 means the hitboxes already overlap/touch
      if (gap <= buffer && gap < bestGap) { bestGap = gap; best = mob; }
    }
    if (!best) break;

    hitIds.add(best.id);
    best.hp -= damage; best.alerted = true; triggerHurtFlash(best);
    spawnDamage(best.x, best.y, Math.round(damage), '#5ec8ff', best.radius, best);
    jellyfishBolts.push({ x1: fromX, y1: fromY, x2: best.x, y2: best.y, t: 0, lifetime: 220 });

    if (best.hp <= 0) {
      best.dead = true;
      spawnMobDrops(best, best.isBoss); addXp(mobXpValue(rarityTier(best.rarity), best.isBoss ?? false));
    }

    fromX = best.x; fromY = best.y; fromRadius = best.radius;
  }
}

/**
 * Coral's generation offsets — a simple evenly-spaced ring around the slot's
 * orbit point, scaled down as the count grows so a 5-piece generation still
 * reads as one cluster rather than sprawling. Distinct from Stinger's
 * hand-placed per-count shapes, per instruction ("like stinger but different").
 */
function coralOffsetsForCount(n) {
  if (n === 1) return [{ dx: 0, dy: 0 }];
  const ringR = 0.85 - n * 0.05; // slightly tighter ring as the count grows
  const out = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    out.push({ dx: Math.cos(angle) * ringR, dy: Math.sin(angle) * ringR });
  }
  return out;
}

/** Trigger a brief red damage flash on any entity that has a hurtFlash field. */
function triggerHurtFlash(entity) {
  if (entity && 'hurtFlash' in entity) entity.hurtFlash = 120; // 120ms — quick flash
}

const COLLISION_EPS = 2.0; // allow small separation tolerance for contact checks (px)

/** Returns the total fraction of damage blocked by equipped disc tiers (capped at 1). */
function getDiscBlock() {
  let block = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.damageBlock) block += pt.damageBlock;
  }
  return Math.min(0.75, block);
}

/** Returns total player body DPS: base + sum of equipped cutter tier bonuses + /set dmg bonus. */
function getPlayerBodyDamage() {
  let total = PLAYER_BASE_BODY_DAMAGE;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.bodyDamage) total += pt.bodyDamage;
  }
  total += player._dmgBonus || 0;
  return total;
}

/** Returns the total Salt reflect fraction — sum of every currently-active
 *  Salt's reflectPercent (same "must be active, not reloading" rule as
 *  armor), stacking additively, capped at 200% per instruction. */
function getSaltReflectPercent() {
  let total = 0;
  for (const p of petalInstances) {
    if (p.state !== 'active' || p.roseState) continue;
    const pt = PETAL_TYPES[p.typeId];
    if (pt?.reflectPercent) total += pt.reflectPercent;
  }
  return Math.min(200, total) / 100;
}

/** Returns true if at least one Sponge petal is currently active (not
 *  reloading/broken) — same "must be active" rule as armor and Salt's
 *  reflect. Sponge only intercepts damage while this is true. */
function isSpongeActive() {
  for (const p of petalInstances) {
    if (p.state !== 'active' || p.roseState) continue;
    if (PETAL_TYPES[p.typeId]?.isSpongeAbsorb) return true;
  }
  return false;
}

/**
 * Applies damage to the player, absorbing into shield (Carapace, Shell) before
 * HP. Every site that damages the player should route through this instead of
 * touching player.hp directly, so shield always applies consistently.
 * Returns the portion of `amount` that actually reached HP (after shield),
 * in case a caller needs it (none currently do, but keeps this composable).
 */
function applyDamageToPlayer(amount) {
  if (amount <= 0) return 0;
  // Armor (Bone, Scales, Disc past Radiant, etc.): same flat-subtraction
  // formula mobs already use against the player's own petal damage (see the
  // mob.armor lines above) — never fully negates a hit, floors at 0.1 so
  // there's always at least a sliver of damage, same as the mob-side rule.
  let remaining = player.armor > 0 ? Math.max(0.1, amount - player.armor) : amount;
  if (player.shield > 0) {
    const absorbed = Math.min(player.shield, remaining);
    player.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    // Sponge: instead of hitting HP, this remainder merges into the shared
    // pool and the spread window resets to the full duration. The pool then
    // drains out on its own as smooth passive damage — see the drain tick
    // in updateCombat. Uses whichever active Sponge's window is longest, in
    // the (currently impossible, since duration is flat) case they differ.
    if (isSpongeActive()) {
      let windowMs = 0;
      for (const p of petalInstances) {
        if (p.state !== 'active' || p.roseState) continue;
        const pt = PETAL_TYPES[p.typeId];
        if (pt?.isSpongeAbsorb) windowMs = Math.max(windowMs, pt.spongeWindowMs);
      }
      player.spongePool += remaining;
      player.spongeTimeRemaining = windowMs;
      return 0;
    }
    player.hp = Math.max(0, player.hp - remaining);
    if (player.hp <= 0) player.dead = true;
  }
  return remaining;
}

// ── Tiered drop rate system ──────────────────────────────────────────────────
// Each rate table is an array of 14 entries (one per mob tier 0..13).
// Each entry is an array of [petalTierIndex, weight] pairs — null means no drop.
// Weights are normalised during rolling so they don't need to sum to exactly 1.

// Standard slot-A rates (first listed petal for most mobs)
const DR_A = [
  [[0,70],[1,30]],               // 0 Common
  [[0,55],[1,45]],               // 1 Unusual
  [[0,10],[1,30],[2,60]],        // 2 Rare
  [[2,70],[3,30]],               // 3 Epic
  [[3,85],[4,15]],               // 4 Legendary
  [[4,35],[3,65]],               // 5 Mythical
  [[4,5],[5,92],[6,3]],          // 6 Ultra
  [[5,85],[6,15]],               // 7 Super
  [[6,28],[5,67]],               // 8 Radiant
  [[7,73],[6,27]],               // 9 Mystic
  [[8,60],[7,40]],               // 10 Runic
  [[9,44],[8,56]],               // 11 Seraphic
  [[10,32],[9,68]],              // 12 Umbral
  [[11,24],[10,76]],             // 13 Impracticality
];
// Standard slot-B (second petal, differs only at Ultra: 3/92/5)
const DR_B = DR_A.map((r,i) => i===6 ? [[4,3],[5,92],[6,5]] : r);
// Standard slot-C (third petal, differs only at Ultra: 4/92/4)
const DR_C = DR_A.map((r,i) => i===6 ? [[4,4],[5,92],[6,4]] : r);

// Bee Stinger — slightly tweaked values throughout
const DR_STINGER_BEE = [
  [[0,60],[1,40]],
  [[0,48],[1,47],[2,5]],
  [[0,8],[1,27],[2,65]],
  [[2,65],[3,35]],
  [[3,82],[4,18]],
  [[4,32],[3,68]],
  [[4,4],[5,91],[6,5]],
  [[5,83],[6,17]],
  [[6,25],[5,75]],
  [[7,70],[6,30]],
  [[8,57],[7,43]],
  [[9,42],[8,58]],
  [[10,30],[9,70]],
  [[11,22],[10,78]],
];

// Ant Egg from Queen Ant / Queen Bee
const DR_ANT_EGG_QUEEN = [
  [[0,85],[1,15]],
  [[0,70],[1,30]],
  [[0,25],[1,50],[2,25]],
  [[1,30],[2,60],[3,10]],
  [[3,90],[4,10]],
  [[3,45],[4,55]],
  [[4,11.5],[5,88],[6,0.5]],
  [[5,90],[6,10]],
  [[5,80],[6,20]],
  [[6,20],[7,80]],
  [[7,32],[8,68]],
  [[8,48],[9,52]],
  [[9,60],[10,40]],
  [[10,45],[11,55]],
];

// Ant Egg from Ant Hole
const DR_ANT_EGG_HOLE = [
  [[0,75],[1,25]],
  [[0,45],[1,55]],
  [[1,60],[2,40]],
  [[2,88],[3,12]],
  [[3,87],[4,13]],
  [[3,35],[4,65]],
  [[4,8],[5,90],[6,2]],
  [[5,88],[6,12]],
  [[5,78],[6,22]],
  [[6,23],[7,77]],
  [[7,37],[8,63]],
  [[8,52],[9,48]],
  [[9,64],[10,36]],
  [[10,43],[11,57]],
];

// Bee Egg from Beehive (same rates as Ant Hole Ant Egg)
const DR_BEE_EGG_HIVE = [
  [[0,75],[1,25]],
  [[0,45],[1,55]],
  [[1,60],[2,40]],
  [[2,88],[3,12]],
  [[3,87],[4,13]],
  [[3,35],[4,65]],
  [[4,8],[5,90],[6,2]],
  [[5,88],[6,12]],
  [[5,78],[6,22]],
  [[6,23],[7,77]],
  [[7,37],[8,63]],
  [[8,52],[9,48]],
  [[9,64],[10,36]],
  [[10,43],[11,57]],
];

// Bee Egg from Queen Bee (same rates as Queen Ant Ant Egg)
const DR_BEE_EGG_QUEEN = [
  [[0,85],[1,15]],
  [[0,70],[1,30]],
  [[0,25],[1,50],[2,25]],
  [[1,30],[2,60],[3,10]],
  [[3,90],[4,10]],
  [[3,45],[4,55]],
  [[4,11.5],[5,88],[6,0.5]],
  [[5,90],[6,10]],
  [[5,80],[6,20]],
  [[6,20],[7,80]],
  [[7,32],[8,68]],
  [[8,48],[9,52]],
  [[9,60],[10,40]],
  [[10,45],[11,55]],
];

// Bee Egg (legacy alias — kept for digger)
const DR_BEE_EGG = DR_BEE_EGG_HIVE;

// Digger Egg (same as Beehive Bee Egg)
const DR_DIGGER_EGG = DR_BEE_EGG_HIVE;

// Magnet from Ant Hole (starts at Unusual, not Common)
const DR_MAGNET_HOLE = [
  [[1,70],[2,30]],
  [[1,55],[2,40],[3,5]],
  [[2,65],[3,30],[4,5]],
  [[2,80],[3,20]],
  [[3,90],[4,10]],
  [[4,55],[3,45]],
  [[4,10],[5,88],[6,2]],
  [[5,90],[6,10]],
  [[6,20],[5,80]],
  [[7,80],[6,20]],
  [[8,68],[7,32]],
  [[9,52],[8,48]],
  [[10,40],[9,60]],
  [[10,45],[11,55]],
];

// Third Eye from Spider — does NOT drop at mob tiers 0-5
const DR_THIRD_EYE = [
  null, null, null, null, null, null, // no drop Common→Mythical
  [[5,99],[6,1]],           // 6 Ultra
  [[5,68],[6,32]],          // 7 Super
  [[6,20],[5,80]],          // 8 Radiant
  [[7,78],[6,22]],          // 9 Mystic
  [[8,65],[7,35]],          // 10 Runic
  [[9,50],[8,50]],          // 11 Seraphic
  [[10,38],[9,62]],         // 12 Umbral
  [[10,45],[11,55]],        // 13 Impracticality
];

// Jellyfish Egg from Jellyfish / Sea Cave — the petal itself exists from
// Common rarity onward, but it never drops at all until the MOB is Mythic
// tier or higher (mob tiers 0-4 = null, same "no drop" mechanism as
// DR_THIRD_EYE above). Once unlocked, it drops at a petal rarity roughly
// tracking the mob's own tier, same shape as DR_THIRD_EYE's progression.
const DR_JELLYFISH_EGG = [
  null, null, null, null, null, // no drop Common→Legendary
  [[0,70],[1,30]],          // 5 Mythic
  [[0,10],[1,30],[2,60]],   // 6 Ultra
  [[2,70],[3,30]],          // 7 Super
  [[3,85],[4,15]],          // 8 Radiant
  [[4,35],[3,65]],          // 9 Mystic
  [[4,5],[5,92],[6,3]],     // 10 Runic
  [[5,85],[6,15]],          // 11 Seraphic
  [[6,28],[5,67]],          // 12 Umbral
  [[7,73],[6,27]],          // 13 Impracticality
];

// ── Rolling helpers ──────────────────────────────────────────────────────────

function _rollTier(table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [t, w] of table) { if ((r -= w) <= 0) return t; }
  return table[table.length - 1][0];
}

function _tieredId(baseId, tier) {
  if (tier === 0) return baseId;
  const suffix = RARITIES[tier].toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${baseId}_${suffix}`;
}

/** Roll a tiered petal ID for the given base petal + mob tier. Returns null if no drop. */
function rollDropId(baseId, rateTable, mobTier) {
  const rates = rateTable[mobTier];
  if (!rates) return null;
  return _tieredId(baseId, _rollTier(rates));
}

/** Like spawnTieredDrops but just returns the rolled IDs without spawning anything. */
function rollTieredDropIds(drops, mobTier, weightBoost = 1) {
  const boostedDrops = weightBoost === 1 ? drops : drops.map(({ baseId, rateTable }) => ({
    baseId,
    rateTable: rateTable.map(row => row === null ? null : row.map(([petalTier, w]) => [petalTier, w * weightBoost])),
  }));
  return boostedDrops
    .map(({ baseId, rateTable }) => rollDropId(baseId, rateTable, mobTier))
    .filter(id => id !== null);
}

// ── Spawn helpers ────────────────────────────────────────────────────────────

function spawnAllDrops(x, y, dropTypes, spreadRadius = 58) {
  for (let i = 0; i < dropTypes.length; i++) {
    const angle = (Math.PI * 2 * i) / dropTypes.length;
    spawnDrop(x + Math.cos(angle) * spreadRadius, y + Math.sin(angle) * spreadRadius, dropTypes[i]);
  }
}

/** Resolve an array of {baseId, rateTable} entries at mob's tier, then scatter drops. */
function spawnTieredDrops(x, y, drops, mobTier, weightBoost = 1, spreadRadius = 58) {
  const boostedDrops = weightBoost === 1 ? drops : drops.map(({ baseId, rateTable }) => ({
    baseId,
    rateTable: rateTable.map(row => row === null ? null : row.map(([petalTier, w]) => [petalTier, w * weightBoost])),
  }));
  const ids = boostedDrops.map(({baseId, rateTable}) => rollDropId(baseId, rateTable, mobTier))
                   .filter(id => id !== null);
  spawnAllDrops(x, y, ids, spreadRadius);
}

// ── Main drop dispatcher ─────────────────────────────────────────────────────

// ── Public drop-table query (used by mob tooltip to show drop chances) ────────
const MOB_DROP_TABLE = {
  soldier_ant:           [{ baseId: 'wing', rateTable: DR_A }, { baseId: 'clover', rateTable: DR_A }],
  worker_ant:            [{ baseId: 'leaf', rateTable: DR_A }, { baseId: 'corn', rateTable: DR_B }],
  baby_ant:              [{ baseId: 'light', rateTable: DR_A }, { baseId: 'leaf', rateTable: DR_B }, { baseId: 'rice', rateTable: DR_C }],
  queen_ant:             [{ baseId: 'leaf', rateTable: DR_A }, { baseId: 'wing', rateTable: DR_B }, { baseId: 'ant_egg', rateTable: DR_ANT_EGG_QUEEN }],
  fire_soldier_ant:      [{ baseId: 'blood_wing', rateTable: DR_A }, { baseId: 'clover', rateTable: DR_A }],
  fire_worker_ant:       [{ baseId: 'blood_corn', rateTable: DR_A }, { baseId: 'blood_leaf', rateTable: DR_B }],
  fire_baby_ant:         [{ baseId: 'light', rateTable: DR_A }, { baseId: 'blood_leaf', rateTable: DR_B }, { baseId: 'rice', rateTable: DR_C }],
  fire_queen_ant:        [{ baseId: 'ant_egg', rateTable: DR_ANT_EGG_QUEEN }, { baseId: 'blood_wing', rateTable: DR_B }, { baseId: 'blood_leaf', rateTable: DR_A }],
  fire_ant_hole:         [{ baseId: 'soil', rateTable: DR_A }, { baseId: 'ant_egg', rateTable: DR_ANT_EGG_HOLE }, { baseId: 'magnet', rateTable: DR_MAGNET_HOLE }, { baseId: 'disc', rateTable: DR_B }],
  spider:                [{ baseId: 'faster', rateTable: DR_A }, { baseId: 'web', rateTable: DR_A }, { baseId: 'third_eye', rateTable: DR_THIRD_EYE }],
  centipede_head:        [{ baseId: 'leaf', rateTable: DR_A }, { baseId: 'peas', rateTable: DR_B }, { baseId: 'centipede_legs', rateTable: DR_C }],
  centipede_body:        [{ baseId: 'leaf', rateTable: DR_A }, { baseId: 'peas', rateTable: DR_B }, { baseId: 'centipede_legs', rateTable: DR_C }],
  ant_hole:              [{ baseId: 'soil', rateTable: DR_A }, { baseId: 'ant_egg', rateTable: DR_ANT_EGG_HOLE }, { baseId: 'magnet', rateTable: DR_MAGNET_HOLE }],
  digger:                [{ baseId: 'disc', rateTable: DR_A }, { baseId: 'cutter', rateTable: DR_B }, { baseId: 'digger_egg', rateTable: DR_DIGGER_EGG }],
  beehive:               [{ baseId: 'honeycomb', rateTable: DR_B }, { baseId: 'bee_egg', rateTable: DR_BEE_EGG_HIVE }],
  bee:                   [{ baseId: 'stinger', rateTable: DR_STINGER_BEE }, { baseId: 'pollen', rateTable: DR_B }],
  hornet:                [{ baseId: 'missile', rateTable: DR_A }, { baseId: 'antennae', rateTable: DR_B }, { baseId: 'orange', rateTable: DR_C }],
  beekeeper:             [{ baseId: 'disc', rateTable: DR_B }, { baseId: 'cutter', rateTable: DR_C }],
  queen_bee:             [{ baseId: 'pollen', rateTable: DR_A }, { baseId: 'honeycomb', rateTable: DR_B }, { baseId: 'stinger', rateTable: DR_C }, { baseId: 'bee_egg', rateTable: DR_BEE_EGG_QUEEN }],
  ladybug:               [{ baseId: 'rose', rateTable: DR_A }, { baseId: 'light', rateTable: DR_B }],
  desert_centipede_head: [{ baseId: 'sand', rateTable: DR_A }, { baseId: 'powder', rateTable: DR_B }, { baseId: 'centipede_legs', rateTable: DR_C }],
  desert_centipede_body: [{ baseId: 'sand', rateTable: DR_A }, { baseId: 'powder', rateTable: DR_B }, { baseId: 'centipede_legs', rateTable: DR_C }],
  cactus:                [{ baseId: 'rose', rateTable: DR_A }, { baseId: 'clover', rateTable: DR_B }, { baseId: 'stinger', rateTable: DR_C }],
  rock:                  [{ baseId: 'moon', rateTable: DR_A }, { baseId: 'heavy', rateTable: DR_B }],
  dandelion:             [{ baseId: 'dandelion_seed_petal', rateTable: DR_A }],
  sandstorm:             [{ baseId: 'sand', rateTable: DR_A }, { baseId: 'stick', rateTable: DR_C }, { baseId: 'glass', rateTable: DR_B }],
  scorpion:              [{ baseId: 'iris', rateTable: DR_A }, { baseId: 'pincer', rateTable: DR_B }, { baseId: 'missile', rateTable: DR_C }],
  beetle:                [{ baseId: 'bone', rateTable: DR_A }, { baseId: 'pincer', rateTable: DR_A }, { baseId: 'beetle_egg', rateTable: DR_B }],
  jellyfish:             [{ baseId: 'jelly', rateTable: DR_A }, { baseId: 'lightning', rateTable: DR_B }, { baseId: 'jellyfish_egg', rateTable: DR_JELLYFISH_EGG }],
  squid:                 [{ baseId: 'ink', rateTable: DR_A }, { baseId: 'tentacle', rateTable: DR_B }, { baseId: 'ink_sack', rateTable: DR_C }],
  crab:                  [{ baseId: 'claw', rateTable: DR_A }, { baseId: 'carapace', rateTable: DR_B }],
  starfish:              [{ baseId: 'starfish_arm', rateTable: DR_A }, { baseId: 'coral', rateTable: DR_B }],
  shell:                 [{ baseId: 'pearl', rateTable: DR_A }, { baseId: 'shell_shape', rateTable: DR_B }, { baseId: 'magnet', rateTable: DR_C }],
  alligator:             [{ baseId: 'ocean_artifact', rateTable: DR_A }, { baseId: 'fang', rateTable: DR_A }, { baseId: 'scales', rateTable: DR_B }, { baseId: 'tooth', rateTable: DR_B }],
  sponge:                [{ baseId: 'sponge_petal', rateTable: DR_A }, { baseId: 'coral', rateTable: DR_B }, { baseId: 'air', rateTable: DR_C }],
  bubble:                [{ baseId: 'bubble_petal', rateTable: DR_A }, { baseId: 'air', rateTable: DR_B }],
  sea_cave:              [{ baseId: 'jellyfish_egg', rateTable: DR_JELLYFISH_EGG }, { baseId: 'air', rateTable: DR_A }],
  leech:                 [{ baseId: 'fang', rateTable: DR_A }],
  debris:                [{ baseId: 'compass', rateTable: DR_A }, { baseId: 'metal', rateTable: DR_B }],
};

/**
 * Returns an array of { typeId, chance } for the given mob type + tier.
 * Each entry is a possible petal drop with its probability (0–1).
 */
/**
 * Returns grouped drop slots for the given mob type + tier.
 * Each slot = { variants: [{ typeId, chance }, ...] } — one slot per drop row.
 * Variants are the different possible rarities for that drop slot.
 */
export function getMobDropTable(typeId, tier) {
  const entries = MOB_DROP_TABLE[typeId];
  if (!entries) return [];
  const t = tier ?? 0;
  const slots = [];
  for (const { baseId, rateTable } of entries) {
    const rates = rateTable[t];
    if (!rates) continue;
    const total = rates.reduce((s, [, w]) => s + w, 0);
    const sortedRates = [...rates].sort((a, b) => a[0] - b[0]); // lower tier left, higher tier right
    const variants = sortedRates.map(([petalTier, weight]) => {
      const chance = weight / total;
      const petalTypeId = petalTier === 0 ? baseId
        : `${baseId}_${RARITIES[petalTier].toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      return { typeId: petalTypeId, chance };
    });
    slots.push({ variants });
  }
  return slots;
}

export function spawnMobDrops(mob, isBoss = false) {
  // Friendly pets (NPC egg-hatched ants, bees, diggers) never drop loot
  if (mob.isFriendlyPet) return;

  const x = mob.x, y = mob.y;
  const t = mob.tier ?? 0;
  const { countMult, weightBoost } = isBoss
    ? { countMult: 3, weightBoost: 5 }
    : { countMult: 1, weightBoost: 1 };

  // For boss drops: collect every rolled ID first, then place them all in a
  // single evenly-spaced ring so nothing overlaps and nothing is too far apart.
  const bossDropQueue = isBoss ? [] : null;

  /** Helper: run drops countMult times, either queueing (boss) or spawning (normal). */
  function drop(drops) {
    if (isBoss) {
      for (let i = 0; i < countMult; i++) {
        bossDropQueue.push(...rollTieredDropIds(drops, t, weightBoost));
      }
    } else {
      spawnTieredDrops(x, y, drops, t, 1, 58);
    }
  }

  // ── Mob Gallery: record the kill ──────────────────────────────────────────
  if (typeof window.__mobGalRecordKill === 'function' && !mob.isFriendlyPet) {
    window.__mobGalRecordKill(mob.typeId, t);
  }

  switch (mob.typeId) {
    case 'soldier_ant':
      drop([
        { baseId: 'wing',   rateTable: DR_A },
        { baseId: 'clover', rateTable: DR_A },
      ]);
      break;

    case 'worker_ant':
      drop([
        { baseId: 'leaf', rateTable: DR_A },
        { baseId: 'corn', rateTable: DR_B },
      ]);
      break;

    case 'baby_ant':
      drop([
        { baseId: 'light', rateTable: DR_A },
        { baseId: 'leaf',  rateTable: DR_B },
        { baseId: 'rice',  rateTable: DR_C },
      ]);
      break;

    case 'queen_ant':
      drop([
        { baseId: 'leaf',    rateTable: DR_A             },
        { baseId: 'wing',    rateTable: DR_B             },
        { baseId: 'ant_egg', rateTable: DR_ANT_EGG_QUEEN },
      ]);
      break;

    case 'fire_soldier_ant':
      drop([
        { baseId: 'blood_wing', rateTable: DR_A },
        { baseId: 'clover',     rateTable: DR_A },
      ]);
      break;

    case 'fire_worker_ant':
      drop([
        { baseId: 'blood_corn', rateTable: DR_A },
        { baseId: 'blood_leaf', rateTable: DR_B },
      ]);
      break;

    case 'fire_baby_ant':
      drop([
        { baseId: 'light',      rateTable: DR_A },
        { baseId: 'blood_leaf', rateTable: DR_B },
        { baseId: 'rice',       rateTable: DR_C },
      ]);
      break;

    case 'fire_queen_ant':
      drop([
        { baseId: 'ant_egg',    rateTable: DR_ANT_EGG_QUEEN },
        { baseId: 'blood_wing', rateTable: DR_B             },
        { baseId: 'blood_leaf', rateTable: DR_A             },
      ]);
      break;

    case 'fire_ant_egg':
      // No drops, by design.
      break;

    case 'fire_ant_hole':
      drop([
        { baseId: 'soil',    rateTable: DR_A            },
        { baseId: 'ant_egg', rateTable: DR_ANT_EGG_HOLE },
        { baseId: 'magnet',  rateTable: DR_MAGNET_HOLE  },
        { baseId: 'disc',    rateTable: DR_B            },
      ]);
      break;

    case 'spider':
      drop([
        { baseId: 'faster',    rateTable: DR_A         },
        { baseId: 'web',       rateTable: DR_A         },
        { baseId: 'third_eye', rateTable: DR_THIRD_EYE },
      ]);
      break;

    case 'centipede_head':
    case 'centipede_body':
      drop([
        { baseId: 'leaf',           rateTable: DR_A },
        { baseId: 'peas',           rateTable: DR_B },
        { baseId: 'centipede_legs', rateTable: DR_C },
      ]);
      break;

    case 'ant_hole':
      drop([
        { baseId: 'soil',    rateTable: DR_A            },
        { baseId: 'ant_egg', rateTable: DR_ANT_EGG_HOLE },
        { baseId: 'magnet',  rateTable: DR_MAGNET_HOLE  },
      ]);
      break;

    case 'digger':
      drop([
        { baseId: 'disc',       rateTable: DR_A          },
        { baseId: 'cutter',     rateTable: DR_B          },
        { baseId: 'digger_egg', rateTable: DR_DIGGER_EGG },
      ]);
      break;

    case 'beehive':
      drop([
        { baseId: 'honeycomb', rateTable: DR_B            },
        { baseId: 'bee_egg',   rateTable: DR_BEE_EGG_HIVE },
      ]);
      break;

    case 'bee':
      drop([
        { baseId: 'stinger', rateTable: DR_STINGER_BEE },
        { baseId: 'pollen',  rateTable: DR_B           },
      ]);
      break;

    case 'hornet':
      drop([
        { baseId: 'missile',  rateTable: DR_A },
        { baseId: 'antennae', rateTable: DR_B },
        { baseId: 'orange',   rateTable: DR_C },
      ]);
      break;

    case 'beekeeper':
      drop([
        { baseId: 'disc',   rateTable: DR_B },
        { baseId: 'cutter', rateTable: DR_C },
      ]);
      break;

    case 'queen_bee':
      drop([
        { baseId: 'pollen',    rateTable: DR_A            },
        { baseId: 'honeycomb', rateTable: DR_B            },
        { baseId: 'stinger',   rateTable: DR_C            },
        { baseId: 'bee_egg',   rateTable: DR_BEE_EGG_QUEEN },
      ]);
      break;

    case 'ladybug':
      drop([
        { baseId: 'rose',  rateTable: DR_A },
        { baseId: 'light', rateTable: DR_B },
      ]);
      break;

    case 'desert_centipede_head':
    case 'desert_centipede_body':
      drop([
        { baseId: 'sand',           rateTable: DR_A },
        { baseId: 'powder',         rateTable: DR_B },
        { baseId: 'centipede_legs', rateTable: DR_C },
      ]);
      break;

    case 'cactus':
      drop([
        { baseId: 'rose',    rateTable: DR_A },
        { baseId: 'clover',  rateTable: DR_B },
        { baseId: 'stinger', rateTable: DR_C },
        // A dedicated Cactus petal is planned — add its drop slot once it exists
      ]);
      break;

    case 'rock':
      drop([
        { baseId: 'moon',  rateTable: DR_A },
        { baseId: 'heavy', rateTable: DR_B },
      ]);
      break;

    case 'dandelion':
      drop([
        { baseId: 'dandelion_seed_petal', rateTable: DR_A },
      ]);
      break;

    case 'sandstorm':
      drop([
        { baseId: 'sand',  rateTable: DR_A },
        { baseId: 'stick', rateTable: DR_C }, // kept quite rare relative to Sand
        { baseId: 'glass', rateTable: DR_B },
      ]);
      break;

    case 'scorpion':
      drop([
        { baseId: 'iris',    rateTable: DR_A },
        { baseId: 'pincer',  rateTable: DR_B },
        { baseId: 'missile', rateTable: DR_C },
      ]);
      break;

    case 'beetle':
      drop([
        { baseId: 'bone',       rateTable: DR_A },
        { baseId: 'pincer',     rateTable: DR_A },
        { baseId: 'beetle_egg', rateTable: DR_B },
      ]);
      break;

    case 'jellyfish':
      drop([
        { baseId: 'jelly',              rateTable: DR_A                },
        { baseId: 'lightning',          rateTable: DR_B                },
        { baseId: 'jellyfish_egg',      rateTable: DR_JELLYFISH_EGG    },
      ]);
      break;

    case 'squid':
      drop([
        { baseId: 'ink',      rateTable: DR_A },
        { baseId: 'tentacle', rateTable: DR_B },
        { baseId: 'ink_sack', rateTable: DR_C },
      ]);
      break;

    case 'crab':
      drop([
        { baseId: 'claw',     rateTable: DR_A },
        { baseId: 'carapace', rateTable: DR_B },
      ]);
      break;

    case 'starfish':
      drop([
        { baseId: 'starfish_arm', rateTable: DR_A },
        { baseId: 'coral',        rateTable: DR_B },
      ]);
      break;

    case 'shell':
      drop([
        { baseId: 'pearl',       rateTable: DR_A },
        { baseId: 'shell_shape', rateTable: DR_B },
        { baseId: 'magnet',      rateTable: DR_C },
      ]);
      break;

    case 'alligator':
      drop([
        { baseId: 'ocean_artifact', rateTable: DR_A },
        { baseId: 'fang',           rateTable: DR_A },
        { baseId: 'scales',         rateTable: DR_B },
        { baseId: 'tooth',          rateTable: DR_B },
      ]);
      break;

    case 'sponge':
      drop([
        { baseId: 'sponge_petal', rateTable: DR_A },
        { baseId: 'coral',        rateTable: DR_B },
        { baseId: 'air',          rateTable: DR_C },
      ]);
      break;

    case 'bubble':
      drop([
        { baseId: 'bubble_petal', rateTable: DR_A },
        { baseId: 'air',          rateTable: DR_B },
      ]);
      break;

    case 'sea_cave':
      drop([
        { baseId: 'jellyfish_egg', rateTable: DR_JELLYFISH_EGG },
        { baseId: 'air',           rateTable: DR_A             },
      ]);
      break;

    case 'leech':
      drop([
        { baseId: 'fang', rateTable: DR_A },
      ]);
      break;

    case 'debris':
      drop([
        { baseId: 'compass', rateTable: DR_A },
        { baseId: 'metal',   rateTable: DR_B },
      ]);
      break;

    default:
      // Pyramid, Mummified Beetle, and other unhandled types — no drop yet
      break;
  }

  // Boss: place all collected drops in a single evenly-spaced ring so they
  // don't overlap and aren't scattered too far apart.
  if (isBoss && bossDropQueue.length > 0) {
    const ringRadius = Math.max(60, bossDropQueue.length * 8);
    spawnAllDrops(x, y, bossDropQueue, ringRadius);
  }
}

/** Applies one jellyfish zap's damage to the player, same disc-block/
 *  invincibility/game-over rules as every other player-damage path in this
 *  file. */
function applyJellyfishZapToPlayer(rawDamage, playerInvincible) {
  const dmg = rawDamage * (1 - getDiscBlock());
  if (playerInvincible) return;
  applyDamageToPlayer(dmg);
  triggerHurtFlash(player);
  spawnDamage(player.x, player.y, Math.round(dmg), '#5ec8ff', player.radius, player);
}

export function updateCombat(dt) {
  if (player.dead) { pendingJellyfishZaps.length = 0; return; } // drain so stale zaps never survive across a death
  const playerInvincible = player.invincibleTimer > 0 || player.godmode;

  // ── Jellyfish lightning: resolve zaps queued by mobs.js's jellyfish AI this
  // frame. Drained here (not left for a later pass) so the fading bolt visual
  // and the damage land the same frame the jellyfish fired. Mirrors the same
  // damage/hurt-flash/spawnDamage pattern used for every other player/NPC/pet
  // damage source in this file — see the mob→player contact section below for
  // the player case, and the NPC/pet sections further down for those.
  for (const zap of pendingJellyfishZaps) {
    // NPC target removed along with waves mode — jellyfish zaps only ever
    // target the player now.
    if (zap.targetKind === 'player') applyJellyfishZapToPlayer(zap.damage, playerInvincible);

    jellyfishBolts.push({
      x1: zap.fromX, y1: zap.fromY, x2: zap.targetX, y2: zap.targetY,
      t: 0, lifetime: 220,
    });

    // Chain: chainMobId is only ever set to a friendly pet (see the jellyfish
    // AI block in mobs.js), so this always damages a pet, never re-hits the
    // player/NPC and never hits a hostile mob.
    if (zap.chainMobId != null) {
      const pet = mobs.find(m => m.id === zap.chainMobId && !m.dead && m.isFriendlyPet);
      if (pet) {
        pet.hp -= zap.damage; triggerHurtFlash(pet);
        spawnDamage(pet.x, pet.y, Math.round(zap.damage), '#5ec8ff', pet.radius, pet);
        if (pet.hp <= 0) pet.dead = true; // no drops — same as other pet deaths
        jellyfishBolts.push({
          x1: zap.targetX, y1: zap.targetY, x2: zap.chainX, y2: zap.chainY,
          t: 0, lifetime: 220,
        });
      }
    }
  }
  pendingJellyfishZaps.length = 0;

  // ── Blood Corn/Leaf/Wing growth timer ──────────────────────────────────────
  // Ticks up while active or reloading (mirrors Leaf's own passive-heal
  // uptime rule) — capped at bloodGrowthCapSec, compounding at
  // bloodGrowthRatePerSec. Caches the resulting multiplier on the instance
  // (bloodGrowthMult) so every effect below (base damage, self-damage,
  // passive damage, on-hit damage) reads the same number for this frame.
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isBloodGrowth) continue;
    if (p.bloodGrowthTimer === undefined) p.bloodGrowthTimer = 0;
    if (p.state === 'active' || p.state === 'reloading') {
      const capMs = pt.bloodGrowthCapSec * 1000;
      p.bloodGrowthTimer = Math.min(capMs, p.bloodGrowthTimer + dt);
    }
    const elapsedSec = p.bloodGrowthTimer / 1000;
    p.bloodGrowthMult = Math.pow(1 + pt.bloodGrowthRatePerSec, elapsedSec);
    // Visual-only growth: scales up to 1.6x size at full charge, based on
    // elapsed TIME fraction rather than the damage multiplier itself (Blood
    // Wing's multiplier reaches into the thousands at cap — nowhere near a
    // sane visual size). Purely cosmetic; does not touch p.radius/hitbox.
    const timeFrac = elapsedSec / pt.bloodGrowthCapSec;
    p.bloodVisualScale = 1 + 0.6 * timeFrac;
  }

  // ── Compute player armor from all active petals ───────────────────────────
  player.armor = 0;
  for (const p of petalInstances) {
    if (p.state === 'active' && !p.roseState) {
      const pt = PETAL_TYPES[p.typeId];
      if (pt?.armor) player.armor += pt.armor;
    }
  }

  // ── Leaf passive heal ─────────────────────────────────────────────────────
  // Heals passively whether the petal is active or reloading (but not dead)
  for (const p of petalInstances) {
    if (p.state !== 'active' && p.state !== 'reloading') continue;
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.passiveHeal) continue;
    player.hp = Math.min(player.maxHp, player.hp + pt.passiveHeal * (dt / 1000));
  }

  // ── Starfish passive heal (only while player is below 50% HP) ─────────────
  // Same delivery as Leaf's passive heal, just conditional on HP threshold.
  if (player.hp < player.maxHp * 0.5) {
    for (const p of petalInstances) {
      if (p.state !== 'active' && p.state !== 'reloading') continue;
      const pt = PETAL_TYPES[p.typeId];
      if (!pt?.passiveHealBelowHalf) continue;
      player.hp = Math.min(player.maxHp, player.hp + pt.passiveHealBelowHalf * (dt / 1000));
    }
  }

  // ── Blood Leaf passive damage ──────────────────────────────────────────────
  // Same delivery as Leaf's passive heal, just damages the player instead —
  // and the amount grows with bloodGrowthMult (see the growth-timer tick above).
  for (const p of petalInstances) {
    if (p.state !== 'active' && p.state !== 'reloading') continue;
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.passiveDamage) continue;
    const amount = pt.passiveDamage * (p.bloodGrowthMult ?? 1) * (dt / 1000);
    applyDamageToPlayer(amount);
  }

  // ── Bubble: defend-triggered boost away from this petal's ring position ──
  // Independent cooldown per Bubble instance (bubbleBoostTimer), separate
  // from its normal combat HP/reload cycle. Ticks whether active or
  // reloading (like Leaf's passive heal), so equipping several staggers
  // naturally rather than all firing in lockstep. Fires the instant the
  // timer reaches 0 while the player is holding defend — direction is
  // straight away from wherever this specific petal currently sits
  // relative to the player, so a petal in front pushes the player back,
  // one behind pushes them forward, per instruction. Multiple equipped
  // Bubbles stack (each is its own independent impulse). On firing, the
  // bubble itself breaks (pops) with a small expand+fade visual and starts
  // its normal reload — it does not survive to boost again immediately.
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isBubbleBoost) continue;
    if (p.state !== 'active') continue; // only an intact, orbiting Bubble can pop
    if (p.bubbleBoostTimer === undefined) p.bubbleBoostTimer = pt.reloadTime;
    p.bubbleBoostTimer -= dt;
    if (p.bubbleBoostTimer > 0) continue;
    if (!inputState.retract) continue; // only actually fires while defending — timer just waits at 0 otherwise
    const petalAngle = Math.atan2(p.worldY - player.y, p.worldX - player.x);
    const pushAngle  = petalAngle + Math.PI; // straight away from this petal's position
    player.vx += Math.cos(pushAngle) * pt.boostStrength;
    player.vy += Math.sin(pushAngle) * pt.boostStrength;
    popEffects.push({ x: p.worldX, y: p.worldY, radius: p.radius * 1.8, t: 0, lifetime: 220 });
    damagePetal(p, p.hp + 1); // break it — triggers the normal reload path
  }

  // ── Coral generation chain ──────────────────────────────────────────────────
  // Groups every piece sharing a coralSlotBase; once ALL of them are 'dead',
  // either spawns the next generation (2→3→4→5 pieces) after a short
  // coralSplitDelay, or — past generation 5 — starts the slot's real 5s
  // reload (base.reloadTime) with no live pieces at all until it completes.
  {
    const coralGroups = new Map(); // coralSlotBase → array of pieces
    for (const p of petalInstances) {
      if (p.coralSlotBase === undefined) continue;
      if (!coralGroups.has(p.coralSlotBase)) coralGroups.set(p.coralSlotBase, []);
      coralGroups.get(p.coralSlotBase).push(p);
    }

    for (const [slotBase, group] of coralGroups) {
      // Pieces mid-spawn-delay tick down here regardless of the rest of the group
      for (const p of group) {
        if (p.state === 'spawning') {
          p.coralSpawnTimer -= dt;
          if (p.coralSpawnTimer <= 0) p.state = 'active';
        }
      }

      const allDead = group.every(p => p.state === 'dead');
      if (!allDead) continue;

      const pt = PETAL_TYPES[group[0].typeId];
      const lastGeneration = group[0].coralGeneration;

      if (lastGeneration >= 5) {
        // Chain fully spent — clear every dead piece and start one real
        // reload for the slot. rebuildPetals' own reload-cycle branch (the
        // isCoralChain check there) restarts at generation 1 once it fires.
        for (const p of group) {
          const idx = petalInstances.indexOf(p);
          if (idx !== -1) petalInstances.splice(idx, 1);
        }
        const fresh = makePetal(slotBase, group[0].typeId);
        const freshInst = Array.isArray(fresh) ? fresh[0] : fresh;
        freshInst.state       = 'reloading';
        freshInst.reloadTimer = pt.reloadTime;
        freshInst.hp          = 0;
        petalInstances.push(freshInst);
        continue;
      }

      // Advance to the next generation: remove the dead batch, spawn
      // nextCount new pieces at this slot's current orbit point, each
      // offset per coralOffsetsForCount and held briefly in 'spawning'
      // before they can be hit or hit anything.
      const anchorX = group[0].worldX, anchorY = group[0].worldY;
      const nextGen   = lastGeneration + 1;
      const nextCount = nextGen; // generation N has N pieces, per instruction
      const offsets   = coralOffsetsForCount(nextCount);

      for (const p of group) {
        const idx = petalInstances.indexOf(p);
        if (idx !== -1) petalInstances.splice(idx, 1);
      }

      for (let i = 0; i < nextCount; i++) {
        const piece = makePetal(slotBase, group[0].typeId);
        const inst  = Array.isArray(piece) ? piece[0] : piece;
        // Same slotIdx for every piece in this generation (like Stinger's
        // pieces) — they share one orbit point and diverge only by
        // clusterDx/Dy, so the cluster stays together as it swings around
        // the ring, rather than spreading each piece to its own ring slot.
        // pieceIdx is set purely so rebuildPetals' savedStates keying (which
        // combines slotIdx+pieceIdx) doesn't collide across same-generation
        // siblings — it has no other meaning here.
        inst.slotIdx         = slotBase;
        inst.pieceIdx        = i;
        inst.coralSlotBase   = slotBase;
        inst.coralGeneration = nextGen;
        inst.state           = 'spawning';
        inst.coralSpawnTimer = pt.coralSplitDelay;
        inst.clusterDx = offsets[i].dx * pt.radius * 2;
        inst.clusterDy = offsets[i].dy * pt.radius * 2;
        inst.worldX = anchorX + inst.clusterDx;
        inst.worldY = anchorY + inst.clusterDy;
        petalInstances.push(inst);
      }
    }
  }

  // ── Carapace passive shield ────────────────────────────────────────────────
  // Same delivery as Leaf's passive heal (ticks whether active or reloading),
  // just feeds player.shield instead of player.hp. Shield from every source
  // (Carapace's passive regen, Shell's Rose-style burst) shares one capped
  // ── Carapace passive shield ────────────────────────────────────────────────
  // Same delivery as Leaf's passive heal (ticks whether active or reloading),
  // just feeds player.shield instead of player.hp. Per instruction, the
  // shield cap is no longer built from the petals' own shieldAmount/
  // passiveShieldCap numbers — "your max HP is your max shield" — so
  // maxShield is simply player.maxHp whenever at least one shield-granting
  // petal is equipped, and 0 (no shield at all) otherwise. Petals still
  // control the regen RATE (passiveShield) and burst delivery amount
  // (shieldAmount, used by Shell's rose-style approach in the block further
  // down) — they just no longer define the ceiling.
  let hasShieldSource = false;
  for (const p of petalInstances) {
    if (p.state !== 'active' && p.state !== 'reloading') continue;
    const pt = PETAL_TYPES[p.typeId];
    if (pt?.shieldAmount !== undefined || pt?.passiveShieldCap !== undefined) hasShieldSource = true;
  }
  player.maxShield = hasShieldSource ? player.maxHp : 0;
  for (const p of petalInstances) {
    if (p.state !== 'active' && p.state !== 'reloading') continue;
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.passiveShield) continue;
    player.shield = Math.min(player.maxShield, player.shield + pt.passiveShield * (dt / 1000));
  }
  // Never let leftover shield exceed the current max (e.g. after unequipping
  // a shield petal mid-game, or if maxHp itself just changed) — clamp down
  // gently rather than snapping instantly.
  if (player.shield > player.maxShield) player.shield = player.maxShield;

  // ── Petal → mob hits ───────────────────────────────────────────────────────
  // Roses in approaching/waiting don't fight. Pollen petals spawn entities instead of doing contact damage.
  const activePetals = petalInstances.filter(p => p.state === 'active' && !p.roseState && !PETAL_TYPES[p.typeId]?.dropsPollen);

  for (const petal of activePetals) {
    if (isNaN(petal.worldX) || isNaN(petal.worldY)) {
      console.warn('Petal missing world position:', petal);
      continue;
    }

    for (const mob of mobs) {
      if (mob.dead) continue;
      // Player petals should not damage friendly diggers, beekeepers, or ant pets
      if (mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;

      // Each petal (including individual piece-petals) is tested as a single circle.
      const hitPoints = [{ wx: petal.worldX, wy: petal.worldY, r: petal.radius }];

      for (const hp of hitPoints) {
        // Capsule-aware for leech (tests against its curved trail-body
        // segments instead of a circle around the mob's hitOffsetX/Y-rotated
        // center — see pointHitsMob in mobs.js); every other mob's usual
        // offset-rotated circle check is reproduced byte-for-byte inside
        // pointHitsMob itself, so nothing else changes behavior.
        if (pointHitsMob(mob, hp.wx, hp.wy, hp.r)) {
          const _pt = PETAL_TYPES[petal.typeId];

          // Claw: flat chance to crit for a large multiplier
          let dmg = petal.damage;
          const isCrit = _pt?.critChance && Math.random() < _pt.critChance;
          if (isCrit) dmg *= _pt.critMultiplier;

          // Blood Corn/Leaf/Wing: base damage grows over time while equipped
          // (bloodGrowthMult ticked once per frame above)
          if (_pt?.isBloodGrowth) dmg *= (petal.bloodGrowthMult ?? 1);

          mob.hp -= dmg; damagePetal(petal, mob.damage); triggerHurtFlash(petal);
          mob.alerted = true;
          if (mob.isCentipede) alertChainByMob(mob);  // instantly alert whole chain, no tick delay
          spawnDamage(mob.x, mob.y, dmg, isCrit ? '#ffe066' : '#ff4444', mob.radius, mob);

          // Poison: apply / refresh DoT using petal-type poisonDps. Duration defaults
          // to 3s but can be overridden per-petal (e.g. Iris runs 2s longer).
          if (_pt?.poisonDps) {
            poisonedMobs.set(mob.id, { dps: _pt.poisonDps, timer: _pt.poisonDuration ?? 3000 });
          }

          // Pincer: apply / refresh a flat movement slow for 3s, same duration as poison
          if (_pt?.slowOnHitFactor) {
            pincerSlowedMobs.set(mob.id, { factor: _pt.slowOnHitFactor, timer: 3000 });
          }

          // Tooth / Glass: fixed-tick bleed, independent of poison
          if (_pt?.bleedTickFraction) {
            applyBleed(mob.id, dmg, _pt.bleedTickFraction, _pt.bleedTickInterval, _pt.bleedDuration);
          }

          // Ink Sack: real poison (not bleed) — dps is derived from THIS
          // hit's own damage, since the recipe is "X% of the hit's damage
          // delivered smoothly over Y seconds", not a flat per-tier dps.
          if (_pt?.poisonTickFraction) {
            const poisonDps = (dmg * _pt.poisonTickFraction) / (_pt.poisonTickWindowMs / 1000);
            poisonedMobs.set(mob.id, { dps: poisonDps, timer: _pt.poisonDuration });
          }

          // Ink Sack: explosion — every mob within explosionRadius of the
          // exact spot the petal hit (hp.wx/wy — the petal's own hit-circle
          // location, not the target mob's center) also takes the hit's
          // damage. Pushes a fading ring visual at that same spot so the
          // blast is visible even against mobs it doesn't happen to catch.
          if (_pt?.explosionRadius) {
            explosionEffects.push({ x: hp.wx, y: hp.wy, radius: _pt.explosionRadius, t: 0, lifetime: 260 });
            for (const splash of mobs) {
              if (splash.dead) continue;
              if (splash.typeId === 'digger' || splash.typeId === 'beekeeper' || splash.isFriendlyPet) continue;
              const sd = Math.hypot(splash.x - hp.wx, splash.y - hp.wy);
              if (sd > _pt.explosionRadius) continue;
              const isPrimary = splash.id === mob.id;
              if (!isPrimary) {
                splash.hp -= dmg; splash.alerted = true; triggerHurtFlash(splash);
                spawnDamage(splash.x, splash.y, dmg, '#0d0d12', splash.radius, splash);
                if (splash.hp <= 0) {
                  splash.dead = true;
                  spawnMobDrops(splash, splash.isBoss); addXp(mobXpValue(rarityTier(splash.rarity), splash.isBoss ?? false));
                }
              }
            }
          }

          // Fang: heals the player on every hit
          if (_pt?.healOnHit) {
            player.hp = Math.min(player.maxHp, player.hp + _pt.healOnHit);
          }

          // Blood Corn: damages the player once per mob hit — this self-
          // damage grows on the same curve as its own base damage.
          if (_pt?.selfDamageOnHit) {
            applyDamageToPlayer(_pt.selfDamageOnHit * (petal.bloodGrowthMult ?? 1));
          }

          // Blood Wing: a bonus damage tick applied once per hit (on top of
          // the base contact damage above), also growing on its own curve.
          if (_pt?.onHitDamage) {
            const bonus = _pt.onHitDamage * (petal.bloodGrowthMult ?? 1);
            mob.hp -= bonus;
            spawnDamage(mob.x, mob.y, bonus, '#8a0f16', mob.radius, mob);
          }

          // Heavy: pushes the hit mob back, mass-ratio scaled like mob<->mob
          // collision physics (see the identical formula in mobs.js) —
          // the player itself doesn't move, only the mob does.
          if (_pt?.knockbackOnHit) {
            const kdx = mob.x - petal.worldX, kdy = mob.y - petal.worldY;
            const klen = Math.hypot(kdx, kdy) || 1;
            const massRatio = PLAYER_MASS / (PLAYER_MASS + (mob.mass || 1));
            mob.x += (kdx / klen) * _pt.knockbackStrength * massRatio;
            mob.y += (kdy / klen) * _pt.knockbackStrength * massRatio;
          }

          // Lightning: chains the same hit damage out to nearby mobs, same
          // shared helper Jellyfish Egg's pet uses. mob (the primary target)
          // already took its damage above — chainLightning only touches the
          // OTHER mobs in the chain, up to chainCap total including mob itself.
          if (_pt?.isChainLightning && mob.hp > 0) {
            chainLightning(mob, dmg, Math.max(0, _pt.chainCap - 1), 40);
          }

          // Stinger: one-shot — destroy the petal immediately after hitting
          if (_pt?.oneShot) {
            damagePetal(petal, petal.hp + 1);
          }

          if (mob.hp <= 0) {
            mob.dead = true;
            spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false));
          }
          break; // one piece hit is enough per petal-mob pair per frame
        }
      }
    }
  }

  // hitCooldowns removed: no decay loop needed

  // ── Poison DoT tick ────────────────────────────────────────────────────────
  for (const [mobId, poison] of poisonedMobs) {
    poison.timer -= dt;
    if (poison.timer <= 0) { poisonedMobs.delete(mobId); continue; }
    const mob = mobs.find(m => m.id === mobId && !m.dead);
    if (!mob) { poisonedMobs.delete(mobId); continue; }
    const tick = poison.dps * (dt / 1000);
    mob.hp -= tick; mob.alerted = true; spawnDamage(mob.x, mob.y, tick, '#aa44ff', mob.radius, mob);
    if (mob.hp <= 0) {
      mob.dead = true;
      spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false));
      poisonedMobs.delete(mobId);
    }
  }

  // ── Bleed DoT tick (Tooth, Glass) ──────────────────────────────────────────
  // Fixed-tick, not a smooth rate — deals tickDamage every tickInterval until
  // ticksLeft runs out, independent of poison (both can be active at once).
  for (const [mobId, bleed] of bleedingMobs) {
    const mob = mobs.find(m => m.id === mobId && !m.dead);
    if (!mob) { bleedingMobs.delete(mobId); continue; }
    bleed.tickTimer -= dt;
    while (bleed.tickTimer <= 0 && bleed.ticksLeft > 0) {
      mob.hp -= bleed.tickDamage; mob.alerted = true;
      spawnDamage(mob.x, mob.y, bleed.tickDamage, '#ff8844', mob.radius, mob);
      bleed.ticksLeft -= 1;
      bleed.tickTimer += bleed.tickInterval;
      if (mob.hp <= 0) {
        mob.dead = true;
        spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false));
        break;
      }
    }
    if (mob.dead || bleed.ticksLeft <= 0) bleedingMobs.delete(mobId);
  }

  // ── Player poison tick
  if (playerPoison.timer > 0 && !playerInvincible) {
    playerPoison.timer -= dt;
    const tick = playerPoison.dps * (dt / 1000);
    applyDamageToPlayer(tick); triggerHurtFlash(player);    spawnDamage(player.x, player.y, tick, '#aa44ff', player.radius, player);
    if (playerPoison.timer <= 0) { playerPoison.dps = 0; playerPoison.timer = 0; }
  } else if (playerPoison.timer > 0 && playerInvincible) {
    playerPoison.timer -= dt; // still tick down the poison timer, just no damage
    if (playerPoison.timer <= 0) { playerPoison.dps = 0; playerPoison.timer = 0; }
  }

  // ── Sponge pool drain ───────────────────────────────────────────────────
  // Smooth passive drain, recalculated every frame from whatever's currently
  // left in the pool and however much time remains — so the rate naturally
  // rises when fresh damage merges in (window resets to full) and eases as
  // it approaches empty. This damage bypasses applyDamageToPlayer (it would
  // just re-defer itself back into the pool) but still absorbs into Shield
  // first, same layering as every other damage source.
  if (player.spongePool > 0) {
    if (playerInvincible) {
      // Paused, not lost, while invincible — matches how poison behaves.
    } else {
      const rate = player.spongeTimeRemaining > 0
        ? player.spongePool / player.spongeTimeRemaining
        : player.spongePool / dt; // window already at/past 0 — flush the rest this frame
      const tick = Math.min(player.spongePool, rate * dt);
      player.spongePool -= tick;
      player.spongeTimeRemaining = Math.max(0, player.spongeTimeRemaining - dt);

      let hpTick = tick;
      if (player.shield > 0) {
        const absorbed = Math.min(player.shield, hpTick);
        player.shield -= absorbed;
        hpTick -= absorbed;
      }
      if (hpTick > 0) {
        player.hp = Math.max(0, player.hp - hpTick);
        if (player.hp <= 0) player.dead = true;
        triggerHurtFlash(player);
        spawnDamage(player.x, player.y, hpTick, '#c4945c', player.radius, player);
      }

      if (player.spongePool <= 0.01 || player.spongeTimeRemaining <= 0) {
        player.spongePool = 0;
        player.spongeTimeRemaining = 0;
      }
    }
  }

  // ── Mob -> player contact damage & knockback ───────────────────────────────
  for (const mob of mobs) {
    if (mob.dead) continue;
    if (mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;  // friendly — never damage player

    const _hAngle2 = (mob.facing || 0) + Math.PI / 2;
    const _swayX2  = mob.swayHitX || 0;
    const _hOx2 = ((mob.hitOffsetX||0) + _swayX2) * Math.cos(_hAngle2) - (mob.hitOffsetY||0) * Math.sin(_hAngle2);
    const _hOy2 = ((mob.hitOffsetX||0) + _swayX2) * Math.sin(_hAngle2) + (mob.hitOffsetY||0) * Math.cos(_hAngle2);
    const dx   = player.x - (mob.x + _hOx2);
    const dy   = player.y - (mob.y + _hOy2);
    const dist = Math.hypot(dx, dy);
    const minD = player.radius + mob.radius;

    if (dist < minD && dist > 0.001) {
      const rawDamage = mob.contactDps * (dt / 1000);
      const damage = rawDamage * (1 - getDiscBlock());
      if (damage > 0) { /* rose now heals on spawn, not on damage */ }
      if (!playerInvincible) {
        applyDamageToPlayer(damage); triggerHurtFlash(player);

        // Salt: reflects a % of the damage this mob just dealt back onto it
        const reflectPct = getSaltReflectPercent();
        if (reflectPct > 0 && damage > 0) {
          const reflected = damage * reflectPct;
          mob.hp -= reflected; triggerHurtFlash(mob);
          spawnDamage(mob.x, mob.y, Math.round(reflected), '#f4f4f4', mob.radius, mob);
          if (mob.hp <= 0) {
            mob.dead = true;
            spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false));
          }
        }
      }
      mob.alerted = true;
      if (mob.isCentipede) alertChainByMob(mob);

      // Player body damage — always on, boosted by cutter accessories
      if (!mob.dead) {
        const bodyDps  = getPlayerBodyDamage();
        const bodyDmg  = bodyDps * (dt / 1000);
        mob.hp -= bodyDmg; triggerHurtFlash(mob);      spawnDamage(mob.x, mob.y, Math.round(bodyDmg), '#ffdd44', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
      // Spider contact applies poison DoT to player
      if (mob.typeId === 'spider') {
        const s = getMobStats(mob.typeId, mob.tier);
        if (s && s.poisonDps) { playerPoison.dps = s.poisonDps; playerPoison.timer = 3000; }
      }

      const nx = dx / dist;
      const ny = dy / dist;

      const overlap = minD - dist;
      const px = player.x + nx * overlap * 0.5;
      const py = player.y + ny * overlap * 0.5;
      if (canMoveTo(px, py, player.radius)) {
        player.x = px; player.y = py;
      }

      const impulse = 3.5 + mob.contactDps * 0.18;
      player.vx += nx * impulse;
      player.vy += ny * impulse;

      const maxKB = 14;
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > maxKB) {
        player.vx = (player.vx / speed) * maxKB;
        player.vy = (player.vy / speed) * maxKB;
      }
    }
  }

  // ── Friendly mob -> player collision: no collision (player passes through diggers/beekeepers) ──

  // ── Digger -> mob contact damage (digger fights on the player's side) ──────
  for (const digger of mobs) {
    if (digger.dead || digger.typeId !== 'digger') continue;
    for (const mob of mobs) {
      if (mob.dead || mob.id === digger.id || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      const dx   = mob.x - digger.x;
      const dy   = mob.y - digger.y;
      const dist = Math.hypot(dx, dy);
      const minD = digger.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg = Math.max(1, digger.contactDps * (dt / 1000) * 20);
        mob.hp -= dmg; mob.alerted = true; triggerHurtFlash(digger);
        spawnDamage(mob.x, mob.y, dmg, '#ff4444', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
    }
  }

  // ── Mob -> digger contact damage (mobs can damage diggers)
  for (const mob of mobs) {
    if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
    for (const digger of mobs) {
      if (digger.dead || digger.typeId !== 'digger' || digger.id === mob.id) continue;
      const dx = digger.x - mob.x;
      const dy = digger.y - mob.y;
      const dist = Math.hypot(dx, dy);
      const minD = digger.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg2 = Math.max(1, mob.contactDps * (dt / 1000) * 20);
        digger.hp -= dmg2; triggerHurtFlash(digger);        mob.alerted = true;
        spawnDamage(digger.x, digger.y, dmg2, '#ff4444', digger.radius, digger);
        // Spider contact applies poison to diggers
        if (mob.typeId === 'spider') {
          const s = getMobStats(mob.typeId, mob.tier);
          if (s && s.poisonDps) { poisonedMobs.set(digger.id, { dps: s.poisonDps, timer: 3000 }); }
        }
        if (digger.hp <= 0) { digger.dead = true; spawnMobDrops(digger, digger.isBoss); addXp(mobXpValue(rarityTier(digger.rarity), digger.isBoss ?? false)); }
      }
    }
  }

  // ── Beekeeper -> mob contact damage (beekeeper fights on the player's side) ──────
  for (const beekeeper of mobs) {
    if (beekeeper.dead || beekeeper.typeId !== 'beekeeper') continue;
    for (const mob of mobs) {
      if (mob.dead || mob.id === beekeeper.id || mob.typeId === 'beekeeper' || mob.typeId === 'digger' || mob.isFriendlyPet) continue;
      const dx   = mob.x - beekeeper.x;
      const dy   = mob.y - beekeeper.y;
      const dist = Math.hypot(dx, dy);
      const minD = beekeeper.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg = Math.max(1, beekeeper.contactDps * (dt / 1000) * 20);
        mob.hp -= dmg; mob.alerted = true; triggerHurtFlash(beekeeper);
        spawnDamage(mob.x, mob.y, dmg, '#ff4444', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
    }
  }

  // ── Mob -> beekeeper contact damage (mobs can damage beekeepers)
  for (const mob of mobs) {
    if (mob.dead || mob.typeId === 'beekeeper' || mob.typeId === 'digger' || mob.isFriendlyPet) continue;
    for (const beekeeper of mobs) {
      if (beekeeper.dead || beekeeper.typeId !== 'beekeeper' || beekeeper.id === mob.id) continue;
      const dx = beekeeper.x - mob.x;
      const dy = beekeeper.y - mob.y;
      const dist = Math.hypot(dx, dy);
      const minD = beekeeper.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg2 = Math.max(1, mob.contactDps * (dt / 1000) * 20);
        beekeeper.hp -= dmg2; triggerHurtFlash(beekeeper);        mob.alerted = true;
        spawnDamage(beekeeper.x, beekeeper.y, dmg2, '#ff4444', beekeeper.radius, beekeeper);
        // Spider contact applies poison to beekeepers
        if (mob.typeId === 'spider') {
          const s = getMobStats(mob.typeId, mob.tier);
          if (s && s.poisonDps) { poisonedMobs.set(beekeeper.id, { dps: s.poisonDps, timer: 3000 }); }
        }
        if (beekeeper.hp <= 0) { beekeeper.dead = true; spawnMobDrops(beekeeper, beekeeper.isBoss); addXp(mobXpValue(rarityTier(beekeeper.rarity), beekeeper.isBoss ?? false)); }
      }
    }
  }

  // ── Friendly jellyfish pet: chain lightning on a timer ─────────────────────
  // Same shape as the hostile jellyfish's own zap AI in mobs.js, just aimed at
  // hostile mobs instead of the player, using this file's generic
  // chainLightning() helper (up to 4 total mobs hit — origin + 3 chain hops).
  const FRIENDLY_JELLYFISH_ZAP_INTERVAL_MS = 500;
  const FRIENDLY_JELLYFISH_MAX_CHAIN = 3; // + the primary target = 4 mobs total, per instruction
  for (const pet of mobs) {
    if (pet.dead || !pet.isFriendlyPet || pet.typeId !== 'jellyfish') continue;

    if (pet.friendlyZapTimer === undefined) pet.friendlyZapTimer = FRIENDLY_JELLYFISH_ZAP_INTERVAL_MS;

    // Find the nearest hostile mob within this pet's own aggro range
    let target = null, bestD = pet.aggroRange || 300;
    for (const mob of mobs) {
      if (mob.dead || mob.isFriendlyPet) continue;
      if (mob.typeId === 'digger' || mob.typeId === 'beekeeper') continue;
      const d = Math.hypot(mob.x - pet.x, mob.y - pet.y);
      if (d < bestD) { bestD = d; target = mob; }
    }
    if (!target) continue; // only counts down once something is actually in range, same convention as the hostile version

    pet.friendlyZapTimer -= dt;
    if (pet.friendlyZapTimer > 0) continue;
    pet.friendlyZapTimer = FRIENDLY_JELLYFISH_ZAP_INTERVAL_MS;

    jellyfishBolts.push({ x1: pet.x, y1: pet.y, x2: target.x, y2: target.y, t: 0, lifetime: 220 });
    target.hp -= pet.damage; target.alerted = true; triggerHurtFlash(target);
    spawnDamage(target.x, target.y, Math.round(pet.damage), '#5ec8ff', target.radius, target);
    if (target.hp <= 0) {
      target.dead = true;
      spawnMobDrops(target, target.isBoss); addXp(mobXpValue(rarityTier(target.rarity), target.isBoss ?? false));
    } else {
      chainLightning(target, pet.damage, FRIENDLY_JELLYFISH_MAX_CHAIN, 60);
    }
  }

  // ── Friendly ant pet → enemy mob contact damage ────────────────────────────
  for (const pet of mobs) {
    if (pet.dead || !pet.isFriendlyPet) continue;
    for (const mob of mobs) {
      if (mob.dead || mob.id === pet.id) continue;
      if (mob.isFriendlyPet) continue;                            // don't fight fellow pets
      if (mob.typeId === 'digger' || mob.typeId === 'beekeeper') continue;  // friendly — skip
      const dx   = mob.x - pet.x;
      const dy   = mob.y - pet.y;
      const dist = Math.hypot(dx, dy);
      const minD = pet.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg = Math.max(1, pet.contactDps * (dt / 1000) * 20);
        mob.hp -= dmg; mob.alerted = true; triggerHurtFlash(mob);
        spawnDamage(mob.x, mob.y, dmg, '#ff4444', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
    }
  }

  // ── Enemy mob → friendly ant pet contact damage ─────────────────────────────
  for (const mob of mobs) {
    if (mob.dead || mob.isFriendlyPet) continue;
    if (mob.typeId === 'digger' || mob.typeId === 'beekeeper') continue;
    for (const pet of mobs) {
      if (pet.dead || !pet.isFriendlyPet || pet.id === mob.id) continue;
      const dx   = pet.x - mob.x;
      const dy   = pet.y - mob.y;
      const dist = Math.hypot(dx, dy);
      const minD = pet.radius + mob.radius;
      if (dist < minD + COLLISION_EPS && dist > 0.001) {
        const dmg2 = Math.max(1, mob.contactDps * (dt / 1000) * 20);
        pet.hp -= dmg2; triggerHurtFlash(pet);        mob.alerted = true;
        spawnDamage(pet.x, pet.y, dmg2, '#ff4444', pet.radius, pet);
        // Spider contact applies poison to friendly pets
        if (mob.typeId === 'spider') {
          const s = getMobStats(mob.typeId, mob.tier);
          if (s && s.poisonDps) { poisonedMobs.set(pet.id, { dps: s.poisonDps, timer: 3000 }); }
        }
        if (pet.hp <= 0) { pet.dead = true; }   // no drops; death handled by petal reload cycle
      }
    }
  }

  // ── Missile → player contact damage ───────────────────────────────────────
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (m.dead) continue;

    // Collide with friendly mobs first (diggers and beekeepers)
    for (const mob of mobs) {
      if (mob.dead || (mob.typeId !== 'digger' && mob.typeId !== 'beekeeper')) continue;
      const ddx = mob.x - m.x;
      const ddy = mob.y - m.y;
      const dd = Math.hypot(ddx, ddy);
      if (dd < mob.radius + m.radius && dd > 0.001) {
        const dmg = m.damage;
        mob.hp -= dmg; triggerHurtFlash(mob);        mob.alerted = true;
        spawnDamage(mob.x, mob.y, dmg, '#ff4444', mob.radius, mob);
        m.dead = true;
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
        break;
      }
    }

    if (m.dead) continue;

    const dx   = player.x - m.x;
    const dy   = player.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist < player.radius + m.radius && dist > 0.001) {
      const dmg = m.damage * (1 - getDiscBlock());
      if (!playerInvincible) {
        applyDamageToPlayer(dmg);
        spawnDamage(player.x, player.y, Math.round(dmg), '#ff4444', player.radius, player);
      }
      // Knockback in missile travel direction
      const nx = dx / dist, ny = dy / dist;
      const impulse = 4.0 + m.damage * 0.002;
      player.vx += nx * impulse; player.vy += ny * impulse;
      const maxKB = 16;
      const spd = Math.hypot(player.vx, player.vy);
      if (spd > maxKB) { player.vx = (player.vx/spd)*maxKB; player.vy = (player.vy/spd)*maxKB; }
      m.dead = true;
    }
  }

  // ── Petal → missile hits ───────────────────────────────────────────────────
  for (const petal of activePetals) {
    if (isNaN(petal.worldX) || isNaN(petal.worldY)) continue;
    for (const m of missiles) {
      if (m.dead) continue;
      // Each petal (including individual piece-petals) is tested as a single circle.
      const hitPoints = [{ wx: petal.worldX, wy: petal.worldY, r: petal.radius }];
      for (const hp of hitPoints) {
        const dx   = hp.wx - m.x;
        const dy   = hp.wy - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist < hp.r + m.radius) {
          m.hp -= petal.damage;
          damagePetal(petal, m.damage);
          if (m.hp <= 0) m.dead = true;
          break; // one piece hit per missile per frame is enough
        }
      }
    }
  }

  // ── Boss bee stingers → player & petal collisions ─────────────────────────
  for (let i = bossStingers.length - 1; i >= 0; i--) {
    const s = bossStingers[i];
    if (s.dead) continue;

    // Petal hits stinger
    for (const petal of activePetals) {
      if (isNaN(petal.worldX) || isNaN(petal.worldY)) continue;
      const dx = petal.worldX - s.x, dy = petal.worldY - s.y;
      if (Math.hypot(dx, dy) < petal.radius + s.radius) {
        s.hp -= petal.damage;
        damagePetal(petal, s.damage);
        if (s.hp <= 0) { s.dead = true; break; }
      }
    }
    if (s.dead) continue;

    // Stinger hits friendly pets
    for (const mob of mobs) {
      if (mob.dead || !mob.isFriendlyPet) continue;
      const fdx = mob.x - s.x, fdy = mob.y - s.y;
      const fdist = Math.hypot(fdx, fdy);
      if (fdist < mob.radius + s.radius && fdist > 0.001) {
        mob.hp -= s.damage; triggerHurtFlash(mob);        spawnDamage(mob.x, mob.y, Math.round(s.damage), '#ff4444', mob.radius, mob);
        if (mob.hp <= 0) mob.dead = true;
      }
    }
    if (s.dead) continue;

    // Stinger hits player
    const dx2 = player.x - s.x, dy2 = player.y - s.y;
    const dist2 = Math.hypot(dx2, dy2);
    if (dist2 < player.radius + s.radius && dist2 > 0.001) {
      const dmg = s.damage * (1 - getDiscBlock());
      if (!playerInvincible) {
        applyDamageToPlayer(dmg); triggerHurtFlash(player);        spawnDamage(player.x, player.y, Math.round(dmg), '#ff4444', player.radius, player);
      }
      const nx = dx2 / dist2, ny = dy2 / dist2;
      player.vx += nx * 5; player.vy += ny * 5;
    }
  }

  // ── Boss centipede peas → player, pets collisions ─────────────────────────
  for (const p of bossPeas) {
    if (p.dead) continue;

    // Petal hits pea
    for (const petal of activePetals) {
      if (isNaN(petal.worldX) || isNaN(petal.worldY)) continue;
      const dx = petal.worldX - p.x, dy = petal.worldY - p.y;
      if (Math.hypot(dx, dy) < petal.radius + p.radius) {
        p.hp -= petal.damage; triggerHurtFlash(p);
        damagePetal(petal, p.damage);
        if (p.hp <= 0) { p.dead = true; break; }
      }
    }
    if (p.dead) continue;

    // Pea bounces off player body (no damage, just physics)
    const pdx = player.x - p.x, pdy = player.y - p.y;
    const pdist = Math.hypot(pdx, pdy);
    if (pdist < player.radius + p.radius && pdist > 0.001) {
      const dmg = p.damage * (1 - getDiscBlock());
      if (!playerInvincible) {
        applyDamageToPlayer(dmg); triggerHurtFlash(player);        spawnDamage(player.x, player.y, Math.round(dmg), '#88ff44', player.radius, player);
      }
      // Bounce
      const nnx = pdx / pdist, nny = pdy / pdist;
      p.vx = -nnx * Math.hypot(p.vx, p.vy);
      p.vy = -nny * Math.hypot(p.vx, p.vy);
      player.vx += nnx * 3; player.vy += nny * 3;
    }

    // Pea hits friendly pets
    for (const mob of mobs) {
      if (mob.dead || !mob.isFriendlyPet) continue;
      const fdx = mob.x - p.x, fdy = mob.y - p.y;
      const fdist = Math.hypot(fdx, fdy);
      if (fdist < mob.radius + p.radius && fdist > 0.001) {
        mob.hp -= p.damage; triggerHurtFlash(mob);        spawnDamage(mob.x, mob.y, Math.round(p.damage), '#88ff44', mob.radius, mob);
        if (mob.hp <= 0) mob.dead = true;
        const nnx = fdx / fdist, nny = fdy / fdist;
        p.vx = -nnx * Math.hypot(p.vx, p.vy);
        p.vy = -nny * Math.hypot(p.vx, p.vy);
      }
    }

  }

  // ── Boss ladybug roses → player, pets collisions ──────────────────────────
  // Roses do no damage but bounce off — player petals can destroy them
  for (const r of bossRoses) {
    if (r.dead) continue;

    // Petal hits rose — destroys it (no heal for ladybug, rose was killed)
    for (const petal of activePetals) {
      if (isNaN(petal.worldX) || isNaN(petal.worldY)) continue;
      const dx = petal.worldX - r.x, dy = petal.worldY - r.y;
      if (Math.hypot(dx, dy) < petal.radius + r.radius) {
        r.hp -= petal.damage; triggerHurtFlash(r);
        damagePetal(petal, 0); // roses deal no damage to petals
        if (r.hp <= 0) { r.dead = true; break; }
      }
    }
    if (r.dead) continue;

    // Rose bounces off player (no damage)
    const pdx = player.x - r.x, pdy = player.y - r.y;
    const pdist = Math.hypot(pdx, pdy);
    if (pdist < player.radius + r.radius && pdist > 0.001) {
      player.vx += (pdx / pdist) * 2; player.vy += (pdy / pdist) * 2;
    }

    // Rose collides with friendly pets (solid — pushes them away)
    for (const mob of mobs) {
      if (mob.dead || !mob.isFriendlyPet) continue;
      const fdx = mob.x - r.x, fdy = mob.y - r.y;
      const fdist = Math.hypot(fdx, fdy);
      if (fdist < mob.radius + r.radius && fdist > 0.001) {
        // Push pet fully out of overlap
        const overlap = (mob.radius + r.radius) - fdist;
        const nx = fdx / fdist, ny = fdy / fdist;
        const npx = mob.x + nx * overlap, npy = mob.y + ny * overlap;
        if (canMoveTo(npx, npy, mob.radius)) { mob.x = npx; mob.y = npy; }
        mob.vx = (mob.vx ?? 0) + nx * 3;
        mob.vy = (mob.vy ?? 0) + ny * 3;
      }
    }

  }

  // ── Rose movement logic ───────────────────────────────────────────────────
  // After spawning: wait 0.5s ('spawn_wait'), then if player is below max HP
  // move to the player body ('approaching' over 350ms), wait 500ms ('waiting'),
  // heal the player, then reload.
  // Shell reuses this exact state machine — it checks/delivers shield instead
  // of HP (see the shieldAmount branches below), everything else is identical.
  for (const p of petalInstances) {
    if (!p.roseState) continue;
    const pt = PETAL_TYPES[p.typeId];
    const isShield = pt.shieldAmount !== undefined;

    if (p.roseState === 'spawn_wait') {
      p.roseTimer -= dt;
      if (p.roseTimer <= 0) {
        const needsDelivery = isShield ? player.shield < player.maxShield : player.hp < player.maxHp;
        if (needsDelivery) {
          // Player needs it — move in to deliver
          p.roseState  = 'approaching';
          p.roseTimer  = 350;
          p.roseStartX = p.worldX;
          p.roseStartY = p.worldY;
        } else {
          // Already full — orbit normally until next reload cycle
          p.roseState = null;
        }
      }
    } else if (p.roseState === 'approaching') {
      p.roseTimer -= dt;
      const progress = Math.min(1, 1 - p.roseTimer / 350);
      const ease = 1 - Math.pow(1 - progress, 3);
      const dirX = p.roseStartX - player.x;
      const dirY = p.roseStartY - player.y;
      const len  = Math.hypot(dirX, dirY) || 1;
      const edgeX = player.x + (dirX / len) * PLAYER_RADIUS;
      const edgeY = player.y + (dirY / len) * PLAYER_RADIUS;
      p.worldX = p.roseStartX + (edgeX - p.roseStartX) * ease;
      p.worldY = p.roseStartY + (edgeY - p.roseStartY) * ease;
      if (p.roseTimer <= 0) {
        p.roseState = 'waiting';
        p.roseTimer = 500;
      }
    } else if (p.roseState === 'waiting') {
      p.roseTimer -= dt;
      if (p.roseTimer <= 0) {
        if (isShield) {
          player.shield = Math.min(player.maxShield, player.shield + pt.shieldAmount);
        } else {
          player.hp = Math.min(player.maxHp, player.hp + pt.healAmount);
        }
        p.roseState   = null;
        p.state       = 'reloading';
        p.reloadTimer = pt.reloadTime;
        p.hp          = 0;
      }
    }
  }

  // ── Pollen petal state machine ────────────────────────────────────────────
  // pre_drop → wait 0.5s after reload
  // ready    → fires while held; petal drops from orbit into world
  // (no watching state — the petal itself becomes the dropped entity)
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.dropsPollen || p.state !== 'active') continue;

    // pre_drop: count down, then fall through to ready check in same frame
    if (p.pollenState === 'pre_drop') {
      p.pollenTimer -= dt;
      if (p.pollenTimer > 0) continue; // still waiting
      p.pollenState = 'ready';
      // fall through intentionally ↓
    }

    if (p.pollenState === 'ready') {
      // Drop: petal itself becomes the dropped entity; spawn a fresh reloading petal for the slot
      if (inputState.expand || inputState.retract) {
        p.state       = 'dropped';
        p.pollenState = null;
        p.dropTimer   = 6000;
        p.dropVx      = 0;
        p.dropVy      = 0;
        // Spawn a fresh petal for this slot so the ring reloads immediately
        const fresh = makePetal(p.slotIdx, p.typeId);
        const freshInst = Array.isArray(fresh) ? fresh[0] : fresh;
        freshInst.pollenPieceIdx = p.pollenPieceIdx;
        freshInst.pollenSlotBase = p.pollenSlotBase;
        petalInstances.push(freshInst);
      }
    }
  }

  // ── Dropped pollen petal: physics + mob hits ──────────────────────────────
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.dropsPollen || p.state !== 'dropped') continue;

    p.dropTimer -= dt;
    if (p.dropTimer <= 0 || p.hp <= 0) {
      // Remove this dropped instance — it's done
      const idx = petalInstances.indexOf(p);
      if (idx !== -1) petalInstances.splice(idx, 1);
      continue;
    }

    p.worldX += p.dropVx;
    p.worldY += p.dropVy;
    p.dropVx *= 0.88;
    p.dropVy *= 0.88;

    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      const dx   = p.worldX - mob.x;
      const dy   = p.worldY - mob.y;
      const dist = Math.hypot(dx, dy);
      if (dist < p.radius + mob.radius && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        const overlap = p.radius + mob.radius - dist;
        p.worldX += nx * overlap;
        p.worldY += ny * overlap;
        const impulse = 2.5 + mob.contactDps * 0.04;
        p.dropVx += nx * impulse;
        p.dropVy += ny * impulse;
        const dmg = Math.max(0.1, p.damage * (dt / 1000) - (mob.armor ?? 0));
        mob.hp -= dmg; mob.alerted = true;
        spawnDamage(mob.x, mob.y, dmg, '#d8e786', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
        p.hp -= mob.contactDps * (dt / 1000);
        if (p.hurtFlash !== undefined) p.hurtFlash = 120;
      }
    }
  }

  // ── Pollen entity → mob hits (DPS on contact, entity pushed by mobs — massless) ──
  for (const pe of pollenEntities) {
    if (pe.dead) continue;
    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      const dx   = pe.x - mob.x;
      const dy   = pe.y - mob.y;
      const dist = Math.hypot(dx, dy);
      if (dist < pe.radius + mob.radius && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        // Pollen is massless — push it fully out of overlap, mob doesn't move
        const overlap = pe.radius + mob.radius - dist;
        pe.x += nx * overlap;
        pe.y += ny * overlap;
        // Add velocity impulse to pollen entity in push direction
        const impulse = 2.5 + mob.contactDps * 0.04;
        pe.vx += nx * impulse;
        pe.vy += ny * impulse;
        // Pollen damages mob (DPS)
        const dmg = Math.max(0.1, pe.damage * (dt / 1000) - (mob.armor ?? 0));
        mob.hp -= dmg; mob.alerted = true;
        spawnDamage(mob.x, mob.y, dmg, '#d8e786', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
        // Mob damages pollen (DPS, no knockback to mob)
        pe.hp -= mob.contactDps * (dt / 1000);
        if (pe.hp <= 0) pe.dead = true;
      }
    }
  }


  // ── Ink petal: pre_drop → ready → placed (grows, slows+poisons, no collision) ──
  // Same trigger shape as pollen (waits 0.5s, drops on attack/defend), but the
  // placed pool never takes/deals contact damage, can't be destroyed, and
  // multiple pools can be active at once — each placement immediately frees
  // the slot with a fresh reloading petal, exactly like pollen.
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isInkPool || p.state !== 'active') continue;

    if (p.inkState === 'pre_drop') {
      p.inkTimer -= dt;
      if (p.inkTimer > 0) continue;
      p.inkState = 'ready';
      // fall through intentionally ↓
    }

    if (p.inkState === 'ready') {
      if (inputState.expand || inputState.retract) {
        // Place it: this instance becomes the pool itself (own draw shape,
        // per instruction — no separate synthetic visual), sitting exactly
        // where it currently orbits, nudged outward slightly by the ring's
        // own spin momentum at the moment of drop.
        const tangentSpeed = ORBIT_SPEED * currentOrbitR;
        const angle = Math.atan2(p.worldY - player.y, p.worldX - player.x);
        const tangentAngle = angle + Math.PI / 2;
        p.state        = 'dropped';
        p.inkState     = 'placed';
        p.inkTimer     = pt.inkPoolDuration;
        p.inkFadeT     = 0; // fade-out progress once duration ends
        p.inkStartX    = p.worldX;
        p.inkStartY    = p.worldY;
        p.inkCurRadius = pt.inkStartRadius;
        // Small one-time drift from spin, decays like the pollen drop's own physics
        p.dropVx = Math.cos(tangentAngle) * tangentSpeed * 0.4;
        p.dropVy = Math.sin(tangentAngle) * tangentSpeed * 0.4;
        // Free the slot immediately — fresh petal reloads right away, same as pollen
        const fresh = makePetal(p.slotIdx, p.typeId);
        petalInstances.push(Array.isArray(fresh) ? fresh[0] : fresh);
      }
    }
  }

  // ── Placed ink pool: grows, applies slow+poison, fades out, then removed ──
  for (const p of petalInstances) {
    if (p.inkState !== 'placed' && p.inkState !== 'fading') continue;
    const pt = PETAL_TYPES[p.typeId];

    // Small residual drift from the placement fling, same friction as pollen's drop
    p.worldX += p.dropVx; p.worldY += p.dropVy;
    p.dropVx *= 0.88; p.dropVy *= 0.88;

    if (p.inkState === 'placed') {
      p.inkTimer -= dt;
      const elapsed  = 1 - Math.max(0, p.inkTimer) / pt.inkPoolDuration;
      p.inkCurRadius = pt.inkStartRadius + (pt.inkEndRadius - pt.inkStartRadius) * Math.min(1, elapsed);

      // No collision — just an area check against every hostile mob each frame
      for (const mob of mobs) {
        if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
        const d = Math.hypot(mob.x - p.worldX, mob.y - p.worldY);
        if (d < p.inkCurRadius + mob.radius) {
          pincerSlowedMobs.set(mob.id, { factor: pt.inkSlowFactor, timer: 250 }); // refreshed every frame while inside, like a standing field
          if (pt.poisonDps) poisonedMobs.set(mob.id, { dps: pt.poisonDps, timer: 250 });
        }
      }

      if (p.inkTimer <= 0) {
        p.inkState = 'fading';
        p.inkFadeT = 300; // quick fade, not an instant pop — matches instruction
      }
    } else if (p.inkState === 'fading') {
      p.inkFadeT -= dt;
      if (p.inkFadeT <= 0) {
        const idx = petalInstances.indexOf(p);
        if (idx !== -1) petalInstances.splice(idx, 1);
      }
    }
  }


  // ── Ground-guard petal (Pearl): pre_drop → ready → planted → return ────────
  // Drops on attack/defend (same 0.5s pre_drop wait as ink/pollen) and sits
  // exactly where it currently orbits — but unlike ink, this slot does NOT
  // get a fresh replacement petal: it's locked until either (a) the guard is
  // killed (damagePetal's normal death path sets state='reloading', which
  // naturally frees the slot) or (b) the key is released and it's still
  // alive, in which case it animates back into the ring with a small bounce.
  // While planted it keeps fighting normally (same contact-damage rules as
  // any active orbiting petal — see the activePetals loop above, which
  // already includes 'dropped' ground-guards; see the filter tweak there).
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isGroundGuard) continue;

    if (p.state === 'active' && p.guardState === 'pre_drop') {
      p.guardTimer -= dt;
      if (p.guardTimer > 0) continue;
      p.guardState = 'ready';
    }

    if (p.state === 'active' && p.guardState === 'ready') {
      if (inputState.expand || inputState.retract) {
        const tangentSpeed = ORBIT_SPEED * currentOrbitR;
        const angle = Math.atan2(p.worldY - player.y, p.worldX - player.x);
        const tangentAngle = angle + Math.PI / 2;
        p.state      = 'dropped';
        p.guardState = 'planted';
        p.dropVx     = Math.cos(tangentAngle) * tangentSpeed * 0.4;
        p.dropVy     = Math.sin(tangentAngle) * tangentSpeed * 0.4;
        // No fresh replacement petal — the slot is locked while planted.
      }
      continue;
    }

    if (p.guardState === 'planted') {
      // Small residual drift from the placement fling, same friction as ink/pollen
      p.worldX += p.dropVx; p.worldY += p.dropVy;
      p.dropVx *= 0.88; p.dropVy *= 0.88;

      // Nudge back toward the player if it ever drifts outside the
      // approximate visible area (same 600/zoom radius convention used
      // elsewhere in this file for "is this within view").
      const visualRange = 600 / Math.max(0.1, zoomState.v);
      const distFromPlayer = Math.hypot(p.worldX - player.x, p.worldY - player.y);
      if (distFromPlayer > visualRange) {
        const pullAngle = Math.atan2(player.y - p.worldY, player.x - p.worldX);
        const overshoot = distFromPlayer - visualRange;
        p.worldX += Math.cos(pullAngle) * overshoot;
        p.worldY += Math.sin(pullAngle) * overshoot;
      }

      // Key released → return to the ring, HP allowing (if it died while
      // planted, damagePetal already moved it to 'reloading' and this branch
      // is skipped entirely since p.state is no longer 'dropped').
      if (!inputState.expand && !inputState.retract) {
        p.guardState     = 'returning';
        p.guardTimer     = 300; // bounce-back travel time
        p.guardReturnFromX = p.worldX;
        p.guardReturnFromY = p.worldY;
      }
    } else if (p.guardState === 'returning') {
      p.guardTimer -= dt;
      const t = Math.max(0, Math.min(1, 1 - p.guardTimer / 300));
      // Overshoot-then-settle bounce, same easing shape used for the spawn
      // animation elsewhere in this file, just with a small overshoot bump.
      const bounce = t < 1 ? Math.sin(t * Math.PI) * 0.15 * (1 - t) : 0;
      const ease   = (1 - Math.pow(1 - t, 3)) + bounce;
      // Target is wherever its orbit slot currently is — read from the main
      // orbit loop's own math isn't available here, so just aim at the
      // player and let the normal orbit-positioning loop take over once
      // p.state flips back to 'active' below; this is only the visual
      // travel while state is still 'dropped'.
      const dirX = p.guardReturnFromX - player.x;
      const dirY = p.guardReturnFromY - player.y;
      const len  = Math.hypot(dirX, dirY) || 1;
      const edgeX = player.x + (dirX / len) * PLAYER_RADIUS;
      const edgeY = player.y + (dirY / len) * PLAYER_RADIUS;
      p.worldX = p.guardReturnFromX + (edgeX - p.guardReturnFromX) * Math.min(1, ease);
      p.worldY = p.guardReturnFromY + (edgeY - p.guardReturnFromY) * Math.min(1, ease);
      if (t >= 1) {
        p.state      = 'active';
        p.guardState = null;
      }
    }
  }


  // pre_drop → ready → (drop + immediately start cooldown)
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isHoneycomb || p.state !== 'active') continue;

    if (p.honeycombState === 'pre_drop') {
      p.honeycombTimer -= dt;
      if (p.honeycombTimer > 0) continue;
      p.honeycombState = 'ready';
    }

    if (p.honeycombState === 'ready') {
      // Drop when player attacks (expand) — petal immediately goes on cooldown
      if (inputState.expand) {
        spawnHoneycombEntity(p.worldX, p.worldY, pt.honeycombHp, pt.attractRange, pt.tier ?? 0);
        p.honeycombState    = null;
        p.honeycombEntityId = null;
        p.state             = 'reloading';
        p.hp                = 0;
        p.reloadTimer       = pt.reloadTime;
      }
    }
  }

  // ── Honeycomb entity: attract mobs + absorb ramming damage ─────────────────
  for (const hc of honeycombEntities) {
    if (hc.dead) continue;
    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      // Only attract mobs up to one tier above the honeycomb
      if ((mob.tier ?? 0) > hc.tier + 1) continue;
      const dx   = hc.x - mob.x;
      const dy   = hc.y - mob.y;
      const dist = Math.hypot(dx, dy);
      if (dist < hc.attractRange) {
        mob.honeycombTargetId = hc.id;
      }
      // Mob contact: mob rams honeycomb — pushes it (massless), mob unaffected
      if (dist < hc.radius + mob.radius + 2 && dist > 0.001) {
        // Resolve overlap: push honeycomb away from mob (mob is unaffected)
        const overlap = (hc.radius + mob.radius) - dist;
        const nx = dx / dist, ny = dy / dist;
        hc.x += nx * overlap;
        hc.y += ny * overlap;
        // Give honeycomb an impulse in the push direction
        const impulse = 2.5 + mob.speed * 0.3;
        hc.vx += nx * impulse;
        hc.vy += ny * impulse;
        // Deal damage to honeycomb
        const dmg = mob.contactDps * (dt / 1000);
        hc.hp -= dmg; triggerHurtFlash(hc);        if (hc.hp <= 0) { hc.dead = true; break; }
      }
    }
  }

  // Clear honeycombTargetId from mobs whose target entity is gone
  for (const mob of mobs) {
    if (mob.honeycombTargetId == null) continue;
    const hc = honeycombEntities.find(e => e.id === mob.honeycombTargetId);
    if (!hc || hc.dead) mob.honeycombTargetId = null;
  }

  // ── Boss Sandstorm pull — drags the player and every friendly pet toward it
  // for a few seconds, unlimited range. Other (non-pet) mobs are unaffected.
  // Continuous velocity add each tick, same convention as knockback elsewhere,
  // so the player can still fight the pull with normal movement input.
  for (const boss of mobs) {
    if (boss.dead || !boss.isBoss || boss.typeId !== 'sandstorm' || !boss.isPulling) continue;

    const PULL_STRENGTH = 3.2; // per-tick velocity add toward the boss

    // Pull the player
    {
      const dx = boss.x - player.x, dy = boss.y - player.y, dist = Math.hypot(dx, dy);
      if (dist > 1) {
        player.vx += (dx / dist) * PULL_STRENGTH;
        player.vy += (dy / dist) * PULL_STRENGTH;
      }
    }

    // Pull every friendly pet (not other mobs)
    for (const pet of mobs) {
      if (pet.dead || !pet.isFriendlyPet || pet.id === boss.id) continue;
      const dx = boss.x - pet.x, dy = boss.y - pet.y, dist = Math.hypot(dx, dy);
      if (dist <= 1) continue;
      const nx = dx / dist, ny = dy / dist;
      const newX = pet.x + nx * PULL_STRENGTH;
      const newY = pet.y + ny * PULL_STRENGTH;
      if (canMoveTo(newX, newY, pet.radius)) { pet.x = newX; pet.y = newY; }
    }
  }

  // ── Missile petal firing ──────────────────────────────────────────────────
  // After the 0.5s pre_fire wait, fire when player is attacking (expand).
  const PLAYER_MISSILE_SPEED = 18; // px per frame (~1080 px/s at 60fps)
  for (const p of petalInstances) {
    const pt = PETAL_TYPES[p.typeId];
    if (!pt?.isMissilePetal || p.state !== 'active') continue;
    if (p.missileState !== 'pre_fire' || p.missileTimer > 0) continue;
    if (!inputState.expand) continue; // only fire when attacking

    // Aim at the nearest hostile mob WITHIN visual range; fall back to player's movement direction
    let fireAngle = player.moveAngle ?? 0;
    let nearestDist = Infinity;
    const visualRange = 600 / Math.max(0.1, zoomState.v); // world-units visible to player
    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      const d = Math.hypot(mob.x - player.x, mob.y - player.y);
      if (d < nearestDist && d <= visualRange) {
        nearestDist = d;
        fireAngle = Math.atan2(mob.y - player.y, mob.x - player.x);
      }
    }

    // Spawn an independent missile entity — petal immediately goes on cooldown
    spawnMissileEntity(
      p.worldX, p.worldY,
      Math.cos(fireAngle) * PLAYER_MISSILE_SPEED,
      Math.sin(fireAngle) * PLAYER_MISSILE_SPEED,
      fireAngle, p.damage, p.radius, p.color, p.border, p.typeId
    );
    p.missileState = null;
    p.state        = 'reloading';
    p.hp           = 0;
    p.reloadTimer  = pt.reloadTime;
  }

  // ── Peas petal firing ─────────────────────────────────────────────────────
  // When attacking, pea pieces fire in two opposite directions.
  // The cluster's orbital angle (player→cluster-center) defines the axis;
  // pieces 0 & 1 go outward along that axis, pieces 2 & 3 go the opposite way.
  const PEAS_SPEED = 13; // px per frame
  if (inputState.expand) {
    // Group active pea pieces by slot so each cluster fires as a unit.
    const peaSlots = new Map(); // slotIdx → [piece, ...]
    for (const p of petalInstances) {
      const pt = PETAL_TYPES[p.typeId];
      if (!p.isPiece || pt?.pieceShape !== 'peas' || p.state !== 'active') continue;
      if (!peaSlots.has(p.slotIdx)) peaSlots.set(p.slotIdx, []);
      peaSlots.get(p.slotIdx).push(p);
    }
    for (const pieces of peaSlots.values()) {
      // Cluster center = average world position of all pieces in this slot.
      const cx = pieces.reduce((s, p) => s + p.worldX, 0) / pieces.length;
      const cy = pieces.reduce((s, p) => s + p.worldY, 0) / pieces.length;
      const clusterAngle = Math.atan2(cy - player.y, cx - player.x);
      pieces.forEach((p, i) => {
        // First half fire outward (cluster angle), second half fire inward (opposite).
        const angle = i < 2 ? clusterAngle : clusterAngle + Math.PI;
        p.state       = 'flying';
        p.flyLifetime = 2500;
        p.vx          = Math.cos(angle) * PEAS_SPEED;
        p.vy          = Math.sin(angle) * PEAS_SPEED;
        p.flyAngle    = angle;
        p.hitMobIds   = new Set();
      });
    }
  }

  // ── Flying petal → mob hits (phases through each mob once) ───────────────
  for (const p of petalInstances) {
    if (p.state !== 'flying' || !p.hitMobIds) continue;
    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      if (p.hitMobIds.has(mob.id)) continue; // already struck this mob
      const dx   = mob.x - p.worldX;
      const dy   = mob.y - p.worldY;
      const dist = Math.hypot(dx, dy);
      if (dist < p.radius + mob.radius) {
        p.hitMobIds.add(mob.id);
        const dmg = p.damage;
        mob.hp -= dmg; mob.alerted = true;
        spawnDamage(mob.x, mob.y, dmg, '#ff8800', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
    }
  }

  // ── Missile entity → mob hits (phases through each mob once) ────────────
  for (const me of missileEntities) {
    if (me.dead) continue;
    for (const mob of mobs) {
      if (mob.dead || mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
      if (me.hitMobIds.has(mob.id)) continue;
      const dx   = mob.x - me.x;
      const dy   = mob.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist < me.radius + mob.radius) {
        me.hitMobIds.add(mob.id);
        const dmg = me.damage;
        mob.hp -= dmg; mob.alerted = true;
        spawnDamage(mob.x, mob.y, dmg, '#ff8800', mob.radius, mob);
        if (mob.hp <= 0) { mob.dead = true; spawnMobDrops(mob, mob.isBoss); addXp(mobXpValue(rarityTier(mob.rarity), mob.isBoss ?? false)); }
      }
    }
  }

}