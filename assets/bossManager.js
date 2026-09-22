/**
 * bossManager.js — Boss spawn system.
 *
 * Flow:
 *   night→day : addNightLuck(hotbar)  — clover petals contribute luck
 *   day→night : rollBossSpawn(wave)   — test accumulator, maybe queue a boss
 *   on spawn  : spawnBoss(...)        — 3s delay, announcement, then spawn + stat patch
 *
 * Boss stats vs normal mob at same tier:
 *   HP  ×10  |  DMG ×2  |  radius ×3  |  mass ×3  |  speed ×0.9
 */

import { RARITIES }               from './constants.js';
import { showBossAnnouncement }    from './renderer.js';

// ── Dormant — waves mode removed ──────────────────────────────────────────────
// This whole module is disconnected from active gameplay (nothing currently
// calls rollBossSpawn/spawnBoss) but is kept intact for reuse once a new
// boss-spawning trigger replaces the old wave system. getDominantRarityIndex
// was wave-number-dependent (RARITY_WAVE_CONFIG, deleted with waveManager.js);
// this shim just keeps the module loadable — rollBossSpawn's wave-gated path
// below is unreachable anyway since nothing calls it anymore.
function getDominantRarityIndex(/* wave */) { return 0; }
import { mobs, MOB_DEFS, RADIUS_SCALE, applyBossStatsToCentipedeChain, applyBossStatsToDesertCentipedeChain } from './mobs.js';
import { RARITY_TEXT }             from './constants.js';

// ── Accumulator ───────────────────────────────────────────────────────────────
const BASE_LUCK      = 0.005;   // 0.5 % starting chance
const PER_WAVE_LUCK  = 0.002;   // +0.2 % per wave number added at roll time

let bossLuckAccumulator = BASE_LUCK;
let _hotbarRef          = null;
let activeBoss          = null;   // mob id of living boss, or null
let lastBossTypeId      = null;   // prevents same boss spawning back-to-back

// ── Boss pool — built dynamically from all registered mob types ───────────────
// Any mob type in MOB_DEFS can appear as a boss.  Add per-type weight overrides
// here; anything not listed gets the DEFAULT_WEIGHT.  Types in BOSS_EXCLUDE are
// skipped (sub-units that don't make sense as standalone bosses).
const DEFAULT_BOSS_WEIGHT = 10;
const BOSS_WEIGHT_OVERRIDES = {
  soldier_ant:    25,
  bee:            20,
  spider:         20,
  hornet:         15,
  ladybug:        10,
  centipede_head:  8,
  ant_hole:        2,
  beehive:         2,
  queen_bee:       1,
  queen_ant:       2,
  worker_ant:      5,
  baby_ant:        4,
};
// These sub-unit / trivial types are never chosen as a boss
const BOSS_EXCLUDE = new Set(['centipede_body', 'ant_egg', 'beekeeper', 'digger']);

function _buildBossPool() {
  return Object.keys(MOB_DEFS)
    .filter(id => !BOSS_EXCLUDE.has(id))
    .map(id => ({ typeId: id, weight: BOSS_WEIGHT_OVERRIDES[id] ?? DEFAULT_BOSS_WEIGHT }));
}

let BOSS_POOL = null;   // built lazily on first rollBossSpawn call

function _getOrBuildPool() {
  if (!BOSS_POOL) BOSS_POOL = _buildBossPool();
  return BOSS_POOL;
}

// ── Public init ───────────────────────────────────────────────────────────────
export function initBossManager(hotbarRef) {
  _hotbarRef             = hotbarRef;
  bossLuckAccumulator    = BASE_LUCK;
  activeBoss             = null;
  lastBossTypeId         = null;
}

// ── Clover luck — called at night→day transition ──────────────────────────────
export function addNightLuck(hotbar) {
  const bar = hotbar ?? _hotbarRef;
  if (!bar) return;
  for (const typeId of bar) {
    if (!typeId) continue;
    // Import lazily to avoid circular — read from window cache set by petalTypes
    const pt = window.__PETAL_TYPES?.[typeId];
    if (pt?.luckBonus) bossLuckAccumulator += pt.luckBonus;
  }
}

// ── Boss roll — called at day→night transition ────────────────────────────────
/**
 * Returns { typeId, tier } if a boss should spawn this wave, else null.
 * Resets accumulator on a hit.
 */
export function rollBossSpawn(wave) {
  if (activeBoss !== null) return null;   // boss already alive
  if (wave < 28) return null;            // no bosses until Ultras start spawning

  const chance = bossLuckAccumulator + wave * PER_WAVE_LUCK;
  if (Math.random() >= chance) return null;

  // Determine tier from dominant rarity this wave
  const tier = getDominantRarityIndex(wave);

  // Build/rebuild pool (picks up any runtime additions to MOB_DEFS)
  BOSS_POOL = _buildBossPool();

  // Pick boss type from weighted pool
  const total = BOSS_POOL.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  let typeId = BOSS_POOL[0].typeId;
  for (const entry of BOSS_POOL) {
    r -= entry.weight;
    if (r <= 0) { typeId = entry.typeId; break; }
  }

  // Prevent same boss twice in a row — reroll once using the remaining pool
  if (typeId === lastBossTypeId && BOSS_POOL.length > 1) {
    const filtered = BOSS_POOL.filter(e => e.typeId !== lastBossTypeId);
    const tot2 = filtered.reduce((s, e) => s + e.weight, 0);
    let r2 = Math.random() * tot2;
    typeId = filtered[0].typeId;
    for (const entry of filtered) {
      r2 -= entry.weight;
      if (r2 <= 0) { typeId = entry.typeId; break; }
    }
  }

  // Reset accumulator and record last chosen type
  bossLuckAccumulator = BASE_LUCK;
  lastBossTypeId      = typeId;

  return { typeId, tier };
}

