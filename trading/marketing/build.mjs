// Builds the ZBOT community posters (HTML) and renders them to PNG with Edge headless
// (Edge shapes Burmese text correctly; resvg does not). Run: node marketing/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOGO = fs.readFileSync(path.join(DIR, 'logo.svg.txt'), 'utf8').trim();
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LINK = 't.me/zbottrader';

const base = (w, h, body, extra = '') => `<!doctype html><html lang="my"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&family=Noto+Sans+Myanmar:wght@400;600;700;800&display=block" rel="stylesheet">
<style>
:root { --bg:#0b0e11; --s1:#181a20; --s2:#1e2329; --line:#2b3139; --t:#eaecef; --t2:#b7bdc6; --mu:#848e9c; --gold:#fcd535; --up:#0ecb81; --dn:#f6465d; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: var(--bg); }
body { font-family: Inter, "Noto Sans Myanmar", "Myanmar Text", sans-serif; color: var(--t); position: relative; -webkit-font-smoothing: antialiased; }
.mm { font-family: "Noto Sans Myanmar", "Myanmar Text", Inter, sans-serif; line-height: 1.75; }
.glow { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(60% 45% at 85% 0%, rgba(252,213,53,.22), transparent 70%), radial-gradient(50% 40% at 0% 100%, rgba(14,203,129,.14), transparent 70%); }
.grid { position: absolute; inset: 0; opacity: .5; pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
  background-size: 54px 54px; mask-image: radial-gradient(80% 70% at 50% 40%, #000, transparent); }
.brand { display: flex; align-items: center; gap: 18px; }
.brand svg { width: 78px; height: 86px; flex: none; }
.brand b { font: 900 54px/1 Inter, sans-serif; letter-spacing: -1px; }
.brand small { display: block; font: 600 20px/1.2 Inter, sans-serif; color: var(--mu); letter-spacing: 3px; margin-top: 6px; }
.pill { display: inline-flex; align-items: center; gap: 10px; border-radius: 999px; padding: 10px 22px; font-weight: 700; }
.free { background: var(--gold); color: #181a20; font: 800 24px/1 Inter, "Noto Sans Myanmar", sans-serif; padding: 14px 26px; }
.cta { display: flex; align-items: center; justify-content: space-between; gap: 20px; background: var(--gold); color: #181a20; border-radius: 26px; padding: 26px 34px; }
.cta .l { font: 700 26px/1.4 "Noto Sans Myanmar", sans-serif; }
.cta .r { font: 900 40px/1 Inter, sans-serif; letter-spacing: -.5px; }
.foot { color: var(--mu); font-size: 19px; }
${extra}
</style></head><body><div class="glow"></div><div class="grid"></div>${body}</body></html>`;

const brand = (sub = 'CRYPTO TRADING BOT') => `<div class="brand">${LOGO}<div><b>ZBOT</b><small>${sub}</small></div></div>`;

// ---------- 1. square: what the channel gives ----------
const feats = [
  ['📈', 'Bot Signal', 'ဝင်ဈေး · Stop-loss · ပစ်မှတ်'],
  ['🖼️', 'Chart ပုံ', 'ဘာကြောင့် ဝင်လဲ ပုံနဲ့ ရှင်းပြ'],
  ['📰', 'Crypto သတင်း', 'အရေးကြီးတာ မြန်မာလို'],
  ['😨', 'Fear & Greed', 'ဈေးကွက် စိတ်ဓာတ် နေ့စဉ်'],
  ['🆕', 'Coin အသစ်', 'Binance ကြေညာချက် ချက်ချင်း'],
  ['🧾', 'ပွင့်လင်းမှု', 'နိုင်တာရော ရှုံးတာရော အကုန်ပြ'],
];
const p1 = base(1080, 1080, `
<div style="position:absolute;inset:64px 64px 56px;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">${brand()}<span class="pill free mm">အခမဲ့ ✓</span></div>
  <h1 class="mm" style="font-size:54px;font-weight:800;line-height:1.5;margin-top:44px">Crypto Bot Signal တွေကို<br><span style="color:var(--gold)">မြန်မာလို</span> တိုက်ရိုက် ကြည့်ပါ</h1>
  <p class="mm" style="color:var(--t2);font-size:25px;margin-top:10px">Bot က ဘာကြောင့် ဝင်လဲ၊ ဘယ်မှာ ထွက်လဲ – အကုန် ရှင်းပြပေးတဲ့ Telegram Channel</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:34px">
    ${feats.map(([i, a, b]) => `<div style="display:flex;gap:16px;align-items:center;background:rgba(30,35,41,.85);border:1px solid var(--line);border-radius:20px;padding:18px 20px">
      <div style="font-size:38px;width:52px;text-align:center">${i}</div><div class="mm"><div style="font-weight:700;font-size:25px;line-height:1.5">${a}</div><div style="color:var(--mu);font-size:19px;line-height:1.5">${b}</div></div></div>`).join('')}
  </div>
  <div style="flex:1"></div>
  <div class="cta"><span class="l mm">Join လုပ်ရန် 👉</span><span class="r">${LINK}</span></div>
  <p class="foot mm" style="margin-top:16px;text-align:center">ငွေကြေး အကြံပေးချက် မဟုတ်ပါ · Bot လည်း မှားနိုင်ပါတယ် · ဆုံးရှုံးခံနိုင်တဲ့ ငွေနဲ့ပဲ ကိုယ်တိုင် ဆုံးဖြတ်ပါ</p>
</div>`);

