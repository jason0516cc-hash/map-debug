/**
 * input.js — Event listeners only.
 * Writes to inputState and calls UI handlers.
 *
 * Import chain:  input → inputState   (no cycle)
 *                input → ui           (ui → petals → inputState: no cycle)
 */
import { keys, mouse } from './inputState.js';
import {
  handleMouseDown,
  handleMouseUp,
  handleMouseMove,
  handleKeyDown,
} from './ui.js';
import { isChatOpen } from './ChatUI.js';

// Re-export so callers that previously used `import { input } from './input.js'`
// still work.
export { inputState as input } from './inputState.js';

// ── Keyboard ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!isChatOpen()) keys[e.key] = true;
  handleKeyDown(e.key);
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ── Mouse ─────────────────────────────────────────────────────────────────────
window.addEventListener('mousemove', e => {
  handleMouseMove(e.clientX, e.clientY);
});

window.addEventListener('mousedown', e => {
  const consumed = handleMouseDown(
    e.clientX, e.clientY,
    window.innerWidth, window.innerHeight,
    e.button,
  );
  if (e.button === 0) {
    mouse.left     = true;
    // Only allow left-click expand if the UI didn't consume the event
    mouse.expandOk = !consumed;
  }
  if (e.button === 2) mouse.right = true;
});

window.addEventListener('mouseup', e => {
  if (e.button === 0) {
    handleMouseUp(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    mouse.left     = false;
    mouse.expandOk = false;
  }
  if (e.button === 2) mouse.right = false;
});

window.addEventListener('contextmenu', e => e.preventDefault());

// ── Scroll (callback-based) ───────────────────────────────────────────────────
const scrollHandlers = [];
export function onScroll(fn) { scrollHandlers.push(fn); }
window.addEventListener('wheel', e => {
  scrollHandlers.forEach(fn => fn(e.deltaY));
});
