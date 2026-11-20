import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';

// New-coin watcher. It only TELLS the owner; it never buys.
//  1. Binance "New Cryptocurrency Listing" announcements (usually hours or days before trading opens)
//  2. New USDT pairs appearing on Binance Spot (trading has opened)
//  3. New Binance Futures contracts of any kind (coins, stocks/IPOs like ANTUSDT, pre-market) – alert only
// The first run only remembers what already exists, so old listings are not announced.

const FILE = path.join(STATE_DIR, 'listings.json');
const NEWS_URL = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=20';
const INFO_URL = 'https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT';
const PRICE_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbol=';
const FUT_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const FUT_PRICE_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=';
const ARTICLE_URL ='https://www.binance.com/en/support/announcement/detail/';
// Spot listings only: futures, margin and options launches are not "a new coin to buy".
const SPOT_NEWS = /will list|will add .*(spot|seed tag)|launchpool|hodler airdrop/i;
const NOT_SPOT = /futures|perpetual|margin|options|delist/i;

export const WARNING = `⚠️ သတိ: လွန်ခဲ့တဲ့ ၃ နှစ်က Coin အသစ် ၂၈၉ ခုမှာ ပထမနေ့ ပိတ်ဈေးနဲ့ ဝယ်သူ ၆၅% က ရက် ၃၀ အကြာ ရှုံးပါတယ် (အလယ်ကိန်း -13.5%၊ ရက် ၉၀ မှာ -34%)။ အနိမ့်ဆုံးဈေးက ပျမ်းမျှ ရက် ၂၂ လောက်မှာ ရောက်တတ်ပါတယ်။ ဝယ်မယ်ဆို ဆုံးရှုံးခံနိုင်တဲ့ ငွေနည်းနည်းပဲ သုံးပါ။`;

async function getJson(url, fetchFn) {
  const res = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { articles: null, symbols: null }; }
}
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s));

export async function latestNews(fetchFn = fetch) {
  const j = await getJson(NEWS_URL, fetchFn);
  const list = j?.data?.catalogs?.[0]?.articles ?? [];
  return list.map((a) => ({ id: a.id, title: String(a.title ?? ''), t: a.releaseDate, url: ARTICLE_URL + a.code }));
}
export const isSpotListing = (title) => SPOT_NEWS.test(title) && !NOT_SPOT.test(title);

export const STOCK_WARNING = '⚠️ ဒါက Stock (ကုမ္ပဏီ အစုရှယ်ယာ) ဈေးကို လိုက်တဲ့ Futures Contract ပါ – ရှယ်ယာ ပိုင်ဆိုင်ခွင့် မပါပါ။ IPO / Stock အသစ်တွေက ဈေး အတက်အကျ အရမ်း ပြင်းပြီး Leverage နဲ့ဆို Liquidate ဖြစ်လွယ်ပါတယ်။ Bot က Stock တွေကို Trade မလုပ်ပါ (Backtest မှာ ရှုံးခဲ့လို့)။';
const KIND = { COIN: '🪙 Coin', EQUITY: '🏢 US Stock', KR_EQUITY: '🏢 Korea Stock', HK_EQUITY: '🏢 Hong Kong Stock', CN_EQUITY: '🏢 China Stock', PREMARKET: '⏳ Pre-market (IPO မတိုင်ခင်)', COMMODITY: '🥇 Commodity', INDEX: '📊 Index', FX: '💱 Currency' };
const kindOf = (s) => KIND[s.underlyingType] ?? s.underlyingType ?? '?';
// perpetuals of every kind (crypto PERPETUAL + stock/IPO TRADIFI_PERPETUAL); settled/expired ones are not new
async function futuresInfo(fetchFn) {
  const info = await getJson(FUT_INFO_URL, fetchFn);
  return (info.symbols ?? []).filter((s) => /PERPETUAL/.test(s.contractType ?? '') && s.status !== 'SETTLING');
}

const mm = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

