// artifacts/sourdough/app/_layout.tsx
import { Platform } from 'react-native';

if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";

import {
  LibreCaslonText_400Regular,
  LibreCaslonText_700Bold,
} from "@expo-google-fonts/libre-caslon-text";

import {
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";

import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProviderCompat } from "@/components/KeyboardProviderCompat";
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
    HankenGrotesk_700Bold,
    JetBrainsMono_500Medium,
  });

  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
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
      onError={(error, stack) => console.error("[RootLayout ErrorBoundary]", error.message, stack)}
    >
      <SafeAreaProvider>
        <PreferencesProvider>
          <FontSizeProvider>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProviderCompat>
                  <SyncProvider>
                    <MigrationToastProvider>
                      <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="index" options={{ headerShown: false }} />
                        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                        <Stack.Screen name="tools/bfmodule" options={{
                          title: 'Bulk Ferment Estimator',
                          headerShown: true
                        }} />
                      </Stack>
                    </MigrationToastProvider>
                  </SyncProvider>
                </KeyboardProviderCompat>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </FontSizeProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}