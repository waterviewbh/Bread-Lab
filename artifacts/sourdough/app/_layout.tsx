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
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FontSizeProvider } from "@/contexts/FontSizeContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { MigrationToastProvider } from "@/contexts/MigrationToastContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Artisan Hearth design system fonts
    LibreCaslonText_400Regular,
    LibreCaslonText_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

return (
     <SafeAreaProvider>
       <PreferencesProvider>
         <ErrorBoundary>
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
         </ErrorBoundary>
       </PreferencesProvider>
     </SafeAreaProvider>
   );
}
