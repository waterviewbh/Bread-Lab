import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { MigrationResult } from "@/lib/migrate";

type MigrationPhase = "hidden" | "progress" | "done" | "partial";

interface MigrationToastContextValue {
  isMigrationActive: boolean;
  startMigration: () => void;
  finishMigration: (result: MigrationResult | null) => void;
}

const MigrationToastContext = createContext<MigrationToastContextValue>({
  isMigrationActive: false,
  startMigration: () => {},
  finishMigration: () => {},
});

export function useMigrationToast() {
  return useContext(MigrationToastContext);
}

function MigrationToast({
  phase,
  syncedCount,
  onDismiss,
}: {
  phase: MigrationPhase;
  syncedCount: number;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const panOffset = useRef(new Animated.Value(0)).current;
  const prevPhase = useRef<MigrationPhase>("hidden");
  const webTop = Platform.OS === "web" ? 67 : 0;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy, dx }) =>
        dy < -5 && Math.abs(dy) > Math.abs(dx),
      onPanResponderMove: (_, { dy }) => {
        if (dy < 0) panOffset.setValue(dy);
      },
      onPanResponderRelease: (_, { dy }) => {
        if (dy < -40) {
          Animated.parallel([
            Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(panOffset, { toValue: -80, duration: 200, useNativeDriver: true }),
          ]).start(() => {
            panOffset.setValue(0);
            onDismiss();
          });
        } else {
          Animated.spring(panOffset, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 12,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(panOffset, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 12,
        }).start();
      },
    })
  ).current;

  const handlePressIn = () => {
    Animated.timing(pressScale, {
      toValue: 0.95,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    // Resets scale on a cancelled press; overridden by handlePress for full taps
    Animated.timing(pressScale, {
      toValue: 1,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    // Stop any in-flight scale animation, snap cleanly back to 1, then dismiss —
    // this guarantees the press feedback is fully visible before the fade-out begins.
    pressScale.stopAnimation();
    Animated.timing(pressScale, {
      toValue: 1,
      duration: 60,
      useNativeDriver: true,
    }).start(() => onDismiss());
  };

  React.useEffect(() => {
    if (phase !== "hidden" && prevPhase.current === "hidden") {
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
    } else if (phase === "hidden" && prevPhase.current !== "hidden") {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevPhase.current = phase;
  }, [phase, opacity, translateY]);

  if (phase === "hidden" && prevPhase.current === "hidden") return null;

  const activePhase: MigrationPhase =
    phase !== "hidden" ? phase : prevPhase.current;

  const topOffset = insets.top + webTop + 12;

  let icon: React.ReactNode;
  let message: string;
  let bgColor: string;
  let fgColor: string;
  let borderColor: string;

  if (activePhase === "progress") {
    icon = <ActivityIndicator size="small" color={colors.mutedForeground} style={{ width: 13, height: 13 }} />;
    message = "Backing up your sessions\u2026";
    bgColor = colors.card;
    fgColor = colors.foreground;
    borderColor = colors.border;
  } else if (activePhase === "done") {
    icon = <Feather name="check-circle" size={13} color={colors.primaryForeground} />;
    message =
      syncedCount > 0
        ? `Your ${syncedCount} session${syncedCount === 1 ? "" : "s"} are now backed up`
        : "Your data is now backed up";
    bgColor = colors.primary;
    fgColor = colors.primaryForeground;
    borderColor = colors.primary;
  } else {
    icon = <Feather name="alert-circle" size={13} color={colors.foreground} />;
    message = "Some data couldn\u2019t be synced \u2014 try signing out and back in";
    bgColor = colors.card;
    fgColor = colors.foreground;
    borderColor = colors.border;
  }

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.toastContainer,
        {
          top: topOffset,
          opacity,
          transform: [{ translateY: Animated.add(translateY, panOffset) }],
        },
      ]}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
      >
        <Animated.View
          style={[
            styles.toast,
            { backgroundColor: bgColor, borderColor, transform: [{ scale: pressScale }] },
          ]}
        >
          {icon}
          <Text style={[styles.toastText, { color: fgColor }]}>
            {message}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    maxWidth: 320,
  },
  toastText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flexShrink: 1,
  },
});

export function MigrationToastProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<MigrationPhase>("hidden");
  const [syncedCount, setSyncedCount] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const hideToast = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setPhase("hidden");
  }, []);

  const scheduleHide = useCallback((delay: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPhase("hidden"), delay);
  }, []);

  const startMigration = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setSyncedCount(0);
    setPhase("progress");
  }, []);

  const finishMigration = useCallback(
    (result: MigrationResult | null) => {
      const totalOk = result
        ? result.feed.ok + result.bakes.ok + result.recipes.ok
        : 0;
      const totalFailed = result
        ? result.feed.failed + result.bakes.failed + result.recipes.failed
        : 1;

      if (totalOk === 0 && totalFailed === 0) {
        setPhase("hidden");
        return;
      }

      setSyncedCount(totalOk);

      if (totalFailed > 0) {
        setPhase("partial");
        scheduleHide(5000);
      } else {
        setPhase("done");
        scheduleHide(3000);
      }
    },
    [scheduleHide]
  );

  const isMigrationActive = phase === "progress";

  return (
    <MigrationToastContext.Provider value={{ isMigrationActive, startMigration, finishMigration }}>
      {children}
      <MigrationToast phase={phase} syncedCount={syncedCount} onDismiss={hideToast} />
    </MigrationToastContext.Provider>
  );
}
