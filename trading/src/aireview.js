// AI second opinion on each new bot signal (owner's request, 2026-11-15).
// The AI can only SKIP a signal the rules produced. It can never open a trade, pick the side,
// change size, stop or leverage. Any error, timeout or missing key = the rules decide (trade is taken).
// Every skip is recorded and later checked against the market ("would it have won?"),
// so after a few weeks we can see whether the AI actually helps. Nothing here is backtested.
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { STATE_DIR } from './config.js';
import { log } from './notify.js';
import { fngNow } from './fa.js';

const FILE = path.join(STATE_DIR, 'ai-review.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { reviews: [] }; } };
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s, null, 1));

function client() {
  const or = (process.env.OPENROUTER_API_KEY ?? '').trim();
  const oa = (process.env.OPENAI_API_KEY ?? '').trim();
  if (or.startsWith('sk-or-')) return { c: new OpenAI({ apiKey: or, baseURL: 'https://openrouter.ai/api/v1', timeout: 60_000, maxRetries: 1 }), model: (process.env.AI_REVIEW_MODEL ?? process.env.OPENROUTER_MODEL ?? '').trim() || 'openai/gpt-5.6-luna' };
  if (oa.startsWith('sk-') && !oa.startsWith('sk-ant-')) return { c: new OpenAI({ apiKey: oa, timeout: 60_000, maxRetries: 1 }), model: (process.env.AI_REVIEW_MODEL ?? process.env.OPENAI_MODEL ?? '').trim() || 'gpt-4.1-mini' };
  return null;
}

export const aiReviewOn = () => String(process.env.AI_REVIEW ?? 'on').toLowerCase() !== 'off' && !!client();

const r4 = (v) => (Number.isFinite(v) ? +v.toPrecision(6) : null);

// Returns { take: boolean, ...record }. Never throws.
export async function aiReview(cfg, symbol, sig, x, candles) {
  if (!aiReviewOn()) return { take: true, skipped: 'off' };
  const { c, model } = client();
  const i = candles.length - 1;
  const last = candles[i];
  const fng = await fngNow().catch(() => null);
  const bars = candles.slice(-30).map((k) => [new Date(k.t).toISOString().slice(5, 13), r4(k.o), r4(k.h), r4(k.l), r4(k.c)]);
  const facts = {
    symbol, timeframe: cfg.interval, proposed_side: sig.side, rule_reason: sig.reason,
    entry_about: r4(last.c), stop_distance: r4(sig.stopDist), stop_price: r4(sig.side === 'long' ? last.c - sig.stopDist : last.c + sig.stopDist),
    exit: sig.trailAtr ? `ATR trailing stop (${sig.trailAtr} ATR)` : `take profit ${r4(sig.tpDist)} away`,
    ema50: r4(x.ema50?.[i]), ema150: r4(x.ema150?.[i]), ema200: r4(x.ema200[i]), rsi14: r4(x.rsi[i]), adx14: r4(x.adx[i]), atr14: r4(x.atr[i]),
    fear_greed: fng, last_30_bars_ohlc: bars,
  };
  const sys = 'You review one trade signal produced by a rule-based crypto futures bot (paper trading). The rules were backtested 4 years (+295%, PF 1.5, 1 in 3 trades wins, winners run with a trailing stop), so losing trades are normal and you should take most signals. Skip only when the chart clearly argues against it (e.g. entry right into strong opposite level, exhausted move, very wide stop). You cannot change side, size or stop. Answer ONLY JSON: {"decision":"take"|"skip","confidence":0-100,"reason_mm":"one short plain Burmese sentence"}';
  const rec = { t: Date.now(), bar: last.t, symbol, side: sig.side, entry: last.c, stopDist: sig.stopDist, reason: sig.reason, model };
  try {
    const res = await c.chat.completions.create({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(facts) }], max_completion_tokens: 600 });
    const txt = res.choices?.[0]?.message?.content ?? '';
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const minConf = Number(process.env.AI_SKIP_MIN ?? 70) || 70;
    const conf = Math.max(0, Math.min(100, Number(j.confidence) || 0));
    const skip = j.decision === 'skip' && conf >= minConf;
    Object.assign(rec, { decision: skip ? 'skip' : 'take', aiSaid: j.decision, confidence: conf, why: String(j.reason_mm ?? '').slice(0, 300), cost: res.usage?.cost ?? null });
  } catch (e) {
    Object.assign(rec, { decision: 'take', error: String(e.message).slice(0, 200) });
    log(`${symbol} AI review failed (${e.message}); rules decide`);
  }
  const st = read();
  st.reviews.push(rec);
  st.reviews = st.reviews.slice(-500);
  save(st);
  return { take: rec.decision !== 'skip', ...rec };
}

