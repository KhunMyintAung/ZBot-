import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { dayKey } from '../risk.js';
import { journalRows } from '../service.js';
import { reloadEnv, loadConfig } from '../config.js';

const freshConfig = () => { reloadEnv(); return loadConfig(); };

// Long-term memory ("brain") of the agent. Survives restarts and conversation trimming.
//  • notes:   facts the owner asked it to remember (or the AI saved after the owner said so)
//  • lessons: what the bot's own closed trades show, worked out once a day (one entry per day, last 60 days)
// Lessons are information for the owner and the AI chat only. The trading bot never reads this file:
// its rules change only after a backtest and the owner's Yes.

const FILE = path.join(STATE_DIR, 'agent-memory.json');
const MAX_NOTES = 100;

const load = () => {
  try { const m = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { notes: m.notes ?? [], lessons: m.lessons ?? [], nextId: m.nextId ?? 1 }; }
  catch { return { notes: [], lessons: [], nextId: 1 }; }
};
const save = (m) => fs.writeFileSync(FILE, JSON.stringify(m, null, 1));
const today = () => dayKey(Date.now());

export function addNote(text, by = 'owner') {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!t) throw new Error('မှတ်ထားရမယ့် စာ ထည့်ပါ။ ဥပမာ: /remember SOL က ညဘက် ဈေးလှုပ်တယ်');
  if (/\b(sk-ant-|api[_ -]?key|secret|password|seed phrase)\b|\b\d{5,}:[A-Za-z0-9_-]{30,}/i.test(t)) throw new Error('Password / API key တွေကို မမှတ်ပါ။ Chat ထဲက အဲဒီစာကို ဖျက်ပါ။');
  const m = load();
  const note = { id: m.nextId++, day: today(), by, text: t };
  m.notes.push(note);
  if (m.notes.length > MAX_NOTES) m.notes = m.notes.slice(-MAX_NOTES);
  save(m);
  return note;
}

export function forgetNote(id) {
  const m = load();
  const n = m.notes.length;
  m.notes = m.notes.filter((x) => x.id !== Number(id));
  if (m.notes.length === n) throw new Error(`#${id} မရှိပါ (/memory မှာ နံပါတ် ကြည့်ပါ)`);
  save(m);
}

export const notes = () => load().notes;
export const latestLesson = () => load().lessons.at(-1) ?? null;

// ---- learning from the bot's own closed trades ----
const r2 = (v) => Math.round(v * 100) / 100;
function stats(rows) {
  const wins = rows.filter((r) => r.pnl > 0);
  const loss = rows.filter((r) => r.pnl <= 0);
  const gw = wins.reduce((a, r) => a + r.pnl, 0), gl = -loss.reduce((a, r) => a + r.pnl, 0);
  return { n: rows.length, win: rows.length ? (wins.length / rows.length) * 100 : 0, net: gw - gl, pf: gl > 0 ? gw / gl : wins.length ? Infinity : 0 };
}
const fmtS = (s) => `${s.n} ခု, နိုင် ${Math.round(s.win)}%, ${s.net >= 0 ? '+' : ''}${r2(s.net)} USDT`;

