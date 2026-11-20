import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { STATE_DIR, reloadEnv } from '../config.js';
import { dayKey } from '../risk.js';
import { log } from '../notify.js';
import { readControl, writeControl } from '../control.js';
import { Telegram } from './telegram.js';
import { Brain } from './brain.js';
import { OpenAIBrain, openaiError, openaiKeyProblem } from './brain-openai.js';
import { dbsCheck } from './dbswatch.js';
import { scanOpportunities, opportunityText } from './scanner.js';
import { logsText, healthText } from './ops.js';
import { walletCardPng } from './walletcard.js';
import { teamStatus, teamText } from '../team.js';
import { promoText, promoPostNext, promoDue, savePromo, promoState, promoPosts, promoPng } from './promo.js';
import { aiReviewText } from '../aireview.js';
import { simpleAnswer } from './simple.js';
import { chartPng, chartCaption } from '../chartimg.js';
import { checkListings, listingsText } from './listings.js';
import { checkNews, newsText, faText } from './news.js';
import { analyzeCoin } from './analysis.js';
import { addNote, forgetNote, memoryText, learnFromTrades } from './memory.js';
import { mmkText } from '../mmk.js';
import { contentDrafts, setProfile, profileText } from './content.js';
import { accountRisk, riskText, riskWarnings } from './riskwatch.js';
import { whyMm } from '../plain.js';
import { dcaTick, dcaStatus, dcaSummary } from './dcapaper.js';
import {
  freshConfig, botStatus, statusText, tradeHistory, readTasks, prepareAction, takePending, executeAction, describeAction, pauseBot,
} from './tools.js';

// Telegram AI agent: the owner chats with it; it reports on zBOT, controls it (with Yes/No buttons
// for anything risky) and helps with business. Only TELEGRAM_CHAT_ID is answered.

const OFFSET_FILE = path.join(STATE_DIR, 'agent-offset.json');
const REPORT_FILE = path.join(STATE_DIR, 'agent-report.json');
const PID_FILE = path.join(STATE_DIR, 'agent.pid');
const REPORT_HOUR = 8; // Myanmar time
const CONTENT_HOUR = 7; // Myanmar time: daily post drafts
const CONTENT_FILE = path.join(STATE_DIR, 'agent-content-day.json');
const STALE_MS = 15 * 60e3; // ignore chat messages older than this after a restart

const HELP = `zBOT Agent 🤖
စာနဲ့ ပုံမှန်ပြောလို့ရပါတယ် (ဥပမာ "Bot ဘယ်လိုလဲ", "BTC ပိတ်လိုက်", "ဒီနေ့ ဘာလုပ်ရမလဲ", "Phone repair TikTok script ရေးပေး")။

Commands:
/status – Bot အခြေအနေ
/wallet – ငွေ Card ပုံ (လက်ကျန်၊ ဘယ်နှဆ ကြီးလာလဲ၊ စည်းကမ်း)
/team – Bot ရဲ့ အပိုင်းတစ်ခုစီ (Entry, Exit, Risk, AI, News…) အခု ဘာလုပ်နေလဲ
/risk – Binance Futures (အစစ်) Position၊ Liquidation ဈေး
/dca – Buy the Dip စမ်းသပ်မှု (ငွေအတု) ရလဒ်  ·  /dca summary – အနှစ်ချုပ်
/ai – AI က ကျော်ခိုင်းခဲ့တဲ့ Signal တွေနဲ့ ရလဒ်
/dbs – DBS Myanmar TikTok မှာ Video အသစ် ရှိမရှိ စစ်
/health – Server အခြေအနေ (Bot, RAM, Disk)
/logs – Bot Log နောက်ဆုံး ၂၀ ကြောင်း (/logs 50 · /logs all)
/restart bot · /restart agent – ပြန်ဖွင့် (Yes/No မေးမယ်)
/promo – Channel ကို နေ့တိုင်း ကြော်ငြာပုံ တင် (/promo on · off · now · preview)
/scan – Bot မကိုင်တဲ့ တခြား Coin တွေမှာ အခွင့်အရေး ရှာ (သတိပေးချက်သာ၊ Auto မဝင်)
/chart BTC – Chart ပုံ (Entry, SL, TP ပါ)
/report – နေ့စဉ် Report
/mmk – ဒေါ်လာ၊ ဘတ်၊ ရွှေ၊ ဆီ ဈေး (/mmk 100 USD – တွက်ပေး)
/listings – Binance Coin အသစ် ကြေညာချက်များ
/news – FA သတင်း (crypto)
/fa – Fear & Greed + US သတင်းပွဲ ပြက္ခဒိန်
/analyze SOL – Coin ခွဲခြမ်းစိတ်ဖြာ (Chart + TA + FA)၊ ပြီးရင် Channel ကို ပို့လို့ရ
/long SOL [SL] [TP] – Long ဖွင့် (SL/TP မထည့်ရင် Bot တွက်)
/short SOL [SL] [TP] – Short ဖွင့်
/sl SOL ဈေး – SL ရွှေ့
/tp SOL ဈေး – TP ထား (Trailing ပိတ်)
/trail SOL – Trailing stop ပြန်ဖွင့်
/close SOL – Position ပိတ်
/closeall – Position အားလုံး ပိတ်
/post စာ – Channel ကို စာပို့ (စာတစ်စောင်ကို Reply လုပ်ပြီး /post ဆိုလည်း ရ)
/pause – Trade အသစ် ရပ်
/resume – Trade အသစ် ပြန်ဝင်
/content – ဒီနေ့ Post Draft တွေ (ပုံ + စာ) · /content tip | pos | rates | crypto
/profile – ဆိုင်နာမည်၊ ဖုန်း၊ Page (Post တွေမှာ ထည့်ဖို့)
/tasks – လုပ်စရာစာရင်း
/remember စာ – Brain ထဲ မှတ်ထား (မမေ့)
/memory – မှတ်ထားတာ + Bot သင်ခန်းစာ
/forget နံပါတ် – မှတ်ထားတာ ဖျက်
/usage – ဒီနေ့ AI ကုန်ကျစရိတ်
/reset – စကားဝိုင်းအသစ် စ
/help – ဒီစာ

Start / Stop / Close / Settings ပြောင်းတာတွေက ✅ Yes ခလုတ် နှိပ်မှ လုပ်ပါတယ်။`;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmNow = () => new Date(Date.now() + 6.5 * 3600e3); // use getUTC* on this for Myanmar clock

