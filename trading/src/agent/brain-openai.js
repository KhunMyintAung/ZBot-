import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { STATE_DIR } from '../config.js';
import { dayKey } from '../risk.js';
import { log } from '../notify.js';
import { TOOL_DEFS, runTool } from './tools.js';
import { TINYFISH_TOOL_DEFS, tinyfishOn } from './tinyfish.js';
import { memoryText } from './memory.js';
import { SYSTEM } from './brain.js';

// Same job as brain.js (Claude), but on OpenAI's Chat Completions API with function tools.
// Used when OPENAI_API_KEY is set. Same interface: ask(), usage(), overBudget(), reset(), authBroken.
// The tools are the same zBOT tools; every bot change still needs the owner's Yes button.

const HISTORY_FILE = path.join(STATE_DIR, 'agent-history-openai.json');
const USAGE_FILE = path.join(STATE_DIR, 'agent-usage.json');
const MAX_MESSAGES = 60;
const KEEP_MESSAGES = 24;
const MAX_HISTORY_BYTES = 1_500_000;

const toFn = (t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } });
// Claude content blocks (text / base64 image) -> OpenAI message parts
const toParts = (blocks) => blocks.map((b) => (b.type === 'image'
  ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
  : { type: 'text', text: b.text }));

export class OpenAIBrain {
  constructor({ apiKey, model, dailyUsd, priceIn, priceOut, baseURL, provider = 'openai' }) {
    this.provider = provider; // 'openai' or 'openrouter' (OpenRouter reports the real cost in usage.cost)
    this.client = new OpenAI({ apiKey, maxRetries: 3, timeout: 180_000, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
    this.effort = 'n/a';
    this.dailyUsd = dailyUsd;
    this.price = [priceIn, priceOut]; // USD per 1M tokens (set OPENAI_PRICE_IN / OPENAI_PRICE_OUT to match your model)
    this.tools = [...TOOL_DEFS, ...(tinyfishOn() ? TINYFISH_TOOL_DEFS : [])].map(toFn);
    this.messages = this.#load();
  }

  #load() { try { const m = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).messages; return Array.isArray(m) ? m : []; } catch { return []; } }
  #save() { fs.writeFileSync(HISTORY_FILE, JSON.stringify({ model: this.model, messages: this.messages })); }
  reset() { this.messages = []; this.#save(); }

  usage() {
    const today = dayKey(Date.now());
    try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (u.day === today) return u; } catch { /* new day */ }
    return { day: today, usd: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  }

  #addUsage(u = {}) {
    const cur = this.usage();
    cur.requests += 1;
    cur.input += u.prompt_tokens ?? 0;
    cur.output += u.completion_tokens ?? 0;
    // OpenRouter returns the exact USD cost of the call; otherwise estimate from the configured prices.
    cur.usd += Number.isFinite(u.cost) ? u.cost
      : ((u.prompt_tokens ?? 0) * this.price[0] + (u.completion_tokens ?? 0) * this.price[1]) / 1e6;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(cur));
  }

  overBudget() { return this.dailyUsd > 0 && this.usage().usd >= this.dailyUsd; }

  // Keep the conversation small; always start at a real user message (never at a tool answer).
  #trim() {
    const tooBig = () => this.messages.length > MAX_MESSAGES || JSON.stringify(this.messages).length > MAX_HISTORY_BYTES;
    if (!tooBig()) return;
    let start = Math.max(0, this.messages.length - KEEP_MESSAGES);
    while (start < this.messages.length && this.messages[start].role !== 'user') start++;
    this.messages = this.messages.slice(start).map((m) => (m.role === 'user' && Array.isArray(m.content)
      ? { ...m, content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text', text: '[photo sent earlier]' } : p)) }
      : m));
    log(`agent: conversation trimmed to ${this.messages.length} messages`);
  }

  #request() {
    const memory = memoryText({ forAi: true });
    const system = `${SYSTEM}\n- Web search here means tinyfish_search / read_page (there is no other web_search tool).${memory ? `\n\nLong-term memory (true facts saved earlier; use them):\n${memory}` : ''}`;
    return this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: system }, ...this.messages],
      tools: this.tools,
      max_completion_tokens: 4000,
    });
  }

  async ask(userContent) {
    this.#trim();
    const before = this.messages.length;
    const ctx = { confirmations: [], charts: [] };
    const stamp = new Date(Date.now() + 6.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const blocks = typeof userContent === 'string' ? [{ type: 'text', text: userContent }] : userContent;
    this.messages.push({ role: 'user', content: [{ type: 'text', text: `[${stamp} Myanmar time]` }, ...toParts(blocks)] });
    try {
      for (let step = 0; step < 12; step++) {
        if (step > 0 && this.overBudget()) throw new Error('Daily AI budget reached during this request');
        const res = await this.#request();
        this.#addUsage(res.usage);
        const choice = res.choices?.[0];
        const msg = choice?.message ?? { role: 'assistant', content: '' };
        const calls = msg.tool_calls ?? [];
        this.messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
        if (!calls.length) {
          this.#save();
          const text = (msg.content ?? '').trim() || (msg.refusal ? 'ဒီမေးခွန်းကို မဖြေနိုင်ပါ။ တခြားပုံစံနဲ့ မေးကြည့်ပါ။' : '');
          return { text: text || '(ok)', confirmations: ctx.confirmations, charts: ctx.charts };
        }
        for (const c of calls) {
          let content;
          try {
            if (choice.finish_reason === 'length') throw new Error('Tool input was cut off. Try again with a shorter request.');
            const input = JSON.parse(c.function?.arguments || '{}');
            content = JSON.stringify(await runTool(c.function.name, input, ctx));
            log(`agent tool ${c.function.name} ${String(c.function.arguments).slice(0, 200)}`);
          } catch (e) {
            content = `Error: ${e.message}`;
            log(`agent tool ${c.function?.name} error: ${e.message}`);
          }
          this.messages.push({ role: 'tool', tool_call_id: c.id, content });
        }
      }
      throw new Error('Too many steps');
    } catch (e) {
      this.messages.length = before;
      this.#save();
      throw e;
    }
  }
}

