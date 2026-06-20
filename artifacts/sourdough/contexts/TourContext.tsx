import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { CopilotProvider, useCopilot, TooltipProps } from 'react-native-copilot';
import { useRouter, usePathname } from 'expo-router';
import { IS_TOUR_ENABLED, TOUR_CHAPTERS, TourChapter } from '../constants/TourConfig';
import { Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

const CustomTooltip = ({
   isFirstStep,
   isLastStep,
   handleNext,
   handlePrev,
   handleStop,
   currentStep,
 }: TooltipProps) => {
   // 1. Add safety check
   if (!currentStep) return null;

   return (
     <View style={styles.tooltipContainer}>
       <Text style={styles.tooltipText}>{currentStep.text}</Text>
       <View style={styles.tooltipButtons}>
         <TouchableOpacity onPress={handleStop} style={styles.button}>
           <Text style={[styles.buttonText, { color: '#ef4444' }]}>Skip</Text>
         </TouchableOpacity>
         {!isFirstStep && (
           <TouchableOpacity onPress={handlePrev} style={styles.button}>
             <Text style={styles.buttonText}>Previous</Text>
           </TouchableOpacity>
         )}
         {!isLastStep ? (
           <TouchableOpacity onPress={handleNext} style={styles.button}>
             <Text style={[styles.buttonText, { color: '#10b981', fontWeight: 'bold' }]}>Next</Text>
           </TouchableOpacity>
         ) : (
           <TouchableOpacity onPress={handleStop} style={styles.button}>
             <Text style={[styles.buttonText, { color: '#10b981', fontWeight: 'bold' }]}>Finish</Text>
           </TouchableOpacity>
         )}
       </View>
     </View>
   );
};

const TourController: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { start, stop, visible, copilotEvents } = useCopilot();
  const router = useRouter();
  const pathname = usePathname();
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

useEffect(() => {
  const handleStepChange = (step: any) => {
    if (!step || isTransitioning) return;

    // 1. Navigation trigger check
    if (step.name.startsWith('next-chapter-is-')) {
      const targetId = step.name.replace('next-chapter-is-', '');
      stop();
      setTimeout(() => startChapter(targetId), 100);
      return;
    }

    // 2. Cross-chapter safety check
    const targetChapter = TOUR_CHAPTERS.find(c =>
      c.steps.some(s => s.name === step.name)
    );

    if (targetChapter && currentChapterId && targetChapter.id !== currentChapterId) {
      stop();
      startChapter(targetChapter.id);
    }
  }; // This closes handleStepChange

  const handleStop = () => {
    if (!isTransitioning) {
      setCurrentChapterId(null);
    }
  }; // This closes handleStop

  copilotEvents.on('stepChange', handleStepChange);
  copilotEvents.on('stop', handleStop);

  return () => {
    copilotEvents.off('stepChange', handleStepChange);
    copilotEvents.off('stop', handleStop);
  };
/* --seems like a lot to get rid of to replace with a little line below. Red tagged until 1.0.13+
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
  }, [visible, currentChapterId, isTransitioning]); */
  }, [currentChapterId, isTransitioning, copilotEvents, stop, startChapter]);

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
        }, 2000);  // was 1500
      } else {
        setTimeout(() => start(firstStepName), 500);
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
      verticalOffset={0} // Changed from 30 when the highlight holes didn't line up over the tab buttons
      backdropColor="rgba(0, 0, 0, 0.85)"
      tooltipComponent={CustomTooltip}
      stepNumberComponent={() => null}
      animated={true}
      stopOnOutsideClick={true} // Added safety valve to exit tour
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

const styles = StyleSheet.create({
  tooltipContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    width: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  tooltipText: {
    fontSize: 15,
    color: '#000', // was #333
    lineHeight: 22,
    fontFamily: 'sans-serif',
    marginBottom: 16,
  },
  tooltipButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  buttonText: {
    fontSize: 14,
    color: '#666',
    fontFamily: 'sans-serif',
  },
});