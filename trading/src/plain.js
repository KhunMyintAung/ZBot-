// Plain Burmese for the owner and the community: no trading shorthand (qty, SL, R, EMA...) without an explanation.
// Used by the bot's Telegram alerts, the channel signals and the agent's /status.

const coinOf = (s) => String(s).replace(/(USDT|USDC)$/, '');
export const sideMm = (side) => (String(side).toLowerCase() === 'long' ? 'LONG (ဈေးတက်မှ အမြတ်ရ)' : 'SHORT (ဈေးကျမှ အမြတ်ရ)');
export const sideIcon = (side) => (String(side).toLowerCase() === 'long' ? '🟢' : '🔴');
export const n = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(+v) ? '-'
  : Math.abs(v) >= 1000 ? (+v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(+(+v).toFixed(d)));
export const priceStr = (v) => (!Number.isFinite(+v) ? '-' : +v >= 1000 ? (+v).toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(+(+v).toPrecision(6)));
const pctFrom = (v, base) => `${((v - base) / base) * 100 >= 0 ? '+' : ''}${(((v - base) / base) * 100).toFixed(2)}%`;

const PATTERNS = [
  [/inverse head/i, 'ခေါင်းနဲ့ပခုံး ပြောင်းပြန် ပုံစံ (ကျနေရာက ပြန်တက်တတ်တဲ့ ပုံ)'],
  [/head/i, 'ခေါင်းနဲ့ပခုံး ပုံစံ (တက်နေရာက ပြန်ကျတတ်တဲ့ ပုံ)'],
  [/double top/i, 'တောင်ထိပ် နှစ်ခု ပုံစံ (အပေါ်ကို ၂ ခါ တက်မရတော့လို့ ကျတတ်)'],
  [/double bottom/i, 'ချိုင့် နှစ်ခု ပုံစံ (အောက်ကို ၂ ခါ ကျမရတော့လို့ တက်တတ်)'],
  [/triangle/i, 'တြိဂံ ပုံစံ (ဈေး ကျဉ်းလာပြီး တစ်ဘက်ကို ပေါက်ထွက်)'],
  [/flag|pennant/i, 'အလံ ပုံစံ (ပြင်းပြင်း ရွေ့ပြီး ခဏနား၊ ဆက်ရွေ့တတ်)'],
  [/wedge/i, 'သပ်ပုံစံ (Wedge)'],
  [/rectangle|range box|channel/i, 'ဘောင်ခတ် ပုံစံ (ဘောင်ကို ပေါက်ထွက်)'],
];

