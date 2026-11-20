// Paper (virtual money) forward test of the "buy the dip" Spot rules in src/dca.js.
// Nothing here places orders: prices come from Binance's public ticker, the money is imaginary.
// One decision per week (Myanmar week, Monday), the same rule the backtest used.
// After DCA_DAYS (default 7) it sends one summary that explains the technique and the result.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { decide, step, newPortfolio, value } from '../dca.js';
import { fngNow } from '../fa.js';

const FILE = path.join(STATE_DIR, 'paper-dca.json');
const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const RULES = ['plain', 'fear', 'fearTP'];
const RULE_MM = {
  plain: 'ရိုးရိုး DCA (အပတ်တိုင်း ဝယ်)',
  fear: 'ကြောက်မှ ဝယ် (F&G ≤ 30)',
  fearTP: 'ကြောက်မှ ဝယ် + လောဘကြီးရင် 20% ရောင်း',
};
const mood = (f) => (f == null ? 'မသိရ' : f <= 20 ? 'အရမ်းကြောက်' : f <= 30 ? 'ကြောက်' : f < 55 ? 'ပုံမှန်' : f < 75 ? 'လောဘ' : 'အရမ်းလောဘကြီး');
const MM_MS = 6.5 * 3600e3;
const weekKey = (t) => { const d = new Date(t + MM_MS); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const usd = (x) => `${x >= 0 ? '' : '-'}$${Math.abs(x).toFixed(2)}`;
const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
const px = (x) => (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(4));

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s, null, 1));

