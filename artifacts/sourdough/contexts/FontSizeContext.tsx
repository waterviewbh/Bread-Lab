import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Text, TextInput } from "react-native";

const STORAGE_KEY = "bread_lab_full_font_size_v1";
const CAP = 1.3;

interface FontSizeContextValue {
  fullFontSize: boolean;
  setFullFontSize: (value: boolean) => void;
}

const FontSizeContext = createContext<FontSizeContextValue>({
  fullFontSize: false,
  setFullFontSize: () => {},
});

export function useFontSize() {
  return useContext(FontSizeContext);
}

function applyFontSizeCap(full: boolean) {
  const multiplier = full ? undefined : CAP;

  (Text as unknown as { defaultProps: Record<string, unknown> }).defaultProps = {
    ...((Text as unknown as { defaultProps?: Record<string, unknown> }).defaultProps ?? {}),
    maxFontSizeMultiplier: multiplier,
  };
  (TextInput as unknown as { defaultProps: Record<string, unknown> }).defaultProps = {
    ...((TextInput as unknown as { defaultProps?: Record<string, unknown> }).defaultProps ?? {}),
    maxFontSizeMultiplier: multiplier,
  };
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [fullFontSize, setFullFontSizeState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      const value = raw === "true";
      setFullFontSizeState(value);
      applyFontSizeCap(value);
    });
  }, []);

  const setFullFontSize = useCallback((value: boolean) => {
    setFullFontSizeState(value);
    applyFontSizeCap(value);
    AsyncStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  }, []);

  return (
    <FontSizeContext.Provider value={{ fullFontSize, setFullFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}
