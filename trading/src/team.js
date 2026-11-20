// "zBOT Team": what each part of the bot is REALLY doing right now (owner's request: no fake animation).
// Built only from the bot's own files: state, bot.log, AI reviews, US calendar, scanner. Used by the
// dashboard (/api/team) and Telegram (/team). Never throws for a missing file; shows "–" instead.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';
import { readState, logTail } from './service.js';
import { botProcess, readControl } from './control.js';
import { Binance } from './binance.js';
import { fngNow, fngMm, sentimentBlock } from './fa.js';

const IV = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')); } catch { return null; } };
const mmTime = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(11, 16);
const mmDay = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(5, 10).replace('-', '/');
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1 ? 'ခုနက' : m < 60 ? `${m} မိနစ်က` : m < 48 * 60 ? `${Math.round(m / 60)} နာရီက` : `${Math.round(m / 1440)} ရက်က`;
};
const coin = (s) => String(s).replace(/USDT$/, '');
const px = (v) => (!Number.isFinite(+v) ? '-' : +v >= 1000 ? (+v).toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(+(+v).toPrecision(5)));
const usd = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;

// last bot.log line matching re -> { t, text }
function lastLog(lines, re) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/^\[\d{4}-/.test(l) || !re.test(l)) continue;
    return { t: Date.parse(l.slice(1, 25)), text: l.slice(26) };
  }
  return null;
}

