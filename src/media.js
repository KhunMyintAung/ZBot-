import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", ...args], { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, stderr }));
  });
}

async function ffmpegOrThrow(args, what) {
  const { code, stderr } = await ffmpeg(args);
  if (code !== 0) throw new Error(`ffmpeg failed (${what}):\n${stderr.split("\n").slice(-12).join("\n")}`);
}

/** Duration (seconds), whether there is a video stream, and its size. */
export async function probe(file) {
  const { stderr } = await ffmpeg(["-i", file]); // exits 1 with no output file; that's expected
  const d = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!d) throw new Error(`Could not read media file: ${file}\n${stderr.split("\n").slice(-5).join("\n")}`);
  const duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const videoLine = stderr.split("\n").find((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  let width = 0, height = 0;
  if (videoLine) {
    const m = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})[\s,\[]/);
    if (m) [width, height] = [Number(m[1]), Number(m[2])];
  }
  return { duration, hasVideo: Boolean(videoLine && width), width, height };
}

/**
 * Extract mono 16 kHz speech audio in chunks small enough for the Whisper API (25 MB limit).
 * Returns [{ file, offset }].
 */
export async function extractAudioChunks(input, outDir, duration, chunkSeconds = 1200) {
  fs.mkdirSync(outDir, { recursive: true });
  const chunks = [];
  for (let i = 0, start = 0; start < duration; i++, start += chunkSeconds) {
    const file = path.join(outDir, `audio_${String(i).padStart(3, "0")}.mp3`);
    await ffmpegOrThrow(
      ["-y", "-ss", String(start), "-t", String(chunkSeconds), "-i", input,
       "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", file],
      "extract audio",
    );
    chunks.push({ file, offset: start });
  }
  return chunks;
}

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/** Cut one 9:16 vertical clip (center crop, 1080x1920). */
export async function cutVerticalClip(input, { start, end, width, height }, outFile) {
  let cw = width, ch = height;
  if (width / height > 9 / 16) cw = even((height * 9) / 16); // landscape -> crop sides
  else ch = even((width * 16) / 9);                         // too tall -> crop top/bottom
  const filter = `crop=${even(cw)}:${even(ch)},scale=1080:1920,setsar=1`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await ffmpegOrThrow(
    ["-y", "-ss", start.toFixed(2), "-i", input, "-t", (end - start).toFixed(2),
     "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
     "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outFile],
    "cut clip",
  );
}
