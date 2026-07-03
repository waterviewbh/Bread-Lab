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
import { fonts } from "@/constants/theme";

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
}export interface Phase {
  key: string;
  name: string;
}export interface SegmentedNotepadProps {
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
  let m: RegExpExecArray | null;  while ((m = re.exec(raw)) !== null) {
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Tracks the last-known value of each text segment for Android soft-keyboard
  // backspace detection (onKeyPress is unreliable on Android; onChangeText is not)
  const prevValueRef = useRef<Map<string, string>>(new Map());
  // Sync serialized content to parent whenever segments change.
  // useEffect fires after render, safely outside the updater cycle.
  const isFirstSyncRef = useRef(true);
  useEffect(() => {
    if (isFirstSyncRef.current) {
      // Skip the initial mount — parent already has the initialValue
      isFirstSyncRef.current = false;
      return;
    }
    onChange(serialize(segs));
  }, [segs]);

  // ── Keyboard scroll ────────────────────────────────────────────────────────
  /*
   * When the keyboard appears, scroll the ScrollView so the active text
   * input sits comfortably above the keyboard. This keeps the cursor
   * visible while typing.
   */

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      const id = activeIdRef.current;
      if (!id) return;
      const y = inputLayoutY.current.get(id);
      if (y !== undefined) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
      }
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

// ── Backspace on empty segment ─────────────────────────────────────────────
  /*
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
        return next;
      });
    },
    [onChange]
  );

  // ── Text change ────────────────────────────────────────────────────────────
  const onChangeText = useCallback(
    (id: string, value: string) => {
      const prev = prevValueRef.current.get(id) ?? "";
      // Android soft-keyboard backspace detection:
      // onKeyPress does not reliably fire for Backspace on Android.
      // If onChangeText fires with "" on a segment that was already "",
      // treat it as a backspace-on-empty signal and attempt chip deletion.
      if (value === "" && prev === "") {
        handleBackspaceOnEmpty(id);
        return;
      }
    prevValueRef.current.set(id, value);
    setSegs((prevSegs) => {
        const next = prevSegs.map((s) =>
          s.id === id && s.type === "text" ? { ...s, value } : s
        );
        return next;
      });
    },
    [onChange, handleBackspaceOnEmpty]
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
      // Locate the active text segment; fall back to the last text segment
      let insertIdx = prev.reduce(
        (found, s, i) => (s.type === "text" ? i : found),
        0
      );
      if (activeIdRef.current) {
        const found = prev.findIndex(
          (s) => s.id === activeIdRef.current && s.type === "text"
        );
        if (found >= 0) insertIdx = found;
      }      const active = prev[insertIdx] as TextSeg;
      const chip: ChipSeg = { id: uid(), type: "chip", label };
      const after: TextSeg = { id: uid(), type: "text", value: "" };
      let next: Segment[];      if (active.value.trim() === "") {
        // Active segment is empty (e.g., two chips tapped in a row).
        // Replace the empty segment directly with [chip, new empty seg]
        // so no blank row appears between consecutive chips.
        next = [
          ...prev.slice(0, insertIdx),
          chip,
          after,
          ...prev.slice(insertIdx + 1),
        ];
      } else {
        // Active segment has content — add a trailing space then insert chip.
        const updated: TextSeg = {
          ...active,
          value: active.value.trimEnd() + " ",
        };
        next = [
          ...prev.slice(0, insertIdx),
          updated,
          chip,
          after,
          ...prev.slice(insertIdx + 1),
        ];
      }      // Focus the new empty text segment after the next render cycle
      setTimeout(() => {
        inputRefs.current.get(after.id)?.focus();
      }, 80);      return next;
    });
  },
  [onChange]
);

// ── Render ─────────────────────────────────────────────────────────────────
// Used to auto-focus the first text input only
  let textInputCount = 0;
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
// ── Chip segment ────────────────────────────────────────────────
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
// ── Text segment ────────────────────────────────────────────────
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
                // Seed prevValueRef so the Android backspace detector starts accurate
                prevValueRef.current.set(seg.id, seg.value);
                // Scroll to this input if the keyboard is already up
                const y = inputLayoutY.current.get(seg.id);
                if (y !== undefined) {
                  scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
                }
              }}
              onKeyPress={(e) => {
                // iOS physical keyboard: keypress fires reliably for Backspace here.
                // Android soft keyboard: handled via onChangeText double-empty above.
                if (e.nativeEvent.key === "Backspace" && seg.value === "") {
                  handleBackspaceOnEmpty(seg.id);
                }
              }}
              // Web + physical keyboard: browsers do NOT fire keypress for Backspace,
              // but they do fire keydown. onKeyDown is a RN Web pass-through prop.
              onKeyDown={(e: any) => {
                if (e.nativeEvent?.key === "Backspace" && seg.value === "") {
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
            // When keyboard is up, pad by its height; otherwise use the safe area inset
            paddingBottom: keyboardHeight > 0 ? keyboardHeight + 12 : bottomInset + 12,
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
              <Text style={[styles.tagText, { color: colors.foreground }]}>
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
    fontFamily: fonts.sans,
    lineHeight: 24,
    minHeight: 0,  // was 24
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
    fontFamily: fonts.sansSemiBold,
    letterSpacing: 0.2,
  },
// Phase tag dock
  tagStrip: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  tagLabel: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
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
    fontFamily: fonts.sansMedium,
  },
});