export function learnFromTrades() {
  const cfg = freshConfig();
  const rows = journalRows(cfg).filter((r) => r.exit_reason).map((r) => ({ ...r, pnl: Number(r.pnl) || 0, R: Number(r.R) || 0 }));
  const L = [];
  if (rows.length < 5) {
    L.push(`Trade ${rows.length} ခုပဲ ရှိသေးလို့ သင်ခန်းစာ ထုတ်ဖို့ မလုံလောက်သေးပါ (အနည်းဆုံး ၂၀–၃၀ ခု လိုပါတယ်)။`);
  } else {
    const all = stats(rows);
    L.push(`စုစုပေါင်း: ${fmtS(all)}, PF ${Number.isFinite(all.pf) ? r2(all.pf) : '∞'} (Backtest: နိုင် ~33%, PF ~1.5)`);
    // per coin
    const coins = [...new Set(rows.map((r) => r.symbol))].map((s) => [s, stats(rows.filter((r) => r.symbol === s))]).sort((a, b) => b[1].net - a[1].net);
    for (const [s, st] of coins) L.push(`• ${s.replace(/USDT$/, '')}: ${fmtS(st)}`);
    if (coins.length > 1 && coins.at(-1)[1].net < 0 && coins.at(-1)[1].n >= 5) L.push(`⚠️ ${coins.at(-1)[0]} က အရှုံးအများဆုံး။ Trade ၁၀ ခုကျော်ထိ ဆက်ရှုံးရင် Coin စာရင်းက ဖယ်ဖို့ Backtest နဲ့ စစ်ကြည့်သင့်တယ်။`);
    // long vs short
    const lg = stats(rows.filter((r) => r.side === 'long')), sh = stats(rows.filter((r) => r.side === 'short'));
    if (lg.n && sh.n) L.push(`Long: ${fmtS(lg)} · Short: ${fmtS(sh)}`);
    // winners vs losers size (trend bots win less often but bigger)
    const w = rows.filter((r) => r.pnl > 0), l = rows.filter((r) => r.pnl <= 0);
    if (w.length && l.length) {
      const aw = w.reduce((a, r) => a + r.R, 0) / w.length, al = l.reduce((a, r) => a + r.R, 0) / l.length;
      L.push(`ပျမ်းမျှ အမြတ် ${r2(aw)}R / အရှုံး ${r2(al)}R${aw < Math.abs(al) * 1.5 ? ' – အမြတ်က သေးနေတယ် (Trailing stop စောစော ထိနေလား စစ်ပါ)' : ' – အမြတ်ကြီး/အရှုံးသေး ဖြစ်နေတာ ကောင်းပါတယ်'}`);
    }
    // streak
    let k = 0; const lastWin = rows.at(-1).pnl > 0;
    for (let i = rows.length - 1; i >= 0 && (rows[i].pnl > 0) === lastWin; i--) k++;
    if (!lastWin && k >= 4) L.push(`📉 အခု ${k} ခု ဆက်တိုက် ရှုံးနေတယ်။ Trend bot မှာ ပုံမှန်ဖြစ်တတ်ပါတယ် (Backtest မှာ ၈–၁၀ ခုထိ ရှိခဲ့)။ Risk မတိုးပါနဲ့၊ Rule မပြောင်းပါနဲ့။`);
    else if (lastWin && k >= 3) L.push(`📈 ${k} ခု ဆက်တိုက် နိုင်နေတယ်။ ဒါပေမယ့် Risk မတိုးပါနဲ့ (နိုင်ပြီးရင် ရှုံးတာ ပြန်လာတတ်တယ်)။`);
    // exits
    const ex = {};
    for (const r of rows) ex[r.exit_reason] = (ex[r.exit_reason] ?? 0) + 1;
    L.push(`ထွက်ပုံ: ${Object.entries(ex).map(([k2, v]) => `${k2} ${v}`).join(', ')}`);
    // yesterday
    const y = dayKey(Date.now() - 864e5), yr = rows.filter((r) => r.closed && dayKey(Date.parse(r.closed)) === y);
    if (yr.length) L.push(`မနေ့က: ${fmtS(stats(yr))}`);
  }
  const text = L.join('\n');
  const m = load();
  const day = today();
  m.lessons = [...m.lessons.filter((x) => x.day !== day), { day, trades: rows.length, text }].slice(-60);
  save(m);
  return text;
}

// Text for the AI's system prompt and for /memory.
export function memoryText({ forAi = false } = {}) {
  const m = load();
  const parts = [];
  if (m.notes.length) parts.push(`${forAi ? 'Notes the owner asked you to remember' : '📌 မှတ်ထားတာများ'}:\n${m.notes.map((n) => `#${n.id} (${n.day}) ${n.text}`).join('\n')}`);
  const les = m.lessons.at(-1);
  if (les) parts.push(`${forAi ? `Lessons from the bot's own closed trades (${les.day})` : `🧠 Bot သင်ခန်းစာ (${les.day})`}:\n${les.text}`);
  return parts.join('\n\n');
}
