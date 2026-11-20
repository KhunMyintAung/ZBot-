#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { config, ROOT } from "./config.js";
import { probe, cutVerticalClip, ffmpeg } from "./media.js";
import { getTranscript, formatTranscript, wordCount } from "./transcribe.js";
import { findMoments, runAgents, AGENT_INFO } from "./agents.js";
import { buildSchedule, scheduleToCsv } from "./schedule.js";
import { slugify, quoteCardSvg, clipSrt, writeText, dashboardHtml } from "./render.js";

const MEDIA_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"]);

function makeLogger(file) {
  const t0 = Date.now();
  const lines = [];
  const log = (msg) => {
    const s = Math.round((Date.now() - t0) / 1000);
    const line = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}  ${msg}`;
    lines.push(line);
    console.log(line);
    fs.appendFileSync(file, line + "\n");
  };
  log.lines = lines;
  log.elapsed = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  return log;
}

export async function processFile(input, { clips = true } = {}) {
  input = path.resolve(input);
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
  const name = slugify(path.basename(input, path.extname(input)), 60);
  const outDir = path.join(config.outputDir, name);
  const workDir = path.join(outDir, ".work");
  fs.mkdirSync(workDir, { recursive: true });
  const log = makeLogger(path.join(outDir, "run.log"));
  log(`start: ${path.basename(input)} (AI: ${config.provider === "claude" ? config.claudeModel : config.provider === "grok" ? config.grokModel : "mock"})`);

  // 1. Probe + transcribe
  const media = await probe(input);
  log(`media: ${(media.duration / 60).toFixed(1)} min, ${media.hasVideo ? `video ${media.width}x${media.height}` : "audio only"}`);
  const segments = await getTranscript(input, workDir, media.duration, log);
  const words = wordCount(segments);
  log(`transcribed: ${words.toLocaleString()} words, ${segments.length} segments`);
  const transcriptText = formatTranscript(segments);
  writeText(path.join(outDir, "transcript.txt"), transcriptText);

  // 2. Find best moments
  log("finding best moments");
  const { considered, kept: moments } = await findMoments(transcriptText, media.duration);
  log(`moments: kept ${moments.length} of ${considered}`);

  // 3. Writer agents (parallel) + clip cutting
  const cutting = (async () => {
    const files = [];
    if (!clips || !media.hasVideo) {
      log(media.hasVideo ? "clip cutting skipped (--no-clips)" : "clip cutting skipped (no video track)");
      return files;
    }
    for (const [i, m] of moments.entries()) {
      const base = `${String(i + 1).padStart(2, "0")}-${slugify(m.title)}`;
      const file = path.join(outDir, "clips", `${base}.mp4`);
      try {
        await cutVerticalClip(input, { ...m, width: media.width, height: media.height }, file);
        writeText(path.join(outDir, "clips", `${base}.srt`), clipSrt(segments, m.start, m.end));
        files[i] = `clips/${base}.mp4`;
        log(`clip ${i + 1}/${moments.length} cut: ${base}.mp4`);
      } catch (err) {
        log(`clip ${i + 1} FAILED: ${err.message.split("\n").filter(Boolean).slice(-2).join(" | ")}`);
      }
    }
    return files;
  })();
  const [results, clipFiles] = await Promise.all([runAgents(transcriptText, moments, log), cutting]);

  // 4. Write every piece to disk
  const pieceIndex = {};
  for (const { agent, pieces } of Object.values(results)) {
    pieces.forEach((p, i) => {
      const base = `${String(i + 1).padStart(2, "0")}-${slugify(p.slug ?? p.title)}`;
      p.file = `posts/${agent.key}/${base}.md`;
      if (agent.key === "clips") p.clip = clipFiles[i] ?? null;
      let header = `<!-- ${agent.label} → ${agent.platform} -->\n`;
      if (p.moment) header += `<!-- source ${p.moment.start.toFixed(1)}s-${p.moment.end.toFixed(1)}s · score ${p.moment.score} · ${p.moment.why} -->\n`;
      if (p.clip) header += `<!-- video: ${p.clip} -->\n`;
      writeText(path.join(outDir, p.file), `${header}\n# ${p.title}\n\n${p.body}\n`);
      if (agent.key === "quotes") {
        p.image = `quote-cards/${base}.svg`;
        writeText(path.join(outDir, p.image), quoteCardSvg(p.quote, config.brand.name, i));
      }
      pieceIndex[p.file] = { title: p.title, body: p.body, image: p.image ?? null };
    });
  }

  // 5. Schedule + dashboard
  const schedule = buildSchedule(results);
  writeText(path.join(outDir, "schedule.json"), JSON.stringify(schedule, null, 2));
  writeText(path.join(outDir, "schedule.csv"), scheduleToCsv(schedule));
  const all = Object.values(results);
  const pieces = all.reduce((n, r) => n + r.pieces.length, 0);
  const planned = moments.length + Object.entries(config.counts).filter(([k]) => k !== "clips").reduce((n, [, v]) => n + v, 0);
  const minutesSaved = all.reduce((n, r) => n + r.pieces.length * r.agent.minutesEach, 0);
  const platforms = new Set(all.filter((r) => r.pieces.length).map((r) => r.agent.platform)).size;
  log(`scheduled ${schedule.items.length} posts over 7 days → schedule.csv`);
  log(`done: ${pieces}/${planned} pieces, ${platforms} platforms`);

  writeText(path.join(outDir, "dashboard.html"), dashboardHtml({
    source: path.basename(input),
    timezone: config.timezoneLabel,
    stats: {
      pieces, planned, platforms, hours: (minutesSaved / 60).toFixed(1), runtime: log.elapsed(),
      minutes: (media.duration / 60).toFixed(1), words, momentsKept: moments.length, momentsConsidered: considered,
    },
    agents: AGENT_INFO.map((a) => ({
      ...a, done: results[a.key].pieces.length,
      planned: a.key === "clips" ? moments.length : config.counts[a.key], error: results[a.key].error ?? null,
    })),
    schedule,
    pieces: pieceIndex,
    log: log.lines,
  }));

  console.log(`\nOpen the dashboard: ${path.join(outDir, "dashboard.html")}`);
  const failed = all.filter((r) => r.error);
  if (failed.length) console.log(`Warning: ${failed.length} agent(s) failed, see run.log`);
  return outDir;
}

