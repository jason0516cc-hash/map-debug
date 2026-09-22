/**
 * petalTypes.js — Defines every petal type, including rarity-scaled variants.
 *
 * Scalable petals (basic, faster, light, pollen, rose, stinger, poison, leaf,
 * peas, wing, rice, orange) auto-generate 14 rarity tiers.
 *
 * Scaling rules:
 *   HP  : x3.75 per tier
 *   DMG : x3    per tier
 *   Amor: x3    per tier
 *   Special scales (x3/tier): rose healAmount, poison poisonDps, leaf passiveHeal
 *   Faster spinBonus: +0.4 rad/s per tier (base 0.2 rad/s at Common)
 *   Reload: does NOT scale per tier
 */

import { RARITIES } from './constants.js';

function rarSuffix(rarity) {
  return rarity.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function scaledId(baseId, tier) {
  return tier === 0 ? baseId : `${baseId}_${rarSuffix(RARITIES[tier])}`;
}

const SCALABLE_BASES = {
  web: {
    name: 'Web', color: '#aacfe0', border: '#6b9ca8', spriteIndex: 6,
    radius: 8, hitboxX: 0, hitboxY: 0,
    baseHp: 1, baseDmg: 9, reloadTime: 1800,
    baseSlowFactor: 0.4,
    noScaleHp: true,
    description: 'Spawns a slowing web on the ground when it hits. Slows mobs by 40%.',
  },
  basic: {
    name: 'Basic', color: '#ffffff', border: '#90ee90', spriteIndex: 0,
    radius: 9.5, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2500,
    description: 'A simple white petal.',
  },
  faster: {
    name: 'Faster', color: '#7fffd4', border: '#ff69b4', spriteIndex: 1,
    radius: 9.5, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 20, reloadTime: 700,
    spinBonusPerSec: 0.2,
    description: 'Slightly higher damage and makes petals rotate faster.',
  },
  light: {
    name: 'Light', color: '#fcf7b2', border: '#f7f7a0', spriteIndex: 2,
    radius: 9.5, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 20, baseArmor: 3, reloadTime: 500,
    isLight: true,
    description: 'Faster reload and slightly smaller than basic.',
  },
  pollen: {
    name: 'Pollen', color: '#d8e786', border: '#9aa83d', spriteIndex: 3,
    radius: 9.5, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 25, baseArmor: 15, reloadTime: 1000,
    dropsPollen: true,
    description: 'Drops pollen on contact while attacking or defending.',
  },
  rose: {
    name: 'Rose', color: '#e87ba3', border: '#8b2a50', spriteIndex: 4,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 5, reloadTime: 2500,
    baseHeal: 10,
    noExpand: true, canCollect: false,
    description: 'Moves to the player when they take damage, heals them, then reloads.',
  },
  stinger: {
    name: 'Stinger', color: '#f5a844', border: '#c26a28', spriteIndex: 5,
    radius: 8, hitboxX: 0, hitboxY: 0,
    baseHp: 1, baseDmg: 150, reloadTime: 5000,
    oneShot: true,
    pieceShape: 'stinger',
    description: 'Extreme damage. Breaks after one hit.',
  },
  poison: {
    name: 'Poison', color: '#55cc44', border: '#2a6618', spriteIndex: 7,
    radius: 8, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 5, reloadTime: 2000,
    basePoisonDps: 35,
    description: 'Poisons enemies on contact, dealing damage over time.',
  },
  leaf: {
    name: 'Leaf', color: '#3db830', border: '#1e6612', spriteIndex: 8,
    radius: 15, hitboxX: 0, hitboxY: -2,
    baseHp: 12, baseDmg: 15, reloadTime: 2000,
    basePassiveHeal: 2,
    description: 'A sturdy leaf. Passively heals the player while active.',
  },
  peas: {
    name: 'Peas', color: '#66bb6a', border: '#2e7d32', spriteIndex: 10,
    radius: 8,
    baseHp: 5, baseDmg: 100, baseArmor: 3, reloadTime: 3000,
    pieceShape: 'peas',
    pieces: [
      { dx: -0.6, dy: -0.6, pr: 0.43 },
      { dx:  0.6, dy: -0.6, pr: 0.43 },
      { dx: -0.6, dy:  0.6, pr: 0.43 },
      { dx:  0.6, dy:  0.6, pr: 0.43 },
    ],
    description: 'Four little peas. Each pellet hits independently.',
  },
  wing: {
    name: 'Wing', color: '#ffffff', border: '#aaaaaa', spriteIndex: 13,
    radius: 11, hitboxX: 0, hitboxY: 0, // matches Blood Wing's final size, per instruction
    baseHp: 10, baseDmg: 30, baseArmor: 3, reloadTime: 1200,
    isWing: true,
    description: 'A wing. Deals high damage and has good durability.',
  },
  rice: {
    name: 'Rice', color: '#ffffff', border: '#c0c0c0', spriteIndex: 14,
    radius: 6.5, hitboxX: 0, hitboxY: 0,
    baseHp: 1, baseDmg: 20, reloadTime: 50,
    description: 'A grain of rice. Fires extremely rapidly.',
  },
  orange: {
    name: 'Orange', color: '#e8a030', border: '#a06820', spriteIndex: 25,
    radius: 10,
    baseHp: 10, baseDmg: 30, baseArmor: 6, reloadTime: 2000,
    pieceShape: 'orange',
    pieces: [
      { dx:  0.80, dy: -0.75, pr: 0.52 },
      { dx: -0.55, dy:  0.25, pr: 0.52 },
      { dx:  0.85, dy:  1.05, pr: 0.52 },
    ],
    description: 'A cluster of oranges. Each piece hits independently.',
  },
  disc: {
    name: 'Disc', color: '#111111', border: '#000000', spriteIndex: 16,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 12, reloadTime: 2200,
    isAccessory: true,
    baseDamageBlock: 0.05,        // 5% at Common; reaches 75% at Super (tier 7)
    damageBlockPerTier: 0.10,     // +10%/tier → Super = 0.05 + 0.70 = 0.75
    discBaseArmor: 30000,         // armor granted starting at Radiant (tier 8)
    discArmorMultiplier: 2.5,     // ×2.5 per tier above Radiant
    description: 'placeholder', // overridden per-tier below
  },
  cutter: {
    name: 'Cutter', color: '#111111', border: '#000000', spriteIndex: 17,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 8, baseDmg: 20, reloadTime: 3000,
    isAccessory: true,
    baseBodyDamage: 55,
    bodyDamageMultiplier: 3,
    description: 'placeholder', // overridden per-tier below
  },
  soil: {
    name: 'Soil', color: '#664b1d', border: '#4c3713', spriteIndex: 19,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 30, baseDmg: 15, reloadTime: 2000,
    baseMaxHpBonus: 200,
    maxHpBonusMultiplier: 3,
    description: 'placeholder', // overridden per-tier below
  },
  magnet: {
    name: 'Magnet', color: '#b84040', border: '#7a2020', spriteIndex: 20,
    radius: 14.5, hitboxX: -1, hitboxY: -1,
    baseHp: 15, baseDmg: 2, reloadTime: 2000,
    isAccessory: true, noExpand: true,
    baseFlatPickupBonus: 150,     // +150 world-unit pickup radius at Common
    flatPickupBonusPerTier: 150,  // +150 per tier
    description: 'placeholder',   // overridden per-tier below
  },
  missile: {
    name: 'Missile', color: '#1a1a1a', border: '#3a2800', spriteIndex: 26,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 1, baseDmg: 30, reloadTime: 4000,
    isMissilePetal: true, noExpand: true,
    description: 'placeholder',   // overridden per-tier below
  },
  centipede_legs: {
    name: 'Centipede Legs', color: '#7ed62a', border: '#3a6b1a', spriteIndex: 9,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 8, baseDmg: 12, reloadTime: 3000,
    isAccessory: true,
    baseWalkSpeedBonus: 2.2,       // flat speed added to PLAYER_SPEED
    walkSpeedBonusMultiplier: 1.5, // ×1.5 per tier
    description: 'placeholder', // overridden per-tier below
  },
  third_eye: {
    name: 'Third Eye', color: '#111111', border: '#444444', spriteIndex: 11,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 8, baseDmg: 10, reloadTime: 2000,
    isAccessory: true,
    baseExpandBonus: 0,           // unused — overridden by expandBonusByTier
    expandBonusByTier: [          // Common–Legendary = 0; Mythic = +30; +15/tier after
      0,   // Common
      0,   // Unusual
      0,   // Rare
      0,   // Epic
      0,   // Legendary
      30,  // Mythic
      45,  // Ultra
      60,  // Super
      75,  // Radiant
      90,  // Mystic
      105, // Runic
      120, // Seraphic
      135, // Umbral
      150, // Impracticality
    ],
    description: 'placeholder', // overridden per-tier below
  },
  ant_egg: {
    name: 'Ant Egg', color: '#fffcec', border: '#2a2a2a', spriteIndex: 15,
    radius: 10,
    baseHp: 100, baseDmg: 0, reloadTime: 1000,
    hpScaleMult: 3,  // HP × 3 per tier (not 3.75)
    noExpand: true,
    isAntEgg: true,
    pieceShape: 'ant_egg',
    description: 'placeholder',
  },
  bee_egg: {
    name: 'Bee Egg', color: '#f5cf4b', border: '#c8960a', spriteIndex: 22,
    radius: 9.5,
    hitboxX: 0, hitboxY: 0,
    baseHp: 100, baseDmg: 0, reloadTime: 1000,
    hpScaleMult: 3,  // HP × 3 per tier (not 3.75)
    noExpand: true,
    isBeeEgg: true,
    pieceShape: 'bee_egg',
    description: 'placeholder',
  },
  digger_egg: {
    name: 'Digger Egg', color: '#8c8c8c', border: '#000000', spriteIndex: 18,
    radius: 10,
    hitboxX: 0, hitboxY: 0,
    baseHp: 100, baseDmg: 0, reloadTime: 1000,
    hpScaleMult: 3,  // HP × 3 per tier
    noExpand: true,
    isDiggerEgg: true,
    pieceShape: 'digger_egg',
    description: 'placeholder',
  },
  honeycomb: {
    name: 'Honeycomb', color: '#ffba04', border: '#9a6200', spriteIndex: 23,
    radius: 11, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 0, reloadTime: 5000,
    isHoneycomb: true, noExpand: true,
    // HP: 1000 * 3^tier (custom scaling — overrides default 3.75^tier)
    honeycombHpByTier: [
      1000, 3000, 9000, 27000, 81000, 243000, 729000,
      2187000, 6561000, 19683000, 59049000, 177147000, 531441000, 1594323000,
    ],
    // Attract range per rarity tier
    attractRangeByTier: [
      140, 220, 320, 400, 570, 750, 940, 1250, 1750, 3000,
      5000, 9000, 18000, 45000,
    ],
    description: 'placeholder', // overridden per-tier below
  },
  clover: {
    name: 'Clover', color: '#5cba3c', border: '#2e7d32', spriteIndex: 12,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 3, baseDmg: 3, reloadTime: 2000,
    baseLuckBonus: 0.001,      // +0.1% at Common
    luckBonusPerTier: 0.002,   // +0.2% per tier above Common
    description: 'placeholder',
  },
  antennae: {
    name: 'Antennae', color: '#3d3d3d', border: '#1a1a1a', spriteIndex: 24,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 8, baseDmg: 9, reloadTime: 2000,
    isAccessory: true,
    // Per-tier vision bonus (fraction added to zoom-out multiplier, e.g. 0.25 = +25%)
    visionBonusByTier: [
      0.25,  // Common
      0.40,  // Unusual
      0.60,  // Rare
      0.80,  // Epic
      0.90,  // Legendary
      1.00,  // Mythical
      2.00,  // Ultra
      3.50,  // Super
      5.00,  // Radiant
      8.00,  // Mystitic
      12.00, // Runic
      18.00, // Seraphic
      28.00, // Umbral
      50.00, // Impracticality
    ],
    description: 'placeholder', // overridden per-tier below
  },

  // ── NEW — hitbox/radius calibrated, stats + special mechanics TODO ────────
  // radius/hitboxX/hitboxY below are from the calibration pass; everything
  // else is a placeholder until stats + unique behavior are written.
  beetle_egg: {
    name: 'Beetle Egg', color: '#fff3c2', border: '#2a2a2a', spriteIndex: 27,
    radius: 10.00, hitboxX: 0.0, hitboxY: 0.0,
    baseHp: 100, baseDmg: 0, reloadTime: 1000,
    hpScaleMult: 3,  // HP × 3 per tier, matches bee_egg (not the standard 3.75)
    noExpand: true,
    isBeetleEgg: true,
    pieceShape: 'beetle_egg',
    description: 'placeholder', // overridden per-tier by the generator
  },
  pincer: {
    name: 'Pincer', color: '#0e0e0e', border: '#000000', spriteIndex: 28,
    radius: 8.28, hitboxX: -2.0, hitboxY: -2.5,
    baseHp: 5, baseDmg: 5, reloadTime: 2000,
    basePoisonDps: 33,
    slowOnHitFactor: 0.20, // flat 20% slow on hit for 3s, all rarities (not yet tier-scaled per your call)
    description: 'Poisons and slows enemies on contact for 3 seconds.',
  },
  bone: {
    name: 'Bone', color: '#f5f5f5', border: '#d8d8d8', spriteIndex: 29,
    radius: 10.00, hitboxX: 0.0, hitboxY: 0.0,
    baseHp: 40, baseDmg: 12, baseArmor: 40, reloadTime: 1500,
    // No custom hpScaleMult — both baseHp and baseArmor use the same default
    // x3^tier curve, so armor stays numerically equal to HP at every rarity.
    description: 'A sturdy bone. Its armor always matches its own HP.',
  },
  iris: {
    name: 'Iris', color: '#8b3fc4', border: '#5e1a8f', spriteIndex: 30,
    radius: 6.24, hitboxX: 0.0, hitboxY: 0.0,
    baseHp: 5, baseDmg: 5, reloadTime: 2000,
    basePoisonDps: 38.5, // 10% more than Poison's 35
    poisonDuration: 5000, // 2s longer than the standard 3s
    description: 'A stronger poison that lingers longer than most.',
  },
  sand: {
    name: 'Sand', color: '#ffdc00', border: '#d6b700', spriteIndex: 31,
    radius: 6.56, hitboxX: 0.0, hitboxY: 0.0,
    // Same stats as Peas, just Sand's own art for the pieces (no launch look)
    baseHp: 5, baseDmg: 100, baseArmor: 3, reloadTime: 3000,
    pieceShape: 'sand',
    pieces: [
      { dx: -0.6, dy: -0.6, pr: 0.43 },
      { dx:  0.6, dy: -0.6, pr: 0.43 },
      { dx: -0.6, dy:  0.6, pr: 0.43 },
      { dx:  0.6, dy:  0.6, pr: 0.43 },
    ],
    description: 'Four grains of sand. Each pellet hits independently.',
  },
  stick: {
    name: 'Stick', color: '#a9793f', border: '#6b4a24', spriteIndex: 32,
    radius: 7.50, hitboxX: 0.0, hitboxY: 0.0,
    baseHp: 5, baseDmg: 0, reloadTime: 5000, // one-time reload when first equipped; after that it stays active forever
    stickHatchInterval: 10000, // recurring spawn cycle once active — separate from the one-time reloadTime above
    isStick: true, noExpand: true, invincible: true,
    description: 'placeholder', // overridden per-tier by the generator
  },
  salt: {
    name: 'Salt', color: '#f4f4f4', border: '#c9c9c9', spriteIndex: 33,
    radius: 8.01, hitboxX: 0.0, hitboxY: 0.0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000, // mild HP/damage, nothing special beyond the reflect — normal orbiting petal
    isSaltReflect: true,
    // Reflect % curve, per instruction: 28% at Common, +7%/tier through
    // Mythic, +20% Mythic→Ultra, then alternating +7%/+10% per tier after
    // that (Ultra→Super +7, Super→Radiant +10, Radiant→Mystic +7, …).
    saltReflectByTier: [28, 35, 42, 49, 56, 63, 83, 90, 100, 107, 117, 124, 134, 141],
    description: 'placeholder', // overridden per-tier below
  },

  // ── New petals below (moved here from STATIC_PETALS so they scale across
  // all 14 rarity tiers like every other droppable petal, and so the normal
  // tiered drop-rate system in combat.js can target them). Hitbox geometry
  // (radius/hitboxX/hitboxY) came from the hitbox editor session on
  // 2026-09-19 and matches the real drawn sprite size for each. baseHp/
  // baseDmg/reloadTime are PLACEHOLDERS ONLY (default ×3.75 HP / ×3 DMG per
  // tier, same as Basic/Faster/etc) — no balance numbers have been provided
  // yet, and no special mechanics are implemented; both come later.
  corn: {
    name: 'Corn', color: '#f7d94a', border: '#c9a11f', spriteIndex: 34,
    radius: 11, hitboxX: 0, hitboxY: 0,
    baseHp: 120, baseDmg: 14, reloadTime: 10000, // slow reload (10s @ Common), A LOT of HP, mid damage, per instruction
    reloadDecayPerTier: 0.05, // -5% reload time per tier, compounding, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  blood_corn: {
    name: 'Blood Corn', color: '#8a0f16', border: '#4a0508', spriteIndex: 35,
    radius: 11, hitboxX: 0, hitboxY: 0, // matches Corn's own size exactly, per instruction
    baseHp: 120, baseDmg: 10, reloadTime: 2000, // same tanky HP as regular Corn, per instruction
    isBloodGrowth: true,
    bloodResetOnDeath: true,       // resets when the petal breaks/reloads, per instruction
    bloodGrowthRatePerSec: 0.015,  // damage grows 1.5%/s, per instruction
    bloodGrowthCapSec: 60,         // caps at 60s, per instruction
    baseSelfDamageOnHit: 0.1,      // placeholder — self-damage dealt to the player per mob hit, grows on the same curve
    description: 'placeholder', // overridden per-tier below
  },
  blood_leaf: {
    name: 'Blood Leaf', color: '#8a0f16', border: '#4a0508', spriteIndex: 36,
    radius: 15, hitboxX: 0, hitboxY: -2, // matches Leaf's own size exactly
    baseHp: 12, baseDmg: 15, reloadTime: 2000, // same base as regular Leaf
    isBloodGrowth: true,
    bloodResetOnDeath: false,      // resets on unequip/slot-swap only, per instruction (handled naturally by a fresh instance)
    bloodGrowthRatePerSec: 0.015,  // same growth curve as Blood Corn
    bloodGrowthCapSec: 60,         // caps at 60s, per instruction
    basePassiveDamage: 2,          // placeholder — same delivery as Leaf's passiveHeal, but damages instead of healing; grows on the same curve
    description: 'placeholder', // overridden per-tier below
  },
  blood_wing: {
    name: 'Blood Wing', color: '#8a0f16', border: '#2a0304', spriteIndex: 37,
    radius: 11, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    isWing: true, // same swing animation as regular Wing, per instruction
    isBloodGrowth: true,
    bloodResetOnDeath: false,       // resets on unequip/slot-swap only, per instruction
    bloodGrowthRatePerSec: 0.10,    // this hit-DoT grows 10%/s, per instruction (its own rate, distinct from Corn/Leaf's 1.5%/s)
    bloodGrowthCapSec: 85,          // caps at 85s, per instruction
    baseOnHitDamage: 2,             // placeholder — a DoT-style bonus damage applied once per hit, grows on the curve above
    description: 'placeholder', // overridden per-tier below
  },
  jellyfish_egg: {
    name: 'Jellyfish Egg', color: '#d8d8d8', border: '#b0b0b0', spriteIndex: 38,
    radius: 10, hitboxX: 0, hitboxY: 0, // a little smaller, per instruction
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    isJellyfishEgg: true,
    description: 'placeholder', // overridden per-tier below
  },
  jelly: {
    name: 'Jelly', color: '#b0b0b0', border: '#ffffff', spriteIndex: 39,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 850, // flat 0.85s at every tier, per instruction
    knockbackOnHit: true, // same mass-ratio push mechanic as Heavy — see combat.js
    baseKnockbackStrength: 0.686, // placeholder — calibrated so it lands ~500 at Ultra, ~1500 at Super, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  ink: {
    name: 'Ink', color: '#0d0d12', border: '#26262e', spriteIndex: 40,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 5000,
    isInkPool: true,
    // Pool start radius = this petal's own `radius` above (matches it
    // exactly, per instruction); end radius = 10x that, scaled up by tier
    // like every other special-mechanic magnitude — see the isInkPool
    // block in generateScaledVariants() below.
    inkPoolDuration: 10000,   // flat 10s across all tiers, per instruction
    baseInkSlowFactor: 0.35,  // placeholder — movement slow fraction while inside
    basePoisonDps: 4,         // placeholder — reuses the existing poison system
    description: 'placeholder', // overridden per-tier below
  },
  tentacle: {
    name: 'Tentacle', color: '#e08a3a', border: '#a85a1c', spriteIndex: 41,
    radius: 15, hitboxX: 0, hitboxY: 0, // quite a bit bigger, per instruction
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    description: 'A severed tentacle. No special ability yet — a straightforward combat petal for now.',
  },
  ink_sack: {
    name: 'Ink Sack', color: '#0d0d12', border: '#26262e', spriteIndex: 42,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 7000, // decently long CD (7s), per instruction
    explosionRadius: 180, // was 60 — a LOT bigger, per instruction
    // Poison (not bleed): 65% of the hit's damage delivered smoothly over
    // 1.5s, repeating for 3s total — same continuous-rate poison system as
    // every other poison petal (Peas, Iris, etc.), not the fixed-tick bleed
    // system Tooth/Glass use. basePoisonDps below is derived at generation
    // time from the hit damage directly (poison scales with damage, not a
    // flat per-tier number), so it isn't set here.
    poisonTickFraction: 0.65,   // 65% of the hit's damage, per instruction
    poisonTickWindowMs: 1500,   // delivered smoothly over this window, per instruction
    poisonDuration: 3000,       // total duration (2 windows), per instruction
    description: 'placeholder', // overridden per-tier below
  },
  claw: {
    name: 'Claw', color: '#7a5540', border: '#5a3a26', spriteIndex: 43,
    radius: 13, hitboxX: 0, hitboxY: 0, // quite a bit bigger, per instruction
    baseHp: 10, baseDmg: 10, reloadTime: 2500,
    critChance: 0.015,   // flat 1.5% across all tiers, per instruction
    critMultiplier: 25,  // flat 25x across all tiers, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  carapace: {
    name: 'Carapace', color: '#de7048', border: '#ac5a3a', spriteIndex: 44,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    basePassiveHeal: 1.5,   // a little less than Leaf's 2/s, per instruction
    basePassiveShield: 1.5, // same rate as its own passive heal, per instruction
    basePassiveShieldCap: 30, // placeholder — max shield this regen can build up to (20s to fill at 1.5/s)
    description: 'placeholder', // overridden per-tier below
  },
  starfish_arm: {
    name: 'Starfish', color: '#d9534f', border: '#8a2620', spriteIndex: 45,
    radius: 6, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    basePassiveHealBelowHalf: 2.5, // Leaf's 2/s + 25%, only while player HP < 50%, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  coral: {
    name: 'Coral', color: '#f28b7a', border: '#b0453f', spriteIndex: 46,
    radius: 12, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 5000, // 5s CD once the whole chain is spent, per instruction
    isCoralChain: true,
    coralSplitDelay: 100, // 0.1s delay after a split before the new pieces are live, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  pearl: {
    name: 'Pearl', color: '#f5efe3', border: '#d8cbb8', spriteIndex: 47,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 40, baseDmg: 18, reloadTime: 2500,
    isGroundGuard: true, // new reusable mechanic — see combat.js's ground-guard block; planned for eggs later too
    description: 'placeholder', // overridden per-tier below
  },
  shell_shape: {
    name: 'Shell', color: '#e8b96a', border: '#a87a3a', spriteIndex: 48,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 5, baseDmg: 5, reloadTime: 2500, // same combat stats as Rose, per instruction ("similar to how rose works")
    baseShield: 10, // same amount as Rose's baseHeal (10) — gives shield instead of heal, per instruction
    noExpand: true, canCollect: false,
    description: 'Moves to the player when they take damage, grants them a shield, then reloads.',
  },
  ocean_artifact: {
    name: 'Ocean Artifact', color: '#2fb8cc', border: '#083f4a', spriteIndex: 49,
    radius: 8, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    description: 'A relic pulled from the deep. Reserved for a future mechanic — a plain combat petal for now.',
  },
  sponge_petal: {
    name: 'Sponge', color: '#c4945c', border: '#6b4a2e', spriteIndex: 50,
    radius: 9, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    isSpongeAbsorb: true,
    spongeWindowMs: 30000, // 30s spread window, per instruction — flat across tiers for now
    description: 'placeholder', // overridden per-tier below
  },
  air: {
    name: 'Air', color: '#e8f4f8', border: '#c0dce8', spriteIndex: 51,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 0, baseDmg: 0, reloadTime: 0, // no stats, no reload — pure passive accessory, per instruction
    isAccessory: true, noExpand: true,
    baseSizeBonus: 0.10,     // +10% player size at Common, per instruction
    sizeBonusPerTier: 0.05,  // +5% per tier, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  bubble_petal: {
    name: 'Bubble', color: 'rgba(191,232,242,0.4)', border: 'rgba(143,214,232,0.8)', spriteIndex: 52,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 0, // no contact damage, per instruction — it's a utility petal, not a fighter
    // Reload = 1.5s fixed + a 0.7s component that decays 0.1s/tier, floored
    // at 0.05s — per instruction's "1.5s + 0.7s base, -0.1 to -0.2s/tier"
    // (picked the stated range's lower end as a placeholder rate).
    reloadFixedMs: 1500, reloadDecayingMs: 700, reloadFlatDecayPerTier: 100, reloadFloorMs: 50,
    reloadTime: 2200, // pre-computed Common-tier value (1500+700), matches the formula above at tier 0
    isBubbleBoost: true,
    baseBoostStrength: 15,     // +15 per tier, per instruction (this is the Common/tier-0 value)
    boostStrengthPerTier: 15,
    description: 'placeholder', // overridden per-tier below
  },
  fang: {
    name: 'Fang', color: '#c0342f', border: '#7a1a17', spriteIndex: 53,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 1200,
    baseHealOnHit: 17.5, // Rose's baseHeal (10) × 1.75, per instruction — heals on hit, not passively
    description: 'placeholder', // overridden per-tier below
  },
  rock_petal: {
    name: 'Rock', color: '#8a8580', border: '#5c5852', spriteIndex: 54,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 30, baseDmg: 75, reloadTime: 5000, // baseDmg = half of Stinger's single-pellet damage (150/2), per instruction
    description: 'A jagged chunk of rock. Long reload, but good HP and a solid hit for it.',
  },
  dandelion_seed_petal: {
    name: 'Dandelion', color: '#ffffff', border: '#8a8a8a', spriteIndex: 55,
    radius: 5, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    description: 'A single dandelion seed. Its ability hasn\'t been built yet — a plain combat petal for now.',
  },
  compass: {
    name: 'Compass', color: '#3a6ea5', border: '#000000', spriteIndex: 56,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    description: 'A weathered compass. Its ability hasn\'t been built yet — a plain combat petal for now.',
  },
  metal: {
    name: 'Metal', color: '#9a9a9a', border: '#4a4a4a', spriteIndex: 57,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 300, reloadTime: 20000, // baseDmg = 2x Stinger's total un-split damage (150), per instruction
    description: 'A heavy scrap of metal. Very long reload, but hits harder than almost anything else in your ring.',
  },
  scales: {
    name: 'Scales', color: '#3a6b2c', border: '#1f3a17', spriteIndex: 58,
    radius: 7, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 0, baseArmor: 8, reloadTime: 2000, // no damage — pure passive armor, like Bone but low, per instruction
    description: 'Tough reptilian scales. Grants armor while active — lighter than Bone, but reliable.',
  },
  tooth: {
    name: 'Tooth', color: '#f5f0e8', border: '#c9c0ac', spriteIndex: 59,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    bleedTickFraction: 0.05,   // 5% of the hit's damage per tick, per instruction
    bleedTickInterval: 50,     // every 0.05s, per instruction
    bleedDuration: 1000,       // for 1s, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  glass: {
    name: 'Glass', color: 'rgba(255,255,255,0.3)', border: '#e8e8e8', spriteIndex: 60,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    bleedTickFraction: 0.07,   // a bit more than Tooth's 5%, per instruction
    bleedTickInterval: 50,     // same cadence as Tooth
    bleedDuration: 1000,       // same duration as Tooth
    description: 'placeholder', // overridden per-tier below
  },
  powder: {
    name: 'Powder', color: '#ffffff', border: '#d0d0d0', spriteIndex: 61,
    radius: 6.5, hitboxX: 0, hitboxY: 0, // was drastically undersized at 2 — now in line with Sand (6.56)
    baseHp: 10, baseDmg: 10, reloadTime: 2000,
    isAccessory: true,
    baseWalkSpeedBonus: 2.6,       // a little more than Centipede Legs' 2.2, per instruction
    walkSpeedBonusMultiplier: 1.5, // same per-tier multiplier as Centipede Legs
    description: 'placeholder', // overridden per-tier below
  },
  moon: {
    name: 'Moon', color: '#7c7c78', border: '#383836', spriteIndex: 62,
    radius: 29.7, hitboxX: 0, hitboxY: 0, // 1.35x player radius (22), per instruction
    baseHp: 80, baseDmg: 10, reloadTime: 15000, // long CD, lots of HP, per instruction
    description: 'A sliver of the moon, noticeably bigger than you. Very long reload, but tremendous HP.',
  },
  heavy: {
    name: 'Heavy', color: '#8a8a8a', border: '#000000', spriteIndex: 63,
    radius: 10, hitboxX: 0, hitboxY: 0,
    baseHp: 70, baseDmg: 12, reloadTime: 7500, // lots of HP, mild damage, 7.5s CD, per instruction
    knockbackOnHit: true,
    baseKnockbackStrength: 6, // placeholder — low, mass-ratio push like mob<->mob collision, per instruction
    description: 'placeholder', // overridden per-tier below
  },
  lightning: {
    name: 'Lightning', color: '#4dd8c8', border: '#0e6e5c', spriteIndex: 64,
    radius: 8, hitboxX: 0, hitboxY: 0,
    baseHp: 10, baseDmg: 10, reloadTime: 750, // flat 0.75s CD, per instruction
    isChainLightning: true,
    chainCapBase: 2,        // starts at 2 chained mobs at Common, per instruction
    chainCapPerTwoTiers: 1, // +1 chain every 2 tiers, per instruction
    description: 'placeholder', // overridden per-tier below
  },
};

// ── Piece layout helpers ──────────────────────────────────────────────────────

/** For a piece at (dx,dy) relative to cluster centre, compute the angle (deg)
 *  that makes the stinger tip point inward toward the centre. */
function _tipAngle(dx, dy) {
  return Math.atan2(-dy, -dx) * 180 / Math.PI;
}

/** Returns the pieces array for a stinger at the given piece count. */
function stingerPiecesForCount(n) {
  if (n === 1) return [{ dx: 0, dy: 0, pr: 1.0, angle: 0 }];
  if (n === 2) {
    const off = 1.70;
    return [
      { dx: -off, dy: -off, pr: 0.70, angle: _tipAngle(-off, -off) },
      { dx:  off, dy:  off, pr: 0.70, angle: _tipAngle( off,  off) },
    ];
  }
  if (n === 3) {
    const off = 0.55;
    // Triangle — BL, BR, N (N drawn last = on top)
    const pts = [
      [-off * 0.866,  off * 0.5],
      [ off * 0.866,  off * 0.5],
      [ 0,           -off       ],
    ];
    return pts.map(([dx, dy]) => ({ dx, dy, pr: 0.65, angle: _tipAngle(dx, dy) }));
  }
  if (n === 4) {
    const off = 0.52;
    // Compass — E, S, W, N (N drawn last)
    const pts = [[off, 0], [0, off], [-off, 0], [0, -off]];
    return pts.map(([dx, dy]) => ({ dx, dy, pr: 0.60, angle: _tipAngle(dx, dy) }));
  }
  if (n === 5) {
    const off = 0.48;
    // Pentagon — draw order NE, SE, SW, NW, N (N last = top)
    return [-18, 54, 126, 198, -90].map(a => {
      const dx = Math.cos(a * Math.PI / 180) * off;
      const dy = Math.sin(a * Math.PI / 180) * off;
      return { dx, dy, pr: 0.56, angle: _tipAngle(dx, dy) };
    });
  }
  if (n === 6) {
    const off = 0.45;
    // Hexagon — draw order NE, SE, SW, NW, N, S (S=newest, drawn last = top)
    return [-30, 30, 150, 210, -90, 90].map(a => {
      const dx = Math.cos(a * Math.PI / 180) * off;
      const dy = Math.sin(a * Math.PI / 180) * off;
      return { dx, dy, pr: 0.52, angle: _tipAngle(dx, dy) };
    });
  }
  return [{ dx: 0, dy: 0, pr: 1.0, angle: 0 }];
}

/** Returns the pieces array for an ant egg at the given piece count. */
function antEggPiecesForCount(n) {
  if (n === 4) {
    // Draw order: E, S, W, N (N last = top)
    return [
      { dx:  0.47, dy:  0,    pr: 0.62 },
      { dx:  0,    dy:  0.47, pr: 0.62 },
      { dx: -0.47, dy:  0,    pr: 0.62 },
      { dx:  0,    dy: -0.47, pr: 0.62 },
    ];
  }
  if (n === 5) {
    const off = 0.565;
    // Pentagon. NE drawn first (behind), N drawn last (top)
    return [-18, 54, 126, -162, -90].map(a => ({
      dx: Math.cos(a * Math.PI / 180) * off,
      dy: Math.sin(a * Math.PI / 180) * off,
      pr: 0.55,
    }));
  }
  if (n === 6) {
    const off = 0.44;
    // Hexagon. NE drawn first (behind), N drawn last (top)
    return [-30, 30, 90, 150, 210, -90].map(a => ({
      dx: Math.cos(a * Math.PI / 180) * off,
      dy: Math.sin(a * Math.PI / 180) * off,
      pr: 0.50,
    }));
  }
  return antEggPiecesForCount(4);
}

/** Returns the pieces array for a light petal at the given piece count.
 *  Arranged like ant eggs — plain circles evenly spaced, no tip angle. */
function lightPiecesForCount(n) {
  // Compute off so edge-to-edge gap matches ant egg n=4 (chord = 0.665 in radius units)
  // chord = 2 * off * sin(PI/n). At n=4 off=0.47 → chord=0.665.
  // For other n: off = 0.665 / (2 * sin(PI/n))
  const targetChord = 0.665;
  if (n === 1) return [{ dx: 0, dy: 0, pr: 0.85 }];
  const off = targetChord / (2 * Math.sin(Math.PI / n));
  const pr  = n <= 3 ? 0.70 : n <= 5 ? 0.60 : n <= 6 ? 0.52 : 0.46;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2; // start at top
    return { dx: Math.cos(a) * off, dy: Math.sin(a) * off, pr };
  });
}

