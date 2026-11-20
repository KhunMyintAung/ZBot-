import * as I from './indicators.js';
import { pivots, patternAt } from './patterns.js';

export const WARMUP = 210; // bars needed before the first signal (EMA200 + margin)

export function prepare(candles) {
  const o = candles.map((k) => k.o), h = candles.map((k) => k.h);
  const l = candles.map((k) => k.l), c = candles.map((k) => k.c);
  return {
    o, h, l, c,
    ema20: I.ema(c, 20), ema50: I.ema(c, 50), ema150: I.ema(c, 150), ema200: I.ema(c, 200),
    atr: I.atr(h, l, c, 14), rsi: I.rsi(c, 14), adx: I.adx(h, l, c, 14),
    bb: I.bollinger(c, 20, 2), dc: I.donchian(h, l, 20), dc55: I.donchian(h, l, 55),
    piv: pivots(h, l, 3),
  };
}

const ok = (...xs) => xs.every((x) => Number.isFinite(x));

// Trend filter. true / 'ema200': price above/below EMA200.
// 'stack' (DBS "traffic light" EMA 50/150/200): long only when 50 > 150 > 200 and price above 50; short mirrored.
// false: no filter.
function trendOk(x, i, mode) {
  if (!mode) return { up: true, dn: true };
  const { c, ema50: f, ema150: m, ema200: s } = x;
  if (mode === 'stack') return { up: f[i] > m[i] && m[i] > s[i] && c[i] > m[i], dn: f[i] < m[i] && m[i] < s[i] && c[i] < m[i] };
  return { up: c[i] > s[i], dn: c[i] < s[i] };
}

// Candle shapes at bar i (the 3 DBS entry candles: pin bar / hammer / shooting star, engulfing; doji = helper).
function candleAt(x, i) {
  const { o, h, l, c } = x;
  const body = Math.abs(c[i] - o[i]), range = h[i] - l[i];
  const upW = h[i] - Math.max(o[i], c[i]), loW = Math.min(o[i], c[i]) - l[i];
  const pb = Math.abs(c[i - 1] - o[i - 1]);
  return {
    range,
    hammer: range > 0 && loW >= 2 * body && upW <= 0.25 * range && loW >= 0.5 * range,
    star: range > 0 && upW >= 2 * body && loW <= 0.25 * range && upW >= 0.5 * range,
    bullEng: c[i - 1] < o[i - 1] && c[i] > o[i] && c[i] >= o[i - 1] && o[i] <= c[i - 1] && body > pb,
    bearEng: c[i - 1] > o[i - 1] && c[i] < o[i] && c[i] <= o[i - 1] && o[i] >= c[i - 1] && body > pb,
  };
}

