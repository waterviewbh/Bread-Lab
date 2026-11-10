import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { HistorySection } from '../log';
import * as recipeStorage from '@/lib/recipeStorage';
import { api } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NlaSupabaseBoundaryError } from '@/lib/nlaBoundary';

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
  multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, mockStore[k] ?? null])),
  multiSet: jest.fn(async (entries: [string, string][]) => {
    entries.forEach(([k, v]) => { mockStore[k] = v; });
  }),
  multiRemove: jest.fn(async (keys: string[]) => {
    keys.forEach(k => delete mockStore[k]);
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

const ACCT = 'acct-1';

describe('HistorySection Component Integration (JA Assignment — Strengthen History Deletion-Failure Test)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {
      bread_lab_auth_token_v1: ACCT,
      bread_lab_auth_user_v1: JSON.stringify({ id: ACCT, firstName: 'A', starterName: 'S' }),
    };
    (api.history.feed.delete as jest.Mock).mockResolvedValue(true);
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValue(true);
    (api.history.bakes.delete as jest.Mock).mockResolvedValue(true);
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
      expect(api.history.feed.delete).toHaveBeenCalledWith('feed-tomb-focus-1', expect.any(String), ACCT);
    });

    const tombstones = await recipeStorage.getFeedTombstone();
    expect(tombstones).not.toContain('feed-tomb-focus-1');
  });

  it('Test 2 — Pull-to-refresh processes pending deletions independently', async () => {
    // 1. Render with no initial tombstones
    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    const initialCallCount = (api.history.feed.delete as jest.Mock).mock.calls.length;

    // 2. Seed a real Feed tombstone after initial load
    await act(async () => {
      await recipeStorage.addToFeedTombstone('feed-tomb-refresh-2');
    });

    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(true);

    const scrollView = screen.getByTestId('history-scroll-view');
    const refreshControl = scrollView.props.refreshControl;
    expect(refreshControl).toBeDefined();

    // 3. Invoke onRefresh
    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    // 4. Assert delete call count increased by exactly one and included the seeded ID
    await waitFor(() => {
      expect((api.history.feed.delete as jest.Mock).mock.calls.length).toBe(initialCallCount + 1);
      expect(api.history.feed.delete).toHaveBeenCalledWith('feed-tomb-refresh-2', expect.any(String), ACCT);
    });

    // 5. Assert tombstone is removed after successful processing
    const tombstones = await recipeStorage.getFeedTombstone();
    expect(tombstones).not.toContain('feed-tomb-refresh-2');
  });

  it('Test 3 — Exercise failed deletion acknowledgment and failed absence verification', async () => {
    const tombstoneId = 'feed-fail-absence-1';
    await act(async () => {
      await recipeStorage.addToFeedTombstone(tombstoneId);
    });

    expect(await recipeStorage.getFeedTombstone())
      .toContain(tombstoneId);

    // Configure delete to resolve false (not reject) and verifyAbsent to resolve false
    (api.history.feed.delete as jest.Mock).mockResolvedValueOnce(false);
    (api.history.feed.verifyAbsent as jest.Mock).mockResolvedValueOnce(false);

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(api.history.feed.delete)
        .toHaveBeenCalledWith(
          tombstoneId,
          expect.any(String),
          ACCT
        );
      expect(api.history.feed.verifyAbsent)
        .toHaveBeenCalledWith(
          tombstoneId,
          expect.any(String),
          ACCT
        );
    });

    // Assert real tombstone remains in storage because delete and verifyAbsent both indicated failure/absence unverified
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

describe('HistorySection — NLA workspace (no Supabase)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore = {};
    (api.history.feed.list as jest.Mock).mockResolvedValue([]);
    (api.history.bakes.list as jest.Mock).mockResolvedValue([]);
  });

  it('N1 — Screen focus retires NLA pending deletions locally and never calls delete or verify', async () => {
    await act(async () => {
      await recipeStorage.addToFeedTombstone('nla-feed-tomb');
      await recipeStorage.addToBakeTombstone('nla-bake-tomb');
    });

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    expect(api.history.feed.delete).not.toHaveBeenCalled();
    expect(api.history.feed.verifyAbsent).not.toHaveBeenCalled();
    expect(api.history.bakes.delete).not.toHaveBeenCalled();
    expect(api.history.bakes.verifyAbsent).not.toHaveBeenCalled();
    expect(await recipeStorage.getFeedTombstone()).toEqual([]);
    expect(await recipeStorage.getBakeTombstone()).toEqual([]);
  });

  it('N2 — A REFUSED remote list (the NLA boundary) is not an empty dataset: local history is kept on the device', async () => {
    const local = [{ id: 'local-feed-1', userId: 'anonymous', savedAt: Date.now(), completedAt: Date.now(), readings: [] }];
    mockStore['sourdough_feed_history_v1'] = JSON.stringify(local);
    (api.history.feed.list as jest.Mock).mockRejectedValue(new NlaSupabaseBoundaryError('history.feed.list'));

    await act(async () => {
      render(<HistorySection />);
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
      expect(api.history.feed.list).toHaveBeenCalled();
    });

    // The failed remote merge never overwrote local storage with an empty result.
    expect(JSON.parse(mockStore['sourdough_feed_history_v1'])).toEqual(local);
  });
});
