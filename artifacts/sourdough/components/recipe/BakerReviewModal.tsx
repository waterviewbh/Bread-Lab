import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { YieldPill } from '@/components/YieldPill';
import { PhasePickerModal } from './PhasePickerModal';
import { PhaseAssignmentModal, SelectionPayload } from './PhaseAssignmentModal';
import { PhaseIcon, PhaseIconState } from './PhaseIcons';
import { ContinuousListInput } from './ContinuousListInput';
import { ExtractionResult } from '@/lib/recipeExtractor';
import {
  PortableRecipe,
  PortableRecipePhase,
  validatePortableRecipe,
  UNCLASSIFIED_STAGING_KEY,
  generateUuid,
} from '@/lib/recipeImport';
import { PHASE_CATEGORIES, PHASE_DEFINITIONS } from '@/lib/recipeTypes';
import { sortRecipePhases } from '@/lib/recipeUtils';
import { fonts, radius, spacing, typography } from '@/constants/theme';
import { CheckableLine } from '@/types/recipe';

export interface BakerReviewModalRef {
  saveChanges: () => Promise<boolean>;
}

export interface BakerReviewModalProps {
  visible: boolean;
  extractionResult: ExtractionResult | null;
  onSaveAndClose?: (updatedExtractionResult: ExtractionResult) => Promise<void> | void;
  onSaveConfirmed?: (updatedCandidate: PortableRecipe) => Promise<void> | void;
  onPromote?: (portableRecipe: PortableRecipe) => Promise<void> | void;
  onDiscard: () => void;
}

