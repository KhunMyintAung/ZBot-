import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = path.join(ROOT, 'state');
export const DATA_DIR = path.join(ROOT, 'data');
export const ENV_FILE = path.join(ROOT, '.env');

// .env always wins, and can be re-read after the dashboard changes it.
export function reloadEnv() {
  if (fs.existsSync(ENV_FILE)) Object.assign(process.env, parseEnv(fs.readFileSync(ENV_FILE, 'utf8')));
}
reloadEnv();

// Ignore notes written after a value on the same line: "MODE=paper   ← note" or "MODE=paper  # note"
const clean = (v) => (v ?? '').split(/\s+(?:#|←)/)[0].trim();
const str = (k, d) => clean(process.env[k]) || d;
const num = (k, d) => {
  const raw = clean(process.env[k]);
  const v = Number(raw);
  return raw !== '' && Number.isFinite(v) ? v : d;
};

// CLI flags like --symbol ETHUSDT --market spot override .env
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export function loadConfig(flags = {}) {
  const market = String(flags.market ?? str('MARKET', 'futures')).toLowerCase();
  const c = {
    mode: String(flags.mode ?? str('MODE', 'paper')).toLowerCase(), // paper | testnet | live
    market, // spot | futures
    symbols: String(flags.symbols ?? flags.symbol ?? str('SYMBOLS', str('SYMBOL', 'BTCUSDT')))
      .toUpperCase().split(',').map((s) => s.trim()).filter(Boolean),
    maxOpen: Number(flags['max-open'] ?? num('MAX_OPEN_POSITIONS', 4)),
    interval: String(flags.interval ?? str('INTERVAL', '1h')),
    strategy: String(flags.strategy ?? str('STRATEGY', 'regime')).toLowerCase(),
    days: Number(flags.days ?? num('BACKTEST_DAYS', 730)),

    riskPct: Number(flags.risk ?? num('RISK_PCT', 1)),
    dailyLossPct: num('DAILY_LOSS_PCT', 3),
    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 5),
    leverage: Number(flags.leverage ?? num('LEVERAGE', 3)),
    minRR: num('MIN_RR', 1.5),
    minRRMeanrev: num('MIN_RR_MEANREV', 1.0),
    trend: {
      exit: String(flags['trend-exit'] ?? str('TREND_EXIT', 'trail')).toLowerCase(), // trail | fixed
      trailAtr: Number(flags['trail-atr'] ?? num('TREND_TRAIL_ATR', 3)),
      slAtr: num('TREND_SL_ATR', 1.5),
      tpAtr: num('TREND_TP_ATR', 3),
      adxMin: Number(flags['adx-min'] ?? num('TREND_ADX_MIN', 0)),
      slope: str('TREND_SLOPE', 'false') === 'true',
    },

    // chart-pattern strategy: bias = only textbook-direction breakouts, any = every breakout
    pattern: {
      mode: str('PATTERN_MODE', 'bias').toLowerCase(),
      ema: str('PATTERN_EMA200', 'true') !== 'false',
      trailAtr: num('TREND_TRAIL_ATR', 3),
      slAtr: num('TREND_SL_ATR', 1.5),
    },

    // Fear & Greed filter (see src/fa.js). FA_FILTER=false turns it off.
    faFilter: String(flags['fa-filter'] ?? str('FA_FILTER', 'true')).toLowerCase() !== 'false',

    startBalance: Number(flags.balance ?? num('PAPER_BALANCE', 1000)),
    feePct: num('FEE_PCT', market === 'spot' ? 0.1 : 0.05),
    slippagePct: num('SLIPPAGE_PCT', 0.02),
    pollSeconds: num('POLL_SECONDS', 20),

    apiKey: str('BINANCE_API_KEY', ''),
    apiSecret: str('BINANCE_API_SECRET', ''),
    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    // Community group / channel: gets trade signals (open/close) and news, read-only. Empty = off.
    telegramGroupId: str('TELEGRAM_GROUP_ID', ''),
    groupShare: str('GROUP_SHARE', 'trades,news,listings').toLowerCase(),
    liveConfirm: str('LIVE_CONFIRM', '') === 'YES',
  };
  c.allowShort = c.market === 'futures';
  c.symbol = c.symbols[0]; // single-coin commands use the first one
  validate(c);
  return c;
}

function validate(c) {
  const errs = [];
  if (!['paper', 'testnet', 'live'].includes(c.mode)) errs.push('MODE must be paper, testnet or live');
  if (!['spot', 'futures'].includes(c.market)) errs.push('MARKET must be spot or futures');
  if (!(c.riskPct > 0 && c.riskPct <= 2)) errs.push('RISK_PCT must be between 0 and 2');
  if (!(c.dailyLossPct > 0 && c.dailyLossPct <= 10)) errs.push('DAILY_LOSS_PCT must be between 0 and 10');
  if (c.market === 'futures' && !(c.leverage >= 1 && c.leverage <= 10)) errs.push('LEVERAGE must be 1-10 (the bot refuses more)');
  if (!c.symbols.length) errs.push('SYMBOLS is empty');
  if (!(c.maxOpen >= 1)) errs.push('MAX_OPEN_POSITIONS must be 1 or more');
  if (c.riskPct * Math.min(c.maxOpen, c.symbols.length) > 4)
    errs.push(`RISK_PCT x open positions = ${c.riskPct * Math.min(c.maxOpen, c.symbols.length)}% at risk at once. Keep it <= 4% (lower RISK_PCT or MAX_OPEN_POSITIONS)`);
  if (errs.length) throw new Error('Config error:\n  - ' + errs.join('\n  - '));
}
