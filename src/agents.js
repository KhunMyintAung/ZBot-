import { config } from "./config.js";
import { generateJSON } from "./llm.js";

// ---------- JSON schema helpers (strict: every field required, no extras) ----------
const str = { type: "string" };
const num = { type: "number" };
const arr = (items) => ({ type: "array", items });
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const systemPrompt = () => `You are part of a content repurposing team for ${config.brand.name}.
Audience: ${config.brand.audience}.
Voice: ${config.brand.voice}.
You turn one long recording into platform-native content. Rules:
- Use only ideas, stories and numbers that are actually in the transcript. Never invent facts, stats or quotes.
- Every piece must stand alone: someone who never saw the recording must get value from it.
- Open with a concrete hook (a specific moment, number or tension), not a generic intro.
- Write like a person, not a brand. No "In today's fast-paced world", no "Let's dive in", no "game-changer".
- Each piece in a batch must cover a different angle; do not repeat the same hook twice.`;

const momentsContext = (moments) =>
  moments.map((m, i) => `#${i + 1} [${m.start.toFixed(1)}-${m.end.toFixed(1)}] "${m.title}" - ${m.quote}`).join("\n");

// ---------- Step: find best moments ----------
export async function findMoments(transcriptText, duration) {
  const want = config.counts.clips;
  const pool = Math.max(want + 3, Math.round(want * 1.4));
  const res = await generateJSON({
    name: "moments",
    system: systemPrompt(),
    context: `TRANSCRIPT (each line is [start_seconds-end_seconds] text). Total length: ${duration.toFixed(0)}s.\n\n${transcriptText}`,
    task: `Find the ${pool} strongest standalone moments for short vertical video clips.
Each moment must be ${config.clipMinSeconds}-${config.clipMaxSeconds} seconds long, start at the beginning of a segment and end at the end of a segment (use the timestamps exactly), make sense without context, and ideally start with a hook in the first 3 seconds.
Score each 1-100 for viral/standalone potential. Moments must not overlap.
"quote" is the single most quotable sentence inside the moment, copied verbatim.`,
    schema: obj({
      moments: arr(obj({ start: num, end: num, title: str, hook: str, quote: str, why: str, score: num })),
    }),
    mock: () => ({
      moments: mockMoments(duration, pool),
    }),
  });
  const all = res.moments
    .map((m) => ({ ...m, start: Math.max(0, m.start), end: Math.min(duration, m.end) }))
    .filter((m) => m.end - m.start >= 5)
    .sort((a, b) => b.score - a.score);
  return { considered: all.length, kept: all.slice(0, want).sort((a, b) => a.start - b.start) };
}

function mockMoments(duration, n) {
  const titles = ["why we killed v1", "our pricing mistake", "we almost shut down", "the cold email", "hire slow, ship fast",
    "first 10 users", "one metric", "ship ugly, fix loud", "our hiring loop", "the pivot story", "write in public"];
  const len = Math.min(config.clipMaxSeconds, Math.max(5, duration / (n + 1)));
  return Array.from({ length: n }, (_, i) => ({
    start: i * (duration / n), end: Math.min(duration, i * (duration / n) + len),
    title: titles[i % titles.length], hook: `Hook for ${titles[i % titles.length]}`,
    quote: "Hire slow, ship fast. That's the whole playbook.", why: "mock", score: 90 - i * 3,
  }));
}

