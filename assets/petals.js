/**
 * petals.js — Orbit logic, petal instances, hotbar array.
 */
import {
  ORBIT_RADIUS_NORMAL,
  ORBIT_RADIUS_EXPANDED,
  ORBIT_RADIUS_RETRACT,
  ORBIT_EXPAND_SPEED,
  ORBIT_SPEED,
  MAX_HOTBAR_SLOTS,
  PLAYER_RADIUS,
} from './constants.js';
import { PETAL_TYPES }  from './petalTypes.js';
import { RARITIES }    from './constants.js';
import { inputState }   from './inputState.js';
import { wingState }    from './wingState.js';
import { spawnWebField, honeycombEntities } from './drops.js';
import { mobs, spawnFriendlyAntPet, spawnFriendlyBeePet, spawnFriendlyDiggerPet, spawnFriendlyBeetlePet, spawnFriendlySandstormPet, spawnFriendlyJellyfishPet } from './mobs.js';
import { player } from './player.js';

// ── Orbit state ──────────────────────────────────────────────────────────────
export let orbitAngle    = 0;
export let currentOrbitR = ORBIT_RADIUS_NORMAL;
let targetOrbitR         = ORBIT_RADIUS_NORMAL;

// ── Hotbar ────────────────────────────────────────────────────────────────────
// null = empty slot. Player starts with 5 common basic petals equipped.
export const hotbar = Array.from(
  { length: MAX_HOTBAR_SLOTS },
  (_, i) => (i < 5 ? 'basic' : null), // 5 common basics
);

// ── Bench row ─────────────────────────────────────────────────────────────────
// Second row of slots — inactive (not orbiting). Swapping moves to hotbar.
export const benchBar = Array.from({ length: MAX_HOTBAR_SLOTS }, () => null);

// ── Petal instances ───────────────────────────────────────────────────────────
export const petalInstances = [];

/**
 * Grow hotbar and benchBar to `n` slots.  Never shrinks (existing petals
 * are never removed).  Called from addXp() whenever a level-up grants a new slot.
 */
export function setHotbarSlots(n) {
  while (hotbar.length   < n) hotbar.push(null);
  while (benchBar.length < n) benchBar.push(null);
}

// playerMissiles removed — missile petals now fly as the petal entity itself.

/**
 * Returns a single petal object, OR an array of piece-petal objects for
 * multi-piece types (any petal whose type has a .pieces array).
 * Each piece is fully independent: own hp, state, reloadTimer.
 */
