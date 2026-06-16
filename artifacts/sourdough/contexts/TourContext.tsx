import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { CopilotProvider, useCopilot } from 'react-native-copilot';
import { useRouter, usePathname } from 'expo-router';
import { IS_TOUR_ENABLED, TOUR_CHAPTERS, TourChapter } from '../constants/TourConfig';
import { Platform } from 'react-native';

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

const TourController: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { start, stop, visible, copilotEvents } = useCopilot();
  const router = useRouter();
  const pathname = usePathname();
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const handleStepChange = (step: any) => {
      if (!step || !currentChapterId || isTransitioning) return;

      const chapter = TOUR_CHAPTERS.find(c => c.id === currentChapterId);
      if (!chapter) return;

      const stepIndex = chapter.steps.findIndex(s => s.name === step.name);
      const isLastStepOfChapter = stepIndex === chapter.steps.length - 1;

      // Logic for future auto-transition hooks can go here
    };

    const handleStop = () => {
      if (!isTransitioning) {
        setCurrentChapterId(null);
      }
    };

    copilotEvents.on('stepChange', handleStepChange);
    copilotEvents.on('stop', handleStop);

    return () => {
      copilotEvents.off('stepChange', handleStepChange);
      copilotEvents.off('stop', handleStop);
    };
  }, [currentChapterId, isTransitioning, copilotEvents]);

  useEffect(() => {
    if (!visible && currentChapterId && !isTransitioning) {
      const currentIndex = TOUR_CHAPTERS.findIndex(c => c.id === currentChapterId);
      const nextChapter = TOUR_CHAPTERS[currentIndex + 1];

      if (nextChapter) {
        startChapter(nextChapter.id);
      } else {
        setCurrentChapterId(null);
      }
    }
  }, [visible, currentChapterId, isTransitioning]);

  const startChapter = async (chapterId: string) => {
    if (!IS_TOUR_ENABLED) return;

    const chapter = TOUR_CHAPTERS.find(c => c.id === chapterId);
    if (chapter) {
      setCurrentChapterId(chapterId);
      const firstStepName = chapter.steps[0].name;

      const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
      const normalizedTarget = chapter.tab === '/' ? '/' : chapter.tab.replace(/\/$/, '');

      if (normalizedPath !== normalizedTarget) {
        setIsTransitioning(true);
        router.push(chapter.tab as any);
        setTimeout(() => {
          setIsTransitioning(false);
          start(firstStepName);
        }, 1000);
      } else {
        setTimeout(() => start(firstStepName), 150);
      }
    }
  };

  const stopTour = () => {
    stop();
    setCurrentChapterId(null);
  };

  return (
    <TourContext.Provider value={{ startChapter, stopTour, isTourRunning: visible }}>
      {children}
    </TourContext.Provider>
  );
};

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <CopilotProvider
      verticalOffset={0}
      backdropColor="rgba(0, 0, 0, 0.85)"
      tooltipStyle={{ borderRadius: 12, padding: 8 }}
      stepNumberComponent={() => null}
      animated={true}
      // Removed broken svgMaskPath="rect" - Native environment handles masks automatically
    >
      <TourController>{children}</TourController>
    </CopilotProvider>
  );
};

export const useTour = () => {
  const context = useContext(TourContext);
  if (!context) throw new Error('useTour must be used within TourProvider');
  return context;
};
