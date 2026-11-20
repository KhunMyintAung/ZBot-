import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE_DIR, reloadEnv, loadConfig } from '../config.js';
import { Binance } from '../binance.js';
import { summarize } from '../backtest.js';
import { dayKey } from '../risk.js';
import { botProcess, readControl, writeControl, queueCommand, pendingCommands } from '../control.js';
import {
  readState, journalRows, logTail, backtestTrades, startBot, getLastStartError, currentSettings, saveSettings,
} from '../service.js';
import { Telegram } from './telegram.js';
import { analyzeCoin, normSymbol } from './analysis.js';
import { addNote, forgetNote, memoryText } from './memory.js';
import { statusMm } from '../plain.js';
import { dcaSnapshot } from './dcapaper.js';
import { webSearch, readPage } from './tinyfish.js';

// Tools the AI agent can use. Reading is free; anything that changes the bot (except "pause")
// only creates a confirmation button. Nothing happens until the owner taps "Yes" in Telegram.
// MODE / LIVE_CONFIRM / API keys can never be changed from here.

export const freshConfig = () => { reloadEnv(); return loadConfig(); };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

// ---------- status (also used by /status and the daily report, no AI needed) ----------
export async function botStatus() {
  const cfg = freshConfig();
  const st = readState(cfg);
  const proc = botProcess();
  const control = readControl();
  const ex = new Binance({ ...cfg, mode: 'paper' });
  const prices = {};
  await Promise.all(cfg.symbols.map(async (s) => { try { prices[s] = await ex.price(s); } catch { /* offline */ } }));

  let unrealized = 0;
  const positions = Object.entries(st?.positions ?? {}).map(([symbol, p]) => {
    const price = prices[symbol];
    const dir = p.side === 'short' ? -1 : 1;
    const upnl = price ? (price - p.entry) * p.qty * dir : null;
    if (upnl) unrealized += upnl;
    return {
      symbol, side: p.side, qty: p.qty, entry: p.entry, stopLoss: p.sl, takeProfit: p.trailAtr ? 'trailing stop' : p.tp,
      price: price ?? null, unrealizedPnl: r2(upnl), opened: p.entryT ? new Date(p.entryT).toISOString() : undefined,
    };
  });

  const today = dayKey(Date.now());
  const closedToday = journalRows(cfg).filter((r) => r.closed && dayKey(Date.parse(r.closed)) === today);
  const heartbeatAgeSec = st?.heartbeat ? Math.round((Date.now() - st.heartbeat) / 1000) : null;
  return {
    bot: {
      running: !!proc, paused: !!control.paused, wantRunning: !!control.wantRunning,
      heartbeatAgeSec, stale: proc && heartbeatAgeSec > Math.max(180, cfg.pollSeconds * 6) ? true : undefined,
      lastStartError: getLastStartError()?.message,
      pendingCommands: pendingCommands().map((c) => c.type + (c.symbol ? ` ${c.symbol}` : '')),
    },
    config: {
      mode: cfg.mode, market: cfg.market, symbols: cfg.symbols, interval: cfg.interval, strategy: cfg.strategy,
      riskPct: cfg.riskPct, maxOpen: cfg.maxOpen, leverage: cfg.leverage, dailyLossPct: cfg.dailyLossPct,
    },
    equity: cfg.mode === 'paper' && st ? {
      realized: r2(st.paperEquity), withOpenPnl: r2(st.paperEquity + unrealized), start: cfg.startBalance,
      totalPct: r2(((st.paperEquity + unrealized) / cfg.startBalance - 1) * 100),
    } : { note: cfg.mode === 'paper' ? 'no state yet (bot never ran)' : 'live/testnet equity: see Binance' },
    today: {
      day: today, startEquity: st?.day?.key === today ? r2(st.day.startEquity) : null,
      tradesOpened: st?.day?.key === today ? st.day.trades : 0, halted: st?.day?.key === today ? !!st.day.halted : false,
      closed: closedToday.length, closedPnl: r2(closedToday.reduce((a, r) => a + r.pnl, 0)),
    },
    positions,
    spotDca: await dcaSnapshot(),
  };
}

// Plain Burmese status for Telegram (/status, daily report).
export function statusText(s) {
  return statusMm(s);
}

