import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { STATE_DIR } from '../config.js';
import { mmkRates, findRate } from '../mmk.js';
import { fngNow, fngMm } from '../fa.js';

// Daily content factory: ready-to-post drafts (picture card + Burmese caption) for Facebook / TikTok / Telegram.
//  • rates  – dollar, baht, yuan, gold and fuel prices of the day (live data)
//  • crypto – BTC / ETH / SOL / BNB price and Fear & Greed (live data)
//  • tip    – phone care / repair tip from the shop (rotates through TIPS)
//  • pos    – Mahar POS selling point (rotates through POS_POINTS)
// Picture cards use English and numbers only: the image renderer cannot shape Burmese script correctly.
// The Burmese text is in the caption. Shop details come from /profile (state/content-profile.json).

const PROFILE_FILE = path.join(STATE_DIR, 'content-profile.json');
const STATE_FILE = path.join(STATE_DIR, 'content-state.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ---------- shop profile ----------
export const PROFILE_KEYS = {
  shop: 'ဆိုင်နာမည် (English, ပုံပေါ်မှာ ပေါ်မယ်)',
  phone: 'ဖုန်းနံပါတ်',
  address: 'ဆိုင်လိပ်စာ',
  page: 'Facebook Page / Link',
  pos_price: 'Mahar POS ဈေး (ဥပမာ 300,000 ကျပ်)',
  pos_contact: 'POS အတွက် ဆက်သွယ်ရန် (မထည့်ရင် phone ကို သုံး)',
};
export const readProfile = () => readJson(PROFILE_FILE, {});
export function setProfile(text) {
  // "/profile shop=KMA Mobile phone=09xxx" or one key per line "shop: KMA Mobile"
  const p = readProfile();
  const pairs = [...String(text).matchAll(/(\w+)\s*[=:]\s*([^=\n]+?)(?=\s+\w+\s*[=:]|\n|$)/g)];
  if (!pairs.length) throw new Error('ဥပမာ: /profile shop=KMA Mobile phone=09xxxxxxxx');
  const changed = [];
  for (const [, k, v] of pairs) {
    const key = k.toLowerCase();
    if (!(key in PROFILE_KEYS)) throw new Error(`"${k}" မသိပါ။ သုံးလို့ရတာ: ${Object.keys(PROFILE_KEYS).join(', ')}`);
    const val = v.trim().slice(0, 120);
    if (val === '-' || val === '') delete p[key]; else p[key] = val;
    changed.push(key);
  }
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 1));
  return { profile: p, changed };
}
export function profileText() {
  const p = readProfile();
  return ['🏪 Content Profile', '', ...Object.entries(PROFILE_KEYS).map(([k, label]) => `${p[k] ? '✅' : '▫️'} ${k} – ${label}${p[k] ? `\n    ${p[k]}` : ''}`),
    '', 'ပြင်ရန်: /profile shop=KMA Mobile phone=09xxxxxxxx', 'ဖျက်ရန်: /profile page=-'].join('\n');
}

