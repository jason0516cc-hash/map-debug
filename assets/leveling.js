/**
 * leveling.js
 *
 * All level / XP / stat math lives here.  Nothing in this file touches the DOM
 * or canvas — it is pure logic that both the HUD and the player state can import.
 *
 * ── XP curve ─────────────────────────────────────────────────────────────────
 * xpForLevel(n)  → XP required to advance FROM level (n-1) TO level n
 * Formula: Math.round(80 * n^1.65)
 *
 * Milestones (approx):
 *   Level  1  →   80 XP total
 *   Level  5  →  800 XP total
 *   Level 10  →  3 900 XP total
 *   Level 20  → 17 000 XP total
 *   Level 50  → 126 000 XP total
 *   Level 100 → 460 000 XP total
 *
 * Mob XP reference (tier = rarity index):
 *   Common(0): 1 xp   Unusual(1): 3    Rare(2): 9    Epic(3): 27
 *   Legendary(4): 81  Mythical(5): 243  Ultra(6): 729  Super(7): 2 187
 *   Bosses: × 10 on top of the above.
 *
 * ── Petal slots ───────────────────────────────────────────────────────────────
 *   Phase 1 — +1 slot every 15 levels, until 10 slots total
 *             (levels 15, 30, 45, 60, 75)
 *   Phase 2 — +1 slot every 50 levels, until 15 slots max
 *             (levels 125, 175, 225, 275, 325)
 *
 * ── HP / Damage ───────────────────────────────────────────────────────────────
 *   HP(lvl)         = 100 + 25  × lvl^1.15
 *   bodyDamage(lvl) =  25 +  8  × lvl^1.10
 */

// ─────────────────────────────────────────────────────────────────────────────
// XP curve
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LEVEL = 500;

/** XP needed to advance from level (n-1) → level n. */
export function xpForLevel(n) {
  if (n <= 0) return 0;
  return Math.round(80 * Math.pow(n, 1.65));
}

// Precompute cumulative XP thresholds once at load time.
// cumulativeXp[n] = total XP needed to *reach* level n from 0.
const _cum = new Array(MAX_LEVEL + 1).fill(0);
for (let i = 1; i <= MAX_LEVEL; i++) {
  _cum[i] = _cum[i - 1] + xpForLevel(i);
}

/** Total XP required to reach integer level n from zero. */
export function totalXpForLevel(n) {
  return _cum[Math.min(n, MAX_LEVEL)];
}

/**
 * Continuous (decimal) level from a raw XP total.
 * The integer part is the current level; the fractional part is progress
 * toward the next level — handy for smooth bar animation.
 */
export function levelFromXp(xp) {
  if (xp <= 0) return 0;

  // Binary search for the integer level
  let lo = 0, hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (_cum[mid] <= xp) lo = mid;
    else hi = mid - 1;
  }
  const level = lo;
  if (level >= MAX_LEVEL) return MAX_LEVEL;

  // Fractional progress toward the next level
  const xpIntoLevel = xp - _cum[level];
  const xpNeeded    = xpForLevel(level + 1);
  return level + xpIntoLevel / xpNeeded;
}

// ─────────────────────────────────────────────────────────────────────────────
// Petal slots
// ─────────────────────────────────────────────────────────────────────────────

export const BASE_PETAL_SLOTS = 5;

/**
 * Returns the total number of petal slots unlocked at the given integer level.
 *
 * Phase 1 (levels 15–75, every 15): caps at 10 slots
 * Phase 2 (levels 125–325, every 50): caps at 15 slots
 */
export function petalSlotsForLevel(level) {
  // level is 0-based internally; display level = level + 1.
  // Slots unlock at display levels 15, 30, 45, 60, 75 (phase 1)
  // and 100, 125, ... every 50 thereafter (phase 2).
  // Translate to 1-based for threshold math:
  const displayLevel = level + 1;

  // Phase 1 — unlock at display 15, 30, 45, 60, 75 → floor(displayLevel / 15), cap 5
  const phase1 = Math.min(5, Math.floor(displayLevel / 15));
  let slots = BASE_PETAL_SLOTS + phase1;

  // Phase 2 — unlock at display 100, 125, 175, 225, 275, 325 → every 50 after 75
  if (slots >= 10) {
    const phase2 = Math.min(5, Math.max(0, Math.floor((displayLevel - 50) / 50)));
    slots += phase2;
  }

  return Math.min(slots, 15);
}

// ─────────────────────────────────────────────────────────────────────────────
// HP & body damage
// ─────────────────────────────────────────────────────────────────────────────

/** Max HP at a given level (may be overridden by petal bonuses). */
export function hpAtLevel(level) {
  if (level === 0) return 100;
  return Math.round(100 + 25 * Math.pow(Math.max(0, level), 1.15));
}

/** Body-contact DPS at a given level. */
export function bodyDamageAtLevel(level) {
  return Math.round(25 + 8 * Math.pow(Math.max(0, level), 1.10));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mob XP values
// ─────────────────────────────────────────────────────────────────────────────

export const BASE_MOB_XP   = 1;   // common mob
export const XP_TIER_MULT  = 3;   // ×3 per rarity tier
export const BOSS_XP_MULT  = 10;  // bosses get ×10

/**
 * XP rewarded for killing a mob.
 * @param {number}  rarityIndex  0 = Common, 1 = Unusual, 2 = Rare …
 * @param {boolean} isBoss
 */
export function mobXpValue(rarityIndex, isBoss = false) {
  let xp = BASE_MOB_XP * Math.pow(XP_TIER_MULT, rarityIndex);
  if (isBoss) xp *= BOSS_XP_MULT;
  return Math.round(xp);
}