export function tradeHistory({ limit = 20, symbol } = {}) {
  const cfg = freshConfig();
  let rows = journalRows(cfg).filter((r) => r.exit_reason); // closed trades only
  if (symbol) rows = rows.filter((r) => r.symbol === String(symbol).toUpperCase());
  const s = summarize(rows, cfg.startBalance);
  return {
    account: `${cfg.mode} ${cfg.market}`,
    summary: { trades: s.trades, winRatePct: r2(s.winRate), profitFactor: r2(s.profitFactor), netPnl: r2(s.netPnl), netPct: r2(s.netPct), avgR: r2(s.avgR) },
    last: rows.slice(-Math.min(Math.max(1, limit), 100)).map((r) => ({
      opened: r.opened, closed: r.closed, symbol: r.symbol, side: r.side, entry: r.entry, exit: r.exit,
      pnl: r2(r.pnl), R: r2(r.R), exitReason: r.exit_reason,
    })),
  };
}

export function backtestSummary() {
  const cfg = freshConfig();
  const bt = backtestTrades(cfg);
  if (!bt.trades.length) return { note: `No backtest file for ${cfg.strategy} ${cfg.market} ${cfg.interval}. Run: node src/index.js backtest` };
  const year = Date.now() - 365 * 864e5;
  const fmt = (s) => ({ trades: s.trades, winRatePct: r2(s.winRate), profitFactor: r2(s.profitFactor), netPct: r2(s.netPct), avgR: r2(s.avgR) });
  const eq = bt.trades.map((t) => t.equity);
  let peak = bt.startBalance, dd = 0;
  for (const e of eq) { peak = Math.max(peak, e); dd = Math.max(dd, 1 - e / peak); }
  return {
    file: bt.file, from: new Date(bt.trades[0].t).toISOString().slice(0, 10), to: new Date(bt.trades.at(-1).t).toISOString().slice(0, 10),
    all: { ...fmt(summarize(bt.trades, bt.startBalance)), maxDrawdownPct: r2(dd * 100) },
    last365days: fmt(summarize(bt.trades.filter((t) => t.t >= year), bt.startBalance)),
    passRule: 'PF>1.3, max DD<20%, 100+ trades, out-of-sample PF>1.1. On 4h over 4 years: combo with Fear & Greed filter PF ~1.50, DD ~10%, out-of-sample PF ~1.64 (passes); without the filter PF ~1.31, trend alone PF ~1.27 (does not). 15m and 1h lose money in backtests.',
  };
}

export async function marketData({ symbols }) {
  const cfg = freshConfig();
  const ex = new Binance({ ...cfg, mode: 'paper' });
  const pathFor = cfg.market === 'futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
  const list = (Array.isArray(symbols) && symbols.length ? symbols : cfg.symbols).slice(0, 10);
  const out = {};
  for (const raw of list) {
    const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    try {
      const t = await ex.public(pathFor, { symbol: s });
      out[s] = { price: Number(t.lastPrice), change24hPct: Number(t.priceChangePercent), high24h: Number(t.highPrice), low24h: Number(t.lowPrice), volumeUsdt: Math.round(Number(t.quoteVolume)) };
    } catch (e) { out[s] = { error: e.message }; }
  }
  return { market: cfg.market, at: new Date().toISOString(), tickers: out };
}

// ---------- task list (the agent's to-do list for the owner's money-making plans) ----------
const TASKS_FILE = path.join(STATE_DIR, 'agent-tasks.json');
export const readTasks = () => { try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return []; } };
const writeTasks = (t) => fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2));

export function manageTasks({ op, text, id, area, due }) {
  const tasks = readTasks();
  if (op === 'add') {
    if (!text) throw new Error('text is required');
    const t = { id: (tasks.reduce((m, x) => Math.max(m, x.id), 0) + 1), text: String(text).slice(0, 300), area: area ?? 'general', due: due ?? null, done: false, created: new Date().toISOString() };
    tasks.push(t);
    writeTasks(tasks);
    return { added: t };
  }
  if (op === 'done' || op === 'remove') {
    const i = tasks.findIndex((t) => t.id === Number(id));
    if (i < 0) throw new Error(`No task with id ${id}`);
    if (op === 'done') { tasks[i].done = true; tasks[i].doneAt = new Date().toISOString(); } else tasks.splice(i, 1);
    writeTasks(tasks.slice(-200));
    return { ok: true, tasks: tasks.filter((t) => !t.done) };
  }
  return { open: tasks.filter((t) => !t.done), recentlyDone: tasks.filter((t) => t.done).slice(-5) };
}

