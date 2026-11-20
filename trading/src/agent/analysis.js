import { Binance } from '../binance.js';
import { prepare, signalAt } from '../strategies.js';
import { patternAt } from '../patterns.js';
import { fngNow, fngClass, fngMm } from '../fa.js';

// Plain TA + FA snapshot of one coin, written in Burmese for Telegram (owner and community channel).
// Facts only (trend, levels, indicators, the bot's own rule); it never says "buy" or "sell".

const FAPI = 'https://fapi.binance.com/fapi/v1/';
const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.msg ?? `HTTP ${r.status}`);
  return j;
};
export const normSymbol = (s) => {
  let x = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (x && !x.endsWith('USDT')) x += 'USDT';
  return x;
};
const pf = (v) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));

export async function analyzeCoin(cfg, symbol) {
  const s = normSymbol(symbol);
  if (!s) throw new Error('Coin နာမည် ထည့်ပါ (ဥပမာ /analyze BTC)');
  const ex = new Binance({ ...cfg, market: 'futures', mode: 'paper' });
  let k4, k1d;
  try {
    [k4, k1d] = await Promise.all([ex.closedKlines(s, '4h', 400), ex.closedKlines(s, '1d', 260)]);
  } catch (e) { throw new Error(`${s} ကို Binance Futures မှာ မတွေ့ပါ (${e.message})`); }
  if (k4.length < 220) throw new Error(`${s} က Coin အသစ်မို့ Data မလုံလောက်သေးပါ (4h candle ${k4.length} ခု)`);
  const [t24, prem, fng] = await Promise.all([
    getJson(`${FAPI}ticker/24hr?symbol=${s}`).catch(() => null),
    getJson(`${FAPI}premiumIndex?symbol=${s}`).catch(() => null),
    fngNow(),
  ]);

  const x = prepare(k4), n = k4.length - 1, c = x.c[n];
  const d = prepare(k1d), m = k1d.length - 1;
  const up4 = c > x.ema200[n], upD = Number.isFinite(d.ema200[m]) ? d.c[m] > d.ema200[m] : null;
  const cross = x.ema20[n] > x.ema50[n];
  const rsi = x.rsi[n], adx = x.adx[n], atrPct = (x.atr[n] / c) * 100;
  // nearest levels: 20 and 55 candle high / low on 4h
  const hi20 = Math.max(...x.h.slice(-20)), lo20 = Math.min(...x.l.slice(-20));
  const hi55 = Math.max(...x.h.slice(-55)), lo55 = Math.min(...x.l.slice(-55));
  // newest chart pattern breakout in the last 30 candles
  let pat = null;
  for (let i = n; i > n - 30 && !pat; i--) { const p = patternAt(x, i); if (p) pat = { ...p, ago: n - i }; }
  // what the bot's strategy says on the last candle
  const sig = signalAt(cfg.strategy, x, n, { ...cfg, allowShort: true });

  let score = 0;
  score += up4 ? 1 : -1;
  if (upD !== null) score += upD ? 1 : -1;
  score += cross ? 1 : -1;
  const view = score >= 2 ? '📈 ဈေးတက်လမ်းကြောင်း (Uptrend)' : score <= -2 ? '📉 ဈေးကျလမ်းကြောင်း (Downtrend)' : '↔️ လမ်းကြောင်း မရှင်း (ဘေးတိုက်/ပြောင်းနေ)';
  const rsiMm = rsi >= 70 ? 'အရမ်းတက်ထား (Overbought)' : rsi <= 30 ? 'အရမ်းကျထား (Oversold)' : rsi >= 50 ? 'ဝယ်အား နည်းနည်းသာ' : 'ရောင်းအား နည်းနည်းသာ';
  const adxMm = adx >= 25 ? 'လမ်းကြောင်း အားကောင်း' : adx < 20 ? 'လမ်းကြောင်း အားနည်း' : 'အလယ်အလတ်';
  const ch = t24 ? +t24.priceChangePercent : null;
  const fund = prem ? +prem.lastFundingRate * 100 : null;

  const L = [];
  L.push(`📊 ${s.replace(/USDT$/, '')}/USDT ခွဲခြမ်းစိတ်ဖြာချက် (4h + 1D)`);
  L.push(`💰 ဈေး ${pf(c)}${ch !== null ? ` · 24h ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%` : ''}`);
  L.push('', `🧭 ${view}`);
  L.push(`• 4h: ဈေးက EMA200 ${up4 ? 'အပေါ်' : 'အောက်'} (${pf(x.ema200[n])})`);
  if (upD !== null) L.push(`• 1D: ဈေးက EMA200 ${upD ? 'အပေါ်' : 'အောက်'} (${pf(d.ema200[m])})`);
  L.push(`• EMA20 ${cross ? '>' : '<'} EMA50 (တိုတောင်းချိန် ${cross ? 'တက်' : 'ကျ'}ဘက်)`);
  L.push(`• RSI ${rsi.toFixed(0)}: ${rsiMm}`);
  L.push(`• ADX ${adx.toFixed(0)}: ${adxMm}`);
  L.push(`• ATR ${atrPct.toFixed(2)}% (4h candle တစ်ခုရဲ့ ပျမ်းမျှ လှုပ်ရှားမှု)`);
  L.push('', '🎯 အရေးကြီး ဈေးနှုန်းများ');
  L.push(`• Resistance (ခုခံ): ${pf(hi20)}${hi55 > hi20 ? ` · ${pf(hi55)}` : ''}`);
  L.push(`• Support (ထောက်ကူ): ${pf(lo20)}${lo55 < lo20 ? ` · ${pf(lo55)}` : ''}`);
  if (pat) L.push('', `🔺 Chart pattern: ${pat.name} → ${pat.side === 'long' ? 'အပေါ်' : 'အောက်'}ဘက် ဖောက်ထွက် (${pat.ago ? `candle ${pat.ago} ခု အရင်` : 'နောက်ဆုံး candle'})`);
  L.push('', '🌐 FA / Sentiment');
  if (fng !== null) L.push(`• Fear & Greed ${fng}: ${fngClass(fng)} (${fngMm(fng)})`);
  if (fund !== null) L.push(`• Funding ${fund >= 0 ? '+' : ''}${fund.toFixed(4)}% (${fund > 0.03 ? 'Long များနေ' : fund < 0 ? 'Short များနေ' : 'ပုံမှန်'})`);
  L.push('', `🤖 zBOT (${cfg.strategy}) Signal: ${sig ? `${sig.side === 'long' ? '🟢 LONG' : '🔴 SHORT'} – ${sig.reason}` : 'အခု မရှိပါ'}`);
  L.push('', '⚠️ ငွေရေးကြေးရေး အကြံပြုချက် မဟုတ်ပါ။ ကိုယ်တိုင် စစ်ပြီး ဆုံးဖြတ်ပါ။');
  return { symbol: s, text: L.join('\n') };
}