// ---------- 2. story: how the bot decides (team) ----------
const team = [
  ['🎯', 'Entry', 'Candle ပိတ်တိုင်း Coin တွေကို စစ်ပြီး ဝင်မလား ဆုံးဖြတ်'],
  ['🚪', 'Exit', 'အမြတ်ရလာရင် Stop-loss ကို နောက်က လိုက်ရွှေ့'],
  ['🛡️', 'Risk', 'Trade တစ်ခု ရှုံးရင် ငွေနည်းနည်းပဲ ရှုံးအောင် ကန့်သတ်'],
  ['🤖', 'AI check', 'အားနည်းတဲ့ Signal ကို AI က ထပ်စစ်'],
  ['📰', 'News', 'Fear & Greed နဲ့ သတင်း စောင့်ကြည့်'],
  ['🌐', 'Macro', 'US သတင်းပွဲ (CPI, Fed) ကြို သတိပေး'],
  ['🔎', 'Scanner', 'တခြား Coin တွေမှာ အခွင့်အရေး ရှာ'],
];
const p2 = base(1080, 1920, `
<div style="position:absolute;inset:90px 70px 70px;display:flex;flex-direction:column">
  ${brand()}
  <h1 class="mm" style="font-size:62px;font-weight:800;line-height:1.45;margin-top:40px">Bot က ဘယ်လို<br>ဆုံးဖြတ်လဲ –<br><span style="color:var(--gold)">အကုန် မြင်ရတယ်</span></h1>
  <p class="mm" style="color:var(--t2);font-size:28px;margin-top:18px">ဟန်ဆောင် Animation မဟုတ်ပါ။ Bot ရဲ့ အပိုင်း ၇ ခု အခု တကယ် ဘာလုပ်နေလဲ ပြပါတယ်။</p>
  <div style="display:flex;flex-direction:column;gap:14px;margin-top:36px">
    ${team.map(([i, a, b], k) => `<div style="display:flex;gap:22px;align-items:center;background:rgba(30,35,41,.88);border:1px solid var(--line);border-left:6px solid ${k === 2 ? 'var(--gold)' : 'var(--up)'};border-radius:22px;padding:15px 26px">
      <div style="font-size:44px;width:60px;text-align:center">${i}</div>
      <div class="mm" style="flex:1"><div style="font:800 30px/1.3 Inter,sans-serif">${a}</div><div style="color:var(--t2);font-size:23px;line-height:1.6">${b}</div></div>
      <div style="width:16px;height:16px;border-radius:50%;background:var(--up);box-shadow:0 0 0 8px rgba(14,203,129,.15)"></div></div>`).join('')}
  </div>
  <div class="mm" style="margin-top:28px;background:rgba(252,213,53,.1);border:1px solid rgba(252,213,53,.35);border-radius:20px;padding:20px 26px;font-size:24px;color:var(--t2)">
    🧪 အခု <b style="color:var(--gold)">Paper (ငွေအတု)</b> နဲ့ စမ်းနေဆဲပါ – ရလဒ် အစစ်အမှန်ကို Channel မှာ တိုက်ရိုက် ပြပါတယ်</div>
  <div style="flex:1"></div>
  <div class="cta"><span class="l mm">Join 👉</span><span class="r">${LINK}</span></div>
  <p class="foot mm" style="margin-top:18px;text-align:center;font-size:21px">ငွေကြေး အကြံပေးချက် မဟုတ်ပါ · Bot လည်း မှားနိုင်ပါတယ်</p>
</div>`);

