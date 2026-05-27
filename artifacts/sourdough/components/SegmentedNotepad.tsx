/**
 * SegmentedNotepad
 *
 * A rich-text-like notepad that treats phase chips as atomic, non-editable
 * tokens inside a free-form text document.
 *
 * Data model
 * ----------
 * Content is stored internally as an ordered array of segments:
 *   TextSeg  — a multiline TextInput the user types freely into
 *   ChipSeg  — a styled pill View; non-editable and deleted atomically
 *
 * Chips are always surrounded by text segments so the array always looks like:
 *   [TextSeg, ChipSeg, TextSeg, ChipSeg, TextSeg, …]
 *
 * Serialization
 * -------------
 * When saved, segments are joined into a plain string:
 *   text value → verbatim
 *   chip       → " [Label]\n"
 * This keeps the format compatible with the existing bake-notes storage schema.
 *
 * Insertion flow (per spec)
 * -------------------------
 * 1. Trailing space appended to the active text segment (if not already present)
 * 2. ChipSeg inserted after the active text segment
 * 3. New empty TextSeg inserted after the chip
 * 4. Cursor focused on the new TextSeg
 *
 * Backspace deletion
 * ------------------
 * When the user presses Backspace in an empty TextSeg whose predecessor is a
 * ChipSeg, the chip is deleted atomically and the two surrounding TextSegs are
 * merged. Cursor lands at the junction point of the merged segment.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// ── Types ────────────────────────────────────────────────────────────────────

type TextSeg = { id: string; type: "text"; value: string };
type ChipSeg = { id: string; type: "chip"; label: string };
type Segment = TextSeg | ChipSeg;

/** Minimal color tokens required by this component. */
export interface NotepadColors {
  primary: string;
  primaryForeground: string;
  muted: string;
  border: string;
  foreground: string;
  mutedForeground: string;
}

export interface Phase {
  key: string;
  name: string;
}

export interface SegmentedNotepadProps {
  initialValue: string;
  /** Called on every content change with the serialized string. */
  onChange: (serialized: string) => void;
  phases: Phase[];
  colors: NotepadColors;
  bottomInset: number;
}

// ── ID generator ─────────────────────────────────────────────────────────────

let _counter = 0;
const uid = () => `snp-${++_counter}`;

// ── Serialization helpers ─────────────────────────────────────────────────────

/**
 * Parse a stored notes string into segments.
 * Chips are stored as " [Label]\n" or "[Label]\n".
 */
function parse(raw: string): Segment[] {
  if (!raw) return [{ id: uid(), type: "text", value: "" }];

  const segs: Segment[] = [];
  // Match optional leading space + [Label] + optional trailing newline
  const re = / ?\[([^\]]+)\]\n?/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(raw)) !== null) {
    segs.push({ id: uid(), type: "text", value: raw.slice(last, m.index) });
    segs.push({ id: uid(), type: "chip", label: m[1] });
    last = m.index + m[0].length;
  }

  // Any remaining text after the last chip
  segs.push({ id: uid(), type: "text", value: raw.slice(last) });

  // Guarantee at least one text segment
  return segs.length ? segs : [{ id: uid(), type: "text", value: "" }];
}

/**
 * Serialize segments back to a string for storage.
 * Chips become " [Label]\n" (space + brackets + newline).
 */
