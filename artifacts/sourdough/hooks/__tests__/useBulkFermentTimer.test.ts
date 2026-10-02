jest.unmock('../useBulkFermentTimer');
import { renderHook } from '@testing-library/react-native';
import { useBulkFermentTimer } from '../useBulkFermentTimer';
import type { BulkFermentState } from '@/lib/recipeTypes';

describe('useBulkFermentTimer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. Returns mode "none" when state is undefined or no projection/reached timestamp exists', async () => {
    const { result, unmount } = await renderHook(() => useBulkFermentTimer(undefined));
    expect(result.current).toEqual({ mode: 'none', label: '' });
    await unmount();
  });

  it('2. Counts down when projectedTargetAt is in the future', async () => {
    const mockNow = 1700000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);

    const state: BulkFermentState = {
      projectedTargetAt: mockNow + 65000, // 1 min 5 sec remaining
    };

    const { result, unmount } = await renderHook(() => useBulkFermentTimer(state));

    expect(result.current.mode).toBe('countdown');
    expect(result.current.label).toBe('01:05');

    await unmount();
  });

  it('3. Switches to overtime mode when targetReachedAt is set or projected target is passed', async () => {
    const mockNow = 1700000000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);

    const state: BulkFermentState = {
      targetReachedAt: mockNow - 120000, // reached 2 mins ago
      inOvertime: true,
    };

    const { result, unmount } = await renderHook(() => useBulkFermentTimer(state));

    expect(result.current.mode).toBe('overtime');
    expect(result.current.label).toBe('+02:00');

    await unmount();
  });
});
