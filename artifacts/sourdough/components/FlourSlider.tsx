// artifacts/sourdough/components/FlourSlider.tsx
import React, { useRef } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface FlourSliderProps {
  wwPercent: number;
  onChange: (val: number) => void;
  flourWeight: number | null;
}

export default function FlourSlider({ wwPercent, onChange, flourWeight }: FlourSliderProps) {
  const colors = useColors();
  const sliderWidth = useRef(0);
  const pageXOffset = useRef(0);
  const trackRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apPct = 100 - wwPercent;
  const apGrams = flourWeight !== null ? Math.round(flourWeight * (apPct / 100) * 10) / 10 : null;
  const wwGrams = flourWeight !== null ? Math.round(flourWeight * (wwPercent / 100) * 10) / 10 : null;

  // Snap raw % to the nearest step boundary
  const snapVal = (raw: number, step: number) => Math.round(Math.max(0, Math.min(100, raw)) / step) * step;
  // Track last emitted value so we only fire onChange + haptics on real changes
  const lastPct = useRef(-1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        lastPct.current = -1;
        if (sliderWidth.current === 0) return;
        // Re-measure on each touch in case the layout shifted (e.g. scroll)
        trackRef.current?.measure((_x, _y, _w, _h, px) => { pageXOffset.current = px; });
        const x = evt.nativeEvent.pageX - pageXOffset.current;
        // 1% precision on tap — user touched a deliberate spot
        const pct = snapVal((x / sliderWidth.current) * 100, 1);
        onChangeRef.current(pct);
        lastPct.current = pct;
        Haptics.selectionAsync();
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (sliderWidth.current === 0) return;
        const x = gestureState.moveX - pageXOffset.current;
        const step = Math.abs(gestureState.vx) > 0.1 ? 5 : 1;
        const pct = snapVal((x / sliderWidth.current) * 100, step);
        if (pct !== lastPct.current) {
          onChangeRef.current(pct);
          lastPct.current = pct;
          Haptics.selectionAsync();
        }
      },
    })
  ).current;

  const TRACK_HEIGHT = 6;
  const THUMB_SIZE = 26;

  return (
    <View>
      <View style={sliderStyles.labelRow}>
        <View>
          <Text style={[sliderStyles.flourLabel, { color: colors.foreground }]}>AP</Text>
          <Text style={[sliderStyles.flourGrams, { color: colors.mutedForeground }]}>
            {apGrams !== null ? `${apGrams}g` : "—"}
          </Text>
        </View>
        <View style={sliderStyles.pctBadge}>
          {apPct > 0 && <Text style={[sliderStyles.pctText, { color: colors.primary }]}>{apPct}%</Text>}
          {apPct > 0 && wwPercent > 0 && <Text style={[sliderStyles.pctDivider, { color: colors.border }]}>·</Text>}
          {wwPercent > 0 && <Text style={[sliderStyles.pctText, { color: colors.accent }]}>{wwPercent}%</Text>}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[sliderStyles.flourLabel, { color: colors.foreground }]}>WW</Text>
          <Text style={[sliderStyles.flourGrams, { color: colors.mutedForeground }]}>
            {wwGrams !== null ? `${wwGrams}g` : "—"}
          </Text>
        </View>
      </View>

      <View
        ref={trackRef}
        style={[sliderStyles.trackContainer, { height: THUMB_SIZE + 12 }]}
        onLayout={(e) => {
          sliderWidth.current = e.nativeEvent.layout.width;
          trackRef.current?.measure((_x, _y, _w, _h, px) => { pageXOffset.current = px; });
        }}
        {...panResponder.panHandlers}
      >
        <View style={[sliderStyles.track, { height: TRACK_HEIGHT, backgroundColor: colors.muted, borderRadius: TRACK_HEIGHT / 2 }]}>
          {wwPercent > 0 && (
            <View style={[sliderStyles.trackFillWW, { width: `${wwPercent}%`, backgroundColor: colors.accent, borderRadius: TRACK_HEIGHT / 2 }]} />
          )}
          {apPct > 0 && (
            <View style={[sliderStyles.trackFillAP, { width: `${apPct}%`, backgroundColor: colors.primary + "60", borderRadius: TRACK_HEIGHT / 2 }]} />
          )}
        </View>
        <View
          style={[
            sliderStyles.thumb,
            {
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: colors.card,
              borderColor: wwPercent > 50 ? colors.accent : colors.primary,
              left: `${wwPercent}%` as any,
              marginLeft: -(THUMB_SIZE / 2),
            },
          ]}
        />
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 },
  flourLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  flourGrams: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pctBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  pctText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pctDivider: { fontSize: 13, fontFamily: "Inter_400Regular" },
  trackContainer: { justifyContent: "center", position: "relative" },
  track: { width: "100%", flexDirection: "row", overflow: "hidden" },
  trackFillAP: { height: "100%" },
  trackFillWW: { height: "100%", position: "absolute", right: 0, top: 0 },
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