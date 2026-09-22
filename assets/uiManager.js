/**
 * uiManager.js  — thin coordinator
 *
 * Responsibilities:
 *  1. Call each sub-module's init function in the right order.
 *  2. Wire cross-module callbacks (craftingUI ↔ settingsUI).
 *  3. Own the window resize listener (needs refs to all positioning functions).
 *  4. Re-export the public surface that the rest of the game imports.
 *
 * Sub-module split:
 *   hotbarUI.js    — canvas hotbar + bench, drag ghost, swap animations
 *   inventoryUI.js — DOM inventory panel, click-to-equip, drag-from-inv
 *   craftingUI.js  — crafting panel, spin animations, ring/grid rendering
 *   settingsUI.js  — settings panel, cog button, keybind toggles
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sub-module imports
// ─────────────────────────────────────────────────────────────────────────────
export {
  updateHotbar,
  onHotbarMouseMove,
  onHotbarMouseDown,
  onHotbarMouseUp,
  slotAtPoint,
  benchSlotAtPoint,
  onSwapKey,
  onSwapAll,
  drag,
  invSlotCSS,   // written by inventoryUI via setInvSlotCSS(), read by drag ghost
} from './HotbarUI.js';

export {
  updateInventory,
  notifyInventoryChanged,
  ensureInvDOM,
  renderInventory,
  equipFromInventory,
} from './InventoryUI.js';

export { toggleCraftingPanel, renderCraftingPanel } from './CraftingUI.js';

export {
  ensureSettingsBtn,
  updateSettingsCog,
} from './SettingsUI.js';

export { toggleMobGal } from './MobGalleryUI.js';

export { ensureChatDOM, positionChat, isChatOpen, onEnterKey } from './ChatUI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip (kept here for compatibility — unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
import { PETAL_TYPES } from './petalTypes.js';

export function showTooltip(petalType, x, y) {
  const el = document.getElementById('tooltip');
  if (!el || !petalType) { hideTooltip(); return; }
  const lines = [
    petalType.name,
    `Cooldown: ${petalType.cooldownText || (petalType.reloadTime / 1000).toFixed(1) + 's'}`,
    `DMG: ${petalType.damage}`,
    `HP: ${petalType.maxHp}`,
    petalType.armor       ? `Armor: ${petalType.armor}`                             : null,
    petalType.healAmount  ? `Heal: ${petalType.healAmount}`                          : null,
    petalType.poisonDps   ? `Poison DPS: ${petalType.poisonDps}`                     : null,
    petalType.passiveHeal ? `Passive Heal: ${petalType.passiveHeal.toFixed(1)}/s`    : null,
    petalType.spinBonus   ? `Spin: +${(petalType.spinBonus * 60).toFixed(1)} rad/s`  : null,
    petalType.description || null,
    `Rarity: ${petalType.rarity || 'Common'}`,
  ].filter(Boolean);
  el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  el.style.left = `${x + 16}px`;
  el.style.top  = `${y + 16}px`;
  el.classList.add('visible');
}

export function hideTooltip() {
  document.getElementById('tooltip')?.classList.remove('visible');
}

// ─────────────────────────────────────────────────────────────────────────────
// Init — call once at game start (replaces old monolithic initUI)
// ─────────────────────────────────────────────────────────────────────────────
import { ensureOverlay }           from './HotbarUI.js';
import { ensureInvDOM }            from './InventoryUI.js';
import { ensureCraftingDOM,
         positionCraftingButton,
         positionCraftingPanel,
         closeCraftingPanel,
         isCraftingOpen,
         registerMobGalWithCrafting2 } from './CraftingUI.js';
export { ensureCraftingDOM, positionCraftingButton, positionCraftingPanel, closeCraftingPanel, isCraftingOpen };
import { ensureSettingsBtn,
         registerCraftingWithSettings,
         registerMobGalWithSettings2,
         isSettingsOpen,
         closeSettings }          from './SettingsUI.js';
export { isSettingsOpen, closeSettings };
import { ensureMobGalDOM,
         positionMobGalButton,
         positionMobGalPanel,
         isMobGalOpen,
         closeMobGal }             from './MobGalleryUI.js';
export { ensureMobGalDOM, positionMobGalButton, positionMobGalPanel, isMobGalOpen, closeMobGal };
import { registerMobGalWithCrafting,
         registerMobGalWithSettings,
         registerInvWithMobGal,
         registerUpdateLogWithMobGal } from './MobGalleryUI.js';
import { ensureUpdateLogDOM,
         isUpdateLogOpen,
         closeUpdateLog,
         registerOthersWithUpdateLog } from './UpdateLogUI.js';
import { ensureDiscordDOM } from './DiscordUI.js';
export { isUpdateLogOpen, closeUpdateLog };
import { registerUpdateLogWithCrafting } from './CraftingUI.js';
import { inventoryOpen }           from './inventory.js';
import { positionInvButton,
         positionInvPanel,
         registerOtherPanelsWithInv } from './InventoryUI.js';
import { ensureChatDOM as _ensureChatDOM, positionChat as _positionChat } from './ChatUI.js';

export function initUI() {
  // Order matters: hotbar overlay first, then inv (which registers with hotbar),
  // then crafting (which registers with inv), then settings (which registers with crafting).
  ensureOverlay();
  ensureInvDOM();
  ensureCraftingDOM();
  ensureSettingsBtn();
  ensureMobGalDOM();
  ensureUpdateLogDOM();
  ensureDiscordDOM();
  _ensureChatDOM();

  // Wire craftingUI ↔ settingsUI cross-module callbacks.
  // (craftingUI → settingsUI direction is already set up inside ensureSettingsBtn.)
  // settingsUI → craftingUI: give settings the ability to query/close crafting.
  registerCraftingWithSettings({
    isCraftingOpen,
    closeCrafting: closeCraftingPanel,
  });

  // Wire MobGalleryUI ↔ craftingUI and settingsUI so toggleMobGal can
  // close competing panels.
  registerMobGalWithCrafting({
    isCraftingOpen,
    closeCrafting: closeCraftingPanel,
  });
  registerMobGalWithSettings({
    isSettingsOpen,
    closeSettings,
  });
  // Wire craftingUI so it can close mob gallery when it opens
  registerMobGalWithCrafting2({
    isMobGalOpen,
    closeMobGal,
  });
  // Wire settings so it can close mob gallery when it opens
  registerMobGalWithSettings2({
    isMobGalOpen,
    closeMobGal,
  });
  // Wire inventory so it can close settings + mob gallery + update log when it opens
  registerOtherPanelsWithInv({
    isSettingsOpen,  closeSettings,
    isMobGalOpen,    closeMobGal,
    isUpdateLogOpen, closeUpdateLog,
  });
  // Wire UpdateLog into craftingUI so crafting keybind/button closes it
  registerUpdateLogWithCrafting({
    isUpdateLogOpen,
    closeUpdateLog,
  });
  // Wire inventory + updateLog into MobGal so V keybind/button closes them
  registerInvWithMobGal({
    isInventoryOpen: () => inventoryOpen,
    closeInventory:  () => { closeInventory(); document.getElementById('inv-panel')?.classList.remove('open'); },
  });
  registerUpdateLogWithMobGal({
    isUpdateLogOpen,
    closeUpdateLog,
  });
  // Wire UpdateLogUI so it can close all competing panels when it opens
  registerOthersWithUpdateLog({
    isInventoryOpen:  () => inventoryOpen,
    closeInventory:   () => { closeInventory(); document.getElementById('inv-panel')?.classList.remove('open'); },
    isCraftingOpen,   closeCrafting: closeCraftingPanel,
    isSettingsOpen,   closeSettings,
    isMobGalOpen,     closeMobGal,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resize  — centralised here so every module's positioning stays in sync
// ─────────────────────────────────────────────────────────────────────────────
// Need these as values (not just re-exports) so the listener can call them.
import { closeInventory }     from './inventory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Close-all helper — shuts every panel at once
// ─────────────────────────────────────────────────────────────────────────────
export function closeAllPanels() {
  if (inventoryOpen) {
    closeInventory();
    document.getElementById('inv-panel')?.classList.remove('open');
  }
  if (isCraftingOpen())    closeCraftingPanel();
  if (isSettingsOpen())    closeSettings();
  if (isMobGalOpen())      closeMobGal();
  if (isUpdateLogOpen())   closeUpdateLog();
}

// Click outside any open panel → close everything
document.addEventListener('mousedown', e => {
  // If nothing is open, nothing to do
  if (!inventoryOpen && !isCraftingOpen() && !isSettingsOpen() && !isMobGalOpen() && !isUpdateLogOpen()) return;

  // Walk up from the click target — if it hits a panel or button, leave them open
  const panelIds = [
    'inv-panel', 'inv-toggle-btn',
    'crafting-panel', 'crafting-btn',
    'settings-panel', 'settings-btn',
    'mobgal-panel', 'mobgal-btn',
    'updatelog-panel', 'updatelog-btn',
  ];
  let node = e.target;
  while (node && node !== document.body) {
    if (panelIds.includes(node.id)) return;
    node = node.parentElement;
  }
  closeAllPanels();
});

window.addEventListener('resize', () => {
  positionInvButton();
  if (inventoryOpen) positionInvPanel();
  positionCraftingButton();
  if (isCraftingOpen()) positionCraftingPanel();
  positionMobGalButton();
  if (isMobGalOpen()) positionMobGalPanel();
  _positionChat();
});