async function watch() {
  const inbox = config.inboxDir;
  for (const d of [inbox, path.join(inbox, "done"), path.join(inbox, "failed")]) fs.mkdirSync(d, { recursive: true });
  console.log(`Watching ${inbox} (every ${config.pollSeconds}s). Drop a video or audio file in. Ctrl+C to stop.`);
  const sizes = new Map();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const f of fs.readdirSync(inbox)) {
        const full = path.join(inbox, f);
        if (!MEDIA_EXT.has(path.extname(f).toLowerCase()) || !fs.statSync(full).isFile()) continue;
        const size = fs.statSync(full).size;
        if (sizes.get(full) !== size) { sizes.set(full, size); continue; } // still copying, wait one more poll
        sizes.delete(full);
        console.log(`\nNew file: ${f}`);
        let dest = "done";
        try { await processFile(full); } catch (err) { console.error(`FAILED: ${err.message}`); dest = "failed"; }
        // move the media file and any sidecar transcript
        const base = full.slice(0, -path.extname(full).length);
        for (const p of [full, base + ".srt", base + ".vtt", base + ".txt"]) {
          if (fs.existsSync(p)) fs.renameSync(p, path.join(inbox, dest, path.basename(p)));
        }
      }
    } finally { busy = false; }
  };
  await tick();
  setInterval(tick, config.pollSeconds * 1000);
}

async function demo() {
  config.provider = "mock";
  const dir = path.join(ROOT, "demo");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "demo_podcast.mp4");
  if (!fs.existsSync(file)) {
    console.log("Creating a 3-minute test video...");
    const { code, stderr } = await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi",
      "-i", "sine=frequency=300", "-t", "180", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    if (code !== 0) throw new Error(stderr);
  }
  return processFile(file);
}

const HELP = `zBOT Content Machine - 1 video in, a week of content out

Usage:
  node src/index.js run <video-or-audio-file> [--no-clips]
  node src/index.js watch          watch the inbox/ folder and process new files
  node src/index.js demo           offline test with a generated video and mock AI (no API keys)

Settings live in .env (copy .env.example).`;

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "run" && args[0]) await processFile(args.find((a) => !a.startsWith("--")), { clips: !args.includes("--no-clips") });
  else if (cmd === "watch") await watch();
  else if (cmd === "demo") await demo();
  else console.log(HELP);
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
}
