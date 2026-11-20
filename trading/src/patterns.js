// Classic chart patterns, found with rules instead of eyes.
// Everything here uses only bars that are already CLOSED at bar i (a swing point at bar j
// is only known k bars later), so the backtest cannot look into the future.

// Swing highs/lows: bar j is a swing high when its high is the highest of k bars on both sides.
export function pivots(h, l, k = 3) {
  const hi = [], lo = [];
  for (let j = k; j < h.length - k; j++) {
    let isH = true, isL = true;
    for (let d = 1; d <= k && (isH || isL); d++) {
      if (!(h[j] > h[j - d] && h[j] >= h[j + d])) isH = false;
      if (!(l[j] < l[j - d] && l[j] <= l[j + d])) isL = false;
    }
    if (isH) hi.push({ j, p: h[j] });
    if (isL) lo.push({ j, p: l[j] });
  }
  return { hi, lo, k };
}

const lineAt = (a, b, i) => b.p + ((b.p - a.p) / (b.j - a.j)) * (i - b.j);
// last n swing points with index <= maxJ (arr is sorted by j)
const lastBefore = (arr, maxJ, n) => {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].j <= maxJ) lo = m + 1; else hi = m; }
  return lo >= n ? arr.slice(lo - n, lo) : null;
};

// Looks for a pattern that BREAKS OUT on the close of bar i.
// Returns { name, side, bias, upper:[points], lower:[points], height } or null.
//   side = direction of the breakout, bias = direction the textbook expects (1 up, -1 down, 0 none).
export function patternAt(x, i, opt = {}) {
  const o = { lookback: 80, minBars: 10, flat: 0.04, pole: 3, ...opt };
  const { c, atr, piv } = x;
  const a = atr[i];
  if (!piv || !(a > 0) || i < o.lookback + 20) return null;
  const known = i - piv.k; // newest swing point we are allowed to know about
  const H2 = lastBefore(piv.hi, known, 2), L2 = lastBefore(piv.lo, known, 2);
  if (!H2 || !L2) return null;

  const reversal = reversalAt(x, i, o, known);
  if (reversal) return reversal;

  const [h1, h2] = H2, [l1, l2] = L2;
  const start = Math.min(h1.j, l1.j);
  if (start < i - o.lookback || i - start < o.minBars) return null;
  const U = lineAt(h1, h2, i), Lw = lineAt(l1, l2, i);
  const U0 = lineAt(h1, h2, i - 1), L0 = lineAt(l1, l2, i - 1);
  if (!(U > Lw) || !(lineAt(h1, h2, start) > lineAt(l1, l2, start))) return null;
  const up = c[i] > U && c[i - 1] <= U0, dn = c[i] < Lw && c[i - 1] >= L0;
  if (!up && !dn) return null;

  const su = (h2.p - h1.p) / (h2.j - h1.j) / a, sl = (l2.p - l1.p) / (l2.j - l1.j) / a; // ATR per bar
  const F = o.flat;
  const dir = (s) => (s > F ? 1 : s < -F ? -1 : 0);
  const du = dir(su), dl = dir(sl);
  const poleMove = (c[start] - c[Math.max(0, start - 15)]) / a;
  const pole = poleMove > o.pole ? 1 : poleMove < -o.pole ? -1 : 0;
  const parallel = Math.abs(su - sl) < F;

  let name = null, bias = 0;
  if (du === 0 && dl === 1) { name = 'Ascending triangle'; bias = 1; }
  else if (du === -1 && dl === 0) { name = 'Descending triangle'; bias = -1; }
  else if (du === -1 && dl === 1) { name = pole === 1 ? 'Bull pennant' : pole === -1 ? 'Bear pennant' : 'Symmetrical triangle'; bias = pole; }
  else if (du === -1 && dl === -1) {
    if (parallel) { if (pole === 1) { name = 'Bull flag'; bias = 1; } }
    else if (su < sl) { name = 'Falling wedge'; bias = 1; }
  } else if (du === 1 && dl === 1) {
    if (parallel) { if (pole === -1) { name = 'Bear flag'; bias = -1; } }
    else if (sl > su) { name = 'Rising wedge'; bias = -1; }
  } else if (du === 0 && dl === 0) { name = 'Rectangle'; bias = pole; }
  if (!name) return null;
  return { name, side: up ? 'long' : 'short', bias, upper: [h1, h2], lower: [l1, l2], height: Math.max(h1.p, h2.p) - Math.min(l1.p, l2.p) };
}

