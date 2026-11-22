import { computeSessionAcidVelocity } from "./analytics";
import { flourChapter, hydrationSlice, parseRatioStr } from "./feedCoordinate";

export interface FeedReportEntry {
  id: string;
  savedAt: number;
  completedAt?: number;
  starterWeight: string;
  ratioStr: string;
  flourWeight: number;
  waterWeight: number;
  wwPercent: number;
  initialPH: string;
  initialTemp?: string;
  initialTempUnit?: "F" | "C";
  peak?: {
    pH: string;
    temp?: string;
    tempUnit?: "F" | "C";
    loggedAt: number;
    volumeIncreasePct: number;
    timeToPeakMs: number;
  };
  readings?: { pH: string; temp: string; tempUnit?: "F" | "C"; note: string; loggedAt: number }[];
  sugarWeight?: number;
}

const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
);
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const elapsed = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const graphNotes: Record<string, string> = {
  Acidification: "Average pH drop per hour during this feed. When available, the comparison shows change from the last measurable feed. Rate alone is not a health score.",
  "Peak time + rise": "Bar: hours to peak. Triangle: volume rise at peak. The paired axes align 4 hours with 100% rise.",
  Workload: "Flour workload increases left to right; each column runs stiff to slack. Dot height shows hours to peak; a filled dot means at least 100% rise.",
};
const frame = (title: string, svg: string, caption: string): string =>
  `<div class="panel"><strong>${title}</strong>${svg}<div class="caption">${caption}</div><p class="graph-note">${graphNotes[title]}</p></div>`;

function acidGraph(entry: FeedReportEntry, history: FeedReportEntry[]): string {
  const current = computeSessionAcidVelocity(entry);
  if (current === null || !valid(current)) return frame("Acidification", '<div class="empty">Insufficient pH readings</div>', "ΔpH per hour");
  const prior = history
    .filter(s => s.id !== entry.id && s.savedAt < entry.savedAt)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(s => ({ entry: s, value: computeSessionAcidVelocity(s) }))
    .find(p => p.value !== null && valid(p.value));
  const max = Math.max(current, prior?.value ?? current, 0.1);
  const y = (n: number) => 108 - Math.max(0, n) / max * 76;
  const dots = prior
    ? `<line x1="48" y1="${y(prior.value!)}" x2="160" y2="${y(current)}" stroke="#b48470" stroke-width="2"/>
       <circle cx="48" cy="${y(prior.value!)}" r="5" fill="#b48470"/>
       <text x="48" y="123" text-anchor="middle">Prior</text>`
    : "";
  const svg = `<svg viewBox="0 0 210 132" role="img" aria-label="Acidification comparison">
    <line x1="34" y1="32" x2="34" y2="108" stroke="#8b796e"/>
    <line x1="34" y1="108" x2="190" y2="108" stroke="#8b796e"/>
    <line x1="34" y1="32" x2="190" y2="32" stroke="#e3d8cf" stroke-dasharray="2 3"/>
    <text x="30" y="35" text-anchor="end">${max.toFixed(2)}</text>
    <text x="30" y="111" text-anchor="end">0</text>
    <text x="2" y="16">pH/hr</text>
    ${dots}<circle cx="160" cy="${y(current)}" r="7" fill="#ae5d3c"/>
    <text x="160" y="123" text-anchor="middle">This feed</text></svg>`;
  const delta = prior ? current - prior.value! : null;
  const comparison = delta === null ? "No prior comparable feed" :
    `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${Math.abs(delta).toFixed(2)} vs ${new Date(prior!.entry.savedAt).toLocaleDateString()}`;
  return frame("Acidification", svg, `<b>${current.toFixed(2)} pH/hr</b><br/>${esc(comparison)}`);
}

