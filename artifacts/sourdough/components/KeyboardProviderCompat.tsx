// components/KeyboardProviderCompat.tsx
// Checks for the native module binding before rendering KeyboardProvider.
// In Expo Go the native module is not linked, so _bindings.KeyboardControllerNative
// is undefined and KeyboardProvider throws on getConstants — this guard prevents that.
import React from "react";
import { NativeModules } from "react-native";
export function KeyboardProviderCompat({ children }: { children: React.ReactNode }) {
  // If the native module isn't linked, skip the provider entirely
  if (!NativeModules.KeyboardControllerNative) {
    return <>{children}</>;
  }
  const { KeyboardProvider } = require("react-native-keyboard-controller");
  return <KeyboardProvider>{children}</KeyboardProvider>;
}