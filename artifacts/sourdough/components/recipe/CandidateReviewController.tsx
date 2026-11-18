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
import { getStoredUser } from '@/lib/auth';
import { appendRecipeLocal } from '@/lib/recipeStorage';
import type { SavedRecipe } from '@/lib/recipeTypes';
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

    // 2. Normalize & Resolve Auth Context
    const deviceId = await getDeviceId().catch(() => '');
    // null means NLA (both credentials absent). An uncertain identity THROWS and rejects the promotion here, before
    // anything is written, so the Candidate is kept; it is never read as anonymous.
    const user = await getStoredUser();
    const userId = user?.id ?? null;

    const normalizedPayload = normalizePortableRecipe(portableRecipe, {
      id: candidateId ?? generateUuid(),
      deviceId,
      userId: userId ?? undefined,
    });

    const originalAuthorName = (portableRecipe as any).provenance?.originalAuthorName ?? (portableRecipe as any).authorName ?? undefined;
    const sharedByAuthorName = (portableRecipe as any).provenance?.sharedByAuthorName ?? (user ? `${user.firstName}'s ${user.starterName}` : undefined);

    // 3. Persist LOCALLY FIRST (Local-first architecture) — Independent Master in Recipient Workspace
    const newRecipe: SavedRecipe = {
      id: normalizedPayload.id,
      userId: userId ?? "anonymous",
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
      parentRecipeId: null, // Independent Master copy
      versionLabel: "Master",
      isArchived: false,
      provenance: {
        originalAuthorName,
        sharedByAuthorName,
        sourceUrl: (portableRecipe as any).sourceUrl ?? undefined,
        importedAt: Date.now(),
        sourceCandidateId: candidateId,
      },
    };

    // 3. Persist LOCALLY FIRST using storageMutex via appendRecipeLocal
    let persistedRecipe: SavedRecipe;
    try {
      const recipes = await appendRecipeLocal(newRecipe);
      persistedRecipe = recipes.find(r => r.id === newRecipe.id)!;
    } catch (localErr: any) {
      throw new Error(`Local recipe commit failed: ${localErr?.message || 'Storage error'}`);
    }

    // 4. Conditionally sync to remote ONLY IF authenticated (Non-blocking for local commit)
    if (userId) {
      await api.recipes.upsert({
        ...normalizedPayload,
        name: persistedRecipe.name,
        overview: persistedRecipe.overview,
        phases: persistedRecipe.phases,
        yield_value: Number(persistedRecipe.yieldValue) || normalizedPayload.yield_value,
        createdAt: persistedRecipe.createdAt,
        provenance: persistedRecipe.provenance,
      });
      const remote = (await api.recipes.list(deviceId, userId)).find(r => r.id === persistedRecipe.id);
      if (!remote || remote.provenance?.sourceCandidateId !== candidateId || remote.userId !== userId) {
        throw new Error('Promoted Theory could not be verified remotely; Candidate was retained.');
      }
    }

    // 5. Remove Candidate from storage (Cleanup)
    if (candidateId) {
      await removeCandidate(candidateId);
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
