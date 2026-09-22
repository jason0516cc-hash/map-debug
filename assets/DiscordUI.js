/**
 * DiscordUI.js
 *
 * Discord button — sits to the right of the update log button (top-left area).
 * Clicking opens the Discord invite link in a new tab.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
(function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #discord-btn {
      position: fixed; top: 16px; left: 148px;
      width: 54px; height: 54px; border-radius: 10px;
      background: #5865F2; border: 3px solid #0f1a94;
      cursor: pointer; z-index: 101;
      display: flex; align-items: center; justify-content: center;
      padding: 2px; box-sizing: border-box;
      transition: background 0.12s; user-select: none;
    }
    #discord-btn:hover  { background: #4a8fd4; }
    #discord-btn:active { transform: scale(0.95); }
    #discord-btn img    { width: 125%; height: 125%; object-fit: contain; display: block; }
  `;
  document.head.appendChild(s);
})();

// ─────────────────────────────────────────────────────────────────────────────
// DOM setup
// ─────────────────────────────────────────────────────────────────────────────
export function ensureDiscordDOM() {
  if (document.getElementById('discord-btn')) return;

  const btn = document.createElement('div');
  btn.id = 'discord-btn';
  btn.title = 'Join our Discord';

  const img = document.createElement('img');
  img.src = './zicons/discord.png';
  img.draggable = false;
  btn.appendChild(img);

  document.body.appendChild(btn);

  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('click', () => {
    window.open('https://discord.gg/udkU4QPTRA', '_blank', 'noopener,noreferrer');
  });
}
