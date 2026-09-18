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
    mechanics: "Fool’s crumb presents as large, dramatic caverns near the top crust while the lower interior remains dense, gummy, and tightly packed. This occurs when the dough is shaped and baked before microbial gas production reaches critical mass.",
    primaryDriver: "Bulk Fermentation Duration / Temperature",
    secondaryDrivers: ["Starter Inoculation %", "Levain Peak Acidity", "Dough Temperature"],
    interventionAction: "Increase Bulk Fermentation Duration (+45 to +60 minutes).",
    logicBoundary: "If average dough temperature is < 70°F (21°C), elevate proof box/dough temperature to 78°F (26°C) before increasing bulk time."
  },
  pancake_profile: {
    title: "The Science of Over-Proofing",
    mechanics: "Over-proofing (manifesting as a pancake profile) happens when microbial fermentation proceeds past the gluten matrix's ability to hold gas. Extended exposure to low pH, combined with high enzymatic activity, degrades the gluten network.",
    primaryDriver: "Total Fermentation Duration (Bulk + Retard)",
    secondaryDrivers: ["Fermentation Temperature", "Levain Inoculation %"],
    interventionAction: "Reduce Bulk Fermentation Duration (-30 to -45 minutes) OR Shorten Vault Retard (-4 hours).",
    logicBoundary: "If cold retarding at 38°F, scale retard time step down to -4 hours."
  },
  gummy_bottom: {
    title: "Starch Gelatinization & Gummy Crumb",
    mechanics: "A gummy or wet bottom feels rubbery, sticky, and damp. Gummyness happens when internal core temperature does not remain in the gelatinization zone long enough, or when hydration exceeds starch absorption capacity.",
    primaryDriver: "Thermal Bake Duration & Internal Core Temperature",
    secondaryDrivers: ["Total Hydration %", "Slicing Temperature/Cooling Duration", "Fermentation Extent"],
    interventionAction: "Extend Open/Covered Bake Duration (+5 to +8 minutes).",
    logicBoundary: "If core temperature comfortably hits 208°F+ (98°C+) and cooling exceeds 2 hours, reduce total hydration by -2% to -3%."
  },
  dense_crumb: {
    title: "Dense Crumb (Uniformly Closed)",
    mechanics: "A dense, heavy, or cake-like crumb indicates proper gas production that was either mechanically degassed during handling or physically restricted by a tight, low-hydration gluten matrix.",
    primaryDriver: "Dough Handling & Shaping Tension",
    secondaryDrivers: ["Hydration %", "Whole Grain / Bran Ratio", "Inclusion Shear"],
    interventionAction: "Reduce Shaping Tension / Preshape Intensity.",
    logicBoundary: "If dough handling was gentle, increase total hydration by +3% to reduce matrix stiffness."
  },
  collapsed_score: {
    title: "The Science of Under-Proofing",
    mechanics: "Under-proofing occurs when dough enters the oven before accumulating sufficient gas volume. It manifests as tight, small-pored crumb structures or collapsed/sealed score lines.",
    primaryDriver: "Bulk Fermentation Volumetric Target / Time",
    secondaryDrivers: ["Ambient Fermentation Temperature", "Levain Inoculation %"],
    interventionAction: "Extend Bulk Fermentation until volumetric expansion increases by another +15% to +20%.",
    logicBoundary: "Ensure dough temperature on the bench is maintained between 78°F and 82°F (26°C–28°C)."
  },
  pale_crust: {
    title: "Sugar Exhaustion & Pale Crust",
    mechanics: "A pale, dull, or matte crust lacks deep caramelization. If fermentation is extended too long, wild yeast and bacteria consume all simple sugars, leaving none on the surface to caramelize.",
    primaryDriver: "Fermentation Extent (Sugar Exhaustion)",
    secondaryDrivers: ["Oven Temperature / Thermal Mass", "Steam Phase Duration"],
    interventionAction: "Reduce Bulk Fermentation Duration (-30 minutes) to preserve surface sugars.",
    logicBoundary: "If fermentation timing was optimal, check initial vessel/stone temperature to ensure preheat achieved 450°F+ (230°C+)."
  },
  stuck_banneton: {
    title: "Surface Bonding & Adhesion",
    mechanics: "Dough sticking to a banneton occurs when surface moisture hydrates the container wall. Higher hydration doughs push water out, and if the dusting barrier is weak, protein strands bond to the vessel.",
    primaryDriver: "Surface Dusting / Pan Lubrication Barrier",
    secondaryDrivers: ["Cold Retard Condensation / Humidity", "Surface Skin Tension during Shaping"],
    interventionAction: "Switch surface dusting to a 50/50 Rice Flour & Whole Wheat blend.",
    logicBoundary: "Ensure final shaping establishes adequate outer skin tension to restrict water migration to the surface."
  },
  zero_spring: {
    title: "Steam Physics & Weak Oven Spring",
    mechanics: "A zero spring or missing 'ear' occurs when the score line fails to peel back. Oven spring requires internal water to convert to steam before the outer crust hardens. Lack of steam traps expansion.",
    primaryDriver: "Steam Delivery & Humidity during Spring",
    secondaryDrivers: ["Scoring Angle & Cut Depth", "Surface Tension", "Over-Proofing"],
    interventionAction: "Increase Steam Volume / Steam Trap Duration during initial 15 minutes of bake.",
    logicBoundary: "If steam setup is optimal, adjust blade scoring angle to 30° relative to the loaf surface."
  }
};
