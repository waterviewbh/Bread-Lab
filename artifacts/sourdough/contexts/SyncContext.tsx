import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import { fonts } from "@/constants/theme";

type ToastState = "hidden" | "synced" | "offline" | "error";

interface SyncContextValue {
  pendingCount: number;
  reportSyncStart: () => void;
  reportSyncSuccess: () => void;
  reportSyncFailure: () => void;
}

const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  reportSyncStart: () => {},
  reportSyncSuccess: () => {},
  reportSyncFailure: () => {},
});

export function useSyncStatus() {
  return useContext(SyncContext);
}

function SyncToast({ state }: { state: ToastState }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const prevState = useRef<ToastState>("hidden");

  React.useEffect(() => {
    if (state !== "hidden" && prevState.current === "hidden") {
      Animated.parallel([
        Animated.spring(opacity, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      ]).start();
    } else if (state === "hidden" && prevState.current !== "hidden") {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 12, duration: 300, useNativeDriver: true }),
      ]).start();
    }
    prevState.current = state;
  }, [state, opacity, translateY]);

  if (state === "hidden" && prevState.current === "hidden") return null;

  const isSynced = state === "synced" || (state === "hidden" && prevState.current === "synced");
  const isError = state === "error" || (state === "hidden" && prevState.current === "error");
  const isOffline = state === "offline" || (state === "hidden" && prevState.current === "offline");

  const tabBarHeight = Platform.OS === "web" ? 84 : 49;
  const bottomOffset = insets.bottom + tabBarHeight + 12;

  const getToastConfig = () => {
    if (isSynced) return { icon: "check-circle", text: "Synced", bg: colors.primary, fg: colors.primaryForeground };
    if (isError) return { icon: "alert-circle", text: "Sync error — saved locally", bg: colors.muted, fg: colors.mutedForeground };
    return { icon: "wifi-off", text: "Offline — saved locally", bg: colors.muted, fg: colors.mutedForeground };
  };

  const config = getToastConfig();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toastContainer,
        {
          bottom: bottomOffset,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        style={[
          styles.toast,
          {
            backgroundColor: config.bg,
            borderColor: isSynced ? config.bg : colors.border,
          },
        ]}
      >
        <Feather
          name={config.icon as any}
          size={13}
          color={config.fg}
        />
        <Text
          style={[
            styles.toastText,
            { color: config.fg },
          ]}
        >
          {config.text}
        </Text>
      </View>
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
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "rgba(0,0,0,0.2)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  toastText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [toastState, setToastState] = useState<ToastState>("hidden");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback((delay: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setToastState("hidden");
    }, delay);
  }, []);

  const reportSyncStart = useCallback(() => {
    setPendingCount((c) => c + 1);
  }, []);

  const reportSyncSuccess = useCallback(() => {
    setPendingCount((c) => Math.max(0, c - 1));
    setToastState("synced");
    scheduleHide(2000);
  }, [scheduleHide]);

  const reportSyncFailure = useCallback(() => {
    setPendingCount((c) => Math.max(0, c - 1));
    setToastState("error");
    scheduleHide(3500);
  }, [scheduleHide]);

  return (
    <SyncContext.Provider
      value={{ pendingCount, reportSyncStart, reportSyncSuccess, reportSyncFailure }}
    >
      {children}
      <SyncToast state={toastState} />
    </SyncContext.Provider>
  );
}
