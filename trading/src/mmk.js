// Myanmar market rates (USD/THB/CNY..., bank counter rates, gold, Yangon fuel) from mmktoday.com /api/board.
// zBOT keeps one cached copy (refreshed at most every 10 minutes) and serves it again as its own API
// (/api/mmk on the dashboard host) and as /mmk in Telegram. On a failed refresh the last good copy is kept.
// Upstream is not an official, documented API: it can change or disappear, so everything here fails soft.

const UPSTREAM = 'https://mmktoday.com/api/board';
const TTL = 10 * 60e3;
let cache = null; // { at, data }
let inflight = null;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function normalize(j) {
  if (!Array.isArray(j?.rates)) throw new Error('unexpected answer (no rates)');
  const rates = j.rates.filter((r) => r && typeof r.code === 'string').map((r) => {
    const buy = num(r.buy), sell = num(r.sell);
    return {
      code: r.code, name: String(r.name ?? ''), category: r.category ?? null, unit: r.unit ?? null,
      buy, sell, mid: buy !== null && sell !== null ? (buy + sell) / 2 : null, value: num(r.value),
      state: r.state ?? null, source_time: r.source_time ?? null, source_name: r.source_name ?? null,
      ...(r.region ? { region: r.region } : {}),
    };
  });
  return { published_at: j.snapshot?.published_at ?? null, rates };
}

export async function mmkRates() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  inflight ??= (async () => {
    try {
      let err;
      for (let i = 0; i < 2; i++) { // one retry: the first connection sometimes fails (DNS / network blip)
        try {
          const r = await fetch(UPSTREAM, { headers: { accept: 'application/json', 'user-agent': 'zBOT/1.0 (rates cache)' }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          cache = { at: Date.now(), data: normalize(await r.json()) };
          err = null;
          break;
        } catch (e) { err = e; await new Promise((ok) => setTimeout(ok, 1500)); }
      }
      if (err) throw err;
    } catch (e) {
      if (!cache) throw new Error(`MMK rates not available (${e.message})`);
      cache = { ...cache, error: e.message }; // keep serving the last good copy
    } finally { inflight = null; }
    return cache;
  })();
  return inflight;
}

export const findRate = (data, code) => data.rates.find((r) => r.code.toUpperCase() === String(code).toUpperCase()) ?? null;

// Same formula as the mmktoday converter: amount × mid(from) / mid(to), MMK = 1.
export function convert(data, amount, from, to) {
  const per = (c) => {
    if (String(c).toUpperCase() === 'MMK') return 1;
    const r = findRate(data, c);
    return r?.mid ?? null;
  };
  const a = num(amount), f = per(from), t = per(to);
  if (a === null) throw new Error('amount must be a number');
  if (f === null || t === null) throw new Error(`no buy/sell rate for ${f === null ? from : to}`);
  return { amount: a, from: String(from).toUpperCase(), to: String(to).toUpperCase(), result: (a * f) / t, rate: f / t };
}

// API answer for /api/mmk[?code=USD,THB][&amount=100&from=USD&to=MMK]
export async function mmkApi(params) {
  const c = await mmkRates();
  const out = {
    source: 'mmktoday.com (data from SetLive and bank websites; not verified by zBOT)',
    cached_at: new Date(c.at).toISOString(), published_at: c.data.published_at, ...(c.error ? { stale_reason: c.error } : {}),
  };
  const codes = String(params.get('code') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  out.rates = codes.length ? codes.map((x) => findRate(c.data, x)).filter(Boolean) : c.data.rates;
  if (params.has('amount')) out.convert = convert(c.data, params.get('amount'), params.get('from') ?? 'USD', params.get('to') ?? 'MMK');
  return out;
}

// Telegram /mmk
const fmt = (v) => (v === null ? '-' : v >= 1000 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(2)));
export async function mmkText(arg) {
  const c = await mmkRates();
  const d = c.data;
  const m = String(arg ?? '').trim().match(/^([\d,.]+)\s*([A-Za-z]{3})?(?:\s+(?:to\s+)?([A-Za-z]{3}))?$/i);
  if (m) {
    const r = convert(d, m[1].replace(/,/g, ''), m[2] ?? 'USD', m[3] ?? 'MMK');
    return `💱 ${fmt(r.amount)} ${r.from} ≈ ${fmt(r.result)} ${r.to}\n(ပြင်ပဈေး ဝယ်/ရောင်း အလယ်နဲ့ တွက်ထားတာ)\n\n#zBOT`;
  }
  const line = (code, label) => { const r = findRate(d, code); return r ? `${label}: ${r.value !== null ? fmt(r.value) : `ဝယ် ${fmt(r.buy)} / ရောင်း ${fmt(r.sell)}`}${r.state === 'stale' ? ' (ဟောင်း)' : ''}` : null; };
  const time = new Date(new Date(c.at).getTime() + 6.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
  return [
    `💵 ဒီနေ့ ဈေးနှုန်း (${time} မြန်မာစံတော်ချိန်)`, '',
    '📌 ပြင်ပဈေး (MMK)',
    line('USD', '🇺🇸 ဒေါ်လာ'), line('THB', '🇹🇭 ဘတ်'), line('CNY', '🇨🇳 ယွမ်'), line('SGD', '🇸🇬 စင်ကာပူ'), line('MYR', '🇲🇾 ရင်းဂစ်'),
    '', '🏦 ဘဏ်ဈေး', line('BANK-UAB-USD', 'UAB ဒေါ်လာ'), line('BANK-AYA-USD', 'AYA ဒေါ်လာ'),
    '', '🥇 ရွှေ (၁ ကျပ်သား)', line('MM-16PAE', '၁၆ ပဲရည် (ဟောင်း)'), line('MM-16PAE-NEW', '၁၆ ပဲရည် (သစ်)'), line('MM-15PAE-NEW', '၁၅ ပဲရည် (သစ်)'), line('XAU/USD', 'ကမ္ဘာ့ရွှေ USD/oz'),
    '', '⛽ ဆီ (ရန်ကုန်၊ ၁ လီတာ)', line('FUEL-92-YGN', '92'), line('FUEL-95-YGN', '95'), line('FUEL-DIESEL-YGN', 'ဒီဇယ်'),
    '',
    '#zBOT #ဒေါ်လာဈေး #ရွှေဈေး',
  ].filter((x) => x !== null).join('\n');
}
