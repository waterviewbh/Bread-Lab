/* Pretty Print for v1.0.11 */
const printRecipe = async (r: SavedRecipe) => {
  const html = `
    <html>
      <head>
        <style>
          body { font-family: 'Helvetica', sans-serif; padding: 40px; color: #333; }
          h1 { color: #C4704F; border-bottom: 2px solid #eee; padding-bottom: 10px; }
          .yield { font-style: italic; color: #666; margin-bottom: 20px; }
          .phase { margin-bottom: 30px; }
          .phase-name { font-weight: bold; font-size: 1.2em; text-transform: uppercase; color: #444; }
          .ingredients { background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 10px 0; }
          .instructions { line-height: 1.6; }
        </style>
      </head>
      <body>
        <h1>${r.name}</h1>
        ${r.yieldValue ? `<p class="yield">Yields: ${r.yieldValue}</p>` : ''}
        ${r.phases.map(p => `
          <div class="phase">
            <div class="phase-name">${p.name}</div>
            ${p.ingredients ? `<div class="ingredients"><strong>Ingredients:</strong><br/>${p.ingredients.replace(/\n/g, '<br/>')}</div>` : ''}
            <div class="instructions">${p.instructions.replace(/\n/g, '<br/>')}</div>
          </div>
        `).join('')}
      </body>
    </html>
  `;
  await Print.printAsync({ html });
};

/* Current Code, starting at line 979 */
const printRecipe = async (r: SavedRecipe) => {
    const html = buildRecipeHtml(r);
    try {
      if (Platform.OS === "web") {
        const w = window.open("", "_blank");
        if (w) { w.document.write(html); w.document.close(); w.print(); }
      } else {
        await Print.printAsync({ html });
      }
    } catch {}
  };

/* Recipe Builder Card Distinction for v1.0.11 */
<TextInput
  multiline
  style={[
    s.phaseTextarea,
    {
      borderColor: colors.border,
      color: colors.foreground,
      backgroundColor: colors.background // Slight contrast from colors.card
    }
  ]}
  value={p.ingredients}
  onChangeText={t => updatePhaseField(p.key, "ingredients", t)}
  placeholder="Ingredients"
  placeholderTextColor={colors.mutedForeground}
  scrollEnabled={true} // Ensures scrolling works once maxHeight is hit
/>

<TextInput
  multiline
  style={[
    s.phaseTextarea,
    {
      borderColor: colors.border,
      color: colors.foreground,
      backgroundColor: colors.background
    }
  ]}
  value={p.instructions}
  onChangeText={t => updatePhaseField(p.key, "instructions", t)}
  placeholder="Instructions"
  placeholderTextColor={colors.mutedForeground}
  scrollEnabled={true}
/>

/* Current Code, starting at line 1730 */
<TextInput
  style={[
    s.phaseTextarea,
    {
      backgroundColor: colors.background,
      borderColor: colors.border,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
  ]}
  placeholder="e.g. 500g bread flour, 350g water, 100g levain…"
  placeholderTextColor={colors.mutedForeground}
  value={phase.ingredients}
  onChangeText={(v) => updatePhaseField(phase.key, "ingredients", v)}
  multiline
  numberOfLines={3}
  textAlignVertical="top"
/>

<Text style={[s.subFieldLabel, { color: colors.mutedForeground, marginTop: 10 }]}>
  Instructions
</Text>
<TextInput
  style={[
    s.phaseTextarea,
    {
      backgroundColor: colors.background,
      borderColor: colors.border,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
  ]}
  placeholder="e.g. Mix until shaggy, autolyse 30 min, then add salt…"
  placeholderTextColor={colors.mutedForeground}
  value={phase.instructions}
  onChangeText={(v) => updatePhaseField(phase.key, "instructions", v)}
  multiline
  numberOfLines={3}
  textAlignVertical="top"
/>
