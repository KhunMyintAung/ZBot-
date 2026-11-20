import { config } from "./config.js";

// Default posting time per platform (24h). A second piece on the same day goes in the backup slot.
const SLOTS = {
  Shorts: ["09:00", "15:00", "19:00"],
  X: ["12:30", "08:30", "18:00"],
  LinkedIn: ["17:00", "08:00", "12:00"],
  Instagram: ["20:00", "12:00", "17:30"],
  Email: ["09:00", "07:00", "16:00"],
  Blog: ["08:00", "13:00", "18:00"],
};

function startDay() {
  if (config.startDate) return new Date(`${config.startDate}T00:00:00`);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Spread every platform's pieces evenly across 7 days. */
export function buildSchedule(results) {
  const start = startDay();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return {
      date: isoDate(d),
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    };
  });
  const items = [];
  for (const { agent, pieces } of Object.values(results)) {
    const n = pieces.length;
    const usedPerDay = {};
    pieces.forEach((piece, i) => {
      const day = Math.min(6, Math.floor(((i + 0.5) * 7) / n));
      const slotIdx = usedPerDay[day] ?? 0;
      usedPerDay[day] = slotIdx + 1;
      const slots = SLOTS[agent.platform];
      items.push({
        day,
        date: days[day].date,
        time: slots[Math.min(slotIdx, slots.length - 1)],
        platform: agent.platform,
        agent: agent.key,
        title: piece.title,
        file: piece.file,
        clip: piece.clip ?? null,
        media: piece.clip ?? piece.image ?? null,
      });
    });
  }
  items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { days, items };
}

export function scheduleToCsv({ items }) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["date", "time", "platform", "title", "content_file", "media_file"]];
  for (const it of items) rows.push([it.date, it.time, it.platform, it.title, it.file, it.media ?? ""]);
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