// Why the bot opened: strategy reason in English → plain Burmese.
export function reasonMm(reason) {
  const r = String(reason ?? '');
  if (/^manual/i.test(r)) return 'ပိုင်ရှင် ကိုယ်တိုင် ဖွင့်ခိုင်းလို့';
  if (/EMA20 crossed above EMA50/i.test(r)) return 'ဈေး ဦးတည်ချက် အပေါ်ကို ပြောင်းလာပြီ (မကြာသေးခင် ပျမ်းမျှဈေးက ကြာရှည် ပျမ်းမျှဈေးကို ကျော်တက်)၊ ရေရှည်မှာလည်း ဈေးတက်လမ်းကြောင်း ဖြစ်နေတယ်';
  if (/EMA20 crossed below EMA50/i.test(r)) return 'ဈေး ဦးတည်ချက် အောက်ကို ပြောင်းလာပြီ (မကြာသေးခင် ပျမ်းမျှဈေးက ကြာရှည် ပျမ်းမျှဈေးကို ဖြတ်ကျ)၊ ရေရှည်မှာလည်း ဈေးကျလမ်းကြောင်း ဖြစ်နေတယ်';
  let m = r.match(/(\d+)-bar high breakout/i);
  if (m) return `နောက်ဆုံး ${m[1]} ချောင်း (Candle) ထဲက အမြင့်ဆုံးဈေးကို ဖောက်တက်သွားပြီ၊ ရေရှည်လည်း ဈေးတက်လမ်းကြောင်း`;
  m = r.match(/(\d+)-bar low breakdown/i);
  if (m) return `နောက်ဆုံး ${m[1]} ချောင်း (Candle) ထဲက အနိမ့်ဆုံးဈေးကို ဖောက်ကျသွားပြီ၊ ရေရှည်လည်း ဈေးကျလမ်းကြောင်း`;
  m = r.match(/^(Hammer|Shooting Star|Bullish Engulfing|Bearish Engulfing) at (support|resistance)/i);
  if (m) {
    const name = { hammer: 'Hammer (တူ) ပုံ Candle – အောက်ဆွဲချပေမယ့် ဝယ်သူတွေ ပြန်တွန်းတင်', 'shooting star': 'Shooting Star ပုံ Candle – အပေါ်တက်ပေမယ့် ရောင်းသူတွေ ပြန်ဖိချ', 'bullish engulfing': 'Bullish Engulfing – အစိမ်းချောင်းက အရင်အနီချောင်းကို လုံးဝ ဖုံးသွား (ဝယ်သူ နိုင်)', 'bearish engulfing': 'Bearish Engulfing – အနီချောင်းက အရင်အစိမ်းချောင်းကို လုံးဝ ဖုံးသွား (ရောင်းသူ နိုင်)' }[m[1].toLowerCase()];
    const zone = m[2].toLowerCase() === 'support' ? 'အရင်က ဈေးပြန်တက်ခဲ့တဲ့ Support ဇုန်' : 'အရင်က ဈေးပြန်ကျခဲ့တဲ့ Resistance ဇုန်';
    return `${name}၊ ${zone} ပေါ်မှာ ပေါ်လာလို့${/Doji/i.test(r) ? ' (အရင်ချောင်းက Doji – ဈေးကွက် တွေဝေနေရာက ဦးတည်ချက် ရလာ)' : ''}`;
  }
  if (/lower band.*RSI/i.test(r)) return 'ဈေး အရမ်းကျထားလို့ (RSI 30 အောက်) ပြန်တက်နိုင်ခြေ';
  if (/upper band.*RSI/i.test(r)) return 'ဈေး အရမ်းတက်ထားလို့ (RSI 70 အထက်) ပြန်ကျနိုင်ခြေ';
  if (/breakout/i.test(r)) {
    const p = PATTERNS.find(([re]) => re.test(r));
    return `Chart ပေါ်မှာ ${p ? p[1] : r.replace(/ breakout/i, '') + ' ပုံစံ'} ဖြစ်ပြီး ဈေး ပေါက်ထွက်သွားလို့`;
  }
  return r;
}

// Why a position closed.
export function whyMm(why) {
  const w = String(why ?? '');
  if (w === 'SL') return '🛑 ရှုံးရင်ထွက်မယ့် ဈေး (Stop-loss) ကို ထိလို့ ပိတ်လိုက်တယ်';
  if (w === 'TRAIL') return '🔒 နောက်ကလိုက်ရွှေ့ထားတဲ့ Stop-loss ထိလို့ အမြတ်သိမ်းပြီး ပိတ်လိုက်တယ်';
  if (w === 'TP') return '🎯 အမြတ်ယူဈေး (Take-profit) ရောက်လို့ ပိတ်လိုက်တယ်';
  if (w === 'manual') return '✋ ကိုယ်တိုင် ပိတ်ခိုင်းလို့';
  if (/exchange/i.test(w)) return 'Binance ပေါ်မှာ ပိတ်သွားပြီ';
  if (/stop missing/i.test(w)) return 'Stop-loss Order ပျောက်နေလို့ အန္တရာယ်ကင်းအောင် ပိတ်လိုက်တယ်';
  return w;
}

const STRAT = { combo: 'ဦးတည်ချက် + Chart ပုံစံ', trend: 'ဦးတည်ချက် လိုက်', pattern: 'Chart ပုံစံ', candle: 'Candle ပုံ + Support/Resistance ဇုန်', brain: 'ဦးတည်ချက် + Chart ပုံစံ + Candle ဇုန်', breakout: 'ဈေး ဖောက်ထွက်', meanrev: 'ပြန်လှည့်' };
const TF = { '15m': '၁၅ မိနစ်', '1h': '၁ နာရီ', '4h': '၄ နာရီ', '1d': '၁ ရက်' };