// ---------- libraries (Burmese text for captions, short English title for the picture) ----------
const TIPS = [
  ['Battery care', 'ဘက်ထရီ ကြာကြာခံအောင်', '• 20%–80% ကြားမှာ အားသွင်းထားရင် ဘက်ထရီ သက်တမ်း ပိုရှည်ပါတယ်\n• ညလုံးပေါက် အားသွင်းထားတာ ရှောင်ပါ\n• ပူတဲ့နေရာ (ကားထဲ၊ နေပူ) မှာ မထားပါနဲ့'],
  ['Original charger', 'Charger အစစ် သုံးပါ', '• ဈေးပေါ Charger တွေက ဘက်ထရီ နဲ့ Charging IC ကို ပျက်စေတတ်ပါတယ်\n• Charging Port ပူလာရင် ချက်ချင်း ဖြုတ်ပါ\n• Charging IC ပြင်ခ က Charger အစစ် ဈေးထက် များပါတယ်'],
  ['Water damage', 'ဖုန်း ရေဝင်သွားရင်', '• ချက်ချင်း ပိတ်ပါ၊ အားမသွင်းပါနဲ့\n• ဆန်အိတ်ထဲ ထည့်တာက မလုံလောက်ပါ\n• ၂၄ နာရီအတွင်း ဆိုင်ကို ယူလာရင် ကယ်နိုင်ခြေ အများကြီး ပိုပါတယ်'],
  ['Phone is slow?', 'ဖုန်း နှေးလာရင်', '• မသုံးတဲ့ App တွေ ဖျက်ပါ\n• Storage 80% ကျော်ရင် နှေးပါတယ်၊ ဓာတ်ပုံ/ဗီဒီယို Backup လုပ်ပြီး ရှင်းပါ\n• တစ်ပတ်တစ်ခါ Restart ချပါ'],
  ['Screen protection', 'Screen ကွဲတာ ကာကွယ်ဖို့', '• Tempered Glass က Screen အသစ်ထက် အများကြီး ဈေးသက်သာပါတယ်\n• ထောင့်ကာ Case က ပြုတ်ကျရင် အကာအကွယ် အကောင်းဆုံး\n• Screen ကွဲနေရင် စောစော လဲပါ (Touch ပါ ပျက်သွားတတ်လို့)'],
  ['Backup your data', 'Data Backup လုပ်ထားပါ', '• Google Photos / iCloud မှာ ဓာတ်ပုံ Backup ဖွင့်ထားပါ\n• Contact တွေကို Google Account နဲ့ Sync လုပ်ပါ\n• ဖုန်းပြင်ခါနီး Backup အရင်လုပ်ပါ'],
  ['Phone too hot?', 'ဖုန်း ပူလွန်းရင်', '• Game ဆော့ရင်း အားမသွင်းပါနဲ့\n• Case ထူထူ ချွတ်ပြီး အေးအေး ထားပါ\n• ခဏခဏ ပူနေရင် ဘက်ထရီ ဖောင်းနေတာ ဖြစ်နိုင်လို့ စစ်ဆေးပါ'],
  ['Swollen battery', 'ဘက်ထရီ ဖောင်းလာရင်', '• Back Cover ကြွလာတာ၊ Screen ကြွလာတာ တွေ့ရင် ချက်ချင်း ရပ်သုံးပါ\n• ဖောင်းတဲ့ ဘက်ထရီ က မီးလောင်နိုင်ပါတယ်\n• ဘက်ထရီ အသစ်လဲတာ ဈေးမကြီးပါ'],
  ['Charging port', 'Charge မဝင်တော့ရင်', '• Port ထဲမှာ ဖုန်မှုန့် ပိတ်နေတာ အဖြစ်များပါတယ်\n• သံ/အပ်နဲ့ မထိုးပါနဲ့ (Pin ပျက်တတ်)\n• ဆိုင်မှာ သန့်ရှင်းရေး လုပ်ပေးတာ ခဏလေးပါ'],
  ['Security', 'ဖုန်း လုံခြုံရေး', '• Screen Lock နဲ့ Fingerprint/Face ဖွင့်ထားပါ\n• မသိတဲ့ Link နှိပ်ပြီး App မထည့်ပါနဲ့\n• OTP Code ကို ဘယ်သူ့ကိုမှ မပေးပါနဲ့ (ဘဏ်ကလို့ ပြောလည်း)'],
  ['Buying used phone', 'Second ဖုန်း ဝယ်ရင် စစ်ရမယ့်အချက်', '• IMEI (*#06#) နဲ့ ဘူးပေါ်က IMEI တူမတူ\n• iCloud / Google Account Logout ဖြစ်မဖြစ်\n• Battery Health၊ Camera၊ Speaker၊ Charging စမ်းပါ'],
  ['Storage full', 'Storage ပြည့်နေရင်', '• Viber / Telegram / Messenger ထဲက Video တွေ အရမ်းနေရာယူပါတယ်\n• App Cache ကို Settings ကနေ ရှင်းပါ\n• SD Card ရတဲ့ ဖုန်းဆို ဓာတ်ပုံတွေ ရွှေ့ပါ'],
  ['Software update', 'Software Update လုပ်သင့်လား', '• Security Update တွေက ဖုန်းကို ပိုလုံခြုံစေပါတယ်\n• Update မလုပ်ခင် Backup လုပ်ပြီး ဘက်ထရီ 50% ကျော် ထားပါ\n• WiFi နဲ့ လုပ်ပါ (Data ကုန်လို့)'],
  ['Speaker / mic', 'အသံ မကြားရရင်', '• Speaker ပေါက်မှာ ဖုန်ပိတ်နေတာ အဖြစ်များပါတယ်\n• Bluetooth ချိတ်ထားလား စစ်ပါ\n• မရရင် ဆိုင်မှာ စစ်ဆေးကြည့်ပါ'],
  ['Touch problem', 'Touch မရရင်', '• Screen Protector ကွဲနေရင် ဖြုတ်ကြည့်ပါ\n• လက်စိုနေရင် Touch လွဲတတ်ပါတယ်\n• Restart ချလို့ မရရင် Screen စစ်ဖို့ လိုပါတယ်'],
  ['Camera blurry', 'Camera ဝါးနေရင်', '• Lens ကို အဝတ်ပျော့နဲ့ သုတ်ပါ\n• Lens Glass ကွဲနေရင် Lens Glass ပဲ လဲလို့ရပါတယ် (ဈေးသက်သာ)\n• Focus မမိရင် Camera Module စစ်ဖို့ လိုပါတယ်'],
];
const POS_POINTS = [
  ['Know your profit', 'နေ့တိုင်း အမြတ် ဘယ်လောက်လဲ သိရမယ်', '• ရောင်းတိုင်း အမြတ် အလိုအလျောက် တွက်ပေး\n• နေ့စဉ် / လစဉ် Report\n• စာအုပ်နဲ့ မှတ်စရာ မလိုတော့'],
  ['Stock control', 'Stock ကုန်တာ ကြိုသိ', '• ပစ္စည်း ဘယ်နှခု ကျန်လဲ ချက်ချင်း မြင်ရ\n• နည်းလာရင် သတိပေး\n• ပစ္စည်း ပျောက်တာ လျော့'],
  ['Fast checkout', 'ငွေရှင်းတာ မြန်မြန်', '• ပစ္စည်းရွေးပြီး ချက်ချင်း ရှင်း\n• Voucher ထုတ်ပေး\n• ငွေစာရင်း မှားစရာ မရှိ'],
  ['Customer debt', 'အကြွေး စာရင်း', '• ဘယ်သူ ဘယ်လောက် ကျန်သေးလဲ\n• အကြွေးဆပ်တာ မှတ်\n• စာရင်း မရှုပ်တော့'],
  ['Easy to use', 'သုံးရ လွယ်', '• မြန်မာ ဆိုင်တွေအတွက် ရည်ရွယ်ပြီး လုပ်ထားတာ\n• ဝန်ထမ်း သင်ပေးရ လွယ်\n• Report တွေ ရှင်းရှင်းလင်းလင်း ကြည့်ရ'],
  ['For every shop', 'ဘယ်ဆိုင်မျိုးမဆို', '• ဖုန်းဆိုင်၊ ကုန်စုံ၊ အဝတ်၊ ဆေးဆိုင်၊ စားသောက်ဆိုင်\n• ဆိုင်ရဲ့ လိုအပ်ချက်နဲ့ ကိုက်အောင်\n• Demo ကြည့်ချင်ရင် ဆက်သွယ်ပါ'],
];

