import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { BakerReviewModal } from '../BakerReviewModal';
import { ExtractionResult } from '@/lib/recipeExtractor';
import { UNCLASSIFIED_STAGING_KEY } from '@/lib/recipeImport';

// Mock dependencies
jest.mock('expo-font', () => ({
  useFonts: () => [true],
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  Feather: 'Feather',
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));

describe('Issue #65 — Candidate Phase Assignment & Canonical Phase Icon States Refinements', () => {
  const mockExtraction: ExtractionResult = {
    status: 'single_candidate',
    sourceUrl: 'https://example.com/sourdough',
    warnings: [],
    candidate: {
      schemaVersion: '1.0',
      name: 'Artisan Loaf Review',
      phases: [
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: 'Unassigned Material',
          ingredients: [
            { id: 'ing-1', text: '500g bread flour', is_checked: false, sort_order: 0 },
            { id: 'ing-2', text: '350g water', is_checked: false, sort_order: 1 },
          ],
          instructions: [
            { id: 'ins-1', text: 'Mix ingredients until combined.', is_checked: false, sort_order: 0 },
          ],
        },
        {
          key: 'building_levain',
          name: 'Building the Levain',
          ingredients: [],
          instructions: [],
        },
      ],
    },
  };

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('1. Assigning ingredient material via inline Assign button opens assignment modal with selection and transitions phase to Some state', async () => {
    const onSaveAndClose = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockExtraction}
        onSaveAndClose={onSaveAndClose}
        onPromote={jest.fn()}
        onDiscard={onDiscard}
      />
    );

    const assignBtn = await waitFor(() => screen.getByTestId('assign-line-btn-ing-1'));
    fireEvent.press(assignBtn);

    await waitFor(() => {
      expect(screen.getByText('Assign to Phase')).toBeTruthy();
      expect(screen.getByText('"500g bread flour"')).toBeTruthy();
    });

    // Select destination phase: Building the Levain
    fireEvent.press(screen.getByTestId('dest-phase-option-building_levain'));
    // Classify as ingredient
    fireEvent.press(screen.getByTestId('classify-ingredient-btn'));

    // Confirm assignment
    fireEvent.press(screen.getByTestId('confirm-assignment-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('assign-line-btn-ing-1')).toBeNull();
      expect(screen.getByTestId('assign-line-btn-ing-2')).toBeTruthy();
    });
  });

  it('2. Unassigned material workbench remains persistent when no assignment occurs and save & close preserves state', async () => {
    const onSaveAndClose = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockExtraction}
        onSaveAndClose={onSaveAndClose}
        onPromote={jest.fn()}
        onDiscard={onDiscard}
      />
    );

    const saveBtn = await waitFor(() => screen.getByTestId('review-save-btn'));
    fireEvent.press(saveBtn);

    await waitFor(() => {
      expect(onSaveAndClose).toHaveBeenCalledTimes(1);
      const savedResult = onSaveAndClose.mock.calls[0][0];
      const staging = savedResult.candidate.phases.find((p: any) => p.key === UNCLASSIFIED_STAGING_KEY);
      expect(staging.ingredients.length).toBe(2);
      expect(staging.instructions.length).toBe(1);
    });
  });
});
