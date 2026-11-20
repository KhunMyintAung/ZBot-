// Position size so that hitting the stop loses exactly riskPct of equity,
// capped by available notional (equity for spot, equity x leverage for futures).
export function positionSize({ equity, riskPct, stopDist, entry, maxNotional }) {
  const riskAmt = (equity * riskPct) / 100;
  let qty = riskAmt / stopDist;
  if (qty * entry > maxNotional) qty = maxNotional / entry;
  return qty;
}

export function maxNotional(cfg, equity) {
  // keep 5% aside for fees / margin buffer
  return cfg.market === 'futures' ? equity * cfg.leverage * 0.95 : equity * 0.95;
}

// Day key in Myanmar time (UTC+6:30) so "today" matches the trader's day.
export function dayKey(ms) {
  return new Date(ms + 6.5 * 3600_000).toISOString().slice(0, 10);
}

// Daily kill switch. `day` is a mutable object: { key, startEquity, trades, halted }.
export function checkDay(day, cfg, equity, nowMs) {
  const k = dayKey(nowMs);
  if (day.key !== k) Object.assign(day, { key: k, startEquity: equity, trades: 0, halted: false });
  if (day.halted) return { ok: false, reason: 'halted for today' };
  const lossPct = ((day.startEquity - equity) / day.startEquity) * 100;
  if (lossPct >= cfg.dailyLossPct) {
    day.halted = true;
    return { ok: false, reason: `daily loss ${lossPct.toFixed(2)}% >= ${cfg.dailyLossPct}%`, justHalted: true };
  }
  if (day.trades >= cfg.maxTradesPerDay) return { ok: false, reason: `max ${cfg.maxTradesPerDay} trades today` };
  return { ok: true };
}
