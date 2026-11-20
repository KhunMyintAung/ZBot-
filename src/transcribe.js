import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";
import { extractAudioChunks } from "./media.js";

/** Segment shape everywhere: { start: seconds, end: seconds, text } */

const tsToSec = (ts) => {
  const m = ts.trim().replace(",", ".").match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

function parseSubtitles(text) {
  const segments = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;
    const [a, b] = lines[timeIdx].split("-->");
    const body = lines.slice(timeIdx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (body) segments.push({ start: tsToSec(a), end: tsToSec(b.split(" ").filter(Boolean)[0]), text: body });
  }
  return segments;
}

/** Plain text has no timestamps: spread sentences evenly over the media duration. */
function parsePlainText(text, duration) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const totalWords = sentences.reduce((n, s) => n + s.split(" ").length, 0) || 1;
  let t = 0;
  return sentences.map((s) => {
    const len = (s.split(" ").length / totalWords) * duration;
    const seg = { start: t, end: t + len, text: s };
    t += len;
    return seg;
  });
}

function findSidecar(input) {
  const base = input.slice(0, -path.extname(input).length);
  for (const ext of [".srt", ".vtt", ".txt"]) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

async function whisper(input, workDir, duration, log) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "No transcript found and OPENAI_API_KEY is not set.\n" +
      "Either add OPENAI_API_KEY to .env (Whisper transcription), or put a .srt/.vtt/.txt file " +
      "with the same name next to the video.",
    );
  }
  const client = new OpenAI();
  const chunks = await extractAudioChunks(input, path.join(workDir, "audio"), duration);
  const segments = [];
  for (const [i, { file, offset }] of chunks.entries()) {
    log(`transcribing audio chunk ${i + 1}/${chunks.length}`);
    const res = await client.audio.transcriptions.create({
      file: fs.createReadStream(file),
      model: config.transcribeModel,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    for (const s of res.segments ?? []) {
      segments.push({ start: s.start + offset, end: s.end + offset, text: s.text.trim() });
    }
    if (!res.segments?.length && res.text) segments.push(...parsePlainText(res.text, 1200).map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })));
  }
  return segments;
}

function mockTranscript(duration) {
  const lines = [
    "The biggest mistake we made was building for six months before talking to a single customer.",
    "We almost shut down in month nine. We had eleven days of cash left.",
    "What saved us was one cold email to a customer who said: I'd pay for this today if it did one thing.",
    "So we killed version one. Deleted eighty percent of the features.",
    "Our pricing was wrong too. We charged nine dollars when people were happy to pay ninety.",
    "Hire slow, ship fast. That's the whole playbook.",
    "The first ten users came from me personally replying to every single tweet in our niche.",
    "We track exactly one metric now: weekly active teams. Everything else is noise.",
    "Ship it ugly, then fix it loud. Tell people what you changed and why.",
    "Our hiring loop is one paid trial project. No whiteboards, no trick questions.",
    "The pivot story is simple: we were selling to the wrong person in the right company.",
    "If I started over I would write in public from day one.",
  ];
  const step = duration / lines.length;
  return lines.map((text, i) => ({ start: i * step, end: (i + 1) * step - 0.5, text }));
}

export async function getTranscript(input, workDir, duration, log) {
  const cache = path.join(workDir, "transcript.json");
  if (fs.existsSync(cache)) {
    log("using cached transcript");
    return JSON.parse(fs.readFileSync(cache, "utf8"));
  }
  let segments;
  const sidecar = findSidecar(input);
  if (sidecar) {
    log(`using transcript file ${path.basename(sidecar)}`);
    const text = fs.readFileSync(sidecar, "utf8");
    segments = sidecar.endsWith(".txt") ? parsePlainText(text, duration) : parseSubtitles(text);
  } else if (config.transcriber === "mock" || config.provider === "mock") {
    log("using mock transcript (offline test mode)");
    segments = mockTranscript(duration);
  } else {
    segments = await whisper(input, workDir, duration, log);
  }
  if (!segments.length) throw new Error("Transcript is empty.");
  fs.writeFileSync(cache, JSON.stringify(segments, null, 2));
  return segments;
}

export const formatTranscript = (segments) =>
  segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");

export const wordCount = (segments) => segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
