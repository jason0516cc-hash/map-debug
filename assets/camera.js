import { CAMERA_LAG, PETAL_ORIGIN_LAG, PLAYER_RADIUS } from './constants.js';

export const camera = { x: 0, y: 0 };

// Default zoom limits
export const DEFAULT_MIN_ZOOM = 0.56;  // most zoomed out (default)
export const MAX_ZOOM_IN      = 1.61;  // most zoomed in

// The current minimum zoom (may be lowered by antennae vision bonus)
export let minZoom = DEFAULT_MIN_ZOOM;

// Zoom stored as an object so all importers always read the live value.
// Use `zoom.v` to read the current zoom level everywhere.
export const zoomState = { v: 1 };

// Convenience getter used by main.js wheel handler
export function getZoom() { return zoomState.v; }

export function setMinZoom(z) {
  minZoom = z;
  zoomState.v = Math.max(minZoom, Math.min(MAX_ZOOM_IN, zoomState.v));
}

export function setZoom(z) {
  zoomState.v = Math.max(minZoom, Math.min(MAX_ZOOM_IN, z));
}

// Petals orbit this point, which lags behind the player
export const petalOrigin = { x: 0, y: 0 };

export function initCamera(playerX, playerY) {
  camera.x       = playerX;
  camera.y       = playerY;
  petalOrigin.x  = playerX;
  petalOrigin.y  = playerY;
}

// Instantly snap camera and petal origin to a position (no lag, e.g. on teleport)
export function snapCamera(playerX, playerY) {
  camera.x      = playerX;
  camera.y      = playerY;
  petalOrigin.x = playerX;
  petalOrigin.y = playerY;
}

// Maximum distance the camera / petal orbit ring may lag behind the player —
// one flower body size. Without this, a large sudden speed spike (e.g. a
// high-tier Centipede Legs bonus) can make the lag grow far beyond what the
// fixed lerp factor can catch up with in a frame; since mouse-movement mode
// computes the world position under the cursor relative to camera.x/y, an
// unbounded lag there made that math drift and feel "buggy" at high speed.
const MAX_CAMERA_LAG_DIST = PLAYER_RADIUS;

export function updateCamera(playerX, playerY) {
  camera.x      += (playerX - camera.x)      * CAMERA_LAG;
  camera.y      += (playerY - camera.y)      * CAMERA_LAG;
  petalOrigin.x += (playerX - petalOrigin.x) * PETAL_ORIGIN_LAG;
  petalOrigin.y += (playerY - petalOrigin.y) * PETAL_ORIGIN_LAG;

  // Clamp both lags to at most one flower body size, measured as a true 2D
  // distance (not per-axis), so a fast diagonal dash can't stretch the gap
  // out along one axis while looking fine on the other.
  const camDx = playerX - camera.x, camDy = playerY - camera.y;
  const camDist = Math.hypot(camDx, camDy);
  if (camDist > MAX_CAMERA_LAG_DIST) {
    const pull = (camDist - MAX_CAMERA_LAG_DIST) / camDist;
    camera.x += camDx * pull;
    camera.y += camDy * pull;
  }

  const petDx = playerX - petalOrigin.x, petDy = playerY - petalOrigin.y;
  const petDist = Math.hypot(petDx, petDy);
  if (petDist > MAX_CAMERA_LAG_DIST) {
    const pull = (petDist - MAX_CAMERA_LAG_DIST) / petDist;
    petalOrigin.x += petDx * pull;
    petalOrigin.y += petDy * pull;
  }
}

// Convert a world position to screen-space given canvas dimensions.
export function toScreen(wx, wy, canvasW, canvasH) {
  return {
    sx: (wx - camera.x) * zoomState.v + canvasW  / 2,
    sy: (wy - camera.y) * zoomState.v + canvasH / 2,
  };
}
