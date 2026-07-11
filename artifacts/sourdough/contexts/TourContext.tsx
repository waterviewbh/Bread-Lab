import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { CopilotProvider, useCopilot, TooltipProps } from 'react-native-copilot';
import { useRouter, usePathname } from 'expo-router';
import { IS_TOUR_ENABLED, TOUR_CHAPTERS } from '../constants/TourConfig';
import { Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface TourContextType {
  startChapter: (chapterId: string) => void;
  stopTour: () => void;
  isTourRunning: boolean;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

// v3.3.3: TooltipProps is only { labels }. All step state and navigation
// must come from useCopilot() — not from props.
const CustomTooltip = ({ labels }: TooltipProps) => {
  const { currentStep, isFirstStep, isLastStep, goToNext, goToPrev, stop } = useCopilot();
  if (!currentStep) return null;
  const handleStop = () => { void stop(); };
  const handleNext = () => { void goToNext(); };
  const handlePrev = () => { void goToPrev(); };
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
  // useRef so startChapter/handleStop always see the live value without
  // being listed as effect dependencies (avoids effect re-registration on
  // every render).
  const isTransitioningRef = useRef(false);
  // ── Diagnostic overlay (DEV only) ──────────────────────────────────────────
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setDebugLog(prev => [`${ts} ${msg}`, ...prev].slice(0, 10));
  }, []);
  // Diagnostic element. The commented-out version may not come back if it's part of the problem
  const startChapter = useCallback(async (chapterId: string) => {
    addLog(`startChapter("${chapterId}") visible=${visible} path=${pathname}`);  if (!IS_TOUR_ENABLED) {
      addLog('BLOCKED: IS_TOUR_ENABLED is false');
      return;
    }  const chapter = TOUR_CHAPTERS.find(c => c.id === chapterId);
    if (!chapter) {
      addLog(`BLOCKED: chapter "${chapterId}" not found`);
      return;
    }  if (visible) {
      isTransitioningRef.current = true;
      addLog('stopping existing tour');
      stop();
    } else {
      isTransitioningRef.current = true;
    }  setCurrentChapterId(chapterId);  const firstStepName = chapter.steps[0].name;
    const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
    const normalizedTarget = chapter.tab === '/' ? '/' : chapter.tab.replace(/\/$/, '');  if (normalizedPath !== normalizedTarget) {
      addLog(`navigating ${normalizedPath} → ${normalizedTarget}`);
      router.push(chapter.tab as any);
      setTimeout(() => {
        addLog(`calling start("${firstStepName}") after nav delay`);
        isTransitioningRef.current = false;
        start(firstStepName);
      }, 2000);
    } else {
      addLog(`same tab, calling start("${firstStepName}") after 500ms`);
      setTimeout(() => {
        isTransitioningRef.current = false;
        start(firstStepName);
      }, 500);
    }
  }, [stop, start, pathname, router, visible, addLog]);
  {/*const startChapter = useCallback(async (chapterId: string) => {
    if (!IS_TOUR_ENABLED) return;
    const chapter = TOUR_CHAPTERS.find(c => c.id === chapterId);
    if (!chapter) return;
    // Only stop an already-running tour — calling stop() cold resets
    // copilot's internal state and can prevent the subsequent start() from firing.
    if (visible) {
      isTransitioningRef.current = true;
      stop();
    } else {
      isTransitioningRef.current = true;
    }
    setCurrentChapterId(chapterId);
    const firstStepName = chapter.steps[0].name;
    const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
    const normalizedTarget = chapter.tab === '/' ? '/' : chapter.tab.replace(/\/$/, '');
    if (normalizedPath !== normalizedTarget) {
      router.push(chapter.tab as any);
      // Allow time for the new tab to mount and register its CopilotSteps
      // before we call start(). 2 s has proven necessary on slower devices.
      setTimeout(() => {
        isTransitioningRef.current = false;
        start(firstStepName);
      }, 2000);
    } else {
      // Same tab — just a short yield for any conditional renders to settle.
      setTimeout(() => {
        isTransitioningRef.current = false;
        start(firstStepName);
      }, 500);
    }
  }, [stop, start, pathname, router, visible]); */}
  useEffect(() => {
    const handleStepChange = (step: any) => {
      if (!step || isTransitioningRef.current) return;
      addLog(`stepChange: "${step.name}"`);  // diagnostic element
      // Transition trigger: step name encodes the target chapter id.
      if (step.name.startsWith('next-chapter-is-')) {
        const targetId = step.name.replace('next-chapter-is-', '');
        // startChapter owns the stop() call — don't call it here separately.
        startChapter(targetId);
        return;
      }
      // Safety net: if copilot somehow lands on a step from a different
      // chapter (e.g. stale registration), redirect to the right chapter.
      const targetChapter = TOUR_CHAPTERS.find(c =>
        c.steps.some(s => s.name === step.name)
      );
      if (targetChapter && currentChapterId && targetChapter.id !== currentChapterId) {
        startChapter(targetChapter.id);
      }
    };
    const handleStart = () => {
      addLog('copilot start event fired');
    };
    const handleStop = () => {
      addLog(`stop event, transitioning=${isTransitioningRef.current}`); // diagnostic element
      // Only clear state if we're not mid-transition to a new chapter.
      if (!isTransitioningRef.current) {
        setCurrentChapterId(null);
      }
    };
    copilotEvents.on('stepChange', handleStepChange);
    copilotEvents.on('start', handleStart);
    copilotEvents.on('stop', handleStop);

    return () => {
      copilotEvents.off('stepChange', handleStepChange);
      copilotEvents.off('stop', handleStop);
      copilotEvents.off('start', handleStart);
    };
  }, [currentChapterId, copilotEvents, startChapter]);
  const stopTour = useCallback(() => {
    isTransitioningRef.current = false;
    stop();
    setCurrentChapterId(null);
  }, [stop]);
  return (
    <TourContext.Provider value={{ startChapter, stopTour, isTourRunning: visible }}>
      {children}
      {/* diagnostic element */}
      {__DEV__ && (
        <View style={diagStyles.overlay} pointerEvents="none">
          <Text style={diagStyles.header}>TOUR DIAG</Text>
          <Text style={diagStyles.line}>visible: {String(visible)}</Text>
          <Text style={diagStyles.line}>chapter: {currentChapterId ?? 'none'}</Text>
          <Text style={diagStyles.line}>path: {pathname}</Text>
          {debugLog.map((line, i) => (
            <Text key={i} style={diagStyles.log}>{line}</Text>
          ))}
        </View>
      )}
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
      stopOnOutsideClick={false} // Added safety valve to exit tour. As part of testing, set to false
      // in order to see if this immediately dismisses the tour the moment it appears.
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
const diagStyles = StyleSheet.create({  // diagnostic elements
  overlay: {
    position: 'absolute',
    top: 60,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 8,
    borderRadius: 8,
    maxWidth: 320,
    zIndex: 9999,
  },
  header: {
    color: '#facc15',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  line: {
    color: '#86efac',
    fontSize: 10,
    lineHeight: 16,
  },
  log: {
    color: '#e2e8f0',
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
});