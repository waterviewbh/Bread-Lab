// lib/recipeHtml.ts
// ─── HTML generation + print/share actions ────────────────────────────────────
import { type SavedRecipe, type BakePhase, type ActiveBake } from "@/lib/recipeTypes";
import { scaleCheckableLines, formatDone } from "@/lib/recipeUtils";
import { SafePrint } from "./printUtils";

const COMMON_STYLE = `
  .recipe-info { margin: 0 0 10px }
  .recipe-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: #999; display: block; margin-bottom: 6px }
  .checklist { margin: 0; padding: 0; list-style: none }
  .checklist li { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; border-bottom: 1px solid #f0f0f0 }
  .checklist li:last-child { border-bottom: none }
  .checkbox { display: inline-block; flex-shrink: 0; width: 14px; height: 14px; border: 1.5px solid #555; border-radius: 2px; margin-top: 2px }
  .check-text { flex: 1; font-size: 13px; line-height: 1.5 }
  ol.checklist { list-style: none; counter-reset: step }
  ol.checklist li::before { counter-increment: step; content: counter(step) "."; font-size: 12px; color: #999; font-weight: 600; min-width: 18px; flex-shrink: 0; margin-top: 1px }
`;

export function buildRecipeHtml(recipe: SavedRecipe): string {
  const date = new Date(recipe.createdAt).toLocaleDateString([], {
    year: "numeric", month: "long", day: "numeric",
  });

  const phasesHtml = recipe.phases.map((p, i) => {
    const ingHtml = p.ingredients.filter(l => l.text.trim().length > 0).length > 0
      ? `<div class="recipe-info"><span class="recipe-label">Ingredients</span><ul class="checklist">${p.ingredients.map(l => `<li><span class="checkbox"></span><span class="check-text">${l.text}</span></li>`).join("")}</ul></div>`
      : "";
    const insHtml = p.instructions.filter(l => l.text.trim().length > 0).length > 0
      ? `<div class="recipe-info"><span class="recipe-label">Instructions</span><ol class="checklist">${p.instructions.map(l => `<li><span class="checkbox"></span><span class="check-text">${l.text}</span></li>`).join("")}</ol></div>`
      : "";
    return `<div class="phase"><div class="phase-header">Phase ${i + 1}: ${p.name}</div>${ingHtml}${insHtml}</div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${recipe.name}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:sans-serif;margin:0;padding:24px;color:#111;font-size:13px;line-height:1.6}
      h1{font-size:22px;margin:0 0 4px;font-weight:700}
      .meta{color:#888;font-size:12px;margin:0 0 20px}
      .phase{border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin-bottom:12px}
      .phase-header{font-size:14px;font-weight:600;margin-bottom:8px}
      ${COMMON_STYLE}
    </style>
  </head>
  <body>
    <h1>${recipe.name}</h1>
    <p class="meta">
      ${recipe.phases.length} phases
      ${recipe.yieldValue ? `· Yield: ${recipe.yieldValue}` : ""}
      · Created ${date}
    </p>
    ${recipe.overview ? `<p style="font-style:italic;margin-bottom:20px;color:#444">${recipe.overview}</p>` : ""}
    <h2>Phases</h2>
    ${phasesHtml}
  </body></html>`;
}

export function buildBakeHtml(bake: ActiveBake, bakeNotes: string, completedCount: number): string {
  const date = new Date(bake.startedAt).toLocaleDateString();
  const phasesHtml = bake.phases.map((p, i) => {
    const dur = p.startedAt && p.completedAt ? formatDone(p.completedAt - p.startedAt) : p.startedAt ? "In progress" : "Not started";
    const status = p.completedAt ? "✓" : "○";
    const ingHtml = p.ingredients.filter(l => l.text.trim().length > 0).length > 0
      ? `<div class="recipe-info"><span class="recipe-label">Ingredients</span><ul class="checklist">${p.ingredients.map(l => `<li><span class="checkbox"></span><span class="check-text">${l.text}</span></li>`).join("")}</ul></div>`
      : "";
    return `<div class="phase"><div class="phase-header">${status} Phase ${i + 1}: ${p.name} (${dur})</div>${ingHtml}</div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;padding:24px}.meta{color:#666;font-size:12px;margin-bottom:20px}${COMMON_STYLE}.phase{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:10px}.phase-header{font-weight:600;margin-bottom:8px}</style></head>
  <body>
    <h1>${bake.recipeName}</h1>
    <p class="meta">
      ${date} · ${completedCount}/${bake.phases.length} phases
      ${bake.yieldValue ? ` · Yield: ${bake.yieldValue}` : ""}
    </p>
    ${bakeNotes ? `<div style="background:#f9f9f9;padding:12px;border-radius:6px;margin-bottom:20px"><strong>Notes:</strong><br/>${bakeNotes.replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Phases</h2>
    ${phasesHtml}
  </body></html>`;
}

export async function printHtml(html: string) { await SafePrint.printHtml(html); }
export async function shareHtmlAsPdf(html: string, title: string) { await SafePrint.sharePdf(html, title); }