import React, { createContext, useContext } from 'react';
import { ScrollView } from 'react-native';

// ── Stub: copilot tour replaced by TourSlideshow ──────────────────────────────
// This file is kept so consumer files that import useTour() (e.g. FeedSetupView
// for registerScrollView) continue to compile without modification.
// TourProvider is no longer mounted in _layout.tsx.

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
  registerScrollView: (ref: ScrollView | null) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

// No-op provider — not currently mounted anywhere; kept for cleanup pass.
export const TourProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <TourContext.Provider
    value={{
      startChapter: () => {},
      stopTour: () => {},
      isTourRunning: false,
      registerScrollView: () => {},
    }}
  >
    {children}
  </TourContext.Provider>
);

// Returns no-ops when called outside a provider so nothing throws.
export const useTour = (): TourContextType => {
  const context = useContext(TourContext);
  if (!context) {
    return {
      startChapter: () => {},
      stopTour: () => {},
      isTourRunning: false,
      registerScrollView: () => {},
    };
  }
  return context;
};
