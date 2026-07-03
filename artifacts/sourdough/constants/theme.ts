// constants/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for non-color design tokens.
// Import { spacing, radius, typography } from "@/constants/theme"
// ─────────────────────────────────────────────────────────────────────────────
 import {} from '@expo-google-fonts/libre-caslon-text';
// ── Spacing (4px baseline grid) ──────────────────────────────────────────────
export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  40,
  containerPadding: 20,
  gutter: 16,
} as const;

// ── Border radius ────────────────────────────────────────────────────────────
export const radius = {
  sm:   4,
  md:   8,   // was "DEFAULT" in the doc (0.5rem → 8px)
  lg:   12,  // was "lg" in the doc (0.75rem → 12px) — matches your current `radius: 12`
  xl:   16,
  xxl:  24,
  full: 9999,
} as const;

// ── Font families ────────────────────────────────────────────────────────────
// Keys match the expo-google-fonts package export names you'll load in _layout.
export const fonts = {
  // Serif — editorial headlines
  serif:          "LibreCaslonText_400Regular",
  serifBold:      "LibreCaslonText_700Bold",
  // Sans — body copy
  sans:           "HankenGrotesk_400Regular",
  sansMedium:     "HankenGrotesk_500Medium",
  sansSemiBold:   "HankenGrotesk_600SemiBold",
  // Mono — data / scientific readings
  mono:           "JetBrainsMono_500Medium",
} as const;

// ── Typography scale ─────────────────────────────────────────────────────────
// Each entry is a plain React Native style object — spread directly into StyleSheet.
// Colors are intentionally omitted; apply `color` separately via useColors().
export const typography = {
  displayLg: {
    fontFamily: fonts.serifBold,
    fontSize: 40,
    lineHeight: 48,
  },
  headlineLg: {
    fontFamily: fonts.serifBold,
    fontSize: 32,
    lineHeight: 40,
  },
  headlineLgMobile: {
    fontFamily: fonts.serifBold,
    fontSize: 28,
    lineHeight: 34,
  },
  titleMd: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    lineHeight: 28,
  },
  bodyLg: {
    fontFamily: fonts.sans,
    fontSize: 18,
    lineHeight: 28,
  },
  bodyMd: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  bodySm: {
    // used for bullets, changelog lines, etc. — not in spec but fills a gap
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  dataMono: {
    fontFamily: fonts.mono,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.28,
  },
  labelSm: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
  },
  // ── Convenience aliases matching current usage ───────────────────────────
  // These make migration easier — they map to the closest spec scale point
  // so existing StyleSheets can swap fontFamily/fontSize lines for one spread.
  sectionLabel: {   // e.g. the "SETTINGS" uppercase caps labels
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },
  cardTitle: {      // accordion headers, card heading rows
    fontFamily: fonts.serifBold,
    fontSize: 14,
    lineHeight: 20,
  },
  metaLabel: {      // muted supplementary labels
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
} as const;