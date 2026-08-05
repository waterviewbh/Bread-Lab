/**
* artifacts/sourdough/components/recipe/ContinuousListInput.tsx
* A zero-friction, Slack-style input component designed to manage an array of individual line items
* without forcing manual "Add" taps. It intercepts the "Enter" key to instantly provision new line
* objects and shift keyboard focus, while also handling backspace-merging and multi-line pastes.
* This component is central to transitioning the user experience from single text blocks to
* structured, interactive checklists.
*/
import React, { useRef, useEffect, useState } from 'react';
import { TextInput, View, StyleSheet, InteractionManager } from 'react-native';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { fonts, radius, spacing } from '@/constants/theme'; // Added radius and spacing
import { CheckableLine } from '../../types/recipe';

interface Props {
  lines: CheckableLine[];
  onUpdateLines: (updated: CheckableLine[]) => void;
  placeholder?: string;
}

export function ContinuousListInput({ lines, onUpdateLines, placeholder }: Props) {
  const colors = useColors();
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  // NEW: Track cursor selection for each line
  const selectionRefs = useRef<Record<string, { start: number; end: number }>>({});
  const lastLinesLength = useRef(lines.length);
  // 2. A state to track one-time "forced" selections, e.g., splitting or merging lines
  const [targetSelection, setTargetSelection] = useState<{
    id: string;
    start: number;
    end: number
  } | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  // Releases the cursor after a very short delay
  useEffect(() => {
    if (targetSelection || pendingFocusId) {
      if (pendingFocusId) {
        inputRefs.current[pendingFocusId]?.focus();
        setPendingFocusId(null);
      }
      const timer = setTimeout(() => {
        setTargetSelection(null);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [targetSelection, pendingFocusId]);

  // Auto-focus the first line if we just transitioned from an empty state
  useEffect(() => {
    if (lastLinesLength.current === 0 && lines.length > 0) {
      const firstId = lines[0].id;
      InteractionManager.runAfterInteractions(() => {
        inputRefs.current[firstId]?.focus();
      });
    }
    lastLinesLength.current = lines.length;
  }, [lines]);

    const handleTextChange = (id: string, index: number, newText: string) => {
      const oldText = lines[index]?.text || "";

      // ── Case 1: Enter Key (Single newline added) ──
      // If the text grew by exactly 1 character and contains a newline, it's an Enter press.
      // We use the smart split logic to respect the cursor position.
      if (newText.includes('\n') && newText.length === oldText.length + 1) {
        handleEnterKeyPress(id, index);
        return;
      }

      // ── Case 2: Multi-line Paste ──
      // If multiple newlines were added (or a large block), split the whole thing into objects.
      if (newText.includes('\n')) {
        const parts = newText.split('\n').filter(s => s.trim().length > 0);
        const newLines = parts.map(text => ({
          id: randomUUID(),
          text,
          is_checked: false,
          sort_order: 0
        }));
        const updated = [...lines];
        updated.splice(index, 1, ...newLines);
        onUpdateLines(updated);
        return;
      }

      // ── Case 3: Normal Typing ──
      onUpdateLines(lines.map(line => line.id === id ? { ...line, text: newText } : line));
    };

  const handleEnterKeyPress = (id: string, index: number) => {
    const selection = selectionRefs.current[id] || { start: 0, end: 0 };
    const currentText = lines[index].text;

    // If selection happened on a version of text that ALREADY had the \n (native side),
    // we need to cap the split point to the current state's length.
    const splitPoint = Math.min(selection.start, currentText.length);

    const stayingText = currentText.substring(0, splitPoint);
    const movingText = currentText.substring(splitPoint);

    const newId = randomUUID();
    const updatedList = [...lines];

    updatedList[index] = { ...updatedList[index], text: stayingText };
    updatedList.splice(index + 1, 0, {
      id: newId,
      text: movingText,
      is_checked: false,
      sort_order: index + 1
    });

    selectionRefs.current[newId] = { start: 0, end: 0 };
    setTargetSelection({ id: newId, start: 0, end: 0 });
    setPendingFocusId(newId);

    onUpdateLines(updatedList);
    Haptics.selectionAsync();
  };

  const handleKeyPress = (id: string, index: number, key: string) => {
    // Smart merge logic
    const selection = selectionRefs.current[id] || { start: 0, end: 0 };

    if (key === 'Backspace' && selection.start === 0 && selection.end === 0 && index > 0) {
      // Merge with previous line
      const prevLine = lines[index - 1];
      const currentText = lines[index].text;

      // Calculate merge point in the case of merge (where the old text ends and new text begins)
      const mergePoint = prevLine.text.length;

      const updatedList = lines.filter(l => l.id !== id);
      updatedList[index - 1] = {
        ...prevLine,
        text: prevLine.text + currentText
      };

      // Pre-emptively set the internal state for the line we are merging into
      selectionRefs.current[prevLine.id] = { start: mergePoint, end: mergePoint };

      // Force cursor to the MERGE POINT on the previous line
      setTargetSelection({ id: prevLine.id, start: mergePoint, end: mergePoint });

      setPendingFocusId(prevLine.id);

      onUpdateLines(updatedList);
      Haptics.selectionAsync();

      delete inputRefs.current[id];
      delete selectionRefs.current[id];
    }
  };

  const createInitialLine = () => {
    onUpdateLines([{
      id: randomUUID(),
      text: '',
      is_checked: false,
      sort_order: 0
    }]);
  };

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: radius.md,
        minHeight: 44,
      }
    ]}>
      {lines.length === 0 ? (
        <TextInput
          style={[styles.lineInput,
          {
            color: colors.foreground,
            fontFamily: fonts.sans,
            borderBottomWidth: 0,
            textAlignVertical: 'top'
          }]}
          multiline={true}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          onFocus={createInitialLine}
          blurOnSubmit={false}
          returnKeyType="next"
        />
      ) : (
        lines.map((line, index) => (
          <TextInput
            key={line.id}
            ref={el => {inputRefs.current[line.id] = el}}
            value={line.text}
            // ── Change 1: Pass the index to the handler ──
            onChangeText={(text) => handleTextChange(line.id, index, text)}
            // ── Change 2: Enable multiline for wrapping ──
            multiline={true}
            onKeyPress={({ nativeEvent }) => handleKeyPress(line.id, index, nativeEvent.key)}
            selection={targetSelection?.id === line.id ? { start: targetSelection.start, end: targetSelection.end } : undefined}
            onSelectionChange={({ nativeEvent }) => {
              selectionRefs.current[line.id] = nativeEvent.selection;
            }}
            placeholder={index === 0 ? placeholder : ""}
            placeholderTextColor={colors.mutedForeground}
            blurOnSubmit={false}
            // Note: onSubmitEditing might not fire in multiline mode on some platforms,
            // which is why we handle it in handleTextChange above.
            onSubmitEditing={() => handleEnterKeyPress(line.id, index)}
            returnKeyType="next"
            style={[
              styles.lineInput,
              {
                color: colors.foreground,
                fontFamily: fonts.sans,
                borderBottomWidth: 0
              }
            ]}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 44,      // Compact container
    overflow: 'hidden',
  },
  lineInput: {
    minHeight: 44,      // Match container minHeight
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  }
});