const BakerReviewModalRender: React.ForwardRefRenderFunction<BakerReviewModalRef, BakerReviewModalProps> = (
  {
    visible,
    extractionResult,
    onSaveAndClose,
    onSaveConfirmed,
    onPromote,
    onDiscard,
  },
  ref
) => {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [stagedRecipe, setStagedRecipe] = useState<PortableRecipe | null>(null);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [activeSelection, setActiveSelection] = useState<SelectionPayload | null>(null);
  const [isTossMode, setIsTossMode] = useState(false);
  const [selectedTossIds, setSelectedTossIds] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Active candidate selection
  const candidates: PortableRecipe[] = React.useMemo(() => {
    if (!extractionResult) return [];
    if (extractionResult.status === 'single_candidate') return [extractionResult.candidate];
    if (extractionResult.status === 'multiple_candidates') return extractionResult.candidates;
    return [];
  }, [extractionResult]);

  // Seed stagedRecipe and ensure exactly one persistent Unassigned Material staging phase
  useEffect(() => {
    if (candidates.length > 0) {
      const idx = Math.min(selectedCandidateIdx, candidates.length - 1);
      const candidateCopy = JSON.parse(JSON.stringify(candidates[idx]));

      const stagingPhases = candidateCopy.phases.filter((p: any) => p.key === UNCLASSIFIED_STAGING_KEY);
      const otherPhases = candidateCopy.phases.filter((p: any) => p.key !== UNCLASSIFIED_STAGING_KEY);

      const mergedStaging: PortableRecipePhase = {
        key: UNCLASSIFIED_STAGING_KEY,
        name: 'Unassigned Material',
        ingredients: stagingPhases.flatMap((p: any) => p.ingredients || []),
        instructions: stagingPhases.flatMap((p: any) => p.instructions || []),
      };

      candidateCopy.phases = [mergedStaging, ...otherPhases];
      setStagedRecipe(candidateCopy);
      setIsTossMode(false);
      setSelectedTossIds({});
    } else {
      setStagedRecipe(null);
    }
  }, [candidates, selectedCandidateIdx, visible]);

  const buildUpdatedExtractionResult = (): ExtractionResult => {
    if (!extractionResult) {
      return { status: 'single_candidate', candidate: stagedRecipe!, warnings: [] };
    }
    if (extractionResult.status === 'single_candidate') {
      return {
        ...extractionResult,
        candidate: stagedRecipe!,
      };
    }
    if (extractionResult.status === 'multiple_candidates') {
      const updatedCandidates = [...extractionResult.candidates];
      updatedCandidates[selectedCandidateIdx] = stagedRecipe!;
      return {
        ...extractionResult,
        candidates: updatedCandidates,
      };
    }
    return { status: 'single_candidate', candidate: stagedRecipe!, warnings: [] };
  };

  const handleSaveAndClose = async (): Promise<boolean> => {
    if (!stagedRecipe || isSaving) return false;

    try {
      setIsSaving(true);
      const updatedResult = buildUpdatedExtractionResult();
      if (onSaveAndClose) {
        await onSaveAndClose(updatedResult);
      }
      if (onSaveConfirmed) {
        await onSaveConfirmed(stagedRecipe);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (err: any) {
      Alert.alert('Save Error', err.message || 'Could not save candidate edits.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  React.useImperativeHandle(ref, () => ({
    saveChanges: handleSaveAndClose,
  }));

  if (!visible || !extractionResult) {
    return null;
  }

  const sourceUrl = extractionResult.sourceUrl;

  const handleUiSavePress = async () => {
    const success = await handleSaveAndClose();
    if (success) {
      setStagedRecipe(null);
      setSelectedCandidateIdx(0);
    }
  };

  const handlePromptDiscard = () => {
    Alert.alert(
      'Discard Candidate',
      'Are you sure you want to permanently discard this candidate? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setStagedRecipe(null);
            setSelectedCandidateIdx(0);
            onDiscard();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          },
        },
      ]
    );
  };

  const handleUpdateField = (field: 'name' | 'overview' | 'yieldValue', value: string) => {
    if (!stagedRecipe) return;
    setStagedRecipe({
      ...stagedRecipe,
      [field]: value,
    });
  };

  const handleUpdatePhaseField = (
    phaseKey: string,
    field: 'ingredients' | 'instructions',
    lines: CheckableLine[]
  ) => {
    if (!stagedRecipe) return;
    const updatedPhases = stagedRecipe.phases.map((p) => {
      if (p.key !== phaseKey) return p;
      return {
        ...p,
        [field]: lines.map((l) => ({
          id: l.id || generateUuid(),
          text: l.text,
          is_checked: l.is_checked,
          sort_order: l.sort_order,
        })),
      };
    });
    setStagedRecipe({ ...stagedRecipe, phases: updatedPhases });
  };

  const handleRemovePhase = (phaseKey: string) => {
    if (!stagedRecipe) return;

    const targetPhase = stagedRecipe.phases.find((p) => p.key === phaseKey);
    if (!targetPhase) return;

    if (phaseKey === UNCLASSIFIED_STAGING_KEY) {
      const updatedPhases = stagedRecipe.phases.map((p) =>
        p.key === UNCLASSIFIED_STAGING_KEY ? { ...p, ingredients: [], instructions: [] } : p
      );
      setStagedRecipe({ ...stagedRecipe, phases: updatedPhases });
      return;
    }

    const remainingPhases = stagedRecipe.phases.filter((p) => p.key !== phaseKey);
    const targetIngs = targetPhase.ingredients || [];
    const targetInsts = targetPhase.instructions || [];

    const stagingIdx = remainingPhases.findIndex((p) => p.key === UNCLASSIFIED_STAGING_KEY);
    let updatedPhases = [...remainingPhases];

    if (stagingIdx !== -1) {
      const existingStaging = updatedPhases[stagingIdx];
      updatedPhases[stagingIdx] = {
        ...existingStaging,
        ingredients: [...(existingStaging.ingredients || []), ...targetIngs],
        instructions: [...(existingStaging.instructions || []), ...targetInsts],
      };
    } else {
      updatedPhases.unshift({
        key: UNCLASSIFIED_STAGING_KEY,
        name: 'Unassigned Material',
        ingredients: targetIngs,
        instructions: targetInsts,
      });
    }

    setStagedRecipe({ ...stagedRecipe, phases: updatedPhases });
  };

  const toggleTossSelection = (id: string) => {
    setSelectedTossIds((prev) => ({ ...prev, [id]: !prev[id] }));
    Haptics.selectionAsync();
  };

  const handleTossSelected = () => {
    const idsToToss = Object.keys(selectedTossIds).filter((id) => selectedTossIds[id]);
    if (idsToToss.length === 0) return;

    Alert.alert(
      'Toss Selected Material',
      `Are you sure you want to toss ${idsToToss.length} selected source material item(s)? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Toss',
          style: 'destructive',
          onPress: () => {
            if (!stagedRecipe) return;
            const stagingIdx = stagedRecipe.phases.findIndex((p) => p.key === UNCLASSIFIED_STAGING_KEY);
            if (stagingIdx === -1) return;

            const staging = stagedRecipe.phases[stagingIdx];
            const tossSet = new Set(idsToToss);

            const newIngs = (staging.ingredients || []).filter((l) => !tossSet.has(l.id || ''));
            const newInsts = (staging.instructions || []).filter((l) => !tossSet.has(l.id || ''));

            const updatedPhases = stagedRecipe.phases.map((p, idx) =>
              idx === stagingIdx ? { ...p, ingredients: newIngs, instructions: newInsts } : p
            );

            setStagedRecipe({ ...stagedRecipe, phases: updatedPhases });
            setSelectedTossIds({});
            setIsTossMode(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const handleConfirmAssignment = (
    payload: SelectionPayload,
    targetPhaseKey: string,
    classification: 'ingredients' | 'instructions'
  ) => {
    if (!stagedRecipe) return;
    const stagingIdx = stagedRecipe.phases.findIndex((p) => p.key === UNCLASSIFIED_STAGING_KEY);
    if (stagingIdx === -1) return;

    const staging = stagedRecipe.phases[stagingIdx];
    const allStagingLines = [...(staging.ingredients || []), ...(staging.instructions || [])];
    const sourceLine = allStagingLines.find((l) => l.id === payload.lineId);

    if (!sourceLine) {
      Alert.alert('Assignment Error', 'Selected source line could not be found in Unassigned Material.');
      return;
    }

    const { start, end, text } = payload;
    let assignedText = text;
    let remainderText = '';
    let hasPartial = false;

    if (start !== undefined && end !== undefined && start < end && (start > 0 || end < text.length)) {
      assignedText = text.substring(start, end).trim();
      remainderText = (text.substring(0, start) + text.substring(end)).trim();
      hasPartial = remainderText.length > 0;
    }

    const newAssignedLine: CheckableLine = {
      id: generateUuid(),
      text: assignedText,
      is_checked: false,
      sort_order: 0,
    };

    let phaseFound = false;
    const updatedPhases = stagedRecipe.phases.map((p) => {
      if (p.key === UNCLASSIFIED_STAGING_KEY) {
        let newIngs = [...(p.ingredients || [])];
        let newInsts = [...(p.instructions || [])];

        if (hasPartial) {
          newIngs = newIngs.map((l) => (l.id === payload.lineId ? { ...l, text: remainderText } : l));
          newInsts = newInsts.map((l) => (l.id === payload.lineId ? { ...l, text: remainderText } : l));
        } else {
          newIngs = newIngs.filter((l) => l.id !== payload.lineId);
          newInsts = newInsts.filter((l) => l.id !== payload.lineId);
        }
        return {
          ...p,
          ingredients: newIngs,
          instructions: newInsts,
        };
      }
      if (p.key === targetPhaseKey) {
        phaseFound = true;
        const existing = p[classification] || [];
        return {
          ...p,
          [classification]: [...existing, newAssignedLine],
        };
      }
      return p;
    });

    let finalPhases = [...updatedPhases];
    if (!phaseFound) {
      const def = PHASE_DEFINITIONS.find((d) => d.key === targetPhaseKey);
      finalPhases.push({
        key: targetPhaseKey,
        name: def ? def.name : targetPhaseKey,
        ingredients: classification === 'ingredients' ? [newAssignedLine] : [],
        instructions: classification === 'instructions' ? [newAssignedLine] : [],
      });
    }

    setStagedRecipe({
      ...stagedRecipe,
      phases: finalPhases,
    });
    setShowAssignmentModal(false);
    setActiveSelection(null);
  };

  const handleOpenAssignmentForLine = (lineId: string, text: string) => {
    setActiveSelection({ lineId, text, start: 0, end: text.length });
    setShowAssignmentModal(true);
  };

  const handleConfirmAddPhases = (keysToAdd: string[]) => {
    if (!stagedRecipe) return;
    const existingKeys = new Set(stagedRecipe.phases.map((p) => p.key));

    const newPhases: PortableRecipePhase[] = keysToAdd
      .filter((k) => !existingKeys.has(k))
      .map((k) => {
        const def = PHASE_DEFINITIONS.find((p) => p.key === k);
        return {
          key: k,
          name: def ? def.name : k,
          ingredients: [],
          instructions: [],
        };
      });

    setStagedRecipe({
      ...stagedRecipe,
      phases: sortRecipePhases([...stagedRecipe.phases, ...newPhases]),
    });
    setShowPhasePicker(false);
  };

  const executePromote = async () => {
    if (!stagedRecipe) return;

    const validation = validatePortableRecipe(stagedRecipe);
    if (!validation.valid) {
      Alert.alert('Validation Error', validation.errors.join('\n'));
      return;
    }

    try {
      setIsSaving(true);
      if (onPromote) {
        await onPromote(stagedRecipe);
      }
      setStagedRecipe(null);
      setSelectedCandidateIdx(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Promotion Error', err.message || 'Could not promote recipe.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromoteTap = () => {
    if (!stagedRecipe) return;

    const stagingPhase = stagedRecipe.phases.find((p) => p.key === UNCLASSIFIED_STAGING_KEY);
    const hasUnassigned = stagingPhase && (
      (stagingPhase.ingredients && stagingPhase.ingredients.length > 0) ||
      (stagingPhase.instructions && stagingPhase.instructions.length > 0)
    );

    if (hasUnassigned) {
      Alert.alert(
        'Unassigned Material Warning',
        'Some recipe content remains in Unassigned Material. Please assign all ingredients and instructions to phases before committing as a Recipe.',
        [
          { text: 'Assign to Phase', style: 'default', onPress: () => {
            const firstIng = stagingPhase?.ingredients?.[0];
            if (firstIng) {
              handleOpenAssignmentForLine(firstIng.id || 'ing-0', firstIng.text);
            }
          }},
        ]
      );
    } else {
      executePromote();
    }
  };

  const availablePhases = stagedRecipe
    ? PHASE_DEFINITIONS.filter((d) => !stagedRecipe.phases.some((p) => p.key === d.key))
    : [];

  const availableCategories = PHASE_CATEGORIES.map((cat) => ({
    ...cat,
    phases: cat.phases.filter((d) => availablePhases.some((a) => a.key === d.key)),
  })).filter((cat) => cat.phases.length > 0);

  // Semantically neutral icon state counting rule:
  // ingredients.length === 0 && instructions.length === 0 -> empty
  // ingredients.length > 0 XOR instructions.length > 0 -> some (1 element is sufficient)
  // ingredients.length > 0 && instructions.length > 0 -> both
  const getPhaseState = (p: PortableRecipePhase): PhaseIconState => {
    const hasIngs = (p.ingredients || []).filter((l) => l.text.trim().length > 0).length > 0;
    const hasInsts = (p.instructions || []).filter((l) => l.text.trim().length > 0).length > 0;
    if (hasIngs && hasInsts) return 'both';
    if (hasIngs || hasInsts) return 'some';
    return 'empty';
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleSaveAndClose}
      testID="baker-review-modal"
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View
            style={[
              s.header,
              { borderBottomColor: colors.border, paddingTop: insets.top + 16 },
            ]}
          >
            <View style={{ width: 24 }} />
            <Text style={[s.headerTitle, { color: colors.foreground }]}>
              Candidate Review
            </Text>
            <Pressable
              onPress={handleSaveAndClose}
              disabled={isSaving || !stagedRecipe}
              testID="review-save-btn"
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[s.saveText, { color: colors.accent }]}>
                {isSaving ? 'Saving...' : 'Save & Close'}
              </Text>
            </Pressable>
          </View>

          {/* Source Provenance Banner */}
          {sourceUrl ? (
            <View style={[s.provenanceRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Feather name="link-2" size={13} color={colors.foreground} />
              <Text style={[s.provenanceText, { color: colors.foreground }]} numberOfLines={1}>
                Source: {sourceUrl}
              </Text>
            </View>
          ) : null}

          {/* Multiple Candidates Selector Tabs */}
          {extractionResult.status === 'multiple_candidates' && candidates.length > 1 && (
            <View style={[s.candidateTabsRow, { borderBottomColor: colors.border }]}>
              <Text style={[s.candidateTabsLabel, { color: colors.mutedForeground }]}>
                Multiple Candidates ({candidates.length}):
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                {candidates.map((c, idx) => {
                  const active = idx === selectedCandidateIdx;
                  return (
                    <Pressable
                      key={`candidate-tab-${idx}`}
                      onPress={() => {
                        setSelectedCandidateIdx(idx);
                        Haptics.selectionAsync();
                      }}
                      style={[
                        s.candidateTab,
                        {
                          backgroundColor: active ? colors.primary : colors.muted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      testID={`candidate-tab-${idx}`}
                    >
                      <Text
                        style={[
                          s.candidateTabText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {c.name || `Candidate ${idx + 1}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Staged Recipe Review Form */}
          {stagedRecipe ? (
            <ScrollView
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 16,
                paddingBottom: insets.bottom + 100,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Candidate Warning Badge */}
              <View style={[s.warningBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Feather name="alert-triangle" size={14} color={colors.foreground} />
                <Text style={[s.warningText, { color: colors.foreground }]}>
                  Candidate — Review fields & assign phases before committing as a Recipe.
                </Text>
              </View>

              {/* Recipe Name Input */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 14 }]}>
                Recipe Name
              </Text>
              <TextInput
                style={[
                  s.nameInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    fontFamily: fonts.sansMedium,
                  },
                ]}
                value={stagedRecipe.name}
                onChangeText={(t) => handleUpdateField('name', t)}
                placeholder="Recipe Name"
                placeholderTextColor={colors.mutedForeground}
                testID="staged-name-input"
              />

              {/* Overview Input */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 12 }]}>
                Overview
              </Text>
              <TextInput
                style={[
                  s.overviewInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    fontFamily: fonts.sans,
                  },
                ]}
                value={stagedRecipe.overview ?? ''}
                onChangeText={(t) => handleUpdateField('overview', t)}
                placeholder="Short description / baker notes..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={2}
              />

              {/* Yield Pill */}
              <YieldPill
                isBuilder={true}
                value={stagedRecipe.yieldValue ?? '1'}
                onChangeValue={(v) => handleUpdateField('yieldValue', v)}
              />

              {/* Phases */}
              <Text style={[s.fieldLabel, { color: colors.mutedForeground, marginTop: 20 }]}>
                Phases ({stagedRecipe.phases.length})
              </Text>

              <View style={{ gap: 12, marginTop: 8 }}>
                {stagedRecipe.phases.map((phase, pIdx) => {
                  const isStaging = phase.key === UNCLASSIFIED_STAGING_KEY;
                  const hasStagingContent =
                    (phase.ingredients && phase.ingredients.length > 0) ||
                    (phase.instructions && phase.instructions.length > 0);

                  return (
                    <View
                      key={`${phase.key}-${pIdx}`}
                      style={[
                        s.phaseCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          borderWidth: 1,
                        },
                      ]}
                      testID={`phase-card-${phase.key}`}
                    >
                      <View style={s.phaseHeader}>
                        <View style={s.phaseHeaderLeft}>
                          {!isStaging && (
                            <View style={{ marginRight: 6 }}>
                              <PhaseIcon phaseKey={phase.key} state={getPhaseState(phase)} size={26} />
                            </View>
                          )}
                          <View
                            style={[
                              s.phaseBadge,
                              { backgroundColor: colors.primary },
                            ]}
                          >
                            <Text style={[s.phaseBadgeText, { color: colors.primaryForeground }]}>{pIdx + 1}</Text>
                          </View>
                          <Text
                            style={[
                              s.phaseTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {phase.name || phase.key}
                          </Text>
                        </View>

                        <Pressable
                          onPress={() => handleRemovePhase(phase.key)}
                          hitSlop={8}
                          testID={`remove-phase-${phase.key}`}
                        >
                          <Feather name="x" size={16} color={colors.mutedForeground} />
                        </Pressable>
                      </View>

                      {/* Unassigned Material Persistent Workbench with "Select to Toss" mode & editable TextInput */}
                      {isStaging ? (
                        <View style={[s.stagingWorkbench, { backgroundColor: colors.secondary, borderColor: colors.border }]} testID="classify-phase-btn">
                          <View style={s.stagingHeaderRow}>
                            <Text style={[s.stagingWorkbenchTitle, { color: colors.foreground }]}>
                              {hasStagingContent
                                ? 'Source material waiting for phase classification:'
                                : 'Workbench empty — all material assigned.'}
                            </Text>

                            {hasStagingContent && (
                              <Pressable
                                onPress={() => {
                                  setIsTossMode(!isTossMode);
                                  setSelectedTossIds({});
                                  Haptics.selectionAsync();
                                }}
                                style={[
                                  s.tossModeToggleBtn,
                                  {
                                    backgroundColor: isTossMode ? colors.muted : 'transparent',
                                    borderColor: colors.border,
                                  },
                                ]}
                                testID="toggle-toss-mode-btn"
                              >
                                <Text style={[s.tossModeToggleText, { color: colors.foreground }]}>
                                  {isTossMode ? 'Cancel' : 'Select to Toss'}
                                </Text>
                              </Pressable>
                            )}
                          </View>

                          {/* Toss action bar when in toss mode */}
                          {isTossMode && hasStagingContent && (
                            <View style={[s.tossActionBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[s.tossActionInfo, { color: colors.foreground }]}>
                                {Object.values(selectedTossIds).filter(Boolean).length} selected
                              </Text>
                              <Pressable
                                onPress={handleTossSelected}
                                disabled={!Object.values(selectedTossIds).some(Boolean)}
                                style={[
                                  s.tossSelectedBtn,
                                  {
                                    backgroundColor: Object.values(selectedTossIds).some(Boolean)
                                      ? colors.destructive
                                      : colors.muted,
                                  },
                                ]}
                                testID="toss-selected-btn"
                              >
                                <Text style={[s.tossSelectedBtnText, { color: colors.destructiveForeground }]}>Toss Selected</Text>
                              </Pressable>
                            </View>
                          )}

                          {/* Ingredient lines */}
                          {(phase.ingredients || []).map((ing) => {
                            const tossSelected = !!selectedTossIds[ing.id || ''];
                            return (
                              <Pressable
                                key={ing.id || generateUuid()}
                                onPress={isTossMode ? () => toggleTossSelection(ing.id || '') : undefined}
                                style={[
                                  s.stagingLineRow,
                                  {
                                    backgroundColor: tossSelected ? colors.secondary : colors.card,
                                    borderColor: tossSelected ? colors.destructive : colors.border,
                                  },
                                ]}
                                testID={`staging-line-${ing.id}`}
                              >
                                {isTossMode && (
                                  <View
                                    style={[
                                      s.tossCheckbox,
                                      {
                                        borderColor: tossSelected ? colors.destructive : colors.border,
                                        backgroundColor: tossSelected ? colors.destructive : 'transparent',
                                      },
                                    ]}
                                  >
                                    {tossSelected && <Feather name="check" size={10} color={colors.destructiveForeground} />}
                                  </View>
                                )}
                                <TextInput
                                  style={[s.stagingLineInput, { color: colors.foreground }]}
                                  value={ing.text}
                                  onChangeText={(newText) => {
                                    const updated = (phase.ingredients || []).map((i) =>
                                      i.id === ing.id ? { ...i, text: newText } : i
                                    );
                                    handleUpdatePhaseField(phase.key, 'ingredients', updated);
                                  }}
                                  placeholder="Ingredient text..."
                                  placeholderTextColor={colors.mutedForeground}
                                />
                                {!isTossMode && (
                                  <Pressable
                                    onPress={() => handleOpenAssignmentForLine(ing.id || generateUuid(), ing.text)}
                                    style={[s.inlineAssignBtn, { backgroundColor: colors.primary }]}
                                    testID={`assign-line-btn-${ing.id}`}
                                  >
                                    <Text style={[s.inlineAssignBtnText, { color: colors.primaryForeground }]}>Assign →</Text>
                                  </Pressable>
                                )}
                              </Pressable>
                            );
                          })}

                          {/* Instruction lines */}
                          {(phase.instructions || []).map((ins) => {
                            const tossSelected = !!selectedTossIds[ins.id || ''];
                            return (
                              <Pressable
                                key={ins.id || generateUuid()}
                                onPress={isTossMode ? () => toggleTossSelection(ins.id || '') : undefined}
                                style={[
                                  s.stagingLineRow,
                                  {
                                    backgroundColor: tossSelected ? colors.secondary : colors.card,
                                    borderColor: tossSelected ? colors.destructive : colors.border,
                                  },
                                ]}
                                testID={`staging-line-${ins.id}`}
                              >
                                {isTossMode && (
                                  <View
                                    style={[
                                      s.tossCheckbox,
                                      {
                                        borderColor: tossSelected ? colors.destructive : colors.border,
                                        backgroundColor: tossSelected ? colors.destructive : 'transparent',
                                      },
                                    ]}
                                  >
                                    {tossSelected && <Feather name="check" size={10} color={colors.destructiveForeground} />}
                                  </View>
                                )}
                                <TextInput
                                  style={[s.stagingLineInput, { color: colors.foreground }]}
                                  value={ins.text}
                                  onChangeText={(newText) => {
                                    const updated = (phase.instructions || []).map((i) =>
                                      i.id === ins.id ? { ...i, text: newText } : i
                                    );
                                    handleUpdatePhaseField(phase.key, 'instructions', updated);
                                  }}
                                  placeholder="Instruction text..."
                                  placeholderTextColor={colors.mutedForeground}
                                />
                                {!isTossMode && (
                                  <Pressable
                                    onPress={() => handleOpenAssignmentForLine(ins.id || generateUuid(), ins.text)}
                                    style={[s.inlineAssignBtn, { backgroundColor: colors.primary }]}
                                    testID={`assign-line-btn-${ins.id}`}
                                  >
                                    <Text style={[s.inlineAssignBtnText, { color: colors.primaryForeground }]}>Assign →</Text>
                                  </Pressable>
                                )}
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <>
                          {/* Ingredients */}
                          <Text style={[s.subLabel, { color: colors.mutedForeground, marginTop: 8 }]}>
                            Ingredients
                          </Text>
                          <ContinuousListInput
                            lines={(phase.ingredients || []).map((i) => ({
                              id: i.id || generateUuid(),
                              text: i.text,
                              is_checked: i.is_checked || false,
                              sort_order: i.sort_order || 0,
                            }))}
                            onUpdateLines={(lines) => handleUpdatePhaseField(phase.key, 'ingredients', lines)}
                            placeholder="500g flour..."
                          />

                          {/* Instructions */}
                          <Text style={[s.subLabel, { color: colors.mutedForeground, marginTop: 10 }]}>
                            Instructions
                          </Text>
                          <ContinuousListInput
                            lines={(phase.instructions || []).map((i) => ({
                              id: i.id || generateUuid(),
                              text: i.text,
                              is_checked: i.is_checked || false,
                              sort_order: i.sort_order || 0,
                            }))}
                            onUpdateLines={(lines) => handleUpdatePhaseField(phase.key, 'instructions', lines)}
                            placeholder="Mix ingredients..."
                          />
                        </>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Add Phase Button */}
              {availableCategories.length > 0 && (
                <Pressable
                  onPress={() => setShowPhasePicker(true)}
                  style={[s.addPhaseBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  testID="open-add-phase-btn"
                >
                  <Feather name="plus" size={14} color={colors.accent} />
                  <Text style={[s.addPhaseBtnText, { color: colors.accent }]}>
                    Add Phase
                  </Text>
                </Pressable>
              )}

              {/* Promote Action Button */}
              <Pressable
                onPress={handlePromoteTap}
                style={[s.promoteBtn, { backgroundColor: colors.primary }]}
                testID="promote-candidate-btn"
              >
                <Feather name="check-circle" size={16} color={colors.primaryForeground} />
                <Text style={[s.promoteBtnText, { color: colors.primaryForeground }]}>Promote to Recipe</Text>
              </Pressable>

              {/* Discard Candidate Action Button */}
              <Pressable
                onPress={handlePromptDiscard}
                style={s.discardBtn}
                testID="review-discard-btn"
                hitSlop={8}
              >
                <Feather name="trash-2" size={14} color={colors.mutedForeground} />
                <Text style={[s.discardBtnText, { color: colors.mutedForeground }]}>Discard Candidate</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </KeyboardAvoidingView>

        {/* Phase Picker Modal */}
        <PhasePickerModal
          visible={showPhasePicker}
          availableCategories={availableCategories}
          onConfirm={handleConfirmAddPhases}
          onClose={() => setShowPhasePicker(false)}
        />

        {/* Phase Assignment Modal */}
        <PhaseAssignmentModal
          visible={showAssignmentModal}
          selectionPayload={activeSelection}
          existingPhases={stagedRecipe?.phases || []}
          onConfirmAssignment={handleConfirmAssignment}
          onClose={() => {
            setShowAssignmentModal(false);
            setActiveSelection(null);
          }}
        />
      </View>
    </Modal>
  );
};

export const BakerReviewModal = React.forwardRef(BakerReviewModalRender);

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
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
  saveText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  provenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  provenanceText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    flex: 1,
  },
  candidateTabsRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  candidateTabsLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  candidateTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    marginRight: 8,
  },
  candidateTabText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  warningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 16,
  },
  warningText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    flex: 1,
  },
  fieldLabel: {
    ...typography.sectionLabel,
    marginBottom: 6,
  },
  nameInput: {
    height: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  overviewInput: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  phaseCard: {
    padding: 14,
    borderRadius: radius.lg,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  phaseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  phaseBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseBadgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  phaseTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  stagingWorkbench: {
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    marginVertical: 8,
    gap: 8,
  },
  stagingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stagingWorkbenchTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    flex: 1,
  },
  tossModeToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  tossModeToggleText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
  },
  tossActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  tossActionInfo: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  tossSelectedBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  tossSelectedBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
  stagingLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
  },
  tossCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagingLineInput: {
    fontFamily: fonts.sans,
    fontSize: 13,
    flex: 1,
    paddingVertical: 4,
  },
  inlineAssignBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  inlineAssignBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
  },
  subLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  addPhaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: 16,
  },
  addPhaseBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
  },
  promoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: radius.lg,
    marginTop: 24,
  },
  promoteBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  discardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 12,
  },
  discardBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
});
