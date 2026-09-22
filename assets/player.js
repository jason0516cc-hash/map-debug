import {
  PLAYER_RADIUS, PLAYER_SPEED,
  PLAYER_COLOR, PLAYER_BORDER,
  PLAYER_MAX_HP,
  PLAYER_MASS,
} from './constants.js';
import { inputState, keys } from './inputState.js';
import { canMoveTo, findSafeSpawnPosition } from './map.js';
import { hotbar } from './petals.js';
import { PETAL_TYPES } from './petalTypes.js';
import { settings } from './settings.js';
import { mousePos } from './ui.js';
import { camera, zoomState } from './camera.js';
import { inventoryOpen } from './inventory.js';
import { isSettingsOpen } from './uiManager.js';

// ── NEW LEVELING IMPORTS ──────────────────────────────────────────────────────
import { hpAtLevel, levelFromXp, petalSlotsForLevel } from './leveling.js';
import { levelHUD }                from './LevelHUD.js';
import { setHotbarSlots }          from './petals.js';

// Find safe spawn position for player
const safeSpawn = findSafeSpawnPosition(PLAYER_RADIUS);

export let isMoving = false;

export const player = {
  x:         safeSpawn.x,
  y:         safeSpawn.y,
  radius:    PLAYER_RADIUS,
  speed:     PLAYER_SPEED,
  color:     PLAYER_COLOR,
  border:    PLAYER_BORDER,
  hp:        PLAYER_MAX_HP,
  maxHp:     PLAYER_MAX_HP,
  shield:    0,     // absorbs damage before HP — recomputed each frame from equipped petals (Carapace, Shell)
  maxShield: 0,     // recomputed each frame — sum of equipped shieldAmount petals (Shell)
  spongePool: 0,          // Sponge — deferred damage waiting to drain out over spongeTimeRemaining
  spongeTimeRemaining: 0, // ms left in the current spread window; resets to the full duration whenever new damage merges in
  dead:      false,
  mass:      PLAYER_MASS,
  vx:        0,
  vy:        0,
  moveAngle: 0,   // last WASD direction in radians — used for eye tracking
  smoothRotation: 0,   // smoothed rotation for centipede legs
  legPhase:  0,   // animation phase for centipede legs accessory
  name:      'Unnamed',
  _soilHpBonus: 0,  // cached sum of maxHpBonus from equipped soil petals
  deathRotation: 0, // random tilt applied on death
  invincibleTimer: 0, // ms remaining of spawn invincibility (5s on spawn/respawn)
  hurtFlash: 0,       // ms remaining of red damage flash

  // ── Leveling ──────────────────────────────────────────────────────────────
  xp:    0,    // total accumulated XP
  level: 0,    // integer level, always === Math.floor(levelFromXp(xp))

  // ── Chat command overrides (cheats/debug) ────────────────────────────────
  godmode:      false, // /godmode — player takes no damage
  _hpBonus:     0,     // /set hp {num} — flat bonus added on top of leveled maxHp (stacks with soil petals)
  _dmgBonus:    0,     // /set dmg {num} — flat bonus added on top of body damage
  _speedMult:   1,     // /speed {num} — multiplier applied to total speed (base + petal bonuses)
};

/** Award XP to the player (call this when any mob dies). */
export function addXp(amount) {
  player.xp   += amount;
  player.level = Math.floor(levelFromXp(player.xp));

  // Level-up: grant any newly unlocked petal slots
  setHotbarSlots(petalSlotsForLevel(player.level));

  // Level-up: raise maxHp and give back the difference as a heal bonus
  const newMax = hpAtLevel(player.level) + player._soilHpBonus;
  if (newMax > player.maxHp) {
    player.hp  = Math.min(player.hp + (newMax - player.maxHp), newMax);
  }
  player.maxHp = newMax;

  // Keep HUD in sync
  levelHUD.addXp(amount);
}