function liftingGraph(entry: FeedReportEntry): string {
  const peak = entry.peak;
  if (!peak || !valid(peak.timeToPeakMs) || !valid(peak.volumeIncreasePct))
    return frame("Peak time + rise", '<div class="empty">Peak not recorded</div>', "Hours and volume increase");
  const hours = peak.timeToPeakMs / 3600000;
  const scale = Math.max(hours / 4, peak.volumeIncreasePct / 100, 1) * 1.25;
  const barH = Math.min(76, hours / (4 * scale) * 76);
  const triangleY = 108 - Math.min(76, peak.volumeIncreasePct / (100 * scale) * 76);
  const leftMax = 4 * scale;
  const rightMax = 100 * scale;
  const svg = `<svg viewBox="0 0 210 132" role="img" aria-label="Peak time and rise">
    <line x1="33" y1="32" x2="33" y2="108" stroke="#8b796e"/>
    <line x1="33" y1="108" x2="177" y2="108" stroke="#8b796e"/>
    <line x1="177" y1="32" x2="177" y2="108" stroke="#8b796e"/>
    <line x1="33" y1="70" x2="177" y2="70" stroke="#e3d8cf" stroke-dasharray="2 3"/>
    <text x="30" y="35" text-anchor="end">${leftMax.toFixed(1)}h</text>
    <text x="30" y="111" text-anchor="end">0</text>
    <text x="180" y="35">${rightMax.toFixed(0)}%</text>
    <text x="180" y="111">0</text>
    <rect x="88" y="${108 - barH}" width="34" height="${barH}" fill="#ae5d3c"/>
    <polygon points="105,${triangleY - 7} 97,${triangleY + 7} 113,${triangleY + 7}" fill="white" stroke="#ae5d3c" stroke-width="2"/>
    <text x="105" y="123" text-anchor="middle">This feed</text></svg>`;
  return frame("Peak time + rise", svg, `<b>${elapsed(peak.timeToPeakMs)} to peak</b><br/>+${esc(peak.volumeIncreasePct)}% rise`);
}

function workloadGraph(entry: FeedReportEntry): string {
  const ratio = parseRatioStr(entry.ratioStr);
  const peak = entry.peak;
  if (!ratio || !peak || !valid(peak.timeToPeakMs))
    return frame("Workload", '<div class="empty">Ratio or peak unavailable</div>', "Flour workload and hydration");
  const chapters = [1, 2, 5, 10];
  const slices = ["stiff", "standard", "slack"];
  const chapter = flourChapter(ratio.flour);
  const slice = hydrationSlice(ratio.flour, ratio.water);
  const x = 28 + chapters.indexOf(chapter) * 43 + (slices.indexOf(slice) + 0.5) * (43 / 3);
  const hours = peak.timeToPeakMs / 3600000;
  const maxHours = Math.ceil(Math.max(8, hours * 1.25));
  const y = 100 - hours / maxHours * 70;
  const bands = chapters.map((ch, i) =>
    `<rect x="${28 + i * 43}" y="20" width="43" height="80" fill="${i % 2 ? "#f7f0eb" : "#fcf9f6"}" stroke="#e3d8cf"/>
     <text x="${49.5 + i * 43}" y="118" text-anchor="middle">${ch}×</text>`
  ).join("");
  const filled = peak.volumeIncreasePct >= 100 ? '#ae5d3c' : 'white';
  const svg = `<svg viewBox="0 0 210 132" role="img" aria-label="Workload position">
    ${bands}
    <line x1="28" y1="30" x2="28" y2="100" stroke="#8b796e"/>
    <line x1="28" y1="100" x2="200" y2="100" stroke="#8b796e"/>
    <text x="25" y="33" text-anchor="end">${maxHours}h</text>
    <text x="25" y="103" text-anchor="end">0</text>
    <circle cx="${x}" cy="${y}" r="7" fill="${filled}" stroke="#ae5d3c" stroke-width="2"/></svg>`;
  return frame("Workload", svg, `<b>${chapter}× · ${esc(slice)}</b><br/>${elapsed(peak.timeToPeakMs)} to peak`);
}