export function makePetal(slotIdx, typeId) {
  const t = PETAL_TYPES[typeId];

  if (t.pieces) {
    // One petal instance per piece — each independently damageable / reloadable.
    return t.pieces.map((piece, pieceIdx) => {
      const p = {
        slotIdx,
        typeId,
        pieceIdx,
        isPiece:    true,
        noExpand:   !!t.noExpand,
        hp:         t.maxHp,
        maxHp:      t.maxHp,
        damage:     t.damage,
        radius:     piece.pr * t.radius,
        clusterDx:  piece.dx * t.radius,
        clusterDy:  piece.dy * t.radius,
        color:      t.color,
        border:     t.border,
        state:      'reloading',
        reloadTimer: t.reloadTime,
        worldX:     0,
        worldY:     0,
        spawnX:     null,
        spawnY:     null,
        spawnT:     0,
        hurtFlash:  0,
      };
      // Stinger pieces: store fixed angle so renderer can rotate tip inward
      if (t.pieceShape === 'stinger' && piece.angle !== undefined) {
        p.pieceAngle = piece.angle;
      }
      // Ant egg pieces: each tracks its own hatching state and linked pet
      if (t.isAntEgg) {
        p.antEggState = 'hatch_wait';
        p.hatchTimer  = t.hatchTime;
        p.linkedPetId = null;
      }
      return p;
    });
  }

  // Standard single-body petal
  const inst = {
    slotIdx,
    typeId,
    noExpand:      !!t.noExpand,
    hp:            t.maxHp,
    maxHp:         t.maxHp,
    damage:        t.damage,
    radius:        t.radius,
    hitboxOffsetX: t.hitboxX ?? 0,
    hitboxOffsetY: t.hitboxY ?? 0,
    color:         t.color,
    border:        t.border,
    state:         'reloading',
    reloadTimer:   t.reloadTime,
    worldX:        0,
    worldY:        0,
    spawnX:        null,
    spawnY:        null,
    spawnT:        0,
    hurtFlash:     0,
  };

  // Rose-specific state fields — start in spawn_wait so it checks HP on first cycle.
  // Shell reuses this exact same approach/wait/deliver state machine — it just
  // delivers shield instead of a heal at the end (see combat.js's rose block).
  if (t.healAmount !== undefined || t.shieldAmount !== undefined) {
    inst.roseState  = 'spawn_wait';
    inst.roseTimer  = 500;
    inst.roseStartX = 0;
    inst.roseStartY = 0;
  }

  // Pollen petal — start in pre_drop: wait 0.5s before becoming ready to fire
  if (t.dropsPollen) {
    inst.pollenState    = 'pre_drop';
    inst.pollenTimer    = 500;
    inst.pollenEntityId = null;
  }

  // Ink — same pre_drop/ready shape as pollen: waits 0.5s after (re)loading,
  // then drops (as its own live pool) the moment attack/defend is held.
  // Unlike pollen it doesn't fire repeatedly while held — one press places
  // one pool — so 'ready' just watches for the key press once.
  if (t.isInkPool) {
    inst.inkState = 'pre_drop';
    inst.inkTimer = 500;
  }

  // Pearl (and future ground-guard petals) — same pre_drop wait, then drops
  // and STAYS dropped (locking this slot) until it's destroyed — no repeated
  // firing, no fresh replacement spawned. See combat.js's ground-guard block.
  if (t.isGroundGuard) {
    inst.guardState = 'pre_drop';
    inst.guardTimer = 500;
  }

  // Blood Corn / Blood Leaf / Blood Wing — starts counting up from 0 the
  // moment it's equipped; growth is derived from this timer wherever it's
  // used (see combat.js), so it's read, never itself scaled by tier here.
  if (t.isBloodGrowth) {
    inst.bloodGrowthTimer = 0;
  }

  // Coral — starts as a single generation-1 piece. Dying advances the whole
  // slot to the next generation (2, then 3, 4, 5) — see the dedicated
  // generation-tracking loop in combat.js, which spawns each new batch and
  // owns the final 5s reload once generation 5 dies out.
  if (t.isCoralChain) {
    inst.coralGeneration = 1;
    inst.coralSlotBase   = slotIdx;
  }

  // Bubble — its own independent boost cooldown, separate from the petal's
  // normal combat HP/reload cycle (see combat.js's defend-boost loop).
  if (t.isBubbleBoost) {
    inst.bubbleBoostTimer = 0;
  }

  // Missile petal — starts waiting to fire
  if (t.isMissilePetal) {
    inst.missileState = 'pre_fire';
    inst.missileTimer = 500;
  }

  // Honeycomb petal — starts waiting to be activated
  if (t.isHoneycomb) {
    inst.honeycombState    = 'pre_drop';
    inst.honeycombTimer    = 300;
    inst.honeycombEntityId = null;
  }

  // Bee egg — starts hatching immediately
  if (t.isBeeEgg) {
    inst.beeEggState = 'hatch_wait';
    inst.hatchTimer  = t.hatchTime;
    inst.linkedPetId = null;
  }

  // Beetle egg — starts hatching immediately (single pet, no piece-splitting like ant egg)
  if (t.isBeetleEgg) {
    inst.beetleEggState = 'hatch_wait';
    inst.hatchTimer     = t.hatchTime;
    inst.linkedPetId    = null;
  }

  // Stick — a permanent side petal. It reloads exactly once (the standard
  // reload above, using reloadTime), then never breaks again (invincible) and
  // just keeps spawning sandstorm pets on stickHatchInterval for as long as
  // it's equipped. There's no single linked pet — see the tick loop below,
  // which tracks every pet this instance has spawned so they can all be
  // despawned together if the petal is ever removed from the hotbar.
  if (t.isStick) {
    inst.stickTimer   = t.stickHatchInterval;
    inst.stickPetIds  = [];
  }

  // Digger egg — starts hatching immediately
  if (t.isDiggerEgg) {
    inst.diggerEggState = 'hatch_wait';
    inst.hatchTimer     = t.hatchTime;
    inst.linkedPetId    = null;
  }

  // Jellyfish egg — starts hatching immediately (single pet, same shape as digger egg)
  if (t.isJellyfishEgg) {
    inst.jellyfishEggState = 'hatch_wait';
    inst.hatchTimer        = t.hatchTime;
    inst.linkedPetId       = null;
  }

  return inst;
}

