// components/recipe/KeycapKey.tsx
// ─── Retro keyboard-key style letter filter chip ──────────────────────────────
// Used in the A–Z recipe index. Each key renders two SVG polygons (face + ledge)
// that create the 3-D keycap illusion, with the label centred on the face.import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";

// ── Geometry constants ─────────────────────────────────────────────────────────
export const KEY_W = 30;    // standard letter/symbol key face width (px)
export const ALL_W = 42;    // wider face for the "All" key
const HASH_W = 30;          // "#" key — same width as a letter key (exported if needed later)
const FACE_H = 25;          // height of the top (clickable) face
const LEDGE_H = 2;          // height of the bottom shadow ledge
export const KEY_H = FACE_H + LEDGE_H;   // total SVG height — used for Pressable sizing
const FLARE = 3;            // px each side flares outward at the base of the face

// ── SVG polygon point strings for a single keycap ─────────────────────────────
// Returns the two polygon point strings that compose one key's face and ledge.
export function keycapPoints(w: number): { face: string; ledge: string } {
  const face = `${FLARE},0 ${w - FLARE},0 ${w},${FACE_H} 0,${FACE_H}`;
  const ledge = `0,${FACE_H} ${w},${FACE_H} ${w},${KEY_H} 0,${KEY_H}`;
  return { face, ledge };
}

interface KeycapKeyProps {
  label: string;
  active: boolean;
  onPress: () => void;
  faceFill: string;
  ledgeFill: string;
  stroke: string;
  textColor: string;
}

export function KeycapKey({
  label,
  active,
  onPress,
  faceFill,
  ledgeFill,
  stroke,
  textColor,
}: KeycapKeyProps) {
  // "All" key is slightly wider; all other labels use the standard width.
  const w = label === "All" ? ALL_W : KEY_W;
  const { face, ledge } = keycapPoints(w);  return (
    // Negative marginRight creates the overlapping keycap row effect.
    <Pressable onPress={onPress} style={{ width: w, height: KEY_H, marginRight: -5, zIndex: active ? 1 : 0 }}>
      <Svg width={w} height={KEY_H}>
        <Polygon points={face} fill={faceFill} stroke={stroke} strokeWidth={0.5} />
        <Polygon points={ledge} fill={ledgeFill} stroke={stroke} strokeWidth={0.5} />
      </Svg>
      {/* Label is absolutely positioned over the SVG, centered on the face (not the ledge). */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: "center", justifyContent: "center", paddingBottom: LEDGE_H },
        ]}
      >
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: textColor }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}