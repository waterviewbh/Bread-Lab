import React, { createContext, useContext } from 'react';
import { ScrollView } from 'react-native';

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
  registerScrollView: (ref: ScrollView | null) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

/**
 * A web-safe, no-op version of the TourProvider.
 * This prevents crashes on the web by avoiding any 'react-native-copilot' imports.
 */
export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const startChapter = (chapterId: string) => {}
  const stopTour = () => {};
  const registerScrollView = (ref: ScrollView | null) => {};

  return (
    <TourContext.Provider value={{ startChapter, stopTour, isTourRunning: false, registerScrollView }}>
      {children}
    </TourContext.Provider>
  );
};

export const useTour = () => {
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