function lockAgent() {
  const other = readJson(PID_FILE, null);
  if (other && other.pid !== process.pid) {
    try { process.kill(other.pid, 0); throw new Error(`Agent already running (pid ${other.pid})`); } catch (e) { if (e.message.startsWith('Agent')) throw e; }
  }
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, started: Date.now() }));
  process.on('exit', () => { try { if (readJson(PID_FILE, {}).pid === process.pid) fs.unlinkSync(PID_FILE); } catch { /* gone */ } });
}

export async function dailyReport() {
  const s = await botStatus();
  const yesterday = dayKey(Date.now() - 864e5);
  const hist = tradeHistory({ limit: 100 });
  const yTrades = hist.last.filter((t) => t.closed && dayKey(Date.parse(t.closed)) === yesterday);
  const yPnl = yTrades.reduce((a, t) => a + (t.pnl || 0), 0);
  const tasks = readTasks().filter((t) => !t.done);
  const lines = [`📊 zBOT နေ့စဉ် Report (${dayKey(Date.now())})`, '', statusText(s), ''];
  lines.push(`📅 မနေ့က (${yesterday}): Trade ${yTrades.length} ခု ပိတ်ခဲ့ · ${yPnl >= 0 ? 'အမြတ် +' : 'အရှုံး '}${Math.round(yPnl * 100) / 100} USDT`);
  for (const t of yTrades) lines.push(`  ${t.pnl >= 0 ? '✅' : '❌'} ${t.symbol.replace(/USDT$/, '')} ${t.side === 'long' ? 'LONG' : 'SHORT'} ${t.pnl >= 0 ? '+' : ''}${t.pnl} USDT – ${whyMm(t.exitReason).replace(/^\S+\s/, '')}`);
  lines.push(`📈 စုစုပေါင်း: Trade ${hist.summary.trades} ခု · ၁၀ ခုမှာ ${Math.round(hist.summary.winRatePct / 10)} ခုလောက် နိုင် · ${hist.summary.netPnl >= 0 ? 'အမြတ် +' : 'အရှုံး '}${hist.summary.netPnl} USDT`);
  if (tasks.length) {
    lines.push('', `📝 လုပ်စရာ (${tasks.length}):`);
    for (const t of tasks.slice(0, 8)) lines.push(`  #${t.id} ${t.text}${t.due ? ` (by ${t.due})` : ''}`);
  }
  try { lines.push('', `🧠 Bot သင်ခန်းစာ (Trade တွေကနေ):
${learnFromTrades()}`); } catch (e) { log(`agent: lessons failed ${e.message}`); }
  try { lines.push('', await faText()); } catch { /* FA sources down */ }
  return lines.join('\n');
}

