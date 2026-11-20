// All indicators return arrays the same length as the input; NaN until enough data.
const nanArr = (n) => new Array(n).fill(NaN);

export function sma(v, n) {
  const out = nanArr(v.length);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(v, n) {
  const out = nanArr(v.length);
  const k = 2 / (n + 1);
  let prev = NaN, s = 0;
  for (let i = 0; i < v.length; i++) {
    if (i < n) {
      s += v[i];
      if (i === n - 1) out[i] = prev = s / n;
      continue;
    }
    out[i] = prev = v[i] * k + prev * (1 - k);
  }
  return out;
}

export function rsi(c, n = 14) {
  const out = nanArr(c.length);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    g += Math.max(d, 0); l += Math.max(-d, 0);
  }
  let ag = g / n, al = l / n;
  const val = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[n] = val();
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

function trueRange(h, l, c) {
  return h.map((_, i) => (i === 0 ? h[0] - l[0]
    : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}

export function atr(h, l, c, n = 14) {
  const tr = trueRange(h, l, c);
  const out = nanArr(c.length);
  if (c.length <= n) return out;
  let s = 0;
  for (let i = 1; i <= n; i++) s += tr[i];
  out[n] = s / n;
  for (let i = n + 1; i < c.length; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  return out;
}

export function adx(h, l, c, n = 14) {
  const len = c.length;
  const out = nanArr(len);
  if (len < 2 * n + 1) return out;
  const tr = trueRange(h, l, c);
  const pdm = nanArr(len), mdm = nanArr(len);
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  let st = 0, sp = 0, sm = 0;
  for (let i = 1; i <= n; i++) { st += tr[i]; sp += pdm[i]; sm += mdm[i]; }
  const dx = nanArr(len);
  const calcDx = (i) => {
    const pdi = (100 * sp) / st, mdi = (100 * sm) / st;
    dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  };
  calcDx(n);
  for (let i = n + 1; i < len; i++) {
    st = st - st / n + tr[i];
    sp = sp - sp / n + pdm[i];
    sm = sm - sm / n + mdm[i];
    calcDx(i);
  }
  let s = 0;
  for (let i = n; i < 2 * n; i++) s += dx[i];
  out[2 * n - 1] = s / n;
  for (let i = 2 * n; i < len; i++) out[i] = (out[i - 1] * (n - 1) + dx[i]) / n;
  return out;
}

export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n);
  const upper = nanArr(c.length), lower = nanArr(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

// Highest high / lowest low of the PREVIOUS n bars (current bar excluded).
export function donchian(h, l, n = 20) {
  const upper = nanArr(h.length), lower = nanArr(h.length);
  for (let i = n; i < h.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n; j < i; j++) { hi = Math.max(hi, h[j]); lo = Math.min(lo, l[j]); }
    upper[i] = hi; lower[i] = lo;
  }
  return { upper, lower };
}
