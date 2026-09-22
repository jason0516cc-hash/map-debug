// Floating damage numbers shown when entities take damage
export const damagePopups = [];

function abbreviateNumber(num) {
  if (num < 1000) return num.toString();
  if (num < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

export function spawnDamage(x, y, amount, color = '#ff4444', radius = 0, owner = null) {
  if (!isFinite(amount) || amount === 0) return;

  // Merge with an existing popup for the same entity + damage type within 5 seconds.
  if (owner) {
    const existing = damagePopups.find(p => p.owner === owner && p.color === color);
    if (existing) {
      existing.value += amount;
      existing.text = abbreviateNumber(Math.abs(Math.round(existing.value)));
      existing.t = 0;
      existing.alpha = 1;
      return;
    }
  }

  const text = abbreviateNumber(Math.abs(Math.round(amount)));
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * radius;
  const offsetX = Math.cos(angle) * dist;
  const offsetY = Math.sin(angle) * dist;
  damagePopups.push({
    x,
    y,
    offsetX,
    offsetY,
    text,
    value: amount,
    color,
    owner,
    t: 0,
    lifetime: 5000,
    vy: -0.06,
    bounce: Math.random() * Math.PI * 2,
    alpha: 1
  });
}

export function updateDamagePopups(dt) {
  for (let i = damagePopups.length - 1; i >= 0; i--) {
    const p = damagePopups[i];
    p.t += dt;
    if (p.owner && !p.owner.dead) {
      p.x = p.owner.x + p.offsetX;
      p.y = p.owner.y + p.offsetY;
    } else {
      p.y += p.vy * dt;
    }
    p.bounce += dt * 0.01;
    p.alpha = Math.max(0, 1 - p.t / p.lifetime);
    if (p.t >= p.lifetime) damagePopups.splice(i, 1);
  }
}

import { toScreen } from './camera.js';
import { settings } from './settings.js';
export function drawDamagePopups(ctx, W, H) {
  if (!settings.showDamageNumbers) return;
  for (const p of damagePopups) {
    const bounceOffset = Math.sin(p.bounce) * 2;
    const { sx, sy } = toScreen(p.x, p.y + bounceOffset, W, H);
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.font = `bold ${14 * (window.devicePixelRatio || 1)}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(p.text, sx + 1, sy + 1);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, sx, sy);
    ctx.restore();
  }
}