function friendlyError(e) {
  const o = openaiError(e);
  if (o) return o;
  if (e instanceof Anthropic.AuthenticationError) return 'Claude API key မှားနေပါတယ် (ANTHROPIC_API_KEY ကို စစ်ပါ)။';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Claude API က ခွင့်မပြုပါ (account / key ကို စစ်ပါ)။';
  if (e instanceof Anthropic.RateLimitError) return 'Claude API limit ပြည့်နေပါတယ်။ ခဏနေမှ ပြန်မေးပါ။';
  if (e instanceof Anthropic.APIConnectionError) return 'Claude API ကို ချိတ်မရပါ (internet)။ ခဏနေ ပြန်ကြိုးစားပါ။';
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) return 'Claude API credit ကုန်နေပါတယ်။ console.anthropic.com မှာ ငွေဖြည့်ပါ။';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${String(e.message).slice(0, 300)}`;
  return `Error: ${e.message}`;
}

// Keys can be added from the dashboard. The agent restarts itself (systemd starts it again) when they change.
const KEY_NAMES = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'TINYFISH_API_KEY', 'AGENT_MODEL', 'AGENT_EFFORT'];
const keyPrint = () => KEY_NAMES.map((k) => (process.env[k] ?? '').trim()).join('\u0000');

export async function runAgent() {
  reloadEnv();
  // No bot token yet: wait quietly until one is saved (dashboard "API Keys" or .env).
  if (!(process.env.TELEGRAM_BOT_TOKEN ?? '').trim()) {
    console.log('Waiting for TELEGRAM_BOT_TOKEN (add it in the dashboard: API Keys)…');
    while (!(process.env.TELEGRAM_BOT_TOKEN ?? '').trim()) { await sleep(20e3); reloadEnv(); }
  }
  const startPrint = keyPrint();
  setInterval(() => {
    reloadEnv();
    if (keyPrint() !== startPrint) { log('agent: keys changed in .env, restarting to use them'); process.exit(0); }
  }, 20e3).unref();
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const owner = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  // Community group: read-only copies of news / listing alerts. It can never control the bot.
  const toGroup = async (kind, text) => {
    const g = (process.env.TELEGRAM_GROUP_ID ?? '').trim();
    if (!g || !String(process.env.GROUP_SHARE ?? 'trades,news,listings').toLowerCase().includes(kind)) return;
    await tg.send(g, text).catch((e) => log(`agent: group send failed ${e.message}`));
  };
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is empty in .env (create a bot with @BotFather).');
  lockAgent();

  const tg = new Telegram(token, { base: (process.env.TELEGRAM_API_BASE ?? '').trim() || undefined }); // base: for tests
  // Order: OpenRouter key, then OpenAI key, then Claude key. A value that looks wrong is treated as no key
  // (TinyFish answers instead). OpenRouter speaks the OpenAI API, so the same brain is used with its URL.
  const routerKey = (process.env.OPENROUTER_API_KEY ?? '').trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  const useRouter = routerKey.startsWith('sk-or-') || openaiKey.startsWith('sk-or-');
  const aiCommon = {
    dailyUsd: Number(process.env.AGENT_DAILY_USD ?? 2) || 0,
    priceIn: Number(process.env.OPENAI_PRICE_IN ?? 0.4) || 0,
    priceOut: Number(process.env.OPENAI_PRICE_OUT ?? 1.6) || 0,
  };
  const brain = useRouter ? new OpenAIBrain({
    ...aiCommon,
    apiKey: routerKey.startsWith('sk-or-') ? routerKey : openaiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    model: (process.env.OPENROUTER_MODEL ?? '').trim() || 'openai/gpt-4.1-mini',
    provider: 'openrouter',
  }) : openaiKey.startsWith('sk-') && !openaiKey.startsWith('sk-ant-') ? new OpenAIBrain({
    ...aiCommon,
    apiKey: openaiKey,
    model: (process.env.OPENAI_MODEL ?? '').trim() || 'gpt-4.1-mini',
  }) : apiKey.startsWith('sk-ant-') ? new Brain({
    apiKey,
    model: (process.env.AGENT_MODEL ?? '').trim() || 'claude-opus-5-5',
    effort: (process.env.AGENT_EFFORT ?? '').trim() || 'medium',
    dailyUsd: Number(process.env.AGENT_DAILY_USD ?? 2) || 0,
  }) : null;

  const me = await tg.call('getMe');
  await tg.call('deleteWebhook', {}).catch(() => {});
  log(`agent: @${me.username} started (${brain ? `AI ${brain.model}, effort ${brain.effort}, max $${brain.dailyUsd}/day` : 'no AI key: TinyFish answer mode'})` +
    (owner ? '' : ' — TELEGRAM_CHAT_ID is empty: send /start to the bot to see your chat id'));
  if (owner) await tg.send(owner, `🤖 zBOT Agent online${brain ? '' : ' (AI key မရှိသေးလို့ TinyFish နဲ့ ရှာပြီး ဖြေပါမယ်)'}. /help`).catch(() => {});

  const sendChart = async (chatId, symbol) => {
    await tg.uploading(chatId);
    try {
      const { png, data } = await chartPng(freshConfig(), symbol);
      await tg.sendPhoto(chatId, png, chartCaption(data));
    } catch (e) {
      log(`agent: chart ${symbol} failed: ${e.message}`);
      await tg.send(chatId, `Chart မရပါ (${symbol}): ${e.message}`);
    }
  };

  const sendConfirm = async (chatId, p) => tg.send(chatId, `❓ ${p.text}\nလုပ်မလား? (၁၀ မိနစ်အတွင်း နှိပ်ပါ)`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Yes', callback_data: `y:${p.id}` }, { text: '❌ No', callback_data: `n:${p.id}` }]] },
  });

  // ---- chat messages run one at a time; button taps are handled at once ----
  let queue = Promise.resolve();
  const enqueue = (fn) => { queue = queue.then(fn).catch((e) => log(`agent: ${e.message}`)); };

  async function simpleReply(chatId, text) {
    await tg.typing(chatId);
    const typing = setInterval(() => tg.typing(chatId), 4500);
    try {
      const rm = text.match(/^(remember|မှတ်ထား(ပါ|လိုက်)?)[\s:：-]+(.+)/is);
      if (rm) { const note = addNote(rm[3]); return await tg.send(chatId, `🧠 မှတ်ထားပြီ (#${note.id}): ${note.text}`); }
      const r = await simpleAnswer(text);
      if (r.kind === 'status') return await tg.send(chatId, statusText(await botStatus()));
      if (r.kind === 'analyze') return await tg.send(chatId, (await analyzeCoin(freshConfig(), r.coin.sym)).text);
      await tg.send(chatId, r.text);
    } catch (e) {
      log(`agent simple answer failed: ${e.message}`);
      await tg.send(chatId, `⚠️ ရှာလို့ မရပါ: ${e.message}`);
    } finally { clearInterval(typing); }
  }

  async function handleMessage(msg) {
    const chatId = String(msg.chat.id);
    const text = (msg.text ?? msg.caption ?? '').trim();
    if (!owner || chatId !== owner || String(msg.from?.id) !== owner) {
      // The owner can ask for a group's id by typing /groupid inside that group (answer goes to the private chat).
      if (owner && String(msg.from?.id) === owner && chatId !== owner && text.startsWith('/groupid')) {
        await tg.send(owner, `ဒီ Group ရဲ့ ID: ${chatId}\n(${msg.chat.title ?? ''})\nServer .env ထဲမှာ TELEGRAM_GROUP_ID=${chatId} ထည့်ပြီး Bot နဲ့ Agent ကို restart လုပ်ပါ။`);
        return;
      }
      // Unknown people get nothing useful. Before setup, /start tells the owner their chat id.
      if (!owner && text.startsWith('/start')) await tg.send(chatId, `Your chat id: ${chatId}\nServer ရဲ့ .env ထဲမှာ TELEGRAM_CHAT_ID=${chatId} ထည့်ပြီး agent ကို restart လုပ်ပါ။`);
      if (owner) log(`agent: ignored message from chat ${chatId}`);
      return;
    }
    if (Date.now() - msg.date * 1000 > STALE_MS) { log('agent: skipped an old message after restart'); return; }

    const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;
    switch (cmd) {
      case '/start': case '/help': return tg.send(chatId, HELP);
      case '/status': return tg.send(chatId, statusText(await botStatus()));
      case '/report': return tg.send(chatId, await dailyReport());
      case '/risk': try { return await tg.send(chatId, riskText(await accountRisk())); } catch (e) { return tg.send(chatId, `⚠️ Binance: ${e.message}`); }
      case '/ai': return tg.send(chatId, aiReviewText());
      case '/health': return tg.send(chatId, healthText());
      case '/team': try { return tg.send(chatId, teamText(await teamStatus(freshConfig()))); } catch (e) { return tg.send(chatId, `⚠️ Team: ${e.message}`); }
      case '/wallet': try { return await tg.sendPhoto(chatId, await walletCardPng(), '💳 zBOT Wallet · /status မှာ အသေးစိတ်'); } catch (e) { log(`agent: wallet card failed ${e.message}`); return tg.send(chatId, `⚠️ Card ပုံ မရပါ: ${e.message}`); }
      case '/logs': return tg.send(chatId, logsText(text.split(/\s+/).slice(1).join(' ')));
      case '/promo': {
        const sub = (text.split(/\s+/)[1] ?? '').toLowerCase();
        const g = (process.env.TELEGRAM_GROUP_ID ?? '').trim();
        try {
          if (sub === 'on') { if (!g) return tg.send(chatId, '⚠️ Channel မသတ်မှတ်ရသေးပါ (TELEGRAM_GROUP_ID)'); savePromo({ on: true }); }
          else if (sub === 'off') savePromo({ on: false });
          else if (sub === 'reset') savePromo({ next: 0, day: null });
          else if (sub === 'preview') { const p = promoPosts()[promoState().next]; if (!p) return tg.send(chatId, 'တင်စရာ မကျန်တော့ပါ (/promo reset)'); return tg.sendPhoto(chatId, promoPng(p), p.caption); }
          else if (sub === 'now') { if (!g) return tg.send(chatId, '⚠️ Channel မသတ်မှတ်ရသေးပါ'); const n = await promoPostNext(tg, g); await tg.send(chatId, n ? `✅ Post ${n}/${promoPosts().length} ကို Channel မှာ တင်ပြီးပါပြီ` : 'တင်စရာ မကျန်တော့ပါ (/promo reset)'); }
          return tg.send(chatId, promoText());
        } catch (e) { return tg.send(chatId, `⚠️ Promo: ${e.message}`); }
      }
      case '/restart': {
        const rArg = text.split(/\s+/).slice(1).join(' ');
        const which = /agent|chat/i.test(rArg) ? 'restart_agent' : /bot/i.test(rArg) ? 'restart_bot' : null;
        if (!which) return tg.send(chatId, 'ဘာကို ပြန်ဖွင့်မလဲ: /restart bot (Trading Bot) · /restart agent (ဒီ Chat Bot)');
        try { return sendConfirm(chatId, await prepareAction({ action: which })); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      }
      case '/scan': { await tg.send(chatId, '🔎 Coin ' + (process.env.SCAN_TOP ?? 20) + ' ခု စစ်နေတယ်... (၁ မိနစ်လောက်)'); try { const n = await sendOpps(chatId, true); return n ? undefined : tg.send(chatId, 'ဒီ Candle မှာ တခြား Coin တွေ Signal မရှိပါ။'); } catch (e) { return tg.send(chatId, '⚠️ Scan: ' + e.message); } }
      case '/dbs': await tg.send(chatId, '🔎 DBS Myanmar TikTok ကို စစ်နေတယ်... (၁–၂ မိနစ် ကြာနိုင်)'); try { return await tg.send(chatId, (await dbsCheck({ force: true })) ?? 'DBS Myanmar မှာ Video အသစ် မရှိသေးပါ။'); } catch (e) { log('agent: /dbs failed ' + e.message); return tg.send(chatId, /timed? ?out/i.test(e.message) ? '⚠️ TikTok စာမျက်နှာ ဖွင့်တာ အချိန်ကြာလွန်းလို့ မရလိုက်ပါ။ ခဏနေ /dbs ပြန်စမ်းပါ။ (၆ နာရီတိုင်း အလိုလိုလည်း စစ်နေပါတယ်)' : `⚠️ DBS စစ်လို့ မရပါ: ${e.message}`); }
      case '/dca': try { return await tg.send(chatId, /summary|sum|အနှစ်/i.test(text) ? await dcaSummary() : await dcaStatus()); } catch (e) { return tg.send(chatId, `⚠️ DCA: ${e.message}`); }
      case '/content': {
        const only = (text.split(/\s+/)[1] ?? '').toLowerCase();
        if (only && !['rates', 'crypto', 'tip', 'pos'].includes(only)) return tg.send(chatId, 'ဥပမာ: /content   ·   /content tip   ·   /content pos   ·   /content rates   ·   /content crypto');
        return sendDrafts(chatId, only || null);
      }
      case '/profile': {
        const rest = text.replace(/^\/profile(@\S+)?\s*/i, '');
        if (!rest) return tg.send(chatId, profileText());
        try { setProfile(rest); return tg.send(chatId, `✅ သိမ်းပြီးပါပြီ\n\n${profileText()}`); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      }
      case '/mmk': try { return await tg.send(chatId, await mmkText(text.split(/\s+/).slice(1).join(' '))); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      case '/remember': {
        const note = addNote(text.replace(/^\/remember(@\S+)?\s*/i, ''));
        return tg.send(chatId, `🧠 မှတ်ထားပြီ (#${note.id}): ${note.text}
မေ့စေချင်ရင်: /forget ${note.id}`);
      }
      case '/memory': learnFromTrades(); return tg.send(chatId, memoryText() || 'မှတ်ထားတာ မရှိသေးပါ။ /remember စာ နဲ့ မှတ်ခိုင်းပါ။');
      case '/forget': try { forgetNote(text.split(/\s+/)[1]); return tg.send(chatId, 'ဖျက်ပြီးပါပြီ။'); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      case '/listings': return tg.send(chatId, await listingsText());
      case '/news': return tg.send(chatId, await newsText());
      case '/fa': return tg.send(chatId, await faText());
      case '/analyze': case '/ta': {
        const arg = text.split(/\s+/)[1];
        if (!arg) return tg.send(chatId, 'Coin နာမည် ထည့်ပါ။ ဥပမာ: /analyze SOL');
        await tg.typing(chatId);
        try {
          const cfg = freshConfig();
          const r = await analyzeCoin(cfg, arg);
          try {
            const { png } = await chartPng({ ...cfg, interval: '4h', symbols: [...new Set([...cfg.symbols, r.symbol])] }, r.symbol);
            await tg.sendPhoto(chatId, png, `📈 ${r.symbol} · 4h`);
          } catch (e) { log(`agent: analyze chart ${r.symbol} failed: ${e.message}`); }
          await tg.send(chatId, r.text);
          try { await sendConfirm(chatId, await prepareAction({ action: 'channel_analysis', symbol: r.symbol, text: r.text })); } catch (e) { await tg.send(chatId, `(Channel: ${e.message})`); }
        } catch (e) { await tg.send(chatId, `⚠️ ${e.message}`); }
        return;
      }
      case '/long': case '/short': case '/sl': case '/tp': case '/trail': case '/close': case '/closeall': {
        const [, coin, p1, p2] = text.split(/\s+/);
        const num = (v) => (v === undefined ? undefined : Number(String(v).replace(/,/g, '')));
        const req = cmd === '/long' || cmd === '/short' ? { action: 'open_position', symbol: coin, side: cmd.slice(1), sl: num(p1), tp: num(p2) }
          : cmd === '/sl' ? { action: 'modify_position', symbol: coin, sl: num(p1) }
          : cmd === '/tp' ? { action: 'modify_position', symbol: coin, tp: num(p1) }
          : cmd === '/trail' ? { action: 'modify_position', symbol: coin, trail: true }
          : cmd === '/close' ? { action: 'close_position', symbol: coin && (coin.toUpperCase().replace(/USDT$/, '') + 'USDT') }
          : { action: 'close_all_positions' };
        if (cmd !== '/closeall' && !coin) return tg.send(chatId, `Coin ထည့်ပါ။ ဥပမာ: ${cmd} SOL${['/sl', '/tp'].includes(cmd) ? ' 75.5' : ''}`);
        if ([req.sl, req.tp].some((v) => v !== undefined && !(v > 0))) return tg.send(chatId, 'SL / TP က ဈေးနှုန်း (ဂဏန်း) ဖြစ်ရပါမယ်။ ဥပမာ: /long SOL 74 90');
        try { return sendConfirm(chatId, await prepareAction(req)); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      }
      case '/post': {
        const own = text.replace(/^\/post(@\S+)?\s*/i, '').trim();
        const body = own || (msg.reply_to_message?.text ?? msg.reply_to_message?.caption ?? '').trim();
        if (!body) return tg.send(chatId, 'ပို့မယ့်စာကို /post နောက်မှာ ရေးပါ။ ဥပမာ:\n/post ဒီနေ့ BTC ဈေး ကျနေပါတယ်...\n\n(သို့) စာတစ်စောင်ကို Reply လုပ်ပြီး /post လို့ ရိုက်ပါ။');
        try { return sendConfirm(chatId, await prepareAction({ action: 'channel_post', text: body })); } catch (e) { return tg.send(chatId, `⚠️ ${e.message}`); }
      }
      case '/chart': {
        const cfg = freshConfig();
        const arg = text.split(' ').filter(Boolean)[1];
        const list = arg ? [arg.toUpperCase().replace(/USDT$/, '') + 'USDT'] : cfg.symbols;
        for (const s of list) {
          if (!cfg.symbols.includes(s)) { await tg.send(chatId, `${s} က Bot ရဲ့ Coin မဟုတ်ပါ။ (${cfg.symbols.join(', ')})`); continue; }
          await sendChart(chatId, s);
        }
        return;
      }
      case '/pause': return tg.send(chatId, `⏸ ${pauseBot()}`);
      case '/resume':
        if (!readControl().paused) return tg.send(chatId, 'Bot က Pause မထားပါ။');
        writeControl({ paused: false });
        return tg.send(chatId, '▶️ Resumed. Trade အသစ် ပြန်ဝင်ပါမယ်။');
      case '/tasks': {
        const open = readTasks().filter((t) => !t.done);
        return tg.send(chatId, open.length ? `📝 လုပ်စရာ:\n${open.map((t) => `#${t.id} [${t.area}] ${t.text}${t.due ? ` (by ${t.due})` : ''}`).join('\n')}` : 'လုပ်စရာ မရှိသေးပါ။ "ဒီအပတ် ဘာလုပ်ရမလဲ" လို့ မေးကြည့်ပါ။');
      }
      case '/usage': {
        if (!brain) return tg.send(chatId, 'AI off (OPENAI_API_KEY မရှိ)');
        const u = brain.usage();
        return tg.send(chatId, `ဒီနေ့ AI: $${u.usd.toFixed(3)} / $${brain.dailyUsd} (${u.requests} requests, ${u.searches} searches)\nModel: ${brain.model}, effort ${brain.effort}`);
      }
      case '/reset': brain?.reset(); return tg.send(chatId, '🧹 စကားဝိုင်းအသစ် စပါပြီ (လုပ်စရာစာရင်းက မပျက်ပါ)။');
      case '/id': return tg.send(chatId, `Chat id: ${chatId}`);
      default: break;
    }
    if (cmd) return tg.send(chatId, 'မသိတဲ့ command ပါ။ /help');

    // No working Claude key (or today's AI budget is used up): answer with TinyFish + translation instead.
    if (!brain || brain.authBroken || brain.overBudget()) {
      if (msg.photo?.length && !text) return tg.send(chatId, 'ဓာတ်ပုံ ဖတ်ဖို့ AI key (OpenAI) လိုပါတယ်။ စာနဲ့ မေးပါ။');
      return simpleReply(chatId, text);
    }

    const blocks = [];
    if (msg.photo?.length) {
      try {
        const big = msg.photo.at(-1);
        const { buffer } = await tg.downloadFile(big.file_id);
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } });
      } catch (e) { return tg.send(chatId, `ပုံကို ဖတ်မရပါ: ${e.message}`); }
    }
    if (msg.voice || msg.audio || msg.video || msg.document) {
      if (!blocks.length && !text) return tg.send(chatId, 'Voice / file တွေ မဖတ်နိုင်သေးပါ။ စာ (သို့) ဓာတ်ပုံ ပို့ပါ။');
    }
    blocks.push({ type: 'text', text: text || '(photo)' });

    await tg.typing(chatId);
    const typing = setInterval(() => tg.typing(chatId), 4500);
    try {
      const { text: reply, confirmations, charts = [] } = await brain.ask(blocks);
      await tg.send(chatId, reply);
      for (const s of [...new Set(charts)]) await sendChart(chatId, s);
      for (const p of confirmations) await sendConfirm(chatId, p);
    } catch (e) {
      log(`agent AI error: ${e.message}`);
      const keyProblem = openaiKeyProblem(e) || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
        || (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message));
      if (keyProblem && text) {
        // Stop trying Claude until the key changes (the agent restarts by itself then).
        brain.authBroken = true;
        await tg.send(chatId, `⚠️ ${friendlyError(e)}
အဲဒီအထိ TinyFish နဲ့ ရှာပြီး ဖြေပေးပါမယ်။`);
        await simpleReply(chatId, text);
      } else await tg.send(chatId, `⚠️ ${friendlyError(e)}`);
    } finally {
      clearInterval(typing);
    }
  }

  // "Enter anyway" button under a skipped-signal message from the bot (state/skipped-signals.json).
  // Goes through the same Yes/No confirm and manual open as /long /short – never opens on the first tap.
  async function skippedTap(q, chatId, id) {
    await tg.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'skipped-signals.json'), 'utf8')).find((r) => r.id === id); } catch { /* none */ }
    if (!rec) return tg.send(chatId, '⚠️ ဒီ Signal ကို ရှာမတွေ့တော့ပါ။');
    if (Date.now() - rec.t > 4 * 3600e3) return tg.send(chatId, '⌛ ဒီ Signal က ၄ နာရီ ကျော်သွားပြီ – ဈေးပြောင်းသွားလို့ မဝင်တော့ပါ။ Signal အသစ် စောင့်ပါ (ဒါမှမဟုတ် /long /short)။');
    try {
      const p = await prepareAction({ action: 'open_position', symbol: rec.symbol, side: rec.side, sl: rec.sl });
      log(`agent: owner wants skipped ${rec.symbol} ${rec.side}`);
      return sendConfirm(chatId, p);
    } catch (e) {
      return tg.send(chatId, `⚠️ ဝင်လို့ မရပါ: ${e.message}`);
    }
  }

  async function handleCallback(q) {
    const chatId = String(q.message?.chat?.id ?? '');
    // Only the owner, in the private chat with the bot.
    if (!owner || chatId !== owner || String(q.from?.id) !== owner) return;
    const [kind, id] = String(q.data ?? '').split(':');
    if (kind === 'sk') return skippedTap(q, chatId, id);
    const a = takePending(id);
    const base = q.message?.text ?? '';
    const finish = async (line) => {
      await tg.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      await tg.call('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: `${base}\n\n${line}` }).catch(() => {});
    };
    if (!a) return finish('⌛ သက်တမ်းကုန်သွားပါပြီ (သို့) လုပ်ပြီးသားပါ။ ထပ်ပြောပါ။');
    if (kind !== 'y') { log(`agent: owner declined ${describeAction(a)}`); return finish('❌ မလုပ်ပါ။'); }
    try {
      const r = await executeAction(a);
      log(`agent: owner confirmed ${describeAction(a)} -> ${r}`);
      await finish(`✅ ${r}`);
    } catch (e) {
      log(`agent: action failed ${e.message}`);
      await finish(`⚠️ မအောင်မြင်ပါ: ${e.message}`);
    }
  }

  // Every day after the report: 4h chart picture + TA/FA analysis of each coin the bot trades (facts only, no buy/sell advice).
  const dailyAnalysis = async (chatId) => {
    const cfg = freshConfig();
    for (const sym of cfg.symbols) {
      try {
        const r = await analyzeCoin(cfg, sym);
        try {
          const { png } = await chartPng({ ...cfg, interval: '4h' }, r.symbol);
          await tg.sendPhoto(chatId, png, `📈 ${r.symbol} · 4h · နေ့စဉ် ခွဲခြမ်းစိတ်ဖြာချက် (${dayKey(Date.now())})`);
        } catch (e) { log(`agent: daily chart ${sym} failed ${e.message}`); }
        await tg.send(chatId, r.text);
      } catch (e) { log(`agent: daily analysis ${sym} failed ${e.message}`); }
    }
  };

  // ---- daily content drafts (7 AM): picture + caption, ready to post on Facebook / TikTok / Telegram ----
  // ---- real Binance Futures account watch (read-only): warn before liquidation / big losses ----
  let riskFails = 0;
  setInterval(async () => {
    reloadEnv();
    if (!owner || String(process.env.RISK_WATCH ?? 'on').toLowerCase() === 'off' || !(process.env.BINANCE_API_KEY ?? '').trim()) return;
    try {
      const r = await accountRisk();
      riskFails = 0;
      for (const w of riskWarnings(r)) { await tg.send(owner, w); log(`agent: risk warning sent: ${w.split('\n')[0]}`); }
    } catch (e) {
      if (++riskFails === 5) { log(`agent: risk watch failing: ${e.message}`); await tg.send(owner, `⚠️ Binance Account ကို စောင့်ကြည့်လို့ မရဖြစ်နေပါတယ်: ${e.message}`).catch(() => {}); }
    }
  }, 60e3).unref();

  // ---- paper "buy the dip" Spot test (virtual money, weekly decision, 1-week summary) ----
  const dcaRun = async () => {
    if (!owner) return;
    try { reloadEnv(); for (const m of await dcaTick()) await tg.send(owner, m); } catch (e) { log(`agent: dca paper failed ${e.message}`); }
  };
  setTimeout(dcaRun, 30e3).unref();
  setInterval(dcaRun, 10 * 60e3).unref();

  // ---- opportunity scanner: other coins, ALERTS ONLY (never opens a trade) ----
  const sendOpps = async (chatId, force = false) => {
    const cfg = freshConfig();
    const opps = await scanOpportunities(cfg, { force });
    for (const o of opps) {
      const text = opportunityText(o, cfg);
      try { const { png } = await chartPng({ ...cfg, symbols: [...cfg.symbols, o.symbol] }, o.symbol, { side: o.sig.side, entry: o.entry, sl: o.sl, tps: [['2R', o.tp2]] }); await tg.sendPhoto(chatId, png, text.slice(0, 1000)); } catch { await tg.send(chatId, text); }
    }
    if (opps.length) log('agent: ' + opps.length + ' opportunity alerts sent');
    return opps.length;
  };
  const scanRun = async () => { if (!owner) return; try { reloadEnv(); await sendOpps(owner); } catch (e) { log('agent: scan failed ' + e.message); } };
  setTimeout(scanRun, 150e3).unref();
  setInterval(scanRun, 5 * 60e3).unref();

  // ---- DBS Myanmar TikTok channel: tell the owner about new videos (checks every DBS_WATCH_HOURS, default 6) ----
  const dbsRun = async () => {
    if (!owner) return;
    try { reloadEnv(); const m = await dbsCheck(); if (m) { await tg.send(owner, m); log('agent: new DBS Myanmar videos sent'); } } catch (e) { log(`agent: dbs watch failed ${e.message}`); }
  };
  setTimeout(dbsRun, 90e3).unref();
  setInterval(dbsRun, 30 * 60e3).unref();

  // toGroupAuto: the daily run also posts the data cards (CONTENT_TO_GROUP, default "crypto") straight to the community.
  const sendDrafts = async (chatId, only = null, toGroupAuto = false) => {
    await tg.uploading(chatId);
    const { drafts, errors } = await contentDrafts(only);
    const g = (process.env.TELEGRAM_GROUP_ID ?? '').trim();
    const auto = toGroupAuto && g ? String(process.env.CONTENT_TO_GROUP ?? 'crypto').toLowerCase().split(',').map((s) => s.trim()) : [];
    const posted = [];
    for (const d of drafts.filter((x) => auto.includes(x.kind))) {
      try { await tg.sendPhoto(g, d.png, d.caption); posted.push(d.kind); } catch (e) { log(`agent: group ${d.kind} post failed ${e.message}`); }
    }
    if (posted.length) log(`agent: daily ${posted.join(', ')} card posted to group`);
    if (!only) await tg.send(chatId, `🎨 ဒီနေ့ Post Draft ${drafts.length} ခု – ပုံကို Save ပြီး စာကို Copy ကူးပြီး Facebook / TikTok / Channel မှာ တင်ပါ။${posted.length ? `\n✅ ${posted.join(', ')} ကို Group ထဲ Auto ပို့ပြီးပါပြီ။` : ''}${readProfileEmpty() ? '\n(ဆိုင်နာမည်၊ ဖုန်း ထည့်ချင်ရင် /profile)' : ''}`);
    for (const d of drafts) await tg.sendPhoto(chatId, d.png, d.caption).catch((e) => log(`agent: draft ${d.kind} failed ${e.message}`));
    if (errors.length) { log(`agent: content drafts: ${errors.join('; ')}`); await tg.send(chatId, `⚠️ မရလိုက်တာ: ${errors.join(', ')}`); }
  };
  const readProfileEmpty = () => { try { return !Object.keys(JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'content-profile.json'), 'utf8'))).length; } catch { return true; } };
  setInterval(async () => {
    if (!owner) return;
    const now = mmNow(), today = now.toISOString().slice(0, 10);
    const st = readJson(CONTENT_FILE, {});
    if (now.getUTCHours() !== CONTENT_HOUR || st.day === today) return;
    fs.writeFileSync(CONTENT_FILE, JSON.stringify({ day: today }));
    try { reloadEnv(); await sendDrafts(owner, null, true); } catch (e) { log(`agent: daily content failed ${e.message}`); }
  }, 60e3).unref();

  // ---- community promo series: 1 picture/day to the channel (only after /promo on) ----
  setInterval(async () => {
    if (!owner) return;
    try {
      reloadEnv();
      const g = (process.env.TELEGRAM_GROUP_ID ?? '').trim();
      if (!g || !promoDue()) return;
      const n = await promoPostNext(tg, g);
      if (n) { log(`agent: promo post ${n} sent to channel`); await tg.send(owner, `📣 Promo Post ${n}/${promoPosts().length} ကို Channel မှာ တင်ပြီးပါပြီ${n >= promoPosts().length ? ' – Series ပြီးပါပြီ ✅' : ''}`); }
    } catch (e) { savePromo({ day: mmNow().toISOString().slice(0, 10) }); log(`agent: promo failed ${e.message}`); await tg.send(owner, `⚠️ Promo တင်လို့ မရပါ: ${e.message}`).catch(() => {}); }
  }, 60e3).unref();

  // ---- daily report ----
  setInterval(async () => {
    if (!owner) return;
    const now = mmNow();
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== REPORT_HOUR || readJson(REPORT_FILE, {}).day === today) return;
    fs.writeFileSync(REPORT_FILE, JSON.stringify({ day: today }));
    try { await tg.send(owner, await dailyReport()); } catch (e) { log(`agent: daily report failed ${e.message}`); }
    await dailyAnalysis(owner);
  }, 60e3).unref();

  // ---- new coin alerts (tells the owner, never buys) ----
  const watchListings = async () => {
    reloadEnv();
    if (!owner || String(process.env.LISTING_ALERTS ?? 'true').trim().toLowerCase() === 'false') return;
    try {
      const msgs = await checkListings();
      if (msgs.error) log(`agent: listing check ${msgs.error}`);
      for (const [i, m] of msgs.entries()) { await tg.send(owner, m); if (!msgs.ownerOnly?.has(i)) await toGroup('listings', m); }
      if (msgs.length) log(`agent: ${msgs.length} new listing alert(s) sent`);
    } catch (e) { log(`agent: listing check failed ${e.message}`); }
  };
  setTimeout(watchListings, 15e3).unref();

  // Every news post goes out with a picture: the article's own picture, or else a 4h chart of the coin it is about.
  const newsPost = async (chatId, c) => {
    if (c.photo) {
      try { return await tg.call('sendPhoto', { chat_id: chatId, photo: c.photo, caption: c.text.slice(0, 1024) }, 40000); }
      catch (e) { log(`agent: news picture failed (${e.message}), using chart`); }
    }
    const t = c.text;
    const sym = /\b(eth|ether|ethereum)\b|အီသာ/i.test(t) ? 'ETHUSDT' : /\b(sol|solana)\b|ဆိုလာနာ/i.test(t) ? 'SOLUSDT'
      : /\bbnb\b/i.test(t) ? 'BNBUSDT' : /\b(xrp|ripple)\b/i.test(t) ? 'XRPUSDT' : 'BTCUSDT';
    try {
      const cfg = freshConfig();
      const { png } = await chartPng({ ...cfg, interval: '4h', symbols: [...new Set([...cfg.symbols, sym])] }, sym);
      return await tg.sendPhoto(chatId, png, t);
    } catch (e) { log(`agent: news chart failed ${e.message}`); }
    return tg.send(chatId, t);
  };

  // ---- FA news: headlines, US event reminders, Fear & Greed zone changes (informs only) ----
  const watchNews = async () => {
    reloadEnv();
    const mode = String(process.env.NEWS_ALERTS ?? 'important').trim().toLowerCase();
    if (!owner || mode === 'off' || mode === 'false') return;
    try {
      const msgs = await checkNews({ all: mode === 'all' });
      if (msgs.error) log(`agent: news check ${msgs.error}`);
      for (const m of msgs) await tg.send(owner, m);
      const g = (process.env.TELEGRAM_GROUP_ID ?? '').trim();
      const toChannel = g && String(process.env.GROUP_SHARE ?? 'trades,news,listings').toLowerCase().includes('news');
      // regular news: to the owner only, ready to forward to the community by hand (urgent too when there is no channel)
      for (const c of [...(msgs.owner ?? []), ...(toChannel ? [] : (msgs.channel ?? []).filter((x) => x.more !== undefined))]) {
        await newsPost(owner, c).catch((e) => log(`agent: owner news failed ${e.message}`));
        if (c.more) await tg.send(owner, c.more).catch((e) => log(`agent: owner full news failed ${e.message}`));
      }
      if (msgs.owner?.length) log(`agent: ${msgs.owner.length} regular news post(s) to owner`);
      if (toChannel) {
        for (const c of msgs.channel ?? []) {
          await newsPost(g, c).catch((e) => log(`agent: channel news failed ${e.message}`));
          if (c.more) await tg.send(g, c.more).catch((e) => log(`agent: channel full news failed ${e.message}`));
        }
        if (msgs.channel?.length) log(`agent: ${msgs.channel.length} news post(s) to channel`);
      }
    } catch (e) { log(`agent: news check failed ${e.message}`); }
  };
  setTimeout(watchNews, 30e3).unref();
  setInterval(watchNews, 15 * 60e3).unref();
  setInterval(watchListings, 5 * 60e3).unref();

  // ---- long polling ----
  let offset = readJson(OFFSET_FILE, {}).offset;
  let wait = 2000;
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset, 50);
      wait = 2000;
      for (const u of updates) {
        offset = u.update_id + 1;
        fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }));
        if (u.callback_query) handleCallback(u.callback_query).catch((e) => log(`agent callback: ${e.message}`));
        else if (u.message) enqueue(() => handleMessage(u.message));
        // A channel post has no sender; only channel admins can post, so just tell the owner the id.
        else if (u.channel_post && owner && (u.channel_post.text ?? '').startsWith('/groupid')) {
          const c = u.channel_post.chat;
          tg.send(owner, `ဒီ Channel ရဲ့ ID: ${c.id}\n(${c.title ?? ''})\nServer .env ထဲမှာ TELEGRAM_GROUP_ID=${c.id} ထည့်ပြီး Bot နဲ့ Agent ကို restart လုပ်ပါ။`).catch(() => {});
        }
      }
    } catch (e) {
      if (e.code === 409) log('agent: another program is reading this Telegram bot (is the agent running on two computers?)');
      else if (e.code === 401) throw new Error('TELEGRAM_BOT_TOKEN is wrong (Telegram said 401).');
      else log(`agent: telegram ${e.network ? 'network' : 'error'}: ${e.message}`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }
}
