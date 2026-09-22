/**
 * ChatUI.js — In-game chat bar
 *
 * Format: [Lvl N] Username: message
 * - Lvl badge colored by highest rarity petal in hotbar
 * - Messages slide in from the left, appearing after the button column
 * - Chat positioned bottom-left, starting just right of the icon buttons
 * - Press Enter or click bar to open; Enter/Escape to close
 * - 50 char limit; messages fade 10s after chat closes
 * - Opening chat re-reveals faded/fading messages; closing re-arms their fade
 * - Up/Down arrows while typing cycle through previously sent messages
 * - Closing chat with unsent text keeps that text in the box for next time
 *
 * Chat commands: /speed, /cmds, /set hp, /set dmg, /spawn, /godmode, /give,
 * plus the pre-existing /setwave.
 */

import { player }       from './player.js';
import { hotbar }       from './petals.js';
import { PETAL_TYPES }  from './petalTypes.js';
import { RARITIES, RARITY_TEXT } from './constants.js';

import { mobs, missiles, MOB_DEFS, spawnMobByCommand } from './mobs.js';
import { addToInventory } from './inventory.js';
import { fillMobGallery } from './MobGalleryUI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const MAX_CHARS    = 50;
const FADE_DELAY   = 10000;   // ms after close before fade starts
const FADE_DUR     = 1200;    // ms for CSS fade-out
const MAX_MESSAGES = 50;
const REOPEN_FADE_DELAY = 300; // ms after close before old messages start re-fading (re-close behavior)
const MAX_HISTORY  = 50;      // how many sent messages are kept for up/down recall

// Left edge of buttons column: left:16px, width:54px → right edge = 70px
// Chat starts with a gap after that
const BTN_RIGHT  = 70;
const CHAT_GAP   = 14;   // gap between button column and chat
const CHAT_LEFT  = BTN_RIGHT + CHAT_GAP;   // 84px
const CHAT_W     = 260;  // shorter bar
const BOTTOM_PAD = 24;

// Slide animation: messages start fully left (hidden behind button col) and
// slide right into their resting place. We use a CSS clip + translate trick.
const SLIDE_MS = 380;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let chatOpen = false;
let chatEl   = null;
let inputEl  = null;
let logEl    = null;
let hintEl   = null;

const messages = []; // { el, timerId, faded }

// ── Sent-message history (Up/Down arrow recall) ─────────────────────────────
const history = [];       // most recent last
let historyIndex = -1;    // -1 = not currently browsing history
let draftBeforeHistory = ''; // what was typed before Up was first pressed, restored on Down past the end
let _recallingHistory = false; // guards the 'input' listener against our own value writes

// ─────────────────────────────────────────────────────────────────────────────
// Rarity helpers
// ─────────────────────────────────────────────────────────────────────────────
function rarityTierIndex(rarity) {
  const i = RARITIES.indexOf(rarity);
  return i === -1 ? 0 : i;
}

function highestHotbarRarity() {
  let best = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (!pt?.rarity) continue;
    const t = rarityTierIndex(pt.rarity);
    if (t > best) best = t;
  }
  return RARITIES[best] || 'Common';
}

function rarityColor(rarity) {
  return RARITY_TEXT[rarity] || '#90EE90';
}

// Rainbow gradient for Impracticality level badge
function impracticalityGradient(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0.00, '#ff0000'); g.addColorStop(0.17, '#ff8800');
  g.addColorStop(0.33, '#ffff00'); g.addColorStop(0.50, '#00cc44');
  g.addColorStop(0.67, '#0088ff'); g.addColorStop(0.83, '#8800ff');
  g.addColorStop(1.00, '#ff00cc');
  return g;
}

