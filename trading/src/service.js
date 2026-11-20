import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, STATE_DIR, DATA_DIR, ENV_FILE, reloadEnv, loadConfig } from './config.js';
import { Binance } from './binance.js';
import { STRATEGY_NAMES } from './strategies.js';
import { botProcess } from './control.js';
import { fngNow } from './fa.js';

// Shared by the dashboard and the Telegram agent: read the bot's files, start it, change settings.
// Neither of them sends orders: Close/Stop are queued for the bot (control.js), which does the work.
// MODE, LIVE_CONFIRM and API keys are never changed here.

// Settings that may be changed from the dashboard / Telegram (only while the bot is stopped).
export const EDITABLE = {
  MARKET: { type: 'select', options: ['futures', 'spot'] },
  SYMBOLS: { type: 'text' },
  INTERVAL: { type: 'select', options: ['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
  STRATEGY: { type: 'select', options: STRATEGY_NAMES },
  RISK_PCT: { type: 'number', min: 0.1, max: 2, step: 0.1 },
  MAX_OPEN_POSITIONS: { type: 'number', min: 1, max: 10, step: 1 },
  MAX_TRADES_PER_DAY: { type: 'number', min: 1, max: 50, step: 1 },
  DAILY_LOSS_PCT: { type: 'number', min: 0.5, max: 10, step: 0.5 },
  LEVERAGE: { type: 'number', min: 1, max: 10, step: 1 },
  TREND_EXIT: { type: 'select', options: ['trail', 'fixed'] },
  TREND_TRAIL_ATR: { type: 'number', min: 1, max: 6, step: 0.5 },
  PAPER_BALANCE: { type: 'number', min: 50, max: 1000000, step: 50 },
};

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

export const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
export const stateFileOf = (cfg) => path.join(STATE_DIR, `${cfg.mode}-${cfg.market}-portfolio.json`);
export const readState = (cfg) => { try { return JSON.parse(fs.readFileSync(stateFileOf(cfg), 'utf8')); } catch { return null; } };

export function journalRows(cfg) {
  return parseCsv(readIf(path.join(STATE_DIR, 'journal.csv')))
    .filter((r) => r.mode === cfg.mode && r.market === cfg.market)
    .map((r) => ({ ...r, pnl: Number(r.pnl_usdt), R: Number(r.R), entry: Number(r.entry), exit: Number(r.exit) }));
}

export function logTail(n = 40) {
  return readIf(path.join(STATE_DIR, 'bot.log')).trim().split(/\r?\n/).filter(Boolean).slice(-n);
}

export function backtestTrades(cfg) {
  const name = cfg.symbols.length > 1 ? `portfolio${cfg.symbols.length}` : cfg.symbol;
  const file = path.join(DATA_DIR, `trades-${cfg.strategy}-${cfg.market}-${name}-${cfg.interval}.csv`);
  if (!fs.existsSync(file)) return { file: null, trades: [], startBalance: cfg.startBalance };
  const trades = parseCsv(fs.readFileSync(file, 'utf8')).map((t) => ({
    t: Date.parse(t.entry_time), symbol: t.symbol, side: t.side, pnl: Number(t.pnl), R: Number(t.R),
    why: t.exit_reason, equity: Number(t.equity),
  }));
  return { file: path.basename(file), trades, startBalance: cfg.startBalance };
}

// ---------- start ----------
let lastStartError = null;
export const getLastStartError = () => lastStartError;

export function startBot(cfg) {
  if (botProcess()) throw new Error('Bot is already running');
  if (cfg.mode === 'live' && !cfg.liveConfirm) throw new Error('MODE=live needs LIVE_CONFIRM=YES in .env');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const out = fs.openSync(path.join(STATE_DIR, 'bot-console.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js'), 'bot'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: process.env,
  });
  child.unref();
  lastStartError = null;
  // If it dies within a few seconds (bad config, no internet), surface the reason.
  child.on('exit', (code) => {
    if (code) {
      const tail = readIf(path.join(STATE_DIR, 'bot-console.log')).trim().split(/\r?\n/).slice(-3).join(' ');
      lastStartError = { at: Date.now(), message: tail || `exit code ${code}` };
    }
  });
  return { ok: true, message: 'Bot starting…' };
}

// ---------- settings ----------
export function currentSettings() {
  reloadEnv();
  const values = {};
  for (const k of Object.keys(EDITABLE)) values[k] = (process.env[k] ?? '').split(/\s+(?:#|←)/)[0].trim();
  return { fields: EDITABLE, values, mode: loadConfig().mode };
}

// Validates everything first. With dryRun it only checks (used before asking for confirmation).
// Returns { ok, message, cfg } where cfg is the config after the change.
export async function saveSettings(input, { dryRun = false } = {}) {
  if (botProcess()) throw new Error('Bot ကို အရင် Stop လုပ်ပါ။ Settings ကို Bot ရပ်ထားချိန်မှာပဲ ပြောင်းလို့ရပါတယ်။');
  reloadEnv();
  const cur = loadConfig();
  const values = {};
  for (const [k, spec] of Object.entries(EDITABLE)) {
    if (input[k] === undefined || input[k] === null) continue;
    let v = String(input[k]).trim().replace(/[\r\n]/g, '');
    if (k === 'SYMBOLS') v = v.toUpperCase().replace(/\s+/g, '');
    if (spec.type === 'select' && !spec.options.includes(v)) throw new Error(`${k}: invalid value (${spec.options.join(', ')})`);
    if (spec.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) throw new Error(`${k} must be ${spec.min}–${spec.max}`);
    }
    if (k === 'SYMBOLS' && !/^[A-Z0-9]{4,20}(,[A-Z0-9]{4,20}){0,9}$/.test(v)) throw new Error('SYMBOLS: e.g. BTCUSDT,ETHUSDT (max 10)');
    values[k] = v;
  }
  const unknown = Object.keys(input).filter((k) => !(k in EDITABLE));
  if (unknown.length) throw new Error(`These cannot be changed here: ${unknown.join(', ')}`);
  if (!Object.keys(values).length) throw new Error('Nothing to change');

  // Validate the whole config with the new values before writing anything.
  const old = { ...process.env };
  Object.assign(process.env, values);
  let next;
  try { next = loadConfig(); } finally { for (const k of Object.keys(values)) process.env[k] = old[k]; }

  // Coins must exist on Binance for this market.
  const probe = new Binance({ ...next, mode: 'paper' });
  for (const s of next.symbols) await probe.symbolRules(s);

  // Don't orphan open positions.
  const open = Object.keys(readState(next)?.positions ?? {});
  const dropped = open.filter((s) => !next.symbols.includes(s));
  if (dropped.length) throw new Error(`${dropped.join(', ')} မှာ Position ဖွင့်ထားဆဲပါ။ ဒီ Coin ကို မဖယ်ခင် Position ကို အရင်ပိတ်ပါ။`);
  if (next.market !== cur.market && Object.keys(readState(cur)?.positions ?? {}).length) {
    throw new Error('Position ဖွင့်ထားဆဲမှာ MARKET ကို မပြောင်းနိုင်ပါ။ အရင်ပိတ်ပါ။');
  }
  const changes = Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
  if (dryRun) return { ok: true, message: `Valid: ${changes}`, cfg: next };

  // Write: replace existing KEY= lines, append missing ones, keep everything else (comments, keys).
  let text = readIf(ENV_FILE);
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : text.replace(/\s*$/, `\n${k}=${v}\n`);
  }
  if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, ENV_FILE + '.prev');
  fs.writeFileSync(ENV_FILE, text);
  reloadEnv();
  return { ok: true, message: `Settings saved (${changes}). Start the bot to use them.`, cfg: loadConfig() };
}

