// Native: delegates to the real KeyboardProvider from react-native-keyboard-controller.
// On web, Metro prefers KeyboardProviderCompat.web.tsx instead of this file.
import { KeyboardProvider } from "react-native-keyboard-controller";
import React from "react";
export function KeyboardProviderCompat({ children }: { children: React.ReactNode }) {
  return <KeyboardProvider>{children}</KeyboardProvider>;
}