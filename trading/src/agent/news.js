import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';
import { fngNow, fngClass, fngMm, GREED, FEAR } from '../fa.js';
import { toBurmese } from './translate.js';
import { tinyfishHeadlines, tinyfishOn, readPage } from './tinyfish.js';

// FA news for Telegram. It only informs; the bot's trades use the Fear & Greed filter (src/fa.js), not headlines.
//  - crypto headlines (Cointelegraph, The Block, Decrypt RSS, plus TinyFish news search when TINYFISH_API_KEY is set);
//    market-moving ones only unless NEWS_ALERTS=all
//  - US high-impact economic events (Forex Factory calendar): reminder about 1 hour before
//  - Fear & Greed: message when it moves into or out of Extreme Fear / Extreme Greed

const FILE = path.join(STATE_DIR, 'news.json');
const FEEDS = [
  ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['The Block', 'https://www.theblock.co/rss.xml'],
  ['Decrypt', 'https://decrypt.co/feed'],
];
const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// [regex, Burmese tag]. First match wins. A headline with no tag is not "important".
const TAGS = [
  [/\b(fed|fomc|powell|rate (cut|hike)|interest rates?|cpi|inflation|jobs report|payrolls|nfp|recession|tariffs?)\b/i, '💵 US စီးပွားရေး / Fed'],
  [/\b(sec|cftc|lawsuit|regulat\w*|ban|bans|banned|court|congress|senate|bill|law|government|stablecoin act|clarity act)\b/i, '🏛 ဥပဒေ / စည်းမျဉ်း'],
  [/\betfs?\b/i, '📊 ETF'],
  [/\b(hack|hacked|hacker|exploit\w*|stolen|drained?|breach|attack)\b/i, '🔓 Hack / ခိုးယူမှု'],
  [/\b(liquidat\w*|crash\w*|plunge\w*|tumble\w*|sell-?off|dumps?)\b/i, '📉 ဈေးကျ'],
  [/\b(surge\w*|soar\w*|rally|rallies|all-time high|record high)\b/i, '📈 ဈေးတက်'],
  [/\b(blackrock|microstrategy|saylor|treasury compan\w*|institution\w*|whales?)\b/i, '🏦 ငွေအင်အားကြီး'],
  [/\b(binance|coinbase|okx|bybit)\b/i, '🏪 Exchange'],
];
const COINS = /\b(bitcoin|btc|ether|ethereum|eth|solana|sol|bnb|xrp|crypto)\b/i;
const BIG = /Fed|ဥပဒေ|ETF|Hack/;

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { seen: null, events: [], fng: null }; } };
const save = (s) => fs.writeFileSync(FILE, JSON.stringify(s));
const mm = (t) => new Date(t + 6.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();

async function text(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export const tagOf = (title) => (TAGS.find(([re]) => re.test(title)) ?? [])[1] ?? null;
// Only market-moving news: no predictions, opinions, guides or questions. Fed / US data always counts;
// law, ETF and hack news only when it is about crypto; big price moves only for BTC / ETH / the whole market.
const NOISE = /\?|predict\w*|forecast|could|might|\bmay\b|analyst|here'?s|what (to|you|is)|\bwhy\b|how (to|much|high|low)|price analysis|technical|opinion|\btop \d+|\bbest\b|should|\bwill\b.*\b(hit|reach|go)\b|\bsays\b|podcast|sponsored|explained|guide|memecoin|presale|airdrop|giveaway|\b\d+x\b/i;
const MAJOR = /\b(bitcoin|btc|ether|ethereum|eth|crypto market|crypto)\b/i;
const important = (h) => {
  if (!h.tag || NOISE.test(h.title)) return false;
  if (/Fed/.test(h.tag)) return true;
  if (BIG.test(h.tag)) return COINS.test(h.title);
  return /ဈေးကျ|ဈေးတက်/.test(h.tag) && MAJOR.test(h.title);
};
// URGENT = moves the whole market now: Fed rate decision, very big hack ($100M+), Bitcoin crash / record, ETF approval, crypto ban.
const BIG_MONEY = /\$\s?\d+(\.\d+)?\s?(b|bn|billion)\b|\$\s?[1-9]\d{2,}\s?(m|million)\b/i;
const URGENT = [
  /\b(fomc|rate (cut|hike)|cuts? (interest )?rates|hikes? (interest )?rates|emergency)\b/i,
  BIG_MONEY,
  /\b(bitcoin|btc|crypto market)\b.*\b(crash\w*|plunge\w*|liquidat\w*|all-time high|record high)|\b(crash\w*|plunge\w*|liquidat\w*)\b.*\b(bitcoin|btc)\b/i,
  /\betfs?\b.*\bapprov\w*|\bapprov\w*.*\betfs?\b/i,
  /\bban(s|ned)?\b.*\bcrypto|\bcrypto\w*\b.*\bban(s|ned)?\b/i,
];
const urgent = (h) => important(h) && (/Hack/.test(h.tag) ? BIG_MONEY.test(h.title) : URGENT.some((re) => re !== BIG_MONEY && re.test(h.title)));
const key = (h) => h.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

export async function headlines() {
  const out = [];
  await Promise.all(FEEDS.map(async ([src, url]) => {
    try {
      const xml = await text(url);
      for (const it of xml.split(/<item[\s>]/).slice(1, 31)) {
        const g = (tag) => decode((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] ?? '');
        const title = g('title'), link = g('link') || g('guid');
        const t = Date.parse(g('pubDate')) || Date.now();
        // cover picture: media:content / enclosure / media:thumbnail / first <img> in the text
        const img = (it.match(/<media:content[^>]*url="([^"]+)"/) || it.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/) ||
          it.match(/<media:thumbnail[^>]*url="([^"]+)"/) || it.match(/<img[^>]*src="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') ?? null;
        const desc = g('description').replace(/\s*(The post|Read more|Continue reading).*$/i, '').slice(0, 260);
        if (title && link) out.push({ src, title, link: link.split('?')[0], t, tag: tagOf(title), img: img?.startsWith('http') ? img : null, desc });
      }
    } catch { /* one feed down is fine */ }
  }));
  try {
    for (const h of await tinyfishHeadlines()) out.push({ ...h, tag: tagOf(h.title), img: null, viaTinyfish: true });
  } catch { /* TinyFish is optional */ }
  const uniq = new Map();
  for (const h of out.sort((a, b) => b.t - a.t)) if (!uniq.has(key(h))) uniq.set(key(h), h);
  return [...uniq.values()];
}

// The site allows only a few requests per hour, so keep one copy for an hour (on disk, survives restarts).
const CAL_FILE = path.join(STATE_DIR, 'calendar.json');
export async function calendar() {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')); } catch { /* none */ }
  if (!c || Date.now() - c.t > 3600e3) {
    try {
      const j = JSON.parse(await text(CAL_URL));
      c = { t: Date.now(), events: j.filter((e) => e.country === 'USD' && e.impact === 'High')
        .map((e) => ({ title: e.title, t: Date.parse(e.date), forecast: e.forecast, previous: e.previous })) };
      fs.writeFileSync(CAL_FILE, JSON.stringify(c));
    } catch (e) { if (!c) throw e; }
  }
  return [...c.events].sort((a, b) => a.t - b.t);
}

const fngLine = (v) => `😨 Fear & Greed: ${v} – ${fngClass(v)} (${fngMm(v)})`;
const fngEffect = (v) => (v >= GREED ? 'Bot က Long အသစ် မဖွင့်ပါ (လောဘ အရမ်းများချိန် ဝယ်ရင် ပြန်ကျတတ်လို့)။'
  : v <= FEAR ? 'Bot က Short အသစ် မဖွင့်ပါ (ကြောက်လန့်ချိန် ရောင်းရင် ပြန်တက်တတ်လို့)။'
    : 'Bot က ပုံမှန်အတိုင်း Long/Short နှစ်ဖက်လုံး ဝင်ပါတယ်။');
// Channel caption for one headline, in Burmese (English title kept for accuracy). Max 1024 characters.
export async function newsCaption(h) {
  const desc = h.desc ? h.desc + (h.desc.length >= 260 ? '…' : '') : '';
  const my = await toBurmese(desc ? `${h.title}\n\n${desc}` : h.title);
  const [myTitle, ...rest] = (my ?? '').split(/\n\s*\n/);
  const head = [`${h.tag ?? '📰'} | Crypto သတင်း`, ''];
  if (!my || !/[က-႟]/.test(my)) return null; // translation failed: never post English only
  const body = [myTitle.trim(), rest.length ? '\n' + rest.join('\n').trim() : '', `\n🇬🇧 ${h.title}`];
  const foot = [`\n🗞 ${h.src} · ${mm(h.t)} (မြန်မာစံတော်ချိန်)`, `🔗 ${h.link}`, '', '#zBOT #CryptoNews'];
  let text = [...head, ...body, ...foot].filter((x) => x !== '').join('\n');
  if (text.length > 1024) text = [...head, body[0], body.at(-1), ...foot].filter((x) => x !== '').join('\n').slice(0, 1024);
  return text;
}
const item = (h) => `${h.tag ?? '📰'}\n${h.title}\n${h.src} · ${mm(h.t)}\n${h.link}`;

// ---------- full article (channel posts) ----------
const FULL_MAX = 6000; // English characters; Burmese comes out longer, Telegram splits at 4096

// Paragraphs only: drop pictures, link lists, menus, share buttons and "related" sections.
function cleanArticle(md, title) {
  const lines = [];
  for (let l of md.split(/\r?\n/)) {
    l = l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#+\s*/, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim();
    if (/^(related|read more|recommended|more news|also read|subscribe|share this|disclaimer)/i.test(l) && lines.join(' ').length > 800) break;
    // real sentences only (menus and price tickers have few words and no full stop)
    if (l.length < 60 || l === title || l.split(' ').length < 8 || !/[.!?"”’)]$/.test(l) || /cookie|newsletter|sign up|advertis|©/i.test(l)) continue;
    lines.push(l);
  }
  let text = '';
  for (const l of lines) {
    if (text.length + l.length > FULL_MAX) break;
    text += (text ? '\n\n' : '') + l;
  }
  return text.length > 300 ? text : null;
}

export async function articleText(h) {
  try {
    if (tinyfishOn()) {
      const p = await readPage({ url: h.link });
      const t = cleanArticle(p.text, h.title);
      if (t) return t;
    }
  } catch { /* try plain download */ }
  try {
    let html = await text(h.link);
    const art = html.match(/<article[\s\S]*?<\/article>/i);
    if (art) html = art[0];
    const paras = [...html.replace(/<(script|style|nav|footer|aside|figure)[\s\S]*?<\/\1>/gi, '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => decode(m[1])).join('\n');
    return cleanArticle(paras, h.title);
  } catch { return null; }
}

// Whole story in Burmese for a follow-up message under the picture post. null if the site can't be read.
export async function newsFull(h) {
  const en = await articleText(h);
  if (!en) return null;
  const my = await toBurmese(en);
  if (!my || !/[က-႟]/.test(my)) return null;
  return `📖 သတင်း အပြည့်အစုံ\n${h.title}\n\n${my ?? en}\n\n🗞 ${h.src} · 🔗 ${h.link}\n⚠️ သတင်းသက်သက်ပါ။ ငွေကြေးအကြံပေးချက် မဟုတ်ပါ။`;
}

// Returns the Telegram messages to send now. The first run only remembers what already exists.
export async function checkNews({ all = false } = {}) {
  const st = load();
  const out = [];
  out.channel = []; // URGENT posts straight to the community channel: { photo?, text, more? }
  out.owner = [];   // regular news posts to the owner only (forward by hand): { photo?, text, more? }
  const first = st.seen === null;
  const seen = new Set(st.seen ?? []);

  try {
    const hs = await headlines();
    // When TinyFish is first switched on, only remember its stories (don't announce 12 hours of old news at once).
    const tfItems = hs.filter((h) => h.viaTinyfish);
    if (tfItems.length && !st.tfSeeded) { for (const h of tfItems) seen.add(key(h)); st.tfSeeded = true; }
    if (hs.length) {
      const fresh = hs.filter((h) => !seen.has(key(h)) && Date.now() - h.t < 12 * 3600e3 && (all || important(h)));
      if (!first && fresh.length) {
        const day = new Date(Date.now() + 6.5 * 3600e3).toISOString().slice(0, 10);
        if (st.postDay !== day) { st.postDay = day; st.posts = 0; st.ownerPosts = 0; }
        const sent = new Set();
        // URGENT news goes straight to the community channel (max 3 a day).
        for (const h of fresh.filter(urgent).slice(0, Math.max(0, 3 - (st.posts ?? 0))).reverse()) {
          const text = await newsCaption(h);
          if (!text) continue;
          out.channel.push({ photo: h.img, text: `🚨 ${text}`, more: await newsFull(h) });
          st.posts = (st.posts ?? 0) + 1;
          sent.add(key(h));
        }
        // Regular news: only to the owner (zBOT chat), ready to forward. At most one every 2 hours, 6 a day.
        if (!all && Date.now() - (st.ownerAt ?? 0) >= 2 * 3600e3 && (st.ownerPosts ?? 0) < 6) {
          for (const h of fresh.filter((x) => !sent.has(key(x)))) {
            const text = await newsCaption(h);
            if (!text) continue;
            out.owner.push({ photo: h.img, text, more: await newsFull(h) });
            st.ownerAt = Date.now(); st.ownerPosts = (st.ownerPosts ?? 0) + 1;
            break;
          }
        }
        if (all) for (const h of fresh.slice(0, 8).reverse()) out.push(item(h));
      }
      st.seen = [...new Set([...hs.map(key), ...(st.seen ?? [])])].slice(0, 600);
    }
  } catch (e) { out.error = `news: ${e.message}`; }

  try {
    st.events = st.events ?? [];
    for (const e of await calendar()) {
      const id = `${e.title}|${e.t}`;
      const mins = (e.t - Date.now()) / 60e3;
      if (mins > 0 && mins <= 75 && !st.events.includes(id)) {
        out.push(`⏰ US အရေးကြီး သတင်း ${Math.round(mins)} မိနစ်အတွင်း ထွက်မယ်\n${e.title}\n${mm(e.t)} (မြန်မာစံတော်ချိန်)` +
          `${e.forecast ? `\nခန့်မှန်း: ${e.forecast}` : ''}${e.previous ? ` · အရင်တစ်ခါ: ${e.previous}` : ''}` +
          '\n\nဒီအချိန်မှာ ဈေး အတက်အကျ မြန်တတ်ပါတယ်။ Bot ရဲ့ Trade တွေမှာ SL ရှိပါတယ်။');
        out.channel.push({ text: out.at(-1) });
        st.events.push(id);
      }
    }
    st.events = st.events.slice(-100);
  } catch (e) { out.error = [out.error, `calendar: ${e.message}`].filter(Boolean).join('; '); }

  const v = await fngNow();
  if (v !== null) {
    const zone = v >= GREED ? 'greed' : v <= FEAR ? 'fear' : 'normal';
    if (st.fng && st.fng !== zone && !first) { out.push(`${fngLine(v)}\n${fngEffect(v)}`); out.channel.push({ text: out.at(-1) }); }
    st.fng = zone;
  }

  save(st);
  return out;
}

// /news command
export async function newsText() {
  const hs = (await headlines()).filter(important).slice(0, 8);
  if (!hs.length) return 'အရေးကြီး crypto သတင်း မတွေ့သေးပါ။';
  return `📰 နောက်ဆုံး FA သတင်းများ\n\n${hs.map(item).join('\n\n')}`;
}

// /fa command and the morning report
export async function faText() {
  const parts = [];
  const v = await fngNow();
  parts.push(v === null ? '😨 Fear & Greed: ယူလို့ မရပါ' : `${fngLine(v)}\n${fngEffect(v)}`);
  try {
    const evs = (await calendar()).filter((e) => e.t > Date.now() - 3600e3).slice(0, 8);
    parts.push(evs.length
      ? `📅 ဒီအပတ် US အရေးကြီး သတင်းများ (မြန်မာစံတော်ချိန်)\n${evs.map((e) => `• ${mm(e.t)} ${e.title}${e.forecast ? ` (ခန့်မှန်း ${e.forecast})` : ''}`).join('\n')}`
      : '📅 ဒီအပတ် ကျန်တဲ့ US အရေးကြီး သတင်း မရှိပါ။');
  } catch { parts.push('📅 Calendar ယူလို့ မရပါ'); }
  return parts.join('\n\n');
}
