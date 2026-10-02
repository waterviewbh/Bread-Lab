import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ActiveBakeSection } from '../ActiveBakeSection';
import * as recipeStorage from '@/lib/recipeStorage';

jest.mock('@/lib/recipeStorage', () => ({
  loadAll: jest.fn(),
  writeBakeLocal: jest.fn().mockResolvedValue(undefined),
  writeBakesLocal: jest.fn().mockResolvedValue(undefined),
  upsertBakeRemote: jest.fn().mockResolvedValue(undefined),
  archiveBakeWithDiagnostics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/contexts/SyncContext', () => ({
  useSyncStatus: () => ({
    reportSyncStart: jest.fn(),
    reportSyncSuccess: jest.fn(),
    reportSyncFailure: jest.fn(),
  }),
}));

describe('ActiveBakeSection Component Integration', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. Renders empty setup view when no active bakes exist', async () => {
    (recipeStorage.loadAll as jest.Mock).mockResolvedValue({
      recipes: [
        {
          id: 'rec-1',
          name: 'Classic Country Loaf',
          yieldValue: '1',
          phases: [],
        },
      ],
      bakes: [],
    });

    render(<ActiveBakeSection />);

    await waitFor(() => {
      expect(screen.getByText('Select Recipe')).toBeTruthy();
      expect(screen.getByText('Recipe Runner')).toBeTruthy();
    });
  });

  it('2. Renders active bake runner view when a bake exists', async () => {
    const mockBake = {
      id: 'bake-55',
      recipeId: 'rec-1',
      recipeName: 'Rustic Sourdough',
      startedAt: Date.now() - 3600000,
      status: 'active',
      phases: [
        {
          key: 'mixing',
          name: 'Autolyse & Mixing',
          durationMinutes: 30,
          startedAt: Date.now() - 1800000,
          completedAt: Date.now() - 900000,
          readings: [],
          ingredients: [],
          instructions: [],
        },
        {
          key: 'bulk_fermenting',
          name: 'Bulk Fermentation',
          durationMinutes: 240,
          startedAt: Date.now() - 900000,
          completedAt: null,
          readings: [],
          ingredients: [],
          instructions: [],
        },
      ],
      yieldValue: '1',
    };

    (recipeStorage.loadAll as jest.Mock).mockResolvedValue({
      recipes: [],
      bakes: [mockBake],
    });

    render(<ActiveBakeSection />);

    await waitFor(() => {
      expect(screen.getAllByText('Rustic Sourdough').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bulk Fermentation').length).toBeGreaterThan(0);
    });
  });
});
