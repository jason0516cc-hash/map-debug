/**
 * ui.js — UI event handling
 * Routes mouse/keyboard events to the hotbar and inventory.
 */
import { hotbar, rebuildPetals }                          from './petals.js';
import { toggleInventory, addToInventory, removeFromInventory } from './inventory.js';
import { onHotbarMouseDown, onHotbarMouseMove, onHotbarMouseUp, drag, onSwapKey, onSwapAll, toggleCraftingPanel } from './uiManager.js';
import { homescreenMode } from './HotbarUI.js';
import { settings } from './settings.js';
import { onEnterKey, isChatOpen } from './ChatUI.js';

// ── Mouse tracking ────────────────────────────────────────────────────────────
export const mousePos = { x: 0, y: 0 };
export let uiConsumedLastMouseDown = false;

// Returns the correct canvas H for hotbar hit-testing.
// On homescreen the hotbar uses a virtual H so slots are positioned below the UI.
function _hotbarH() {
  if (!homescreenMode) return window.innerHeight;
  // Dynamically import to avoid circular deps — use the global exposed by main.js
  return (typeof window._getHomescreenVirtualH === 'function')
    ? window._getHomescreenVirtualH()
    : window.innerHeight;
}

export function handleMouseMove(x, y) {
  mousePos.x = x;
  mousePos.y = y;
  onHotbarMouseMove(x, y, window.innerWidth, _hotbarH());
}

export function handleMouseDown(x, y, canvasW, canvasH, button) {
  uiConsumedLastMouseDown = false;
  if (button === 0) {
    const consumed = onHotbarMouseDown(x, y, canvasW, _hotbarH());
    if (consumed) {
      uiConsumedLastMouseDown = true;
      return true;
    }
  }
  return false;
}

export function handleMouseUp(x, y, canvasW, canvasH) {
  onHotbarMouseUp(x, y, canvasW, _hotbarH());
}

export function handleKeyDown(key) {
  // If chat is open, let its own input handle everything — don't fire game keys
  if (isChatOpen()) return;

  // Enter opens chat
  if (key === 'Enter') {
    onEnterKey();
    return;
  }

  if (key === 'x' || key === 'X') {
    toggleInventory();
    return;
  }
  // K: toggle mouse movement
  if (key === 'k' || key === 'K') {
    settings.mouseMovement = !settings.mouseMovement;
    return;
  }
  if (key === 'c' || key === 'C') {
    toggleCraftingPanel();
    return;
  }
  // R: swap all slots at once
  if (key === 'r' || key === 'R') {
    onSwapAll();
    return;
  }
  // 1-9 keybinds: swap top↔bench for that slot; 0 = slot 10
  const digit = parseInt(key, 10);
  if (digit >= 1 && digit <= 9) {
    onSwapKey(digit - 1); // 0-indexed: keys 1-9 → slots 0-8
  } else if (digit === 0) {
    onSwapKey(9); // key 0 → slot 10 (index 9)
  }
}
