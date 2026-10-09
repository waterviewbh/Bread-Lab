import React, { useState, useRef } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { extractRecipeFromText, ExtractionResult } from '@/lib/recipeExtractor';
import { saveCandidate, CandidateRecord } from '@/lib/candidateStorage';
import { fonts, radius, typography } from '@/constants/theme';

export interface PasteCandidateModalProps {
  visible: boolean;
  onClose: () => void;
  onExtractSuccess: (record: CandidateRecord) => void;
}

export function PasteCandidateModal({
  visible,
  onClose,
  onExtractSuccess,
}: PasteCandidateModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === 'web' ? 67 : 0;

  const [pastedText, setPastedText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isExtractingRef = useRef(false);

  const resetForm = () => {
    setPastedText('');
    setErrorMessage(null);
    setIsProcessing(false);
    isExtractingRef.current = false;
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleExtract = async () => {
    if (isExtractingRef.current || isProcessing) return;
    const trimmed = pastedText.trim();
    if (!trimmed) {
      setErrorMessage('Please paste recipe text before extracting.');
      return;
    }

    isExtractingRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const result = extractRecipeFromText(trimmed);

      if (result.status === 'no_candidate') {
        const reasonMsg = result.reason || 'Could not identify recipe elements in the pasted text.';
        setErrorMessage(reasonMsg);
        Alert.alert('Extraction Failed', reasonMsg);
        isExtractingRef.current = false;
        setIsProcessing(false);
        return;
      }

      const savedRecord = await saveCandidate(result, undefined, 'paste');
      resetForm();
      onExtractSuccess(savedRecord);
    } catch (e: any) {
      const errText = e?.message || 'An unexpected error occurred during extraction.';
      setErrorMessage(errText);
      Alert.alert('Extraction Error', errText);
      isExtractingRef.current = false;
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      testID="paste-candidate-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + webTop + 24, paddingBottom: 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              testID="close-paste-modal-btn"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                Paste Recipe Candidate
              </Text>
            </View>
            <View style={{ width: 24 }} />
          </View>

          {/* Explanation Banner */}
          <View
            style={[
              styles.banner,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
            <Text style={[styles.bannerText, { color: colors.foreground }]}>
              Paste any unstructured recipe text, blog post, or AI chat transcript below. Bread Lab will extract ingredients and instructions into a reviewable candidate.
            </Text>
          </View>

          {/* Error Message */}
          {errorMessage && (
            <View style={styles.errorBox} testID="paste-error-banner">
              <Ionicons name="alert-circle" size={16} color="#BA1A1A" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Text Input Area */}
          <View style={{ marginTop: 20 }}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Raw Recipe Content
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: fonts.sans,
                },
              ]}
              placeholder="Paste raw recipe text here..."
              placeholderTextColor={colors.mutedForeground}
              value={pastedText}
              onChangeText={setPastedText}
              multiline
              textAlignVertical="top"
              testID="paste-recipe-textarea"
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [
                styles.cancelBtn,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              testID="cancel-paste-modal-btn"
            >
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPressIn={handleExtract}
              disabled={isProcessing || !pastedText.trim()}
              style={({ pressed }) => [
                styles.extractBtn,
                {
                  backgroundColor: '#C26D38', // Soft terracotta/ochre pill per Stitch guidance
                  opacity: pressed || isProcessing || !pastedText.trim() ? 0.5 : 1,
                },
              ]}
              testID="extract-candidates-btn"
            >
              <Text style={styles.extractBtnText}>
                {isProcessing ? 'Extracting...' : 'Extract Candidate'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 18,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  bannerText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: radius.md,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: '#C62828',
    flex: 1,
  },
  fieldLabel: {
    ...typography.sectionLabel,
    marginBottom: 8,
  },
  textInput: {
    height: 220,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 32,
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  extractBtn: {
    flex: 2,
    height: 50,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extractBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
