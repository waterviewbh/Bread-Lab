// app/_layout.web.tsx

console.log("=== [PHASE 1] _layout.web.tsx file evaluated by bundler ===");
if (typeof React === 'undefined') {
  console.log("!!! ALERT: React is undefined at module evaluation time !!!");
} else {
  console.log("React object exists:", Object.keys(React).slice(0, 5));
}

import {
  LibreCaslonText_400Regular,
  LibreCaslonText_700Bold,
} from "@expo-google-fonts/libre-caslon-text";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from "@expo-google-fonts/hanken-grotesk";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
// KeyboardProvider intentionally omitted — native-only, triggers reanimated
// module-level init that causes React to be null on web.
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { MigrationToastProvider } from "@/contexts/MigrationToastContext";

SplashScreen.preventAutoHideAsync().catch(() => {});
  const queryClient = new QueryClient();

  export default function WebRootLayout() {
    // 2. PLACE LOG HERE (Inside the component function, before hooks)
    console.log("=== [PHASE 2] WebRootLayout function execution started ===");

    const [fontsLoaded, fontError] = useFonts({
    LibreCaslonText_400Regular,
    LibreCaslonText_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    JetBrainsMono_500Medium,
  });

  // Fallback: proceed after 4 seconds if fonts never resolve
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    // 3. PLACE LOG HERE (Inside the mounted effect)
    console.log("=== [PHASE 3] WebRootLayout fully mounted to DOM ===");
    const t = setTimeout(() => setFontTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const appReady = fontsLoaded || !!fontError || fontTimedOut;

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  if (!appReady) return null;

    return (
    <ErrorBoundary
      onError={(error, stack) =>
        console.error("[WebRootLayout ErrorBoundary]", error.message, stack)
      }
    >
      <SafeAreaProvider>
        <PreferencesProvider>
          <FontSizeProvider>
            <QueryClientProvider client={queryClient}>
              {/* GestureHandlerRootView has web support; KeyboardProvider does not */}
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SyncProvider>
                  <MigrationToastProvider>
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    </Stack>
                  </MigrationToastProvider>
                </SyncProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </FontSizeProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}