import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};
const int = (key, fallback) => Number.parseInt(env(key, String(fallback)), 10);

export const config = {
  // Which AI writes the content: "claude" (default), "grok", or "mock" (offline test, no API calls)
  provider: env("AI_PROVIDER", "claude").toLowerCase(),
  claudeModel: env("CLAUDE_MODEL", "claude-opus-5-5"),
  claudeEffort: env("CLAUDE_EFFORT", "medium"),
  grokModel: env("GROK_MODEL", "grok-4"),

  // Speech-to-text: "openai" (Whisper API) or "mock". A sidecar .srt/.vtt/.txt next to the video skips this.
  transcriber: env("TRANSCRIBER", "openai").toLowerCase(),
  transcribeModel: env("OPENAI_TRANSCRIBE_MODEL", "whisper-1"),

  inboxDir: path.resolve(ROOT, env("INBOX_DIR", "inbox")),
  outputDir: path.resolve(ROOT, env("OUTPUT_DIR", "output")),
  pollSeconds: int("WATCH_POLL_SECONDS", 15),

  // How many pieces each agent makes
  counts: {
    clips: int("CLIPS", 8),
    threads: int("THREADS", 4),
    linkedin: int("LINKEDIN_POSTS", 4),
    quotes: int("QUOTE_CARDS", 4),
    newsletter: int("NEWSLETTERS", 1),
    blogs: int("BLOG_POSTS", 2),
  },

  clipMinSeconds: int("CLIP_MIN_SECONDS", 25),
  clipMaxSeconds: int("CLIP_MAX_SECONDS", 75),

  brand: {
    name: env("BRAND_NAME", "our show"),
    voice: env("BRAND_VOICE", "direct, specific, a little funny, no corporate buzzwords, no emojis spam"),
    audience: env("BRAND_AUDIENCE", "founders and creators"),
    newsletterName: env("NEWSLETTER_NAME", "the newsletter"),
  },

  // First day of the 7-day schedule (YYYY-MM-DD). Default: tomorrow.
  startDate: env("START_DATE", ""),
  timezoneLabel: env("TIMEZONE_LABEL", "local time"),
};