// ---------- actions that need the owner's tap ----------
const ACTIONS = ['start_bot', 'stop_bot', 'resume_bot', 'restart_bot', 'restart_agent', 'open_position', 'modify_position', 'close_position', 'close_all_positions', 'update_settings', 'channel_post', 'channel_analysis'];
const channelId = () => (process.env.TELEGRAM_GROUP_ID ?? '').trim();
const pending = new Map(); // id -> { action, symbol, settings, created }
const TTL = 10 * 60e3;

export function describeAction(a) {
  switch (a.action) {
    case 'start_bot': return 'Bot ကို START လုပ်မယ်';
    case 'stop_bot': return 'Bot ကို STOP လုပ်မယ် (ဖွင့်ထားတဲ့ Position တွေက Stop-loss နဲ့ ဆက်ရှိနေမယ်)';
    case 'resume_bot': return 'Bot ကို RESUME လုပ်မယ် (Trade အသစ် ပြန်ဝင်မယ်)';
    case 'restart_bot': return '🔄 Trading Bot ကို ပိတ်ပြီး ပြန်ဖွင့်မယ် (၁ မိနစ်လောက်၊ ဖွင့်ထားတဲ့ Trade တွေ Stop-loss နဲ့ ဆက်ရှိနေမယ်)';
    case 'restart_agent': return '🔄 Telegram Agent (ဒီ Chat Bot) ကို ပြန်စမယ် (စက္ကန့် ၁၅ လောက် မဖြေနိုင်ဘူး)';
    case 'open_position': return `${a.symbol} ${a.side === 'long' ? '🟢 LONG' : '🔴 SHORT'} ကို အခုဈေး (~${a.price}) နဲ့ ဖွင့်မယ်\nSL: ${a.sl ?? '1.5 ATR (Bot တွက်ပေးမယ်)'}\nTP: ${a.tp ?? 'Trailing stop'}\nRisk: Account ရဲ့ ${a.risk}%`;
    case 'modify_position': return `${a.symbol} Position ပြောင်းမယ်: ${[a.sl ? `SL → ${a.sl}` : '', a.tp ? `TP → ${a.tp} (Trailing ပိတ်)` : '', a.trail ? 'Trailing stop ပြန်ဖွင့်' : ''].filter(Boolean).join(', ')}`;
    case 'close_position': return `${a.symbol} Position ကို Market price နဲ့ ပိတ်မယ်`;
    case 'close_all_positions': return 'Position အားလုံးကို Market price နဲ့ ပိတ်မယ်';
    case 'update_settings': return `Settings ပြောင်းမယ်: ${Object.entries(a.settings).map(([k, v]) => `${k}=${v}`).join(', ')}`;
    case 'channel_post': return `📢 Channel ကို ဒီစာ ပို့မယ်:\n━━━━━━━━━━\n${a.text}\n━━━━━━━━━━`;
    case 'channel_analysis': return `📢 ${a.symbol} Chart ပုံ + အပေါ်က ခွဲခြမ်းစိတ်ဖြာချက်ကို Channel ကို ပို့မယ်`;
    default: return a.action;
  }
}

