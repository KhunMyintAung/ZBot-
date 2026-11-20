import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';
import { botTag } from './plain.js';

fs.mkdirSync(STATE_DIR, { recursive: true });
const logFile = path.join(STATE_DIR, 'bot.log');
const journalFile = path.join(STATE_DIR, 'journal.csv');

export function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

export async function telegram(cfg, text) {
  if (!cfg.telegramToken || !cfg.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramChatId, text: `${botTag(cfg)}\n\n${text}` }),
    });
  } catch (e) {
    log('telegram failed:', e.message);
  }
}

// Owner message with inline buttons (taps are handled by the Telegram agent, same bot token).
export async function alertButtons(cfg, text, keyboard) {
  log(text.split('\n')[0]);
  if (!cfg.telegramToken || !cfg.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramChatId, text: `${botTag(cfg)}\n\n${text}`, reply_markup: { inline_keyboard: keyboard } }),
    });
  } catch (e) {
    log('telegram failed:', e.message);
  }
}

// Community signal (no account size, no qty). Only OPEN and CLOSE, only when TELEGRAM_GROUP_ID is set.
export async function groupSignal(cfg, text) {
  if (!cfg.telegramToken || !cfg.telegramGroupId || !cfg.groupShare.includes('trades')) return;
  const tag = cfg.mode === 'live' ? '' : '🧪 စမ်းသပ် (Paper) Trade · ငွေအစစ် မဟုတ်\n';
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramGroupId, disable_web_page_preview: true,
        text: `${tag}${text}\n\n⚠️ ငွေရေးကြေးရေး အကြံပြုချက် မဟုတ်ပါ။ Bot လည်း မှားနိုင်ပါတယ်။ ဆုံးရှုံးခံနိုင်တဲ့ ငွေနဲ့ပဲ ကိုယ်တိုင် ဆုံးဖြတ်ပါ။` }),
    });
  } catch (e) {
    log('group telegram failed:', e.message);
  }
}

// Photo + caption to the community channel (caption max 1024 characters).
export async function groupPhoto(cfg, png, caption) {
  if (!cfg.telegramToken || !cfg.telegramGroupId || !cfg.groupShare.includes('trades')) return false;
  return photoTo(cfg, cfg.telegramGroupId, png, caption);
}

// Photo + caption to the owner (alerts like OPEN). Falls back to text when it fails.
export async function alertPhoto(cfg, png, text) {
  log(text);
  if (!cfg.telegramToken || !cfg.telegramChatId) return;
  const cap = `${botTag(cfg)}\n\n${text}`;
  if (!png || !(await photoTo(cfg, cfg.telegramChatId, png, cap))) await telegram(cfg, text);
}

async function photoTo(cfg, chatId, png, caption) {
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append('photo', new Blob([png], { type: 'image/png' }), 'signal.png');
    const r = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendPhoto`, { method: 'POST', body: form });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description);
    return true;
  } catch (e) {
    log('group photo failed:', e.message);
    return false;
  }
}

export async function alert(cfg, text) {
  log(text);
  await telegram(cfg, text);
}

const HEADER = 'opened,closed,mode,market,symbol,strategy,side,entry,exit,qty,sl,tp,pnl_usdt,R,exit_reason,entry_reason\n';
export function journal(cfg, t) {
  if (!fs.existsSync(journalFile)) fs.writeFileSync(journalFile, HEADER);
  const row = [
    new Date(t.entryT).toISOString(), new Date().toISOString(), cfg.mode, cfg.market, cfg.symbol, cfg.strategy,
    t.side, t.entry, t.exit ?? '', t.qty, t.sl, t.tp, t.pnl?.toFixed(4) ?? '', t.R?.toFixed(2) ?? '', t.why ?? '',
    `"${(t.reason ?? '').replace(/"/g, "'")}"`,
  ];
  fs.appendFileSync(journalFile, row.join(',') + '\n');
}
