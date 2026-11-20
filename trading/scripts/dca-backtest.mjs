// Backtest of the Fear & Greed "buy the dip" Spot rules (src/dca.js) on daily Binance data.
//   node scripts/dca-backtest.mjs
// Weekly decision on each Monday's close. Unit 10 USDT. Reports, per coin and rule:
//   invested, final value, profit %, worst point (largest loss vs money put in so far), buys/sells.
import { RULES, step, newPortfolio, value } from '../src/dca.js';
import { fngHistory, valueAt } from '../src/fa.js';

const COINS = (process.argv[2] ?? 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT').split(',');
const UNIT = 10;

async function daily(symbol) {
  const out = [];
  let start = Date.parse('2018-02-01');
  for (;;) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=1000&startTime=${start}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const k of rows) if (k[6] < Date.now()) out.push({ t: k[0], c: +k[4] });
    if (rows.length < 1000) break;
    start = rows.at(-1)[0] + 864e5;
  }
  return out;
}

function run(days, fng, rule, from = 0) {
  const pf = newPortfolio();
  let worst = 0;
  for (const d of days) {
    if (d.t < from) continue;
    if (new Date(d.t).getUTCDay() !== 1) { // track the worst point every day
      if (pf.invested) worst = Math.min(worst, value(pf, d.c) / pf.invested - 1);
      continue;
    }
    step(pf, { price: d.c, fng: valueAt(fng, d.t), unit: UNIT, rule });
    if (pf.invested) worst = Math.min(worst, value(pf, d.c) / pf.invested - 1);
  }
  const last = days.at(-1).c;
  const v = value(pf, last);
  return { rule, invested: pf.invested, value: v, profitPct: pf.invested ? (v / pf.invested - 1) * 100 : 0, worstPct: worst * 100, buys: pf.buys, sells: pf.sells, coinsLeft: pf.coins };
}

const fng = await fngHistory();
const periods = [['all (since 2018)', 0], ['last 4 years', Date.now() - 4 * 365 * 864e5], ['last 2 years', Date.now() - 2 * 365 * 864e5]];
const summary = {};
for (const sym of COINS) {
  const days = await daily(sym);
  console.log(`\n=== ${sym}  ${new Date(days[0].t).toISOString().slice(0, 10)} → ${new Date(days.at(-1).t).toISOString().slice(0, 10)}  last ${days.at(-1).c}`);
  for (const [name, from] of periods) {
    console.log(`  -- ${name}`);
    for (const rule of RULES) {
      const r = run(days, fng, rule, from);
      (summary[`${name}|${rule}`] ??= []).push(r);
      console.log(`  ${rule.padEnd(9)} invested ${String(r.invested).padStart(6)}  value ${r.value.toFixed(0).padStart(7)}  profit ${r.profitPct.toFixed(1).padStart(7)}%  worst ${r.worstPct.toFixed(1).padStart(6)}%  buys ${r.buys} sells ${r.sells}`);
    }
  }
}
console.log('\n=== ALL COINS TOGETHER (sum)');
for (const [k, rs] of Object.entries(summary)) {
  const inv = rs.reduce((a, r) => a + r.invested, 0), val = rs.reduce((a, r) => a + r.value, 0);
  console.log(`  ${k.padEnd(30)} invested ${String(inv).padStart(6)}  value ${val.toFixed(0).padStart(7)}  profit ${((val / inv - 1) * 100).toFixed(1).padStart(7)}%  worst(avg) ${(rs.reduce((a, r) => a + r.worstPct, 0) / rs.length).toFixed(1)}%`);
}
