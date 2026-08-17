// artifacts/sourdough/components/log/KnowledgeHubArticle.tsx
import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DIAGNOSTIC_SCIENCE } from "@/constants/diagnosticContents";

interface Props {
  slug: string;
  onClose: () => void;
}

/**
 * Knowledge Hub Article Viewer
 * Renders educational content for a specific diagnostic defect.
 */
export function KnowledgeHubArticle({ slug, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const content = DIAGNOSTIC_SCIENCE[slug];

  if (!content) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
         <View style={[s.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border }]}>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Resources</Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={s.content}>
          <Text style={[s.body, { color: colors.mutedForeground }]}>Educational content for "{slug}" is coming soon.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Resources</Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.categoryBadge, { backgroundColor: colors.primary + '20' }]}>
          <Text style={[s.categoryText, { color: colors.primary }]}>OUTCOME ANALYSIS</Text>
        </View>

        <Text style={[s.title, { color: colors.foreground }]}>{content.title}</Text>

        <Text style={[s.sectionTitle, { color: colors.foreground }]}>The Mechanics</Text>
        <Text style={[s.body, { color: colors.foreground }]}>{content.mechanics}</Text>

        <Text style={[s.sectionTitle, { color: colors.foreground }]}>Process Drivers</Text>
        <View style={s.driverBox}>
          <Text style={[s.driverLabel, { color: colors.mutedForeground }]}>PRIMARY DRIVER</Text>
          <Text style={[s.driverValue, { color: colors.foreground }]}>{content.primaryDriver}</Text>

          <Text style={[s.driverLabel, { color: colors.mutedForeground, marginTop: 12 }]}>SECONDARY DRIVERS</Text>
          {content.secondaryDrivers.map((d, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={[s.bulletDot, { backgroundColor: colors.accent }]} />
              <Text style={[s.bulletText, { color: colors.foreground }]}>{d}</Text>
            </View>
          ))}
        </View>

        <Text style={[s.sectionTitle, { color: colors.foreground }]}>Single-Variable Interventions</Text>
        <View style={[s.tipsBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <View style={s.tipsHeader}>
            <Feather name="zap" size={16} color={colors.accent} />
            <Text style={[s.tipsTitle, { color: colors.foreground }]}>ACTION</Text>
          </View>
          <Text style={[s.interventionText, { color: colors.foreground }]}>{content.interventionAction}</Text>

          <View style={[s.tipsHeader, { marginTop: 16 }]}>
            <Feather name="shield" size={16} color={colors.primary} />
            <Text style={[s.tipsTitle, { color: colors.foreground }]}>LOGIC BOUNDARY</Text>
          </View>
          <Text style={[s.interventionText, { color: colors.mutedForeground }]}>{content.logicBoundary}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontFamily: fonts.serifBold },
  closeBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, marginBottom: 12 },
  categoryText: { fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 1 },
  title: { fontSize: 28, fontFamily: fonts.serifBold, marginBottom: 24, lineHeight: 34 },
  sectionTitle: { fontSize: 14, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  body: { fontSize: 16, fontFamily: fonts.sans, lineHeight: 26, marginBottom: 30 },
  driverBox: { marginBottom: 30 },
  driverLabel: { fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 0.5, marginBottom: 4 },
  driverValue: { fontSize: 15, fontFamily: fonts.sansMedium },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  bulletDot: { width: 4, height: 4, borderRadius: 2 },
  bulletText: { fontSize: 14, fontFamily: fonts.sans },
  tipsBox: { padding: 20, borderRadius: radius.lg, borderWidth: 1 },
  tipsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tipsTitle: { fontSize: 11, fontFamily: fonts.sansBold, letterSpacing: 0.5 },
  interventionText: { fontSize: 15, fontFamily: fonts.sansMedium, lineHeight: 22 },
});
