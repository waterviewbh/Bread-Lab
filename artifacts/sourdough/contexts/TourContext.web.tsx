import React, { createContext, useContext } from 'react';

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

/**
 * A web-safe, no-op version of the TourProvider.
 * This prevents crashes on the web by avoiding any 'react-native-copilot' imports.
 */
export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const startChapter = (chapterId: string) => {
    console.log('[Tour] Tour is disabled on web. Requested chapter:', chapterId);
  };

  const stopTour = () => {};

  return (
    <TourContext.Provider value={{ startChapter, stopTour, isTourRunning: false }}>
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
    };
  }
  return context;
};