// Head & shoulders, inverse head & shoulders, double top, double bottom: break of the neckline.
function reversalAt(x, i, o, known) {
  const { h, l, c, atr, piv } = x;
  const a = atr[i];
  const minOf = (arr, from, to) => { let m = from; for (let j = from; j <= to; j++) if (arr[j] < arr[m]) m = j; return { j: m, p: arr[m] }; };
  const maxOf = (arr, from, to) => { let m = from; for (let j = from; j <= to; j++) if (arr[j] > arr[m]) m = j; return { j: m, p: arr[m] }; };

  const H3 = lastBefore(piv.hi, known, 3);
  if (H3 && H3[0].j >= i - o.lookback) {
    const [s1, hd, s2] = H3;
    if (hd.p > s1.p + 0.5 * a && hd.p > s2.p + 0.5 * a && Math.abs(s1.p - s2.p) < 1.5 * a && s2.j - s1.j >= 10) {
      const n1 = minOf(l, s1.j, hd.j), n2 = minOf(l, hd.j, s2.j);
      if (n2.j > n1.j) {
        const N = lineAt(n1, n2, i), N0 = lineAt(n1, n2, i - 1);
        if (c[i] < N && c[i - 1] >= N0 && hd.p - N > 2 * a)
          return { name: 'Head & shoulders', side: 'short', bias: -1, upper: [s1, hd, s2], lower: [n1, n2], height: hd.p - N };
      }
    }
  }
  const L3 = lastBefore(piv.lo, known, 3);
  if (L3 && L3[0].j >= i - o.lookback) {
    const [s1, hd, s2] = L3;
    if (hd.p < s1.p - 0.5 * a && hd.p < s2.p - 0.5 * a && Math.abs(s1.p - s2.p) < 1.5 * a && s2.j - s1.j >= 10) {
      const n1 = maxOf(h, s1.j, hd.j), n2 = maxOf(h, hd.j, s2.j);
      if (n2.j > n1.j) {
        const N = lineAt(n1, n2, i), N0 = lineAt(n1, n2, i - 1);
        if (c[i] > N && c[i - 1] <= N0 && N - hd.p > 2 * a)
          return { name: 'Inverse head & shoulders', side: 'long', bias: 1, upper: [n1, n2], lower: [s1, hd, s2], height: N - hd.p };
      }
    }
  }
  const H2 = lastBefore(piv.hi, known, 2);
  if (H2 && H2[0].j >= i - o.lookback && H2[1].j - H2[0].j >= 8 && Math.abs(H2[0].p - H2[1].p) < 0.6 * a) {
    const n = minOf(l, H2[0].j, H2[1].j), top = Math.max(H2[0].p, H2[1].p);
    if (top - n.p > 2.5 * a && c[i] < n.p && c[i - 1] >= n.p)
      return { name: 'Double top', side: 'short', bias: -1, upper: H2, lower: [n, { j: i, p: n.p }], height: top - n.p };
  }
  const L2 = lastBefore(piv.lo, known, 2);
  if (L2 && L2[0].j >= i - o.lookback && L2[1].j - L2[0].j >= 8 && Math.abs(L2[0].p - L2[1].p) < 0.6 * a) {
    const n = maxOf(h, L2[0].j, L2[1].j), bot = Math.min(L2[0].p, L2[1].p);
    if (n.p - bot > 2.5 * a && c[i] > n.p && c[i - 1] <= n.p)
      return { name: 'Double bottom', side: 'long', bias: 1, upper: [n, { j: i, p: n.p }], lower: L2, height: n.p - bot };
  }
  return null;
}
