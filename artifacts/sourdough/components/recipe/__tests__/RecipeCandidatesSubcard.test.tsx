import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import RecipeScreen from '@/app/(tabs)/recipe';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DETERMINISTIC_TEST_CANDIDATE } from '@/constants/testCandidateFixture';
import { getCandidatesKey } from '@/lib/candidateStorage';

jest.setTimeout(20000);

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

describe('Recipe Builder Subcard Navigation & Candidates (Issue #73)', () => {
  beforeEach(async () => {
    mockAsyncStore = {};
    const key = await getCandidatesKey();
    mockAsyncStore[key] = JSON.stringify([
      {
        id: 'test-cand-1',
        sharedAt: '2026-10-04T08:14:00.000Z',
        extractionResult: DETERMINISTIC_TEST_CANDIDATE,
      },
    ]);
    jest.clearAllMocks();
  });

  it('1. Fresh entry to Recipe Builder defaults to Theories', async () => {
    await render(<RecipeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('theories-subcard-tab')).toBeTruthy();
      expect(screen.getByTestId('candidates-subcard-tab')).toBeTruthy();
      // Theories is active by default (shows Recipes header)
      expect(screen.getByText('Recipes')).toBeTruthy();
    });
  });

  it('2. Switching to Candidates subcard displays candidate list and Paste button', async () => {
    await render(<RecipeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('candidates-subcard-tab')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('candidates-subcard-tab'));

    await waitFor(() => {
      expect(screen.getByText('San Francisco Sourdough Test Fixture')).toBeTruthy();
      expect(screen.getByTestId('paste-recipe-candidate-btn')).toBeTruthy();
      expect(screen.getByText('Review')).toBeTruthy();
    });
  });

  it('3. Shows "All caught up." empty state when no candidates remain', async () => {
    const key = await getCandidatesKey();
    mockAsyncStore[key] = JSON.stringify([]);

    await render(<RecipeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('candidates-subcard-tab')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('candidates-subcard-tab'));

    await waitFor(() => {
      expect(screen.getByText('All caught up.')).toBeTruthy();
      expect(screen.getByText('No pending candidates awaiting review.')).toBeTruthy();
    });
  });
});