// ── Spawn boss — 3s delay, announcement, stat patch ──────────────────────────
/**
 * @param {string}   typeId
 * @param {number}   tier
 * @param {Function} spawnCb   (typeId, tier, isStructure) => mobId | null  (same sig as wave spawnCb)
 * @param {Function} trackCb   (mobId) => void  — adds id to trackedMobIds
 */
export function spawnBoss(typeId, tier, spawnCb, trackCb) {
  const rarityName  = RARITIES[tier] ?? 'Common';
  const rarityColor = RARITY_TEXT[rarityName] ?? '#ffffff';
  const isStructure = (typeId === 'ant_hole' || typeId === 'beehive');

  // Show "INCOMING" banner immediately — format: "{Rarity} Boss {Mob Name}"
  showBossAnnouncement(`${rarityName} Boss ${_bossDisplayName(typeId)}`, rarityColor, false);

  setTimeout(() => {
    const mobId = spawnCb(typeId, tier, isStructure, true); // true = spawn at center
    if (mobId == null) return;

    // Patch stats on the spawned mob object
    const mob = mobs.find(m => m.id === mobId);
    if (mob) {
      _applyBossStats(mob);
      // For centipedes: also scale every body segment so the whole chain is boss-sized
      if (mob.typeId === 'centipede_head') applyBossStatsToCentipedeChain(mob.id);
      if (mob.typeId === 'desert_centipede_head') applyBossStatsToDesertCentipedeChain(mob.id);
    }

    activeBoss = mobId;
    if (trackCb) trackCb(mobId);

    // Show "SPAWNED" banner after spawn — same format
    showBossAnnouncement(`${rarityName} Boss ${_bossDisplayName(typeId)}`, rarityColor, true);
  }, 3000);
}

// ── State helpers ─────────────────────────────────────────────────────────────
export function isBossActive()  { return activeBoss !== null; }

/** Pick a random boss-eligible typeId using the same pool/weights as the normal
 *  roll, without touching the luck accumulator or last-boss-type tracking.
 *  Used by /bosswave for a fully random forced boss. */
export function pickRandomBossType() {
  const pool = _buildBossPool();
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  let typeId = pool[0].typeId;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) { typeId = entry.typeId; break; }
  }
  return typeId;
}

export function onBossDied() {
  activeBoss = null;
}

// ── Drop multipliers (read by combat.js) ──────────────────────────────────────
export function getBossDropMultiplier() {
  return { countMult: 3, weightBoost: 5 };
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function _applyBossStats(mob) {
  mob.isBoss     = true;
  mob.maxHp     *= 10;
  mob.hp         = mob.maxHp;
  mob.damage    *= 2;
  mob.contactDps *= 2;
  // Fix structure milestone HP — was computed from pre-boss maxHp, now re-anchor to boss maxHp
  if (mob.isAntHole) mob.nextMilestoneHp = Math.round(mob.maxHp * 0.75); // first boss milestone at 75%
  if (mob.isFireAntHole) mob.nextMilestoneHp = Math.round(mob.maxHp * 0.75); // same re-anchor for boss fire ant hole

  // Scale drawRadius (visual) and radius (hitbox) independently so that
  // mobs whose hitbox ≠ drawRadius (bee, hornet) keep the correct hitRadiusFactor.
  // Boss is always exactly 1.5x the size of the regular mob at that tier.
  const preDraw    = mob.drawRadius;
  const hitFactor  = mob.radius / mob.drawRadius;
  mob.drawRadius   = Math.round(preDraw * 1.5);
  mob.radius       = Math.round(mob.drawRadius * hitFactor);
  const actualScale = 1.5;

  mob.mass        = Math.round(mob.mass * 3);   // mass grows freely beyond the visual cap
  mob.baseSpeed  *= 0.9;
  mob.speed      *= 0.9;
  mob.alertSpeed *= 0.9;

  // Scale hit offsets by the actual visual scale (not always 3) so the hitbox stays aligned
  mob.hitOffsetX  = (mob.hitOffsetX || 0) * actualScale;
  mob.hitOffsetY  = (mob.hitOffsetY || 0) * actualScale;

  if (mob.aggroRange > 0) mob.aggroRange = Math.round(mob.aggroRange * 1.5);
}

// Explicit overrides for names that shouldn't just be title-cased from the typeId
const _BOSS_NAME_OVERRIDES = {
  centipede_head: 'Centipede',
  ant_hole:       'Ant Hole',
  queen_bee:      'Queen Bee',
  queen_ant:      'Queen Ant',
};

/** Convert a typeId like "worker_ant" → "Worker Ant", with override support. */
function _bossDisplayName(typeId) {
  if (_BOSS_NAME_OVERRIDES[typeId]) return _BOSS_NAME_OVERRIDES[typeId];
  return typeId
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
