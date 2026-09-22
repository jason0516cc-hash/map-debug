// map.js — Active-biome router.
//
// The real per-biome maps live in GardenMap.js / DesertMap.js / OceanMap.js,
// each built from a hand-designed black/white PNG wall mask (see those files'
// own headers for the conversion details). This module is the single point
// every other file imports from (combat.js, mobs.js, player.js, renderer.js)
// so none of them need to know which biome is currently active — they just
// call canMoveTo/findSafeSpawnPosition/findOpenSpawnPosition/drawMap/getMapW/
// getMapH as before, and this router forwards to whichever biome module
// main.js selected via setActiveBiome().
//
// PHASE 2 STATUS: map geometry + player spawn only, wired for real. No mob
// spawn logic hooked up yet (per instructions) — findOpenSpawnPosition exists
// per-biome and works, but nothing currently calls it to populate the world.

import * as GardenMap from './GardenMap.js';
import * as DesertMap from './DesertMap.js';
import * as OceanMap  from './OceanMap.js';

const BIOMES = {
  garden: GardenMap,
  desert: DesertMap,
  ocean:  OceanMap,
};

let _active = GardenMap; // sensible default before main.js explicitly sets one

/** Called by main.js when the player picks a biome from the homescreen. */
export function setActiveBiome(biomeId) {
  const mod = BIOMES[biomeId];
  if (!mod) {
    console.warn(`map.js: unknown biome "${biomeId}", keeping current biome active.`);
    return;
  }
  _active = mod;
}

export function getActiveBiome() {
  for (const [id, mod] of Object.entries(BIOMES)) {
    if (mod === _active) return id;
  }
  return null;
}

// ── Live-forwarding exports ───────────────────────────────────────────────────
// Functions forward with a small wrapper (cheap — one extra call frame) so
// they always dispatch to whichever biome is active *at call time*, not at
// import time. MAP_W/MAP_H can't be safely re-exported as plain consts (an ES
// module const binding snapshots the value that was live when first read by
// some engines' bundling, and definitely reads stale after a biome switch
// mid-session) so they're exposed as getter functions instead — mobs.js is
// the only consumer and already only reads them inside function bodies.

export function canMoveTo(x, y, radius = 22) {
  return _active.canMoveTo(x, y, radius);
}

export function findSafeSpawnPosition(radius = 22, playerX, playerY, safeRadius = 350) {
  return _active.findSafeSpawnPosition(radius, playerX, playerY, safeRadius);
}

export function findOpenSpawnPosition(radius, existingMobs, tries = 60) {
  return _active.findOpenSpawnPosition(radius, existingMobs, tries);
}

export function drawMap(ctx, cameraX, cameraY, canvasW, canvasH, zoomV = 1) {
  return _active.drawMap(ctx, cameraX, cameraY, canvasW, canvasH, zoomV);
}

export function getMapW() { return _active.MAP_W; }
export function getMapH() { return _active.MAP_H; }
export function getGridW() { return _active.GRID_W; }
export function getGridH() { return _active.GRID_H; }
export function getTileSize() { return _active.TILE_SIZE; }
export function isOpenTile(gx, gy) { return _active.isOpenTile(gx, gy); }
export function worldToTile(x, y) {
  const t = _active.TILE_SIZE;
  return { gx: Math.floor(x / t), gy: Math.floor(y / t) };
}