// Each strategy looks at the CLOSED bar i and returns
// { side: 'long'|'short', stopDist, tpDist, reason } or null.
// Distances are in price units, measured from the entry price.
const STRATS = {
  // A: EMA20/50 cross in the direction of EMA200.
  // Options (cfg.trend): adxMin filter, EMA200 slope filter, fixed TP or ATR trailing stop.
  trend(x, i, cfg = {}) {
    const o = { slAtr: 1.5, tpAtr: 3, adxMin: 0, slope: false, exit: 'fixed', trailAtr: 3, ...cfg.trend };
    const { ema20: f, ema50: s, ema200: t, c, atr, adx } = x;
    if (!ok(f[i - 1], s[i - 1], f[i], s[i], t[i], t[i - 10], atr[i])) return null;
    if (o.adxMin && !(adx[i] >= o.adxMin)) return null;
    const up = !o.slope || t[i] > t[i - 10];
    const dn = !o.slope || t[i] < t[i - 10];
    const trail = o.exit === 'trail';
    const exits = {
      stopDist: o.slAtr * atr[i],
      tpDist: (trail ? 100 : o.tpAtr) * atr[i], // trailing: TP far away, the trail closes the trade
      ...(trail ? { trailAtr: o.trailAtr } : {}),
    };
    if (f[i - 1] <= s[i - 1] && f[i] > s[i] && c[i] > t[i] && up)
      return { side: 'long', ...exits, reason: 'EMA20 crossed above EMA50, price above EMA200' };
    if (f[i - 1] >= s[i - 1] && f[i] < s[i] && c[i] < t[i] && dn)
      return { side: 'short', ...exits, reason: 'EMA20 crossed below EMA50, price below EMA200' };
    return null;
  },

  // B: close breaks the 20-bar high/low, with EMA200 as trend filter.
  breakout(x, i) {
    const { dc, c, ema200: t, atr } = x;
    if (!ok(dc.upper[i], dc.upper[i - 1], dc.lower[i], dc.lower[i - 1], t[i], atr[i])) return null;
    if (c[i] > dc.upper[i] && c[i - 1] <= dc.upper[i - 1] && c[i] > t[i])
      return { side: 'long', stopDist: 1.5 * atr[i], tpDist: 3 * atr[i], reason: '20-bar high breakout above EMA200' };
    if (c[i] < dc.lower[i] && c[i - 1] >= dc.lower[i - 1] && c[i] < t[i])
      return { side: 'short', stopDist: 1.5 * atr[i], tpDist: 3 * atr[i], reason: '20-bar low breakdown below EMA200' };
    return null;
  },

  // C: range market (ADX<20). Buy lower band + RSI<30, sell upper band + RSI>70. TP = middle band.
  meanrev(x, i) {
    const { adx, bb, rsi, c, atr } = x;
    if (!ok(adx[i], bb.lower[i], bb.upper[i], bb.mid[i], rsi[i], atr[i])) return null;
    if (adx[i] >= 20) return null;
    if (c[i] <= bb.lower[i] && rsi[i] < 30)
      return { side: 'long', stopDist: Math.max(c[i] - (bb.lower[i] - atr[i]), atr[i]), tpDist: bb.mid[i] - c[i], reason: 'Range: lower band + RSI<30', meanrev: true };
    if (c[i] >= bb.upper[i] && rsi[i] > 70)
      return { side: 'short', stopDist: Math.max(bb.upper[i] + atr[i] - c[i], atr[i]), tpDist: c[i] - bb.mid[i], reason: 'Range: upper band + RSI>70', meanrev: true };
    return null;
  },

  // D: chart patterns (triangle, flag, pennant, wedge, head & shoulders, double top/bottom).
  // Enters when the candle CLOSES outside the pattern. Options (cfg.pattern):
  //   mode 'bias' = only breakouts in the textbook direction, 'any' = every breakout
  //   ema = also require price on the right side of EMA200
  pattern(x, i, cfg = {}) {
    const o = { mode: 'bias', ema: false, slAtr: 1.5, trailAtr: 3, only: null, ...cfg.pattern };
    const p = patternAt(x, i, o);
    if (!p || !ok(x.atr[i], x.ema200[i])) return null;
    const d = p.side === 'long' ? 1 : -1;
    if (o.mode === 'bias' && p.bias !== d) return null;
    if (o.ema && (d === 1 ? x.c[i] < x.ema200[i] : x.c[i] > x.ema200[i])) return null;
    if (o.only && !o.only.includes(p.name)) return null;
    return { side: p.side, stopDist: o.slAtr * x.atr[i], tpDist: 100 * x.atr[i], trailAtr: o.trailAtr, reason: `${p.name} breakout`, pattern: p.name, shape: { upper: p.upper, lower: p.lower } };
  },

  // E: N-bar high/low breakout with EMA200 filter and ATR trailing stop (classic trend following).
  donchian(x, i, cfg = {}) {
    const o = { n: 55, slAtr: 1.5, trailAtr: 3, ...cfg.donchian };
    const dc = o.n === 20 ? x.dc : x.dc55;
    const { c, ema200: t, atr } = x;
    if (!ok(dc.upper[i - 1], dc.upper[i - 2], dc.lower[i - 1], dc.lower[i - 2], t[i], atr[i])) return null;
    const exits = { stopDist: o.slAtr * atr[i], tpDist: 100 * atr[i], trailAtr: o.trailAtr };
    if (c[i] > dc.upper[i - 1] && c[i - 1] <= dc.upper[i - 2] && c[i] > t[i]) return { side: 'long', ...exits, reason: `${o.n}-bar high breakout above EMA200` };
    if (c[i] < dc.lower[i - 1] && c[i - 1] >= dc.lower[i - 2] && c[i] < t[i]) return { side: 'short', ...exits, reason: `${o.n}-bar low breakdown below EMA200` };
    return null;
  },

  // G: candlestick entry at a zone. Hammer / Shooting Star (pin bar) and Bullish / Bearish Engulfing,
  // ONLY when the candle sits on a support (recent swing low) or resistance (recent swing high) zone.
  // A Doji is never an entry by itself; a Doji just before the signal is noted as extra confirmation.
  // Options (cfg.candle): zoneAtr (how close to the zone), rr (TP = rr x risk), trend (EMA200 filter),
  // trailAtr (use a trailing stop instead of a fixed TP), lookback (bars to look for zones).
  candle(x, i, cfg = {}) {
    // trailAtr 4 won the 4-year 4h backtest (fixed 2R TP lost money): let winners run. trend 'stack' (EMA 50/150/200)
    // was the most robust on coins it was not tuned on.
    const o = { zoneAtr: 0.5, rr: 2, trend: 'stack', trailAtr: 4, lookback: 120, ...cfg.candle };
    const { o: op, h, l, c, atr, ema200: t, piv } = x;
    const a = atr[i];
    if (!ok(op[i], op[i - 1], c[i - 1], a, t[i])) return null;
    const body = Math.abs(c[i] - op[i]), range = h[i] - l[i];
    if (range < 0.5 * a) return null; // too small to mean anything
    const upW = h[i] - Math.max(op[i], c[i]), loW = Math.min(op[i], c[i]) - l[i];
    const pb = Math.abs(c[i - 1] - op[i - 1]);
    const hammer = loW >= 2 * body && upW <= 0.25 * range && loW >= 0.5 * range;
    const star = upW >= 2 * body && loW <= 0.25 * range && upW >= 0.5 * range;
    const bullEng = c[i - 1] < op[i - 1] && c[i] > op[i] && c[i] >= op[i - 1] && op[i] <= c[i - 1] && body > pb;
    const bearEng = c[i - 1] > op[i - 1] && c[i] < op[i] && c[i] <= op[i - 1] && op[i] >= c[i - 1] && body > pb;
    if (!hammer && !star && !bullEng && !bearEng) return null;
    // zones: swing points already confirmed at bar i (a pivot needs k bars after it)
    const seen = (arr) => arr.filter((p) => p.j <= i - piv.k - 1 && p.j >= i - o.lookback);
    const lowZ = Math.min(l[i], l[i - 1]), highZ = Math.max(h[i], h[i - 1]);
    const atSupport = seen(piv.lo).some((p) => Math.abs(lowZ - p.p) <= o.zoneAtr * a);
    const atResist = seen(piv.hi).some((p) => Math.abs(highZ - p.p) <= o.zoneAtr * a);
    const r = i - 2 >= 0 ? Math.abs(c[i - 1] - op[i - 1]) <= 0.1 * (h[i - 1] - l[i - 1]) : false;
    const doji = r ? ' (Doji ပြီးနောက်)' : '';
    const exits = (stop) => ({ stopDist: stop, tpDist: o.trailAtr ? 100 * a : o.rr * stop, ...(o.trailAtr ? { trailAtr: o.trailAtr } : {}) });
    const { up, dn } = trendOk(x, i, o.trend);
    if ((hammer || bullEng) && atSupport && up)
      return { side: 'long', ...exits(c[i] - (lowZ - 0.3 * a)), reason: `${hammer ? 'Hammer' : 'Bullish Engulfing'} at support${doji}` };
    if ((star || bearEng) && atResist && dn)
      return { side: 'short', ...exits(highZ + 0.3 * a - c[i]), reason: `${star ? 'Shooting Star' : 'Bearish Engulfing'} at resistance${doji}` };
    return null;
  },

  // F: trend signal first, chart pattern second.
  combo(x, i, cfg) { return STRATS.trend(x, i, cfg) ?? STRATS.pattern(x, i, cfg); },

  // I: DBS "Breakout + Retest". A swing high (resistance) is broken by a close, price comes back to that
  // level, and a confirmation candle (hammer / engulfing) closes back above it -> long. Short mirrored.
  // SL beyond the candle and the zone; trailing stop lets the move run (or fixed rr x risk).
  retest(x, i, cfg = {}) {
    const o = { zoneAtr: 0.5, maxAge: 30, trend: true, trailAtr: 4, rr: 2, ...cfg.retest };
    const { h, l, c, atr, piv } = x;
    const a = atr[i];
    if (!ok(a, c[i - 1])) return null;
    const k = candleAt(x, i);
    if (k.range < 0.5 * a) return null;
    const exits = (stop) => ({ stopDist: stop, tpDist: o.trailAtr ? 100 * a : o.rr * stop, ...(o.trailAtr ? { trailAtr: o.trailAtr } : {}) });
    const { up, dn } = trendOk(x, i, o.trend);
    const recent = (arr) => arr.filter((p) => p.j <= i - piv.k - 1 && p.j >= i - 150).slice(-6);
    // broken between `from` and i-1: first close beyond the level after the pivot, at most maxAge bars ago
    const brokeAt = (lvl, from, dir) => { for (let j = from; j < i; j++) if (dir > 0 ? c[j] > lvl : c[j] < lvl) return j; return -1; };
    if ((k.hammer || k.bullEng) && up) {
      for (const p of recent(piv.hi).reverse()) {
        const b = brokeAt(p.p, p.j + 1, 1);
        if (b < 0 || i - b > o.maxAge || i - b < 2) continue;
        if (Math.abs(l[i] - p.p) <= o.zoneAtr * a && c[i] > p.p) {
          const stop = c[i] - (Math.min(l[i], p.p) - 0.3 * a);
          return { side: 'long', ...exits(stop), reason: `Breakout retest of resistance (${k.hammer ? 'Hammer' : 'Bullish Engulfing'})` };
        }
      }
    }
    if ((k.star || k.bearEng) && dn) {
      for (const p of recent(piv.lo).reverse()) {
        const b = brokeAt(p.p, p.j + 1, -1);
        if (b < 0 || i - b > o.maxAge || i - b < 2) continue;
        if (Math.abs(h[i] - p.p) <= o.zoneAtr * a && c[i] < p.p) {
          const stop = Math.max(h[i], p.p) + 0.3 * a - c[i];
          return { side: 'short', ...exits(stop), reason: `Breakdown retest of support (${k.star ? 'Shooting Star' : 'Bearish Engulfing'})` };
        }
      }
    }
    return null;
  },

  // J: everything DBS teaches, in order of reliability: trend cross, chart-pattern breakout, breakout retest, candle at zone.
  dbs(x, i, cfg) { return STRATS.trend(x, i, cfg) ?? STRATS.pattern(x, i, cfg) ?? STRATS.retest(x, i, cfg) ?? STRATS.candle(x, i, cfg); },

  // H: combo first, then the candlestick-at-zone entry.
  brain(x, i, cfg) { return STRATS.combo(x, i, cfg) ?? STRATS.candle(x, i, cfg); },

  // Combo: ADX>25 -> trend/breakout, ADX<20 -> mean reversion, between -> wait.
  regime(x, i, cfg) {
    const a = x.adx[i];
    if (!ok(a)) return null;
    if (a > 25) return STRATS.trend(x, i, cfg) ?? STRATS.breakout(x, i);
    if (a < 20) return STRATS.meanrev(x, i);
    return null;
  },
};

export const STRATEGY_NAMES = Object.keys(STRATS);

export function signalAt(name, x, i, cfg) {
  const fn = STRATS[name];
  if (!fn) throw new Error(`Unknown strategy "${name}". Use one of: ${STRATEGY_NAMES.join(', ')}`);
  if (i < WARMUP) return null;
  const s = fn(x, i, cfg);
  if (!s) return null;
  if (s.side === 'short' && !cfg.allowShort) return null; // spot = long only
  if (!(s.stopDist > 0 && s.tpDist > 0)) return null;
  // Stops tighter than 1 ATR get hit by noise and fees eat the profit.
  if (s.stopDist < x.atr[i]) return null;
  // Skip trades where round-trip fees would eat more than 15% of the risk.
  if (cfg.feePct && (2 * cfg.feePct / 100) * x.c[i] > 0.15 * s.stopDist) return null;
  const need = s.meanrev ? cfg.minRRMeanrev : cfg.minRR;
  if (s.tpDist / s.stopDist < need) return null;
  return s;
}