// ---------- The six writer agents ----------
const AGENTS = [
  {
    key: "clips", label: "Clip Cutter", platform: "Shorts", letter: "C", minutesEach: 30,
    task: (n, moments) => `Write a caption package for each of these ${moments.length} short vertical clips (TikTok / YouTube Shorts / Reels), in the same order.
on_screen_title: 3-7 words burned on screen in the first second. caption: 1-3 short lines that make people watch to the end. hashtags: 3-5, no "#fyp" spam.
CLIPS:\n${momentsContext(moments)}`,
    schema: obj({ items: arr(obj({ on_screen_title: str, caption: str, hashtags: arr(str) })) }),
    mock: (n, moments) => ({ items: moments.map((m) => ({ on_screen_title: m.title, caption: `${m.hook}. Watch till the end.`, hashtags: ["#startup", "#founder", "#buildinpublic"] })) }),
    toPieces: (r, moments) => r.items.slice(0, moments.length).map((it, i) => ({
      title: it.on_screen_title, body: `${it.caption}\n\n${it.hashtags.join(" ")}`, moment: moments[i],
    })),
  },
  {
    key: "threads", label: "Thread Writer", platform: "X", letter: "T", minutesEach: 25,
    task: (n) => `Write ${n} X (Twitter) threads, each from a different idea in the transcript. 5-9 posts per thread, each post under 270 characters. Post 1 is the hook and must work alone. Last post: a one-line takeaway (no "follow me for more").`,
    schema: obj({ items: arr(obj({ title: str, posts: arr(str) })) }),
    mock: (n) => ({ items: Array.from({ length: n }, (_, i) => ({ title: `Thread ${i + 1}: how we hire`, posts: ["We hire with one paid trial project.", "No whiteboards.", "Here is why it works."] })) }),
    toPieces: (r) => r.items.map((it) => ({ title: it.title, body: it.posts.map((p, i) => `${i + 1}/ ${p}`).join("\n\n") })),
  },
  {
    key: "linkedin", label: "Post Writer", platform: "LinkedIn", letter: "P", minutesEach: 20,
    task: (n) => `Write ${n} LinkedIn posts, 120-250 words each, each from a different story or lesson in the transcript. Short paragraphs, first line is the hook (under 12 words), end with a genuine question to the reader. No hashtag walls (max 3).`,
    schema: obj({ items: arr(obj({ title: str, body: str })) }),
    mock: (n) => ({ items: Array.from({ length: n }, (_, i) => ({ title: `Our hiring loop ${i + 1}`, body: "We stopped doing whiteboard interviews.\n\nNow every candidate does one paid trial project.\n\nWhat's your best hiring signal?" })) }),
    toPieces: (r) => r.items.map((it) => ({ title: it.title, body: it.body })),
  },
  {
    key: "quotes", label: "Quote Cards", platform: "Instagram", letter: "Q", minutesEach: 15,
    task: (n) => `Pick ${n} short, punchy quotes for Instagram quote-card images. quote: verbatim or lightly trimmed from the transcript, max 18 words. caption: 2-4 sentence Instagram caption expanding on it, plus 3-5 hashtags at the end.`,
    schema: obj({ items: arr(obj({ quote: str, caption: str })) }),
    mock: (n) => ({ items: Array.from({ length: n }, (_, i) => ({ quote: ["Hire slow, ship fast.", "Ship it ugly, then fix it loud.", "Price it, then fix it.", "One metric matters."][i % 4], caption: "The whole playbook in one line. #startups #founders" })) }),
    toPieces: (r) => r.items.map((it) => ({ title: it.quote, body: it.caption, quote: it.quote })),
  },
  {
    key: "newsletter", label: "Newsletter", platform: "Email", letter: "N", minutesEach: 45,
    task: (n) => `Write ${n} email newsletter issue(s) for ${config.brand.newsletterName} recapping this episode. subject: under 50 characters, curiosity without clickbait. preview: under 90 characters. body_markdown: 300-500 words, a personal opening, 3 key takeaways with the story behind each, and a closing line pointing to the full episode (write [EPISODE LINK] as a placeholder).`,
    schema: obj({ items: arr(obj({ subject: str, preview: str, body_markdown: str })) }),
    mock: (n) => ({ items: Array.from({ length: n }, () => ({ subject: "We had 11 days of cash left", preview: "3 lessons from almost shutting down", body_markdown: "Hey,\n\nThis week...\n\n[EPISODE LINK]" })) }),
    toPieces: (r) => r.items.map((it) => ({ title: it.subject, body: `**Preview:** ${it.preview}\n\n${it.body_markdown}` })),
  },
  {
    key: "blogs", label: "Blog Writer", platform: "Blog", letter: "B", minutesEach: 60,
    task: (n) => `Write ${n} SEO-friendly blog posts, each on a different topic from the transcript. 700-1100 words, markdown with H2 sections, a concrete intro (no "In this article"), and a short conclusion. slug: lowercase-with-dashes. meta_description: under 155 characters.`,
    schema: obj({ items: arr(obj({ title: str, slug: str, meta_description: str, body_markdown: str })) }),
    mock: (n) => ({ items: Array.from({ length: n }, (_, i) => ({ title: `Our pricing playbook ${i + 1}`, slug: `pricing-playbook-${i + 1}`, meta_description: "How we 10x'd our price.", body_markdown: "## The mistake\n\nWe charged $9...\n\n## The fix\n\n..." })) }),
    toPieces: (r) => r.items.map((it) => ({ title: it.title, body: `---\nslug: ${it.slug}\ndescription: ${it.meta_description}\n---\n\n# ${it.title}\n\n${it.body_markdown}`, slug: it.slug })),
  },
];

export const AGENT_INFO = AGENTS.map(({ key, label, platform, letter, minutesEach }) => ({ key, label, platform, letter, minutesEach }));

/** Run every writer agent in parallel. Returns { [key]: { agent, pieces, error } } */
export async function runAgents(transcriptText, moments, log) {
  const results = await Promise.all(AGENTS.map(async (agent) => {
    const n = agent.key === "clips" ? moments.length : config.counts[agent.key];
    if (!n) return [agent.key, { agent, pieces: [] }];
    log(`${agent.label}: writing ${n}`);
    try {
      const raw = await generateJSON({
        name: agent.key,
        system: systemPrompt(),
        context: `TRANSCRIPT (each line is [start_seconds-end_seconds] text):\n\n${transcriptText}`,
        task: agent.task(n, moments),
        schema: agent.schema,
        mock: () => agent.mock(n, moments),
      });
      const pieces = agent.toPieces(raw, moments).slice(0, n);
      log(`${agent.label}: done ${pieces.length}/${n}`);
      return [agent.key, { agent, pieces }];
    } catch (err) {
      log(`${agent.label}: FAILED - ${err.message}`);
      return [agent.key, { agent, pieces: [], error: err.message }];
    }
  }));
  return Object.fromEntries(results);
}
