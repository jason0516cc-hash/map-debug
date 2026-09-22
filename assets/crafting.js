/**
 * crafting.js — Client-side crafting system.
 *
 * Batch crafting: every 5 petals = 1 independent attempt to upgrade to the
 * next rarity. Multiple batches resolve independently; each batch can succeed
 * or fail on its own. Success produces 1 higher-rarity petal and resets the
 * pity counter. Failure returns 1-4 petals and increments the pity counter.
 *
 * Pity system: each failed attempt makes the next attempt more likely via
 * calculateChance(attempt, tier). The counter is stored per typeId and
 * persists until a successful craft resets it to 0.
 */

import { inventoryItems, addToInventory, removeFromInventory } from './inventory.js';
import { PETAL_TYPES }                                          from './petalTypes.js';
import { RARITIES }                                             from './constants.js';

// ── Pity counters: { typeId → failedAttemptCount } ──────────────────────────
export const craftAttempts = {};

// ── Chance curve (ported from craftingMenu.js, adapted for 14 tiers) ────────
//   attempt   = total failed crafts so far for this typeId (0 = fresh)
//   rarityTier = source tier index (0 = Common → Unusual, 12 = Umbral → Impracticality)
export function calculateChance(attempt, rarityTier) {
  switch (rarityTier) {
    case 0: {
      // Common → Unusual  —  30% base, fast linear, quadratic boost at attempt 6
      let c = 30 + attempt * 9;
      if (attempt > 6) c += (attempt - 6) ** 2 / 2;
      return Math.min(100, c);
    }
    case 1: {
      // Unusual → Rare
      let c = 15 + attempt * 1.5;
      if (attempt > 12) c += (attempt - 12) ** 2 / 2;
      return Math.min(100, c);
    }
    case 2: {
      // Rare → Epic
      let c = 8 + attempt / 1.4;
      if (attempt > 18) c += (attempt - 18) ** 2 / 5;
      return Math.min(100, c);
    }
    case 3: {
      // Epic → Legendary
      let c = 5 + attempt / 5.6;
      if (attempt > 35) c += (attempt - 35) ** 2 / 5;
      return Math.min(100, c);
    }
    case 4: {
      // Legendary → Mythical
      let c = 3 + attempt / 22.5;
      if (attempt > 60) c += (attempt - 60) ** 2 / 5;
      return Math.min(100, c);
    }
    case 5: {
      // Mythical → Ultra
      let c = 2 + attempt / 33;
      if (attempt > 70) c += (attempt - 70) ** 2 / 5;
      return Math.min(100, c);
    }
    case 6: {
      // Ultra → Super
      let c = 1 + attempt / 43;
      if (attempt > 95) c += (attempt - 95) ** 2 / 5;
      return Math.min(100, c);
    }
    case 7: {
      // Super → Radiant
      let c = 0.9 + attempt / 45;
      if (attempt > 95) c += (attempt - 95) ** 2 / 5;
      return Math.min(100, c);
    }
    case 8: {
      // Radiant → Mystitic
      let c = 0.8 + attempt / 48;
      if (attempt > 95) c += (attempt - 95) ** 2 / 5;
      return Math.min(100, c);
    }
    case 9: {
      // Mystitic → Runic
      let c = 0.7 + attempt / 51;
      if (attempt > 100) c += (attempt - 100) ** 2 / 5;
      return Math.min(100, c);
    }
    case 10: {
      // Runic → Seraphic
      let c = 0.6 + attempt / 53;
      if (attempt > 105) c += (attempt - 105) ** 2 / 5;
      return Math.min(100, c);
    }
    case 11: {
      // Seraphic → Umbral
      let c = 0.5 + attempt / 55;
      if (attempt > 110) c += (attempt - 110) ** 2 / 5;
      return Math.min(100, c);
    }
    case 12: {
      // Umbral → Impracticality  —  starts near 0%, slow growth, quadratic after 200 fails
      let c;
      if (attempt <= 9) {
        c = 0.1 + (attempt / 9) * 0.4;
      } else if (attempt <= 200) {
        c = 0.5 + ((attempt - 10) / 190) * 1.0;
      } else {
        c = 1.5 + ((attempt - 200) ** 2) / 10;
      }
      return Math.min(100, c);
    }
    default:
      return 0;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the base typeId for any scalable petal.
 * e.g. 'basic_unusual' → 'basic',  'basic' → 'basic'
 */
function getBaseId(typeId) {
  const pt = PETAL_TYPES[typeId];
  if (!pt || pt.tier === undefined) return null;
  if (pt.tier === 0) return typeId;
  // Strip the current rarity suffix
  const suffix = '_' + RARITIES[pt.tier].toLowerCase().replace(/[^a-z0-9]/g, '_');
  return typeId.endsWith(suffix) ? typeId.slice(0, -suffix.length) : null;
}

/**
 * Returns the typeId one rarity tier higher, or null if already max.
 * e.g. 'basic' → 'basic_unusual',  'basic_unusual' → 'basic_rare'
 */
export function getNextTypeId(typeId) {
  const pt = PETAL_TYPES[typeId];
  if (!pt || pt.tier === undefined) return null;
  const nextTier = pt.tier + 1;
  if (nextTier >= RARITIES.length) return null;
  const baseId = getBaseId(typeId);
  if (!baseId) return null;
  const nextSuffix = '_' + RARITIES[nextTier].toLowerCase().replace(/[^a-z0-9]/g, '_');
  const nextId = baseId + nextSuffix;
  return PETAL_TYPES[nextId] ? nextId : null;
}

/**
 * Returns true if this typeId can be upgraded (has a next tier defined).
 */
export function canCraft(typeId) {
  return !!getNextTypeId(typeId);
}

/**
 * Returns how many failed crafts have been recorded for this typeId.
 */
export function getAttempt(typeId) {
  return craftAttempts[typeId] ?? 0;
}

/**
 * Returns the current success % for display (formatted string).
 */
export function getChanceLabel(typeId) {
  const pt = PETAL_TYPES[typeId];
  if (!pt || pt.tier === undefined) return '—';
  const attempt = getAttempt(typeId);
  const chance  = calculateChance(attempt, pt.tier);
  // Show more decimals for very small values
  if (pt.tier >= 10) return chance.toFixed(4) + '%';
  if (pt.tier >= 5)  return chance.toFixed(2) + '%';
  return chance.toFixed(1) + '%';
}

// ── Core craft logic ─────────────────────────────────────────────────────────

/**
 * Determines the outcome of ONE batch (5 petals) without touching inventory.
 * The caller must have already deducted 5 petals from inventory before calling.
 * Updates the pity counter (craftAttempts) based on outcome.
 *
 * @param {string} typeId
 * @returns {{ success: boolean, nextTypeId: string, returned: number } | null}
 *   returned = petals to give back (0 on success, 1-4 on failure)
 */
export function performCraftSingle(typeId) {
  if (!canCraft(typeId)) return null;
  const nextTypeId = getNextTypeId(typeId);
  const tier       = PETAL_TYPES[typeId].tier;
  if (craftAttempts[typeId] === undefined) craftAttempts[typeId] = 0;
  const chance  = calculateChance(craftAttempts[typeId], tier);
  const success = Math.random() * 100 < chance;
  if (success) {
    craftAttempts[typeId] = 0;
    return { success: true, nextTypeId, returned: 0 };
  } else {
    craftAttempts[typeId]++;
    const returned = Math.floor(Math.random() * 4) + 1; // [1, 4]
    return { success: false, nextTypeId, returned };
  }
}

/**
 * Executes a craft for the given typeId using ALL available complete batches.
 *
 * @param {string} typeId - The source petal typeId.
 * @returns {{ successCount, returnedCount, nextTypeId, newAttempt } | null}
 */
export function performCraft(typeId) {
  if (!canCraft(typeId)) return null;

  const count   = inventoryItems[typeId] ?? 0;
  const batches = Math.floor(count / 5);
  if (batches === 0) return null;

  const nextTypeId = getNextTypeId(typeId);
  const tier       = PETAL_TYPES[typeId].tier;

  // Remove all petals used for this craft upfront (remainder stays)
  for (let i = 0; i < batches * 5; i++) removeFromInventory(typeId);

  if (craftAttempts[typeId] === undefined) craftAttempts[typeId] = 0;

  let successCount  = 0;
  let returnedCount = 0;

  for (let b = 0; b < batches; b++) {
    const chance = calculateChance(craftAttempts[typeId], tier);
    if (Math.random() * 100 < chance) {
      // ── Success ──────────────────────────────────────────────────────────
      successCount++;
      craftAttempts[typeId] = 0; // pity resets on success
      addToInventory(nextTypeId);
    } else {
      // ── Failure: return 1-4 petals ────────────────────────────────────────
      craftAttempts[typeId]++;
      const returned = Math.floor(Math.random() * 4) + 1; // [1,4]
      returnedCount += returned;
      for (let i = 0; i < returned; i++) addToInventory(typeId);
    }
  }

  return { successCount, returnedCount, nextTypeId, newAttempt: craftAttempts[typeId] };
}
