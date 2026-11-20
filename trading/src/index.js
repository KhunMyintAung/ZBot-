import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, parseArgs, DATA_DIR, ENV_FILE } from './config.js';
import { Binance } from './binance.js';
import { backtestPortfolio, summarize } from './backtest.js';
import { STRATEGY_NAMES } from './strategies.js';
import { runBot } from './bot.js';

const HELP = `
zBOT Trader (Binance Spot + Futures, one or many coins)

  node src/index.js backtest  [--strategy trend] [--symbols BTCUSDT,ETHUSDT] [--market futures|spot] [--interval 4h] [--days 1460]
  node src/index.js compare   [same flags]   run every strategy on the same coins
  node src/index.js check     test API key (MODE=testnet or live)
  node src/index.js bot       run the bot on all SYMBOLS (MODE from .env: paper | testnet | live)
  node src/index.js dashboard open http://localhost:8787 to watch and control the bot
  node src/index.js set-password   set the dashboard login password (needed on a VPS)
  node src/index.js agent     Telegram AI agent (needs TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY)

Strategies: ${STRATEGY_NAMES.join(', ')}
`;

async function loadHistory(cfg, symbol) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${cfg.market}-${symbol}-${cfg.interval}-${cfg.days}d.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600e3) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const ex = new Binance({ ...cfg, mode: 'paper' }); // public data from live Binance
  const ks = await ex.history(symbol, cfg.interval, cfg.days, (n) => process.stdout.write(`\rDownloading ${symbol}... ${n} candles`));
  console.log(`\rDownloaded ${symbol}: ${ks.length} candles.                 `);
  fs.writeFileSync(file, JSON.stringify(ks));
  return ks;
}

