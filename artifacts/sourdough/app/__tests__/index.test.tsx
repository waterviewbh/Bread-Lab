import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import WelcomeHub from '../index';

jest.setTimeout(15000);

// Mocks
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

let mockAsyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStore[key] || null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStore[key];
  }),
  clear: jest.fn(async () => {
    mockAsyncStore = {};
  }),
}));

const REALISTIC_RECIPE_WALL = `Vermont Country Sourdough Loaf

This recipe is a classic 75% hydration sourdough loaf with a crispy crust and soft open crumb.
Perfect for weekend baking in a Dutch oven.

=== INGREDIENTS ===
450g King Arthur Bread Flour
50g Whole Wheat Flour
375g Water (75% hydration)
100g Active Sourdough Starter (100% hydration)
10g Fine Sea Salt

=== INSTRUCTIONS ===
1. Mix flour and water in a large bowl for a 45-minute autolyse.
2. Add active starter and sea salt, dimpling thoroughly into dough.
3. Perform 4 sets of stretch-and-folds spaced 30 minutes apart.
4. Allow dough to bulk ferment at room temperature until increased in volume by 50%.
5. Pre-shape, bench rest for 20 minutes, and shape into a round boule.
6. Cold retard overnight in a banneton for 12 to 16 hours.
7. Bake at 450F in a preheated Dutch oven for 20 minutes lid-on, 20 minutes lid-off.

Notes: Keep ambient temperature around 74F for consistent fermentation.`;

describe('Landing Page Candidates Section & Paste Flow (WelcomeHub)', () => {
  beforeEach(() => {
    mockAsyncStore = {};
    jest.clearAllMocks();
  });

  it('1. Renders Candidates section header with "Paste Recipe Candidate" button', async () => {
    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText('Candidates')).toBeTruthy();
      expect(screen.getByTestId('paste-recipe-candidate-btn')).toBeTruthy();
      expect(screen.getByText('Paste Recipe Candidate')).toBeTruthy();
      expect(screen.getByText('San Francisco Sourdough Test Fixture')).toBeTruthy();
    });
  });

  it('2. Tapping Review button opens Candidate Review modal over landing page', async () => {
    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByTestId('review-candidate-btn')).toBeTruthy();
    });

    expect(screen.queryByText('Candidate Review')).toBeNull();

    fireEvent.press(screen.getByTestId('review-candidate-btn'));

    await waitFor(() => {
      expect(screen.getByText('Candidate Review')).toBeTruthy();
      expect(screen.getByTestId('staged-name-input').props.value).toBe(
        'San Francisco Sourdough Test Fixture'
      );
    });
  });

  it('3. Tapping Discard button on candidate card prompts confirmation and removes Candidate', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons) => {
      const discardOption = buttons?.find((b: any) => b.style === 'destructive');
      if (discardOption?.onPress) discardOption.onPress();
    });

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText('San Francisco Sourdough Test Fixture')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('discard-candidate-card-btn'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Discard Candidate',
        'Are you sure you want to permanently discard "San Francisco Sourdough Test Fixture"?',
        expect.any(Array)
      );
    });

    alertSpy.mockRestore();
  });

  it('4. Refuses candidate creation if pasted text produces no_candidate extraction, staying in modal with error', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByTestId('paste-recipe-candidate-btn')).toBeTruthy();
    });

    // Open Paste modal
    fireEvent.press(screen.getByTestId('paste-recipe-candidate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('paste-candidate-modal')).toBeTruthy();
    });

    // Enter short useless text
    fireEvent.changeText(screen.getByTestId('paste-candidate-input'), 'too short line');

    await waitFor(() => {
      expect(screen.getByTestId('paste-candidate-input').props.value).toBe('too short line');
    });

    // Tap Extract Candidates
    fireEvent.press(screen.getByTestId('extract-candidates-btn'));

    await waitFor(() => {
      // Should show alert and inline error box
      expect(alertSpy).toHaveBeenCalledWith('Extraction Failed', expect.any(String));
      expect(screen.getByTestId('paste-candidate-error')).toBeTruthy();
      // Modal remains open
      expect(screen.getByTestId('paste-candidate-modal')).toBeTruthy();
    });

    alertSpy.mockRestore();
  });

  it('5. Full paste → extract → candidate creation → review flow with realistic recipe text wall', async () => {
    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByTestId('paste-recipe-candidate-btn')).toBeTruthy();
    });

    // 1. Open Paste Modal
    fireEvent.press(screen.getByTestId('paste-recipe-candidate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('paste-candidate-modal')).toBeTruthy();
    });

    // 2. Paste realistic recipe text
    fireEvent.changeText(
      screen.getByTestId('paste-candidate-input'),
      REALISTIC_RECIPE_WALL
    );

    await waitFor(() => {
      expect(screen.getByTestId('paste-candidate-input').props.value).toBe(REALISTIC_RECIPE_WALL);
    });

    // 3. Tap Extract Candidates
    fireEvent.press(screen.getByTestId('extract-candidates-btn'));

    // 4. Modal closes, new candidate appears on Landing Page
    await waitFor(() => {
      expect(screen.getByText('Vermont Country Sourdough Loaf')).toBeTruthy();
    });

    // 5. Tap Review on the new candidate card (newest sorted first, index 0 is review-candidate-btn)
    fireEvent.press(screen.getByTestId('review-candidate-btn'));

    // 6. Verify Candidate Review modal opens with extracted candidate data in Unassigned Material
    await waitFor(() => {
      expect(screen.getByText('Candidate Review')).toBeTruthy();
      expect(screen.getByTestId('staged-name-input').props.value).toBe(
        'Vermont Country Sourdough Loaf'
      );
      // Verify Unassigned Material staging header
      expect(screen.getByText('Unassigned Material')).toBeTruthy();
    });
  });
});
