# zBOT Content Machine

Drop in **1 video** (or podcast audio). Get back **23 pieces of content for 6 platforms**, scheduled across the next 7 days.

```
video ─► transcribe ─► find best moments ─┬─► Clip Cutter   8 vertical clips (9:16 mp4 + .srt) + captions   → Shorts/TikTok/Reels
                                          ├─► Thread Writer 4 X threads
                                          ├─► Post Writer   4 LinkedIn posts
                                          ├─► Quote Cards   4 Instagram quote images (.svg) + captions
                                          ├─► Newsletter    1 email issue
                                          └─► Blog Writer   2 SEO blog posts
                                                     │
                                                     ▼
                                     7-day schedule (CSV) + dashboard.html
```

## Setup (once)

1. Node.js 21.7 or newer (you have it). Dependencies are already installed; on a new PC run `npm install`.
2. Copy `.env.example` to `.env` and fill in:
   - `ANTHROPIC_API_KEY`: writes the content with Claude. Get one at https://console.anthropic.com
   - `OPENAI_API_KEY`: transcribes the speech (Whisper). You can skip it if you put a transcript
     file next to the video with the same name (`episode42.mp4` + `episode42.srt`).
   - Optional: `AI_PROVIDER=grok` and `XAI_API_KEY` to have Grok write the content instead.
   - Set `BRAND_NAME`, `BRAND_AUDIENCE` and `BRAND_VOICE` so the posts sound like you.

## Use

Try it with no keys first (makes a test video, uses fake AI text):

```bash
node src/index.js demo
```

Process one file:

```bash
node src/index.js run "C:\path\to\podcast_ep42.mp4"
```

Watch mode: drop files into `inbox\` and they are processed automatically, then moved to `inbox\done\`:

```bash
node src/index.js watch
```

## Output: `output\<video-name>\`

| File | What |
|---|---|
| `dashboard.html` | Open in a browser. Stats, pipeline, 7-day calendar; click any post to read, copy, or play the clip |
| `clips\*.mp4` + `.srt` | Vertical 1080×1920 clips and subtitles (upload the .srt or burn it in with CapCut) |
| `posts\<type>\*.md` | Every written piece, ready to copy-paste |
| `quote-cards\*.svg` | Quote images. Open in a browser, Canva or Figma and export as PNG |
| `schedule.csv` | Date, time, platform, content file and media file for each post. Import into your scheduler or follow it by hand |
| `transcript.txt`, `run.log` | Timestamped transcript and what happened |

## Notes

- **Nothing is posted automatically.** Read every piece before it goes out. The AI is told to use only facts from your recording, but check names and numbers.
- To auto-post later, connect `schedule.csv` to a scheduler such as Buffer, Typefully, Metricool or n8n.
- Cost per 1-hour episode is roughly: Whisper ≈ $0.36, plus Claude writing the 7 AI steps on a ~12k-word transcript (the transcript is prompt-cached between steps).
- Clip cutting runs on your CPU and takes about 20–40 seconds per clip.
- Transcripts are cached in `output\<name>\.work\`. To re-run with new prompts, run the same file again and you won't pay for transcription twice.
- Writing prompts are in `src/agents.js`. Edit them to change the style.
