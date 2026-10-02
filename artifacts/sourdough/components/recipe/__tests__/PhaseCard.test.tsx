import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { PendingPhaseCard } from '../PhaseCard';
import { BakePhase } from '@/lib/recipeTypes';

const mockColors = {
  card: '#ffffff',
  border: '#e0e0e0',
  mutedForeground: '#888888',
  foreground: '#000000',
  background: '#ffffff',
  accent: '#ff0000',
  primary: '#0000ff',
  muted: '#f0f0f0',
};

describe('PhaseCard Component Boundary', () => {
  it('scales ingredients according to scaleMultiplier, while instruction lines are NEVER scaled', async () => {
    const mockPhase: BakePhase = {
      key: 'mixing',
      name: 'Mixing Phase',
      startedAt: null,
      completedAt: null,
      readings: [],
      ingredients: [
        { id: 'ing-1', text: '500g flour', is_checked: false, sort_order: 0 },
        { id: 'ing-2', text: '1 egg', is_checked: false, sort_order: 1 },
      ],
      instructions: [
        { id: 'ins-1', text: 'Rest for 30 minutes', is_checked: false, sort_order: 0 },
        { id: 'ins-2', text: 'Fold 3 times', is_checked: false, sort_order: 1 },
        { id: 'ins-3', text: 'Fold in 2 eggs and mix for 3 minutes', is_checked: false, sort_order: 2 },
      ],
    };

    render(
      <PendingPhaseCard
        phase={mockPhase}
        colors={mockColors as any}
        isNextHighlight={false}
        isExpanded={true}
        onToggleExpand={jest.fn()}
        onStart={jest.fn()}
        onLayout={jest.fn()}
        scaleMultiplier={2}
        sessionChecks={{}}
        onToggleLineCheck={jest.fn()}
      />
    );

    await waitFor(() => {
      // Verify ingredient lines ARE scaled with multiplier 2x
      expect(screen.getByText('1000g flour')).toBeTruthy();
      expect(screen.getByText('2 eggs')).toBeTruthy();

      // Verify instruction lines (including those with ingredient-like text) are NEVER scaled
      expect(screen.getByText('Rest for 30 minutes')).toBeTruthy();
      expect(screen.getByText('Fold 3 times')).toBeTruthy();
      expect(screen.getByText('Fold in 2 eggs and mix for 3 minutes')).toBeTruthy();
    });
  });
});