// Checks the request now (so the button only appears for something that can work), then parks it.
export async function prepareAction({ action, symbol, settings, text, side, sl, tp, trail }) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action ${action}`);
  const cfg = freshConfig();
  const running = !!botProcess();
  const a = { action };
  if (action === 'start_bot') {
    if (running) throw new Error('Bot is already running');
    if (cfg.mode === 'live' && !cfg.liveConfirm) throw new Error('MODE=live needs LIVE_CONFIRM=YES (owner sets it on the server)');
  }
  if (['stop_bot', 'open_position', 'modify_position', 'close_position', 'close_all_positions'].includes(action) && !running) throw new Error('Bot is not running (Start it first)');
  if (action === 'open_position' || action === 'modify_position') {
    a.symbol = normSymbol(symbol);
    if (!cfg.symbols.includes(a.symbol)) throw new Error(`${a.symbol || '(no coin)'} is not one of the bot's coins (${cfg.symbols.join(', ')})`);
    const pos = readState(cfg)?.positions?.[a.symbol];
    const price = await new Binance({ ...cfg, mode: 'paper' }).price(a.symbol);
    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    a.sl = num(sl); a.tp = num(tp);
    if ((a.sl !== null && !(a.sl > 0)) || (a.tp !== null && !(a.tp > 0))) throw new Error('SL / TP must be prices');
    if (action === 'open_position') {
      a.side = String(side ?? '').toLowerCase();
      if (!['long', 'short'].includes(a.side)) throw new Error('side must be long or short');
      if (a.side === 'short' && cfg.market !== 'futures') throw new Error('Spot cannot short');
      if (pos) throw new Error(`${a.symbol} already has a position`);
      if (Object.keys(readState(cfg)?.positions ?? {}).length >= cfg.maxOpen) throw new Error(`MAX_OPEN_POSITIONS (${cfg.maxOpen}) reached`);
      const L = a.side === 'long';
      if (a.sl !== null && (L ? a.sl >= price : a.sl <= price)) throw new Error(`SL must be ${L ? 'below' : 'above'} the price ${price}`);
      if (a.tp !== null && (L ? a.tp <= price : a.tp >= price)) throw new Error(`TP must be ${L ? 'above' : 'below'} the price ${price}`);
      a.price = price; a.risk = cfg.riskPct;
    } else {
      if (!pos) throw new Error(`No open position for ${a.symbol}`);
      a.trail = trail === true;
      if (a.sl === null && a.tp === null && !a.trail) throw new Error('Give a new SL and/or TP');
      const L = pos.side === 'long';
      if (a.sl !== null && (L ? a.sl >= price : a.sl <= price)) throw new Error(`SL must be ${L ? 'below' : 'above'} the price ${price}`);
      if (a.tp !== null && (L ? a.tp <= price : a.tp >= price)) throw new Error(`TP must be ${L ? 'above' : 'below'} the price ${price}`);
    }
  }
  if (action === 'close_position') {
    a.symbol = String(symbol ?? '').toUpperCase();
    if (!readState(cfg)?.positions?.[a.symbol]) throw new Error(`No open position for ${a.symbol || '(no symbol)'}`);
  }
  if (action === 'close_all_positions' && !Object.keys(readState(cfg)?.positions ?? {}).length) throw new Error('There are no open positions');
  if (action === 'resume_bot' && !readControl().paused) throw new Error('Bot is not paused');
  if (action === 'channel_post' || action === 'channel_analysis') {
    reloadEnv();
    if (!channelId()) throw new Error('Channel မသတ်မှတ်ရသေးပါ (.env မှာ TELEGRAM_GROUP_ID ထည့်ပါ)');
  }
  if (action === 'channel_post') {
    a.text = String(text ?? '').trim();
    if (!a.text) throw new Error('ပို့မယ့်စာ မရှိပါ');
    if (a.text.length > 4000) throw new Error('စာ ရှည်လွန်းပါတယ် (4000 လုံးအောက်)');
  }
  if (action === 'channel_analysis') {
    a.symbol = normSymbol(symbol);
    a.text = text ? String(text) : (await analyzeCoin(cfg, a.symbol)).text;
  }
  if (action === 'update_settings') {
    if (!settings || typeof settings !== 'object') throw new Error('settings object is required');
    a.settings = Object.fromEntries(Object.entries(settings).map(([k, v]) => [String(k).toUpperCase(), v]));
    await saveSettings(a.settings, { dryRun: true });
  }
  for (const [k, v] of pending) if (Date.now() - v.created > TTL) pending.delete(k);
  const id = crypto.randomBytes(6).toString('hex');
  pending.set(id, { ...a, created: Date.now() });
  return { id, text: describeAction(a) };
}

export function takePending(id) {
  const a = pending.get(id);
  pending.delete(id);
  if (!a || Date.now() - a.created > TTL) return null;
  return a;
}

