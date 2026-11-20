// 6-post series: Gemini images (marketing/src) + Burmese text panel, rendered 1080x1350 (4:5 feed) with Edge.
// Run: node marketing/series.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out', 'series');
fs.mkdirSync(OUT, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 1080, H = 1350;

const posts = [
  ['hero.png', 'Crypto Bot Signal ကို <em>မြန်မာလို</em> ရှင်းပြပေးတယ်', 'ဝင်ဈေး · Stop-loss · ပစ်မှတ် · Chart ပုံ – Telegram မှာ အခမဲ့ ကြည့်ပါ'],
  ['mascot.webp', 'ZBOT က Chart ကို <em>၂၄ နာရီ</em> စောင့်ကြည့်တယ်', 'Candle ပိတ်တိုင်း Coin တွေကို စစ်ပြီး Trade ဝင်ရင် ချက်ချင်း အကြောင်းကြားတယ်'],
  ['team.png', 'Bot က ဘယ်လို ဆုံးဖြတ်လဲ – <em>အကုန် မြင်ရတယ်</em>', 'ဝင်မယ်၊ ထွက်မယ်၊ Risk ထိန်းမယ်၊ AI ထပ်စစ်မယ် – အပိုင်း ၇ ခုရဲ့ အခြေအနေ အစစ်'],
  ['fng.png', 'ဈေးကွက် စိတ်ဓာတ် – <em>နေ့တိုင်း</em>', 'ကြောက်နေလား၊ လောဘ တက်နေလား – Fear & Greed ကို မြန်မာလို ပြောပြတယ်'],
  ['newcoin.png', 'Coin အသစ် ဝင်ရင် <em>ချက်ချင်း</em> သိရမယ်', 'Binance ကြေညာချက်တွေကို Telegram ဆီ တိုက်ရိုက် ပို့ပေးတယ်'],
  ['community.webp', 'မြန်မာ Trader တွေ <em>အတူတူ</em> လေ့လာမယ်', 'နိုင်တာရော ရှုံးတာရော ပွင့်ပွင့်လင်းလင်း ပြတဲ့ Community'],
];

const page = (img, h1, sub, n) => `<!doctype html><html lang="my"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800&family=Noto+Sans+Myanmar:wght@400;600;800&display=block" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0b0e11; color: #eaecef; }
img { display: block; width: ${W}px; height: ${W}px; object-fit: cover; }
.panel { position: relative; height: ${H - W}px; padding: 26px 56px 22px; display: flex; flex-direction: column;
  font-family: "Noto Sans Myanmar", Inter, sans-serif; background: linear-gradient(180deg, #111418, #0b0e11); }
.panel::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: linear-gradient(90deg, transparent, #fcd535, transparent); }
h1 { font-size: 46px; font-weight: 800; line-height: 1.55; }
em { font-style: normal; color: #fcd535; }
p { font-size: 26px; line-height: 1.6; color: #b7bdc6; margin-top: 8px; }
.foot { margin-top: auto; display: flex; justify-content: space-between; align-items: center; font-size: 18px; color: #848e9c; }
.n { font: 700 18px Inter, sans-serif; color: #fcd535; letter-spacing: 1px; }
</style></head><body>
<img src="${pathToFileURL(path.join(DIR, 'src', img)).href}">
<div class="panel"><h1>${h1}</h1><p>${sub}</p>
<div class="foot"><span>🧪 ငွေအတုနဲ့ စမ်းနေဆဲ · ငွေကြေး အကြံပေးချက် မဟုတ်ပါ</span><span class="n">t.me/zbottrader · ${n}/${posts.length}</span></div></div>
</body></html>`;

posts.forEach(([img, h1, sub], i) => {
  const name = `zbot-post-${i + 1}-${img.split('.')[0]}`;
  const html = path.join(OUT, `${name}.html`);
  fs.writeFileSync(html, page(img, h1, sub, i + 1));
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`,
    '--virtual-time-budget=8000', `--screenshot=${path.join(OUT, `${name}.png`)}`, pathToFileURL(html).href], { stdio: 'ignore' });
  console.log(name);
});
