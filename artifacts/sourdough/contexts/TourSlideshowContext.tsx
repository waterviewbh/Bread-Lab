import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStoredUser } from '@/lib/auth';

// ── AsyncStorage keys ─────────────────────────────────────────────────────────
// v1 = old copilot tour (any device that saw it is an upgrader → skip auto-show)
const TOUR_SEEN_V1_KEY = 'bread_lab_tour_seen_v1';
// v2 = new slideshow tour
const TOUR_SEEN_V2_KEY = 'bread_lab_tour_seen_v2';

// ── Context shape ─────────────────────────────────────────────────────────────
interface TourSlideshowContextType {
  showTour: () => void;
  hideTour: () => void;
  isTourVisible: boolean;
}

const TourSlideshowContext = createContext<TourSlideshowContextType | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────
export const TourSlideshowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isTourVisible, setIsTourVisible] = useState(false);
  // Guard against double-firing during strict-mode double-mount in dev
  const hasCheckedRef = useRef(false);
  const showTour = useCallback(() => setIsTourVisible(true), []);
  const hideTour = useCallback(() => {
    setIsTourVisible(false);
    // Mark the new slideshow as seen so it never auto-shows again
    AsyncStorage.setItem(TOUR_SEEN_V2_KEY, '1').catch(() => {});
  }, []);  // Auto-show logic: runs once on mount
  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;
    const checkAndMaybeShow = async () => {
      try {
        // Gate 1: authenticated/named user → upgrader → skip
        const user = await getStoredUser();
        if (user !== null) return;        // Gate 2: saw the old copilot tour → upgrader → skip
        const seenV1 = await AsyncStorage.getItem(TOUR_SEEN_V1_KEY);
        if (seenV1 === '1') return;        // Gate 3: already saw the new slideshow → skip
        const seenV2 = await AsyncStorage.getItem(TOUR_SEEN_V2_KEY);
        if (seenV2 === '1') return;        // New install: show after a short delay so the app can settle
        setTimeout(() => setIsTourVisible(true), 1500);
      } catch {
        // AsyncStorage failure → fail silently, don't block the app
      }
    };
    void checkAndMaybeShow();
  }, []);
  return (
    <TourSlideshowContext.Provider value={{ showTour, hideTour, isTourVisible }}>
      {children}
    </TourSlideshowContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────
export const useTourSlideshow = (): TourSlideshowContextType => {
  const context = useContext(TourSlideshowContext);
  if (!context) throw new Error('useTourSlideshow must be used within TourSlideshowProvider');
  return context;
};