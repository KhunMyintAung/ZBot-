import crypto from 'node:crypto';

const BASES = {
  spot: { live: 'https://api.binance.com', testnet: 'https://testnet.binance.vision' },
  futures: { live: 'https://fapi.binance.com', testnet: 'https://testnet.binancefuture.com' },
};
const PATHS = {
  spot: { klines: '/api/v3/klines', time: '/api/v3/time', info: '/api/v3/exchangeInfo', price: '/api/v3/ticker/price' },
  futures: { klines: '/fapi/v1/klines', time: '/fapi/v1/time', info: '/fapi/v1/exchangeInfo', price: '/fapi/v1/ticker/price' },
};

export const INTERVAL_MS = {
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
  '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '6h': 21600e3, '8h': 28800e3, '12h': 43200e3, '1d': 86400e3,
};

const decimals = (step) => {
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const d = s.replace(/0+$/, '').split('.')[1];
  return d ? d.length : 0;
};
export const floorTo = (v, step) => {
  const d = decimals(step);
  return Number((Math.floor(v / step + 1e-9) * step).toFixed(d));
};
export const roundTo = (v, step) => Number((Math.round(v / step) * step).toFixed(decimals(step)));

export class Binance {
  // mode 'paper' uses live public market data and never sends orders.
  constructor({ market, mode, apiKey, apiSecret }) {
    this.market = market;
    this.mode = mode;
    this.base = BASES[market][mode === 'testnet' ? 'testnet' : 'live'];
    this.p = PATHS[market];
    this.key = apiKey;
    this.secret = apiSecret;
    this.offset = null;
  }