// ---------- 3. square: real paper trade record (wins AND losses) ----------
const trades = [
  ['PAXG', 'short', 3836.51, 3726.19, 10.65, 'ကိုယ်တိုင်ပိတ်'],
  ['ETH', 'short', 1821.33, 1795.97, 1.84, 'ကိုယ်တိုင်ပိတ်'],
  ['BTC', 'short', 64354, 63406, 3.54, 'ကိုယ်တိုင်ပိတ်'],
  ['BTC', 'long', 65738.5, 65135.4, -5.35, 'Stop-loss'],
  ['SOL', 'long', 73.99, 73.21, -6.02, 'Stop-loss'],
  ['SOL', 'long', 75.25, 75.48, 2.33, 'ကိုယ်တိုင်ပိတ်'],
  ['SOL', 'short', 79.68, 75.24, 48.29, 'ကိုယ်တိုင်ပိတ်'],
];
const fmtP = (v) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(v));
const p3 = base(1080, 1080, `
<div style="position:absolute;inset:64px 64px 56px;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">${brand('PAPER TRADE RECORD')}<span class="pill mm" style="background:rgba(252,213,53,.12);color:var(--gold);border:1px solid rgba(252,213,53,.4);font-size:21px">🧪 ငွေအတု</span></div>
  <h1 class="mm" style="font-size:48px;font-weight:800;line-height:1.45;margin-top:22px">နိုင်တာရော <span style="color:var(--dn)">ရှုံးတာရော</span><br>ဖုံးမထားပါ</h1>
  <p class="mm" style="color:var(--t2);font-size:23px;margin-top:6px">Bot ရဲ့ နောက်ဆုံး Trade ၇ ခု (Nov 13–19, 2026) – Screenshot ရွေးပြတာ မဟုတ်ပါ</p>
  <div style="margin-top:18px;background:rgba(24,26,32,.92);border:1px solid var(--line);border-radius:24px;padding:4px 28px">
    ${trades.map(([c, s, e, x, p, w]) => `<div style="display:grid;grid-template-columns:120px 120px 1fr 150px;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
      <b style="font:800 27px Inter">${c}</b>
      <span style="font:700 18px Inter;padding:6px 0;text-align:center;border-radius:8px;background:${s === 'long' ? 'rgba(14,203,129,.15)' : 'rgba(246,70,93,.15)'};color:${s === 'long' ? 'var(--up)' : 'var(--dn)'}">${s.toUpperCase()}</span>
      <span class="mm" style="color:var(--mu);font-size:19px;line-height:1.4">${fmtP(e)} → ${fmtP(x)}<br>${w}</span>
      <b style="font:800 28px Inter;text-align:right;color:${p >= 0 ? 'var(--up)' : 'var(--dn)'}">${p >= 0 ? '+' : '−'}$${Math.abs(p).toFixed(2)}</b></div>`).join('').replace(/border-bottom:1px solid var\(--line\)">(?![\s\S]*border-bottom)/, '">')}
  </div>
  <div style="flex:1"></div>
  <div class="cta"><span class="l mm">နေ့တိုင်း Update 👉</span><span class="r">${LINK}</span></div>
  <p class="foot mm" style="margin-top:14px;text-align:center">ငွေအတု စမ်းသပ်မှု – အနာဂတ် အမြတ်ကို အာမ မခံပါ · ငွေကြေး အကြံပေးချက် မဟုတ်ပါ</p>
</div>`);

const posters = [['zbot-1-channel-1080x1080', 1080, 1080, p1], ['zbot-2-story-1080x1920', 1080, 1920, p2], ['zbot-3-record-1080x1080', 1080, 1080, p3]];
for (const [name, w, h, html] of posters) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html);
  const png = path.join(OUT, `${name}.png`);
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`,
    '--virtual-time-budget=8000', `--screenshot=${png}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log(name, fs.existsSync(png) ? `${(fs.statSync(png).size / 1024).toFixed(0)} KB` : 'FAILED');
}
