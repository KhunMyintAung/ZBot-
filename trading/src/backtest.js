import { prepare, signalAt, WARMUP } from './strategies.js';
import { positionSize, maxNotional, checkDay } from './risk.js';

// Portfolio simulation over one or more coins sharing ONE account:
//  - signal on the close of bar i, entry at the OPEN of bar i+1 (+ slippage)
//  - SL/TP checked on each bar's high/low; if both are touched in one bar, assume SL (worst case)
//  - fees charged on entry and exit notional
//  - shared equity, shared notional cap, MAX_OPEN_POSITIONS, same daily kill switch as the live bot
export function backtestPortfolio(series, cfg) {
  const syms = Object.keys(series);
  const X = {}, at = {};
  for (const s of syms) {
    X[s] = prepare(series[s]);
    at[s] = new Map(series[s].map((k, i) => [k.t, i]));
  }
  const times = [...new Set(syms.flatMap((s) => series[s].map((k) => k.t)))].sort((a, b) => a - b);

  const fee = cfg.feePct / 100, slip = cfg.slippagePct / 100;
  let equity = cfg.startBalance, peak = equity, maxDD = 0;
  const pos = {}, pending = {};
  const day = {};
  const trades = [];
  // DBS rule: after N losses in a row, stop opening trades for a while (cfg.lossStreak, cfg.lossPauseH).
  let streak = 0, pauseUntil = 0;
  const openNotional = () => Object.values(pos).reduce((a, p) => a + p.qty * p.entry, 0);
  const openCount = () => Object.keys(pos).length + Object.keys(pending).length;

  const close = (s, k, exitRaw, why) => {
    const p = pos[s];
    const dir = p.side === 'long' ? 1 : -1;
    const exit = exitRaw * (1 - dir * slip);
    const pnl = (exit - p.entry) * p.qty * dir - (p.entry + exit) * p.qty * fee;
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    trades.push({ ...p, symbol: s, exit, exitT: k.t, pnl, R: pnl / p.riskAmt, why, equity });
    streak = pnl < 0 ? streak + 1 : 0;
    if (cfg.lossStreak && streak >= cfg.lossStreak) { pauseUntil = k.t + (cfg.lossPauseH ?? 24) * 3600e3; streak = 0; }
    delete pos[s];
  };

  for (const t of times) {
    // 1. fills and exits for every coin that has this bar
    for (const s of syms) {
      const i = at[s].get(t);
      if (i === undefined || i < WARMUP) continue;
      const k = series[s][i], x = X[s];

      if (pending[s]) {
        const sig = pending[s];
        delete pending[s];
        const dir = sig.side === 'long' ? 1 : -1;
        const entry = k.o * (1 + dir * slip);
        const room = maxNotional(cfg, equity) - openNotional();
        if (room > 0) {
          const qty = positionSize({ equity, riskPct: cfg.riskPct, stopDist: sig.stopDist, entry, maxNotional: room });
          pos[s] = {
            side: sig.side, entry, qty, entryT: k.t, reason: sig.reason,
            sl: entry - dir * sig.stopDist, tp: entry + dir * sig.tpDist,
            riskAmt: qty * sig.stopDist, trailAtr: sig.trailAtr, best: entry,
          };
        }
      }

      const p = pos[s];
      if (p) {
        const L = p.side === 'long';
        if (L ? k.o <= p.sl : k.o >= p.sl) close(s, k, k.o, 'SL (gap)');
        else if (L ? k.o >= p.tp : k.o <= p.tp) close(s, k, k.o, 'TP (gap)');
        else if (L ? k.l <= p.sl : k.h >= p.sl) close(s, k, p.sl, p.trailAtr && (L ? p.sl > p.entry : p.sl < p.entry) ? 'TRAIL' : 'SL');
        else if (L ? k.h >= p.tp : k.l <= p.tp) close(s, k, p.tp, 'TP');
        // Chandelier trailing stop: moves only in the trade's favour, used from the NEXT bar.
        if (pos[s]?.trailAtr && Number.isFinite(x.atr[i])) pos[s].sl = trailStop(pos[s], k.h, k.l, x.atr[i]);
      }
    }

    // 2. new signals on this bar's close
    for (const s of syms) {
      const i = at[s].get(t);
      if (i === undefined || pos[s] || pending[s] || i >= series[s].length - 1) continue;
      if (openCount() >= cfg.maxOpen) break;
      if (t < pauseUntil) break;
      const gate = checkDay(day, cfg, equity, series[s][i].closeT);
      if (!gate.ok) break;
      const sig = signalAt(cfg.strategy, X[s], i, cfg);
      // optional outside-data filter (news / sentiment), research only
      if (sig && cfg.filter && !cfg.filter(s, sig, series[s][i].closeT)) continue;
      if (sig) { pending[s] = sig; day.trades++; }
    }
  }
  for (const s of Object.keys(pos)) close(s, series[s].at(-1), series[s].at(-1).c, 'end of data');

  return { trades, finalEquity: equity, maxDD };
}

export const backtest = (candles, cfg) => backtestPortfolio({ [cfg.symbol]: candles }, cfg);

// Shared with the live bot. Mutates pos.best, returns the new stop price.
export function trailStop(pos, high, low, atr) {
  if (pos.side === 'long') {
    pos.best = Math.max(pos.best, high);
    return Math.max(pos.sl, pos.best - pos.trailAtr * atr);
  }
  pos.best = Math.min(pos.best, low);
  return Math.min(pos.sl, pos.best + pos.trailAtr * atr);
}

export function summarize(trades, startBalance, maxDD) {
  const wins = trades.filter((t) => t.pnl > 0);
  const grossW = wins.reduce((s, t) => s + t.pnl, 0);
  const grossL = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossL ? grossW / grossL : (grossW ? Infinity : 0),
    netPnl: net,
    netPct: (net / startBalance) * 100,
    sumR: trades.reduce((s, t) => s + t.R, 0),
    avgR: trades.length ? trades.reduce((s, t) => s + t.R, 0) / trades.length : 0,
    maxDDPct: maxDD === undefined ? undefined : maxDD * 100,
  };
}
