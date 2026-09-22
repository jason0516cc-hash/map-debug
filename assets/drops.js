// World-space petal drops from mob deaths
export const worldDrops      = [];
export const webFields       = [];
export const pollenEntities  = [];
export const honeycombEntities = [];
export const missileEntities = [];
// Pincer's on-hit slow: a per-mob timed debuff (unlike Web's position-based
// ground hazard), tracked the same way poisonedMobs is in combat.js.
export const pincerSlowedMobs = new Map(); // mobId → { factor, timer }
let nextDropId    = 0;
let nextPollenId  = 0;
let nextHoneycombId = 0;
let nextMissileId = 0;

export const SPAWN_DUR = 320; // ms — how long the pop-in animation takes

export function spawnDrop(x, y, typeId) {
  worldDrops.push({
    id:           nextDropId++,
    x, y,
    typeId,
    size:         38,
    pickupRadius: 60,
    bobTimer:     Math.random() * Math.PI * 2,
    rotation:     (Math.random() - 0.5) * 0.7,
    ox: (Math.random() - 0.5) * 24,
    oy: (Math.random() - 0.5) * 24,
    spawnTimer:   0,   // counts up to SPAWN_DUR, drives pop-in
  });
}

// Web radius scales with petal tier — base = flower (orbit) radius, +15% per tier
const WEB_BASE_RADIUS  = 55;  // = ORBIT_RADIUS_NORMAL (flower size)
const WEB_BASE_TIMER   = 5000;

export function spawnWebField(x, y, tier = 0, overrideRadius = null, slowFactor = 0) {
  const tierScale = Math.pow(1.15, tier);     // tier 0 = 1×, tier 13 ≈ 7.27×
  const baseRadius = overrideRadius != null ? overrideRadius : WEB_BASE_RADIUS;
  const radius = Math.round(baseRadius * tierScale);
  const timer     = WEB_BASE_TIMER * (1 + tier * 0.12); // lasts longer at high tiers
  webFields.push({ x, y, radius, timer, maxTimer: timer, slowFactor });
}

export function spawnPollenEntity(x, y, hp, damage, radius) {
  const entity = {
    id:       nextPollenId++,
    x, y,
    vx: 0, vy: 0,   // massless — pushed by mobs
    hp,       maxHp: hp,
    damage,
    radius,
    timer:    6000,
    maxTimer: 6000,
    dead:     false,
  };
  pollenEntities.push(entity);
  return entity; // caller stores entity.id to link petal → entity
}


export function spawnMissileEntity(x, y, vx, vy, angle, damage, radius, color, border, typeId) {
  const entity = {
    id:          nextMissileId++,
    x, y,
    vx, vy,
    flyAngle:    angle,
    damage,
    radius,
    color,
    border,
    typeId,
    flyLifetime: 3500,
    hitMobIds:   new Set(),
    dead:        false,
  };
  missileEntities.push(entity);
  return entity;
}

export function spawnHoneycombEntity(x, y, hp, attractRange, tier) {
  const entity = {
    id:          nextHoneycombId++,
    x, y,
    vx: 0, vy: 0,  // massless — pushed by mobs, no knockback applied to mobs
    hp,          maxHp: hp,
    attractRange,
    tier,
    radius:      18,   // visual / collision radius (world units)
    timer:       10000, // 10s lifespan
    dead:        false,
  };
  honeycombEntities.push(entity);
  return entity;
}

export function updateDrops(dt) {
  for (const d of worldDrops) {
    d.bobTimer += dt * 0.006;
    if (d.spawnTimer < SPAWN_DUR) {
      d.spawnTimer = Math.min(SPAWN_DUR, d.spawnTimer + dt);
    }
  }

  for (let i = webFields.length - 1; i >= 0; i--) {
    const web = webFields[i];
    web.timer -= dt;
    if (web.timer <= 0) webFields.splice(i, 1);
  }

  for (const [mobId, slow] of pincerSlowedMobs) {
    slow.timer -= dt;
    if (slow.timer <= 0) pincerSlowedMobs.delete(mobId);
  }

  for (let i = pollenEntities.length - 1; i >= 0; i--) {
    const pe = pollenEntities[i];
    if (pe.dead) { pollenEntities.splice(i, 1); continue; }
    pe.timer -= dt;
    if (pe.timer <= 0) { pollenEntities.splice(i, 1); continue; }
    // Move by velocity, then apply friction so pushes decay naturally
    pe.x  += pe.vx;
    pe.y  += pe.vy;
    pe.vx *= 0.88;
    pe.vy *= 0.88;
  }

  for (let i = honeycombEntities.length - 1; i >= 0; i--) {
    const hc = honeycombEntities[i];
    if (hc.dead) { honeycombEntities.splice(i, 1); continue; }
    hc.timer -= dt;
    if (hc.timer <= 0) { hc.dead = true; honeycombEntities.splice(i, 1); continue; }
    // Apply velocity from being pushed, then friction
    hc.x  += hc.vx;
    hc.y  += hc.vy;
    hc.vx *= 0.88;
    hc.vy *= 0.88;
  }

  for (let i = missileEntities.length - 1; i >= 0; i--) {
    const me = missileEntities[i];
    if (me.dead) { missileEntities.splice(i, 1); continue; }
    me.flyLifetime -= dt;
    if (me.flyLifetime <= 0) { missileEntities.splice(i, 1); continue; }
    me.x += me.vx;
    me.y += me.vy;
  }
}
export function checkPickups(playerX, playerY, onPickup, pickupMultiplier = 1, flatPickupBonus = 0) {
  for (let i = worldDrops.length - 1; i >= 0; i--) {
    const d = worldDrops[i];
    if (Math.hypot(playerX - d.x - d.ox, playerY - d.y - d.oy) < d.pickupRadius * pickupMultiplier + flatPickupBonus) {
      onPickup(d.typeId);
      worldDrops.splice(i, 1);
    }
  }
}

// Get the slowdown factor from webs at a given position
export function getWebSlowdownFactor(x, y) {
  let slowFactor = 0;
  for (const web of webFields) {
    const dist = Math.hypot(x - web.x, y - web.y);
    if (dist < web.radius && web.slowFactor) {
      slowFactor = Math.max(slowFactor, web.slowFactor);
    }
  }
  return slowFactor;
}

// Get the Pincer slow factor currently active on a specific mob (0 if none/expired)
export function getPincerSlowFactor(mobId) {
  const slow = pincerSlowedMobs.get(mobId);
  return slow ? slow.factor : 0;
}
// Appended by patch