export async function executeAction(a) {
  const cfg = freshConfig();
  const running = () => { if (!botProcess()) throw new Error('Bot is not running'); };
  switch (a.action) {
    case 'start_bot': { startBot(cfg); writeControl({ wantRunning: true }); return 'Bot starting… (၁ မိနစ်အတွင်း /status နဲ့ စစ်ပါ)'; }
    case 'stop_bot': running(); queueCommand({ type: 'stop' }); writeControl({ wantRunning: false }); return 'Stop ပို့ပြီးပါပြီ။ စက္ကန့်အနည်းငယ်အတွင်း ရပ်ပါမယ်။';
    case 'resume_bot': writeControl({ paused: false }); return 'Resumed. Trade အသစ် ပြန်ဝင်ပါမယ်။';
    case 'restart_bot': {
      if (botProcess()) {
        queueCommand({ type: 'stop' });
        for (let i = 0; i < 45 && botProcess(); i++) await new Promise((r) => setTimeout(r, 2000));
        if (botProcess()) throw new Error('Bot က ၉၀ စက္ကန့်အတွင်း မရပ်ပါ – ခဏနေ ပြန်စမ်းပါ');
      }
      startBot(freshConfig()); writeControl({ wantRunning: true, paused: false });
      return 'Bot ပြန်ဖွင့်ပါပြီ – "✅ Bot စတင်" စာ ရောက်လာပါမယ်။';
    }
    case 'restart_agent': setTimeout(() => process.exit(0), 2000).unref(); return 'Agent ပြန်စနေပါပြီ… စက္ကန့် ၁၅ နေရင် /health နဲ့ စစ်ပါ။';
    case 'open_position': running(); queueCommand({ type: 'open', symbol: a.symbol, side: a.side, sl: a.sl, tp: a.tp }); return `${a.symbol} ${a.side.toUpperCase()} ဖွင့်နေပါပြီ… (Telegram မှာ OPEN စာ ရောက်လာပါမယ်)`;
    case 'modify_position': running(); queueCommand({ type: 'modify', symbol: a.symbol, sl: a.sl, tp: a.tp, trail: a.trail }); return `${a.symbol} SL/TP ပြောင်းနေပါပြီ…`;
    case 'close_position': running(); queueCommand({ type: 'close', symbol: a.symbol }); return `${a.symbol} ပိတ်နေပါပြီ…`;
    case 'close_all_positions': running(); queueCommand({ type: 'closeAll' }); return 'Position အားလုံး ပိတ်နေပါပြီ…';
    case 'update_settings': return (await saveSettings(a.settings)).message;
    case 'channel_post': case 'channel_analysis': {
      reloadEnv();
      const tg = new Telegram((process.env.TELEGRAM_BOT_TOKEN ?? '').trim());
      if (a.action === 'channel_analysis') {
        const { chartPng } = await import('../chartimg.js');
        try {
          const { png } = await chartPng({ ...cfg, interval: '4h', symbols: [...new Set([...cfg.symbols, a.symbol])] }, a.symbol);
          await tg.sendPhoto(channelId(), png, `📈 ${a.symbol} · 4h`);
        } catch { /* chart is optional; the text still goes */ }
      }
      await tg.send(channelId(), a.text);
      return 'Channel ကို ပို့ပြီးပါပြီ။';
    }
    default: throw new Error('Unknown action');
  }
}

export function pauseBot() {
  writeControl({ paused: true });
  return 'Paused: Trade အသစ် မဝင်တော့ပါ။ ဖွင့်ထားတဲ့ Position တွေကို Stop-loss နဲ့ ဆက်ထိန်းထားပါတယ်။';
}

