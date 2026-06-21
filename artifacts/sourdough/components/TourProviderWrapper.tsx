import React from 'react';
import { Platform } from 'react-native';

let MobileTourProvider: any = null;
let MOBILE_TOUR_CHAPTERS: any = null;

if (Platform.OS !== 'web') {
  try {
    MobileTourProvider = require('@/contexts/TourContext').TourProvider;
    MOBILE_TOUR_CHAPTERS = require('@/constants/TourConfig').TOUR_CHAPTERS;
  } catch (e) {
    console.warn("Could not safely bind mobile tour hooks:", e);
  }
}

export function TourProviderWrapper({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web' || !MobileTourProvider) {
    return <>{children}</>; // Plain web fallback shell
  }
  return (
    <MobileTourProvider chapters={MOBILE_TOUR_CHAPTERS}>
      {children}
    </MobileTourProvider>
  );
}