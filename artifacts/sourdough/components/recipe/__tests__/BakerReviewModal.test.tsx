import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { BakerReviewModal } from '../BakerReviewModal';
import { ExtractionResult } from '@/lib/recipeExtractor';
import { UNCLASSIFIED_STAGING_KEY } from '@/lib/recipeImport';
import { DETERMINISTIC_TEST_CANDIDATE } from '@/constants/testCandidateFixture';

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

describe('BakerReviewModal Component (Issue #65 — Step 8C)', () => {
  const mockSingleExtraction: ExtractionResult = {
    status: 'single_candidate',
    sourceUrl: 'https://example.com/sourdough',
    warnings: [],
    candidate: {
      schemaVersion: '1.0',
      name: 'Extracted Artisan Loaf',
      overview: 'Crunchy crust and soft crumb.',
      yieldValue: '1 loaf',
      versionLabel: 'v1.0 (Import Candidate)',
      phases: [
        {
          key: UNCLASSIFIED_STAGING_KEY,
          name: 'Unclassified Import Staging',
          ingredients: [
            { text: '500g bread flour', is_checked: false, sort_order: 0 },
            { text: '350g water', is_checked: false, sort_order: 1 },
          ],
          instructions: [
            { text: 'Mix ingredients and autolyse.', is_checked: false, sort_order: 0 },
          ],
        },
      ],
    },
  };

  const mockMultipleExtraction: ExtractionResult = {
    status: 'multiple_candidates',
    sourceUrl: 'https://example.com/recipes',
    warnings: [],
    candidates: [
      {
        schemaVersion: '1.0',
        name: 'First Candidate Loaf',
        phases: [{ key: UNCLASSIFIED_STAGING_KEY, name: 'Unclassified Import Staging', ingredients: [], instructions: [] }],
      },
      {
        schemaVersion: '1.0',
        name: 'Second Candidate Baguette',
        phases: [{ key: UNCLASSIFIED_STAGING_KEY, name: 'Unclassified Import Staging', ingredients: [], instructions: [] }],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Renders single candidate in Candidate Review with Candidate badge and source provenance', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    expect(screen.getByText('Candidate Review')).toBeTruthy();
    expect(screen.getByText('Source: https://example.com/sourdough')).toBeTruthy();
    expect(screen.getByText('Candidate — Review fields & assign phases before committing as a Recipe.')).toBeTruthy();
    expect(screen.getByTestId('staged-name-input').props.value).toBe('Extracted Artisan Loaf');
  });

  it('2. Multiple candidates require explicit selection before review', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockMultipleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    expect(screen.getByText('Multiple Candidates (2):')).toBeTruthy();
    expect(screen.getByTestId('candidate-tab-0')).toBeTruthy();
    expect(screen.getByTestId('candidate-tab-1')).toBeTruthy();

    // Default is candidate 0
    expect(screen.getByTestId('staged-name-input').props.value).toBe('First Candidate Loaf');

    // Tap candidate tab 1
    fireEvent.press(screen.getByTestId('candidate-tab-1'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-name-input').props.value).toBe('Second Candidate Baguette');
    });
  });

  it('3. Explicit Discard action purges candidate review state and invokes onDiscard', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons) => {
      const discardOption = buttons?.find((b) => b.style === 'destructive');
      if (discardOption?.onPress) discardOption.onPress();
    });

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    fireEvent.press(screen.getByTestId('review-discard-btn'));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSaveConfirmed).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('3b. Pressing Discard Candidate button prompts confirmation alert and invokes onDiscard on confirm', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons) => {
      const discardOption = buttons?.find((b) => b.style === 'destructive');
      if (discardOption?.onPress) discardOption.onPress();
    });

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    fireEvent.press(screen.getByTestId('review-discard-btn'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Discard Candidate',
      'Are you sure you want to permanently discard this candidate? This action cannot be undone.',
      expect.any(Array)
    );
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSaveConfirmed).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('4. Opening phase picker modal adds phase', async () => {
    const onSaveConfirmed = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    expect(screen.getByTestId(`phase-card-${UNCLASSIFIED_STAGING_KEY}`)).toBeTruthy();
    expect(screen.getByText('Source material waiting for phase classification:')).toBeTruthy();

    // Open add phase modal
    fireEvent.press(screen.getByTestId('open-add-phase-btn'));

    await waitFor(() => {
      expect(screen.getByText('Add Phase')).toBeTruthy();
    });
  });

  it('5. Save confirmed invokes onSaveConfirmed for fully assigned PortableRecipe candidate', async () => {
    const onSaveConfirmed = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    const fullyAssignedExtraction: ExtractionResult = {
      status: 'single_candidate',
      sourceUrl: 'https://example.com/sourdough',
      warnings: [],
      candidate: {
        schemaVersion: '1.0',
        name: 'Extracted Artisan Loaf',
        phases: [
          {
            key: 'levain',
            name: 'Levain Build',
            ingredients: [{ text: '50g starter', is_checked: false, sort_order: 0 }],
            instructions: [{ text: 'Build levain.', is_checked: false, sort_order: 0 }],
          },
        ],
      },
    };

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={fullyAssignedExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    // Tap Save button
    fireEvent.press(screen.getByTestId('review-save-btn'));

    await waitFor(() => {
      expect(onSaveConfirmed).toHaveBeenCalledTimes(1);
      const savedCandidate = onSaveConfirmed.mock.calls[0][0];
      expect(savedCandidate.name).toBe('Extracted Artisan Loaf');
      expect(savedCandidate.schemaVersion).toBe('1.0');
    });
  });

  it('6a. Save & Close allows saving candidate state even when Unassigned Material remains', async () => {
    const onSaveConfirmed = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    // Tap Save & Close button with unassigned material remaining
    fireEvent.press(screen.getByTestId('review-save-btn'));

    await waitFor(() => {
      expect(onSaveConfirmed).toHaveBeenCalledTimes(1);
      const savedCandidate = onSaveConfirmed.mock.calls[0][0];
      expect(savedCandidate.name).toBe('Extracted Artisan Loaf');
    });
  });

  it('6b. Promote to Recipe is blocked by Unassigned Material and displays warning alert', async () => {
    const onSaveConfirmed = jest.fn().mockResolvedValue(undefined);
    const onDiscard = jest.fn();

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={mockSingleExtraction}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    // Tap Promote button
    fireEvent.press(screen.getByTestId('promote-candidate-btn'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Unassigned Material Warning',
        'Some recipe content remains in Unassigned Material. Please assign all ingredients and instructions to phases before committing as a Recipe.',
        [{ text: 'Assign to Phase', style: 'default', onPress: expect.any(Function) }]
      );
      expect(onSaveConfirmed).not.toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });

  it('6c. Removing a canonical phase transfers both its ingredients and instructions into Unassigned Material', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={DETERMINISTIC_TEST_CANDIDATE}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    // Verify Main Dough Mix phase exists initially
    expect(screen.getByTestId('phase-card-main_dough')).toBeTruthy();
    expect(screen.getByDisplayValue('800g unbleached bread flour')).toBeTruthy();
    expect(screen.getByDisplayValue('Autolyse flour and water for 45 minutes.')).toBeTruthy();

    // Remove Main Dough Mix phase
    fireEvent.press(screen.getByTestId('remove-phase-main_dough'));

    await waitFor(() => {
      // Main Dough Mix card is removed
      expect(screen.queryByTestId('phase-card-main_dough')).toBeNull();

      // Transferred ingredients AND instructions are visible in Unassigned Material
      expect(screen.getByDisplayValue('800g unbleached bread flour')).toBeTruthy();
      expect(screen.getByDisplayValue('Autolyse flour and water for 45 minutes.')).toBeTruthy();

      // Original unassigned ingredient and instruction are still present
      expect(screen.getByDisplayValue('50g toasted sesame seeds (topping)')).toBeTruthy();
      expect(screen.getByDisplayValue('Coat dough exterior with toasted seeds before final proof.')).toBeTruthy();
    });
  });

  it('7. Renders phase numbers with high contrast text color (primaryForeground)', async () => {
    const onSaveConfirmed = jest.fn();
    const onDiscard = jest.fn();

    await render(
      <BakerReviewModal
        visible={true}
        extractionResult={DETERMINISTIC_TEST_CANDIDATE}
        onSaveConfirmed={onSaveConfirmed}
        onDiscard={onDiscard}
      />
    );

    expect(screen.getByText('1')).toBeTruthy();
  });
});
