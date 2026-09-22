/**
 * settingsUI.js
 *
 * Settings panel: game toggles, controls, credits, spinning cog button.
 *
 * Dependency graph (no circular imports):
 *   settingsUI → craftingUI (for registerSettingsWithCrafting), inventory, settings
 */

import { settings }                          from './settings.js';
import { inventoryOpen, toggleInventory }    from './inventory.js';
import { registerSettingsWithCrafting }      from './CraftingUI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks
// craftingUI calls registerCraftingWithSettings() after its own setup so that
// the settings button can close the crafting panel without a circular import.
// ─────────────────────────────────────────────────────────────────────────────
let _craft = {
  isCraftingOpen: () => false,
  closeCrafting:  () => {},
};
export function registerCraftingWithSettings(cbs) { Object.assign(_craft, cbs); }

let _mobGal = { isMobGalOpen: () => false, closeMobGal: () => {} };
export function registerMobGalWithSettings2(cbs) { Object.assign(_mobGal, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// Inject styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectSettingsStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* ── Settings button ─────────────────────────────────────────────────── */
    #settings-btn {
      position: fixed; top: 16px; left: 16px;
      width: 54px; height: 54px; border-radius: 10px;
      background: #aaaaaa; border: 3px solid #888888;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 5px; box-sizing: border-box; user-select: none;
    }
    #settings-btn:active { transform: scale(0.95); }
    #settings-btn img {
      width: 100%; height: 100%; object-fit: contain; display: block;
      transition: transform 0.45s cubic-bezier(0.22,1,0.36,1);
      transform-origin: center center;
    }

    /* ── Settings panel ──────────────────────────────────────────────────── */
    #settings-panel {
      position: fixed; top: 86px; left: 16px; width: 260px;
      background: #b0b0b0; border: 2px solid #787878; border-radius: 6px;
      font-family: 'UbuntuCustom', 'Ubuntu', Arial, sans-serif;
      z-index: 200; user-select: none; box-sizing: border-box;
      opacity: 0; pointer-events: none;
      transform: translateX(calc(-100% - 32px));
      transition: opacity 0.20s cubic-bezier(0.22,1,0.36,1), transform 0.22s cubic-bezier(0.22,1,0.36,1);
    }
    #settings-panel.open { opacity: 1; pointer-events: auto; transform: translateX(0); }

    /* ── Title bar ───────────────────────────────────────────────────────── */
    .sp-titlebar {
      display: flex; align-items: center; justify-content: center; position: relative;
      padding: 6px 10px 5px;
      background: linear-gradient(to bottom, #c8c8c8, #b0b0b0);
      border-bottom: 1px solid #888888; border-radius: 4px 4px 0 0;
    }
    .sp-title { font-size: 14px; font-weight: 900; color: #111; letter-spacing: 0.5px; }
    .sp-close {
      position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
      background: #cc3333; border: 1.5px solid #881111; border-radius: 4px;
      color: #fff; font-size: 11px; font-weight: 900;
      width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; line-height: 1; font-family: inherit; transition: background 0.12s;
    }
    .sp-close:hover { background: #aa1111; }

    /* ── Tab row ─────────────────────────────────────────────────────────── */
    .sp-tabs {
      display: flex; justify-content: center; gap: 4px;
      padding: 6px 8px 0; background: #a8a8a8;
      border-bottom: 2px solid #787878; flex-shrink: 0;
    }
    .sp-tab {
      padding: 4px 14px; font-size: 12px; font-weight: 800; font-family: inherit;
      border: 1.5px solid #787878; border-bottom: none; border-radius: 5px 5px 0 0;
      background: #999; color: #222; cursor: pointer; position: relative;
      bottom: -2px; letter-spacing: 0.3px; transition: background 0.10s;
    }
    .sp-tab:hover { background: #b8b8b8; }
    .sp-tab.active { background: #b8b8b8; border-color: #787878; border-bottom-color: #b8b8b8; color: #111; z-index: 1; }

    /* ── Body / rows ─────────────────────────────────────────────────────── */
    .sp-body { padding: 8px 10px 10px; background: #b8b8b8; }
    .sp-row {
      display: flex; align-items: center; gap: 8px; padding: 4px;
      border-radius: 4px; cursor: pointer; transition: background 0.09s;
    }
    .sp-row:hover { background: rgba(255,255,255,0.22); }

    /* ── Checkbox ────────────────────────────────────────────────────────── */
    .sp-check {
      width: 18px; height: 18px; border-radius: 3px; border: 2px solid #666;
      background: #d8d8d8; flex-shrink: 0; box-sizing: border-box; position: relative;
      transition: background 0.09s;
    }
    .sp-check.on { background: #fff; border-color: #555; }
    .sp-check.on::after {
      content: '✓'; position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 900; color: #333; line-height: 1;
    }

    /* ── Label / key badge ───────────────────────────────────────────────── */
    .sp-label { font-size: 12.5px; font-weight: 700; color: #111; flex: 1; }
    .sp-key {
      font-size: 9.5px; font-weight: 900; color: #444;
      background: rgba(0,0,0,0.14); border: 1px solid rgba(0,0,0,0.20);
      border-radius: 3px; padding: 1px 5px; letter-spacing: 0.5px;
    }

    /* ── Credits ─────────────────────────────────────────────────────────── */
    .sp-credit-row { padding: 6px 4px; font-size: 12px; color: #111; border-bottom: 1px solid rgba(0,0,0,0.12); line-height: 1.4; }
    .sp-credit-row:last-child { border-bottom: none; }
    .sp-credit-name { font-weight: 900; color: #1a1a1a; }
    .sp-credit-role { font-weight: 600; color: #333; }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let settingsOpen = false;
let settingsTab  = 'game'; // 'game' | 'controls' | 'credits'

// Cog rotation
let cogAngle    = 0;
let cogLastTime = 0;
const COG_SPEED = 0.0012; // rad/ms

// ─────────────────────────────────────────────────────────────────────────────
// Setting definitions
// ─────────────────────────────────────────────────────────────────────────────
const SETTINGS_DEFS = [
  { key: 'reduceDamageFlash',   label: 'Disable Damage Flash',      keybind: null },
  { key: 'statBoxes',           label: 'Stat Boxes',                keybind: null },
  { key: 'showDamageNumbers',   label: 'Show Damage Numbers',       keybind: null },
  { key: 'equipDrops',          label: 'Equip Drops',               keybind: null },
  { key: 'showReloadingPetals', label: 'Show Reloading Petals',     keybind: null },
];

const CONTROLS_DEFS = [
  { key: 'mouseMovement', label: 'Mouse Movement', keybind: 'K' },
  { key: 'invertAttack',  label: 'Invert Attack',  keybind: '+' },
  { key: 'invertDefend',  label: 'Invert Defend',  keybind: '-' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export function isSettingsOpen() { return settingsOpen; }

export function closeSettings() {
  settingsOpen = false;
  const panel = document.getElementById('settings-panel');
  if (panel) panel.classList.remove('open');
  cogLastTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel building
// ─────────────────────────────────────────────────────────────────────────────
function buildSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="sp-titlebar">
      <span class="sp-title">Settings</span>
      <button class="sp-close" id="settings-close-btn" title="Close">✕</button>
    </div>
    <div class="sp-tabs" id="settings-tabs"></div>
    <div class="sp-body" id="settings-body"></div>
  `;
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  renderSettingsTabs();
  renderSettingsBody();
}

function renderSettingsTabs() {
  const tabs = document.getElementById('settings-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  for (const id of ['game', 'controls', 'credits']) {
    const btn = document.createElement('button');
    btn.className = 'sp-tab' + (settingsTab === id ? ' active' : '');
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.addEventListener('click', () => { settingsTab = id; renderSettingsTabs(); renderSettingsBody(); });
    tabs.appendChild(btn);
  }
}

function buildSettingRows(body, defs) {
  for (const def of defs) {
    const row = document.createElement('div');
    row.className = 'sp-row';

    const box = document.createElement('div');
    box.className = 'sp-check' + (settings[def.key] ? ' on' : '');

    const lbl = document.createElement('span');
    lbl.className = 'sp-label'; lbl.textContent = def.label;

    row.appendChild(box);
    row.appendChild(lbl);
    if (def.keybind) {
      const kb = document.createElement('span');
      kb.className = 'sp-key'; kb.textContent = def.keybind;
      row.appendChild(kb);
    }
    row.addEventListener('click', () => {
      settings[def.key] = !settings[def.key];
      box.className = 'sp-check' + (settings[def.key] ? ' on' : '');
    });
    body.appendChild(row);
  }
}

function renderSettingsBody() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML = '';

  if (settingsTab === 'game') {
    buildSettingRows(body, SETTINGS_DEFS);
  } else if (settingsTab === 'controls') {
    buildSettingRows(body, CONTROLS_DEFS);
  } else if (settingsTab === 'credits') {
    const credits = [
      { name: 'Vyx',      role: 'coding and developing, mob designs.' },
      { name: 'UrBoi_Kai', role: 'petal drawings, ideas, and icon drawings. (mob gallery)' },
    ];
    for (const c of credits) {
      const row = document.createElement('div');
      row.className = 'sp-credit-row';
      row.innerHTML = `<span class="sp-credit-name">${c.name}</span><span class="sp-credit-role"> — ${c.role}</span>`;
      body.appendChild(row);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cog animation  (called every frame from game loop)
// ─────────────────────────────────────────────────────────────────────────────
export function updateSettingsCog(now) {
  const btn = document.getElementById('settings-btn');
  if (!btn) return;
  const img = btn.querySelector('img');
  if (!img) return;

  if (settingsOpen) {
    const dt = cogLastTime ? now - cogLastTime : 0;
    cogAngle += COG_SPEED * dt;
    img.style.transition = 'none';
    img.style.transform  = `rotate(${cogAngle}rad)`;
  } else if (cogAngle !== 0) {
    img.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
    img.style.transform  = 'rotate(0rad)';
    cogAngle = 0;
  }
  cogLastTime = now;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM setup
// ─────────────────────────────────────────────────────────────────────────────
export function ensureSettingsBtn() {
  if (document.getElementById('settings-btn')) return;

  // ── Button ────────────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'settings-btn';
  const img = document.createElement('img');
  img.src = './zicons/settings-icon.png'; img.draggable = false;
  btn.appendChild(img);
  document.body.appendChild(btn);
  btn.addEventListener('mousedown', e => e.stopPropagation());

  // ── Panel ─────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.addEventListener('mousedown', e => e.stopPropagation());
  document.body.appendChild(panel);
  buildSettingsPanel();

  // ── Toggle ────────────────────────────────────────────────────────────────
  btn.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    panel.classList.toggle('open', settingsOpen);
    if (!settingsOpen) { cogLastTime = 0; return; }
    // Opening: close competing panels
    if (inventoryOpen) toggleInventory();
    if (_craft.isCraftingOpen()) _craft.closeCrafting();
    if (_mobGal.isMobGalOpen()) _mobGal.closeMobGal();
    renderSettingsBody(); // refresh in case keybind was toggled externally
  });

  // ── Global keybinds (work whether settings is open or not) ────────────────
  window.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') {
      settings.invertAttack = !settings.invertAttack;
      if (settingsOpen) renderSettingsBody();
    } else if (e.key === '-' || e.key === '_') {
      settings.invertDefend = !settings.invertDefend;
      if (settingsOpen) renderSettingsBody();
    } else if ((e.key === 'k' || e.key === 'K') && settingsOpen) {
      settings.mouseMovement = !settings.mouseMovement;
      renderSettingsBody();
    }
  });

  // Register callbacks with craftingUI so craftingUI can close settings
  registerSettingsWithCrafting({
    isSettingsOpen: () => settingsOpen,
    closeSettings,
  });
}