// For skipped signals: would the trade have reached +2R before its stop? (rough check, up to 60 bars)
let lastResolve = 0;
export async function resolveSkipped(ex, interval) {
  if (Date.now() - lastResolve < 3600e3) return; // once an hour is plenty
  lastResolve = Date.now();
  const st = read();
  let changed = false;
  for (const r of st.reviews.filter((v) => v.decision === 'skip' && !v.outcome)) {
    if (Date.now() - r.bar < 8 * 3600e3) continue;
    let ks;
    try { ks = await ex.klines(r.symbol, interval, { startTime: r.bar + 1, limit: 61 }); } catch { continue; }
    const L = r.side === 'long';
    const sl = L ? r.entry - r.stopDist : r.entry + r.stopDist;
    const tp = L ? r.entry + 2 * r.stopDist : r.entry - 2 * r.stopDist;
    for (const k of ks.slice(1)) {
      if (L ? k.l <= sl : k.h >= sl) { r.outcome = 'loss'; break; }
      if (L ? k.h >= tp : k.l <= tp) { r.outcome = 'win'; break; }
    }
    if (!r.outcome && ks.length >= 61) r.outcome = 'flat';
    if (r.outcome) changed = true;
  }
  if (changed) save(st);
}

// Plain Burmese scorecard for Telegram (/ai).
export function aiReviewText() {
  const st = read();
  const all = st.reviews.filter((r) => r.aiSaid || r.error);
  const sk = all.filter((r) => r.decision === 'skip');
  const won = sk.filter((r) => r.outcome === 'win').length, lost = sk.filter((r) => r.outcome === 'loss').length;
  const wait = sk.filter((r) => !r.outcome).length;
  const usd = all.reduce((a, r) => a + (Number(r.cost) || 0), 0);
  return [
    '🤖 AI Signal စစ်ဆေးမှု (AI က Signal ကို ကျော်ခိုင်းလို့ပဲ ရ၊ Trade ဖွင့်ခိုင်းလို့ မရ)',
    `• စစ်ပြီး Signal: ${all.length} ခု · AI ကျော်ခိုင်း: ${sk.length} ခု`,
    `• ကျော်ခဲ့တာတွေ – ဝင်ခဲ့ရင် ရှုံးမှာ ${lost} ခု ✅ (AI မှန်) · နိုင်မှာ ${won} ခု ❌ (AI မှား) · စောင့်ဆဲ ${wait} ခု`,
    ...sk.slice(-5).reverse().map((r) => `   - ${r.symbol.replace('USDT', '')} ${r.side === 'long' ? 'Long' : 'Short'} ${new Date(r.t + 6.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')}: ${r.why || '-'}${r.outcome ? ` → ${r.outcome === 'loss' ? 'ရှုံးမှာ' : r.outcome === 'win' ? 'နိုင်မှာ' : 'ထူးမခြား'}` : ''}`),
    `• AI ကုန်ကျငွေ: $${usd.toFixed(4)}`,
    sk.length < 10 ? 'ℹ️ ကျော်တာ ၁၀ ခု မပြည့်ခင် AI ကောင်း/မကောင်း မဆုံးဖြတ်နိုင်သေးပါ။' : (lost > won ? '📈 အခုထိ AI က အသုံးဝင်ပုံရတယ်။' : '📉 အခုထိ AI ကျော်တာက အမြတ်ကို ဆုံးရှုံးစေပုံရတယ်။ AI_REVIEW=off စဉ်းစားပါ။'),
  ].join('\n');
}
