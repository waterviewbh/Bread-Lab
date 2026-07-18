// Web: passthrough with no import from react-native-keyboard-controller.
// Metro picks this file over KeyboardProviderCompat.tsx when bundling for web,
// so the native module is never included in the web bundle.
import React from "react";

export function KeyboardProviderCompat({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}