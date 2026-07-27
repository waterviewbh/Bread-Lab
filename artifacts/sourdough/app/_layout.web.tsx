// app/_layout.web.tsx
import "@expo-google-fonts/libre-caslon-text";
import "@expo-google-fonts/hanken-grotesk";
import "@expo-google-fonts/jetbrains-mono";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router"; // Using Slot instead of Stack
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { MigrationToastProvider } from "@/contexts/MigrationToastContext";

SplashScreen.preventAutoHideAsync().catch(() => {});
const queryClient = new QueryClient();

export default function WebRootLayout() {
  console.log("=== [PHASE 2] WebRootLayout (Root) started ===");

  const [fontTimedOut, setFontTimedOut] = useState(false);
  const fontsLoaded = true;
  const fontError = null;

  useEffect(() => {
    console.log("=== [PHASE 3] WebRootLayout (Root) mounted ===");
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
    <SafeAreaProvider>
      <PreferencesProvider>
        <FontSizeProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <SyncProvider>
                <MigrationToastProvider>
                  {/* Slot reaches into (tabs) and renders the next layout */}
                  <Slot />
                </MigrationToastProvider>
              </SyncProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </FontSizeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}