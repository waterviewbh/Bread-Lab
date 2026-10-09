import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, AppState, AppStateStatus, Platform, StyleSheet, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fonts, radius } from "@/constants/theme";
import { useTransientShareIntent } from "@/lib/useTransientShareIntent";
import { fetchAndExtractRecipeFromUrl } from "@/lib/webAcquisition";
import { extractRecipeFromText, ExtractionResult } from "@/lib/recipeExtractor";
import { saveCandidate, loadCandidates, CandidateRecord } from "@/lib/candidateStorage";

interface ShareCandidateContextValue {
  lastCreatedCandidate: CandidateRecord | null;
  processShareInput: (rawInput: string, subject?: string) => Promise<CandidateRecord | null>;
  showSuccessToast: (msg?: string) => void;
  listeners: Set<() => void>;
  subscribeCandidatesChanged: (listener: () => void) => () => void;
}

const ShareCandidateContext = createContext<ShareCandidateContextValue>({
  lastCreatedCandidate: null,
  processShareInput: async () => null,
  showSuccessToast: () => {},
  listeners: new Set(),
  subscribeCandidatesChanged: () => () => {},
});

export function useShareCandidate() {
  return useContext(ShareCandidateContext);
}

const SUCCESS_TOAST_TEXT = "Recipe candidate added to Bread Lab. Verify and add it in the app.";

function ShareSuccessToast({
  visible,
  text,
  onDismiss,
}: {
  visible: boolean;
  text: string;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(opacity, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 16,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  if (!visible) return null;

  const tabBarHeight = Platform.OS === "web" ? 84 : 49;
  const bottomOffset = insets.bottom + tabBarHeight + 16;

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        {
          bottom: bottomOffset,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.toast,
          {
            backgroundColor: "#1E293B",
            borderColor: "#334155",
            opacity: pressed ? 0.9 : 1,
          },
        ]}
        accessible={true}
        accessibilityLabel={text}
        testID="share-candidate-toast"
      >
        <Feather name="check-circle" size={16} color="#10B981" />
        <Text style={[styles.toastText, { color: "#F8FAFC" }]}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function ShareCandidateProvider({ children }: { children: React.ReactNode }) {
  const { payload, dismiss } = useTransientShareIntent();
  const [toastVisible, setToastVisible] = useState(false);
  const [toastText, setToastText] = useState(SUCCESS_TOAST_TEXT);
  const [lastCreatedCandidate, setLastCreatedCandidate] = useState<CandidateRecord | null>(null);

  const listenersRef = useRef(new Set<() => void>());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((fn) => {
      try {
        fn();
      } catch (_e) {}
    });
  }, []);

  const subscribeCandidatesChanged = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const showSuccessToast = useCallback((msg?: string) => {
    setToastText(msg || SUCCESS_TOAST_TEXT);
    setToastVisible(true);

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 4000);
  }, []);

  const processExtractionAndSave = useCallback(
    async (
      extractionResult: ExtractionResult,
      options?: { showToast?: boolean }
    ): Promise<CandidateRecord | null> => {
      if (
        extractionResult.status === "single_candidate" ||
        extractionResult.status === "multiple_candidates"
      ) {
        // Save Candidate to local AsyncStorage persistence FIRST
        const record = await saveCandidate(extractionResult, undefined, 'share');
        setLastCreatedCandidate(record);
        notifyListeners();

        // ONLY AFTER persistence succeeds, display success confirmation toast if requested
        if (options?.showToast) {
          showSuccessToast();
        }
        return record;
      }

      // If acquisition/extraction cannot produce a Candidate, do NOT display success confirmation
      return null;
    },
    [notifyListeners, showSuccessToast]
  );

  const processShareInput = useCallback(
    async (rawInput: string, _subject?: string): Promise<CandidateRecord | null> => {
      if (!rawInput || !rawInput.trim()) return null;

      let result: ExtractionResult;
      const isUrl = /^(https?:\/\/[^\s]+)/i.test(rawInput.trim());

      if (isUrl) {
        result = await fetchAndExtractRecipeFromUrl(rawInput.trim());
      } else {
        result = extractRecipeFromText(rawInput.trim());
      }

      return processExtractionAndSave(result, { showToast: true });
    },
    [processExtractionAndSave]
  );

  // Automatically process incoming transient share payload when received via Android Share / Linking
  useEffect(() => {
    if (!payload) return;

    let isMounted = true;
    (async () => {
      let result: ExtractionResult;
      if (payload.type === "url") {
        result = await fetchAndExtractRecipeFromUrl(
          payload.sanitizedUrl || payload.rawContent
        );
      } else {
        result = extractRecipeFromText(payload.rawContent);
      }

      if (isMounted) {
        // Toast is shown ONLY for warm background share acquisitions (source === 'event' && appStateAtArrival !== 'active')
        const shouldShowToast =
          payload.source === "event" && payload.appStateAtArrival !== "active";

        await processExtractionAndSave(result, { showToast: shouldShowToast });
        dismiss();
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [payload, processExtractionAndSave, dismiss]);

  // Listen for AppState transition into 'active' -> automatically ingest pending native staged shares and refresh Candidate UI
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (appStateRef.current !== "active" && nextAppState === "active") {
        (async () => {
          await loadCandidates();
          notifyListeners();
        })();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [notifyListeners]);

  return (
    <ShareCandidateContext.Provider
      value={{
        lastCreatedCandidate,
        processShareInput,
        showSuccessToast,
        listeners: listenersRef.current,
        subscribeCandidatesChanged,
      }}
    >
      {children}
      <ShareSuccessToast
        visible={toastVisible}
        text={toastText}
        onDismiss={() => setToastVisible(false)}
      />
    </ShareCandidateContext.Provider>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
    zIndex: 99999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
    maxWidth: 500,
    width: "100%",
  },
  toastText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
});