// ---------- signal chart ----------
// Last ~160 closed candles of one coin with EMA20/50/200, every EMA20/50 cross and what the
// strategy did with it (signal or skipped and why), plus the bot's own entries and open position.
const chartCache = new Map(); // key -> { at, data }
export async function chartData(cfg, symbol, show = 160) {
  const { prepare, signalAt, WARMUP } = await import('./strategies.js');
  if (!cfg.symbols.includes(symbol)) throw new Error(`${symbol} is not in SYMBOLS`);
  const key = `${cfg.market}-${symbol}-${cfg.interval}-${cfg.strategy}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;

  const ex = new Binance({ ...cfg, mode: 'paper' });
  const ks = await ex.closedKlines(symbol, cfg.interval, Math.min(1000, WARMUP + show + 20));
  const x = prepare(ks);
  const from = Math.max(WARMUP, ks.length - show);
  const r = (v) => (Number.isFinite(v) ? +v.toPrecision(8) : null);

  const events = [];
  for (let i = from; i < ks.length; i++) {
    const sig = signalAt(cfg.strategy, x, i, cfg);
    const up = x.ema20[i - 1] <= x.ema50[i - 1] && x.ema20[i] > x.ema50[i];
    const dn = x.ema20[i - 1] >= x.ema50[i - 1] && x.ema20[i] < x.ema50[i];
    if (sig) {
      // chart pattern: its two lines, cut to what the chart shows and drawn up to the breakout candle
      let pattern;
      if (sig.shape) {
        const seg = (pts) => {
          if (pts.length === 2 && pts[1].j !== pts[0].j) {
            const [a, b] = pts, v = (j) => b.p + ((b.p - a.p) / (b.j - a.j)) * (j - b.j), j0 = Math.max(a.j, from);
            return [[ks[j0].t, r(v(j0))], [ks[i].t, r(v(i))]];
          }
          return pts.filter((q) => q.j >= from).map((q) => [ks[q.j].t, r(q.p)]);
        };
        pattern = { name: sig.pattern, upper: seg(sig.shape.upper), lower: seg(sig.shape.lower) };
      }
      events.push({ t: ks[i].t, price: x.c[i], kind: 'signal', side: sig.side, reason: sig.reason, ...(pattern ? { pattern } : {}) });
    } else if (cfg.strategy === 'trend' && (up || dn)) {
      const above = x.c[i] > x.ema200[i];
      let why;
      if (up && !above) why = 'EMA20 crossed up, but price is below EMA200 (downtrend): no long';
      else if (dn && above) why = 'EMA20 crossed down, but price is above EMA200 (uptrend): no short';
      else if (dn && !cfg.allowShort) why = 'Cross down, but spot cannot short';
      else {
        const stop = (cfg.trend?.slAtr ?? 1.5) * x.atr[i];
        why = cfg.feePct && (2 * cfg.feePct / 100) * x.c[i] > 0.15 * stop
          ? `Signal, but candles are too small: fees (${(2 * cfg.feePct).toFixed(2)}%) would eat >15% of the risk. Bigger interval (4h) fixes this`
          : 'Cross in trend direction, but the stop/reward filter said no';
      }
      events.push({ t: ks[i].t, price: x.c[i], kind: 'skipped', side: up ? 'long' : 'short', reason: why });
    }
  }

  // Simulated trades on this chart, exactly like the backtest: signal on a candle's close,
  // entry at the next open, stop-loss / take-profit / trailing stop checked on every candle.
  const { trailStop } = await import('./backtest.js');
  const trades = [];
  let p = null, pend = null;
  for (let i = from; i < ks.length; i++) {
    const k = ks[i];
    if (pend) {
      const dir = pend.side === 'long' ? 1 : -1;
      p = {
        side: pend.side, entryT: k.t, entry: k.o, stopDist: pend.stopDist,
        sl: k.o - dir * pend.stopDist, sl0: k.o - dir * pend.stopDist,
        tp: pend.trailAtr ? null : k.o + dir * pend.tpDist, tpFar: k.o + dir * pend.tpDist,
        trailAtr: pend.trailAtr, best: k.o, path: [],
      };
      pend = null;
    }
    if (p) {
      const L = p.side === 'long', dir = L ? 1 : -1, tp = p.tp ?? p.tpFar;
      p.path.push([k.t, r(p.sl)]);
      let exit = null, why = null;
      if (L ? k.o <= p.sl : k.o >= p.sl) { exit = k.o; why = 'SL (gap)'; }
      else if (L ? k.o >= tp : k.o <= tp) { exit = k.o; why = 'TP (gap)'; }
      else if (L ? k.l <= p.sl : k.h >= p.sl) { exit = p.sl; why = p.trailAtr && (L ? p.sl > p.entry : p.sl < p.entry) ? 'Trailing stop' : 'Stop-loss'; }
      else if (L ? k.h >= tp : k.l <= tp) { exit = tp; why = 'Take-profit'; }
      if (exit !== null) {
        trades.push({ side: p.side, entryT: p.entryT, entry: r(p.entry), sl: r(p.sl0), tp: r(p.tp), exitT: k.t, exit: r(exit), why, R: r(((exit - p.entry) * dir) / p.stopDist), path: p.path });
        p = null;
      } else if (p.trailAtr && Number.isFinite(x.atr[i])) {
        p.sl = trailStop(p, k.h, k.l, x.atr[i]);
      }
    }
    if (!p && !pend && i < ks.length - 1) {
      const sig = signalAt(cfg.strategy, x, i, cfg);
      if (sig) pend = sig;
    }
  }
  if (p) {
    const last = ks.at(-1), dir = p.side === 'long' ? 1 : -1;
    trades.push({ side: p.side, entryT: p.entryT, entry: r(p.entry), sl: r(p.sl0), tp: r(p.tp), slNow: r(p.sl), exitT: null, exit: r(last.c), why: 'still open', R: r(((last.c - p.entry) * dir) / p.stopDist), path: p.path });
  }
  const signalNext = pend ? { side: pend.side, stopDist: r(pend.stopDist), trail: !!pend.trailAtr } : null;

  const entries = journalRows(cfg).filter((j) => j.symbol === symbol)
    .map((j) => ({ t: Date.parse(j.opened), side: j.side, entry: j.entry, exit: j.exit, pnl: j.pnl, closed: Date.parse(j.closed) }))
    .filter((j) => j.t >= ks[from].t);
  const pos = readState(cfg)?.positions?.[symbol];

  const n = ks.length - 1;
  const data = {
    symbol, interval: cfg.interval, strategy: cfg.strategy,
    candles: ks.slice(from).map((k, j) => ({
      t: k.t, o: k.o, h: k.h, l: k.l, c: k.c,
      e20: r(x.ema20[from + j]), e50: r(x.ema50[from + j]), e200: r(x.ema200[from + j]),
    })),
    events, entries, trades, signalNext,
    rules: {
      exit: cfg.strategy === 'pattern' ? 'trail' : cfg.trend?.exit ?? 'fixed', slAtr: cfg.trend?.slAtr ?? 1.5, tpAtr: cfg.trend?.tpAtr ?? 3,
      trailAtr: cfg.trend?.trailAtr ?? 3, riskPct: cfg.riskPct, allowShort: cfg.allowShort,
      atr: r(x.atr[n]), atrPct: r((x.atr[n] / x.c[n]) * 100),
      faFilter: cfg.faFilter, fng: await fngNow(),
    },
    position: pos ? { side: pos.side, entry: pos.entry, sl: pos.sl, t: pos.entryT } : null,
    now: {
      trend: x.c[n] > x.ema200[n] ? 'up' : 'down',
      gapPct: r(((x.ema20[n] - x.ema50[n]) / x.ema50[n]) * 100),
      nextBarAt: ks[n].closeT + 1 + (ks[n].closeT + 1 - ks[n].t),
    },
  };
  chartCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------- API keys (write-only from the dashboard) ----------
// The dashboard can SET these but never shows them back (only "set ✓ …last 4").
// MODE and LIVE_CONFIRM are not here: real-money trading is still switched on only over SSH.
export const KEY_FIELDS = {
  TELEGRAM_BOT_TOKEN: { label: 'Telegram bot token (@BotFather)', re: /^\d{5,}:[A-Za-z0-9_-]{30,}$/ },
  TELEGRAM_CHAT_ID: { label: 'Telegram chat id (your own)', re: /^-?\d{4,20}$/, plain: true },
  OPENROUTER_API_KEY: { label: 'OpenRouter API key (openrouter.ai) – the agent uses this first', re: /^sk-or-[A-Za-z0-9_-]{20,}$/ },
  OPENAI_API_KEY: { label: 'OpenAI API key (platform.openai.com)', re: /^sk-(?!ant-)[A-Za-z0-9_-]{20,}$/ },
  ANTHROPIC_API_KEY: { label: 'Claude API key (console.anthropic.com)', re: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  TINYFISH_API_KEY: { label: 'TinyFish API key (agent.tinyfish.ai)', re: /^[A-Za-z0-9_.-]{16,200}$/ },
  BINANCE_API_KEY: { label: 'Binance API key', re: /^[A-Za-z0-9]{32,128}$/ },
  BINANCE_API_SECRET: { label: 'Binance secret key', re: /^[A-Za-z0-9]{32,128}$/ },
};

export function keyStatus() {
  reloadEnv();
  return Object.fromEntries(Object.entries(KEY_FIELDS).map(([k, f]) => {
    const v = (process.env[k] ?? '').trim();
    return [k, { label: f.label, set: !!v, hint: v ? (f.plain ? v : `…${v.slice(-4)}`) : '' }];
  }));
}

// Empty fields are left unchanged. Returns the names that changed.
export function saveKeys(input) {
  const values = {};
  for (const [k, raw] of Object.entries(input ?? {})) {
    if (!(k in KEY_FIELDS)) throw new Error(`${k} cannot be set here`);
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (!KEY_FIELDS[k].re.test(v)) throw new Error(`${k}: this does not look like a valid value (check you copied all of it)`);
    values[k] = v;
  }
  if (!Object.keys(values).length) throw new Error('Nothing to save');
  let text = readIf(ENV_FILE);
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => `${k}=${v}`) : text.replace(/\s*$/, () => `\n${k}=${v}\n`);
  }
  if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, ENV_FILE + '.prev');
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
  reloadEnv();
  return Object.keys(values);
}