/** Reset player for respawn — keeps name & petals, restores hp and position. XP is never lost. */
export function respawnPlayer() {
  const spawn = findSafeSpawnPosition(PLAYER_RADIUS);
  player.x    = spawn.x;
  player.y    = spawn.y;
  player.hp   = player.maxHp;
  player.dead = false;
  player.vx   = 0;
  player.vy   = 0;
  player.deathRotation = 0;
  // Clear any held keys so movement doesn't carry over from death (sticky keys)
  for (const k in keys) delete keys[k];
  // Grant 5 seconds of spawn invincibility
  player.invincibleTimer = 5000;
  player.hurtFlash       = 0;
}

export function updatePlayer(dt = 16) {
  // ── Accessory bonuses from hotbar ────────────────────────────────────────
  let speedBonus = 0;
  let soilBonus  = 0;
  let sizeBonus  = 0; // Air — fraction added to player radius, stacks additively across copies
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.walkSpeedBonus) speedBonus += pt.walkSpeedBonus;
    if (pt?.maxHpBonus)     soilBonus  += pt.maxHpBonus;
    if (pt?.sizeBonus)      sizeBonus  += pt.sizeBonus;
  }
  player.speed  = (PLAYER_SPEED + speedBonus) * (player._speedMult || 1);
  player.radius = PLAYER_RADIUS * (1 + sizeBonus);

  // ── Max HP: level-scaled base + soil petal bonus + /set hp bonus ──────────
  const leveledMaxHp = hpAtLevel(player.level) + soilBonus + (player._hpBonus || 0);
  if (soilBonus !== player._soilHpBonus || leveledMaxHp !== player.maxHp) {
    const wasFull = player.hp >= player.maxHp;
    player._soilHpBonus = soilBonus;
    player.maxHp        = leveledMaxHp;
    // If the player was topped off (or this is a /set hp bump), keep them topped off
    // instead of clamping down when maxHp only grew.
    player.hp = wasFull ? player.maxHp : Math.min(player.hp, player.maxHp);
  }

  let dx = 0, dy = 0;
  if (inputState.up)    dy -= 1;
  if (inputState.down)  dy += 1;
  if (inputState.left)  dx -= 1;
  if (inputState.right) dx += 1;

  // Normalize diagonal WASD movement
  if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

  // Mouse movement: move toward mouse cursor when enabled and no WASD held
  // Blocked while any GUI panel is open (inventory, settings)
  const guiOpen = inventoryOpen || isSettingsOpen();
  if (settings.mouseMovement && !guiOpen && dx === 0 && dy === 0) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Convert mouse screen pos to world pos
    const worldMX = (mousePos.x - W / 2) / zoomState.v + camera.x;
    const worldMY = (mousePos.y - H / 2) / zoomState.v + camera.y;
    const distX = worldMX - player.x;
    const distY = worldMY - player.y;
    const dist  = Math.hypot(distX, distY);
    // Only move if mouse is far enough away (dead zone = 10 world units)
    if (dist > 10) {
      dx = distX / dist;
      dy = distY / dist;
    }
  }

  // Update eye direction whenever a WASD key is held
  isMoving = dx !== 0 || dy !== 0;
  if (isMoving) {
    player.moveAngle = Math.atan2(dy, dx);
  }

  // Decay knockback velocity (friction)
  player.vx *= 0.78;
  player.vy *= 0.78;

  // Tick down spawn invincibility
  if (player.invincibleTimer > 0) player.invincibleTimer = Math.max(0, player.invincibleTimer - dt);

  const newX = player.x + dx * player.speed + player.vx;
  const newY = player.y + dy * player.speed + player.vy;

  if (window.__mapDebugNoclip || canMoveTo(newX, newY, player.radius)) {
    player.x = newX;
    player.y = newY;
    // Animate centipede legs only when actually moving
    if (isMoving) {
      player.legPhase += 0.14;
    }
  } else {
    player.vx = 0;
    player.vy = 0;
  }
}