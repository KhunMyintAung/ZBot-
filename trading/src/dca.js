// "Buy the dip" Spot rules driven by the Fear & Greed index (no leverage, so no liquidation).
// One decision per week. The same function is used by the backtest (scripts) and by the paper tracker
// (src/agent/dcapaper.js), so what is tested is exactly what runs.
//
// Rules (unit = the normal weekly amount, e.g. 10 USDT):
//   plain     – buy 1 unit every week, whatever the mood (classic DCA, the yardstick)
//   fear      – buy 1 unit only in Fear / Extreme Fear (F&G <= 30); otherwise keep the cash
//   scaled    – Extreme Fear (<= 20): 2 units, Fear (<= 30): 1 unit, otherwise nothing
//   scaledTP  – like scaled, and in Extreme Greed (>= 75) sell 20% of the coins (take profit)
//   fearTP    – like fear, and in Extreme Greed (>= 75) sell 20% of the coins

export const RULES = ['plain', 'fear', 'scaled', 'scaledTP', 'fearTP'];
export const FEE = 0.001; // Binance Spot 0.1%

// What to do this week: { buyUnits, sellPct }
export function decide(rule, fng) {
  const f = Number(fng);
  const ok = Number.isFinite(f);
  const greedSell = (rule === 'scaledTP' || rule === 'fearTP') && ok && f >= 75 ? 0.2 : 0;
  if (rule === 'plain') return { buyUnits: 1, sellPct: 0 };
  if (!ok) return { buyUnits: 0, sellPct: 0 };
  if (rule === 'fear' || rule === 'fearTP') return { buyUnits: f <= 30 ? 1 : 0, sellPct: greedSell };
  if (rule === 'scaled' || rule === 'scaledTP') return { buyUnits: f <= 20 ? 2 : f <= 30 ? 1 : 0, sellPct: greedSell };
  throw new Error(`unknown rule ${rule}`);
}

// Apply one weekly step to a portfolio { coins, invested, cashOut, buys, sells }. Mutates and returns it.
export function step(pf, { price, fng, unit, rule }) {
  const d = decide(rule, fng);
  if (d.sellPct && pf.coins > 0) {
    const q = pf.coins * d.sellPct;
    pf.coins -= q;
    pf.cashOut += q * price * (1 - FEE);
    pf.sells += 1;
  }
  if (d.buyUnits) {
    const usd = d.buyUnits * unit;
    pf.coins += (usd * (1 - FEE)) / price;
    pf.invested += usd;
    pf.buys += 1;
  }
  return d;
}

export const newPortfolio = () => ({ coins: 0, invested: 0, cashOut: 0, buys: 0, sells: 0 });
export const value = (pf, price) => pf.coins * price + pf.cashOut;