// Telegram header: who is talking and with what money.
export const botTag = (cfg) => `🤖 zBOT · ${cfg.mode === 'live' ? '💰 ငွေအစစ်' : '🧪 ငွေအတု (Paper)'}${cfg.market === 'spot' ? ' · Spot' : ''}`;

// "Bot started" message in plain Burmese.
export function startMm(cfg) {
  const coins = cfg.symbols.map((s) => s.replace(/USDT$/, '')).join(', ');
  return [
    '✅ Bot စတင် အလုပ်လုပ်ပါပြီ',
    '',
    `🪙 ကြည့်နေတဲ့ Coin (${cfg.symbols.length}): ${coins}`,
    `📊 ${TF[cfg.interval] ?? cfg.interval} Chart · နည်း: ${STRAT[cfg.strategy] ?? cfg.strategy}`,
    `🛡️ Trade တစ်ခု ရှုံးရင် ငွေရဲ့ ${cfg.riskPct}% ပဲ ရှုံးမယ်`,
    `📂 တစ်ပြိုင်နက် အများဆုံး ${cfg.maxOpen} Trade`,
    `⛔ တစ်ရက် ${cfg.dailyLossPct}% ရှုံးရင် အဲဒီနေ့ ရပ်မယ်`,
    ...(cfg.market === 'futures' ? [`⚙️ Leverage ${cfg.leverage}x`] : []),
  ].join('\n');
}
const modeMm = (m) => (m === 'live' ? '💰 ငွေအစစ်' : m === 'testnet' ? '🧪 Testnet (စမ်းသပ်)' : '🧪 စမ်းသပ်ငွေ (Paper – ငွေအစစ် မဟုတ်)');

// Owner alert when a position opens.
export function openMm({ mode, symbol, side, entry, sl, tps, trailing, qty, riskAmt, riskPct, reason }) {
  const coin = coinOf(symbol);
  return [
    `${sideIcon(side)} Position အသစ် ဖွင့်ပြီ – ${coin} ${sideMm(side)}`,
    '',
    `📍 ဝင်ဈေး: ${priceStr(entry)}`,
    `🛑 ရှုံးရင်ထွက်ဈေး (Stop-loss): ${priceStr(sl)} (${pctFrom(sl, entry)})`,
    ...tps.map(([l, v]) => `🎯 အမြတ်ယူဈေး ${l.replace('TP', '')}: ${priceStr(v)} (${pctFrom(v, entry)})`),
    trailing ? 'ℹ️ Bot က အမြတ်ယူဈေး ပုံသေ မထားပါ။ ဈေးအမြတ်ဘက် ရွေ့တာနဲ့ Stop-loss ကို နောက်ကလိုက်ရွှေ့ပြီး အမြတ် ကာထားမယ်။' : null,
    '',
    `📦 ပမာဏ: ${n(qty, 4)} ${coin} (≈ ${n(qty * entry)} USDT တန်ဖိုး)`,
    `💸 Stop-loss ထိရင် ရှုံးမှာ: ≈ ${n(riskAmt)} USDT${riskPct ? ` (Account ရဲ့ ${riskPct}%)` : ''}`,
    `❓ ဘာကြောင့် ဝင်တာလဲ: ${reasonMm(reason)}`,
    '',
    modeMm(mode),
  ].filter((x) => x !== null).join('\n');
}

// Owner alert when a position closes.
export function closeMm({ mode, symbol, side, entry, exit, pnl, why }) {
  const coin = coinOf(symbol);
  const win = pnl >= 0;
  return [
    `${win ? '✅ အမြတ်နဲ့' : '❌ အရှုံးနဲ့'} ပိတ်ပြီ – ${coin} ${sideMm(side)}`,
    '',
    `ဘာကြောင့် ပိတ်လဲ: ${whyMm(why)}`,
    `ဝင်ဈေး ${priceStr(entry)} → ထွက်ဈေး ${priceStr(exit)}`,
    `${win ? '💰 အမြတ်' : '💸 အရှုံး'}: ${win ? '+' : ''}${n(pnl)} USDT`,
    '',
    modeMm(mode),
  ].join('\n');
}

