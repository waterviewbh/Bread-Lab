// constants/diagnosticContents.ts

export interface DiagnosticScienceArticle {
  title: string;
  mechanics: string;
  primaryDriver: string;
  secondaryDrivers: string[];
  interventionAction: string;
  logicBoundary: string;
}

export const DIAGNOSTIC_SCIENCE: Record<string, DiagnosticScienceArticle> = {
  fools_crumb: {
    title: "The Science of Fool's Crumb",
    mechanics: "Fool’s crumb presents as large, dramatic caverns near the top crust while the lower interior remains dense, gummy, and tightly packed. This occurs when the dough is shaped and baked before microbial gas production reaches critical mass. The small amount of CO2 produced during a premature bulk fermentation expands rapidly under thermal stress (steam and heat during spring), floating to the top surface and leaving an un-aerated, dense matrix below.",
    primaryDriver: "Bulk Fermentation Duration / Temperature",
    secondaryDrivers: ["Starter Inoculation %", "Levain Peak Acidity", "Dough Temperature"],
    interventionAction: "Increase Bulk Fermentation Duration (+45 to +60 minutes).",
    logicBoundary: "If average dough temperature is < 70°F (21°C), elevate proof box/dough temperature to 78°F (26°C) before increasing bulk time."
  },
  over_proofed: {
    title: "The Science of Over-Proofing",
    mechanics: "Over-proofing happens when microbial fermentation proceeds past the gluten matrix's ability to hold gas. As bacteria and yeast produce organic acids (lactic and acetic acid), the pH of the dough drops significantly. Extended exposure to low pH, combined with high enzymatic activity (protease breaking down proteins), degrades the gluten network. During the bake, the weakened structure cannot support internal steam pressure, causing the loaf to expand initially and then collapse flat, yielding a pale, matte crust due to sugar exhaustion.",
    primaryDriver: "Total Fermentation Duration (Bulk + Retard)",
    secondaryDrivers: ["Fermentation Temperature", "Levain Inoculation %"],
    interventionAction: "Reduce Bulk Fermentation Duration (-30 to -45 minutes) OR Shorten Vault Retard (-4 hours).",
    logicBoundary: "If cold retarding at 38°F, scale retard time step down to -4 hours."
  },
  gummy_crumb: {
    title: "Starch Gelatinization & Gummy Crumb",
    mechanics: "A gummy or wet crumb feels rubbery, sticky, and damp even hours after cooling. Starch gelatinization occurs when wheat starches absorb water and swell under heat (typically above 180°F / 82°C), eventually setting into a solid structure as internal temperature reaches 208°F (98°C). Gummyness happens when internal core temperature does not remain in the gelatinization zone long enough, when hydration exceeds starch absorption capacity, or when high alpha-amylase activity from over-fermentation breaks down starch matrices into liquid sugars.",
    primaryDriver: "Thermal Bake Duration & Internal Core Temperature",
    secondaryDrivers: ["Total Hydration %", "Slicing Temperature/Cooling Duration", "Fermentation Extent"],
    interventionAction: "Extend Open/Covered Bake Duration (+5 to +8 minutes).",
    logicBoundary: "If core temperature comfortably hits 208°F+ (98°C+) and cooling exceeds 2 hours, reduce total hydration by -2% to -3%."
  },
  dense_crumb: {
    title: "Dense Crumb (Uniformly Closed)",
    mechanics: "A dense, heavy, or cake-like crumb exhibits tiny, tightly clustered air cells evenly distributed throughout the loaf. Unlike Fool’s Crumb (which is under-fermented and uneven), a uniformly dense crumb indicates proper gas production that was either mechanically degassed during handling or physically restricted by a tight, low-hydration gluten matrix. High proportions of whole grain bran can also act like micro-blades, shearing gluten strands and preventing gas cell expansion.",
    primaryDriver: "Dough Handling & Shaping Tension",
    secondaryDrivers: ["Hydration %", "Whole Grain / Bran Ratio", "Inclusion Shear"],
    interventionAction: "Reduce Shaping Tension / Preshape Intensity.",
    logicBoundary: "If dough handling was gentle, increase total hydration by +3% to reduce matrix stiffness."
  },
  under_proofed: {
    title: "The Science of Under-Proofing",
    mechanics: "Under-proofing occurs when dough enters the oven before accumulating sufficient gas volume and acid maturity throughout the structure. While similar to Fool's Crumb, a general under-proof manifests as tight, small-pored crumb structures with stiff, rubbery, pale walls and excessive, tearing spring along unexpected score lines. Yeast cell counts have not multiplied sufficiently to generate steady CO2 pressure across the dough core.",
    primaryDriver: "Bulk Fermentation Volumetric Target / Time",
    secondaryDrivers: ["Ambient Fermentation Temperature", "Levain Inoculation %"],
    interventionAction: "Extend Bulk Fermentation until volumetric expansion increases by another +15% to +20%.",
    logicBoundary: "Ensure dough temperature on the bench is maintained between 78°F and 82°F (26°C–28°C)."
  },
  pale_crust: {
    title: "Sugar Exhaustion & Pale Crust",
    mechanics: "A pale, dull, or matte crust lacks deep caramelization and mahogany tones. Crust browning relies on the Maillard reaction (the chemical reaction between amino acids and reducing sugars under heat). If bulk fermentation or cold retarding is extended too long, wild yeast and lactic acid bacteria consume all simple sugars in the dough matrix. When placed in the oven, there are no residual sugars left on the surface to caramelize under radiant heat.",
    primaryDriver: "Fermentation Extent (Sugar Exhaustion)",
    secondaryDrivers: ["Oven Temperature / Thermal Mass", "Steam Phase Duration"],
    interventionAction: "Reduce Bulk Fermentation Duration (-30 minutes) to preserve surface sugars.",
    logicBoundary: "If fermentation timing was optimal, check initial vessel/stone temperature to ensure preheat achieved 450°F+ (230°C+)."
  },
  stuck_banneton: {
    title: "Surface Bonding & Mold Adhesion",
    mechanics: "Dough sticking to a proofing basket (banneton) or baking mold (Pullman/loaf pan) occurs when surface moisture dissolves the flour/oil barrier and hydrates the container wall. Higher hydration doughs continuously push water out to the perimeter via osmotic pressure. If surface dusting flour lacks adequate starch resistance (or if pan release oil/butter absorbed into the dough during proofing), protein strands bond directly to the vessel wall, tearing the outer gluten skin upon release.",
    primaryDriver: "Surface Dusting / Pan Lubrication Barrier",
    secondaryDrivers: ["Cold Retard Condensation / Humidity", "Surface Skin Tension during Shaping"],
    interventionAction: "Switch surface dusting to a 50/50 Rice Flour & Whole Wheat blend (or increase pan release lubricant).",
    logicBoundary: "Ensure final shaping establishes adequate outer skin tension to restrict water migration to the surface."
  },
  weak_spring: {
    title: "Steam Physics & Weak Oven Spring",
    mechanics: "A weak spring or missing \"ear\" occurs when the score line fails to peel back and bloom upward during the first 10–15 minutes of baking. Oven spring requires a delicate race: internal water converts to steam and CO2 expands rapidly before the outer crust hardens. If the baking environment lacks humidity (steam), the outer starch layer dries out instantly, locking the loaf in place and trapping expansion. Alternatively, improper scoring angle or weak final shaping tension prevents the score from opening clean.",
    primaryDriver: "Steam Delivery & Humidity during Spring",
    secondaryDrivers: ["Scoring Angle & Cut Depth", "Surface Tension", "Over-Proofing"],
    interventionAction: "Increase Steam Volume / Steam Trap Duration during initial 15 minutes of bake.",
    logicBoundary: "If steam setup is optimal, adjust blade scoring angle to 30° relative to the loaf surface."
  }
};