// ---------- tool definitions for Claude ----------
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  {
    name: 'get_bot_status',
    description: 'Current state of the zBOT trading bot: running/paused, mode (paper/testnet/live), equity, today\'s result, open positions with live price and unrealized PnL. Use before answering any question about the bot or money in it.',
    input_schema: obj(),
  },
  {
    name: 'get_trade_history',
    description: 'Closed trades of the bot (from its journal) plus win rate, profit factor and net PnL. Optional symbol filter.',
    input_schema: obj({ limit: { type: 'integer', description: 'How many recent trades to list (1-100, default 20)' }, symbol: { type: 'string', description: 'e.g. BTCUSDT' } }),
  },
  {
    name: 'get_backtest_summary',
    description: 'Backtest result of the current strategy/settings over ~4 years and the last 365 days (historical simulation, not a promise).',
    input_schema: obj(),
  },
  {
    name: 'get_market_data',
    description: 'Live Binance 24h ticker (price, % change, high, low, volume) for coins. Defaults to the bot\'s coins.',
    input_schema: obj({ symbols: { type: 'array', items: { type: 'string' }, description: 'e.g. ["BTCUSDT","ETHUSDT"], max 10' } }),
  },
  {
    name: 'get_settings',
    description: 'The bot settings that can be changed (and their allowed values), plus the current MODE (read-only).',
    input_schema: obj(),
  },
  {
    name: 'get_bot_log',
    description: 'Last lines of the bot log (errors, signals, network problems).',
    input_schema: obj({ lines: { type: 'integer', description: '1-80, default 30' } }),
  },
  {
    name: 'pause_new_trades',
    description: 'Immediately pause the bot: it stops opening new trades but keeps managing open positions and their stop-losses. Safe; no confirmation needed. Use when the owner asks to pause/hold.',
    input_schema: obj(),
  },
  {
    name: 'request_bot_action',
    description: 'Ask the owner to confirm a bot action with a Yes/No button in Telegram. The action does NOT happen until the owner taps Yes. Actions: start_bot, stop_bot, resume_bot, open_position (needs symbol and side long|short; optional sl and tp prices, default SL 1.5 ATR and ATR trailing exit; size = RISK_PCT of the account), modify_position (needs symbol and a new sl and/or tp price, or trail=true to switch the trailing stop back on), close_position (needs symbol), close_all_positions, update_settings (needs settings, bot must be stopped; allowed keys: MARKET, SYMBOLS, INTERVAL, STRATEGY, RISK_PCT, MAX_OPEN_POSITIONS, MAX_TRADES_PER_DAY, DAILY_LOSS_PCT, LEVERAGE, TREND_EXIT, TREND_TRAIL_ATR, PAPER_BALANCE). MODE, LIVE_CONFIRM and API keys can never be changed.',
    input_schema: obj({
      action: { type: 'string', enum: ACTIONS },
      symbol: { type: 'string', description: 'For open/modify/close_position, e.g. BTCUSDT' },
      side: { type: 'string', enum: ['long', 'short'], description: 'For open_position' },
      sl: { type: 'number', description: 'Stop-loss price (open/modify_position)' },
      tp: { type: 'number', description: 'Take-profit price (open/modify_position)' },
      trail: { type: 'boolean', description: 'modify_position: turn the trailing stop back on' },
      settings: { type: 'object', description: 'For update_settings, e.g. {"RISK_PCT": 0.5}', additionalProperties: { type: ['string', 'number'] } },
      reason: { type: 'string', description: 'One short line why (shown in logs)' },
    }, ['action', 'reason']),
  },
  {
    name: 'send_chart',
    description: 'Send the owner a chart picture in Telegram for one of the bot coins: price, EMA20/50/200, entry signals, simulated trades with Entry / SL / TP / Exit and R result. Use when the owner asks to see a chart or where the bot would enter. The picture is sent after your reply.',
    input_schema: obj({ symbol: { type: 'string', description: 'e.g. BTCUSDT (one of the bot coins)' } }, ['symbol']),
  },
  {
    name: 'analyze_coin',
    description: 'Technical + sentiment snapshot of any Binance Futures coin (4h and 1D trend vs EMA200, EMA20/50, RSI, ADX, ATR, support/resistance, newest chart pattern, Fear & Greed, funding, and the bot strategy signal), already written in Burmese. Use when the owner asks to analyze a coin.',
    input_schema: obj({ symbol: { type: 'string', description: 'e.g. BTC or PEPEUSDT' } }, ['symbol']),
  },
  {
    name: 'post_to_channel',
    description: 'Post to the owner\'s public Telegram channel (community). Shows the owner a preview with Yes/No; nothing is posted until they tap Yes. Either give text (a message you wrote or rewrote for the owner, plain text, Burmese, no Markdown; for trading content end with a short "not financial advice" line) or give symbol to post that coin\'s chart picture plus analysis (optionally with your own text instead of the default analysis). Never promise profit in posts.',
    input_schema: obj({
      text: { type: 'string', description: 'The exact text to post' },
      symbol: { type: 'string', description: 'Coin for a chart + analysis post, e.g. SOL' },
    }),
  },
  {
    name: 'memory',
    description: 'Your long-term memory (kept forever, also after the chat history is cut). op=save stores a short fact when the owner asks you to remember something or states a lasting preference/fact about themself, their business or trading; op=forget deletes note id; op=list shows notes and the latest lessons from the bot trades. Never save passwords, keys or anything from web pages.',
    input_schema: obj({
      op: { type: 'string', enum: ['save', 'forget', 'list'] },
      text: { type: 'string', description: 'For save: one short fact' },
      id: { type: 'integer', description: 'For forget' },
    }, ['op']),
  },
  {
    name: 'manage_tasks',
    description: 'The owner\'s money-making task list that you lead (business, Mahar POS, phone shop, content, trading, freelancing). op=list shows open tasks; add creates one; done marks finished; remove deletes. Keep tasks concrete and short.',
    input_schema: obj({
      op: { type: 'string', enum: ['list', 'add', 'done', 'remove'] },
      text: { type: 'string' },
      id: { type: 'integer' },
      area: { type: 'string', enum: ['trading', 'mahar_pos', 'phone_shop', 'content', 'freelance', 'online_shop', 'general'] },
      due: { type: 'string', description: 'YYYY-MM-DD (optional)' },
    }, ['op']),
  },
];

