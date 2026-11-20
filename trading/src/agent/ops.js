// Safe server commands for the owner in Telegram (owner's request, 2026-11-18).
// Read-only: logs and health. Restarts go through the normal Yes/No confirm (tools.js).
// Deliberately NO shell, file editing or deploy from Telegram: the agent reads web pages
// (prompt-injection risk) and the server holds the Binance keys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { botProcess } from '../control.js';

const mm = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const ago = (ms) => (ms < 90e3 ? `${Math.round(ms / 1e3)} စက္ကန့်` : ms < 5400e3 ? `${Math.round(ms / 6e4)} မိနစ်` : ms < 48 * 3600e3 ? `${(ms / 3600e3).toFixed(1)} နာရီ` : `${(ms / 864e5).toFixed(1)} ရက်`);

// Last bot.log lines (Myanmar time). "all" keeps the per-candle "bar" lines, default hides them.
export function logsText(arg = '') {
  const all = /all|အကုန်/i.test(arg);
  const n = Math.min(60, Math.max(5, Number(String(arg).match(/\d+/)?.[0]) || 20));
  let lines;
  try { lines = fs.readFileSync(path.join(STATE_DIR, 'bot.log'), 'utf8').trimEnd().split('\n'); } catch { return 'Log မရှိသေးပါ။'; }
  // multi-line messages: keep only lines that start with a timestamp
  lines = lines.filter((l) => /^\[\d{4}-/.test(l) && (all || !/ bar \d{4}-/.test(l)));
  const out = lines.slice(-n).map((l) => {
    const t = Date.parse(l.slice(1, 25));
    return `${Number.isFinite(t) ? mm(t) : ''} ${l.slice(26)}`.slice(0, 220);
  });
  let txt = `📜 Bot Log – နောက်ဆုံး ${out.length} ကြောင်း (မြန်မာစံတော်ချိန်)${all ? '' : ' · Candle စစ်တဲ့ စာကြောင်းတွေ ဖျောက်ထား (/logs all)'}\n\n${out.join('\n')}`;
  if (txt.length > 4000) txt = txt.slice(-4000);
  return txt;
}

export function healthText() {
  const L = ['🩺 Server အခြေအနေ', ''];
  const bot = botProcess();
  let st = null;
  try {
    const f = fs.readdirSync(STATE_DIR).find((x) => /^(paper|live|testnet)-(futures|spot)/.test(x) && x.endsWith('.json'));
    if (f) st = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8'));
  } catch { /* no state */ }
  const hb = st?.heartbeat ? Date.now() - st.heartbeat : null;
  L.push(`🤖 Trading Bot: ${bot ? '✅ Run နေ' : '⛔ ရပ်နေ'}${hb !== null ? ` · နောက်ဆုံး အသက်ရှူ ${ago(hb)} အရင်${hb > 10 * 60e3 && bot ? ' ⚠️' : ''}` : ''}`);
  L.push(`💬 Telegram Agent: ✅ Run နေ (${ago(process.uptime() * 1e3)} ကြာပြီ)`);
  const total = os.totalmem(), free = os.freemem();
  const memPct = Math.round((1 - free / total) * 100);
  L.push(`🧠 Memory (RAM): ${memPct}% သုံးထား (${Math.round((total - free) / 2 ** 20)} / ${Math.round(total / 2 ** 20)} MB)${memPct > 90 ? ' ⚠️ ပြည့်လုနီး' : ''}`);
  try {
    const s = fs.statfsSync('/');
    const tot = s.blocks * s.bsize, av = s.bavail * s.bsize;
    const pct = Math.round((1 - av / tot) * 100);
    L.push(`💾 Disk: ${pct}% သုံးထား (${(av / 2 ** 30).toFixed(1)} GB ကျန်)${pct > 90 ? ' ⚠️ ပြည့်လုနီး' : ''}`);
  } catch { /* old node */ }
  const la = os.loadavg()[0], cpus = os.cpus().length || 1;
  L.push(`⚙️ CPU: ${Math.round((la / cpus) * 100)}% (ပျမ်းမျှ ၁ မိနစ်)`);
  L.push(`⏱️ Server ဖွင့်ထားတာ: ${ago(os.uptime() * 1e3)}`);
  try { L.push(`📂 Log ဖိုင်: ${(fs.statSync(path.join(STATE_DIR, 'bot.log')).size / 2 ** 20).toFixed(1)} MB`); } catch { /* none */ }
  L.push('', 'ပြဿနာ ရှိရင်: /restart bot · /restart agent');
  return L.join('\n');
}
