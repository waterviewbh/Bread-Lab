// artifacts/sourdough/components/log/logHub.tsx
import React, { useState, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { fonts, radius } from "@/constants/theme";
import { useLocalSearchParams } from "expo-router";

// --- Sub-sections ---
import { HistorySection } from "./logBook";
import { ResourcesSection } from "./logManual";

/**
 * THE LOGBOOK: History and Learning
 * [ History ] [ Resources ]
 */
export function LogbookHub() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

 const [section, setSection] = useState<"history" | "resources">(
    (params.section as any) || "history"
  );

  useEffect(() => {
    if (params.section) setSection(params.section as any);
  }, [params.section]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Hub Toggle */}
      <View style={[s.toggleWrap, { paddingTop: insets.top + 16 }]}>
        <View style={[s.toggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["history", "resources"] as const).map((sec) => (
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
                {sec === "history" ? "Bake History" : "Resources"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {section === "history" ? <HistorySection /> : <ResourcesSection />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  toggleWrap: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  toggle: { flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, padding: 3, gap: 3 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: "center" },
  toggleText: { fontSize: 13 },
});