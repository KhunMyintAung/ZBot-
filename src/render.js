import fs from "node:fs";
import path from "node:path";

export const slugify = (s, max = 40) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "untitled";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/** 1080x1080 quote card as SVG (open in a browser or import into Canva/Figma). */
export function quoteCardSvg(quote, attribution, index) {
  const palettes = [["#1f1b16", "#f4efe6", "#e8692c"], ["#f4efe6", "#1f1b16", "#c2410c"], ["#16324f", "#f4efe6", "#f2b84b"], ["#2b2135", "#f4efe6", "#d9467a"]];
  const [bg, fg, accent] = palettes[index % palettes.length];
  const size = quote.length > 90 ? 56 : quote.length > 50 ? 68 : 84;
  const lines = wrap(`“${quote}”`, Math.floor(1700 / size));
  const lh = size * 1.22;
  const top = 540 - ((lines.length - 1) * lh) / 2;
  const tspans = lines.map((l, i) => `<tspan x="120" y="${(top + i * lh).toFixed(0)}">${xml(l)}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<rect width="1080" height="1080" fill="${bg}"/>
<rect x="120" y="150" width="96" height="10" fill="${accent}"/>
<text font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="${fg}">${tspans}</text>
<text x="120" y="930" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="${accent}" font-weight="700">${xml(attribution)}</text>
</svg>`;
}

export function clipSrt(segments, start, end) {
  const ts = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return segments
    .filter((s) => s.end > start && s.start < end)
    .map((s, i) => `${i + 1}\n${ts(Math.max(s.start, start) - start)} --> ${ts(Math.min(s.end, end) - start)}\n${s.text}\n`)
    .join("\n");
}

export function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const PLATFORM_COLORS = {
  Shorts: "#d9402b", X: "#1f1b16", LinkedIn: "#1e63b5", Instagram: "#c2357a", Email: "#c98a10", Blog: "#2f8a55",
};

/** Self-contained dashboard: stats, pipeline, 7-day calendar, run log. */
export function dashboardHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zBOT Content Machine</title>
<style>
:root{--bg:#f6f2ea;--panel:#fffdf9;--ink:#1f1b16;--muted:#776e63;--line:#e6ded1;--accent:#e8692c;--ok:#2f8a55;--shadow:0 1px 2px rgba(0,0,0,.05)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15130f;--panel:#1f1c17;--ink:#f1ebe0;--muted:#a59b8d;--line:#352f27;--accent:#f2804a;--ok:#5cc28a;--shadow:none}}
:root[data-theme="dark"]{--bg:#15130f;--panel:#1f1c17;--ink:#f1ebe0;--muted:#a59b8d;--line:#352f27;--accent:#f2804a;--ok:#5cc28a;--shadow:none}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1240px;margin:0 auto;padding:28px 16px 60px}
header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;align-items:end;margin-bottom:22px}
h1{margin:0;font-size:30px;letter-spacing:-.02em}h1 b{color:var(--accent)}
.sub{color:var(--muted);margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:var(--shadow);margin-bottom:16px}
.kicker{font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.stat .v{font-size:36px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.stat .v small{font-size:14px;color:var(--muted);font-weight:500;margin-left:4px}
.pipe{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.agent{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px}
.badge{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}
.agent .n{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700}
.agent .err{color:#c0392b;font-size:12px}
.cal{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:8px;overflow-x:auto}
.day h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
.item{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:7px 9px;margin-bottom:6px;cursor:pointer}
.item:hover{border-color:var(--c)}
.item .meta{display:flex;justify-content:space-between;font:600 10px/1.4 ui-monospace,Consolas,monospace;color:var(--c);text-transform:uppercase}
.item .t{font-size:13px;font-weight:600;margin-top:2px}
.log{font:12px/1.7 ui-monospace,Consolas,monospace;color:var(--muted);white-space:pre-wrap;max-height:260px;overflow:auto;margin:0}
dialog{max-width:720px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--ink);padding:0}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
.dlg-body{padding:18px;max-height:70vh;overflow:auto}
.dlg-body pre{white-space:pre-wrap;font:14px/1.55 system-ui,sans-serif;margin:0}
.dlg-body video,.dlg-body img{max-width:100%;max-height:52vh;border-radius:10px;display:block;margin:0 auto 14px}
button.ghost{font:inherit;background:none;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:6px 12px;cursor:pointer}
.row{display:flex;gap:8px}
.files{color:var(--muted);font-size:13px}
.files code{color:var(--ink)}
</style>
</head>
<body>
<main>
<header>
  <div><h1><b>zBOT</b> Content Machine</h1><div class="sub" id="sub"></div></div>
  <div class="files">Source: <code id="src"></code></div>
</header>
<section class="stats" id="stats"></section>
<section class="panel"><div class="kicker"><span>Pipeline</span><span id="pipeinfo"></span></div><div class="pipe" id="pipe"></div></section>
<section class="panel"><div class="kicker"><span>Next 7 days · auto-scheduled</span><span id="schedinfo"></span></div><div class="cal" id="cal"></div></section>
<section class="panel"><div class="kicker"><span>Run log</span></div><pre class="log" id="log"></pre></section>
</main>
<dialog id="dlg"><div class="dlg-head"><strong id="dlg-title"></strong><div class="row"><button class="ghost" id="copy">Copy text</button><button class="ghost" id="close">Close</button></div></div><div class="dlg-body" id="dlg-body"></div></dialog>
<script>
const D = ${json};
const COLORS = ${JSON.stringify(PLATFORM_COLORS)};
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach(k => e.append(k)); return e; };
$("sub").textContent = "1 recording in → " + D.stats.pieces + " pieces out across " + D.stats.platforms + " platforms.";
$("src").textContent = D.source;
[["Pieces created", D.stats.pieces, "of " + D.stats.planned], ["Hours saved (est.)", D.stats.hours, "hours"], ["Platforms", D.stats.platforms, ""], ["Recording", D.stats.minutes, "min · " + D.stats.words.toLocaleString() + " words"], ["Best moments", D.stats.momentsKept, "of " + D.stats.momentsConsidered + " kept"]]
  .forEach(([k, v, s]) => $("stats").append(el("div", { className: "stat" }, el("div", { className: "kicker", textContent: k }), el("div", { className: "v" }, String(v), el("small", { textContent: s })))));
$("pipeinfo").textContent = "Run time " + D.stats.runtime;
D.agents.forEach(a => {
  const box = el("div", { className: "agent" }, el("div", { className: "badge", textContent: a.letter }), el("div", {}, el("div", { textContent: a.label, style: "font-weight:600" }), el("div", { className: a.error ? "err" : "files", textContent: a.error ? "failed: " + a.error.slice(0, 60) : a.platform })), el("div", { className: "n", textContent: a.done + "/" + a.planned }));
  box.querySelector(".badge").style.background = COLORS[a.platform];
  $("pipe").append(box);
});
$("schedinfo").textContent = D.schedule.items.length + " scheduled · " + D.timezone;
D.schedule.days.forEach((d, i) => {
  const col = el("div", { className: "day" }, el("h3", { textContent: d.label }));
  D.schedule.items.filter(it => it.day === i).sort((a, b) => a.time.localeCompare(b.time)).forEach(it => {
    const b = el("button", { className: "item" }, el("div", { className: "meta" }, el("span", { textContent: it.platform }), el("span", { textContent: it.time })), el("div", { className: "t", textContent: it.title }));
    b.style.setProperty("--c", COLORS[it.platform]);
    b.onclick = () => openPiece(it);
    col.append(b);
  });
  $("cal").append(col);
});
$("log").textContent = D.log.join("\\n");
let current = "";
function openPiece(it) {
  const p = D.pieces[it.file] || {};
  current = p.body || "";
  $("dlg-title").textContent = it.platform + " · " + it.date + " " + it.time;
  const body = $("dlg-body"); body.replaceChildren();
  if (it.clip) body.append(el("video", { src: it.clip, controls: true }));
  if (p.image) body.append(el("img", { src: p.image, alt: p.title || "" }));
  body.append(el("h3", { textContent: p.title || it.title, style: "margin-top:0" }), el("pre", { textContent: current }), el("p", { className: "files", textContent: "File: " + it.file }));
  $("dlg").showModal();
}
$("close").onclick = () => $("dlg").close();
$("copy").onclick = async () => { try { await navigator.clipboard.writeText(current); $("copy").textContent = "Copied"; setTimeout(() => $("copy").textContent = "Copy text", 1200); } catch {} };
</script>
</body>
</html>`;
}
