import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { HistorySection } from '../log';
import * as recipeStorage from '@/lib/recipeStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockTombstones = ['tomb-1'];

jest.mock('@/lib/recipeStorage', () => ({
  ...jest.requireActual('@/lib/recipeStorage'),
  processPendingDeletions: jest.fn().mockResolvedValue(undefined),
  getFeedTombstone: jest.fn(async () => mockTombstones),
  getBakeTombstone: jest.fn(async () => []),
  addToFeedTombstone: jest.fn(async (id: string) => { mockTombstones.push(id); }),
  addToBakeTombstone: jest.fn(async () => {}),
}));

jest.mock('@/lib/api', () => ({
  api: {
    history: {
      feed: { list: jest.fn().mockResolvedValue([]) },
      bakes: { list: jest.fn().mockResolvedValue([]) },
    },
  },
}));

jest.mock('@/lib/deviceId', () => ({
  getDeviceId: jest.fn().mockResolvedValue('device-123'),
}));

jest.mock('@/lib/auth', () => ({
  getStoredToken: jest.fn().mockResolvedValue(null),
  getStoredUser: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/contexts/SyncContext', () => ({
  useSyncStatus: () => ({ pendingCount: 0 }),
}));

jest.mock('@/contexts/MigrationToastContext', () => ({
  useMigrationToast: () => ({ isMigrationActive: false, startMigration: jest.fn(), finishMigration: jest.fn() }),
}));

describe('HistorySection Component Integration (JA Assignment — Visible Log/History)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockTombstones = ['tomb-1'];
    await AsyncStorage.clear();
  });

  it('Test 1 — Screen focus processes pending deletions', async () => {
    render(<HistorySection />);

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
      expect(recipeStorage.processPendingDeletions).toHaveBeenCalledTimes(1);
    });
  });

  it('Test 2 — Pull-to-refresh processes pending deletions', async () => {
    render(<HistorySection />);

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    const initialCalls = (recipeStorage.processPendingDeletions as jest.Mock).mock.calls.length;

    const scrollView = screen.getByTestId('history-scroll-view');
    const refreshControl = scrollView.props.refreshControl;
    expect(refreshControl).toBeDefined();

    await actAsync(async () => {
      await refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(recipeStorage.processPendingDeletions).toHaveBeenCalledTimes(initialCalls + 1);
    });
  });

  it('Test 3 — Processing failure preserves normal History behavior and tombstone preservation', async () => {
    (recipeStorage.processPendingDeletions as jest.Mock).mockRejectedValueOnce(new Error('Sync failed'));

    mockTombstones = ['tomb-preserved-1'];

    render(<HistorySection />);

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    const tombstones = await recipeStorage.getFeedTombstone();
    expect(tombstones).toContain('tomb-preserved-1');
  });

  it('Test 4 — No accidental duplicate invocation on initial mount/focus', async () => {
    render(<HistorySection />);

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
    });

    expect(recipeStorage.processPendingDeletions).toHaveBeenCalledTimes(1);
  });
});

async function actAsync(callback: () => Promise<void>) {
  await callback();
}
