// Opportunity scanner: after each closed 4h candle, run the bot's own strategy on the most traded
// Binance Futures coins that the bot does NOT trade, and tell the owner when one gives a signal.
// ALERTS ONLY (owner's choice): the backtest showed that trading more coins automatically made results
// worse (4 coins +300% / 12 coins +167% / 20 coins +87%), so nothing here opens a position.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { Binance } from '../binance.js';
import { prepare, signalAt } from '../strategies.js';
import { fngNow, sentimentBlock } from '../fa.js';
import { reasonMm, sideMm, sideIcon, priceStr } from '../plain.js';

const FILE = path.join(STATE_DIR, 'scan.json');
const FAPI = 'https://fapi.binance.com';
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|BTCDOM|XAU|XAG|PAXG)/;
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { lastBar: 0, seen: {} }; } };
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s));
const IV_MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };

const getJson = async (p) => {
  const r = await fetch(`${FAPI}${p}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Binance ${p} ${r.status}`);
  return r.json();
};

// Crypto perpetuals only: Binance also lists stocks, gold, oil etc. (underlyingType EQUITY/COMMODITY/...).
async function topCoins(n, exclude) {
  const [info, tick] = await Promise.all([getJson('/fapi/v1/exchangeInfo'), getJson('/fapi/v1/ticker/24hr')]);
  const crypto = new Set(info.symbols.filter((s) => s.underlyingType === 'COIN' && s.contractType === 'PERPETUAL' && s.status === 'TRADING').map((s) => s.symbol));
  return tick
    .filter((t) => crypto.has(t.symbol) && /USDT$/.test(t.symbol) && !SKIP.test(t.symbol) && !exclude.includes(t.symbol))
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, n)
    .map((t) => t.symbol);
}

// Returns [{ symbol, sig, entry, sl, tp2 }] for coins that signal on the last closed bar (once per bar).
// Call it often; it only scans when a new candle has closed.
export async function scanOpportunities(cfg, { force = false } = {}) {
  if (String(process.env.SCAN_ALERTS ?? 'on').toLowerCase() === 'off') return [];
  const ms = IV_MS[cfg.interval] ?? 144e5;
  const barClose = Math.floor(Date.now() / ms) * ms; // open time of the candle now forming = close of the last one
  const st = read();
  if (!force && (st.lastBar >= barClose || Date.now() - barClose < 3 * 60e3)) return []; // wait 3 min after the close
  st.lastBar = barClose;
  save(st);
  const n = Math.min(60, Math.max(5, Number(process.env.SCAN_TOP ?? 20) || 20));
  // Always-checked extras. PAXG (gold token) passed its own backtest 2026-11-15: 66 trades, PF 1.85,
  // out-of-sample PF 1.99, DD 2.3% (only ~1.6y of data). Stocks (NVDA, TSLA, MSTR...) failed (OOS PF 0.76), XAU lost.
  const extra = String(process.env.SCAN_EXTRA ?? 'PAXGUSDT').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]+USDT$/.test(s) && !cfg.symbols.includes(s));
  const coins = [...new Set([...(await topCoins(n, cfg.symbols)), ...extra])];
  const ex = new Binance({ ...cfg, mode: 'paper' });
  const fng = cfg.faFilter ? await fngNow().catch(() => null) : null;
  const out = [];
  for (const s of coins) {
    try {
      const ks = await ex.closedKlines(s, cfg.interval, 400);
      if (ks.length < 260) continue; // too new to judge
      const x = prepare(ks);
      const i = ks.length - 1;
      const sig = signalAt(cfg.strategy, x, i, { ...cfg, symbol: s });
      if (!sig) continue;
      if (cfg.faFilter && sentimentBlock(sig.side, fng)) continue;
      // same coin + same direction again within 24h = the same idea, don't repeat it
      const prev = st.seen[s];
      if (!force && prev && prev.side === sig.side && ks[i].t - prev.t < 24 * 3600e3) continue;
      const entry = ks[i].c, d = sig.side === 'long' ? 1 : -1;
      out.push({ symbol: s, sig, entry, sl: entry - d * sig.stopDist, tp2: entry + d * 2 * sig.stopDist, t: ks[i].t });
    } catch { /* one coin failing must not stop the scan */ }
  }
  // limits so Telegram doesn't get flooded (the list is already ordered by trading volume)
  const today = new Date(Date.now() + 6.5 * 3600e3).toISOString().slice(0, 10);
  if (st.day?.date !== today) st.day = { date: today, n: 0 };
  const perScan = Math.max(1, Number(process.env.SCAN_MAX_ALERTS ?? 3) || 3);
  const perDay = Math.max(1, Number(process.env.SCAN_MAX_DAY ?? 6) || 6);
  const send = force ? out : out.slice(0, Math.max(0, Math.min(perScan, perDay - st.day.n)));
  for (const o of send) st.seen[o.symbol] = { t: o.t, side: o.sig.side };
  if (!force) st.day.n += send.length;
  save(st);
  return send;
}

export function opportunityText(o, cfg) {
  const coin = o.symbol.replace(/USDT$/, '');
  return [
    `🔎 အခွင့်အရေး – ${sideIcon(o.sig.side)} ${coin} ${sideMm(o.sig.side)}`,
    `(Bot က မဝင်ပါ – သတိပေးချက်သာ။ ${cfg.interval} Chart၊ Bot ရဲ့ နည်းအတိုင်း)`,
    '',
    `❓ ဘာကြောင့်: ${reasonMm(o.sig.reason)}`,
    `💵 ဈေး: ${priceStr(o.entry)}`,
    `🛑 Stop-loss ထားသင့်တဲ့နေရာ: ${priceStr(o.sl)}`,
    `🎯 ပထမ ပစ်မှတ် (ရှုံးနိုင်တာရဲ့ ၂ ဆ): ${priceStr(o.tp2)}${o.sig.trailAtr ? '  (Bot ဆိုရင် Stop-loss ကို နောက်က လိုက်ရွှေ့ပြီး ဆက်ကိုင်)' : ''}`,
    '',
    '⚠️ Backtest အရ ဒီ Coin တွေကို Bot အလိုလို ဝင်တာက 4 Coin ထက် ရလဒ်ညံ့တယ်။ ကိုယ်တိုင် ဝင်မယ်ဆိုရင် Risk နည်းနည်း (0.5%) ပဲ ထားပါ။ ငွေကြေးအကြံပေးချက် မဟုတ်ပါ။',
  ].join('\n');
}