export async function teamStatus(cfg) {
  const st = readState(cfg) ?? {};
  const running = !!botProcess();
  const paused = !!readControl().paused;
  const lines = logTail(600);
  const positions = Object.entries(st.positions ?? {});
  const now = Date.now();
  const roles = [];

  // ---- 🎯 Entry: watches the coins, decides once per closed candle ----
  {
    const iv = IV[cfg.interval] ?? 144e5;
    const next = Math.ceil(now / iv) * iv + 60e3;
    const last = lastLog(lines, / signal (long|short)|OPEN |Manual (LONG|SHORT)/);
    let lastText = null;
    if (last) {
      const m = last.text.match(/^(?:🟢 |🔴 )?(?:OPEN )?(\w+USDT)\b.*?(LONG|SHORT|long|short)/) ?? last.text.match(/(\w+USDT).*?(long|short)/i);
      const what = m ? `${coin(m[1])} ${m[2].toLowerCase() === 'long' ? 'Long' : 'Short'}` : 'Signal';
      lastText = /skipped/.test(last.text) ? `${what} Signal တွေ့ – ကျော်ခဲ့ (${last.text.split('skipped')[1].replace(/^[:\s]+/, '').slice(0, 60)})`
        : `${what} ဝင်ခဲ့`;
    }
    roles.push({
      key: 'entry', icon: '🎯', name: 'Entry', mm: 'ဝင်မလား ဆုံးဖြတ်',
      state: !running ? 'off' : paused ? 'warn' : 'on',
      now: !running ? 'Bot ရပ်နေလို့ မစောင့်ကြည့်ပါ' : paused ? 'ခဏရပ်ထား – Trade အသစ် မဝင်' : `Coin ${cfg.symbols.length} ခု (${cfg.symbols.map(coin).join(', ')}) ကို ${cfg.interval} Candle ပိတ်တိုင်း စစ်နေ`,
      next: running && !paused ? `နောက်တစ်ခါ စစ်မယ့်အချိန် ${mmTime(next)}` : null,
      last: last ? { t: last.t, ago: ago(last.t), text: lastText } : null,
    });
  }

  // ---- 🚪 Exit: trailing stops on open trades ----
  {
    const prices = {};
    const ex = new Binance({ ...cfg, mode: 'paper' });
    await Promise.all(positions.map(async ([s]) => { try { prices[s] = await ex.price(s); } catch { /* offline */ } }));
    const items = positions.map(([s, p]) => {
      const pr = prices[s];
      const u = Number.isFinite(pr) ? (pr - p.entry) * p.qty * (p.side === 'long' ? 1 : -1) : null;
      return { symbol: coin(s), side: p.side, entry: p.entry, sl: p.sl, price: pr ?? null, pnl: u, trailing: !!p.trailAtr,
        text: `${coin(s)} ${p.side === 'long' ? 'Long' : 'Short'} · Stop ${px(p.sl)}${p.trailAtr ? ' (လိုက်ရွှေ့)' : ''}${u !== null ? ` · ${usd(u)}` : ''}` };
    });
    const last = lastLog(lines, /trailing stop|CLOSE|TRAIL|closed/);
    const lm = last?.text.match(/(\w+USDT) trailing stop ([\d.]+) -> ([\d.]+)/);
    const cm = last?.text.match(/CLOSED (\w+USDT) (long|short) (\w+) @ ([\d.]+)\s+PnL ≈ (-?[\d.]+)/);
    const WHY = { SL: 'Stop-loss', TP: 'ပစ်မှတ်', TRAIL: 'လိုက်ရွှေ့ Stop', manual: 'ကိုယ်တိုင်' };
    if (cm) last.text = `${coin(cm[1])} ${cm[2] === 'long' ? 'Long' : 'Short'} ပိတ်ခဲ့ (${WHY[cm[3]] ?? cm[3]}) ${usd(+cm[5])}`;
    roles.push({
      key: 'exit', icon: '🚪', name: 'Exit', mm: 'ထွက်မလား စောင့်ကြည့်',
      state: positions.length ? 'on' : 'idle',
      now: positions.length ? `ဖွင့်ထားတဲ့ Trade ${positions.length} ခုရဲ့ Stop-loss ကို ထိန်းနေ` : 'ဖွင့်ထားတဲ့ Trade မရှိ – စောင့်နေ',
      items,
      last: last ? { t: last.t, ago: ago(last.t), text: lm ? `${coin(lm[1])} Stop ${px(lm[2])} → ${px(lm[3])} ရွှေ့ခဲ့` : last.text.trim().slice(0, 80) } : null,
    });
  }

  // ---- 🛡️ Risk: size, open slots, daily stop ----
  {
    const day = st.day ?? {};
    const eq = cfg.mode === 'paper' ? st.paperEquity : null;
    const dayPct = Number.isFinite(eq) && Number.isFinite(day.startEquity) && day.startEquity ? (eq / day.startEquity - 1) * 100 : null;
    const full = positions.length >= cfg.maxOpen;
    roles.push({
      key: 'risk', icon: '🛡️', name: 'Risk', mm: 'အရှုံး ကန့်သတ်',
      state: day.halted ? 'stop' : full ? 'warn' : 'on',
      now: day.halted ? `ဒီနေ့ ${cfg.dailyLossPct}% ရှုံးလို့ ရပ်ထား – မနက်ဖြန် ပြန်စ`
        : `Trade တစ်ခု ${cfg.riskPct}% · ဖွင့်ထား ${positions.length}/${cfg.maxOpen}${full ? ' (ပြည့်နေ – အသစ် မဝင်)' : ''}`,
      next: `ဒီနေ့ ${dayPct === null ? '–' : `${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%`} · ${cfg.dailyLossPct}% ရှုံးရင် ရပ်${cfg.market === 'futures' ? ` · Leverage ${cfg.leverage}x` : ''}`,
      last: null,
    });
  }

  // ---- 🤖 AI check: second opinion, can only skip ----
  {
    const rv = (readJson('ai-review.json')?.reviews ?? []).filter((r) => r.aiSaid || r.error);
    const week = rv.filter((r) => now - r.t < 7 * 864e5);
    const sk = week.filter((r) => r.decision === 'skip').length;
    const last = rv.at(-1);
    const on = String(process.env.AI_REVIEW ?? 'on').toLowerCase() !== 'off';
    roles.push({
      key: 'ai', icon: '🤖', name: 'AI check', mm: 'AI ဒုတိယ အမြင်',
      state: on ? (week.length ? 'on' : 'idle') : 'off',
      now: on ? `ဒီပတ် Signal ${week.length} ခု စစ်ပြီး – ${sk} ခု ကျော်ခိုင်း` : 'ပိတ်ထား (AI_REVIEW=off)',
      last: last ? { t: last.t, ago: ago(last.t), text: `${coin(last.symbol)} ${last.side === 'long' ? 'Long' : 'Short'} → ${last.decision === 'skip' ? 'ကျော်' : 'ဝင်'}${last.confidence ? ` (${last.confidence}%)` : ''}` } : null,
    });
  }

  // ---- 📰 News / sentiment: Fear & Greed ----
  {
    const v = await fngNow().catch(() => null);
    const blockL = cfg.faFilter && sentimentBlock('long', v), blockS = cfg.faFilter && sentimentBlock('short', v);
    roles.push({
      key: 'news', icon: '📰', name: 'News', mm: 'ဈေးကွက် စိတ်ဓာတ်',
      state: v === null ? 'idle' : blockL || blockS ? 'warn' : 'on',
      now: v === null ? 'Fear & Greed မရနိုင်သေး' : `Fear & Greed ${v} – ${fngMm(v)}`,
      next: !cfg.faFilter ? 'Filter ပိတ်ထား – F&G ကြောင့် Trade မကျော်' : blockS ? 'Short အသစ် မဝင် (အရမ်းကြောက်နေချိန်)' : blockL ? 'Long အသစ် မဝင် (အရမ်းလောဘတက်ချိန်)' : 'Long ရော Short ရော ဝင်ခွင့်ရှိ',
      last: null,
    });
  }

  // ---- 🌐 Macro: US events that move markets ----
  {
    const ev = (readJson('calendar.json')?.events ?? []).filter((e) => e.t > now - 3600e3).sort((a, b) => a.t - b.t);
    const n = ev[0];
    roles.push({
      key: 'macro', icon: '🌐', name: 'Macro', mm: 'US သတင်းပွဲ',
      state: n && n.t - now < 6 * 3600e3 ? 'warn' : 'idle',
      now: n ? `နောက်ပွဲ: ${n.title}` : 'ဒီအပတ် ကျန်တဲ့ US သတင်းပွဲ ကြီး မရှိ',
      next: n ? `${mmDay(n.t)} ${mmTime(n.t)} (မြန်မာ)${n.forecast ? ` · ခန့်မှန်း ${n.forecast}` : ''}` : null,
      last: null,
    });
  }

  // ---- 🔎 Scanner: other coins, alerts only ----
  {
    const sc = readJson('scan.json');
    const day = Object.values(sc?.seen ?? {}).filter((x) => x?.t && now - x.t < 864e5).length;
    const on = String(process.env.SCAN_ALERTS ?? 'on').toLowerCase() !== 'off';
    roles.push({
      key: 'scan', icon: '🔎', name: 'Scanner', mm: 'တခြား Coin ရှာ',
      state: on ? 'on' : 'off',
      now: on ? `Top ${process.env.SCAN_TOP ?? 20} Coin ကို စစ်နေ – သတိပေးချက်သာ (Auto မဝင်)` : 'ပိတ်ထား',
      next: on ? `ယနေ့ အခွင့်အရေး ${day} ခု ပို့ပြီး` : null,
      last: sc?.lastBar ? { t: sc.lastBar, ago: ago(sc.lastBar), text: 'နောက်ဆုံး စစ်ခဲ့' } : null,
    });
  }

  return { t: now, running, paused, mode: cfg.mode, roles };
}

const DOT = { on: '🟢', warn: '🟡', stop: '🔴', idle: '⚪', off: '⚫' };

export function teamText(team) {
  const L = [`👥 zBOT Team – အခု တကယ် လုပ်နေတာ (${mmTime(team.t)} မြန်မာ)${team.mode === 'live' ? '' : ' · ငွေအတု'}`, ''];
  for (const r of team.roles) {
    L.push(`${DOT[r.state] ?? '⚪'} ${r.icon} ${r.name} – ${r.mm}`);
    L.push(`   ${r.now}`);
    for (const it of r.items ?? []) L.push(`   • ${it.text}`);
    if (r.next) L.push(`   ${r.next}`);
    if (r.last) L.push(`   ↳ ${r.last.ago}: ${r.last.text}`);
    L.push('');
  }
  L.push('🟢 အလုပ်လုပ်နေ · 🟡 သတိ · 🔴 ရပ် · ⚪ စောင့်နေ · ⚫ ပိတ်');
  return L.join('\n').slice(0, 4000);
}
