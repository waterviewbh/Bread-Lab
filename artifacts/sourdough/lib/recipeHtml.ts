// lib/recipeHtml.ts
// ─── HTML generation + print/share actions ────────────────────────────────────
// No React, no hooks, no component state. All HTML builders are pure functions.
// Print/share functions are async-pure: they call Expo APIs but never setState.
import { Alert, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { type SavedRecipe, type BakePhase, type ActiveBake } from "@/lib/recipeTypes";
import { scalePhaseText, formatDone } from "@/lib/recipeUtils";

// ─── buildRecipeHtml ──────────────────────────────────────────────────────────
// Produces a standalone printable HTML doc for a recipe from the builder.
export function buildRecipeHtml(recipe: SavedRecipe): string {
  const date = new Date(recipe.createdAt).toLocaleDateString([], {
    year: "numeric", month: "long", day: "numeric",
  });  const phasesHtml = recipe.phases
    .map((p, i) => {
      // Fold tracker circles — rendered as empty circles to tick with a pen
      const foldHtml = p.key === "stretching_folding"
        ? `<div class="fold-row"><span class="recipe-label">Folds</span>
             <div class="fold-circles">
               <div class="fold-circle"></div>
               <div class="fold-circle"></div>
               <div class="fold-circle"></div>
               <div class="fold-circle"></div>
             </div>
           </div>`
        : "";      // Split ingredients on newlines; render each non-empty line as a checkbox row
      const ingLines = (p.ingredients ?? "").split("\n").filter((l) => l.trim());
      const ingHtml = ingLines.length > 0
        ? `<div class="recipe-info">
             <span class="recipe-label">Ingredients</span>
             <ul class="checklist">
               ${ingLines.map((line) => `<li><span class="checkbox"></span><span class="check-text">${line}</span></li>`).join("")}
             </ul>
           </div>`
        : "";      // Split instructions on newlines; render each non-empty line as a numbered checkbox row
      const insLines = (p.instructions ?? "").split("\n").filter((l) => l.trim());
      const insHtml = insLines.length > 0
        ? `<div class="recipe-info">
             <span class="recipe-label">Instructions</span>
             <ol class="checklist">
               ${insLines.map((line) => `<li><span class="checkbox"></span><span class="check-text">${line}</span></li>`).join("")}
             </ol>
           </div>`
        : "";      const empty = !p.ingredients && !p.instructions
        ? `<p class="recipe-empty">No ingredients or instructions added.</p>`
        : "";      return `<div class="phase"><div class="phase-header">Phase ${i + 1}: ${p.name}</div>${foldHtml}${ingHtml}${insHtml}${empty}</div>`;
    })
    .join("");  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${recipe.name}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:24px;color:#111;font-size:13px;line-height:1.6}
      h1{font-size:22px;margin:0 0 4px;font-weight:700}
      h2{font-size:14px;font-weight:600;margin:20px 0 10px;color:#555}
      .meta{color:#888;font-size:12px;margin:0 0 20px}
      .phase{border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin-bottom:12px}
      .phase-header{font-size:14px;font-weight:600;margin-bottom:8px}
      .recipe-info{margin:0 0 10px}
      .recipe-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#999;display:block;margin-bottom:6px}
      .recipe-text{margin:0;white-space:pre-wrap}      /* Checklist rows — ingredients (ul) and instructions (ol) */
      .checklist{margin:0;padding:0;list-style:none}
      .checklist li{display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px solid #f0f0f0}
      .checklist li:last-child{border-bottom:none}
      /* Printable tick box: a bordered square the reader checks with a pen */
      .checkbox{display:inline-block;flex-shrink:0;width:14px;height:14px;border:1.5px solid #555;border-radius:2px;margin-top:2px}
      .check-text{flex:1;font-size:13px;line-height:1.5}
      /* Numbered instructions keep their counter in the li::marker */
      ol.checklist{list-style:none;counter-reset:step}
      ol.checklist li::before{counter-increment:step;content:counter(step) ".";font-size:12px;color:#999;font-weight:600;min-width:18px;flex-shrink:0;margin-top:1px}      .fold-row{margin:0 0 10px;display:flex;align-items:center;gap:10px}
      .fold-circles{display:flex;gap:8px}
      .fold-circle{width:18px;height:18px;border-radius:50%;border:2px solid #555;background:transparent}
      .recipe-empty{color:#bbb;font-style:italic;margin:0}
      .footer{margin-top:24px;color:#aaa;font-size:11px;text-align:center}
      @media print{body{padding:16px}.phase{break-inside:avoid}.checklist li{break-inside:avoid}}
    </style>
  </head>
  <body>
    <h1>${recipe.name}</h1>
    <p class="meta">${recipe.phases.length} ${recipe.phases.length === 1 ? "phase" : "phases"} · Created ${date}</p>
    <h2>Phases</h2>
    ${phasesHtml}
    <p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p>
  </body>
</html>`;
}

// ─── buildPhaseHtml ───────────────────────────────────────────────────────────
// Produces a single-phase spec sheet. Quantities are scaled by multiplier.
export function buildPhaseHtml(
  phase: BakePhase,
  recipeName: string,
  multiplier: number
): string {
  const scaledIngredients = phase.ingredients
    ? scalePhaseText(phase.ingredients, multiplier)
    : "";
  const scaledInstructions = phase.instructions
    ? scalePhaseText(phase.instructions, multiplier)
    : "";
  const scaleNote = multiplier !== 1 ? ` · ${multiplier}× batch` : "";
  const ingHtml = scaledIngredients
    ? `<div class="section"><span class="label">Ingredients</span><p class="text">${scaledIngredients.replace(/\n/g, "<br>")}</p></div>`
    : "";
  const insHtml = scaledInstructions
    ? `<div class="section"><span class="label">Instructions</span><p class="text">${scaledInstructions.replace(/\n/g, "<br>")}</p></div>`
    : "";
  const emptyHtml = !scaledIngredients && !scaledInstructions
    ? `<p class="empty">No ingredients or instructions defined for this phase.</p>`
    : "";  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${phase.name} — ${recipeName}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:28px;color:#111;font-size:14px;line-height:1.6}h1{font-size:22px;margin:0 0 4px;font-weight:700}.recipe{color:#888;font-size:13px;margin:0 0 24px}.section{margin-bottom:20px}.label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#999;display:block;margin-bottom:6px}.text{margin:0;white-space:pre-wrap;color:#333;font-size:14px;line-height:1.6}.empty{color:#bbb;font-style:italic;margin:0}.footer{margin-top:32px;color:#aaa;font-size:11px;text-align:center}@media print{body{padding:20px}}</style></head><body><h1>${phase.name}</h1><p class="recipe">${recipeName}${scaleNote}</p>${ingHtml}${insHtml}${emptyHtml}<p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p></body></html>`;
}

// ─── buildBakeHtml ────────────────────────────────────────────────────────────
// Produces a full bake summary doc. completedCount is passed in because it is
// a derived value computed in the component — we don't recompute it here.
export function buildBakeHtml(
  bake: ActiveBake,
  bakeNotes: string,
  completedCount: number
): string {
  const date = new Date(bake.startedAt).toLocaleDateString([], {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const totalDur = bake.phases.reduce((acc, p) => {
    if (p.startedAt && p.completedAt) return acc + (p.completedAt - p.startedAt);
    return acc;
  }, 0);  const phasesHtml = bake.phases
    .map((p, i) => {
      const dur = p.startedAt && p.completedAt
        ? formatDone(p.completedAt - p.startedAt)
        : p.startedAt ? "In progress" : "Not started";
      const status = p.completedAt ? "✓" : p.startedAt ? "●" : "○";
      const lastVol = p.readings.filter((r) => r.volume).at(-1)?.volume;
      const volLine = p.startVolume || lastVol
        ? `<p class="vol">Volume: ${p.startVolume || "—"} → ${lastVol || "—"}</p>`
        : "";
      const readingsHtml = p.readings.length > 0
        ? `<table class="readings"><thead><tr><th>Time</th><th>Temp</th><th>pH</th><th>Volume</th><th>Note</th></tr></thead><tbody>${p.readings
            .map((r) =>
              `<tr><td>${new Date(r.loggedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td><td>${r.temp ? `${r.temp}°${r.tempUnit}` : "—"}</td><td>${r.pH ? `pH ${r.pH}` : "—"}</td><td>${r.volume || "—"}</td><td>${r.note || "—"}</td></tr>`
            )
            .join("")}</tbody></table>`
        : "";
      const ingHtml = p.ingredients
        ? `<div class="recipe-info"><span class="recipe-label">Ingredients</span><p class="recipe-text">${p.ingredients.replace(/\n/g, "<br>")}</p></div>`
        : "";
      const insHtml = p.instructions
        ? `<div class="recipe-info"><span class="recipe-label">Instructions</span><p class="recipe-text">${p.instructions.replace(/\n/g, "<br>")}</p></div>`
        : "";
      // Fold circles — filled circles for completed folds in the bake summary
      const foldHtml = p.key === "stretching_folding"
        ? (() => {
            const count = (p as BakePhase & { foldCount?: number }).foldCount ?? 0;
            const circles = [0, 1, 2, 3]
              .map((i) =>
                `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #6E7558;background:${i < count ? "#6E7558" : "transparent"};margin-right:5px"></span>`
              )
              .join("");
            return `<p style="margin:4px 0 8px"><span style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px">Folds</span><br/>${circles}</p>`;
          })()
        : "";
      return `<div class="phase"><div class="phase-header"><span class="phase-status">${status}</span> Phase ${i + 1}: ${p.name} <span class="dur">${dur}</span></div>${ingHtml}${insHtml}${foldHtml}${volLine}${readingsHtml}</div>`;
    })
    .join("");  const notesHtml = bakeNotes
    ? `<div class="notes"><strong>Bake Notes</strong><p>${bakeNotes.replace(/\n/g, "<br>")}</p></div>`
    : "";  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${bake.recipeName} — ${date}</title><style>*{box-sizing:border-box}body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:24px;color:#111;font-size:13px;line-height:1.5}h1{font-size:20px;margin:0 0 4px;font-weight:700}h2{font-size:14px;font-weight:600;margin:0 0 16px;color:#555}.meta{color:#666;margin:0 0 20px;font-size:12px}.notes{background:#f9f6f0;border-radius:6px;padding:12px 16px;margin-bottom:20px;border:1px solid #e8e0d4}.notes p{margin:6px 0 0}.phase{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin-bottom:10px}.phase-header{font-size:14px;font-weight:600;margin-bottom:6px}.phase-status{display:inline-block;width:16px}.dur{color:#777;font-weight:400;font-size:12px;margin-left:6px}.vol{margin:4px 0;color:#666;font-size:12px}table.readings{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}th{text-align:left;color:#888;border-bottom:1px solid #eee;padding:3px 6px;font-weight:500}td{padding:3px 6px;border-bottom:1px solid #f5f5f5}.footer{margin-top:24px;color:#aaa;font-size:11px;text-align:center}.recipe-info{margin:6px 0 8px}.recipe-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#999;display:block;margin-bottom:3px}.recipe-text{margin:0;white-space:pre-wrap;color:#555}@media print{body{padding:16px}.phase{break-inside:avoid}}</style></head><body><h1>${bake.recipeName}</h1><p class="meta">${date} · ${completedCount}/${bake.phases.length} phases${totalDur > 0 ? " · Total active time: " + formatDone(totalDur) : ""}</p>${notesHtml}<h2>Phases</h2>${phasesHtml}<p class="footer">Bread Lab · ${new Date().toLocaleDateString()}</p></body></html>`;
}

// ─── Print / Share actions ────────────────────────────────────────────────────
// These call Expo APIs. No state mutations — callers handle their own error UI.
export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  await Print.printAsync({ html });
}

export async function shareHtmlAsPdf(html: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === "web") {
    // Web falls back to print dialog — no native share sheet available
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    return;
  }
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    Alert.alert("Sharing not available", "Sharing is not supported on this device.");
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle,
    UTI: "com.adobe.pdf",
  });
}