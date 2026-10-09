/**
 * artifacts/sourdough/components/recipe/CandidateReviewController.tsx
 * Container component encapsulating BakerReviewModal, validation, normalization, and persistence machinery.
 *
 * Keeps host screens (like app/index.tsx Landing Page) clean and decoupled from recipe import persistence internals.
 */

import React from 'react';
import { BakerReviewModal } from './BakerReviewModal';
import { ExtractionResult } from '@/lib/recipeExtractor';
import { PortableRecipe, validateRecipeForCommit, normalizePortableRecipe, generateUuid } from '@/lib/recipeImport';
import { removeCandidate, updateCandidateExtraction } from '@/lib/candidateStorage';
import { api } from '@/lib/api';
import { getDeviceId } from '@/lib/deviceId';

export interface CandidateReviewControllerProps {
  visible: boolean;
  candidateId?: string;
  extractionResult: ExtractionResult | null;
  onSaveSuccess?: () => void;
  onDiscard: () => void;
}

export function CandidateReviewController({
  visible,
  candidateId,
  extractionResult,
  onSaveSuccess,
  onDiscard,
}: CandidateReviewControllerProps) {
  const handleSaveAndClose = async (updatedExtractionResult: ExtractionResult) => {
    if (candidateId) {
      await updateCandidateExtraction(candidateId, updatedExtractionResult);
    }
    if (onSaveSuccess) {
      onSaveSuccess();
    }
  };

  const handlePromote = async (portableRecipe: PortableRecipe) => {
    // 1. Enforce strict Recipe Commit Boundary validation (no Unassigned Material)
    const validation = validateRecipeForCommit(portableRecipe);
    if (!validation.valid) {
      throw new Error(`Recipe commit validation failed:\n- ${validation.errors.join('\n- ')}`);
    }

    // 2. Normalize
    const deviceId = await getDeviceId().catch(() => '');
    const normalizedPayload = normalizePortableRecipe(portableRecipe, {
      id: generateUuid(),
      deviceId,
    });

    // 3. Persist Recipe FIRST
    await api.recipes.upsert(normalizedPayload);

    // 4. ONLY AFTER Recipe persistence succeeds, remove Candidate from storage
    if (candidateId) {
      await removeCandidate(candidateId);
    }

    // 5. Notify parent
    if (onSaveSuccess) {
      onSaveSuccess();
    }
  };

  const handleDiscardCandidate = async () => {
    if (candidateId) {
      await removeCandidate(candidateId);
    }
    onDiscard();
  };

  return (
    <BakerReviewModal
      visible={visible}
      extractionResult={extractionResult}
      onSaveAndClose={handleSaveAndClose}
      onPromote={handlePromote}
      onDiscard={handleDiscardCandidate}
    />
  );
}