export function rebuildPetals() {
  // Save ALL state for slots that HAVEN'T changed — reload timers, hp, egg states, etc.
  // This ensures that adding/removing a different slot doesn't interrupt other petals.
  const savedStates = new Map(); // key: `${slotIdx}_${pieceIdx}` → full state snapshot
  const coralPieceCounts = new Map(); // slotIdx → how many Coral pieces existed before this rebuild

  for (const p of petalInstances) {
    // For pollen pieces, slotIdx is a float (e.g. 2.1) — use the base integer slot for hotbar lookup
    const baseSlot = p.pollenSlotBase ?? p.lightSlotBase ?? p.slotIdx;
    const newType = hotbar[baseSlot];
    if (newType === p.typeId) {
      // Same petal still in the same slot — save full state to restore after rebuild
      savedStates.set(`${p.slotIdx}_${p.pieceIdx ?? 0}`, {
        // Combat/reload state
        state:       p.state,
        reloadTimer: p.reloadTimer,
        hp:          p.hp,
        // Egg states
        antEggState:       p.antEggState,
        beeEggState:       p.beeEggState,
        diggerEggState:    p.diggerEggState,
        beetleEggState:    p.beetleEggState,
        jellyfishEggState: p.jellyfishEggState,
        linkedPetId:    p.linkedPetId,
        hatchTimer:     p.hatchTimer,
        // Stick: recurring timer + every pet it has spawned so far
        stickTimer:  p.stickTimer,
        stickPetIds: p.stickPetIds,
        // Ground-guard (Pearl): preserve its planted/returning state + position
        guardState:  p.guardState,
        guardTimer:  p.guardTimer,
        worldX:      p.worldX,
        worldY:      p.worldY,
        dropVx:      p.dropVx,
        dropVy:      p.dropVy,
        // Blood Corn / Blood Leaf / Blood Wing: growing-damage timer. Persists
        // across a same-slot rebuild (e.g. opening the inventory) — it only
        // resets when the type actually changes in this slot (unequip/swap,
        // handled naturally below since that discards this instance and
        // starts a fresh one) or, for Blood Corn specifically, when the
        // petal dies (handled explicitly in damagePetal).
        bloodGrowthTimer: p.bloodGrowthTimer,
        // Coral: full generation/cluster state so a same-slot rebuild
        // doesn't lose track of which generation this piece belongs to,
        // its cluster offset, or its dead/spawning progress.
        coralGeneration:  p.coralGeneration,
        coralSlotBase:    p.coralSlotBase,
        coralSpawnTimer:  p.coralSpawnTimer,
        clusterDx:        p.clusterDx,
        clusterDy:        p.clusterDy,
        // Bubble: independent boost cooldown, preserved across rebuilds
        bubbleBoostTimer: p.bubbleBoostTimer,
      });
      if (p.coralSlotBase !== undefined) {
        coralPieceCounts.set(p.coralSlotBase, (coralPieceCounts.get(p.coralSlotBase) || 0) + 1);
      }
    } else {
      // Slot changed or cleared — kill the orphaned pet if any
      if (p.linkedPetId != null) {
        const pet = mobs.find(m => m.id === p.linkedPetId && !m.dead);
        if (pet) pet.dead = true;
      }
      // Stick: unequipping despawns every sandstorm pet it spawned, not just one
      if (p.stickPetIds && p.stickPetIds.length) {
        for (const petId of p.stickPetIds) {
          const pet = mobs.find(m => m.id === petId && !m.dead);
          if (pet) pet.dead = true;
        }
      }
    }
  }

  petalInstances.length = 0;
  for (let i = 0; i < hotbar.length; i++) {
    if (hotbar[i] === null) continue;
    if (PETAL_TYPES[hotbar[i]]?.isAccessory) continue;
    const pt = PETAL_TYPES[hotbar[i]];
    if (pt?.dropsPollen && (pt.pollenCount ?? 1) > 1) {
      // Pollen: spawn one independent petal per piece, each with a unique virtual slotIdx
      const count = pt.pollenCount;
      for (let pi = 0; pi < count; pi++) {
        const inst = makePetal(i + pi * 0.1, hotbar[i]);
        inst.pollenPieceIdx  = pi;
        inst.pollenSlotBase  = i;
        petalInstances.push(inst);
      }
    } else if (pt?.isLight && pt.pieces && pt.pieces.length > 1) {
      // Light: each piece gets its own orbit slot, like pollen
      for (let pi = 0; pi < pt.pieces.length; pi++) {
        const piece = pt.pieces[pi];
        const inst = {
          slotIdx:     i + pi * 0.1,
          lightSlotBase: i,
          typeId:      hotbar[i],
          pieceIdx:    pi,
          isPiece:     true,
          noExpand:    false,
          hp:          pt.maxHp,
          maxHp:       pt.maxHp,
          damage:      pt.damage,
          radius:      piece.pr * pt.radius,
          clusterDx:   0,
          clusterDy:   0,
          color:       pt.color,
          border:      pt.border,
          state:       'reloading',
          reloadTimer: pt.reloadTime,
          worldX:      0,
          worldY:      0,
          spawnX:      null,
          spawnY:      null,
          spawnT:      0,
          hurtFlash:   0,
        };
        petalInstances.push(inst);
      }
    } else if (pt?.isCoralChain && (coralPieceCounts.get(i) || 1) > 1) {
      // Coral, mid-chain: recreate exactly as many pieces as existed before
      // this rebuild (2-5, whatever generation it was at) — a plain
      // makePetal() call would otherwise collapse it back to a single
      // generation-1 piece. Each piece's generation/cluster/dead-or-spawning
      // state is restored below via the normal savedStates pass, keyed by
      // its pieceIdx (0..count-1), same as any other same-slot restore.
      const count = coralPieceCounts.get(i);
      for (let pi = 0; pi < count; pi++) {
        const inst = makePetal(i, hotbar[i]);
        inst.pieceIdx = pi;
        petalInstances.push(inst);
      }
    } else {
      const result = makePetal(i, hotbar[i]);
      if (Array.isArray(result)) petalInstances.push(...result);
      else                       petalInstances.push(result);
    }
  }

  // Restore full state for slots that didn't change
  for (const p of petalInstances) {
    const saved = savedStates.get(`${p.slotIdx}_${p.pieceIdx ?? 0}`);
    if (saved) {
      // Restore reload/combat state so petals don't restart their timers
      if (saved.state       !== undefined) p.state       = saved.state;
      if (saved.reloadTimer !== undefined) p.reloadTimer = saved.reloadTimer;
      if (saved.hp          !== undefined) p.hp          = saved.hp;
      // Restore egg states
      if (saved.antEggState    !== undefined) p.antEggState    = saved.antEggState;
      if (saved.beeEggState    !== undefined) p.beeEggState    = saved.beeEggState;
      if (saved.diggerEggState !== undefined) p.diggerEggState = saved.diggerEggState;
      if (saved.jellyfishEggState !== undefined) p.jellyfishEggState = saved.jellyfishEggState;
      if (saved.beetleEggState !== undefined) p.beetleEggState = saved.beetleEggState;
      if (saved.linkedPetId    !== undefined) p.linkedPetId    = saved.linkedPetId;
      if (saved.hatchTimer     !== undefined) p.hatchTimer     = saved.hatchTimer;
      // Restore Stick's recurring timer + tracked pet list (same slot = keep spawning uninterrupted)
      if (saved.stickTimer     !== undefined) p.stickTimer     = saved.stickTimer;
      if (saved.stickPetIds    !== undefined) p.stickPetIds    = saved.stickPetIds;
      // Restore ground-guard (Pearl) planted/returning state + position so a
      // rebuild (e.g. opening the inventory) doesn't snap it back to orbit
      // or reset its bounce-return mid-flight.
      if (saved.guardState !== undefined && saved.guardState !== null) {
        p.guardState = saved.guardState;
        p.guardTimer = saved.guardTimer;
        p.worldX     = saved.worldX;
        p.worldY     = saved.worldY;
        p.dropVx     = saved.dropVx;
        p.dropVy     = saved.dropVy;
      }
      // Restore Blood Corn/Leaf/Wing's growth timer (same slot = keep growing uninterrupted)
      if (saved.bloodGrowthTimer !== undefined) p.bloodGrowthTimer = saved.bloodGrowthTimer;
      // Restore Coral's generation/cluster state
      if (saved.coralGeneration !== undefined) {
        p.coralGeneration = saved.coralGeneration;
        p.coralSlotBase   = saved.coralSlotBase;
        p.coralSpawnTimer = saved.coralSpawnTimer;
        p.clusterDx       = saved.clusterDx;
        p.clusterDy       = saved.clusterDy;
      }
      // Restore Bubble's independent boost cooldown
      if (saved.bubbleBoostTimer !== undefined) p.bubbleBoostTimer = saved.bubbleBoostTimer;
    }
  }
}
rebuildPetals();

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Instantly restore all petals to full HP and reset reload timers to zero.
 * Called when the player enters the boss ant hole sub-map.
 */
