import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing } from "@/constants/theme";
import { SavedRecipe } from "@/lib/recipeTypes";
import { calculateRecipeMetrics, formatDate } from "@/lib/recipeUtils";
import { getRecipeDelta } from "@/lib/recipeDiff";

interface Props {
  master: SavedRecipe;
  iterations: SavedRecipe[]; // Assumed sorted by date desc (latest first)
  onSelect: (recipe: SavedRecipe) => void;
}

/**
 * RecipeDeck: Implements the "Overlapping Index Tabs" pattern.
 * Manages a lineage of recipes (Master + iterations) with a Rule of 3 visible tabs.
 */
export function RecipeDeck({ master, iterations, onSelect }: Props) {
  const colors = useColors();

  // Helper to strip redundant iteration suffixes from the title for display
  const cleanTitle = (name: string) => {
    return name
      .replace(/\(Iterated\)/gi, "")
      .replace(/\(Iter Copy\)/gi, "")
      .replace(/\(Iteration copy\)/gi, "")
      .trim();
  };

  // Rule of 3: Master, second most recent, and latest.
  // iterations is sorted latest first [v3, v2, v1]
  const visibleLineage = useMemo(() => {
    const items: SavedRecipe[] = [master];

    if (iterations.length === 1) {
      items.push(iterations[0]); // Master, v1 (Latest)
    } else if (iterations.length >= 2) {
      // items.push(iterations[1]); // Second most recent (e.g. v2 if iterations are [v3, v2, v1])
      // items.push(iterations[0]); // Latest (e.g. v3)

      // Wait, iterations[0] is latest. iterations[1] is second latest.
      // So [Master, v(N-1), vN]
      items.push(iterations[1]);
      items.push(iterations[0]);
    }

    return items;
  }, [master, iterations]);

  const [activeRecipeId, setActiveRecipeId] = useState(visibleLineage[visibleLineage.length - 1].id);
  const activeRecipe = useMemo(() =>
    visibleLineage.find(r => r.id === activeRecipeId) || visibleLineage[visibleLineage.length - 1]
  , [activeRecipeId, visibleLineage]);

  const isMasterActive = activeRecipe.id === master.id;
  const metrics = calculateRecipeMetrics(activeRecipe.phases);
  const deltas = !isMasterActive ? getRecipeDelta(master, activeRecipe) : [];

  const handlePress = () => {
    onSelect(activeRecipe);
  };

  // Archive count
  const archiveCount = iterations.length > 2 ? iterations.length - 2 : 0;

  if (iterations.length === 0) {
    // Untouched Master Formula state
    return (
      <View style={s.container}>
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [
            s.cardBody,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.9 : 1, borderTopLeftRadius: radius.lg }
          ]}
        >
          <View style={s.headerRow}>
            <View>
              <View style={[s.badge, { backgroundColor: colors.primary + '15' }]}>
                <Text selectable={true} style={[s.badgeText, { color: colors.primary }]}>MASTER FORMULA · UNTOUCHED</Text>
              </View>
              <Text selectable={true} style={[s.title, { color: colors.foreground }]}>{master.name}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </View>

          <View style={s.metricsRow}>
             <Metric label="Hydration" value={`${metrics.hydrationPct}%`} color={colors.mutedForeground} />
             <Metric label="Starter" value={`${Math.round(metrics.inoculationPct)}%`} color={colors.mutedForeground} />
             <Metric label="Yield" value={master.yieldValue || "1 Loaf"} color={colors.mutedForeground} />
          </View>

          <View style={s.footer}>
            <Text selectable={true} style={[s.footerText, { color: colors.mutedForeground }]}>
              <Feather name="clock" size={10} /> Created {formatDate(master.createdAt)}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Index Tab Bar */}
      <View style={s.tabRow}>
        {visibleLineage.map((recipe, index) => {
          const isActive = recipe.id === activeRecipeId;
          const isMaster = recipe.id === master.id;
          const isLatest = !isMaster && recipe.id === iterations[0].id;
          const isDraft = recipe.isUneditedIteration;

          let label = isMaster ? "Master" : (recipe.versionLabel || `v${iterations.length - (iterations.findIndex(it => it.id === recipe.id))}`);
          if (isLatest && !isDraft) label += " (Latest)";
          if (isDraft) label += " (Draft)";

          return (
            <Pressable
              key={recipe.id}
              onPress={() => setActiveRecipeId(recipe.id)}
              style={[
                s.tabItem,
                isActive ? s.activeTab : s.inactiveTab,
                { borderColor: colors.border, borderBottomColor: isActive ? colors.card : colors.border }
              ]}
            >
              {isMaster ? (
                <Feather name="shield" size={12} color={isActive ? colors.primary : "#82736b"} />
              ) : (
                <Feather name={isDraft ? "circle" : "clock"} size={12} color={isActive ? (isDraft ? "#E67E22" : colors.accent) : "#82736b"} fill={isDraft ? "#E67E22" : "transparent"} />
              )}
              <Text
                style={[
                  s.tabText,
                  { color: isActive ? colors.foreground : "#82736b" },
                  isActive && { fontFamily: fonts.sansSemiBold }
                ]}
                numberOfLines={1}
              >
                {isActive && "• "}{label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Card Body */}
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          s.cardBody,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.9 : 1,
            borderTopLeftRadius: visibleLineage[0].id === activeRecipeId ? 0 : radius.lg
          }
        ]}
      >
        {activeRecipe.isUneditedIteration && (
           <View style={[s.pendingBanner, { backgroundColor: '#FFF5F0', borderColor: '#FAD7C1' }]}>
             <View style={s.pendingBannerHeader}>
               <Feather name="edit-3" size={16} color="#E67E22" style={{ marginTop: 2 }} />
               <View style={{ flex: 1 }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                   <Text selectable={true} style={[s.pendingTitle, { color: '#844B1D' }]}>BENCH FORMULATION PENDING</Text>
                   <View style={[s.draftBadge, { backgroundColor: '#FAD7C1' }]}>
                     <Text selectable={true} style={[s.draftBadgeText, { color: '#844B1D' }]}>Unadjusted Duplicate</Text>
                   </View>
                 </View>
                 <Text selectable={true} style={[s.pendingBody, { color: '#844B1D' }]}>
                   Cloned from <Text selectable={true} style={{ fontFamily: fonts.sansBold }}>{activeRecipe.clonedFromBakeName || 'previous bake'}</Text> with diagnostic notes attached. Formula values still match parent until you record bench changes.
                 </Text>
                 <Pressable
                  onPress={handlePress}
                  style={({ pressed }) => [s.tuneBtn, { opacity: pressed ? 0.8 : 1 }]}
                 >
                   <Feather name="edit" size={12} color="#FFFFFF" />
                   <Text style={s.tuneBtnText}>Tune Timings & Hydration</Text>
                   <Text style={s.autoMarksText}>Auto-marks tuned</Text>
                 </Pressable>
               </View>
             </View>
           </View>
        )}

        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text selectable={true} style={[s.lineageChip, { color: colors.mutedForeground }]}>
              {activeRecipe.isUneditedIteration ? 'UNADJUSTED DUPLICATE' : (isMasterActive ? 'BASELINE V1.6' : 'ITERATION ACTIVE')} · {iterations.length} {iterations.length === 1 ? 'Iteration' : 'Iterations'}
            </Text>
            <Text selectable={true} style={[s.title, { color: colors.foreground }]} numberOfLines={2}>
              {cleanTitle(activeRecipe.name)}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </View>

        <View style={s.metricsRow}>
           <Metric label="Hydration" value={`${metrics.hydrationPct}%`} color={colors.mutedForeground} />
           <Metric label="Starter" value={`${Math.round(metrics.inoculationPct)}%`} color={colors.mutedForeground} />
           <Metric label="Yield" value={activeRecipe.yieldValue || "1 Loaf"} color={colors.mutedForeground} />
        </View>

        {!isMasterActive && deltas.length > 0 && (
          <View style={[s.deltaBox, { backgroundColor: colors.accent + '08' }]}>
            <Text selectable={true} style={[s.deltaText, { color: colors.foreground }]}>
              <Text selectable={true} style={{ fontFamily: fonts.sansSemiBold, color: colors.accent }}>Delta vs Master: </Text>
              {deltas.map(d => `${d.value} ${d.label.toLowerCase()}`).join('; ')}.
            </Text>
          </View>
        )}

        {activeRecipe.diagnosticHypothesis && (
          <View style={[s.obsBox, { borderColor: colors.border }]}>
             <View style={s.obsHeader}>
               <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.mutedForeground} />
               <Text selectable={true} style={[s.obsHeaderText, { color: colors.mutedForeground }]}>ATTACHED DIAGNOSTIC OBSERVATION</Text>
             </View>
             <Text selectable={true} style={[s.obsText, { color: colors.foreground }]}>"{activeRecipe.diagnosticHypothesis}"</Text>
          </View>
        )}

        {archiveCount > 0 && (
          <Text style={[s.archiveLink, { color: colors.accent }]}>
            + {archiveCount} older archived iterations
          </Text>
        )}

        <View style={s.footer}>
          <Text selectable={true} style={[s.footerText, { color: colors.mutedForeground }]}>
             Baked {formatDate(activeRecipe.updatedAt || activeRecipe.createdAt)}
          </Text>
          <Text style={[s.footerLink, { color: colors.accent }]}>
            Open Recipe ›
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function Metric({ label, value, color }: { label: string, value: string, color: string }) {
  return (
    <View style={s.metricItem}>
      <Text selectable={true} style={[s.metricValue, { color }]}>{value}</Text>
      <Text selectable={true} style={[s.metricLabel, { color }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    marginBottom: -1,
    zIndex: 2,
  },
  tabItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 140,
  },
  activeTab: {
    backgroundColor: '#ffffff', // As per spec
  },
  inactiveTab: {
    backgroundColor: '#fbf2ed', // As per spec
  },
  tabText: {
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  cardBody: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    zIndex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  lineageChip: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 20,
    lineHeight: 26,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginBottom: 6,
  },
  badgeText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 16,
  },
  metricItem: {
    alignItems: 'flex-start',
  },
  metricValue: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
  metricLabel: {
    fontFamily: fonts.sans,
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: -2,
  },
  deltaBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  deltaText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  pendingBanner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  pendingBannerHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  pendingTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  draftBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  draftBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
  },
  pendingBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 10,
  },
  tuneBtn: {
    backgroundColor: '#4A3728', // Darker earthy tone for the button
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  tuneBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  autoMarksText: {
    color: '#844B1D',
    fontFamily: fonts.sans,
    fontSize: 10,
    fontStyle: 'italic',
    marginLeft: 4,
  },
  obsBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  obsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  obsHeaderText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  obsText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  archiveLink: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    marginBottom: 12,
    textDecorationLine: 'underline',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  footerText: {
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  footerLink: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
});