// Returns the Telegram messages to send (possibly none). Each source fails on its own.
export async function checkListings(fetchFn = fetch) {
  const st = load();
  const out = [];

  try {
    const news = await latestNews(fetchFn);
    if (news.length) {
      const known = new Set(st.articles ?? []);
      if (st.articles) {
        // only announcements from the last 2 days: an old article that reappears in the feed is not news
        for (const a of news.filter((n) => !known.has(n.id) && isSpotListing(n.title) && Date.now() - n.t < 2 * 864e5).reverse()) {
          out.push(`🆕 Binance ကြေညာချက် (Coin အသစ်)\n${a.title}\n${mm(a.t)} (မြန်မာစံတော်ချိန်)\n${a.url}\n\nTrade မဖွင့်သေးပါ။ ဖွင့်တဲ့အချိန်ကို ကြေညာချက်ထဲမှာ ကြည့်ပါ။\n\n${WARNING}`);
        }
      }
      st.articles = [...new Set([...news.map((n) => n.id), ...(st.articles ?? [])])].slice(0, 400);
    }
  } catch (e) { out.error = `news: ${e.message}`; }

  try {
    const info = await getJson(INFO_URL, fetchFn);
    const now = (info.symbols ?? []).filter((s) => s.quoteAsset === 'USDT').map((s) => s.symbol);
    if (now.length > 50) {
      if (st.symbols) {
        const known = new Set(st.symbols);
        for (const sym of now.filter((s) => !known.has(s)).slice(0, 5)) {
          let price = '';
          try {
            const t = await getJson(PRICE_URL + sym, fetchFn);
            if (+t.lastPrice > 0) price = `\nအခုဈေး ${+t.lastPrice} USDT · ဖွင့်ဈေးကနေ ${(+t.priceChangePercent).toFixed(1)}% · အမြင့်ဆုံး ${+t.highPrice} · အနိမ့်ဆုံး ${+t.lowPrice}`;
          } catch { /* not trading yet */ }
          out.push(`🟢 Binance Spot မှာ ${sym} အသစ် ပေါ်လာပါပြီ${price}\nhttps://www.binance.com/en/trade/${sym.replace(/USDT$/, '')}_USDT\n\nBot က မဝယ်ပါ။ ဝယ်မဝယ် ကိုယ်တိုင် ဆုံးဖြတ်ပါ။\n\n${WARNING}`);
        }
      }
      st.symbols = now;
    }
  } catch (e) { out.error = [out.error, `symbols: ${e.message}`].filter(Boolean).join('; '); }

  try {
    const futs = await futuresInfo(fetchFn);
    if (futs.length > 50) {
      if (st.futures) {
        const known = new Set(st.futures);
        for (const f of futs.filter((x) => !known.has(x.symbol)).slice(0, 5)) {
          let price = '';
          try {
            const t = await getJson(FUT_PRICE_URL + f.symbol, fetchFn);
            if (+t.lastPrice > 0) price = `\nအခုဈေး ${+t.lastPrice} USDT · 24h ${(+t.priceChangePercent).toFixed(1)}%`;
          } catch { /* not trading yet */ }
          const coin = f.underlyingType === 'COIN';
          // plain stock contracts arrive in batches: owner only; coins and pre-market (IPO) also go to the channel
          if (!coin && f.underlyingType !== 'PREMARKET') (out.ownerOnly ??= new Set()).add(out.length);
          out.push(`📈 Binance Futures မှာ Contract အသစ်: ${f.symbol}\nအမျိုးအစား: ${kindOf(f)} · ${f.status === 'TRADING' ? 'Trade လုပ်လို့ရပြီ' : f.status}${price}\nhttps://www.binance.com/en/futures/${f.symbol}\n\nBot က အလိုလို မဝင်ပါ။ သတိပေးချက်သာ ဖြစ်ပါတယ်။\n\n${coin ? WARNING : STOCK_WARNING}`);
        }
      }
      st.futures = futs.map((x) => x.symbol);
    }
  } catch (e) { out.error = [out.error, `futures: ${e.message}`].filter(Boolean).join('; '); }

  save(st);
  return out;
}

// /listings command: the newest spot listing announcements.
export async function listingsText(fetchFn = fetch) {
  const news = (await latestNews(fetchFn)).filter((n) => isSpotListing(n.title) && Date.now() - n.t < 7 * 864e5).slice(0, 5);
  let futs = [];
  try { futs = (await futuresInfo(fetchFn)).filter((f) => Date.now() - f.onboardDate < 7 * 864e5).sort((a, b) => b.onboardDate - a.onboardDate).slice(0, 12); } catch { /* spot part still shows */ }
  const spot = news.length
    ? `🆕 ဒီ ၇ ရက်အတွင်း Binance Spot listing ကြေညာချက်များ\n\n${news.map((a) => `• ${mm(a.t)}\n${a.title}\n${a.url}`).join('\n\n')}\n\n${WARNING}`
    : 'ဒီ ၇ ရက်အတွင်း Binance Spot listing ကြေညာချက် မရှိပါ။';
  const fut = futs.length
    ? `\n\n📈 ဒီ ၇ ရက်အတွင်း Futures Contract အသစ်\n${futs.map((f) => `• ${f.symbol} – ${kindOf(f)} (${mm(f.onboardDate).slice(0, 10)})`).join('\n')}${futs.some((f) => f.underlyingType !== 'COIN') ? `\n\n${STOCK_WARNING}` : ''}`
    : '';
  return spot + fut;
}
