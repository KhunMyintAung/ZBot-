import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Fear & Greed index (alternative.me, daily, since 2018). Used as a filter on new trades:
//   no new LONG in "Extreme Greed" (>= 75), no new SHORT in "Extreme Fear" (<= 24).
// 4h combo backtest, 4 coins, 4 years: PF 1.31 -> 1.51, max DD 16.4% -> 9.7%; with fees x2 still PF 1.32.
// Almost all of the gain comes from not shorting into panic.

const FILE = path.join(DATA_DIR, 'fng.json');
const URL_ALL = 'https://api.alternative.me/fng/?limit=0';
const URL_NOW = 'https://api.alternative.me/fng/?limit=1';
export const GREED = 75, FEAR = 24;

export const fngClass = (v) => (v <= 24 ? 'Extreme Fear' : v <= 46 ? 'Fear' : v <= 54 ? 'Neutral' : v <= 74 ? 'Greed' : 'Extreme Greed');
export const fngMm = (v) => ({ 'Extreme Fear': 'အရမ်းကြောက်နေ', Fear: 'ကြောက်နေ', Neutral: 'ကြားနေ', Greed: 'လောဘတက်နေ', 'Extreme Greed': 'အရမ်းလောဘတက်နေ' })[fngClass(v)];

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'zbot' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`F&G HTTP ${r.status}`);
  return (await r.json()).data.map((d) => [Number(d.timestamp) * 1000, Number(d.value)]).sort((a, b) => a[0] - b[0]);
}

// Full history for backtests, cached in data/fng.json (refreshed when older than 12h).
export async function fngHistory() {
  try {
    if (Date.now() - fs.statSync(FILE).mtimeMs < 12 * 3600e3) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* no cache */ }
  try {
    const h = await get(URL_ALL);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(h));
    return h;
  } catch (e) {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    throw e;
  }
}

let now = { t: 0, v: null };
// Today's value for the live bot, cached 30 minutes. Returns null if the site is down.
export async function fngNow() {
  if (Date.now() - now.t < 30 * 60e3 && now.v !== null) return now.v;
  try { const h = await get(URL_NOW); now = { t: Date.now(), v: h.at(-1)[1] }; } catch { if (Date.now() - now.t > 36 * 3600e3) now.v = null; }
  return now.v;
}

export const valueAt = (hist, t) => {
  let lo = 0, hi = hist.length - 1, a = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (hist[m][0] <= t) { a = hist[m][1]; lo = m + 1; } else hi = m - 1; }
  return a;
};

// Reason string when the trade should be skipped, else null. Unknown value -> trade allowed.
export function sentimentBlock(side, v) {
  if (v === null || v === undefined) return null;
  if (side === 'long' && v >= GREED) return `Fear & Greed ${v} (Extreme Greed): no new long`;
  if (side === 'short' && v <= FEAR) return `Fear & Greed ${v} (Extreme Fear): no new short`;
  return null;
}

// Filter for backtestPortfolio (cfg.filter).
export const backtestFilter = (hist) => (sym, sig, t) => !sentimentBlock(sig.side, valueAt(hist, t));