// Piece counts per rarity tier (index = tier 0–13)
const STINGER_PIECE_COUNT  = [1, 2, 2, 2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6];
const LIGHT_PIECE_COUNT    = [2, 3, 3, 3, 4, 5, 5, 6, 6, 6, 7, 7, 7, 7];
const POLLEN_PIECE_COUNT   = [1, 2, 2, 2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6];
const ANT_EGG_PIECE_COUNT  = [4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6];

function generateScaledVariants() {
  const out = {};
  for (const [baseId, base] of Object.entries(SCALABLE_BASES)) {
    for (let tier = 0; tier < RARITIES.length; tier++) {
      const rarity  = RARITIES[tier];
      const id      = scaledId(baseId, tier);
      const hpMult  = Math.pow(base.hpScaleMult ?? 3, tier);
      const dmgMult = Math.pow(3,    tier);
      const x3Mult  = Math.pow(3,    tier);

      const entry = {
        id, name: base.name, rarity, tier,
        spriteIndex: base.spriteIndex,
        color: base.color, border: base.border,
        radius:  base.radius,
        hitboxX: base.hitboxX ?? 0,
        hitboxY: base.hitboxY ?? 0,
        maxHp:      base.noScaleHp ? base.baseHp : Math.round(base.baseHp  * hpMult),
        damage:     Math.round(base.baseDmg * dmgMult),
        reloadTime: base.reloadDecayPerTier !== undefined
          ? Math.round(base.reloadTime * Math.pow(1 - base.reloadDecayPerTier, tier))
          : base.reloadFlatDecayPerTier !== undefined
          ? Math.round(base.reloadFixedMs + Math.max(base.reloadFloorMs ?? 0, base.reloadDecayingMs - base.reloadFlatDecayPerTier * tier))
          : base.reloadTime,
        description: base.description,
      };

      if (base.reloadDecayPerTier !== undefined) {
        entry.description = `A sturdy kernel. Slow to reload (${(entry.reloadTime/1000).toFixed(1)}s at this rarity), but reload time drops ${Math.round(base.reloadDecayPerTier*100)}% per tier. Very high HP, moderate damage.`;
      }

      if (base.isAntEgg) {
        const pieceCount = ANT_EGG_PIECE_COUNT[tier] ?? 4;
        entry.isAntEgg  = true;
        entry.hatchTime = tier >= 6 ? 15000 : 4000;
        entry.damage    = 0;
        entry.pieces    = antEggPiecesForCount(pieceCount);
        const hatchSec  = tier >= 6 ? '15s' : '4s';
        entry.description = `${pieceCount} pieces — each hatches a friendly ${rarity} Soldier Ant pet. Pellet reloads in 1s; ant spawns ${hatchSec} after. Pet death recycles its piece.`;
      }

      if (base.isBeeEgg) {
        entry.isBeeEgg  = true;
        entry.damage    = 0;
        const hatchMs   = tier >= 9 ? 10000 : tier >= 5 ? 5000 : 2000;
        const hatchSec  = tier >= 9 ? '10s' : tier >= 5 ? '5s' : '2s';
        entry.hatchTime = hatchMs;
        entry.description = `Hatches a friendly ${rarity} Bee pet. Pellet reloads in 1s; bee spawns ${hatchSec} after. Pet death recycles the piece.`;
      }

      if (base.isBeetleEgg) {
        entry.isBeetleEgg = true;
        entry.damage      = 0;
        const hatchMs     = tier >= 9 ? 10000 : tier >= 5 ? 5000 : 2000; // same cadence as bee egg
        const hatchSec    = tier >= 9 ? '10s' : tier >= 5 ? '5s' : '2s';
        entry.hatchTime   = hatchMs;
        entry.description = `Hatches a single friendly ${rarity} Beetle pet. Pellet reloads in 1s; beetle spawns ${hatchSec} after. Pet death recycles the piece.`;
      }

      if (base.isStick) {
        entry.isStick     = true;
        entry.damage      = 0;
        entry.hatchTime   = 5000; // ONE-TIME reload after equipping — flat 5s across all rarities
        entry.description = `A permanent side petal — reloads once (5s), then stays active forever, spawning a friendly ${rarity} Sandstorm pet every 10s (up to 3 alive). Despawns its pets if unequipped.`;
      }

      if (base.isDiggerEgg) {
        entry.isDiggerEgg = true;
        entry.damage      = 0;
        const hatchMs     = tier >= 6 ? 7000 : 5000;  // Ultra+ = 7s, Common–Mythical = 5s
        const hatchSec    = tier >= 6 ? '7s' : '5s';
        entry.hatchTime   = hatchMs;
        entry.description = `Hatches a friendly ${rarity} Digger pet. Pellet reloads in 1s; digger spawns ${hatchSec} after. Pet death recycles the piece.`;
      }

      if (base.isJellyfishEgg) {
        entry.isJellyfishEgg = true;
        entry.damage         = 0;
        const hatchMs        = tier >= 6 ? 7000 : 5000; // same cadence as digger egg
        const hatchSec       = tier >= 6 ? '7s' : '5s';
        entry.hatchTime      = hatchMs;
        entry.description    = `Hatches a friendly ${rarity} Jellyfish pet that chains lightning between up to 4 mobs. Pellet reloads in 1s; jellyfish spawns ${hatchSec} after. Pet death recycles the piece.`;
      }

      if (base.noExpand)             entry.noExpand    = true;
      if (base.invincible)           entry.invincible  = true;
      if (base.stickHatchInterval !== undefined) entry.stickHatchInterval = base.stickHatchInterval;
      if (base.canCollect === false)  entry.canCollect  = false;
      if (base.oneShot)              entry.oneShot     = true;
      if (base.dropsPollen) {
        entry.dropsPollen  = true;
        entry.pollenCount  = POLLEN_PIECE_COUNT[tier] ?? 1;
      }
      if (base.isWing)               entry.isWing      = true;
      if (base.pieceShape)           entry.pieceShape  = base.pieceShape;

      // Stinger: generate tier-specific pieces and split damage evenly
      if (base.pieceShape === 'stinger') {
        const pieceCount = STINGER_PIECE_COUNT[tier] ?? 1;
        entry.pieces = stingerPiecesForCount(pieceCount);
        entry.damage = Math.round((base.baseDmg * dmgMult) / pieceCount);
      } else if (base.isLight) {
        const pieceCount = LIGHT_PIECE_COUNT[tier] ?? 2;
        entry.isLight  = true;
        entry.pieces   = lightPiecesForCount(pieceCount);
        entry.damage   = Math.round((base.baseDmg * dmgMult) / pieceCount);
      } else if (base.pieces) {
        // Other multi-piece petals (peas, orange) — copy as-is
        entry.pieces = base.pieces;
      }

      if (base.baseArmor !== undefined)
        entry.armor = Math.round(base.baseArmor * x3Mult);

      if (base.spinBonusPerSec !== undefined)
        entry.spinBonus = (base.spinBonusPerSec + 0.4 * tier) / 60;

      if (base.baseHeal !== undefined) {
        entry.healAmount   = Math.round(base.baseHeal * x3Mult);
        entry.cooldownText = `${(base.reloadTime / 1000).toFixed(1)}s + 0.5s`;
      }

      if (base.baseShield !== undefined) {
        entry.shieldAmount = Math.round(base.baseShield * x3Mult);
        entry.cooldownText = `${(base.reloadTime / 1000).toFixed(1)}s + 0.5s`;
        entry.cooldownText = `${(base.reloadTime / 1000).toFixed(1)}s + 0.5s`;
      }

      if (base.basePoisonDps !== undefined)
        entry.poisonDps = Math.round(base.basePoisonDps * x3Mult);

      if (base.poisonDuration !== undefined)
        entry.poisonDuration = base.poisonDuration; // flat fixed duration across all tiers, not scaled

      if (base.basePassiveHeal !== undefined) {
        entry.passiveHeal = base.basePassiveHeal * x3Mult;
        if (base.basePassiveShield === undefined) {
          entry.description = `A sturdy leaf. Passively heals the player while active.`;
        }
      }

      if (base.basePassiveShield !== undefined) {
        entry.passiveShield = base.basePassiveShield * x3Mult;
        // passiveShieldCap's own numeric value is no longer the real ceiling
        // (maxShield is always the player's own maxHp once any shield
        // source is equipped — see combat.js) — this field now only marks
        // "this petal grants shield" for that check, kept for backward
        // compatibility with anything still reading it.
        entry.passiveShieldCap = base.basePassiveShieldCap * x3Mult;
        entry.description = base.basePassiveHeal !== undefined
          ? `A hardened shell. Passively heals you and builds up a shield (capped at your max HP) at the same rate while active.`
          : `Passively builds up a shield (capped at your max HP) while active.`;
      }

      if (base.baseSlowFactor !== undefined)
        entry.slowFactor = base.baseSlowFactor;

      if (base.slowOnHitFactor !== undefined)
        entry.slowOnHitFactor = base.slowOnHitFactor; // flat across all tiers for now, per instruction — scale later

      if (base.isInkPool) {
        entry.isInkPool       = true;
        // Start radius = the petal's own actual size (never scales by tier,
        // same as every petal's radius) — end radius = a flat 10x that, per
        // instruction. NOT tier-scaled like damage-style mechanics: a world-
        // space size compounding by 3^tier would reach into the millions of
        // units by Impracticality, which is meaningless for something that
        // has to fit on the map.
        entry.inkStartRadius  = base.radius;
        entry.inkEndRadius    = base.radius * 10;
        entry.inkPoolDuration = base.inkPoolDuration; // flat 10s across all tiers, per instruction
        entry.inkSlowFactor   = base.baseInkSlowFactor; // flat for now, like the web petal's slowFactor — scale later
        entry.cooldownText    = `${(base.reloadTime / 1000).toFixed(1)}s + 0.5s`;
        entry.description     = `Drop and hold for 0.5s to place a spreading ink pool. Slows and poisons anything inside as it grows over ${(base.inkPoolDuration/1000).toFixed(0)}s. No collision — can't be destroyed.`;
      }

      if (base.isGroundGuard) {
        entry.isGroundGuard = true;
        entry.cooldownText  = `${(base.reloadTime / 1000).toFixed(1)}s`;
        entry.description   = `Drop and hold to plant it on the ground — it won't return to orbit while destroyed, only when its HP runs out and it reloads. Nudges back into view if it ever leaves your screen.`;
      }

      if (base.critChance !== undefined) {
        entry.critChance    = base.critChance;      // flat across tiers for now, per instruction
        entry.critMultiplier = base.critMultiplier; // flat across tiers for now, per instruction
        entry.description = `A ${Math.round(base.critChance*1000)/10}% chance per hit to land a critical strike for ${base.critMultiplier}× damage.`;
      }

      if (base.basePassiveHealBelowHalf !== undefined) {
        entry.passiveHealBelowHalf = base.basePassiveHealBelowHalf * x3Mult;
        entry.description = `Passively heals you, but only while your HP is below 50%.`;
      }

      if (base.baseHealOnHit !== undefined) {
        entry.healOnHit = base.baseHealOnHit * x3Mult;
        entry.description = `Heals you a little every time it hits a mob.`;
      }

      if (base.bleedTickFraction !== undefined) {
        entry.bleedTickFraction = base.bleedTickFraction; // flat across tiers for now, per instruction
        entry.bleedTickInterval = base.bleedTickInterval;
        entry.bleedDuration     = base.bleedDuration;
        const ticks = Math.round(base.bleedDuration / base.bleedTickInterval);
        entry.description = `On hit, applies a bleed: ${Math.round(base.bleedTickFraction*100)}% of the hit's damage every ${(base.bleedTickInterval/1000).toFixed(2)}s for ${(base.bleedDuration/1000).toFixed(0)}s (${ticks} ticks).`;
      }

      if (base.knockbackOnHit) {
        entry.knockbackOnHit      = true;
        entry.knockbackStrength   = base.baseKnockbackStrength * x3Mult;
        entry.description = base.baseHp >= 40
          ? `Slow and heavy-hitting. Every hit shoves the mob back — bigger, heavier mobs resist more.`
          : `Hits with a knockback force strong enough to push back even sturdy mobs — heavier mobs resist more.`;
      }

      if (base.explosionRadius !== undefined) {
        entry.explosionRadius = base.explosionRadius; // flat across tiers for now, per instruction
        entry.description = `On hit, explodes for the same damage against every other mob within ${base.explosionRadius} units of the impact.`
          + (base.bleedTickFraction !== undefined ? ` Also applies a bleed to the mob it hit directly.` : '')
          + (base.poisonTickFraction !== undefined ? ` Also poisons the mob it hit directly.` : '');
      }

      if (base.poisonTickFraction !== undefined) {
        // Poison scales with the HIT's own damage, not a flat per-tier
        // number — poisonDps is resolved at hit time in combat.js (it needs
        // the actual damage dealt, which this generation pass doesn't have).
        // These three just carry the recipe through to that call site.
        entry.poisonTickFraction = base.poisonTickFraction;
        entry.poisonTickWindowMs = base.poisonTickWindowMs;
        entry.poisonDuration     = base.poisonDuration;
      }

      if (base.isBloodGrowth) {
        entry.isBloodGrowth        = true;
        entry.bloodResetOnDeath    = !!base.bloodResetOnDeath;
        entry.bloodGrowthRatePerSec = base.bloodGrowthRatePerSec; // flat across tiers for now, per instruction
        entry.bloodGrowthCapSec     = base.bloodGrowthCapSec;     // flat across tiers for now, per instruction
        const growPct = Math.round(base.bloodGrowthRatePerSec * 1000) / 10;
        const capSec  = base.bloodGrowthCapSec;
        const resetOn = base.bloodResetOnDeath ? 'it breaks' : 'unequipped or moved to another slot';
        if (base.baseSelfDamageOnHit !== undefined) {
          entry.selfDamageOnHit = base.baseSelfDamageOnHit * x3Mult;
          entry.description = `Damage grows ${growPct}%/s (caps at ${capSec}s). Every hit also damages YOU for a self-damage amount that grows on the same curve. Resets when ${resetOn}.`;
        }
        if (base.basePassiveDamage !== undefined) {
          entry.passiveDamage = base.basePassiveDamage * x3Mult;
          entry.description = `Damage grows ${growPct}%/s (caps at ${capSec}s). Passively damages YOU instead of healing, at a rate that grows on the same curve. Resets when ${resetOn}.`;
        }
        if (base.baseOnHitDamage !== undefined) {
          entry.onHitDamage = base.baseOnHitDamage * x3Mult;
          entry.description = `Damage grows ${growPct}%/s (caps at ${capSec}s). Each hit also deals a bonus damage tick that grows on its own curve. Resets when ${resetOn}.`;
        }
      }

      if (base.isAccessory)
        entry.isAccessory = true;

      if (base.isMissilePetal) {
        entry.isMissilePetal = true;
        entry.description = `After reloading, waits 0.5s then fires a phasing stinger dealing ${entry.damage} damage to every mob it passes through. Despawns after 3.5s.`;
      }

      if (base.baseFlatPickupBonus !== undefined) {
        const bonus = base.baseFlatPickupBonus + base.flatPickupBonusPerTier * tier;
        entry.flatPickupBonus = bonus;
        entry.description = `A magnetic petal. Increases drop pickup range by +${bonus} while equipped.`;
      }

      if (base.baseSizeBonus !== undefined) {
        const bonus = base.baseSizeBonus + base.sizeBonusPerTier * tier;
        entry.sizeBonus = bonus;
        entry.description = `Does nothing else — just makes you +${Math.round(bonus * 100)}% bigger while equipped.`;
      }

      if (base.isCoralChain) {
        entry.isCoralChain    = true;
        entry.coralSplitDelay = base.coralSplitDelay;
        entry.cooldownText    = `${(base.reloadTime / 1000).toFixed(1)}s (after the full chain breaks)`;
        entry.description     = `Splits into 2 when it breaks, then 3, then 4, then 5 — each generation replacing the last. Reloads ${(base.reloadTime/1000).toFixed(1)}s after the final piece breaks.`;
      }

      if (base.isChainLightning) {
        entry.isChainLightning = true;
        entry.chainCap = base.chainCapBase + Math.floor(tier / 2) * base.chainCapPerTwoTiers;
        entry.description = `On hit, arcs to ${entry.chainCap} mob${entry.chainCap===1?'':'s'} total (same chain as a jellyfish's zap).`;
      }

      if (base.isBubbleBoost) {
        entry.isBubbleBoost   = true;
        entry.boostStrength   = base.baseBoostStrength + base.boostStrengthPerTier * tier;
        entry.description     = `While defending, pushes you away from wherever this petal currently sits on the ring, then pops. Deals no contact damage. Multiple Bubbles stack.`;
      }

      if (base.isSaltReflect) {
        entry.isSaltReflect  = true;
        entry.reflectPercent = base.saltReflectByTier[tier];
        entry.description    = `Reflects ${base.saltReflectByTier[tier]}% of the damage a mob deals you back onto that mob. Stacks with other Salts, up to 200% total.`;
      }

      if (base.isSpongeAbsorb) {
        entry.isSpongeAbsorb = true;
        entry.spongeWindowMs = base.spongeWindowMs; // flat across tiers for now, per instruction
        entry.description    = `While active, all incoming damage is redirected into a shared pool and drained smoothly over ${(base.spongeWindowMs/1000).toFixed(0)}s instead of landing all at once. New damage merges into the pool and resets the window.`;
      }

      if (base.baseWalkSpeedBonus !== undefined) {
        const bonus = base.baseWalkSpeedBonus * Math.pow(base.walkSpeedBonusMultiplier ?? 1.5, tier);
        entry.walkSpeedBonus = bonus;
        entry.description = baseId === 'powder'
          ? `A pinch of fine powder underfoot. Grants +${bonus.toFixed(1)} flat walk speed when equipped.`
          : `Legs from the centipede. Grants +${bonus.toFixed(1)} flat walk speed when equipped.`;
      }

      if (base.baseExpandBonus !== undefined) {
        const bonus = base.expandBonusByTier
          ? (base.expandBonusByTier[tier] ?? base.expandBonusByTier[base.expandBonusByTier.length - 1])
          : Math.round(base.baseExpandBonus * Math.pow(base.expandBonusMultiplier ?? 3, tier));
        entry.expandBonus = bonus;
        entry.description = bonus > 0
          ? `A mysterious eye. Increases expansion radius by +${bonus} when equipped.`
          : `A mysterious eye. Unlocks expansion radius bonus at Mythic rarity.`;
      }

      if (base.visionBonusByTier !== undefined) {
        const bonus = base.visionBonusByTier[tier] ?? base.visionBonusByTier[base.visionBonusByTier.length - 1];
        entry.visionBonus = bonus;
        entry.description = `Antennae from a hornet. Increases vision range by +${Math.round(bonus * 100)}% when equipped.`;
      }

      if (base.honeycombHpByTier !== undefined) {
        const hcHp       = base.honeycombHpByTier[tier] ?? base.honeycombHpByTier[base.honeycombHpByTier.length - 1];
        const hcRange    = base.attractRangeByTier[tier] ?? base.attractRangeByTier[base.attractRangeByTier.length - 1];
        const maxRarity  = RARITIES[Math.min(tier + 1, RARITIES.length - 1)];
        entry.maxHp         = hcHp;
        entry.damage        = 0;
        entry.isHoneycomb   = true;
        entry.attractRange  = hcRange;
        entry.honeycombHp   = hcHp;
        entry.description   = `Drop on the ground to lure mobs up to ${maxRarity} rarity within ${hcRange} range. Survives ${(hcHp).toLocaleString()} damage or 10 seconds.`;
      }

      if (base.baseLuckBonus !== undefined) {
        const bonus = base.baseLuckBonus + base.luckBonusPerTier * tier;
        entry.luckBonus = bonus;
        entry.description = `A lucky clover. Adds +${(bonus * 100).toFixed(1)}% boss spawn luck per night while in hotbar.`;
      }

      if (base.baseDamageBlock !== undefined) {
        const block = Math.min(0.75, base.baseDamageBlock + base.damageBlockPerTier * tier);
        entry.damageBlock = block;
        // Radiant (tier 8)+ disc also grants armor
        let discDesc = `A spinning disc. Blocks ${Math.round(block * 100)}% of incoming damage per hit. Adds a black saw outline.`;
        if (base.discBaseArmor !== undefined && tier >= 8) {
          const discArmor = Math.round(base.discBaseArmor * Math.pow(base.discArmorMultiplier ?? 2.5, tier - 8));
          entry.armor = discArmor;
          discDesc += ` Grants +${discArmor.toLocaleString()} armor.`;
        }
        entry.description = discDesc;
      }

      if (base.baseBodyDamage !== undefined) {
        const bodyDmg = Math.round(base.baseBodyDamage * Math.pow(base.bodyDamageMultiplier ?? 3, tier));
        entry.bodyDamage = bodyDmg;
        entry.description = `A saw blade attached to you. Adds +${bodyDmg} body damage on contact with enemies.`;
      }

      if (base.baseMaxHpBonus !== undefined) {
        const bonus = Math.round(base.baseMaxHpBonus * Math.pow(base.maxHpBonusMultiplier ?? 3, tier));
        entry.maxHpBonus = bonus;
        entry.description = `A clump of rich earth. Adds +${bonus} max HP while equipped.`;
      }

      out[id] = entry;
    }
  }
  return out;
}

const STATIC_PETALS = {
  honey: {
    id: 'honey', name: 'Honey', rarity: 'Common', spriteIndex: 21,
    color: '#F9D71C', border: '#C8A51D',
    radius: 9, hitboxX: 0, hitboxY: 0, maxHp: 10, damage: 8, reloadTime: 2000,
    description: 'A hexagon of honey. Slows enemies on contact.',
  },
};
export const PETAL_TYPES = {
  ...generateScaledVariants(),
  ...STATIC_PETALS,
};

// Expose globally so bossManager can read clover luckBonus without circular import
window.__PETAL_TYPES = PETAL_TYPES;

/** All typeIds for scalable petals at every rarity tier (for inventory init). */
export const SCALABLE_PETAL_IDS = Object.keys(SCALABLE_BASES).flatMap(baseId =>
  RARITIES.map((_, tier) => scaledId(baseId, tier)),
);