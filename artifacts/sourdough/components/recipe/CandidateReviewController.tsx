/**
 * artifacts/sourdough/components/recipe/CandidateReviewController.tsx
 * Container component encapsulating BakerReviewModal, validation, normalization, and persistence machinery.
 *
 * Keeps host screens (like app/index.tsx Landing Page) clean and decoupled from recipe import persistence internals.
 */

import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BakerReviewModal, BakerReviewModalRef } from './BakerReviewModal';
import { ExtractionResult } from '@/lib/recipeExtractor';
import { PortableRecipe, validateRecipeForCommit, normalizePortableRecipe, generateUuid } from '@/lib/recipeImport';
import { removeCandidate, updateCandidateExtraction } from '@/lib/candidateStorage';
import { api } from '@/lib/api';
import { getDeviceId } from '@/lib/deviceId';
import { getStoredToken } from '@/lib/auth';
import { RECIPES_KEY, SavedRecipe, appendRecipeLocal } from '@/lib/recipeStorage';
import { textToCheckableLines } from '@/lib/recipeUtils';
import { safeParse } from '@/lib/storageUtils';

export interface CandidateReviewControllerProps {
  visible: boolean;
  candidateId?: string;
  extractionResult: ExtractionResult | null;
  onSaveSuccess?: () => void;
  onDiscard: () => void;
}

export interface CandidateReviewControllerRef {
  saveChanges: () => Promise<boolean>;
}

const CandidateReviewControllerRender: React.ForwardRefRenderFunction<CandidateReviewControllerRef, CandidateReviewControllerProps> = (
  {
    visible,
    candidateId,
    extractionResult,
    onSaveSuccess,
    onDiscard,
  },
  ref
) => {
  const modalRef = React.useRef<BakerReviewModalRef>(null);

  React.useImperativeHandle(ref, () => ({
    saveChanges: async () => {
      if (modalRef.current) {
        return await modalRef.current.saveChanges();
      }
      return false;
    },
  }));

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
    const userId = await getStoredToken().catch(() => null);
    const normalizedPayload = normalizePortableRecipe(portableRecipe, {
      id: generateUuid(),
      deviceId,
      userId: userId ?? undefined,
    });

    // 3. Persist LOCALLY FIRST (Local-first architecture)
    const newRecipe: SavedRecipe = {
      id: normalizedPayload.id,
      name: normalizedPayload.name,
      overview: normalizedPayload.overview,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      yieldValue: (normalizedPayload.yield_value ?? 1).toString(),
      phases: normalizedPayload.phases.map((p: any) => ({
        key: p.key,
        name: p.name,
        ingredients: Array.isArray(p.ingredients) ? p.ingredients : textToCheckableLines(p.ingredients || '', 'ing'),
        instructions: Array.isArray(p.instructions) ? p.instructions : textToCheckableLines(p.instructions || '', 'ins'),
      })),
      parentRecipeId: normalizedPayload.parent_recipe_id ?? undefined,
      versionLabel: normalizedPayload.version_label ?? undefined,
      isArchived: normalizedPayload.is_archived ?? false,
    };

    // 3. Persist LOCALLY FIRST using storageMutex via appendRecipeLocal
    try {
      await appendRecipeLocal(newRecipe);
    } catch (localErr: any) {
      throw new Error(`Local recipe commit failed: ${localErr?.message || 'Storage error'}`);
    }

    // 4. Conditionally sync to remote ONLY IF authenticated (Non-blocking for local commit)
    if (userId) {
      await api.recipes.upsert(normalizedPayload).catch((err) => {
        console.warn('[CandidateReviewController] Remote sync failed, saved locally:', err);
      });
    }

    // 5. Remove Candidate from storage (Cleanup)
    if (candidateId) {
      try {
        await removeCandidate(candidateId);
      } catch (removeErr: any) {
        console.warn('[CandidateReviewController] Candidate staging cleanup failed after successful local commit:', removeErr);
      }
    }

    // 6. Notify parent
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
      ref={modalRef}
      visible={visible}
      extractionResult={extractionResult}
      onSaveAndClose={handleSaveAndClose}
      onPromote={handlePromote}
      onDiscard={handleDiscardCandidate}
    />
  );
};

export const CandidateReviewController = React.forwardRef(CandidateReviewControllerRender);