// Returns inline style color string — for Impracticality we use a CSS gradient
function lvlBadgeStyle(rarity) {
  if (rarity === 'Impracticality') {
    return 'background: linear-gradient(90deg,#ff0000,#ff8800,#ffff00,#00cc44,#0088ff,#8800ff,#ff00cc); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;';
  }
  return `color:${rarityColor(rarity)};`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rarity first-letter resolution (for /spawn and /give)
// ─────────────────────────────────────────────────────────────────────────────
// When a letter matches multiple rarities' first letter, the LOWEST tier wins.
// Built once from RARITIES so it always stays in sync with constants.js.
const RARITY_BY_LETTER = (() => {
  const map = {};
  for (const r of RARITIES) {
    const letter = r[0].toLowerCase();
    if (!(letter in map)) map[letter] = r; // first (lowest-tier) match wins
  }
  return map;
})();

/**
 * Resolves a rarity token typed in chat. Accepts a full rarity name (any case)
 * or a single first letter (lowest matching tier wins on collision).
 * Returns the canonical rarity string, or null if it doesn't match anything.
 */
function resolveRarity(token) {
  if (!token) return null;
  const t = token.toLowerCase();
  const full = RARITIES.find(r => r.toLowerCase() === t);
  if (full) return full;
  if (t.length === 1 && RARITY_BY_LETTER[t]) return RARITY_BY_LETTER[t];
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Petal name resolution (for /give)
// ─────────────────────────────────────────────────────────────────────────────
// Maps a slugified display name ("third-eye") to its base petal id ("third_eye").
const PETAL_NAME_TO_BASE_ID = (() => {
  const map = {};
  for (const [id, entry] of Object.entries(PETAL_TYPES)) {
    if (entry.tier !== 0 && entry.rarity !== 'Common') continue; // only need one (base) entry per petal
    const slug = entry.name.toLowerCase().replace(/\s+/g, '-');
    if (!(slug in map)) map[slug] = id; // tier-0 id === base id for scalable petals; for statics id is already the base id
  }
  return map;
})();

/** Finds the PETAL_TYPES key for a given base petal id + rarity (e.g. 'third_eye' + 'Legendary'). */
function findPetalIdForRarity(baseId, rarity) {
  // Static petals (like honey) only exist at their fixed rarity.
  if (PETAL_TYPES[baseId] && PETAL_TYPES[baseId].rarity === rarity) return baseId;
  for (const [id, entry] of Object.entries(PETAL_TYPES)) {
    // Match by matching name + rarity, since scaled ids use a suffix we don't want to reconstruct by hand.
    if (entry.rarity === rarity) {
      const base = PETAL_TYPES[baseId];
      if (base && entry.name === base.name) return id;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mob name resolution (for /spawn)
// ─────────────────────────────────────────────────────────────────────────────
// "baby-ant" → "baby_ant", matched directly against MOB_DEFS keys.
// A few mobs are internally split into head/body segments that the player
// shouldn't need to know about — alias the plain name to the head typeId.
const MOB_ALIASES = {
  centipede:        'centipede_head',
  desert_centipede: 'desert_centipede_head',
};
function resolveMobTypeId(token) {
  if (!token) return null;
  const key = token.toLowerCase().replace(/-/g, '_');
  if (MOB_ALIASES[key]) return MOB_ALIASES[key];
  return MOB_DEFS[key] ? key : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Number shorthand parsing ("1k", "2.5m", "3b" → numbers)
// ─────────────────────────────────────────────────────────────────────────────
const SUFFIX_MULT = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

function parseShorthandNumber(token) {
  if (!token) return null;
  const m = token.toLowerCase().match(/^(\d+(?:\.\d+)?)([kmbt])?$/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const mult = m[2] ? SUFFIX_MULT[m[2]] : 1;
  return base * mult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export function isChatOpen() { return chatOpen; }

export function ensureChatDOM() {
  if (chatEl) return;
  injectStyles();

  // Outer wrapper — clips the log so messages slide in from the left
  chatEl = document.createElement('div');
  chatEl.id = 'chat-wrap';
  document.body.appendChild(chatEl);

  // Message log
  logEl = document.createElement('div');
  logEl.id = 'chat-log';
  chatEl.appendChild(logEl);

  // Input row
  const row = document.createElement('div');
  row.id = 'chat-input-row';
  chatEl.appendChild(row);

  hintEl = document.createElement('span');
  hintEl.id = 'chat-hint';
  hintEl.textContent = '[ENTER] to chat...';
  row.appendChild(hintEl);

  inputEl = document.createElement('input');
  inputEl.id           = 'chat-input';
  inputEl.type         = 'text';
  inputEl.maxLength    = MAX_CHARS;
  inputEl.autocomplete = 'off';
  inputEl.spellcheck   = false;
  row.appendChild(inputEl);

  row.addEventListener('mousedown', e => {
    e.stopPropagation();
    if (!chatOpen) openChat();
  });
  logEl.addEventListener('mousedown',  e => e.stopPropagation());
  inputEl.addEventListener('mousedown', e => e.stopPropagation());
  // Let the log be scrolled to browse past messages while chat is open.
  logEl.addEventListener('wheel', e => { e.stopPropagation(); }, { passive: true });

  inputEl.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text.length > 0) {
        pushToHistory(text);
        submitMessage(text);
      }
      closeChat({ clearInput: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeChat({ clearInput: false });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      recallHistory(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      recallHistory(1);
    }
  });

  // Real typing (not our own programmatic recall writes) resets history browsing
  inputEl.addEventListener('input', () => {
    if (_recallingHistory) return;
    if (historyIndex !== -1) historyIndex = -1;
  });

  // Click anywhere outside the chat wrapper → close, preserving any typed text
  document.addEventListener('mousedown', e => {
    if (!chatOpen) return;
    if (chatEl.contains(e.target)) return;
    closeChat({ clearInput: false });
  });

  positionChat();
}

export function onEnterKey() {
  if (chatOpen) return true;
  openChat();
  return true;
}

export function positionChat() {
  if (!chatEl) return;
  chatEl.style.left   = CHAT_LEFT + 'px';
  chatEl.style.width  = CHAT_W + 'px';
  chatEl.style.bottom = BOTTOM_PAD + 'px';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sent-message history (Up/Down arrow recall)
// ─────────────────────────────────────────────────────────────────────────────
function pushToHistory(text) {
  history.push(text);
  while (history.length > MAX_HISTORY) history.shift();
  historyIndex = -1;
}

/** dir: -1 for Up (older), +1 for Down (newer) */
function recallHistory(dir) {
  if (history.length === 0) return;

  if (historyIndex === -1) {
    if (dir > 0) return; // Down with nothing recalled yet — nothing to do
    draftBeforeHistory = inputEl.value;
    historyIndex = history.length - 1;
  } else {
    historyIndex += dir;
  }

  _recallingHistory = true;
  try {
    if (historyIndex < 0) {
      historyIndex = 0;
    } else if (historyIndex >= history.length) {
      // Walked past the newest recalled message — restore the in-progress draft
      historyIndex = -1;
      inputEl.value = draftBeforeHistory;
      const v = inputEl.value;
      inputEl.setSelectionRange(v.length, v.length);
      return;
    }

    inputEl.value = history[historyIndex];
    const v = inputEl.value;
    inputEl.setSelectionRange(v.length, v.length);
  } finally {
    _recallingHistory = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────────────
function openChat() {
  chatOpen = true;
  chatEl.classList.add('open');
  hintEl.style.display  = 'none';
  inputEl.style.display = 'block';

  // Re-reveal every message, including ones that had fully faded out —
  // nothing is deleted from the log just by opening chat. Messages that were
  // already faded/fading get flagged so the NEXT close re-fades them quickly
  // (0.3s) instead of waiting the full FADE_DELAY again.
  for (const m of messages) {
    if (m.faded || m.el.classList.contains('fading')) m.wasReopened = true;
    clearTimeout(m.timerId);
    m.el.classList.remove('fading');
    m.el.style.opacity = '1';
    m.faded = false;
  }

  // Scroll to the newest message so re-appeared history doesn't leave the view stranded.
  logEl.scrollTop = logEl.scrollHeight;

  // Restore whatever was left in the box last time chat closed with unsent text.
  requestAnimationFrame(() => {
    inputEl.focus();
    const v = inputEl.value;
    inputEl.setSelectionRange(v.length, v.length);
  });
}

/**
 * @param {Object} opts
 * @param {boolean} opts.clearInput - true after a real submit (Enter with text); false to
 *   preserve whatever's currently typed (Escape, click-away, or Enter on an empty box).
 */
function closeChat({ clearInput } = { clearInput: true }) {
  chatOpen = false;
  chatEl.classList.remove('open');
  if (clearInput) inputEl.value = '';
  inputEl.style.display = 'none';
  hintEl.style.display  = 'block';
  inputEl.blur();
  historyIndex = -1;
  // Messages that had already faded once (and were re-revealed by opening chat)
  // fade back out quickly; anything sent fresh this session gets the normal delay.
  messages.forEach(m => armFade(m, m.wasReopened ? REOPEN_FADE_DELAY : FADE_DELAY));
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat commands
// ─────────────────────────────────────────────────────────────────────────────
// Reference list shown by /cmds — kept next to the handlers so it can't drift.
const COMMAND_HELP = [
  { usage: '/speed {num}',                         desc: 'Set speed multiplier, e.g. /speed 2.5 = 2.5x' },
  { usage: '/set hp {num}',                        desc: 'Add bonus max HP, e.g. /set hp 1k' },
  { usage: '/set dmg {num}',                        desc: 'Add bonus body damage, e.g. /set dmg 500' },
  { usage: '/spawn {mob} {rarity} {boss?}',         desc: 'Spawn a mob near you, e.g. /spawn baby-ant l boss' },
  { usage: '/give {petal} {rarity?} {count?}',      desc: 'Add petals to inventory, e.g. /give third-eye m 3' },
  { usage: '/godmode',                              desc: 'Toggle unkillable mode' },
  { usage: '/fullindex',                            desc: 'Unlock every mob in the gallery' },
  { usage: '/setwave {num}',                        desc: 'Skip to a given wave' },
  { usage: '/cmds',                                 desc: 'Show this list' },
];

/** Splits "1k", "2.5m" etc. and validates it parsed to a positive finite number. */
function parseNumArg(raw, label) {
  const n = parseShorthandNumber(raw);
  if (n === null || !isFinite(n) || n < 0) {
    pushSystemMessage(`Invalid ${label}: "${raw}". Try a number like 100, 1k, or 2.5m.`);
    return null;
  }
  return n;
}

/** Returns true if `text` was a recognized command (handled, whether it succeeded or errored). */
function handleChatCommand(text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  // ── /speed {num} ──────────────────────────────────────────────────────────
  if (cmd === '/speed') {
    if (!parts[1]) { pushSystemMessage(`Usage: /speed {num} — e.g. /speed 2.5`); return true; }
    const mult = parseFloat(parts[1]);
    if (isNaN(mult) || !isFinite(mult) || mult < 0) {
      pushSystemMessage(`Invalid speed: "${parts[1]}". Try a number like 2 or 2.5.`);
      return true;
    }
    player._speedMult = mult;
    pushSystemMessage(`Speed set to ${mult}x.`);
    return true;
  }

  // ── /cmds ─────────────────────────────────────────────────────────────────
  if (cmd === '/cmds') {
    pushCommandList();
    return true;
  }

  // ── /godmode ─────────────────────────────────────────────────────────────
  if (cmd === '/godmode') {
    player.godmode = !player.godmode;
    pushSystemMessage(`Godmode ${player.godmode ? 'enabled' : 'disabled'}.`);
    return true;
  }

  // ── /fullindex ───────────────────────────────────────────────────────────
  if (cmd === '/fullindex') {
    fillMobGallery();
    pushSystemMessage(`Mob gallery fully unlocked.`);
    return true;
  }

  // ── /set hp {num} | /set dmg {num} ──────────────────────────────────────
  if (cmd === '/set') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub !== 'hp' && sub !== 'dmg') {
      pushSystemMessage(`Usage: /set hp {num} or /set dmg {num}`);
      return true;
    }
    if (!parts[2]) {
      pushSystemMessage(`Usage: /set ${sub} {num} — e.g. /set ${sub} 1k`);
      return true;
    }
    const amount = parseNumArg(parts[2], sub === 'hp' ? 'HP amount' : 'damage amount');
    if (amount === null) return true;

    if (sub === 'hp') {
      player._hpBonus = amount;
      pushSystemMessage(`Bonus max HP set to +${amount.toLocaleString()}.`);
    } else {
      player._dmgBonus = amount;
      pushSystemMessage(`Bonus body damage set to +${amount.toLocaleString()}.`);
    }
    return true;
  }

  // ── /spawn {mob} {rarity} {boss?} ───────────────────────────────────────
  if (cmd === '/spawn') {
    if (!parts[1]) {
      pushSystemMessage(`Usage: /spawn {mobname} {rarity} {boss?} — e.g. /spawn baby-ant l boss`);
      return true;
    }
    const typeId = resolveMobTypeId(parts[1]);
    if (!typeId) {
      pushSystemMessage(`Unknown mob "${parts[1]}". Use dashes for spaces, e.g. baby-ant, queen-ant.`);
      return true;
    }

    let rarityToken = parts[2];
    let isBoss = false;
    // "boss" may appear as the rarity slot (rarity omitted) or after it.
    if (rarityToken && rarityToken.toLowerCase() === 'boss') {
      isBoss = true;
      rarityToken = undefined;
    }
    if (parts[3] && parts[3].toLowerCase() === 'boss') isBoss = true;

    let rarity = 'Common';
    if (rarityToken) {
      const resolved = resolveRarity(rarityToken);
      if (!resolved) {
        pushSystemMessage(`Unknown rarity "${rarityToken}". Use a full name or first letter, e.g. l for Legendary.`);
        return true;
      }
      rarity = resolved;
    }
    const tier = RARITIES.indexOf(rarity);

    const id = spawnMobByCommand(typeId, tier, isBoss, player.x, player.y);
    if (id === null) {
      pushSystemMessage(`Failed to spawn "${parts[1]}" — no room nearby.`);
      return true;
    }
    const mobDef = MOB_DEFS[typeId];
    pushSystemMessage(`Spawned ${isBoss ? 'boss ' : ''}${rarity} ${mobDef.name}.`);
    return true;
  }

  // ── /give {petal-name} {rarity?} {count?} ───────────────────────────────
  if (cmd === '/give') {
    if (!parts[1]) {
      pushSystemMessage(`Usage: /give {petal-name} {rarity?} {count?} — e.g. /give third-eye m 3`);
      return true;
    }
    const slug = parts[1].toLowerCase();
    const baseId = PETAL_NAME_TO_BASE_ID[slug];
    if (!baseId) {
      pushSystemMessage(`Unknown petal "${parts[1]}". Use dashes for spaces, e.g. third-eye.`);
      return true;
    }

    let rarity = 'Common';
    if (parts[2]) {
      const resolved = resolveRarity(parts[2]);
      if (!resolved) {
        pushSystemMessage(`Unknown rarity "${parts[2]}". Use a full name or first letter, e.g. l for Legendary.`);
        return true;
      }
      rarity = resolved;
    }

    let count = 1;
    if (parts[3]) {
      const n = parseShorthandNumber(parts[3]);
      if (n === null || !isFinite(n) || n < 1) {
        pushSystemMessage(`Invalid count: "${parts[3]}".`);
        return true;
      }
      count = Math.min(9999, Math.floor(n));
    }

    const petalId = findPetalIdForRarity(baseId, rarity);
    if (!petalId) {
      pushSystemMessage(`${PETAL_TYPES[baseId].name} doesn't exist at ${rarity} rarity.`);
      return true;
    }

    for (let i = 0; i < count; i++) addToInventory(petalId);
    pushSystemMessage(`Gave ${count}x ${rarity} ${PETAL_TYPES[baseId].name}.`);
    return true;
  }

  // ── /petals {rarity} ──────────────────────────────────────────────────────
  // Gives one of every known petal at the given rarity. Rarities that a given
  // petal doesn't exist at (e.g. a static petal fixed to one rarity) are
  // silently skipped for that petal, same tolerance /give already has.
  if (cmd === '/petals') {
    if (!parts[1]) {
      pushSystemMessage(`Usage: /petals {rarity} — e.g. /petals legendary or /petals l`);
      return true;
    }
    const rarity = resolveRarity(parts[1]);
    if (!rarity) {
      pushSystemMessage(`Unknown rarity "${parts[1]}". Use a full name or first letter, e.g. l for Legendary.`);
      return true;
    }

    const baseIds = [...new Set(Object.values(PETAL_NAME_TO_BASE_ID))];
    let given = 0, skipped = 0;
    for (const baseId of baseIds) {
      const petalId = findPetalIdForRarity(baseId, rarity);
      if (!petalId) { skipped++; continue; }
      addToInventory(petalId);
      given++;
    }
    pushSystemMessage(`Gave 1x ${rarity} of ${given} petal${given === 1 ? '' : 's'}${skipped ? ` (${skipped} don't exist at that rarity)` : ''}.`);
    return true;
  }

  // Unknown slash command — let /cmds be the discoverability path rather than
  // silently swallowing it as a chat message.
  pushSystemMessage(`Unknown command "${cmd}". Type /cmds to see the list.`);
  return true;
}

/** Renders the /cmds output as a single clean, organized system message block. */
function pushCommandList() {
  if (!logEl) return;
  const el = document.createElement('div');
  el.className = 'chat-msg chat-cmds';

  const title = document.createElement('div');
  title.className = 'chat-cmds-title';
  title.textContent = 'Commands';
  el.appendChild(title);

  const list = document.createElement('div');
  list.className = 'chat-cmds-list';
  for (const { usage, desc } of COMMAND_HELP) {
    const row = document.createElement('div');
    row.className = 'chat-cmds-row';

    const usageSpan = document.createElement('span');
    usageSpan.className = 'chat-cmds-usage';
    usageSpan.textContent = usage;

    const descSpan = document.createElement('span');
    descSpan.className = 'chat-cmds-desc';
    descSpan.textContent = desc;

    row.appendChild(usageSpan);
    row.appendChild(descSpan);
    list.appendChild(row);
  }
  el.appendChild(list);

  el.style.transform = `translateX(-${CHAT_LEFT + CHAT_W}px)`;
  el.style.opacity   = '0';
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${SLIDE_MS}ms ease`;
      el.style.transform  = 'translateX(0)';
      el.style.opacity    = '1';
    });
  });

  const msg = { el, timerId: null, faded: false, wasReopened: false };
  messages.push(msg);
  while (messages.length > MAX_MESSAGES) {
    const old = messages.shift();
    clearTimeout(old.timerId);
    old.el.remove();
  }
  armFade(msg);
}

function submitMessage(text) {
  // ── Chat commands ────────────────────────────────────────────────────────
  if (text.startsWith('/') && handleChatCommand(text)) return;
  // ────────────────────────────────────────────────────────────────────────

  const username = (player.name && player.name.trim().length > 0)
    ? player.name.trim() : 'Unnamed';
  const level    = player.level ?? 1;
  const rarity   = highestHotbarRarity();
  const color    = rarityColor(rarity);
  const isImprac = rarity === 'Impracticality';

  const el = document.createElement('div');
  el.className = 'chat-msg';

  // Level badge
  const lvlSpan = document.createElement('span');
  lvlSpan.className = 'chat-lvl';
  if (isImprac) {
    lvlSpan.style.cssText = 'background:linear-gradient(90deg,#ff0000,#ff8800,#ffff00,#00cc44,#0088ff,#8800ff,#ff00cc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';
  } else {
    lvlSpan.style.color = color;
  }
  lvlSpan.textContent = `[Lvl ${level}]`;

  // Separator space
  const sep = document.createTextNode(' ');

  // Username
  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-name';
  nameSpan.textContent = username + ': ';

  // Message text
  const textSpan = document.createElement('span');
  textSpan.className = 'chat-text';
  textSpan.textContent = text;

  el.appendChild(lvlSpan);
  el.appendChild(sep);
  el.appendChild(nameSpan);
  el.appendChild(textSpan);

  // Start off-screen to the left for slide-in
  el.style.transform = `translateX(-${CHAT_LEFT + CHAT_W}px)`;
  el.style.opacity   = '0';

  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;

  // Trigger slide-in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${SLIDE_MS}ms ease`;
      el.style.transform  = 'translateX(0)';
      el.style.opacity    = '1';
    });
  });

  const msg = { el, timerId: null, faded: false, wasReopened: false };
  messages.push(msg);

  while (messages.length > MAX_MESSAGES) {
    const old = messages.shift();
    clearTimeout(old.timerId);
    old.el.remove();
  }
}

function armFade(msg, delay = FADE_DELAY) {
  clearTimeout(msg.timerId);
  msg.el.classList.remove('fading');
  msg.el.style.opacity = '1';
  msg.faded = false;
  msg.timerId = setTimeout(() => {
    msg.el.classList.add('fading');
    msg.timerId = setTimeout(() => {
      msg.faded = true;
    }, FADE_DUR + 50);
  }, delay);
}

// ─────────────────────────────────────────────────────────────────────────────
// System message (chat commands / server notices)
// ─────────────────────────────────────────────────────────────────────────────
function pushSystemMessage(text) {
  if (!logEl) return;
  const el = document.createElement('div');
  el.className = 'chat-msg';

  const textSpan = document.createElement('span');
  textSpan.className = 'chat-text';
  textSpan.style.cssText = 'color:#adf; font-style:italic;';
  textSpan.textContent = `[System] ${text}`;
  el.appendChild(textSpan);

  el.style.transform = `translateX(-${CHAT_LEFT + CHAT_W}px)`;
  el.style.opacity   = '0';
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${SLIDE_MS}ms ease`;
      el.style.transform  = 'translateX(0)';
      el.style.opacity    = '1';
    });
  });

  const msg = { el, timerId: null, faded: false, wasReopened: false };
  messages.push(msg);
  while (messages.length > MAX_MESSAGES) {
    const old = messages.shift();
    clearTimeout(old.timerId);
    old.el.remove();
  }
  armFade(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #chat-wrap {
      position: fixed;
      z-index: 60;
      display: flex;
      flex-direction: column;
      gap: 0;
      pointer-events: none;
      font-family: 'UbuntuCustom', 'Ubuntu', Arial, sans-serif;
      /* Clip so slide-in messages don't bleed left into the button column */
      overflow: hidden;
    }

    #chat-log {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 160px;
      overflow-y: hidden;
      overflow-x: hidden;
      padding: 0 0 5px 0;
      pointer-events: none;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.25) transparent;
    }

    /* Only scrollable (and interactive) while chat is open — otherwise it
       would eat mouse/wheel input over the game world. */
    #chat-wrap.open #chat-log {
      overflow-y: auto;
      pointer-events: auto;
    }

    #chat-log::-webkit-scrollbar { width: 5px; }
    #chat-log::-webkit-scrollbar-track { background: transparent; }
    #chat-log::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.25);
      border-radius: 3px;
    }

    .chat-msg {
      display: inline-block;
      align-self: flex-start;
      background: rgba(10, 14, 28, 0.75);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      line-height: 1.45;
      color: #e8e8f0;
      max-width: 100%;
      word-break: break-word;
      pointer-events: none;
      /* fade-out transition (slide-in transition set inline per-message) */
      transition: opacity ${FADE_DUR}ms ease;
    }

    .chat-msg.fading { opacity: 0 !important; }

    /* ── /cmds command list ─────────────────────────────────────────────── */
    .chat-cmds {
      padding: 6px 9px 7px 9px;
      background: rgba(10, 14, 28, 0.88);
      border: 1px solid rgba(125, 232, 168, 0.25);
    }

    .chat-cmds-title {
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #7de8a8;
      margin-bottom: 4px;
    }

    .chat-cmds-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .chat-cmds-row {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .chat-cmds-usage {
      font-family: 'Consolas', 'Menlo', monospace;
      font-size: 11px;
      font-weight: 700;
      color: #ffe08a;
      word-break: break-word;
    }

    .chat-cmds-desc {
      font-size: 11px;
      color: #b8b8cc;
      padding-left: 6px;
      word-break: break-word;
    }

    .chat-lvl {
      font-weight: 700;
      font-size: 11px;
    }

    .chat-name {
      font-weight: 700;
      color: #c8c8e8;
    }

    .chat-text { color: #e8e8f0; }

    #chat-input-row {
      display: flex;
      align-items: center;
      background: rgba(10, 14, 28, 0.60);
      border: 2px solid rgba(255,255,255,0.10);
      border-radius: 7px;
      padding: 4px 9px;
      cursor: text;
      pointer-events: auto;
      transition: border-color 0.15s, background 0.15s;
    }

    #chat-wrap.open #chat-input-row {
      background: rgba(10, 14, 28, 0.90);
      border-color: rgba(125, 232, 168, 0.50);
    }

    #chat-input-row:hover { border-color: rgba(255,255,255,0.22); }

    #chat-hint {
      font-size: 12px;
      color: rgba(200, 200, 220, 0.50);
      user-select: none;
      pointer-events: none;
    }

    #chat-input {
      display: none;
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      font-family: 'UbuntuCustom', 'Ubuntu', Arial, sans-serif;
      font-size: 12px;
      color: #e8e8f0;
      caret-color: #7de8a8;
      width: 100%;
    }

    #chat-input::placeholder { color: rgba(200,200,220,0.30); }
  `;
  document.head.appendChild(s);
}