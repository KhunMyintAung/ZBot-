import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.js';

// Watches the owner's REAL Binance Futures account (trades made by hand in the Binance app, USDT and USDC)
// and warns on Telegram before it is too late. READ-ONLY: this file can only send GET requests to two fixed
// account endpoints. It never places, changes or closes orders; that stays with the owner.
//
// Warnings (each repeats at most every 15 minutes, sooner when it gets worse):
//  • a position's price is close to its liquidation price (RISK_LIQ_WARN_PCT, default 10%; "danger" at half of it)
//  • unrealized loss is a big part of the wallet (RISK_LOSS_WARN_PCT, default 20%)
//  • account margin ratio is high (maintenance margin / margin balance >= 50%, danger >= 80%)

const BASE = 'https://fapi.binance.com';
const READ_ONLY = new Set(['/fapi/v2/account', '/fapi/v2/positionRisk']);
const STATE_FILE = path.join(STATE_DIR, 'risk-alerts.json');
const REPEAT_MS = 15 * 60e3;

async function get(p) {
  if (!READ_ONLY.has(p)) throw new Error('not allowed');
  const key = (process.env.BINANCE_API_KEY ?? '').trim(), secret = (process.env.BINANCE_API_SECRET ?? '').trim();
  if (!key || !secret) throw new Error('BINANCE_API_KEY / SECRET မရှိပါ');
  const qs = `recvWindow=10000&timestamp=${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
  const r = await fetch(`${BASE}${p}?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg ?? `HTTP ${r.status}`);
  return j;
}

const num = (v) => Number(v) || 0;
const f2 = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (+v.toFixed(2)).toString());
const px = (v) => (v >= 100 ? (+v.toFixed(2)).toString() : (+v.toPrecision(5)).toString());

// Current state of the real account: wallet, margin ratio and every open position with its distance to liquidation.
export async function accountRisk() {
  const [acc, pos] = await Promise.all([get('/fapi/v2/account'), get('/fapi/v2/positionRisk')]);
  const wallet = num(acc.totalWalletBalance), upnl = num(acc.totalUnrealizedProfit), marginBal = num(acc.totalMarginBalance);
  const maint = num(acc.totalMaintMargin);
  const positions = pos.filter((p) => num(p.positionAmt) !== 0).map((p) => {
    const amt = num(p.positionAmt), mark = num(p.markPrice), liq = num(p.liquidationPrice);
    const side = amt > 0 ? 'LONG' : 'SHORT';
    // how far price must move (in %) to hit liquidation; null when the exchange gives no liquidation price
    const toLiq = liq > 0 && mark > 0 ? (side === 'LONG' ? (mark - liq) / mark : (liq - mark) / mark) * 100 : null;
    return { symbol: p.symbol, side, amt: Math.abs(amt), entry: num(p.entryPrice), mark, liq, toLiq, upnl: num(p.unRealizedProfit), lev: num(p.leverage), margin: p.marginType };
  });
  return { wallet, upnl, marginBal, marginRatio: marginBal > 0 ? (maint / marginBal) * 100 : 0, positions };
}

export function riskText(r) {
  if (!r.positions.length) return `🛡 Binance Futures (အစစ်)\nWallet: ${f2(r.wallet)} · ဖွင့်ထားတဲ့ Position မရှိပါ။`;
  const lines = [`🛡 Binance Futures (အစစ်)`, `Wallet ${f2(r.wallet)} · မပိတ်ရသေးတဲ့ PnL ${r.upnl >= 0 ? '+' : ''}${f2(r.upnl)} · Margin Ratio ${r.marginRatio.toFixed(1)}%`, ''];
  for (const p of r.positions) {
    lines.push(`${p.side === 'LONG' ? '🟢' : '🔴'} ${p.symbol} ${p.side} ${p.lev}x (${p.margin})`,
      `   Entry ${px(p.entry)} · အခု ${px(p.mark)} · PnL ${p.upnl >= 0 ? '+' : ''}${f2(p.upnl)}`,
      `   Liquidation ${p.liq ? px(p.liq) : '-'}${p.toLiq !== null ? ` (ဈေး ${p.toLiq.toFixed(1)}% ထပ်ရွေ့ရင် Liquidate)` : ''}`);
  }
  return lines.join('\n');
}

// Returns the warnings to send now (empty when all is fine or already warned recently).
export function riskWarnings(r, now = Date.now()) {
  const liqWarn = Number(process.env.RISK_LIQ_WARN_PCT) || 10;
  const lossWarn = Number(process.env.RISK_LOSS_WARN_PCT) || 20;
  const st = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
  const out = [];
  const fire = (id, level, text) => {
    const prev = st[id];
    if (prev && prev.level >= level && now - prev.at < REPEAT_MS) return; // same or lower level, warned recently
    st[id] = { level, at: now };
    out.push(text);
  };
  const open = new Set();
  for (const p of r.positions) {
    open.add(p.symbol);
    if (p.toLiq === null) continue;
    if (p.toLiq <= liqWarn) {
      const level = p.toLiq <= liqWarn / 5 ? 3 : p.toLiq <= liqWarn / 2 ? 2 : 1;
      fire(`liq:${p.symbol}:${p.side}`, level,
        `${['', '⚠️ သတိ', '🚨 အန္တရာယ်', '🆘 အရမ်း အန္တရာယ်'][level]} – ${p.symbol} ${p.side} ${p.lev}x က Liquidation နား ရောက်နေပြီ!\n` +
        `အခုဈေး ${px(p.mark)} · Liquidation ${px(p.liq)} (${p.toLiq.toFixed(1)}% ပဲ ကျန်တော့တယ်)\nPnL ${f2(p.upnl)} · Entry ${px(p.entry)}\n\n` +
        'လုပ်နိုင်တာ: Stop-loss ထားပါ၊ Position တစ်ဝက် ပိတ်ပါ၊ ဒါမှမဟုတ် Margin ထပ်ထည့်ပါ (Binance App မှာ ကိုယ်တိုင်)။');
    }
  }
  const lossPct = r.wallet > 0 && r.upnl < 0 ? (-r.upnl / r.wallet) * 100 : 0;
  if (lossPct >= lossWarn) {
    fire('loss', lossPct >= lossWarn * 2 ? 2 : 1,
      `${lossPct >= lossWarn * 2 ? '🚨' : '⚠️'} Binance Futures မှာ မပိတ်ရသေးတဲ့ အရှုံး ${f2(r.upnl)} ဖြစ်နေပါတယ် (Wallet ရဲ့ ${lossPct.toFixed(0)}%)\n` +
      'အရှုံး ထပ်မကြီးခင် Stop-loss စစ်ပါ။ အရှုံး ပြန်ကာမိဖို့ Leverage မတိုးပါနဲ့။');
  }
  if (r.positions.length && r.marginRatio >= 50) {
    fire('margin', r.marginRatio >= 80 ? 2 : 1,
      `${r.marginRatio >= 80 ? '🚨' : '⚠️'} Margin Ratio ${r.marginRatio.toFixed(0)}% ရောက်နေပါပြီ (100% ဆို Liquidate ဖြစ်ပါတယ်)။ Position လျှော့ပါ ဒါမှမဟုတ် Margin ထည့်ပါ။`);
  }
  // forget warnings for positions that are closed now, so a new position starts fresh
  for (const id of Object.keys(st)) if (id.startsWith('liq:') && !open.has(id.split(':')[1])) delete st[id];
  if (!r.positions.length) { delete st.loss; delete st.margin; }
  fs.writeFileSync(STATE_FILE, JSON.stringify(st));
  return out;
}