async function loadAll(cfg) {
  if (cfg.faFilter) {
    const { fngHistory, backtestFilter } = await import('./fa.js');
    try { cfg.filter = backtestFilter(await fngHistory()); } catch (e) { console.log(`Fear & Greed history unavailable (${e.message}); testing without the filter.`); }
  }
  const series = {};
  for (const s of cfg.symbols) series[s] = await loadHistory(cfg, s);
  return series;
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const row = (s) => ({
  trades: s.trades, 'win %': f2(s.winRate), PF: f2(s.profitFactor),
  'net USDT': f2(s.netPnl), 'net %': f2(s.netPct), 'avg R': f2(s.avgR),
});

function splitTime(series) {
  const ts = Object.values(series).flatMap((ks) => [ks[0].t, ks.at(-1).t]);
  const from = Math.min(...ts), to = Math.max(...ts);
  return { from, to, split: from + (to - from) * 0.7 };
}

function report(cfg, series, res) {
  const { split } = splitTime(series);
  return {
    all: summarize(res.trades, cfg.startBalance, res.maxDD),
    ins: summarize(res.trades.filter((t) => t.entryT < split), cfg.startBalance),
    oos: summarize(res.trades.filter((t) => t.entryT >= split), cfg.startBalance),
  };
}

function printReport(cfg, series, res) {
  const r = report(cfg, series, res);
  const { from, to } = splitTime(series);
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  console.log(`\n=== ${cfg.strategy} | ${cfg.market} ${cfg.symbols.join(',')} ${cfg.interval} | ${d(from)} → ${d(to)} ===`);
  console.log(`Start ${cfg.startBalance} USDT (one shared account), risk ${cfg.riskPct}%/trade, max ${cfg.maxOpen} open, ` +
    `fee ${cfg.feePct}%, slippage ${cfg.slippagePct}%` + (cfg.market === 'futures' ? `, leverage cap ${cfg.leverage}x` : ', long only'));
  console.table({
    'All data': row(r.all),
    'In-sample (first 70%)': row(r.ins),
    'Out-of-sample (last 30%)': row(r.oos),
  });
  if (cfg.symbols.length > 1) {
    const per = {};
    for (const s of cfg.symbols) per[s] = row(summarize(res.trades.filter((t) => t.symbol === s), cfg.startBalance));
    console.log('Per coin (inside the shared account):');
    console.table(per);
  }
  console.log(`Max drawdown: ${f2(r.all.maxDDPct)}%   Final equity: ${f2(res.finalEquity)} USDT`);
  const pass = r.all.trades >= 100 && r.all.profitFactor > 1.3 && r.all.maxDDPct < 20 && r.oos.profitFactor > 1.1;
  console.log(pass
    ? 'PASS: worth forward-testing in paper/testnet for 1-3 months.'
    : 'NOT READY: needs PF>1.3, max DD<20%, 100+ trades, and out-of-sample PF>1.1. Do not trade it live.');
}

// Asks twice without showing the typed characters, saves only the hash to .env.
async function setPassword() {
  const { hashPassword } = await import('./auth.js');
  const MIN = 8;
  // Shows one * per typed character so you can see the typing arrives.
  const ask = (q) => new Promise((resolve) => {
    process.stdout.write(q);
    let s = '';
    const raw = process.stdin.isTTY;
    if (raw) process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }        // Ctrl+C
        if (ch === '\r' || ch === '\n') {
          process.stdin.off('data', onData);
          if (raw) process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          return resolve(s);
        }
        if (ch === '\u007f' || ch === '\b') { if (s) { s = s.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { s += ch; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });

  let pw = process.env.ZBOT_NEW_PASSWORD;
  for (let tries = 0; !pw && tries < 5; tries++) {
    const a = await ask(`New dashboard password (${MIN}+ characters): `);
    if (a.length < MIN) { console.log(`Too short (${a.length}). At least ${MIN} characters. Try again.\n`); continue; }
    if ((await ask('Type it again: ')) !== a) { console.log('The two passwords are different. Try again.\n'); continue; }
    pw = a;
  }
  if (!pw) throw new Error('No password set.');
  if (pw.length < MIN) throw new Error(`Password must be at least ${MIN} characters.`);
  if (pw.length < 12 || /^[a-z]+[0-9]+$/i.test(pw)) {
    console.log('Warning: this password is short or simple. Anyone who guesses it can stop the bot and close positions.');
  }
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `DASHBOARD_PASSWORD_HASH=${hashPassword(pw)}`;
  text = /^DASHBOARD_PASSWORD_HASH=.*$/m.test(text)
    ? text.replace(/^DASHBOARD_PASSWORD_HASH=.*$/m, line)
    : text.replace(/\s*$/, `\n\n# Dashboard login (hash only; set with: node src/index.js set-password)\n${line}\n`);
  fs.writeFileSync(ENV_FILE, text);
  console.log('Password saved (hash only) in .env. Restart the dashboard to use it.');
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  if (!cmd || flags.help) { console.log(HELP); return; }
  if (cmd === 'set-password') return setPassword(); // works even if other settings are invalid
  const cfg = loadConfig(flags);

  if (cmd === 'backtest') {
    const series = await loadAll(cfg);
    const res = backtestPortfolio(series, cfg);
    printReport(cfg, series, res);
    const name = cfg.symbols.length > 1 ? `portfolio${cfg.symbols.length}` : cfg.symbol;
    const out = path.join(DATA_DIR, `trades-${cfg.strategy}-${cfg.market}-${name}-${cfg.interval}.csv`);
    fs.writeFileSync(out, 'entry_time,symbol,side,entry,exit,qty,pnl,R,exit_reason,equity\n' + res.trades.map((t) =>
      [new Date(t.entryT).toISOString(), t.symbol, t.side, t.entry.toFixed(4), t.exit.toFixed(4), t.qty.toFixed(6),
        t.pnl.toFixed(2), t.R.toFixed(2), t.why, t.equity.toFixed(2)].join(',')).join('\n'));
    console.log(`Trades saved: ${out}`);
  } else if (cmd === 'compare') {
    const series = await loadAll(cfg);
    const rows = {};
    for (const s of STRATEGY_NAMES) {
      const c = { ...cfg, strategy: s };
      const res = backtestPortfolio(series, c);
      const r = report(c, series, res);
      rows[s] = { ...row(r.all), 'max DD %': f2(r.all.maxDDPct), 'OOS PF': f2(r.oos.profitFactor) };
    }
    console.log(`\n${cfg.market} ${cfg.symbols.join(',')} ${cfg.interval}, ${cfg.days} days, risk ${cfg.riskPct}%, max ${cfg.maxOpen} open`);
    console.table(rows);
  } else if (cmd === 'check') {
    if (cfg.mode === 'paper') { console.log('MODE=paper does not use API keys. Set MODE=testnet to test keys.'); return; }
    const ex = new Binance(cfg);
    const coins = [];
    for (const s of cfg.symbols) {
      const rules = await ex.symbolRules(s);
      const price = await ex.price(s);
      coins.push({ rules, price });
      console.log(`${s}: price ${price}, stepSize ${rules.stepSize}, minQty ${rules.minQty}, minNotional ${rules.minNotional}`);
    }
    const eq = await ex.equity(coins);
    console.log(`OK. ${cfg.mode} ${cfg.market} connected. Equity ≈ ${eq.toFixed(2)} ${coins[0].rules.quote}`);
  } else if (cmd === 'bot') {
    await runBot(cfg);
  } else if (cmd === 'agent') {
    const { runAgent } = await import('./agent/index.js');
    await runAgent();
  } else if (cmd === 'dashboard') {
    const { startDashboard } = await import('./dashboard.js');
    startDashboard(cfg, Number(flags.port ?? 8787));
  } else {
    console.log(HELP);
  }
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
