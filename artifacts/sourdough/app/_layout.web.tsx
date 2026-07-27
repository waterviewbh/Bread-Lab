// app/_layout.web.tsx
import "@expo-google-fonts/libre-caslon-text";
import "@expo-google-fonts/hanken-grotesk";
import "@expo-google-fonts/jetbrains-mono";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { MigrationToastProvider } from "@/contexts/MigrationToastContext";

// IMPORT THE FEED DIRECTLY (Bypassing the Router)
import FeedScreen from "./(tabs)/index";

const queryClient = new QueryClient();

export default function WebRootLayout() {
  console.log("=== [PHASE 10] Direct Render Test started ===");

  const [fontTimedOut, setFontTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <FontSizeProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <SyncProvider>
                <MigrationToastProvider>
                  {/* NO ROUTER - JUST THE PAGE */}
                  <FeedScreen />
                </MigrationToastProvider>
              </SyncProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </FontSizeProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}