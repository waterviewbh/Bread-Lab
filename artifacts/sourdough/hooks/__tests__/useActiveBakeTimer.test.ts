jest.unmock('../useActiveBakeTimer');
import { renderHook } from '@testing-library/react-native';
import { useActiveBakeTimer } from '../useActiveBakeTimer';
import type { ActiveBake } from '@/lib/recipeTypes';

describe('useActiveBakeTimer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. Returns empty object when bake is null or undefined', async () => {
    const { result, unmount } = await renderHook(() => useActiveBakeTimer(null));
    expect(result.current).toEqual({});
    await unmount();
  });

  it('2. Tracks elapsed time for active phases on mount', async () => {
    const mockTime = 1700000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockTime);

    const mockBake: ActiveBake = {
      id: 'bake-101',
      recipeName: 'Country Sourdough',
      startedAt: mockTime - 3600000,
      phases: [
        {
          key: 'autolyse',
          name: 'Autolyse',
          durationMinutes: 30,
          startedAt: mockTime - 1800000,
          completedAt: mockTime - 1000,
        },
        {
          key: 'bulk_ferment',
          name: 'Bulk Fermentation',
          durationMinutes: 240,
          startedAt: mockTime - 60000,
        },
      ],
    };

    const { result, unmount } = await renderHook(() => useActiveBakeTimer(mockBake));

    expect(result.current).toEqual({
      bulk_ferment: 60000,
    });

    await unmount();
  });

  it('3. Clears elapsed map when all active phases complete', async () => {
    const mockTime = 1700000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockTime);

    const activeBake: ActiveBake = {
      id: 'bake-102',
      recipeName: 'Levain',
      startedAt: mockTime,
      phases: [
        {
          key: 'mixing',
          name: 'Mixing',
          durationMinutes: 10,
          startedAt: mockTime - 10000,
        },
      ],
    };

    const { result, rerender, unmount } = await renderHook(
      ({ bake }) => useActiveBakeTimer(bake),
      { initialProps: { bake: activeBake as ActiveBake | null } }
    );

    expect(result.current).toEqual({ mixing: 10000 });

    const completedBake: ActiveBake = {
      ...activeBake,
      id: 'bake-102-completed',
      phases: [
        {
          ...activeBake.phases[0],
          completedAt: mockTime,
        },
      ],
    };

    await rerender({ bake: completedBake });

    expect(result.current).toEqual({});
    await unmount();
  });
});