function serialize(segs: Segment[]): string {
  return segs
    .map((s) => (s.type === "text" ? s.value : ` [${s.label}]\n`))
    .join("");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SegmentedNotepad({
  initialValue,
  onChange,
  phases,
  colors,
  bottomInset,
}: SegmentedNotepadProps) {
  const [segs, setSegs] = useState<Segment[]>(() => parse(initialValue));

  // ID of the text segment that currently holds focus
  const activeIdRef = useRef<string | null>(null);

  // Refs to all rendered TextInput instances, keyed by segment ID
  const inputRefs = useRef<Map<string, TextInput>>(new Map());

  // ScrollView ref for programmatic scrolling when keyboard appears
  const scrollRef = useRef<ScrollView>(null);

  // Y-offset of each text segment within the ScrollView content, keyed by segment ID
  const inputLayoutY = useRef<Map<string, number>>(new Map());

  // ── Keyboard scroll ────────────────────────────────────────────────────────

  /**
   * When the keyboard appears, scroll the ScrollView so the active text
   * input sits comfortably above the keyboard. This keeps the cursor
   * visible while typing.
   */
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      const id = activeIdRef.current;
      if (!id) return;
      const y = inputLayoutY.current.get(id);
      if (y !== undefined) {
        // Scroll to the input's Y position minus a comfortable top margin
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
      }
    });
    return () => sub.remove();
  }, []);

  // ── Text change ────────────────────────────────────────────────────────────

  const onChangeText = useCallback(
    (id: string, value: string) => {
      setSegs((prev) => {
        const next = prev.map((s) =>
          s.id === id && s.type === "text" ? { ...s, value } : s
        );
        onChange(serialize(next));
        return next;
      });
    },
    [onChange]
  );

  // ── Chip insertion ─────────────────────────────────────────────────────────

  /**
   * Insert a chip token into the document after the currently focused text
   * segment, following the spec's insertion sequence:
   *   1. Trailing space on preceding text (if not already present)
   *   2. Chip segment
   *   3. New empty text segment
   *   4. Focus new text segment
   */
  const insertChip = useCallback(
    (label: string) => {
      setSegs((prev) => {
        // Locate active text segment; fall back to last text segment
        let insertIdx = prev.reduce(
          (found, s, i) => (s.type === "text" ? i : found),
          0
        );
        if (activeIdRef.current) {
          const found = prev.findIndex(
            (s) => s.id === activeIdRef.current && s.type === "text"
          );
          if (found >= 0) insertIdx = found;
        }

        const active = prev[insertIdx] as TextSeg;

        // Ensure preceding text ends with exactly one space (spec step 1)
        const trimmed = active.value.trimEnd();
        const updated: TextSeg = {
          ...active,
          value: trimmed.length > 0 ? trimmed + " " : "",
        };

        // New chip + cursor landing zone (spec steps 2–4)
        const chip: ChipSeg = { id: uid(), type: "chip", label };
        const after: TextSeg = { id: uid(), type: "text", value: "" };

        const next: Segment[] = [
          ...prev.slice(0, insertIdx),
          updated,
          chip,
          after,
          ...prev.slice(insertIdx + 1),
        ];

        onChange(serialize(next));

        // Focus the new text segment after the next render cycle
        setTimeout(() => {
          inputRefs.current.get(after.id)?.focus();
        }, 80);

        return next;
      });
    },
    [onChange]
  );

  // ── Backspace on empty segment ─────────────────────────────────────────────

  /**
   * Called when the user presses Backspace in a TextInput whose value is
   * already empty. If the immediately preceding segment is a chip, delete it
   * atomically and merge the two surrounding text segments.
   */
  const handleBackspaceOnEmpty = useCallback(
    (id: string) => {
      setSegs((prev) => {
        const segIdx = prev.findIndex((s) => s.id === id);
        if (segIdx < 1) return prev;

        const before = prev[segIdx - 1];
        if (before.type !== "chip") return prev;

        // Text segment that sits before the chip (index segIdx - 2)
        const beforeChip =
          segIdx >= 2 && prev[segIdx - 2].type === "text"
            ? (prev[segIdx - 2] as TextSeg)
            : null;

        let next: Segment[];

        if (beforeChip) {
          // Remove the trailing space that was added when the chip was inserted
          const mergedValue =
            beforeChip.value.trimEnd() + (prev[segIdx] as TextSeg).value;
          const merged: TextSeg = { ...beforeChip, value: mergedValue };
          // Replace [beforeChip, chip, currentSeg] with [merged]
          next = [
            ...prev.slice(0, segIdx - 2),
            merged,
            ...prev.slice(segIdx + 1),
          ];
          // Move cursor to end of the merged segment
          setTimeout(() => {
            inputRefs.current.get(merged.id)?.focus();
          }, 80);
        } else {
          // No text segment before the chip — just remove chip; keep current seg
          next = [...prev.slice(0, segIdx - 1), ...prev.slice(segIdx)];
        }

        onChange(serialize(next));
        return next;
      });
    },
    [onChange]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  let textInputCount = 0; // used to auto-focus the first text input

  return (
    <View style={styles.root}>
      {/* Scrollable content area */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {segs.map((seg) => {
          // ── Chip segment ──────────────────────────────────────────────────
          if (seg.type === "chip") {
            return (
              <View
                key={seg.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: colors.primary + "1A",
                    borderColor: colors.primary + "55",
                  },
                ]}
                accessibilityLabel={`Phase: ${seg.label}`}
                accessibilityRole="text"
              >
                <Text style={[styles.chipText, { color: colors.primary }]}>
                  {seg.label}
                </Text>
              </View>
            );
          }

          // ── Text segment ──────────────────────────────────────────────────
          const isFirst = textInputCount++ === 0;

          return (
            <TextInput
              key={seg.id}
              ref={(r) => {
                if (r) inputRefs.current.set(seg.id, r);
                else inputRefs.current.delete(seg.id);
              }}
              onLayout={(e) => {
                // Track Y position of each text segment within the scroll content
                inputLayoutY.current.set(seg.id, e.nativeEvent.layout.y);
              }}
              style={[styles.textInput, { color: colors.foreground }]}
              value={seg.value}
              onChangeText={(v) => onChangeText(seg.id, v)}
              onFocus={() => {
                activeIdRef.current = seg.id;
                // Scroll to this input if the keyboard is already up
                const y = inputLayoutY.current.get(seg.id);
                if (y !== undefined) {
                  scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
                }
              }}
              onKeyPress={(e) => {
                // Detect backspace on an already-empty segment to delete the
                // preceding chip atomically (rather than character by character)
                if (
                  e.nativeEvent.key === "Backspace" &&
                  seg.value === ""
                ) {
                  handleBackspaceOnEmpty(seg.id);
                }
              }}
              multiline
              scrollEnabled={false}
              autoFocus={isFirst}
              placeholder={
                isFirst
                  ? "Jot down reflections for this bake…\n\nTap a phase tag below to add a section header."
                  : undefined
              }
              placeholderTextColor={colors.mutedForeground}
              textAlignVertical="top"
            />
          );
        })}
      </ScrollView>

      {/* Phase tag dock — fixed at the bottom of the notepad */}
      <View
        style={[
          styles.tagStrip,
          {
            borderTopColor: colors.border,
            paddingBottom: bottomInset + 12,
          },
        ]}
      >
        <Text style={[styles.tagLabel, { color: colors.mutedForeground }]}>
          Add phase header:
        </Text>
        <View style={styles.tagRow}>
          {phases.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => insertChip(p.name)}
              style={({ pressed }) => [
                styles.tag,
                {
                  backgroundColor: pressed ? colors.primary : colors.muted,
                  borderColor: pressed ? colors.primary : colors.border,
                },
              ]}
              accessibilityLabel={`Insert ${p.name} header`}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.tagText,
                  { color: colors.foreground },
                ]}
              >
                {p.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
  },

  // Free-text input segment
  textInput: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
    minHeight: 24,
    textAlignVertical: "top",
  },

  // Non-editable chip token
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 4,
  },
  chipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },

  // Phase tag dock
  tagStrip: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  tagLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  tagRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingBottom: 2,
  },
  tag: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
});