// ---------- picture cards (1080x1080, English + numbers) ----------
const FONT = 'DejaVu Sans, Arial, sans-serif';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ascii = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '').trim(); // the picture can only show Latin text
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mmDate = () => { const d = new Date(Date.now() + 6.5 * 3600e3); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const n0 = (v) => (v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-US'));
const n2 = (v) => (v === null || v === undefined ? '-' : (+v.toFixed(2)).toLocaleString('en-US'));

const THEMES = {
  rates: { bg1: '#0b3d2e', bg2: '#0f7b5f', accent: '#ffd166' },
  crypto: { bg1: '#14161c', bg2: '#2a2f3a', accent: '#f0b90b' },
  tip: { bg1: '#1d3557', bg2: '#2e6fb5', accent: '#ffd166' },
  pos: { bg1: '#3a1c5c', bg2: '#7b3fb0', accent: '#7ef0c5' },
};

function frame(theme, title, subtitle, body, profile) {
  const t = THEMES[theme];
  const shop = ascii(profile.shop) || 'zBOT';
  const foot = [ascii(profile.phone), ascii(profile.page)].filter(Boolean).join('   |   ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <circle cx="980" cy="110" r="190" fill="#ffffff" opacity="0.05"/><circle cx="90" cy="1010" r="230" fill="#ffffff" opacity="0.05"/>
  <text x="72" y="118" font-family="${FONT}" font-size="30" font-weight="700" fill="${t.accent}" letter-spacing="3">${esc(shop.toUpperCase())}</text>
  <text x="72" y="200" font-family="${FONT}" font-size="64" font-weight="700" fill="#ffffff">${esc(title)}</text>
  <text x="72" y="250" font-family="${FONT}" font-size="30" fill="#ffffff" opacity="0.75">${esc(subtitle)}</text>
  <rect x="72" y="280" width="120" height="6" rx="3" fill="${t.accent}"/>
  ${body}
  ${foot ? `<text x="540" y="1030" text-anchor="middle" font-family="${FONT}" font-size="28" fill="#ffffff" opacity="0.85">${esc(foot)}</text>` : ''}
</svg>`;
}

function rowsSvg(rows, y0, theme, colX = [72, 640, 1008]) {
  const t = THEMES[theme];
  return rows.map((r, i) => {
    const y = y0 + i * 78;
    if (r.head) return `<text x="${colX[0]}" y="${y + 10}" font-family="${FONT}" font-size="26" font-weight="700" fill="${t.accent}" letter-spacing="2">${esc(r.head)}</text>`;
    return `<rect x="56" y="${y - 44}" width="968" height="64" rx="14" fill="#ffffff" opacity="${i % 2 ? 0.06 : 0.1}"/>
    <text x="${colX[0] + 18}" y="${y}" font-family="${FONT}" font-size="32" fill="#ffffff">${esc(r.label)}</text>
    ${r.mid ? `<text x="${colX[1]}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="32" fill="#ffffff" opacity="0.8">${esc(r.mid)}</text>` : ''}
    <text x="${colX[2]}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="34" font-weight="700" fill="${r.color ?? '#ffffff'}">${esc(r.value)}</text>`;
  }).join('\n');
}

function bulletCard(theme, kicker, titleEn, n, profile, lines) {
  const t = THEMES[theme];
  // English title wrapped to max 2 lines of ~18 chars at 88px
  const words = titleEn.split(' '); const L = [''];
  for (const w of words) { if ((L.at(-1) + ' ' + w).trim().length > 16) L.push(w); else L[L.length - 1] = (L.at(-1) + ' ' + w).trim(); }
  const body = `
  <text x="72" y="490" font-family="${FONT}" font-size="180" font-weight="700" fill="${t.accent}" opacity="0.9">#${n}</text>
  ${L.slice(0, 2).map((l, i) => `<text x="72" y="${640 + i * 104}" font-family="${FONT}" font-size="92" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('')}
  ${lines.map((l, i) => `<text x="72" y="${880 + i * 54}" font-family="${FONT}" font-size="34" fill="#ffffff" opacity="0.85">${esc(l)}</text>`).join('')}`;
  return frame(theme, kicker, mmDate(), body, profile);
}

const png = (svg) => new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }, fitTo: { mode: 'width', value: 1080 } }).render().asPng();

// ---------- drafts ----------
const tags = (...t) => t.map((x) => `#${x}`).join(' ');
const footer = (p) => [p.shop ? `🏪 ${p.shop}` : null, p.address ? `📍 ${p.address}` : null, p.phone ? `📞 ${p.phone}` : null, p.page ? `👉 ${p.page}` : null].filter(Boolean).join('\n');

async function ratesDraft(p) {
  const { data } = await mmkRates();
  const r = (c) => findRate(data, c) ?? {};
  const rows = [
    { head: 'MARKET RATE (MMK)   BUY / SELL' },
    { label: 'USD  US Dollar', value: `${n0(r('USD').buy)} / ${n0(r('USD').sell)}` },
    { label: 'THB  Thai Baht', value: `${n2(r('THB').buy)} / ${n2(r('THB').sell)}` },
    { label: 'CNY  Yuan', value: `${n0(r('CNY').buy)} / ${n0(r('CNY').sell)}` },
    { label: 'SGD  Singapore $', value: `${n0(r('SGD').buy)} / ${n0(r('SGD').sell)}` },
    { head: 'GOLD (1 KYATTHA)' },
    { label: '16 Pae (new)', value: `${n0(r('MM-16PAE-NEW').buy)} / ${n0(r('MM-16PAE-NEW').sell)}` },
    { label: 'World gold USD/oz', value: n2(r('XAU/USD').value) },
    { head: 'FUEL YANGON (MMK / LITRE)' },
    { label: '92  |  95  |  Diesel', value: `${n0(r('FUEL-92-YGN').value)}  |  ${n0(r('FUEL-95-YGN').value)}  |  ${n0(r('FUEL-DIESEL-YGN').value)}` },
  ];
  const svg = frame('rates', 'MMK RATES TODAY', mmDate(), rowsSvg(rows, 350, 'rates'), p);
  const fx = (c, l) => `${l}: ဝယ် ${n2(r(c).buy)} / ရောင်း ${n2(r(c).sell)}`;
  const caption = [`💵 ဒီနေ့ ငွေလဲနှုန်း၊ ရွှေဈေး၊ ဆီဈေး (${mmDate()})`, '',
    fx('USD', '🇺🇸 ဒေါ်လာ'), fx('THB', '🇹🇭 ဘတ်'), fx('CNY', '🇨🇳 ယွမ်'), fx('SGD', '🇸🇬 စင်ကာပူ'), '',
    `🥇 ရွှေ ၁၆ ပဲရည် (စနစ်သစ်): ဝယ် ${n0(r('MM-16PAE-NEW').buy)} / ရောင်း ${n0(r('MM-16PAE-NEW').sell)}`,
    `🌍 ကမ္ဘာ့ရွှေ: ${n2(r('XAU/USD').value)} USD`, '',
    `⛽ 92: ${n0(r('FUEL-92-YGN').value)} · 95: ${n0(r('FUEL-95-YGN').value)} · ဒီဇယ်: ${n0(r('FUEL-DIESEL-YGN').value)} ကျပ်`, '',
    'ဈေးနှုန်းတွေက ကိုးကားချက်သာ ဖြစ်ပြီး ဆိုင်အလိုက် ကွာနိုင်ပါတယ်။',
    footer(p) || null, '', tags('ဒေါ်လာဈေး', 'ရွှေဈေး', 'ဆီဈေး', 'Myanmar')].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  return { kind: 'rates', png: png(svg), caption };
}

async function cryptoDraft(p) {
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
  const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
  const t = Object.fromEntries((await r.json()).map((x) => [x.symbol, { price: +x.lastPrice, ch: +x.priceChangePercent }]));
  const fng = await fngNow().catch(() => null);
  const price = (v) => (v >= 1000 ? n0(v) : n2(v));
  const rows = [
    { head: 'PRICE (USDT)            24H CHANGE' },
    ...syms.map((s) => ({ label: s.replace('USDT', ''), mid: `$${price(t[s]?.price)}`, value: `${t[s]?.ch >= 0 ? '+' : ''}${n2(t[s]?.ch)}%`, color: t[s]?.ch >= 0 ? '#2ee59d' : '#ff6b81' })),
    ...(fng !== null ? [{ head: 'FEAR & GREED INDEX' }, { label: 'Market mood', value: `${fng} / 100`, color: fng >= 55 ? '#2ee59d' : fng <= 45 ? '#ff6b81' : '#ffffff' }] : []),
  ];
  const svg = frame('crypto', 'CRYPTO TODAY', mmDate(), rowsSvg(rows, 360, 'crypto', [72, 700, 1008]), p);
  const line = (s, n) => `${t[s]?.ch >= 0 ? '🟢' : '🔴'} ${n}: $${price(t[s]?.price)} (${t[s]?.ch >= 0 ? '+' : ''}${n2(t[s]?.ch)}%)`;
  const caption = [`🪙 ဒီနေ့ Crypto ဈေး (${mmDate()})`, '', line('BTCUSDT', 'Bitcoin'), line('ETHUSDT', 'Ethereum'), line('SOLUSDT', 'Solana'), line('BNBUSDT', 'BNB'),
    ...(fng !== null ? ['', `😨 Fear & Greed: ${fng}/100 – ဈေးကွက် ${fngMm(fng)}`] : []), '',
    '⚠️ ငွေရေးကြေးရေး အကြံပြုချက် မဟုတ်ပါ။ Crypto က ဈေးအတက်အကျ ကြမ်းပါတယ်။', '', tags('Crypto', 'Bitcoin', 'zBOT')].join('\n');
  return { kind: 'crypto', png: png(svg), caption };
}

function libDraft(kind, list, p, index) {
  const [en, mmTitle, body] = list[index % list.length];
  const n = (index % list.length) + 1;
  const lines = kind === 'tip' ? ['Phone problem? Visit our shop.'] : ['Mahar POS - software for your shop', 'Ask us for a demo'];
  const svg = bulletCard(kind, kind === 'tip' ? 'PHONE TIP' : 'MAHAR POS', en, n, p, lines.filter(Boolean));
  const caption = kind === 'tip'
    ? [`📱 ဖုန်း Tip #${n} – ${mmTitle}`, '', body, '', 'ဖုန်း ပြဿနာ ရှိရင် ဆိုင်ကို လာပြပါ။', footer(p) || null, '', tags('ဖုန်းပြင်', 'PhoneTips', 'Myanmar')].filter((x) => x !== null).join('\n')
    : [`🧾 Mahar POS – ${mmTitle}`, '', body, '', p.pos_price ? `💰 ဈေးနှုန်း: ${p.pos_price}` : null, 'Demo ကြည့်ချင်ရင် Message ပို့ပါ။',
      p.pos_contact || p.phone ? `📞 ${p.pos_contact || p.phone}` : null, p.page ? `👉 ${p.page}` : null, '', tags('MaharPOS', 'POS', 'ဆိုင်ပိုင်ရှင်', 'Myanmar')].filter((x) => x !== null).join('\n');
  return { kind, png: png(svg), caption };
}

// Today's drafts: rates + crypto + (phone tip, or a Mahar POS post on Mon / Wed / Fri). force = 'tip' | 'pos' | 'rates' | 'crypto'.
export async function contentDrafts(only = null) {
  const p = readProfile();
  const st = readJson(STATE_FILE, { tip: 0, pos: 0 });
  const dow = new Date(Date.now() + 6.5 * 3600e3).getUTCDay();
  const want = only ? [only] : ['rates', 'crypto', [1, 3, 5].includes(dow) ? 'pos' : 'tip'];
  const out = [], errors = [];
  for (const k of want) {
    try {
      if (k === 'rates') out.push(await ratesDraft(p));
      else if (k === 'crypto') out.push(await cryptoDraft(p));
      else if (k === 'tip') { out.push(libDraft('tip', TIPS, p, st.tip)); st.tip = (st.tip + 1) % TIPS.length; }
      else if (k === 'pos') { out.push(libDraft('pos', POS_POINTS, p, st.pos)); st.pos = (st.pos + 1) % POS_POINTS.length; }
    } catch (e) { errors.push(`${k}: ${e.message}`); }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(st));
  return { drafts: out, errors };
}
