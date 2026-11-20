// Watches the TikTok channel @dbsmyanmar (the trading teacher zBOT's "brain" strategy was built from)
// and tells the owner about new videos: title, link, and whether it looks like a trading technique.
// Information only: nothing here changes the bot. A new technique needs a backtest before it goes in.
// TikTok blocks plain requests from the VPS, so the video list and titles both come through TinyFish
// (channel page links, and the caption shown on each video's embed player page).
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { pageLinks, readPage, tinyfishOn } from './tinyfish.js';

const FILE = path.join(STATE_DIR, 'dbs-watch.json');
const CHANNEL = 'dbsmyanmar';
const FIRST_SEEN = '7707995173237624065'; // newest video read on 2026-11-15 (research/dbs-myanmar.md)
const TRADING = /candle|pattern|entry|strateg|indicator|rsi|ema|sma|macd|support|resist|zone|trend|stop ?loss|\bsl\b|\btp\b|risk|fibo|breakout|retest|reversal|divergen|volume|bollinger|setup|smc|order block|liquidity|structure|chart|technical|scalp|swing|timeframe|backtest|price action|ဝင်|ထွက်|နည်း|ဈေးကွက်/i;

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { last: FIRST_SEEN, checked: 0 }; } };
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s));

// Video caption from TikTok's embed player page (read through TinyFish; the normal video page is blocked).
async function title(id) {
  try {
    const p = await readPage({ url: `https://www.tiktok.com/player/v1/${id}?description=1` });
    const t = String(p.text ?? '').replace(/\s+/g, ' ');
    const m = t.match(new RegExp(`${CHANNEL}\\s+(.*?)(?:\\s+\\d{2}:\\d{2}/\\d{2}:\\d{2}|$)`));
    return (m?.[1] ?? '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch { return ''; }
}

// Returns a Telegram message when there are new videos, else null.
export async function dbsCheck({ force = false } = {}) {
  if (String(process.env.DBS_WATCH ?? 'on').toLowerCase() === 'off' || !tinyfishOn()) return null;
  const st = read();
  const everyH = Math.max(1, Number(process.env.DBS_WATCH_HOURS ?? 6) || 6);
  if (!force && Date.now() - st.checked < everyH * 3600e3) return null;
  st.checked = Date.now();
  save(st);
  const links = await pageLinks(`https://www.tiktok.com/@${CHANNEL}`);
  const ids = [...new Set(links.map((l) => l.match(new RegExp(`@${CHANNEL}/video/(\\d{15,22})`))?.[1]).filter(Boolean))];
  const fresh = ids.filter((id) => BigInt(id) > BigInt(st.last)).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  if (!fresh.length) return null;
  st.last = fresh.at(-1);
  save(st);
  const rows = [];
  for (const id of fresh.slice(-8)) {
    const t = await title(id);
    rows.push({ id, t, trading: TRADING.test(t) });
  }
  const tr = rows.filter((r) => r.trading);
  return [
    `📺 DBS Myanmar မှာ Video အသစ် ${fresh.length} ခု`,
    '',
    ...rows.map((r) => `${r.trading ? '📈' : '•'} ${r.t || '(ခေါင်းစဉ် မရ)'}\nhttps://www.tiktok.com/@${CHANNEL}/video/${r.id}`),
    '',
    tr.length
      ? `📈 Trading နည်းနဲ့ ဆိုင်ပုံရတာ ${tr.length} ခု။ နည်းအသစ်ဆိုရင် Backtest လုပ်ပြီးမှ Bot ထဲ ထည့်ပါမယ် (Bot က အလိုလို မပြောင်းပါ)။`
      : 'Trading နည်းအသစ် မပါပုံရပါ။',
  ].join('\n');
}
