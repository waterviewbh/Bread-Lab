import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { HistorySection } from '../log';
import * as recipeStorage from '@/lib/recipeStorage';
import { api } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  }),
}));

jest.mock('@/lib/api', () => ({
  api: {
    history: {
      feed: {
        list: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue(true),
        verifyAbsent: jest.fn().mockResolvedValue(true),
      },
      bakes: {
        list: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue(true),
        verifyAbsent: jest.fn().mockResolvedValue(true),
      },
    },
    recipes: {
      delete: jest.fn().mockResolvedValue(true),
      verifyAbsent: jest.fn().mockResolvedValue(true),
    },
  },
}));

jest.mock('@/lib/deviceId', () => ({
  getDeviceId: jest.fn().mockResolvedValue('device-123'),
}));

jest.mock('@/contexts/SyncContext', () => ({
  useSyncStatus: () => ({ pendingCount: 0 }),
}));

jest.mock('@/contexts/MigrationToastContext', () => ({
  useMigrationToast: () => ({ isMigrationActive: false, startMigration: jest.fn(), finishMigration: jest.fn() }),
}));

describe('HistorySection Component Integration (JA Assignment — Strengthen History Deletion-Failure Test)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    (api.history.feed.delete as jest.Mock).mockReset();
    (api.history.feed.delete as jest.Mock).mockResolvedValue(true);
    (api.history.feed.verifyAbsent as jest.Mock).mockReset();
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValue(true);
    (api.history.bakes.delete as jest.Mock).mockReset();
    (api.history.bakes.delete as jest.Mock).mockResolvedValue(true);
    (api.history.bakes.verifyAbsent as jest.Mock).mockReset();
    (api.history.bakes.verifyAbsent as jest.Mock).mockResolvedValue(true);
  });

  it('Test 1 — Screen focus processes pending deletions', async () => {
    await act(async () => {
      await recipeStorage.addToFeedTombstone('feed-tomb-focus-1');
    });

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
      expect(api.history.feed.delete).toHaveBeenCalledWith('feed-tomb-focus-1', expect.any(String), undefined);
    });

    const tombstones = await recipeStorage.getFeedTombstone();
    expect(tombstones).not.toContain('feed-tomb-focus-1');
  });

  it('Test 2 — Pull-to-refresh processes pending deletions', async () => {
    await act(async () => {
      await recipeStorage.addToFeedTombstone('feed-tomb-refresh-1');
    });

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    const scrollView = screen.getByTestId('history-scroll-view');
    const refreshControl = scrollView.props.refreshControl;
    expect(refreshControl).toBeDefined();

    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(api.history.feed.delete).toHaveBeenCalledWith('feed-tomb-refresh-1', expect.any(String), undefined);
    });
  });

  it('Test 3 — Processing failure preserves real tombstone and normal History behavior', async () => {
    const tombstoneId = 'feed-fail-preserve-1';
    await act(async () => {
      await recipeStorage.addToFeedTombstone(tombstoneId);
    });

    expect(await recipeStorage.getFeedTombstone())
      .toContain(tombstoneId);

    // Simulate remote delete failure and absence verification failure
    (api.history.feed.delete as jest.Mock).mockRejectedValue(new Error('Network error'));
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValue(false);

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(api.history.feed.delete)
        .toHaveBeenCalledWith(
          tombstoneId,
          expect.any(String),
          undefined
        );
    });

    expect(await recipeStorage.getFeedTombstone())
      .toContain(tombstoneId);

    expect(screen.getByText('Calendar')).toBeTruthy();
  });

  it('Test 4 — No accidental duplicate invocation on initial mount/focus', async () => {
    await act(async () => {
      await recipeStorage.addToFeedTombstone('feed-tomb-dup-1');
    });

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
      expect(api.history.feed.delete).toHaveBeenCalledTimes(1);
    });
  });
});