// True when the error means the key / account cannot be used (stop trying until the key changes).
export const openaiKeyProblem = (e) => (e instanceof OpenAI.APIError && e.status === 402) || e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError
  || (e instanceof OpenAI.RateLimitError && /insufficient_quota|billing/i.test(`${e.code} ${e.message}`));

export function openaiError(e) {
  if (e instanceof OpenAI.APIError && e.status === 402) return 'OpenRouter credit ကုန်နေပါတယ်။ openrouter.ai → Credits မှာ ဖြည့်ပါ။';
  if (e instanceof OpenAI.AuthenticationError) return 'AI API key မှားနေပါတယ် (OPENROUTER_API_KEY / OPENAI_API_KEY ကို စစ်ပါ)။';
  if (e instanceof OpenAI.PermissionDeniedError) return 'OpenAI က ခွင့်မပြုပါ (account / key / model ကို စစ်ပါ)။';
  if (e instanceof OpenAI.RateLimitError && /insufficient_quota|billing/i.test(`${e.code} ${e.message}`)) return 'OpenAI credit ကုန်နေပါတယ်။ platform.openai.com မှာ Billing ဖြည့်ပါ။';
  if (e instanceof OpenAI.RateLimitError) return 'OpenAI limit ပြည့်နေပါတယ်။ ခဏနေမှ ပြန်မေးပါ။';
  if (e instanceof OpenAI.APIConnectionError) return 'OpenAI ကို ချိတ်မရပါ (internet)။ ခဏနေ ပြန်ကြိုးစားပါ။';
  if (e instanceof OpenAI.NotFoundError) return 'OpenAI model နာမည် မှားနေပါတယ် (OPENAI_MODEL ကို စစ်ပါ)။';
  if (e instanceof OpenAI.APIError) return `OpenAI error ${e.status ?? ''}: ${String(e.message).slice(0, 300)}`;
  return null;
}