  async #req(method, url, headers = {}) {
    let res, text;
    try {
      res = await fetch(url, { method, headers, signal: AbortSignal.timeout(15000) });
      text = await res.text();
    } catch (e) {
      // Internet down, DNS, timeout, connection reset: safe to retry later.
      const err = new Error(`network: ${e.cause?.code ?? e.name ?? ''} ${e.message}`.trim());
      err.network = true;
      throw err;
    }
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`Binance ${res.status} ${method} ${url.split('?')[0]}: ${typeof body === 'object' ? `${body.code} ${body.msg}` : text}`);
      err.code = body?.code;
      err.network = res.status >= 500 || res.status === 429 || res.status === 418; // server busy / rate limit
      throw err;
    }
    return body;
  }

  public(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.#req('GET', `${this.base}${path}${qs ? '?' + qs : ''}`);
  }

  async signed(method, path, params = {}) {
    if (this.mode === 'paper') throw new Error('Signed request blocked in paper mode');
    if (!this.key || !this.secret) throw new Error('BINANCE_API_KEY / BINANCE_API_SECRET missing in trading/.env');
    if (this.offset === null) {
      const t = await this.public(this.p.time);
      this.offset = t.serverTime - Date.now();
    }
    const qs = new URLSearchParams({ ...params, recvWindow: 5000, timestamp: Date.now() + this.offset }).toString();
    const sig = crypto.createHmac('sha256', this.secret).update(qs).digest('hex');
    return this.#req(method, `${this.base}${path}?${qs}&signature=${sig}`, { 'X-MBX-APIKEY': this.key });
  }

  // ---------- market data ----------
  async klines(symbol, interval, { limit = 1000, startTime, endTime } = {}) {
    const params = { symbol, interval, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    const rows = await this.public(this.p.klines, params);
    return rows.map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], closeT: r[6] }));
  }

  async closedKlines(symbol, interval, limit = 400) {
    const ks = await this.klines(symbol, interval, { limit });
    return ks.filter((k) => k.closeT < Date.now());
  }

  async history(symbol, interval, days, onProgress) {
    const step = INTERVAL_MS[interval];
    if (!step) throw new Error(`Unsupported interval ${interval}`);
    let start = Date.now() - days * 86400e3;
    const out = [];
    while (start < Date.now() - step) {
      const batch = await this.klines(symbol, interval, { limit: 1000, startTime: start });
      if (!batch.length) break;
      out.push(...batch);
      start = batch.at(-1).t + step;
      onProgress?.(out.length);
      if (batch.length < 1000) break;
    }
    return out.filter((k) => k.closeT < Date.now());
  }

  async price(symbol) {
    return Number((await this.public(this.p.price, { symbol })).price);
  }

  async symbolRules(symbol) {
    const info = await this.public(this.p.info, this.market === 'spot' ? { symbol } : {});
    const s = info.symbols.find((x) => x.symbol === symbol);
    if (!s) throw new Error(`Symbol ${symbol} not found on Binance ${this.market}`);
    const f = Object.fromEntries(s.filters.map((x) => [x.filterType, x]));
    const lot = (this.market === 'futures' && f.MARKET_LOT_SIZE) ? f.MARKET_LOT_SIZE : f.LOT_SIZE;
    return {
      base: s.baseAsset, quote: s.quoteAsset,
      stepSize: Number(lot.stepSize), minQty: Number(lot.minQty),
      tickSize: Number(f.PRICE_FILTER.tickSize),
      minNotional: Number(f.NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.notional ?? 5),
    };
  }

  // ---------- account ----------
  // coins: [{ rules, price }] for every traded symbol (spot needs them to value the coins held).
  async equity(coins) {
    if (this.market === 'futures') {
      const a = await this.signed('GET', '/fapi/v2/account');
      return Number(a.totalMarginBalance);
    }
    const a = await this.signed('GET', '/api/v3/account');
    const bal = (asset) => {
      const b = a.balances.find((x) => x.asset === asset);
      return b ? Number(b.free) + Number(b.locked) : 0;
    };
    const quotes = new Set(coins.map((c) => c.rules.quote));
    return [...quotes].reduce((s, q) => s + bal(q), 0) + coins.reduce((s, c) => s + bal(c.rules.base) * c.price, 0);
  }

  setLeverage(symbol, leverage) {
    return this.signed('POST', '/fapi/v1/leverage', { symbol, leverage });
  }

  async positionAmt(symbol) {
    const rows = await this.signed('GET', '/fapi/v2/positionRisk', { symbol });
    return rows.reduce((s, r) => s + Number(r.positionAmt), 0);
  }

  marketOrder(symbol, side, quantity, { reduceOnly = false } = {}) {
    if (this.market === 'spot') {
      return this.signed('POST', '/api/v3/order', { symbol, side, type: 'MARKET', quantity, newOrderRespType: 'FULL' });
    }
    const p = { symbol, side, type: 'MARKET', quantity, newOrderRespType: 'RESULT' };
    if (reduceOnly) p.reduceOnly = 'true';
    return this.signed('POST', '/fapi/v1/order', p);
  }

  // Spot: stop-loss as STOP_LOSS_LIMIT sell sitting on the exchange.
  spotStopLoss(symbol, quantity, stopPrice, limitPrice) {
    return this.signed('POST', '/api/v3/order', {
      symbol, side: 'SELL', type: 'STOP_LOSS_LIMIT', timeInForce: 'GTC', quantity, stopPrice, price: limitPrice,
    });
  }

  spotOrder(symbol, orderId) {
    return this.signed('GET', '/api/v3/order', { symbol, orderId });
  }

  // Futures: STOP_MARKET / TAKE_PROFIT_MARKET that close the whole position.
  // If Binance rejects conditional orders on /fapi/v1/order, fall back to the Algo Order endpoint.
  async futuresExit(symbol, side, type, triggerPrice) {
    try {
      return await this.signed('POST', '/fapi/v1/order', {
        symbol, side, type, stopPrice: triggerPrice, closePosition: 'true', workingType: 'MARK_PRICE',
      });
    } catch (e) {
      if (!/algo/i.test(e.message) && e.code !== -4120) throw e;
      return this.signed('POST', '/fapi/v1/algoOrder', {
        algoType: 'CONDITIONAL', symbol, side, type, triggerPrice, closePosition: 'true', workingType: 'MARK_PRICE',
      });
    }
  }

  async cancelAll(symbol) {
    if (this.market === 'spot') {
      try { await this.signed('DELETE', '/api/v3/openOrders', { symbol }); } catch (e) { if (e.code !== -2011) throw e; }
      return;
    }
    await this.signed('DELETE', '/fapi/v1/allOpenOrders', { symbol });
    try { await this.signed('DELETE', '/fapi/v1/algoOpenOrders', { symbol }); } catch { /* endpoint may not exist / nothing open */ }
  }
}
