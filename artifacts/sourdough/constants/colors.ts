const colors = {
  light: {
    // Artisan Hearth Surface & Text
    text: "#5d3a26", // Crust Brown (Primary)
    tint: "#5d3a26",

    background: "#fff8f5", // Soft Flour (Surface)
    foreground: "#5d3a26",

    card: "#ffffff", // Pure Container
    cardForeground: "#5d3a26",

    primary: "#5d3a26",
    primaryForeground: "#fff8f5",

    secondary: "#f1ebe8", // Muted Dough (Surface Container)
    secondaryForeground: "#8d7365", // Baked Earth

    muted: "#e1d8d4", // Surface Dim
    mutedForeground: "#8d7365",

    accent: "#8d7365",
    accentForeground: "#fff8f5",

    destructive: "#a33520",
    destructiveForeground: "#ffffff",

    border: "#e1d8d4",
    input: "#fbf2ed",

    // --- Scientific Journal Elements ---
    // Transitioning from clinical blues to earthy, natural tones
    tempLine: "#8d7365",
    tempBandWarm: "rgba(141, 115, 101, 0.08)", // Warm Earth
    tempBandBalanced: "rgba(93, 58, 38, 0.05)", // Neutral Hearth
    tempBandCool: "rgba(168, 151, 142, 0.08)", // Cool Ash
    tempZoneWarm: "#8d7365",
    tempZoneBalanced: "#5d3a26",
    tempZoneCool: "#a8978e",
  },

  dark: {
    // Dark Mode: Deep Roasted Tones
    text: "#fbf2ed",
    tint: "#f1ebe8",

    background: "#2a1508", // Deep Hearth
    foreground: "#fbf2ed",

    card: "#3a251a",
    cardForeground: "#fbf2ed",

    primary: "#f1ebe8",
    primaryForeground: "#2a1508",

    secondary: "#4a3528",
    secondaryForeground: "#e1d8d4",

    muted: "#3a251a",
    mutedForeground: "#a8978e",

    accent: "#a8978e",
    accentForeground: "#2a1508",

    destructive: "#e57373",
    destructiveForeground: "#2a1508",

    border: "#4a3528",
    input: "#3a251a",

    tempLine: "#a8978e",
    tempBandWarm: "rgba(241, 235, 232, 0.1)",
    tempBandBalanced: "rgba(225, 216, 212, 0.08)",
    tempBandCool: "rgba(168, 151, 142, 0.1)",
    tempZoneWarm: "#f1ebe8",
    tempZoneBalanced: "#e1d8d4",
    tempZoneCool: "#a8978e",
  },

  radius: 8, // Matching the ROUND_EIGHT system setting
};

export default colors;