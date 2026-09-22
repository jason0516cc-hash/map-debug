/**
 * inputState.js — Raw input state with NO imports.
 * Both petals.js and input.js can safely import from here
 * without creating circular dependencies.
 */
export const keys  = {};
export const mouse = { left: false, right: false };

// Settings reference (set lazily to avoid circular imports)
let _settings = null;
export function linkSettings(s) { _settings = s; }

export const inputState = {
  get up()      { return !_settings?.mouseMovement && !!(keys['w'] || keys['W'] || keys['ArrowUp']);    },
  get down()    { return !_settings?.mouseMovement && !!(keys['s'] || keys['S'] || keys['ArrowDown']);  },
  get left()    { return !_settings?.mouseMovement && !!(keys['a'] || keys['A'] || keys['ArrowLeft']);  },
  get right()   { return !_settings?.mouseMovement && !!(keys['d'] || keys['D'] || keys['ArrowRight']); },
  get _rawExpand()  { return !!(keys[' '] || mouse.expandOk); },
  get _rawRetract() { return !!(keys['Shift'] || mouse.right); },
  get expand() {
    const invAtk = _settings && _settings.invertAttack;
    const invDef = _settings && _settings.invertDefend;
    // Invert Attack: default is expanded; pressing attack key returns to normal (cancel expand)
    // Invert Defend: pressing attack while invert defend is on returns to normal orbit
    if (invAtk) return !this._rawExpand && !this._rawRetract; // always expanded unless key pressed
    if (invDef) return false; // invert defend: suppress expand, player is stuck defending unless they press attack to go normal
    return this._rawExpand;
  },
  get retract() {
    const invAtk = _settings && _settings.invertAttack;
    const invDef = _settings && _settings.invertDefend;
    // Invert Defend: default is retracted; pressing attack key brings to normal
    if (invDef) return !this._rawExpand && !this._rawRetract; // always retracted unless attack pressed
    if (invAtk) return false; // invert attack: suppress retract
    return this._rawRetract;
  },
};