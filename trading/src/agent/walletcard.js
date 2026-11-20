// "Wallet card" picture for Telegram (/wallet): balance, growth, the bot's own rules, record and an
// equity line from the real trade journal. Real numbers only. English text (resvg can't shape Burmese).
import { Resvg } from '@resvg/resvg-js';
import { botStatus, freshConfig } from './tools.js';
import { journalRows } from '../service.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');

export async function walletCardPng() {
  const s = await botStatus();
  const cfg = freshConfig();
  const c = s.config;
  const rows = journalRows(cfg).filter((r) => Number.isFinite(r.pnl));
  const start = s.equity?.start ?? cfg.startBalance;
  const bal = s.equity?.withOpenPnl ?? null;
  const pnl = Number.isFinite(bal) ? bal - start : null;
  const x = Number.isFinite(bal) && start ? bal / start : null;
  const up = !(pnl < 0);
  const wins = rows.filter((r) => r.pnl > 0).length;
  const W = 1080, H = 640;
  const GOLD = '#fcd535', GREEN = '#0ecb81', RED = '#f6465d', MUTED = '#848e9c', TEXT = '#eaecef';

  // equity line from closed trades (start -> each close -> now)
  let eq = start;
  const pts = [start, ...rows.map((r) => (eq += r.pnl)), ...(Number.isFinite(bal) ? [bal] : [])];
  const lx = 620, ly = 400, lw = 404, lh = 66;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const path = pts.length > 1
    ? pts.map((v, i) => `${i ? 'L' : 'M'}${(lx + (i / (pts.length - 1)) * lw).toFixed(1)},${(ly + lh - ((v - lo) / span) * lh).toFixed(1)}`).join(' ')
    : `M${lx},${ly + lh / 2} L${lx + lw},${ly + lh / 2}`;
  const area = `${path} L${lx + lw},${ly + lh} L${lx},${ly + lh} Z`;
  const lineCol = up ? GREEN : RED;

  const dot = s.bot.running ? (s.bot.paused ? '#f0b90b' : GREEN) : RED;
  const state = s.bot.running ? (s.bot.paused ? 'paused' : 'auto') : 'stopped';
  const live = c.mode === 'live';
  const when = new Date(Date.now() + 6.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' MMT';
  const rules = [`risk ${c.riskPct}% / trade`, `max ${c.maxOpen} open`, ...(c.market === 'futures' ? [`leverage ${c.leverage}x`] : []), `daily stop -${c.dailyLossPct}%`].join('  ·  ');
  const coins = c.symbols.map((q) => q.replace(/USDT$/, '')).join(' · ');
  const stat = (xx, k, v, col = TEXT) => `<text x="${xx}" y="548" font-size="22" fill="${MUTED}">${esc(k)}</text><text x="${xx}" y="584" font-size="30" font-weight="700" fill="${col}">${esc(v)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e2329"/><stop offset="1" stop-color="#0b0e11"/></linearGradient>
  <radialGradient id="glow" cx="0.92" cy="0.05" r="0.6"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.28"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lineCol}" stop-opacity="0.35"/><stop offset="1" stop-color="${lineCol}" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="36" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="36" fill="url(#glow)"/>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="35" fill="none" stroke="#2b3139" stroke-width="3"/>
<g transform="translate(56 50)">
  <path d="M22 0 L30 8 L22 16 L14 8 Z M8 14 L16 22 L8 30 L0 22 Z M36 14 L44 22 L36 30 L28 22 Z M22 28 L30 36 L22 44 L14 36 Z M22 15 L29 22 L22 29 L15 22 Z" fill="${GOLD}"/>
  <text x="62" y="34" font-size="34" font-weight="700" fill="${TEXT}">zBOT</text>
  <rect x="168" y="6" width="190" height="36" rx="8" fill="none" stroke="#474d57" stroke-width="2"/>
  <text x="263" y="31" font-size="20" fill="${MUTED}" text-anchor="middle">${c.market === 'futures' ? 'Futures USDT-M' : 'Spot'}</text>
</g>
<g transform="translate(${W - 56} 50)">
  <rect x="-250" y="0" width="250" height="48" rx="24" fill="#0b0e11" stroke="#2b3139" stroke-width="2"/>
  <circle cx="-222" cy="24" r="8" fill="${dot}"/>
  <text x="-204" y="32" font-size="22" font-weight="700" fill="${TEXT}">${live ? 'LIVE' : 'PAPER'}</text>
  <text x="-24" y="32" font-size="22" fill="${dot}" text-anchor="end">${state}</text>
</g>
<text x="56" y="150" font-size="22" fill="${MUTED}">MY RULES  <tspan fill="${TEXT}" font-weight="700">${esc(rules)}</tspan></text>
<line x1="56" y1="180" x2="${W - 56}" y2="180" stroke="#2b3139" stroke-width="2"/>
<text x="56" y="232" font-size="24" fill="${MUTED}">${live ? 'Wallet Balance (USDT)' : 'Paper Balance (USDT, test money)'}</text>
<text x="${W - 56}" y="232" font-size="22" fill="${MUTED}" text-anchor="end">${esc(when)}</text>
<text x="52" y="340" font-size="104" font-weight="800" fill="${TEXT}" letter-spacing="-3">$${esc(money(bal))}</text>
<text x="56" y="400" font-size="32" font-weight="700" fill="${up ? GREEN : RED}">${pnl === null ? '' : `${up ? '+' : '-'}$${esc(money(Math.abs(pnl)))}`}<tspan dx="16" fill="${MUTED}" font-weight="400">${x ? `${x.toFixed(2)}x · ` : ''}started $${esc(money(start))}</tspan></text>
<path d="${area}" fill="url(#fill)"/>
<path d="${path}" fill="none" stroke="${lineCol}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
<text x="${lx + lw}" y="${ly - 14}" font-size="18" fill="${MUTED}" text-anchor="end">equity · ${rows.length} closed trades</text>
<line x1="56" y1="500" x2="${W - 56}" y2="500" stroke="#2b3139" stroke-width="2"/>
${stat(56, 'Trades', String(rows.length))}
${stat(256, 'Win rate', rows.length ? `${Math.round((wins / rows.length) * 100)}%` : '-')}
${stat(456, 'Open now', `${s.positions?.length ?? 0} / ${c.maxOpen}`)}
${stat(656, 'Coins', coins.length > 26 ? `${c.symbols.length} coins` : coins, GOLD)}
</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }, fitTo: { mode: 'width', value: W } }).render().asPng();
}
