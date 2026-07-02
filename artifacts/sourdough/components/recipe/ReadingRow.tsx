// components/recipe/ReadingRow.tsx
// ─── Single logged reading row: timestamp, data pills, optional note ──────────
// Used inside both active and done phase cards. The note is collapsed to one
// line by default and expands on tap. onDelete is optional — omit it on active
// phase reading rows where deletion is not offered.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { type Reading } from "@/lib/recipeTypes";
import { formatTime } from "@/lib/recipeUtils";

interface ReadingRowProps {
  reading: Reading;
  colors: ReturnType<typeof useColors>;
  onDelete?: () => void;
}

export function ReadingRow({ reading, colors, onDelete }: ReadingRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasNote = !!reading.note;  return (
    <Pressable
      style={s.readingRow}
      onPress={hasNote ? () => setExpanded((v) => !v) : undefined}
      accessibilityRole={hasNote ? "button" : undefined}
    >
      {/* Timestamp — highlighted in primary colour when a note is present */}
      <Text style={[s.readingTime, { color: hasNote ? colors.primary : colors.mutedForeground }]}>
        {formatTime(reading.loggedAt)}
      </Text>
      <View style={[s.readingPills, { flex: 1 }]}>
        {!!reading.temp && (
          <View style={[s.pill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="thermometer" size={10} color={colors.mutedForeground} />
            <Text style={[s.pillText, { color: colors.foreground }]}>
              {reading.temp}°{reading.tempUnit}
            </Text>
          </View>
        )}
        {!!reading.pH && (
          <View style={[s.pill, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[s.pillText, { color: colors.foreground }]}>pH {reading.pH}</Text>
          </View>
        )}
        {/* Note is truncated to 1 line until tapped */}
        {hasNote && (
          <Text
            style={[s.readingNote, { color: colors.mutedForeground }]}
            numberOfLines={expanded ? undefined : 1}
          >
            {reading.note}
          </Text>
        )}
      </View>
      {/* Delete button — only rendered when the caller provides onDelete */}
      {onDelete && (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
          hitSlop={8}
          style={{ padding: 4, marginLeft: 4 }}
          accessibilityLabel="Delete reading"
          accessibilityRole="button"
        >
          <Feather name="trash-2" size={13} color={colors.mutedForeground} />
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Moved from recipe.tsx s StyleSheet. These are used only by ReadingRow.
const s = StyleSheet.create({
  readingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  readingTime: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingTop: 3,
    minWidth: 62,
  },
  readingPills: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  readingNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingTop: 3,
    flex: 1,
  },
});