// /status
export function statusMm(s) {
  const L = [];
  const state = !s.bot.running ? '⛔ ရပ်ထားတယ်' : s.bot.paused ? '⏸ Trade အသစ် ခဏ မဝင်ပါ (ဖွင့်ထားတာတွေ ဆက်စောင့်)' : '✅ အလုပ်လုပ်နေတယ်';
  L.push(`🤖 zBOT – ${state}`);
  L.push(modeMm(s.config.mode));
  L.push(`📊 ${TF[s.config.interval] ?? s.config.interval} Chart · နည်းလမ်း: ${STRAT[s.config.strategy] ?? s.config.strategy}`);
  L.push(`🛡 Trade တစ်ခုမှာ Account ရဲ့ ${s.config.riskPct}% ပဲ ရှုံးခံ · Leverage ${s.config.leverage}x · တစ်နေ့ ${s.config.dailyLossPct}% ရှုံးရင် ရပ်`);
  if (s.bot.stale) L.push(`⚠️ Bot ဆီက သတင်း ${Math.round(s.bot.heartbeatAgeSec / 60)} မိနစ် မရတော့ပါ (Internet / Server စစ်ပါ)`);
  if (s.bot.lastStartError) L.push(`⚠️ စဖွင့်လို့ မရ: ${s.bot.lastStartError}`);
  L.push('');
  if (s.equity.withOpenPnl !== undefined) {
    L.push(`💰 လက်ကျန်ငွေ: ${n(s.equity.withOpenPnl)} USDT`);
    L.push(`   (စစချင်း ${n(s.equity.start)} ကနေ ${s.equity.totalPct >= 0 ? '+' : ''}${s.equity.totalPct}% ${s.equity.totalPct >= 0 ? 'တိုး' : 'လျော့'})`);
  }
  L.push(`📅 ဒီနေ့: Trade ${s.today.closed} ခု ပိတ်ပြီး · ${s.today.closedPnl >= 0 ? 'အမြတ် +' : 'အရှုံး '}${n(s.today.closedPnl)} USDT`);
  if (s.today.halted) L.push('🛑 ဒီနေ့ ရှုံးနိုင်တဲ့ အများဆုံး ပမာဏ ပြည့်လို့ မနက်ဖြန်ထိ Trade အသစ် မဝင်တော့ပါ');
  L.push('');
  if (!s.positions.length) L.push('📂 ဖွင့်ထားတဲ့ Position: မရှိပါ (အခွင့်အရေး စောင့်နေတယ်)');
  else {
    L.push(`📂 ဖွင့်ထားတဲ့ Position (${s.positions.length})`);
    for (const p of s.positions) {
      const up = p.unrealizedPnl;
      L.push(`${sideIcon(p.side)} ${coinOf(p.symbol)} ${sideMm(p.side)}`,
        `   ဝင်ဈေး ${priceStr(p.entry)} → အခု ${priceStr(p.price)}`,
        `   ${up === null || up === undefined ? 'အမြတ်/အရှုံး: -' : up >= 0 ? `💰 အမြတ် +${n(up)} USDT` : `💸 အရှုံး ${n(up)} USDT`} (မပိတ်ရသေး)`,
        `   🛑 Stop-loss: ${priceStr(p.stopLoss)}`);
    }
  }
  if (s.spotDca) {
    L.push('', `🧪 Spot Buy the Dip (ငွေအတု, ${s.spotDca.days} ရက်) – Bot နဲ့ သီးသန့်`);
    for (const r of s.spotDca.rules) L.push(`• ${r.name}: ထည့် $${n(r.inv)} → $${n(r.val)} (${r.inv ? (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%' : '-'})`);
  }
  return L.join('\n');
}
