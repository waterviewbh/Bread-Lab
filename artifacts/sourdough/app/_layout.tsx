import { Platform } from 'react-native';

if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

// ── Font imports ─────────────────────────────────────────────────────────────
import {
  LibreCaslonText_400Regular,
  LibreCaslonText_700Bold,
} from "@expo-google-fonts/libre-caslon-text";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from "@expo-google-fonts/hanken-grotesk";
import {
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { MigrationToastProvider } from "@/contexts/MigrationToastContext";

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient();

export default function RootLayout() {
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
  const t = setTimeout(() => setFontTimedOut(true), 4000);
  return () => clearTimeout(t);
}, []);

// All hooks must be declared before any conditional return
const appReady = fontsLoaded || !!fontError || fontTimedOut;
useEffect(() => {
  if (appReady) {
    SplashScreen.hideAsync().catch(() => {});
  }
}, [appReady]);

// Safe to return null here — no more hooks below this line
if (!appReady) return null;

// In _layout.tsx, replace the return block with:
return (
  <ErrorBoundary
    onError={(error, stack) => console.error("[RootLayout ErrorBoundary]", error.message, stack)}
  >
    <SafeAreaProvider>
      <PreferencesProvider>
        <FontSizeProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <SyncProvider>
                  <MigrationToastProvider>
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    </Stack>
                  </MigrationToastProvider>
                </SyncProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </FontSizeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  </ErrorBoundary>
);
}
