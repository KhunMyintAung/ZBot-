import { webSearch, readPage, tinyfishOn } from './tinyfish.js';
import { toBurmese, translateText } from './translate.js';

// Answers chat messages WITHOUT Claude (no ANTHROPIC_API_KEY, wrong key, or AI budget used up).
// Uses only free tools: TinyFish search / page reading and Google Translate. Rule-based, so it is
// much simpler than the AI: it finds and translates information, it does not think or give advice.

const NOTE = 'ℹ️ AI မပါတဲ့ အဖြေပါ (TinyFish ရှာပြီး ဘာသာပြန်ထားတာ)။ Claude key ထည့်ရင် ပိုကောင်းတဲ့ အဖြေ ရပါမယ်။';

const COINS = [
  [/\b(btc|bitcoin)\b|ဘစ်ကွိုင်|ဘစ်ကွိုက်/i, 'BTC', 'Bitcoin'],
  [/\b(eth|ethereum|ether)\b|အီသာ/i, 'ETH', 'Ethereum'],
  [/\b(sol|solana)\b|ဆိုလာနာ/i, 'SOL', 'Solana'],
  [/\b(bnb)\b/i, 'BNB', 'BNB'],
  [/\b(xrp|ripple)\b/i, 'XRP', 'XRP'],
  [/\b(doge|dogecoin)\b/i, 'DOGE', 'Dogecoin'],
  [/\b(ada|cardano)\b/i, 'ADA', 'Cardano'],
  [/\b(ton)\b/i, 'TON', 'Toncoin'],
  [/\b(pepe)\b/i, 'PEPE', 'PEPE'],
];
export function findCoin(text) {
  for (const [re, sym, name] of COINS) if (re.test(text)) return { sym, name };
  const NOT = /^(AI|TA|SL|TP|OK|PNL|USD|USDT|API|BOT|FA|ETF|SEC|FED|CPI|US|UK|EU|PC|VPS|POS|NFP|FOMC)$/;
  const m = [...text.matchAll(/\b([A-Z]{2,8})(USDT)?\b/g)].find((x) => !NOT.test(x[1]));
  return m ? { sym: m[1], name: m[1] } : null;
}

// What does the message want? Returns { kind, ... }.
export function route(text) {
  const t = text.trim();
  const url = t.match(/https?:\/\/\S+/)?.[0];
  if (url) return { kind: 'page', url };
  const coin = findCoin(t);
  if (/\b(status|equity|position|pnl)\b|bot.*(ဘယ်လို|အခြေအနေ)|အခြေအနေ|ဘော့/i.test(t) && !/ဘာလို့|ဘာကြောင့်|why|news|သတင်း/i.test(t)) return { kind: 'status' };
  if (coin && /\b(analy[sz]e|ta)\b|ခွဲခြမ်း|chart|ချတ်/i.test(t)) return { kind: 'analyze', coin };
  if (coin) return { kind: 'coinNews', coin };
  // Small talk ("သေချာလား", "ok", "thanks") is not worth a web search.
  if (t.replace(/[\s?!.။၊]/g, '').length < 12) return { kind: 'help' };
  return { kind: 'search', text: t };
}

// Translate a numbered list in one request; keep English where the line count does not match.
async function burmeseLines(lines) {
  const my = await toBurmese(lines.join('\n'));
  const out = my?.split('\n').map((s) => s.trim()).filter(Boolean);
  return out?.length === lines.length ? out : lines;
}

async function resultsText(header, results) {
  if (!results.length) return `${header}\n\nဘာမှ ရှာမတွေ့ပါ။ စကားလုံး ပြောင်းပြီး ထပ်မေးကြည့်ပါ။`;
  const top = results.slice(0, 5);
  // one translation request for titles + snippets (the free translator limits how often it is called)
  const both = await burmeseLines([...top.map((r) => r.title.replace(/\s+/g, ' ')), ...top.map((r) => (r.snippet || '-').replace(/\s+/g, ' '))]);
  const titles = both.slice(0, top.length), snippets = both.slice(top.length);
  const items = top.map((r, i) => `${i + 1}. ${titles[i]}\n${snippets[i] !== '-' ? snippets[i] + '\n' : ''}🗞 ${r.site}${r.date ? ` · ${r.date}` : ''}\n🔗 ${r.url}`);
  return `${header}\n\n${items.join('\n\n')}\n\n${NOTE}`;
}

export async function coinNews(coin) {
  const r = await webSearch({ query: `${coin.name} ${coin.sym} price news today`, news: true, recent_hours: 24 });
  let res = r.results;
  if (!res.length) res = (await webSearch({ query: `${coin.name} price news`, news: true })).results;
  return resultsText(`📰 ${coin.sym} နောက်ဆုံး သတင်း (၂၄ နာရီ)`, res);
}

export async function searchAnswer(text) {
  // Burmese questions search badly, so search in English.
  const q = /[က-႟]/.test(text) ? (await translateText(text, 'my', 'en')) ?? text : text;
  const r = await webSearch({ query: q.slice(0, 250) });
  return resultsText(`🔎 "${q.slice(0, 80)}" ရှာတွေ့တာ`, r.results);
}

export async function pageAnswer(url) {
  const p = await readPage({ url });
  const paras = p.text.split(/\n+/).map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim())
    .filter((l) => l.length > 60 && l.split(' ').length >= 8);
  let en = '';
  for (const l of paras) { if (en.length + l.length > 3500) break; en += (en ? '\n\n' : '') + l; }
  if (!en) return `📄 ${p.title ?? url}\n\nဒီ Page မှာ ဖတ်စရာ စာ မတွေ့ပါ။`;
  const my = await toBurmese(en);
  return `📄 ${p.title ?? ''}\n\n${my ?? en}${en.length >= 3400 ? '\n…' : ''}\n\n🔗 ${p.url}\n\n${NOTE}`;
}

// Main entry. status/analyze are answered by the caller (they already have their own code).
export async function simpleAnswer(text) {
  if (!tinyfishOn()) return { text: 'AI (Claude key) နဲ့ TinyFish key နှစ်ခုလုံး မရှိလို့ စာနဲ့ မဖြေနိုင်သေးပါ။ /status /news /analyze BTC /help သုံးလို့ရပါတယ်။' };
  const r = route(text);
  if (r.kind === 'status' || r.kind === 'analyze') return r;
  if (r.kind === 'help') {
    return { text: 'Claude key မရှိသေးလို့ AI စကားပြော မရသေးပါ။ အခု လုပ်ပေးနိုင်တာ:\n• "BTC ဘာလို့ ကျနေတာလဲ" – Coin သတင်း ရှာပေး\n• "SOL analyze" – Coin ခွဲခြမ်းစိတ်ဖြာ\n• "Bot ဘယ်လိုလဲ" – Bot အခြေအနေ\n• Link ပို့ရင် – မြန်မာလို ဘာသာပြန်ပေး\n• ဘာမဆို မေး – Web မှာ ရှာပေး (ဥပမာ "Fiverr မှာ ဘယ်လို ငွေရှာရမလဲ")\n/help မှာ Command တွေ ကြည့်ပါ။' };
  }
  if (r.kind === 'page') return { text: await pageAnswer(r.url) };
  if (r.kind === 'coinNews') return { text: await coinNews(r.coin) };
  return { text: await searchAnswer(r.text) };
}
