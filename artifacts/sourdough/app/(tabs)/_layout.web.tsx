import { Tabs, Slot } from "expo-router";
import React from "react";
import { useColors } from "@/hooks/useColors";

export default function WebTabLayout() {
  const colors = useColors();

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
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SyncProvider>
                  <MigrationToastProvider>
                    {/* Bypassing the Stack entirely to see if ANY routing works */}
                    <Slot />
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