export function refreshAllPetals() {
  for (const p of petalInstances) {
    p.reloadTimer = 0;
    p.hp          = p.maxHp;
    // If the petal was dead/reloading, bring it back to orbit
    if (p.state === 'dead' || p.state === 'reloading' || p.state === 'dropped') {
      p.state = 'active';
      p.pollenState = undefined;
    }
  }
}

export function damagePetal(petal, amount) {
  const _dpt = PETAL_TYPES[petal.typeId];
  // Ground-guard petals (Pearl) can be damaged while planted ('dropped') —
  // that's the whole point, it locks the slot until something kills it.
  // Every other dropped state (pollen, ink) stays untouchable, same as before.
  const guardablyDropped = _dpt?.isGroundGuard && petal.state === 'dropped';
  if (petal.state !== 'active' && !guardablyDropped) return;
  if (_dpt?.invincible) return; // Stick: permanent side petal, never takes damage or breaks
  petal.hp -= amount;
  if (amount > 0 && 'hurtFlash' in petal) petal.hurtFlash = 120; // quick red flash when hit
  if (petal.hp <= 0) {
    petal.hp = 0;

    // Coral: this piece just goes 'dead' and sits inert — it does NOT solo
    // reload. A dedicated loop in combat.js watches for every piece sharing
    // this coralSlotBase going dead at once, and only then spawns the next
    // generation (or, past generation 5, starts the real reload). See that
    // loop for the rest of the chain.
    if (_dpt?.isCoralChain) {
      petal.state = 'dead';
      return;
    }

    petal.state       = 'reloading';
    petal.reloadTimer = PETAL_TYPES[petal.typeId].reloadTime;
    // Clear rose state when it goes to reloading
    if (petal.roseState !== undefined) petal.roseState = null;
    // Clear missile state when it goes to reloading
    if (petal.missileState !== undefined) petal.missileState = null;
    // Clear pollen state when it goes to reloading
    if (petal.pollenState !== undefined) petal.pollenState = null;
    // Clear honeycomb state when it goes to reloading
    if (petal.honeycombState !== undefined) { petal.honeycombState = null; }
    // Clear ground-guard state when it goes to reloading (Pearl was destroyed
    // while planted — this is the only way its slot unlocks)
    if (petal.guardState !== undefined) { petal.guardState = null; }
    // Blood Corn resets its growth timer specifically on death (breaking and
    // reloading) — Blood Leaf/Wing do NOT reset here, only on unequip/swap
    // (which happens naturally via a fresh instance — see rebuildPetals).
    if (petal.bloodGrowthTimer !== undefined && PETAL_TYPES[petal.typeId]?.bloodResetOnDeath) {
      petal.bloodGrowthTimer = 0;
    }
    // Ant egg piece: preserve linkedPetId so we know if a pet is still alive;
    // just clear the state flag — the pet survives pellet destruction.
    if (petal.antEggState !== undefined) { petal.antEggState = null; }
    if (petal.beeEggState !== undefined) { petal.beeEggState = null; }
    if (petal.diggerEggState !== undefined) { petal.diggerEggState = null; }
    if (petal.beetleEggState !== undefined) { petal.beetleEggState = null; }
    if (petal.jellyfishEggState !== undefined) { petal.jellyfishEggState = null; }
    
    // Web petal: spawn web field when destroyed (all rarity tiers)
    const _wpt = PETAL_TYPES[petal.typeId];
    if (_wpt?.slowFactor !== undefined) {
      // Derive tier from the petal type's rarity (0 = Common, 1 = Uncommon, …)
      const webTier = Math.max(0, RARITIES.indexOf(_wpt.rarity));
      spawnWebField(petal.worldX, petal.worldY, webTier, null, _wpt.slowFactor);
    }
  }
}