async function prices() {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(COINS))}`);
  if (!r.ok) throw new Error(`Binance ticker ${r.status}`);
  return Object.fromEntries((await r.json()).map((x) => [x.symbol, +x.price]));
}

function fresh(now) {
  const unit = Math.max(1, Number(process.env.DCA_UNIT ?? 10) || 10);
  const days = Math.max(1, Number(process.env.DCA_DAYS ?? 7) || 7);
  return {
    start: now, unit, summaryAt: now + days * 864e5, summarySent: false, lastWeek: null,
    pf: Object.fromEntries(RULES.map((r) => [r, Object.fromEntries(COINS.map((c) => [c, newPortfolio()]))])),
    firstPrice: null, history: [],
  };
}

// Totals for one rule across the coins.
function totals(st, rule, p) {
  let inv = 0, val = 0;
  for (const c of COINS) { const pf = st.pf[rule][c]; inv += pf.invested; val += value(pf, p[c]); }
  return { inv, val, pnl: val - inv, pct: inv ? (val / inv - 1) * 100 : 0 };
}

// Called every few minutes by the agent. Returns messages to send to the owner (may be empty).
export async function dcaTick(now = Date.now()) {
  if (String(process.env.DCA_PAPER ?? 'on').toLowerCase() === 'off') return [];
  let st = read() ?? fresh(now);
  const out = [];
  const wk = weekKey(now);
  if (st.lastWeek !== wk) {
    const [f, p] = await Promise.all([fngNow(), prices()]);
    if (f == null) return []; // try again next tick
    st.firstPrice ??= p;
    const lines = [];
    for (const rule of RULES) {
      const acts = [];
      for (const c of COINS) {
        const d = step(st.pf[rule][c], { price: p[c], fng: f, unit: st.unit, rule });
        if (d.buyUnits) acts.push(`${c.replace('USDT', '')} ${usd(d.buyUnits * st.unit)} ဝယ်`);
        if (d.sellPct) acts.push(`${c.replace('USDT', '')} 20% ရောင်း`);
      }
      lines.push(`• ${RULE_MM[rule]}: ${acts.length ? acts.join('၊ ') : 'ဒီအပတ် ဘာမှမလုပ် (ငွေသိမ်းထား)'}`);
    }
    st.history.push({ t: now, week: wk, fng: f, prices: p });
    st.lastWeek = wk;
    save(st);
    out.push([
      `🧪 Buy the Dip စမ်းသပ်မှု (ငွေအတု) – အပတ် ${wk}`,
      `စျေးကွက်စိတ်: Fear & Greed ${f} (${mood(f)})`,
      `ဈေး: ${COINS.map((c) => `${c.replace('USDT', '')} ${px(p[c])}`).join(' | ')}`,
      '',
      ...lines,
      '',
      'ℹ️ ငွေအစစ် မသုံးပါ။ /dca နဲ့ ရလဒ်ကြည့်ပါ။',
    ].join('\n'));
  }
  if (!st.summarySent && now >= st.summaryAt) {
    out.push(await dcaSummary(st));
    st.summarySent = true;
    save(st);
  }
  return out;
}

export async function dcaStatus() {
  const st = read();
  if (!st) return '🧪 Buy the Dip စမ်းသပ်မှု မစရသေးပါ (မကြာခင် အလိုလို စပါမယ်)။';
  const p = await prices();
  const f = await fngNow();
  const days = ((Date.now() - st.start) / 864e5).toFixed(1);
  const rows = RULES.map((r) => { const t = totals(st, r, p); return `• ${RULE_MM[r]}\n   ထည့်ငွေ ${usd(t.inv)} → ယခု ${usd(t.val)} (${t.inv ? pct(t.pct) : 'မဝယ်ရသေး'})`; });
  return [
    `🧪 Buy the Dip စမ်းသပ်မှု (ငွေအတု) – ${days} ရက်ရှိပြီ`,
    `ယခု Fear & Greed: ${f ?? '?'} (${mood(f)})`,
    `ဆုံးဖြတ်ချက် ${st.history.length} ကြိမ် (အပတ်တိုင်း တနင်္လာနေ့)`,
    '',
    ...rows,
    '',
    st.summarySent ? '✅ ၁ ပတ်ပြည့် အနှစ်ချုပ် ပို့ပြီးပါပြီ။' : `📅 အနှစ်ချုပ် ပို့မယ့်ရက်: ${new Date(st.summaryAt + MM_MS).toISOString().slice(0, 16).replace('T', ' ')} (မြန်မာစံတော်ချိန်)`,
  ].join('\n');
}

// One-week report: what the technique is, what the backtest said, what happened in paper.
export async function dcaSummary(st = read()) {
  if (!st) return 'စမ်းသပ်မှု မရှိသေးပါ။';
  const p = await prices();
  const f = await fngNow();
  const rows = RULES.map((r) => { const t = totals(st, r, p); return `• ${RULE_MM[r]}: ထည့်ငွေ ${usd(t.inv)} → ${usd(t.val)} (${t.inv ? `${usd(t.pnl)}, ${pct(t.pct)}` : 'မဝယ်ရ'})`; });
  const moves = COINS.map((c) => `${c.replace('USDT', '')} ${pct((p[c] / st.firstPrice[c] - 1) * 100)}`).join(' | ');
  const fngs = st.history.map((h) => h.fng).join(' → ');
  return [
    '📘 Buy the Dip နည်း – ၁ ပတ် အနှစ်ချုပ် (ငွေအတု စမ်းသပ်မှု)',
    '',
    '🔎 နည်းစနစ် (Technique)',
    '• Spot ပဲ ဝယ်တယ် (Leverage မသုံး) → Liquidation မရှိ၊ ဈေးကျလည်း မပျက်စီး။',
    '• အပတ်တိုင်း တနင်္လာနေ့ တစ်ခါ Fear & Greed (စျေးကွက်စိတ်) ကို ကြည့်တယ်။',
    '• F&G 30 အောက် (လူတွေကြောက်နေ) ဆိုမှ ပုံမှန်ပမာဏ ဝယ်တယ်။ မကြောက်ရင် ငွေကို သိမ်းထားတယ်။',
    '• (TP ပုံစံ) F&G 75 အထက် (လူတွေ လောဘကြီး) ဆိုရင် ကိုင်ထားတာ 20% ရောင်းပြီး အမြတ်သိမ်းတယ်။',
    '• ဈေးကို ခန့်မှန်းစရာ မလို၊ အောက်ဆုံးကို စောင့်စရာ မလို – စည်းကမ်းအတိုင်း ခွဲဝယ်တာပဲ။',
    '',
    '📊 Backtest (2018–ယခု, BTC/ETH/SOL/BNB, အပတ်စဉ် $10)',
    '• ရိုးရိုး DCA: +560%  |  ကြောက်မှဝယ်: +650%  |  ကြောက်မှဝယ်+TP: +108%',
    '• နောက်ဆုံး ၄ နှစ်: ရိုးရိုး +17% | ကြောက်မှဝယ် +18% | ကြောက်မှဝယ်+TP +58% (အကျဆုံး -12% သာ)',
    '• နောက်ဆုံး ၂ နှစ် (ဈေးကျကာလ): အားလုံး ရှုံး၊ ဒါပေမယ့် ကြောက်မှဝယ် နည်းက -18% (ရိုးရိုး -29%)',
    '• သင်ခန်းစာ: ဈေးကျချိန်မှာ ရှုံးတာ နည်းတယ်၊ ပြန်တက်ချိန်မှာ ရာခိုင်နှုန်း ပိုမြတ်တယ်။ ဒါပေမယ့် ငွေ နည်းနည်းပဲ ထည့်ရတဲ့အတွက် ဒေါ်လာ အမြတ်စုစုပေါင်းက ရိုးရိုး DCA ထက် နည်းနိုင်တယ်။ TP က တက်ကြမ်းကြီးတွေမှာ စောရောင်းမိလို့ ရေရှည် ၈ နှစ်မှာ နောက်ကျတယ်။',
    '',
    `🧪 ဒီ ${((Date.now() - st.start) / 864e5).toFixed(0)} ရက် ငွေအတု ရလဒ်`,
    `• F&G: ${fngs} → ယခု ${f ?? '?'}`,
    `• ဈေးပြောင်းလဲမှု: ${moves}`,
    ...rows,
    '',
    '⚠️ ၁ ပတ်ဆိုတာ ဒီနည်းအတွက် အရမ်းတိုပါတယ် (ဆုံးဖြတ်ချက် ၁–၂ ကြိမ်ပဲ)။ ဒီနည်းက လ/နှစ် နဲ့ တိုင်းရတာပါ။ ဒါက Backtest နဲ့ စမ်းသပ်မှု အချက်အလက်သာ ဖြစ်ပြီး ငွေကြေးအကြံပေးချက် မဟုတ်ပါ။',
    'စမ်းသပ်မှုကို ဆက်လုပ်နေပါတယ် – /dca နဲ့ အမြဲကြည့်လို့ရပါတယ်။',
  ].join('\n');
}

export { decide };

// Small snapshot for /status and the dashboard. Never throws (null when there is no data).
export async function dcaSnapshot() {
  try {
    const st = read();
    if (!st) return null;
    const p = await prices();
    return { days: +((Date.now() - st.start) / 864e5).toFixed(1), rules: RULES.map((r) => ({ rule: r, name: RULE_MM[r], ...totals(st, r, p) })) };
  } catch { return null; }
}
