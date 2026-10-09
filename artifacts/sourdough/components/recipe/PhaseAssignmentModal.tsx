import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { fonts, radius, spacing, typography } from '@/constants/theme';
import { PortableRecipePhase, UNCLASSIFIED_STAGING_KEY } from '@/lib/recipeImport';
import { PHASE_CATEGORIES } from '@/lib/recipeTypes';
import { PhaseIcon, PhaseIconState } from './PhaseIcons';

export interface SelectionPayload {
  lineId: string;
  text: string;
  start?: number;
  end?: number;
}

interface PhaseAssignmentModalProps {
  visible: boolean;
  selectionPayload: SelectionPayload | null;
  existingPhases: PortableRecipePhase[];
  onConfirmAssignment: (
    payload: SelectionPayload,
    targetPhaseKey: string,
    classification: 'ingredients' | 'instructions'
  ) => void;
  onClose: () => void;
}

export function classifyMaterialSnippet(text: string): 'ingredients' | 'instructions' | 'ambiguous' {
  if (!text) return 'ambiguous';
  const lower = text.toLowerCase().trim();

  const instructionPhrases = /^(to make|prepare|weigh|measure|spoon|sweep|mix|knead|autolyse|fold|stretch|shape|score|rest|ferment|proof|cool|preheat|pour|stir|combine|cover|cook|heat|turn|dump|let|allow|place|transfer|divide|round|preshape|spray|load|remove|slice)\b/i;
  const instructionVerbs = /\b(weigh|measure|spoon|sweep|mix|knead|autolyse|fold|stretch|shape|score|rest|ferment|proof|cool|preheat|pour|stir|combine|cover|cook|heat|turn|dump|place|transfer|divide|round|preshape|spray|load|remove|slice)\b/i;

  const ingredientLinePattern = /^(\d+|[\d\/½⅓¼¾⅐⅑⅒⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*(g|kg|mg|ml|l|oz|lb|cup|cups|tbsp|tsp|gram|grams|pinch|dash|clove|cloves|packet|packets|drop|drops)\b/i;
  const ingredientKeywords = /\b(flour|water|salt|starter|levain|yeast|seeds|oil|honey|sugar|butter|milk|eggs|sourdough|rye|spelt|wheat|poolish|biga)\b/i;

  if (instructionPhrases.test(lower) || (instructionVerbs.test(lower) && !ingredientLinePattern.test(lower))) {
    return 'instructions';
  }

  if (ingredientLinePattern.test(lower) || (ingredientKeywords.test(lower) && !instructionVerbs.test(lower))) {
    return 'ingredients';
  }

  if (instructionVerbs.test(lower)) {
    return 'instructions';
  }
  if (ingredientKeywords.test(lower)) {
    return 'ingredients';
  }

  return 'ambiguous';
}

export function PhaseAssignmentModal({
  visible,
  selectionPayload,
  existingPhases,
  onConfirmAssignment,
  onClose,
}: PhaseAssignmentModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [targetPhaseKey, setTargetPhaseKey] = useState<string>(PHASE_CATEGORIES[0].phases[0].key);
  const [classification, setClassification] = useState<'ingredients' | 'instructions'>('ingredients');

  useEffect(() => {
    if (PHASE_CATEGORIES[0]?.phases[0] && !targetPhaseKey) {
      setTargetPhaseKey(PHASE_CATEGORIES[0].phases[0].key);
    }
  }, [targetPhaseKey]);

  // Auto-classify when payload opens with high confidence
  useEffect(() => {
    if (selectionPayload?.text) {
      const snippet =
        selectionPayload.start !== undefined &&
        selectionPayload.end !== undefined &&
        selectionPayload.start < selectionPayload.end
          ? selectionPayload.text.substring(selectionPayload.start, selectionPayload.end)
          : selectionPayload.text;
      const cls = classifyMaterialSnippet(snippet);
      if (cls !== 'ambiguous') {
        setClassification(cls);
      }
    }
  }, [selectionPayload]);

  const getPhaseState = (phaseKey: string): PhaseIconState => {
    const p = existingPhases.find((item) => item.key === phaseKey);
    if (!p) return 'empty';
    const hasIngs = (p.ingredients || []).filter((l) => l.text.trim().length > 0).length > 0;
    const hasInsts = (p.instructions || []).filter((l) => l.text.trim().length > 0).length > 0;
    if (hasIngs && hasInsts) return 'both';
    if (hasIngs || hasInsts) return 'some';
    return 'empty';
  };

  const handleConfirm = () => {
    if (!selectionPayload || !selectionPayload.text || !selectionPayload.lineId) {
      Alert.alert(
        'Selection Required',
        'No material selected. Please select a line item or text snippet in Unassigned Material before tapping Assign to Phase.'
      );
      return;
    }
    if (!targetPhaseKey) {
      Alert.alert('Phase Required', 'Please choose a destination phase.');
      return;
    }

    onConfirmAssignment(selectionPayload, targetPhaseKey, classification);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const previewText =
    selectionPayload &&
    selectionPayload.start !== undefined &&
    selectionPayload.end !== undefined &&
    selectionPayload.start < selectionPayload.end
      ? selectionPayload.text.substring(selectionPayload.start, selectionPayload.end)
      : selectionPayload?.text || '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      testID="phase-assignment-modal"
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border, paddingTop: insets.top + 16 }]}>
          <Pressable onPress={onClose} hitSlop={8} testID="close-assignment-modal">
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Phase Assignment Modal</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Compact Context Header: Source Material & Classification Override */}
        <View style={[s.contextContainer, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <View style={[s.stagedCard, { backgroundColor: '#FBF2ED', borderColor: '#E9E1DC' }]}>
            <View style={s.stagedCardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="arrow-right-circle" size={12} color="#7D553F" />
                <Text style={s.stagedCardHeaderLabel}>SOURCE MATERIAL STAGED</Text>
              </View>
              <Text style={s.stagedCardMeta}>1 line item</Text>
            </View>
            <Text style={[s.stagedCardBody, { color: colors.foreground }]} numberOfLines={2}>
              "{previewText || 'No material selected'}"
            </Text>
          </View>

          {/* Compact Classification Override */}
          <View style={s.classificationInlineRow}>
            <Text style={[s.classifyLabel, { color: colors.mutedForeground }]}>Classify:</Text>
            <Pressable
              onPress={() => {
                setClassification('ingredients');
                Haptics.selectionAsync();
              }}
              style={[
                s.classifyChip,
                {
                  backgroundColor: classification === 'ingredients' ? '#432412' : colors.background,
                  borderColor: classification === 'ingredients' ? '#432412' : colors.border,
                },
              ]}
              testID="classify-ingredient-btn"
            >
              <Text style={[s.classifyChipText, { color: classification === 'ingredients' ? '#FFF' : colors.foreground }]}>
                Ingredient
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setClassification('instructions');
                Haptics.selectionAsync();
              }}
              style={[
                s.classifyChip,
                {
                  backgroundColor: classification === 'instructions' ? '#432412' : colors.background,
                  borderColor: classification === 'instructions' ? '#432412' : colors.border,
                },
              ]}
              testID="classify-instruction-btn"
            >
              <Text style={[s.classifyChipText, { color: classification === 'instructions' ? '#FFF' : colors.foreground }]}>
                Instruction
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Scrollable Destination Phase List */}
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          <Text style={[s.destinationListTitle, { color: colors.mutedForeground }]}>
            CHOOSE DESTINATION PHASE
          </Text>

          <View style={{ gap: 20, marginTop: 10 }}>
            {PHASE_CATEGORIES.map((cat, catIdx) => (
              <View key={cat.key}>
                <View style={s.categoryHeaderRow}>
                  <Text style={[s.categoryHeaderText, { color: colors.mutedForeground }]}>
                    0{catIdx + 1} / {cat.name.toUpperCase()}
                  </Text>
                </View>

                <View style={{ gap: 8, marginTop: 8 }}>
                  {cat.phases.map((def) => {
                    const active = targetPhaseKey === def.key;
                    const phaseState = getPhaseState(def.key);

                    return (
                      <Pressable
                        key={def.key}
                        onPress={() => {
                          setTargetPhaseKey(def.key);
                          Haptics.selectionAsync();
                        }}
                        style={[
                          s.phaseOptionCard,
                          {
                            backgroundColor: active ? '#F5ECE7' : colors.card,
                            borderColor: active ? '#432412' : colors.border,
                            borderWidth: active ? 1.5 : 1,
                          },
                        ]}
                        testID={`dest-phase-option-${def.key}`}
                      >
                        <PhaseIcon phaseKey={def.key} state={phaseState} size={36} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[s.phaseOptionTitle, { color: colors.foreground }]}>{def.name}</Text>
                          <Text numberOfLines={1} style={[s.phaseOptionHint, { color: colors.mutedForeground }]}>
                            {def.hint}
                          </Text>
                        </View>
                        <View
                          style={[
                            s.radioOuter,
                            { borderColor: active ? '#432412' : colors.border },
                          ]}
                        >
                          {active && <View style={s.radioInner} />}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Fixed Footer Actions */}
        <View style={[s.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 16, backgroundColor: colors.background }]}>
          <Pressable
            onPress={onClose}
            style={[s.footerCancelBtn, { backgroundColor: '#E9E1DC', borderColor: '#D5C3BB' }]}
            testID="cancel-assignment-btn"
          >
            <Text style={[s.cancelBtnText, { color: '#50443E' }]}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            style={[s.footerConfirmBtn, { backgroundColor: '#432412' }]}
            testID="confirm-assignment-btn"
          >
            <Text style={s.confirmBtnText}>CONFIRM ASSIGNMENT</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 18,
  },
  contextContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  stagedCard: {
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  stagedCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  stagedCardHeaderLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: '#7D553F',
  },
  stagedCardMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: '#83746D',
  },
  stagedCardBody: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  classificationInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  classifyLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
  classifyChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  classifyChipText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
  destinationListTitle: {
    ...typography.sectionLabel,
    letterSpacing: 1,
    marginBottom: 4,
  },
  categoryHeaderRow: {
    marginBottom: 2,
  },
  categoryHeaderText: {
    ...typography.sectionLabel,
    letterSpacing: 1,
    fontSize: 11,
  },
  phaseOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  phaseOptionTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 15,
  },
  phaseOptionHint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    marginTop: 1,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#432412',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  footerCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  footerConfirmBtn: {
    flex: 2,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: fonts.sansSemiBold,
    color: '#FFF',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