// ── Update ────────────────────────────────────────────────────────────────────
export function updatePetals(dt, originX, originY) {
  // Orbit radius
  if (inputState.retract)     targetOrbitR = ORBIT_RADIUS_RETRACT;
  else if (inputState.expand) {
    // Check for third_eye expandBonus from equipped accessories
    let expandBonus = 0;
    for (const typeId of hotbar) {
      if (!typeId) continue;
      const pt = PETAL_TYPES[typeId];
      if (pt?.expandBonus) expandBonus += pt.expandBonus;
    }
    targetOrbitR = ORBIT_RADIUS_EXPANDED + expandBonus;
  }
  else                        targetOrbitR = ORBIT_RADIUS_NORMAL;
  currentOrbitR += (targetOrbitR - currentOrbitR) * ORBIT_EXPAND_SPEED;

  // Sum spin bonus from all EQUIPPED petals that have one (faster petal variants) —
  // this buffs rotation speed passively just by being on the hotbar, same as its
  // damage bonus applies whenever it's the active petal; reloading shouldn't
  // disable it, since it's a hotbar-wide speed buff, not a per-hit effect.
  let fasterBoost = 0;
  for (const p of petalInstances) {
    if (p.state === 'active' || p.state === 'reloading') {
      const sb = PETAL_TYPES[p.typeId]?.spinBonus;
      if (sb) fasterBoost += sb;
    }
  }
  orbitAngle += ORBIT_SPEED + fasterBoost;

  // Determine unique slot order for orbit spacing.
  // ALL occupied hotbar slots are counted — even reloading ones — so the gap
  // stays in the ring while a petal is on cooldown.
  // Only flying/dropped petals (detached from orbit) are excluded from the count.
  const seen = new Set();
  const uniqueSlots = [];
  for (const p of petalInstances) {
    if (!seen.has(p.slotIdx)) { seen.add(p.slotIdx); uniqueSlots.push(p.slotIdx); }
  }
  const n = uniqueSlots.length;

  // Update wing pulse state
  const WING_ATTACK_K = 0.012;
  const wingTarget = inputState.expand ? 1 : 0;
  wingState.attackT += (wingTarget - wingState.attackT) * (1 - Math.pow(1 - WING_ATTACK_K, dt));
  if (inputState.expand) wingState.pulseT += dt;

  const WING_EXTRA_R   = 84;
  const wingPulseOffset = wingState.attackT * Math.abs(Math.sin(wingState.pulseT * 0.002)) * WING_EXTRA_R;

  const SPAWN_ANIM_MS = 350;

  if (n > 0) {
    for (const p of petalInstances) {
      // Roses in approaching/waiting handle their own position in combat.js
      if (p.roseState === 'approaching' || p.roseState === 'waiting') continue;

      // Flying/dropped petals move independently — skip orbit positioning
      if (p.state === 'flying' || p.state === 'dropped' || p.state === 'dead' || p.state === 'spawning') continue;

      const slotOrder = uniqueSlots.indexOf(p.slotIdx);
      const angle  = orbitAngle + (Math.PI * 2 / n) * slotOrder;
      const r      = p.noExpand ? ORBIT_RADIUS_NORMAL : currentOrbitR;
      const orbitX = originX + Math.cos(angle) * r;
      const orbitY = originY + Math.sin(angle) * r;
      const targetX = orbitX + (p.clusterDx ?? 0) + (p.hitboxOffsetX ?? 0);
      const targetY = orbitY + (p.clusterDy ?? 0) + (p.hitboxOffsetY ?? 0);

      // Spawn animation
      if (p.spawnX !== null) {
        p.spawnT += dt;
        const t    = Math.min(p.spawnT / SPAWN_ANIM_MS, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        p.worldX = p.spawnX + (targetX - p.spawnX) * ease;
        p.worldY = p.spawnY + (targetY - p.spawnY) * ease;
        if (t >= 1) { p.spawnX = null; p.spawnY = null; }
      } else {
        p.worldX = targetX;
        p.worldY = targetY;
      }

      // Wing pulse: push hitbox outward during attack
      if (PETAL_TYPES[p.typeId]?.isWing && p.state === 'active') {
        p.worldX += Math.cos(angle) * wingPulseOffset;
        p.worldY += Math.sin(angle) * wingPulseOffset;
      }
    }
  }

  // Reload timers
  for (const p of petalInstances) {
    if (p.state === 'reloading') {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        p.state = 'active';
        p.hp    = p.maxHp;
        const pt_rl = PETAL_TYPES[p.typeId];

        if (pt_rl?.isMissilePetal) {
          // Missile petal: enter pre_fire wait — no spawn animation
          p.missileState = 'pre_fire';
          p.missileTimer = 500;
        } else if (pt_rl?.dropsPollen) {
          // Pollen petal: re-enter pre_drop wait; spawn animation plays as normal
          p.pollenState    = 'pre_drop';
          p.pollenTimer    = 500;
          p.pollenEntityId = null;
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isInkPool) {
          // Ink: re-enter pre_drop wait; spawn animation plays as normal
          p.inkState = 'pre_drop';
          p.inkTimer = 500;
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isGroundGuard) {
          // Pearl: re-enter pre_drop wait; spawn animation plays as normal.
          // Reaching 'reloading' here only happens after the placed guard
          // was destroyed (see the ground-guard block in combat.js) — a
          // fresh cycle starts clean, same as every other petal.
          p.guardState = 'pre_drop';
          p.guardTimer = 500;
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.healAmount !== undefined || pt_rl?.shieldAmount !== undefined) {
          // Rose: enter spawn_wait, check HP after 0.5s — play spawn animation
          // (Shell reuses this same path — see combat.js's rose block)
          p.roseState = 'spawn_wait';
          p.roseTimer = 500;
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isHoneycomb) {
          // Honeycomb: re-enter pre_drop, play spawn animation
          p.honeycombState    = 'pre_drop';
          p.honeycombTimer    = 300;
          p.honeycombEntityId = null;
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isAntEgg) {
          // Ant egg piece: check if its linked pet is still alive
          const petAlive = p.linkedPetId !== null &&
            mobs.some(m => m.id === p.linkedPetId && !m.dead);
          if (petAlive) {
            // Pet survived — re-link, no new hatch needed
            p.antEggState = 'linked';
          } else {
            // No living pet — start hatch countdown
            p.linkedPetId = null;
            p.antEggState = 'hatch_wait';
            p.hatchTimer  = pt_rl.hatchTime;
          }
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isBeeEgg) {
          // Bee egg: check if its linked pet is still alive
          const petAlive = p.linkedPetId !== null &&
            mobs.some(m => m.id === p.linkedPetId && !m.dead);
          if (petAlive) {
            p.beeEggState = 'linked';
          } else {
            p.linkedPetId = null;
            p.beeEggState = 'hatch_wait';
            p.hatchTimer  = pt_rl.hatchTime;
          }
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isBeetleEgg) {
          // Beetle egg: check if its linked pet is still alive
          const petAlive = p.linkedPetId !== null &&
            mobs.some(m => m.id === p.linkedPetId && !m.dead);
          if (petAlive) {
            p.beetleEggState = 'linked';
          } else {
            p.linkedPetId    = null;
            p.beetleEggState = 'hatch_wait';
            p.hatchTimer     = pt_rl.hatchTime;
          }
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isStick) {
          // Stick shouldn't normally reach this path again after its one-time
          // initial reload (it's invincible, so damagePetal can't re-trigger
          // reloading) — but if it ever does, re-init cleanly rather than
          // leaving stale state.
          p.stickTimer  = pt_rl.stickHatchInterval;
          p.stickPetIds = p.stickPetIds ?? [];
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isDiggerEgg) {
          // Digger egg: check if its linked pet is still alive
          const petAlive = p.linkedPetId !== null &&
            mobs.some(m => m.id === p.linkedPetId && !m.dead);
          if (petAlive) {
            p.diggerEggState = 'linked';
          } else {
            p.linkedPetId    = null;
            p.diggerEggState = 'hatch_wait';
            p.hatchTimer     = pt_rl.hatchTime;
          }
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else if (pt_rl?.isJellyfishEgg) {
          // Jellyfish egg: check if its linked pet is still alive
          const petAlive = p.linkedPetId !== null &&
            mobs.some(m => m.id === p.linkedPetId && !m.dead);
          if (petAlive) {
            p.jellyfishEggState = 'linked';
          } else {
            p.linkedPetId       = null;
            p.jellyfishEggState = 'hatch_wait';
            p.hatchTimer        = pt_rl.hatchTime;
          }
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        } else {
          // Normal petal spawn animation
          const spawnAngle = Math.random() * Math.PI * 2;
          p.spawnX = originX + Math.cos(spawnAngle) * PLAYER_RADIUS;
          p.spawnY = originY + Math.sin(spawnAngle) * PLAYER_RADIUS;
          p.spawnT = 0;
        }
      }
    }
  }

  // ── Pre-fire timer for missile petals (counts down while orbiting) ──────────
  for (const p of petalInstances) {
    if (p.state === 'active' && p.missileState === 'pre_fire') {
      p.missileTimer -= dt;
    }
  }

  // ── Ant egg hatch timer + pet-death detection ────────────────────────────────
  for (const p of petalInstances) {
    if (p.antEggState === undefined || p.state !== 'active') continue;

    if (p.antEggState === 'hatch_wait') {
      p.hatchTimer -= dt;
      if (p.hatchTimer <= 0) {
        // Spawn the friendly ant pet at this piece's world position
        const pt = PETAL_TYPES[p.typeId];
        const pet = spawnFriendlyAntPet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx);
        if (pet) {
          p.linkedPetId = pet.id;
          p.antEggState = 'linked';
        } else {
          // Spawn failed (rare) — retry after 500 ms instead of spamming every frame
          p.hatchTimer = 500;
        }
      }
    } else if (p.antEggState === 'linked') {
      // Check if our pet died
      const petAlive = mobs.some(m => m.id === p.linkedPetId && !m.dead);
      if (!petAlive) {
        // Pet died — destroy this piece and start the reload cycle
        p.linkedPetId = null;
        p.antEggState = null;
        p.hp          = 0;
        p.state       = 'reloading';
        p.reloadTimer = PETAL_TYPES[p.typeId].reloadTime;
      }
    }
  }

  // ── Bee egg hatch timer + pet-death detection ─────────────────────────────
  for (const p of petalInstances) {
    if (p.beeEggState === undefined || p.state !== 'active') continue;

    if (p.beeEggState === 'hatch_wait') {
      p.hatchTimer -= dt;
      if (p.hatchTimer <= 0) {
        const pt = PETAL_TYPES[p.typeId];
        const pet = spawnFriendlyBeePet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx ?? 0);
        if (pet) {
          p.linkedPetId = pet.id;
          p.beeEggState = 'linked';
        } else {
          p.hatchTimer = 500;
        }
      }
    } else if (p.beeEggState === 'linked') {
      const petAlive = mobs.some(m => m.id === p.linkedPetId && !m.dead);
      if (!petAlive) {
        p.linkedPetId = null;
        p.beeEggState = null;
        p.hp          = 0;
        p.state       = 'reloading';
        p.reloadTimer = PETAL_TYPES[p.typeId].reloadTime;
      }
    }
  }

  // ── Beetle egg hatch timer + pet-death detection ──────────────────────────
  // Same shape as the bee egg loop above — always hatches exactly one beetle pet.
  for (const p of petalInstances) {
    if (p.beetleEggState === undefined || p.state !== 'active') continue;

    if (p.beetleEggState === 'hatch_wait') {
      p.hatchTimer -= dt;
      if (p.hatchTimer <= 0) {
        const pt = PETAL_TYPES[p.typeId];
        const pet = spawnFriendlyBeetlePet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx ?? 0);
        if (pet) {
          p.linkedPetId    = pet.id;
          p.beetleEggState = 'linked';
        } else {
          p.hatchTimer = 500;
        }
      }
    } else if (p.beetleEggState === 'linked') {
      const petAlive = mobs.some(m => m.id === p.linkedPetId && !m.dead);
      if (!petAlive) {
        p.linkedPetId    = null;
        p.beetleEggState = null;
        p.hp             = 0;
        p.state          = 'reloading';
        p.reloadTimer    = PETAL_TYPES[p.typeId].reloadTime;
      }
    }
  }

  // ── Stick recurring spawn timer ────────────────────────────────────────────
  // Once past its one-time initial reload, Stick stays permanently active
  // (it's invincible, so nothing can knock it back into reloading) and just
  // keeps trying to spawn another sandstorm pet every stickHatchInterval, up
  // to a cap of 3 pets PER Stick (equip multiple Sticks to get more, up to
  // the overall 9-pet safety ceiling enforced in spawnFriendlySandstormPet).
  // Every pet a Stick spawns is tracked in its own stickPetIds so they can all
  // be despawned together if that instance is ever removed from the hotbar
  // (see the cleanup pass in rebuildPetals).
  const STICK_MAX_SANDSTORM_PETS_PER_STICK = 3;
  for (const p of petalInstances) {
    if (p.stickTimer === undefined || p.state !== 'active') continue;

    p.stickTimer -= dt;
    if (p.stickTimer <= 0) {
      const pt = PETAL_TYPES[p.typeId];
      // Drop any ids that have since died, so the tracked list stays accurate
      p.stickPetIds = (p.stickPetIds ?? []).filter(id => mobs.some(m => m.id === id && !m.dead));
      if (p.stickPetIds.length >= STICK_MAX_SANDSTORM_PETS_PER_STICK) {
        // This Stick is already at its own 3-pet cap — poll again shortly
        // rather than waiting out a full cycle, so it fills the instant one
        // of ITS pets dies (doesn't touch other Sticks' pets/slots).
        p.stickTimer = 500;
        continue;
      }
      const pet = spawnFriendlySandstormPet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx ?? 0);
      if (pet) {
        p.stickPetIds.push(pet.id);
        p.stickTimer = pt.stickHatchInterval;
      } else {
        // Overall 9-pet safety ceiling reached (across every Stick) — poll
        // again shortly rather than waiting out a full cycle.
        p.stickTimer = 500;
      }
    }
  }


  // ── Digger egg hatch timer + pet-death detection ─────────────────────────────
  for (const p of petalInstances) {
    if (p.diggerEggState === undefined || p.state !== 'active') continue;

    if (p.diggerEggState === 'hatch_wait') {
      p.hatchTimer -= dt;
      if (p.hatchTimer <= 0) {
        const pt = PETAL_TYPES[p.typeId];
        const pet = spawnFriendlyDiggerPet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx ?? 0, player.color);
        if (pet) {
          p.linkedPetId    = pet.id;
          p.diggerEggState = 'linked';
        } else {
          p.hatchTimer = 500;
        }
      }
    } else if (p.diggerEggState === 'linked') {
      const petAlive = mobs.some(m => m.id === p.linkedPetId && !m.dead);
      if (!petAlive) {
        p.linkedPetId    = null;
        p.diggerEggState = null;
        p.hp             = 0;
        p.state          = 'reloading';
        p.reloadTimer    = PETAL_TYPES[p.typeId].reloadTime;
      }
    }
  }

  // ── Jellyfish egg hatch timer + pet-death detection ───────────────────────
  // Same shape as the digger egg loop above — always hatches exactly one
  // jellyfish pet, which fights via its own lightning-chain AI (see combat.js).
  for (const p of petalInstances) {
    if (p.jellyfishEggState === undefined || p.state !== 'active') continue;

    if (p.jellyfishEggState === 'hatch_wait') {
      p.hatchTimer -= dt;
      if (p.hatchTimer <= 0) {
        const pt = PETAL_TYPES[p.typeId];
        const pet = spawnFriendlyJellyfishPet(pt.tier ?? 0, p.worldX, p.worldY, p.slotIdx, p.pieceIdx ?? 0);
        if (pet) {
          p.linkedPetId       = pet.id;
          p.jellyfishEggState = 'linked';
        } else {
          p.hatchTimer = 500;
        }
      }
    } else if (p.jellyfishEggState === 'linked') {
      const petAlive = mobs.some(m => m.id === p.linkedPetId && !m.dead);
      if (!petAlive) {
        p.linkedPetId       = null;
        p.jellyfishEggState = null;
        p.hp                = 0;
        p.state             = 'reloading';
        p.reloadTimer       = PETAL_TYPES[p.typeId].reloadTime;
      }
    }
  }

  // ── Flying petal movement (peas pieces in flight) ────────────────────────
  // Note: missiles now spawn independent missileEntities and never enter 'flying' state.
  for (const p of petalInstances) {
    if (p.state !== 'flying') continue;
    p.worldX += p.vx;
    p.worldY += p.vy;
    p.flyLifetime -= dt;
    if (p.flyLifetime <= 0) {
      // Normal cooldown (peas and any other flying petals)
      p.state       = 'flying_done'; // temporary flag, resolved below
      p.hp          = 0;
      p.reloadTimer = PETAL_TYPES[p.typeId].reloadTime;
      p.hitMobIds   = null;
    }
  }
  // Resolve flying_done → reloading in a second pass (avoids mid-loop mutation issues)
  for (const p of petalInstances) {
    if (p.state === 'flying_done') p.state = 'reloading';
  }
}