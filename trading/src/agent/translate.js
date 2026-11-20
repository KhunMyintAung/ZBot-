import Anthropic from '@anthropic-ai/sdk';

// English -> Burmese for channel news. Claude when ANTHROPIC_API_KEY is set (much better wording),
// otherwise Google's free web translator. Returns null when both fail (the caller keeps English).

const SYSTEM = 'Translate crypto news from English to natural, easy Burmese (Myanmar Unicode) for ordinary readers. ' +
  'Keep names, tickers, numbers and common terms (Bitcoin, ETF, SEC, Fed, Stablecoin, Futures) in English. ' +
  'Keep the same line breaks. Output only the translation.';

let client = null;
async function viaClaude(text) {
  const key = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!key.startsWith('sk-ant-')) return null; // missing or not a real key
  client ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 180_000 });
  const r = await client.messages.create({
    model: (process.env.TRANSLATE_MODEL ?? '').trim() || 'claude-haiku-5-5',
    max_tokens: text.length > 1200 ? 12000 : 1500, // Burmese needs several tokens per English word
    system: SYSTEM,
    messages: [{ role: 'user', content: text }],
  });
  return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
}

// The free endpoint takes a GET URL, so long text goes in paragraph chunks.
function chunks(text, max = 1500) {
  const out = [];
  let cur = '';
  for (const p of text.split(/\n/)) {
    if (cur && (cur + '\n' + p).length > max) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + p : p;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) out.push(cur);
  return out;
}

async function viaGoogle(text) {
  if (text.length > 1500) {
    const parts = [];
    for (const c of chunks(text)) {
      if (!c.trim()) { parts.push(''); continue; }
      const t = await viaGoogleOne(c);
      if (!t) return null;
      parts.push(t);
    }
    return parts.join('\n');
  }
  return viaGoogleOne(text);
}

async function viaGoogleOne(text, sl = 'en', tl = 'my') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=` + encodeURIComponent(text);
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`translate HTTP ${r.status}`);
  const j = await r.json();
  return (j?.[0] ?? []).map((x) => x?.[0] ?? '').join('').trim() || null; // keeps line breaks
}

export let lastError = null;
export async function toBurmese(text) {
  if (!text?.trim()) return null;
  try { const t = await viaClaude(text); if (t) return t; } catch { /* fall back */ }
  for (let i = 0; i < 3; i++) {
    try { const t = await viaGoogle(text); if (t) return t; } catch (e) { lastError = e.message; }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

// Any direction through the free Google translator (used when there is no Claude key). null on failure.
export async function translateText(text, sl = 'auto', tl = 'en') {
  if (!text?.trim()) return null;
  try { return await viaGoogleOne(text.slice(0, 1500), sl, tl); } catch { return null; }
}
