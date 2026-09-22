/**
 * wingState.js — shared wing animation state.
 * Exported so both petals.js (hitbox offset) and renderer.js (draw offset) can read it.
 */
export const wingState = {
  attackT: 0,   // 0 = idle, 1 = fully attacking
  pulseT:  0,   // running timer driving the sine-wave pulse
};
