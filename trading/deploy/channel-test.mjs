// Sends one sample of every channel post type, each clearly marked TEST.
// Run on the server:  cd /opt/zbot/trading && sudo -u zbot node deploy/channel-test.mjs
import { loadConfig, reloadEnv } from '../src/config.js';
import { Binance } from '../src/binance.js';
import { prepare } from '../src/strategies.js';
import { channelSignal, signalTargets } from '../src/bot.js';
import { groupSignal } from '../src/notify.js';
import { Telegram } from '../src/agent/telegram.js';
import { prepareAction, takePending, executeAction } from '../src/agent/tools.js';
import { newsText, faText, calendar } from '../src/agent/news.js';
import { latestNews, isSpotListing, WARNING } from '../src/agent/listings.js';

reloadEnv();
const cfg = { ...loadConfig(), interval: '4h' };
const ch = cfg.telegramGroupId;
if (!cfg.telegramToken || !ch) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_GROUP_ID missing');
const tg = new Telegram(cfg.telegramToken);
const T = '🧪 TEST · စမ်းသပ်ပို့ခြင်းသာ ဖြစ်ပါတယ်';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => {
  try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, '-', e.message); }
  await sleep(1500);
};
const mm = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

await step('1 intro', () => tg.send(ch, `${T}\n\nzBOT Channel မှာ ရရှိမယ့် Post အမျိုးအစား အားလုံးကို နမူနာ ပို့ပြပါမယ် 👇\n\n1. Trade Signal (Chart + Entry/SL/TP)\n2. Trade ပိတ်ခြင်း ရလဒ်\n3. Coin ခွဲခြမ်းစိတ်ဖြာချက် (Chart + TA + FA)\n4. FA သတင်း\n5. Fear & Greed + US သတင်းပွဲ ပြက္ခဒိန်\n6. US အရေးကြီး သတင်း သတိပေးချက်\n7. Binance Coin အသစ် ကြေညာချက်\n8. Admin စာ (/post)`));

// 1. trade signal: real price and the bot's own 1.5 ATR stop, but NOT a real trade
await step('2 trade signal (photo)', async () => {
  const ex = new Binance({ ...cfg, mode: 'paper' });
  const s = 'SOLUSDT';
  const price = await ex.price(s);
  const x = prepare(await ex.closedKlines(s, '4h', 400));
  const side = price < x.ema200.at(-1) ? 'short' : 'long', dir = side === 'long' ? 1 : -1;
  const rules = await ex.symbolRules(s);
  const pos = { side, entry: price, sl: +(price - dir * 1.5 * x.atr.at(-1)).toFixed(2), trailAtr: 3 };
  await channelSignal({ ...cfg, symbol: s }, rules, pos, `${T} – တကယ့် Trade မဟုတ်ပါ၊ မလိုက်ပါနဲ့`);
  console.log('     targets', JSON.stringify(signalTargets(pos, rules.tickSize)));
});

// 2. trade close
await step('3 trade close', () => groupSignal({ ...cfg, mode: 'paper' },
  `${T}\n✅ SOL SHORT ပိတ်ပြီ (TRAIL)\nဝင်ဈေး 79.68 → ထွက်ဈေး 75.24\nရလဒ် +5.57% · +4.83R (R = ရှုံးမယ်လို့ သတ်မှတ်ထားတဲ့ ပမာဏ)`));

// 3. coin analysis, through the same path as /analyze -> Yes
await step('4 coin analysis (photo + text)', async () => {
  const p = await prepareAction({ action: 'channel_analysis', symbol: 'BTC' });
  const a = takePending(p.id);
  a.text = `${T}\n\n${a.text}`;
  await executeAction(a);
});

await step('5 FA news', async () => tg.send(ch, `${T}\n\n${await newsText()}`));
await step('6 Fear & Greed + calendar', async () => tg.send(ch, `${T}\n\n${await faText()}`));

await step('7 US event reminder', async () => {
  const next = (await calendar()).find((e) => e.t > Date.now());
  const e = next ?? { title: 'CPI m/m', t: Date.now() + 3600e3, forecast: '0.3%', previous: '0.4%' };
  await tg.send(ch, `${T}${next ? '' : ' (နမူနာ)'}\n\n⏰ US အရေးကြီး သတင်း ထွက်မယ်\n${e.title}\n${mm(e.t)} (မြန်မာစံတော်ချိန်)` +
    `${e.forecast ? `\nခန့်မှန်း: ${e.forecast}` : ''}${e.previous ? ` · အရင်တစ်ခါ: ${e.previous}` : ''}\n\nဒီအချိန်မှာ ဈေး အတက်အကျ မြန်တတ်ပါတယ်။`);
});

await step('8 new coin listing', async () => {
  const a = (await latestNews()).find((n) => isSpotListing(n.title));
  if (!a) throw new Error('no spot listing article in the feed');
  await tg.send(ch, `${T} (ကြေညာချက်ဟောင်းကို နမူနာပြတာ)\n\n🆕 Binance ကြေညာချက် (Coin အသစ်)\n${a.title}\n${mm(a.t)} (မြန်မာစံတော်ချိန်)\n${a.url}\n\n${WARNING}`);
});

await step('9 admin post', async () => {
  const p = await prepareAction({ action: 'channel_post', text: `${T}\n\n📢 Admin စာ နမူနာ (/post)\nဒီလိုမျိုး Admin က ကြေညာချက်တွေ တိုက်ရိုက် ပို့နိုင်ပါတယ်။` });
  await executeAction(takePending(p.id));
});

await step('10 end', () => tg.send(ch, `${T}\n\n✅ စမ်းသပ်မှု ပြီးပါပြီ။ ဒီကစပြီး တကယ့် Signal နဲ့ သတင်းတွေ ရောက်လာပါမယ်။\n\n⚠️ ငွေရေးကြေးရေး အကြံပြုချက် မဟုတ်ပါ။ ဆုံးရှုံးခံနိုင်တဲ့ ငွေနဲ့ပဲ ကိုယ်တိုင် ဆုံးဖြတ်ပါ။`));
process.exit(0);
