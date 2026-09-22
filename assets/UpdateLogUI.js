/**
 * UpdateLogUI.js
 *
 * Update Log panel — shows versioned patch notes.
 * Button sits to the right of the settings button (top-left area).
 * Panel slides down from the button.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module callbacks (so other panels can close this one)
// ─────────────────────────────────────────────────────────────────────────────
let _others = {
  isInventoryOpen:  () => false, closeInventory:  () => {},
  isCraftingOpen:   () => false, closeCrafting:   () => {},
  isSettingsOpen:   () => false, closeSettings:   () => {},
  isMobGalOpen:     () => false, closeMobGal:     () => {},
};
export function registerOthersWithUpdateLog(cbs) { Object.assign(_others, cbs); }

// ─────────────────────────────────────────────────────────────────────────────
// Update entries — add new ones at the top
// ─────────────────────────────────────────────────────────────────────────────
const UPDATES = [
  {
    number: 1,
    date:   'May 2, 2025',
    text:   'Initial release. Mobs, petals, crafting, and inventory are live. Mob Gallery added to track kill counts.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #updatelog-btn {
      position: fixed; top: 16px; left: 82px;
      width: 54px; height: 54px; border-radius: 10px;
      background: #3a9e3a; border: 3px solid #267326;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 5px; box-sizing: border-box;
      transition: background 0.12s; user-select: none;
    }
    #updatelog-btn:hover  { background: #48b848; }
    #updatelog-btn:active { transform: scale(0.95); }
    #updatelog-btn img    { width: 100%; height: 100%; object-fit: contain; display: block; }

    #updatelog-panel {
      position: fixed; top: 82px; left: 16px; width: 300px;
      background: #2e6e2e; border: 3px solid #267326; border-radius: 10px;
      font-family: 'UbuntuCustom','Ubuntu',Arial,sans-serif;
      z-index: 100; user-select: none; box-sizing: border-box;
      opacity: 0; pointer-events: none;
      transform: translateY(-18px);
      transition: opacity 0.20s cubic-bezier(0.22,1,0.36,1),
                  transform 0.22s cubic-bezier(0.22,1,0.36,1);
      overflow: hidden;
    }
    #updatelog-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0); }

    #updatelog-panel .ul-titlebar {
      display: flex; align-items: center; justify-content: center;
      position: relative; padding: 7px 10px 6px;
      background: linear-gradient(to bottom, #48b848, #2e6e2e);
      border-bottom: 2px solid #267326; border-radius: 7px 7px 0 0;
    }
    #updatelog-panel .ul-title {
      font-size: 15px; font-weight: 900; color: #e8ffe8; letter-spacing: 0.6px;
    }
    #updatelog-panel .ul-close {
      position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
      background: #c1565e; border: 2px solid #90464b; border-radius: 5px;
      color: #fff; font-size: 12px; font-weight: 900;
      width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; line-height: 1; font-family: inherit;
      transition: background 0.12s;
    }
    #updatelog-panel .ul-close:hover { background: #a03040; }

    #updatelog-panel .ul-scroll {
      max-height: 380px; overflow-y: auto; padding: 10px 12px 12px;
      background: #245c24;
    }
    #updatelog-panel .ul-scroll::-webkit-scrollbar { width: 6px; }
    #updatelog-panel .ul-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.15); }
    #updatelog-panel .ul-scroll::-webkit-scrollbar-thumb { background: #267326; border-radius: 4px; }

    #updatelog-panel .ul-entry {
      margin-bottom: 10px;
    }
    #updatelog-panel .ul-entry:last-child { margin-bottom: 0; }

    #updatelog-panel .ul-dash {
      border: none; border-top: 2px solid rgba(255,255,255,0.18);
      margin: 0 0 8px 0;
    }
    #updatelog-panel .ul-header {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 4px;
    }
    #updatelog-panel .ul-number {
      font-size: 14px; font-weight: 900; color: #b8ffb8;
    }
    #updatelog-panel .ul-date {
      font-size: 11px; font-weight: 600; color: rgba(200,255,200,0.65);
    }
    #updatelog-panel .ul-text {
      font-size: 12.5px; font-weight: 500; color: rgba(220,255,220,0.88);
      line-height: 1.5;
    }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let updateLogOpen  = false;
let updateLogPanel = null;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export function isUpdateLogOpen() { return updateLogOpen; }

export function closeUpdateLog() {
  updateLogOpen = false;
  if (updateLogPanel) updateLogPanel.classList.remove('open');
}

export function openUpdateLog() {
  updateLogOpen = true;
  if (updateLogPanel) updateLogPanel.classList.add('open');
}

export function toggleUpdateLog() {
  if (updateLogOpen) { closeUpdateLog(); return; }
  // Close competing panels
  if (_others.isInventoryOpen()) _others.closeInventory();
  if (_others.isCraftingOpen())  _others.closeCrafting();
  if (_others.isSettingsOpen())  _others.closeSettings();
  if (_others.isMobGalOpen())    _others.closeMobGal();
  openUpdateLog();
}

// ─────────────────────────────────────────────────────────────────────────────
// Render entries
// ─────────────────────────────────────────────────────────────────────────────
function buildPanel() {
  const scroll = updateLogPanel.querySelector('.ul-scroll');
  if (!scroll) return;
  scroll.innerHTML = UPDATES.map(u => `
    <div class="ul-entry">
      <hr class="ul-dash">
      <div class="ul-header">
        <span class="ul-number">Update #${u.number}</span>
        <span class="ul-date">Date: ${u.date}</span>
      </div>
      <div class="ul-text">${u.text}</div>
      <hr class="ul-dash" style="margin: 8px 0 0 0;">
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM setup
// ─────────────────────────────────────────────────────────────────────────────
export function ensureUpdateLogDOM() {
  if (document.getElementById('updatelog-btn')) return;

  // ── Button ────────────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'updatelog-btn';
  const img = document.createElement('img');
  img.src = './zicons/Updatelog-icon.png'; img.draggable = false;
  btn.appendChild(img);
  document.body.appendChild(btn);
  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('click', toggleUpdateLog);

  // ── Panel ─────────────────────────────────────────────────────────────────
  updateLogPanel = document.createElement('div');
  updateLogPanel.id = 'updatelog-panel';
  updateLogPanel.addEventListener('mousedown', e => e.stopPropagation());
  updateLogPanel.innerHTML = `
    <div class="ul-titlebar">
      <span class="ul-title">Update Log</span>
      <button class="ul-close" title="Close">✕</button>
    </div>
    <div class="ul-scroll"></div>
  `;
  document.body.appendChild(updateLogPanel);
  updateLogPanel.querySelector('.ul-close').addEventListener('click', closeUpdateLog);
  buildPanel();
}