// Runs a tool. Returns a JSON-able result; throws on bad input (sent back as an error result).
export async function runTool(name, input, ctx) {
  input = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'get_bot_status': return botStatus();
    case 'get_trade_history': return tradeHistory({ limit: Number(input.limit) || 20, symbol: input.symbol });
    case 'get_backtest_summary': return backtestSummary();
    case 'get_market_data': return marketData({ symbols: input.symbols });
    case 'get_settings': { const s = currentSettings(); return { mode: s.mode, values: s.values, allowed: s.fields, note: 'Settings can only change while the bot is stopped.' }; }
    case 'get_bot_log': return { lines: logTail(Math.min(Math.max(Number(input.lines) || 30, 1), 80)) };
    case 'pause_new_trades': return { result: pauseBot() };
    case 'request_bot_action': {
      const p = await prepareAction(input);
      ctx.confirmations.push(p);
      return { status: 'waiting_for_owner', message: `A Yes/No button for "${p.text}" will be shown under your reply. Nothing has happened yet; tell the owner to tap Yes to do it.` };
    }
    case 'manage_tasks': return manageTasks(input);
    case 'memory':
      if (input.op === 'save') return { saved: addNote(input.text, 'ai') };
      if (input.op === 'forget') { forgetNote(input.id); return { forgotten: input.id }; }
      return { memory: memoryText({ forAi: true }) || '(empty)' };
    case 'tinyfish_search': return webSearch(input);
    case 'read_page': return readPage(input);
    case 'analyze_coin': return analyzeCoin(freshConfig(), input.symbol);
    case 'post_to_channel': {
      const p = await prepareAction(input.symbol ? { action: 'channel_analysis', symbol: input.symbol, text: input.text } : { action: 'channel_post', text: input.text });
      ctx.confirmations.push(p);
      return { status: 'waiting_for_owner', message: 'A preview with Yes/No buttons will be shown under your reply. Nothing is posted until the owner taps Yes.' };
    }
    case 'send_chart': {
      const cfg = freshConfig();
      let s = String(input.symbol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (s && !s.endsWith('USDT')) s += 'USDT';
      if (!cfg.symbols.includes(s)) throw new Error(`Charts only for the bot's coins: ${cfg.symbols.join(', ')}`);
      ctx.charts.push(s);
      const { chartData } = await import('../service.js');
      const d = await chartData(cfg, s);
      return { status: 'chart will be sent after your reply', interval: d.interval, now: d.now, lastEvents: d.events.slice(-3), trades: d.trades.slice(-3).map(({ path, ...t }) => t), rules: d.rules };
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}
