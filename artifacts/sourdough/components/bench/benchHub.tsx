// artifacts/sourdough/components/bench/benchHub.tsx
import React, { useState, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts, radius } from "@/constants/theme";

// --- Sub-sections ---
import { ActiveFeedSection } from "./ActiveFeedSection";
import { ActiveBakeSection } from "./ActiveBakeSection";

import { useLocalSearchParams } from "expo-router";

/**
 * THE BENCH: Active Execution
 * [ Active Feed ] [ Active Bake ]
 */
export function BenchHub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  // Hub Navigation State
  const [section, setSection] = useState<"feed" | "bake">(
    (params.section as any) || "feed"
  );

  useEffect(() => {
    if (params.section) setSection(params.section as any);
  }, [params.section]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Hub Toggle */}
      <View style={[s.toggleWrap, { paddingTop: insets.top + 16 }]}>
        <View style={[s.toggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["feed", "bake"] as const).map((sec) => (
            <Pressable
              key={sec}
              onPress={() => { setSection(sec); Haptics.selectionAsync(); }}
              style={[
                s.toggleBtn,
                section === sec && {
                  backgroundColor: colors.card,
                  shadowColor: "#000",
                  shadowOpacity: 0.06,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 }, elevation: 2
                }
              ]}
            >
              <Text style={[
                s.toggleText, {
                  color: section === sec ? colors.foreground : colors.mutedForeground,
                  fontFamily: section === sec ? fonts.sansSemiBold : fonts.sans
                }
              ]}>
                {sec === "feed" ? "Feed Tracker" : "Bake"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Content Rendering */}
      <View style={{ flex: 1 }}>
        {section === "feed" ? (
          // 3. Pass params to ActiveFeedSection
          <ActiveFeedSection
            incomingStarter={params.starter as string}
            incomingFlour={params.flour as string}
            incomingWater={params.water as string}
            autoStart={params.autoStart === "true"}
          />
        ) : (
          <ActiveBakeSection />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  toggleWrap: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  toggle: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 3, gap: 3 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: "center" },
  toggleText: { fontSize: 13 },
});