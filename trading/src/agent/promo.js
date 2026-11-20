// Community promo series: one ready-made picture + caption (promo/posts.json) to the Telegram channel
// per day at PROMO_HOUR (Myanmar time). Off until the owner turns it on with /promo on.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE_DIR } from '../config.js';

const DIR = path.join(ROOT, 'promo');
const FILE = path.join(STATE_DIR, 'promo.json');
const mmNow = () => new Date(Date.now() + 6.5 * 3600e3);
const hour = () => Number(process.env.PROMO_HOUR ?? 19);

export const promoPosts = () => JSON.parse(fs.readFileSync(path.join(DIR, 'posts.json'), 'utf8'));
export const promoState = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { on: false, next: 0 }; } };
export const savePromo = (s) => fs.writeFileSync(FILE, JSON.stringify({ ...promoState(), ...s }));
export const promoPng = (p) => fs.readFileSync(path.join(DIR, p.file));

export function promoText() {
  const s = promoState(), n = promoPosts().length;
  const st = s.next >= n ? '✅ အကုန် တင်ပြီးပါပြီ' : s.on ? `▶️ ဖွင့်ထား – နေ့တိုင်း ည ${hour()}:00 မှာ Post ${s.next + 1}/${n} တင်မယ်` : '⏸ ပိတ်ထား';
  return `📣 ZBOT Promo (Channel ကို နေ့တိုင်း ပုံ ၁ ပုံ)\n${st}\nတင်ပြီး: ${Math.min(s.next, n)}/${n}${s.day ? ` (နောက်ဆုံး ${s.day})` : ''}\n\n/promo on – စမယ်\n/promo off – ရပ်မယ်\n/promo now – နောက်တစ်ပုံ အခုချက်ချင်း တင်\n/promo preview – နောက်တစ်ပုံကို ကိုယ့်ဆီ အရင်ပို့ကြည့်\n/promo reset – ၁ ကနေ ပြန်စ`;
}

// Posts the next item to `group`. Returns the posted index (1-based) or null when finished.
export async function promoPostNext(tg, group) {
  const posts = promoPosts(), s = promoState();
  if (s.next >= posts.length) return null;
  const p = posts[s.next];
  await tg.sendPhoto(group, promoPng(p), p.caption);
  const next = s.next + 1;
  savePromo({ next, day: mmNow().toISOString().slice(0, 10), ...(next >= posts.length ? { on: false } : {}) });
  return next;
}

// Called every minute: true when today's slot is due.
export function promoDue() {
  const s = promoState(), now = mmNow();
  return s.on && s.next < promoPosts().length && now.getUTCHours() === hour() && s.day !== now.toISOString().slice(0, 10);
}