export function buildFeedReportHtml(entry: FeedReportEntry, history: FeedReportEntry[], fedPhoto?: string | null): string {
  const completed = entry.completedAt ?? entry.peak?.loggedAt ??
    (entry.peak ? entry.savedAt + entry.peak.timeToPeakMs : undefined);
  const wheat = (entry.wwPercent ?? 0) > 0 ? `Whole wheat ${esc(entry.wwPercent)}%` : "Whole wheat 0%";
  const sugar = (entry.sugarWeight ?? 0) > 0 ? ` · Sugar ${esc(entry.sugarWeight)} g` : "";
  const observations = [
    ...(entry.initialPH || entry.initialTemp ? [{
      time: entry.savedAt, kind: "Initial", ph: entry.initialPH,
      temp: entry.initialTemp, unit: entry.initialTempUnit, note: ""
    }] : []),
    ...(entry.readings ?? []).map(r => ({
      time: r.loggedAt, kind: "Reading", ph: r.pH, temp: r.temp, unit: r.tempUnit, note: r.note
    })),
    ...(entry.peak ? [{
      time: entry.peak.loggedAt || entry.savedAt + entry.peak.timeToPeakMs,
      kind: "Peak", ph: entry.peak.pH, temp: entry.peak.temp,
      unit: entry.peak.tempUnit, note: `+${entry.peak.volumeIncreasePct}% rise`
    }] : [])
  ].sort((a, b) => a.time - b.time);
  const rows = observations.map(r => `<tr><td>${esc(clock(r.time))}</td>
    <td>${esc(elapsed(r.time - entry.savedAt))}</td><td>${esc(r.ph || "—")}</td>
    <td>${r.temp ? `${esc(r.temp)}°${esc(r.unit ?? "F")}` : "—"}</td>
    <td>${esc(r.kind)}${r.note ? ` · ${esc(r.note)}` : ""}</td></tr>`).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
@page { margin: 15mm; } body { font: 12px Arial,sans-serif; color:#2a1508; }
h1 { font-size:24px; margin:0 0 6px; } h2 { font-size:15px; margin:22px 0 8px; }
.meta { line-height:1.6; } .graphs { width:100%; border-spacing:7px; table-layout:fixed; margin:18px 0; }
.graphs td { width:33.33%; vertical-align:top; padding:0; }
.panel { border:1px solid #e3d8cf; border-radius:6px; padding:8px; min-height:165px; }
.panel strong { font-size:11px; } .panel svg { display:block; width:100%; height:112px; }
.panel svg text { font:9px Arial,sans-serif; fill:#6c625b; }
.caption { font-size:10px; line-height:1.4; }
.graph-note { font-size:9px; line-height:1.35; color:#6c625b; margin:7px 0 0; }
.empty { height:112px; display:flex; align-items:center; color:#6c625b; }
.timeline { width:100%; border-collapse:collapse; } .timeline th,.timeline td {
border-bottom:1px solid #e3d8cf; text-align:left; padding:6px 5px; vertical-align:top; }
.timeline th { background:#f7f0eb; } tr { page-break-inside:avoid; }
</style></head><body>
<h1>Feed Session</h1>
<div class="meta"><b>${esc(new Date(entry.savedAt).toLocaleDateString())}</b> ·
Started ${esc(clock(entry.savedAt))} · Ended ${completed ? esc(clock(completed)) : "Not recorded"}<br/>
Ratio ${esc(entry.ratioStr)} · ${wheat}${sugar}<br/>
Starter ${esc(entry.starterWeight)} g · Flour ${esc(entry.flourWeight)} g · Water ${esc(entry.waterWeight)} g
</div>
<table class="graphs"><tr><td>${acidGraph(entry, history)}</td><td>${liftingGraph(entry)}</td><td>${workloadGraph(entry)}</td></tr></table>
<h2>Reading timeline</h2>
<table class="timeline"><thead><tr><th>Time</th><th>Elapsed</th><th>pH</th><th>Temp</th><th>Observation</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No readings recorded</td></tr>'}</tbody></table>
${fedPhoto ? `<p><img src="${esc(fedPhoto)}" alt="Feed photo" style="max-width:160px;max-height:120px;object-fit:contain"/></p>` : ""}
</body></html>`;
}
