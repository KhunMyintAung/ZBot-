import { Resvg } from '@resvg/resvg-js';
import { chartData } from './service.js';

// Signal chart as a PNG (for Telegram). Same marks as the dashboard chart, light theme,
// English labels only (the server has no Myanmar font).
const C = {
  surface: '#181a20', text: '#eaecef', text2: '#b7bdc6', muted: '#848e9c', grid: '#262b33', axis: '#474d57',
  e20: '#b88600', e50: '#d6338f', e200: '#3f82f5', sl: '#f6465d', tp: '#0ecb81', entry: '#3f82f5', up: '#0ecb81', dn: '#f6465d',
};
const FONT = 'DejaVu Sans, Arial, sans-serif';
const escXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mm = (t) => new Date(t + 6.5 * 3600e3); // Myanmar clock, read with getUTC*
const two = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dtMM = (t) => { const d = mm(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
const hmMM = (t) => { const d = mm(t); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
const pf = (v) => !Number.isFinite(v) ? '-' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 })
  : v >= 1 ? v.toFixed(3) : v.toFixed(5);

function niceTicks(min, max, n = 5) {
  const span = max - min || 1;
  const mag = 10 ** Math.floor(Math.log10(span / n));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const tri = (cx, cy, up, s = 8) => up
  ? `M${cx},${cy - s}L${cx + s},${cy + s * 0.8}L${cx - s},${cy + s * 0.8}Z`
  : `M${cx},${cy + s}L${cx + s},${cy - s * 0.8}L${cx - s},${cy - s * 0.8}Z`;

export function chartSvg(d, W = 1100, H = 640) {
  const ks = d.candles.slice(-120);
  const o = [];
  const text = (x, y, s, { size = 14, fill = C.text2, anchor = 'start', weight = 400 } = {}) =>
    o.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escXml(s)}</text>`);
  o.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);

  // header
  const n = d.now;
  const trend = n.trend === 'down' ? 'DOWNTREND (price below EMA200): only SHORT' : 'UPTREND (price above EMA200): only LONG';
  const pat = d.strategy === 'combo' || d.strategy === 'pattern';
  const want = d.strategy === 'pattern' ? `waits for a chart pattern to break ${n.trend === 'down' ? 'DOWN' : 'UP'}`
    : (n.trend === 'down' ? 'waits for EMA20 to cross BELOW EMA50' : 'waits for EMA20 to cross ABOVE EMA50') + (pat ? ' or a pattern breakout' : '');
  const S = d.signal;
  text(24, 36, `${d.symbol}  ·  ${d.interval}  ·  ${d.strategy}`, { size: 22, fill: C.text, weight: 700 });
  if (S) {
    const col = S.side === 'long' ? C.up : C.dn, label = `${S.side === 'long' ? 'LONG' : 'SHORT'} SIGNAL`;
    o.push(`<rect x="${W - 250}" y="14" width="226" height="34" rx="8" fill="${col}"/>`);
    text(W - 137, 37, label, { size: 18, fill: '#0b0e11', anchor: 'middle', weight: 700 });
  }
  if (S) text(24, 62, `Entry ${pf(S.entry)}  ·  SL ${pf(S.sl)}  ·  ${S.tps.map(([l, v]) => `${l} ${pf(v)}`).join('  ·  ')}`, { size: 15, fill: C.text });
  else text(24, 62, `${trend}, ${want}. EMA20 vs EMA50: ${n.gapPct > 0 ? '+' : ''}${n.gapPct.toFixed(2)}%.  Next check ${hmMM(n.nextBarAt)} (Myanmar time)`, { size: 14 });

  // legend
  let lx = 24;
  const ly = 90;
  const leg = (draw, label) => { draw(lx, ly); text(lx + 22, ly + 5, label, { size: 13 }); lx += 32 + label.length * 7.6; };
  const lineLeg = (c, dash = '') => (x, y) => o.push(`<line x1="${x}" x2="${x + 16}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
  leg((x, y) => o.push(`<rect x="${x + 2}" y="${y - 6}" width="5" height="12" fill="${C.up}"/><rect x="${x + 10}" y="${y - 6}" width="5" height="12" fill="${C.dn}"/>`), 'Candles');
  leg(lineLeg(C.e20), 'EMA20');
  leg(lineLeg(C.e50), 'EMA50');
  leg(lineLeg(C.e200), 'EMA200');
  leg((x, y) => o.push(`<path d="${tri(x + 8, y, true, 6)}" fill="${C.text}"/>`), 'Long signal');
  leg((x, y) => o.push(`<path d="${tri(x + 8, y, false, 6)}" fill="${C.text}"/>`), 'Short signal');
  leg((x, y) => o.push(`<circle cx="${x + 8}" cy="${y}" r="5" fill="${C.surface}" stroke="${C.muted}" stroke-width="2"/>`), 'Skipped');
  leg((x, y) => o.push(`<circle cx="${x + 8}" cy="${y}" r="5" fill="${C.text}"/>`), 'Entry');
  if (d.events.some((e) => e.pattern)) leg(lineLeg(C.muted), 'Pattern');
  leg(lineLeg(C.sl, '5 4'), 'SL');
  if ((d.trades ?? []).some((t) => t.tp)) leg(lineLeg(C.tp, '5 4'), 'TP');
  leg((x, y) => o.push(`<path d="M${x + 3},${y - 5}L${x + 13},${y + 5}M${x + 3},${y + 5}L${x + 13},${y - 5}" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round"/>`), 'Exit');

  // plot
  const m = { l: 24, r: 96, t: 112, b: 44 };
  const t0 = ks[0].t, t1 = ks.at(-1).t;
  const trades = (d.trades ?? []).filter((t) => (t.exitT ?? Infinity) >= t0);
  const vals = ks.flatMap((k) => [k.h, k.l, k.e20, k.e50, k.e200]).filter(Number.isFinite);
  for (const t of trades) vals.push(t.entry, t.sl, ...(t.tp ? [t.tp] : []));
  if (d.position) vals.push(d.position.entry, d.position.sl);
  if (d.signal) vals.push(d.signal.entry, d.signal.sl, ...d.signal.tps.map(([, v]) => v));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * (H - m.t - m.b);
  for (const v of niceTicks(lo, hi)) {
    o.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}" stroke-width="1"/>`);
    text(W - m.r + 10, y(v) + 5, pf(v), { size: 13, fill: C.muted });
  }
  for (let i = 0; i <= 5; i++) {
    const t = ks[Math.round(((ks.length - 1) * i) / 5)].t; // on a candle, so times look normal
    text(x(t), H - 16, dtMM(t), { size: 13, fill: C.muted, anchor: i === 0 ? 'start' : i === 5 ? 'end' : 'middle' });
  }
  const path = (key) => ks.filter((k) => Number.isFinite(k[key])).map((k, i) => `${i ? 'L' : 'M'}${x(k.t).toFixed(1)},${y(k[key]).toFixed(1)}`).join('');
  const bw = Math.max(2, Math.min(10, ((W - m.l - m.r) / (ks.length - 1)) * 0.68));
  for (const k of ks) {
    const col = k.c >= k.o ? C.up : C.dn, cx = x(k.t);
    o.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(k.h).toFixed(1)}" y2="${y(k.l).toFixed(1)}" stroke="${col}" stroke-width="1.2"/>`);
    o.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(Math.max(k.o, k.c)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(k.o) - y(k.c))).toFixed(1)}" fill="${col}"/>`);
  }
  for (const [k, c] of [['e20', C.e20], ['e50', C.e50], ['e200', C.e200]]) {
    o.push(`<path d="${path(k)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`);
  }

  // trades (clipped to the plot)
  o.push(`<defs><clipPath id="p"><rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/></clipPath></defs><g clip-path="url(#p)">`);
  const bar = ks[1].t - ks[0].t;
  for (const t of trades) {
    const end = t.exitT ?? t1;
    let sd = '';
    t.path.forEach(([tt, v], i) => { sd += `${i ? 'L' : 'M'}${x(tt).toFixed(1)},${y(v).toFixed(1)}L${x(Math.min(tt + bar, end)).toFixed(1)},${y(v).toFixed(1)}`; });
    o.push(`<path d="${sd}" fill="none" stroke="${C.sl}" stroke-width="2" stroke-dasharray="6 4"/>`);
    o.push(`<line x1="${x(t.entryT)}" x2="${x(end)}" y1="${y(t.entry)}" y2="${y(t.entry)}" stroke="${C.text2}" stroke-width="1.2" stroke-dasharray="2 4"/>`);
    if (t.tp) o.push(`<line x1="${x(t.entryT)}" x2="${x(end)}" y1="${y(t.tp)}" y2="${y(t.tp)}" stroke="${C.tp}" stroke-width="2" stroke-dasharray="6 4"/>`);
    o.push(`<circle cx="${x(t.entryT)}" cy="${y(t.entry)}" r="6" fill="${C.text}" stroke="${C.surface}" stroke-width="2.5"/>`);
    if (t.entryT >= t0) text(x(t.entryT) + 8, y(t.sl) + (t.side === 'long' ? 16 : -7), `SL ${pf(t.sl)}`, { size: 12 });
    if (t.exitT) {
      const ex = x(t.exitT), ey = y(t.exit);
      o.push(`<path d="M${ex - 6},${ey - 6}L${ex + 6},${ey + 6}M${ex - 6},${ey + 6}L${ex + 6},${ey - 6}" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    const label = `${t.R >= 0 ? '+' : ''}${t.R.toFixed(1)}R${t.exitT ? '' : ' (open)'}`;
    text(Math.min(x(end), W - m.r - 80) - 4, y(t.exit) + (t.side === 'long' ? -12 : 22), label, { size: 15, fill: C.text, anchor: 'end', weight: 700 });
  }
  // chart patterns: the two lines that price broke out of, with the pattern's name
  for (const e of d.events) {
    if (!e.pattern) continue;
    let top = Infinity, lx = null;
    for (const pts of [e.pattern.upper, e.pattern.lower]) {
      const q = pts.filter(([tt]) => tt >= t0);
      if (q.length < 2) continue;
      o.push(`<path d="${q.map(([tt, v], i) => `${i ? 'L' : 'M'}${x(tt).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${C.muted}" stroke-width="2"/>`);
      for (const [tt, v] of q) if (y(v) < top) { top = y(v); lx = x(tt); }
    }
    if (lx !== null) o.push(`<text x="${Math.min(lx, W - m.r - 150).toFixed(1)}" y="${(top - 8).toFixed(1)}" font-family="${FONT}" font-size="12" font-weight="700" fill="${C.text}" stroke="${C.surface}" stroke-width="4" paint-order="stroke">${escXml(e.pattern.name)}</text>`);
  }
  o.push('</g>');

  // signals and skipped crosses
  const byT = new Map(ks.map((k) => [k.t, k]));
  for (const e of d.events) {
    const k = byT.get(e.t); if (!k) continue;
    if (e.kind === 'signal') {
      const up = e.side === 'long';
      o.push(`<path d="${tri(x(e.t), up ? y(k.l) + 16 : y(k.h) - 16, up)}" fill="${C.text}" stroke="${C.surface}" stroke-width="2.5"/>`);
    } else {
      o.push(`<circle cx="${x(e.t)}" cy="${y(k.c)}" r="6.5" fill="${C.surface}" stroke="${C.muted}" stroke-width="2"/>`);
    }
  }

  // a new signal: entry, stop and targets across the chart, labels on the right
  if (S) {
    const rows = [[S.entry, 'Entry', C.entry], [S.sl, 'SL', C.sl], ...S.tps.map(([l, v]) => [v, l, C.tp])];
    for (const [v, label, c] of rows) {
      o.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-width="2" stroke-dasharray="${label === 'Entry' ? '0' : '8 5'}"/>`);
      o.push(`<rect x="${m.l + 4}" y="${y(v) - 21}" width="${label.length * 9 + 96}" height="19" rx="4" fill="${C.surface}" opacity="0.85"/>`);
      text(m.l + 8, y(v) - 7, `${label} ${pf(v)}`, { size: 14, fill: c === C.entry ? C.text : c, weight: 700 });
    }
  }

  // the bot's real open position
  if (d.position && !S) {
    for (const [v, label, c] of [[d.position.entry, 'Bot entry', C.entry], [d.position.sl, 'Bot SL', C.sl]]) {
      o.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-width="1.5" stroke-dasharray="8 4"/>`);
      text(m.l + 6, y(v) - 6, `${label} ${pf(v)}`, { size: 13, fill: C.text });
    }
  }

  // line-end labels
  const last = ks.at(-1);
  const labs = [['EMA20', C.e20, last.e20], ['EMA50', C.e50, last.e50], ['EMA200', C.e200, last.e200]]
    .map(([n, c, v]) => ({ n, c, yy: y(v) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < labs.length; i++) labs[i].yy = Math.max(labs[i].yy, labs[i - 1].yy + 18);
  for (const l of labs) {
    o.push(`<rect x="${W - m.r - 74}" y="${l.yy - 10}" width="70" height="19" rx="4" fill="${C.surface}" opacity="0.9"/>`);
    o.push(`<line x1="${W - m.r - 70}" x2="${W - m.r - 60}" y1="${l.yy}" y2="${l.yy}" stroke="${l.c}" stroke-width="3"/>`);
    text(W - m.r - 56, l.yy + 5, l.n, { size: 13 });
  }
  text(W - m.r + 10, y(last.c) + 5, pf(last.c), { size: 13, fill: C.text, weight: 700 });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o.join('')}</svg>`;
}

// signal (optional): { side, entry, sl, tps: [['TP1', price], ...] } drawn as lines on the chart
export async function chartPng(cfg, symbol, signal = null) {
  const d = signal ? { ...(await chartData(cfg, symbol)), signal } : await chartData(cfg, symbol);
  const svg = chartSvg(d);
  const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }, fitTo: { mode: 'width', value: 1100 } }).render().asPng();
  return { png, data: d };
}

// Short caption (Telegram allows 1024 characters).
export function chartCaption(d) {
  const lines = [`📈 ${d.symbol} ${d.interval} (${d.strategy})`];
  const open = (d.trades ?? []).find((t) => !t.exitT);
  if (d.position) lines.push(`Bot position: ${d.position.side.toUpperCase()} @ ${pf(d.position.entry)} · SL ${pf(d.position.sl)}`);
  else lines.push('Bot position: none');
  if (open) lines.push(`Strategy trade (simulated): ${open.side.toUpperCase()} @ ${pf(open.entry)} · SL now ${pf(open.slNow)} · ${open.R >= 0 ? '+' : ''}${open.R.toFixed(1)}R`);
  const lastEv = d.events.at(-1);
  if (lastEv) lines.push(`Last event ${dtMM(lastEv.t)}: ${lastEv.kind === 'signal' ? lastEv.side.toUpperCase() + ' signal' : 'skipped'} (${lastEv.reason})`);
  return lines.join('\n').slice(0, 1000);
}
