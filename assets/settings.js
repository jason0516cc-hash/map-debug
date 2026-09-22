/**
 * settings.js — Global game settings / toggles.
 * Imported by any module that needs to read or write settings.
 */

export const settings = {
  mouseMovement:     false,   // off by default
  reduceDamageFlash: false,
  statBoxes:         true,
  showDamageNumbers: true,
  equipDrops:        false,   // off by default
  invertAttack:      false,   // invert attack keybind
  invertDefend:      false,   // invert defend keybind
  showReloadingPetals: true,  // ghost silhouette + reload arc for petals reloading in the ring
};
