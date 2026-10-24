import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WelcomeHub from '../index';

jest.setTimeout(15000);

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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('@/hooks/useScienceArticle', () => ({
  useScienceArticles: () => ({
    data: [
      { slug: 'article-1', title: 'Science Article 1', blocks: [{ type: 'paragraph', text: 'Test paragraph summary.' }], furtherStudyTopics: [] }
    ],
    isLoading: false,
    error: null,
  }),
}));

describe('Landing Page (WelcomeHub) - Welcome Insight Redesign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Renders onboarding message when feed history is empty', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText('Start your first feed to see analytics.')).toBeTruthy();
      expect(screen.getByText('The Lab')).toBeTruthy();
      expect(screen.getByText('The Bench')).toBeTruthy();
      expect(screen.getByText('The Log')).toBeTruthy();
    });
  });

  it('Renders evidence-grounded observation when history is present', async () => {
    const now = Date.now();
    const mockSession = {
      id: 'test-session-1',
      savedAt: now - 3600000 * 6, // 6 hours ago
      initialPH: '6.2',
      readings: [
        { pH: '4.8', loggedAt: now }
      ]
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([mockSession]));

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText(/Your last refresh showed a pH drop of 1.4 over 6.0 hours/)).toBeTruthy();
    });
  });

  it('Renders observation correctly when final pH is stored in session.peak with minutes (like Screenshot 1)', async () => {
    const now = Date.now();
    const peakSession = {
      id: 'peak-session-1',
      savedAt: now - 600000, // 10 mins ago
      initialPH: '5.4',
      peak: {
        pH: '5.2',
        timeToPeakMs: 600000 // 10 minutes
      }
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([peakSession]));

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText(/Your last refresh showed a pH drop of 0.2 over 10 minutes/)).toBeTruthy();
    });
  });

  it('Gracefully skips incomplete newest session and falls back to older valid session', async () => {
    const now = Date.now();
    const incompleteNewestSession = {
      id: 'incomplete-session',
      savedAt: now,
      readings: [] // no pH data or initial pH
    };
    const olderValidSession = {
      id: 'older-session',
      savedAt: now - 3600000 * 5, // 5 hours ago
      initialPH: '6.0',
      readings: [
        { pH: '5.0', loggedAt: now - 1000 }
      ]
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify([incompleteNewestSession, olderValidSession])
    );

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText(/Your last refresh showed a pH drop of 1.0 over 5.0 hours/)).toBeTruthy();
    });
  });

  it('Renders neutral fallback copy when history lacks valid pH measurements', async () => {
    const invalidSession = {
      id: 'invalid-session',
      savedAt: Date.now(),
      readings: []
    };

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([invalidSession]));

    await render(<WelcomeHub />);

    await waitFor(() => {
      expect(screen.getByText('Your next bake starts here.')).toBeTruthy();
    });
  });
});
