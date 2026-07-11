// components/feed/LevainSlider.tsx
// Velocity-sensitive slider for levain hydration (0 = stiff, 100 = slack).
// Mirrors the PanResponder pattern from FlourSlider.tsx:
//   fast drag (vx > 0.1) → 5% steps, slow drag → 1% steps, tap → 1% precision.
import React, { useRef } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts } from "@/constants/theme";
interface LevainSliderProps {
  value: number;           // 0–100 integer
  onChange: (val: number) => void;
  ratioStr: string;        // e.g. "1 : 2.0 : 2.0" — displayed in center badge
  minValue?: number;   // default 0
  maxValue?: number;   // default 100
}
export default function LevainSlider({ value, onChange, ratioStr }: LevainSliderProps) {
  const colors = useColors();
  const sliderWidth = useRef(0);
  const pageXOffset = useRef(0);
  const trackRef = useRef<View>(null);
  // Keep onChange stable inside PanResponder without recreating it
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Snap and clamp within the valid hydration range
  const snapVal = (raw: number, step: number) =>
    Math.round(Math.max(minValue, Math.min(maxValue, raw)) / step) * step;
  // Track last emitted value — only fire onChange + haptics on real changes
  const lastVal = useRef(-1);  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        lastVal.current = -1;
        if (sliderWidth.current === 0) return;
        // Re-measure on each touch in case layout shifted (e.g. inside ScrollView)
        trackRef.current?.measure((_x, _y, _w, _h, px) => {
          pageXOffset.current = px;
        });
        const x = evt.nativeEvent.pageX - pageXOffset.current;
        // Tap always resolves to 1% precision
        const val = snapVal((x / sliderWidth.current) * 100, 1);
        onChangeRef.current(val);
        lastVal.current = val;
        Haptics.selectionAsync();
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (sliderWidth.current === 0) return;
        const x = gestureState.moveX - pageXOffset.current;
        // Fast drag → coarse 5% jumps; slow drag → 1% fine control
        const step = Math.abs(gestureState.vx) > 0.1 ? 5 : 1;
        const val = snapVal((x / sliderWidth.current) * 100, step);
        if (val !== lastVal.current) {
          onChangeRef.current(val);
          lastVal.current = val;
          Haptics.selectionAsync();
        }
      },
    })
  ).current;  const TRACK_HEIGHT = 6;
  const THUMB_SIZE = 26;  return (
    <View>
      {/* ── Label row: Stiff · ratio badge · Slack ── */}
      <View style={styles.labelRow}>
        <Text style={[styles.poleLabel, { color: colors.mutedForeground }]}>Stiff</Text>
        {/* Live ratio badge in the center */}
        <View style={[styles.ratioBadge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.ratioBadgeText, { color: colors.foreground }]}>{ratioStr}</Text>
        </View>
        <Text style={[styles.poleLabel, { color: colors.mutedForeground }]}>Slack</Text>
      </View>
      {/* ── Track + Thumb ── */}
      <View
        ref={trackRef}
        style={[styles.trackContainer, { height: THUMB_SIZE + 12 }]}
        onLayout={(e) => {
          sliderWidth.current = e.nativeEvent.layout.width;
          trackRef.current?.measure((_x, _y, _w, _h, px) => {
            pageXOffset.current = px;
          });
        }}
        {...panResponder.panHandlers}
      >
        <View
          style={[
            styles.track,
            { height: TRACK_HEIGHT, backgroundColor: colors.muted, borderRadius: TRACK_HEIGHT / 2 },
          ]}
        >
          {/* Fill grows left-to-right as value increases (stiff→slack) */}
          {value > 0 && (
            <View
              style={[
                styles.trackFill,
                {
                  width: `${value}%`,
                  backgroundColor: colors.primary + "80",
                  borderRadius: TRACK_HEIGHT / 2,
                },
              ]}
            />
          )}
        </View>
        {/* Thumb */}
        <View
          style={[
            styles.thumb,
            {
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: colors.card,
              borderColor: colors.primary,
              left: `${value}%` as any,
              marginLeft: -(THUMB_SIZE / 2),
            },
          ]}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  poleLabel: {
    fontFamily: fonts.sans,                  // HankenGrotesk_400Regular — pole endpoint label
    fontSize: 12,
  },
  ratioBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,                      // pill
    borderWidth: 1,
  },
  ratioBadgeText: {
    fontFamily: fonts.mono,                  // JetBrainsMono_500Medium — ratio is a calculated data string
    fontSize: 12,
  },
  trackContainer: {
    justifyContent: "center",
    position: "relative",
  },
  track: {
    width: "100%",
    flexDirection: "row",
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    marginTop: -13,
    borderWidth: 2.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});