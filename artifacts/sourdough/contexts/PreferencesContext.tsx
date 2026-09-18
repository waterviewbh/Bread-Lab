// artifacts/sourdough/contexts/PreferencesContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { safeParse } from "@/lib/storageUtils";

const TEMP_KEY = "bread_lab_temp_unit_v1";
const WEIGHT_KEY = "bread_lab_weight_unit_v1";
const TIME_KEY = "bread_lab_time_format_v1";
const STARTER_TUTORIAL_ACTIVE_KEY = "bread_lab_starter_tutorial_active_v1";
const STARTER_TUTORIAL_DAY_KEY = "bread_lab_starter_tutorial_day_v1";
const TUTORIAL_BASELINE_VOLUME_KEY = "bread_lab_tutorial_baseline_volume_v1";
const TUTORIAL_METADATA_KEY = "bread_lab_tutorial_metadata_v1";

interface PreferencesContextValue {
  tempUnit: "F" | "C";
  setTempUnit: (value: "F" | "C") => void;
  weightUnit: "g" | "oz";
  setWeightUnit: (value: "g" | "oz") => void;
  timeFormat: "12h" | "24h";
  setTimeFormat: (value: "12h" | "24h") => void;
  starterTutorialMode: boolean;
  setStarterTutorialMode: (value: boolean) => void;
  tutorialDay: number;
  setTutorialDay: (value: number) => void;
  baselineVolume: number;
  setBaselineVolume: (value: number) => void;
  tutorialMetadata: any;
  setTutorialMetadata: (value: any) => void;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  tempUnit: "F",
  setTempUnit: () => {},
  weightUnit: "g",
  setWeightUnit: () => {},
  timeFormat: "12h",
  setTimeFormat: () => {},
  starterTutorialMode: false,
  setStarterTutorialMode: () => {},
  tutorialDay: 1,
  setTutorialDay: () => {},
  baselineVolume: 0,
  setBaselineVolume: () => {},
  tutorialMetadata: {},
  setTutorialMetadata: () => {},
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children, onHydrated }: { children: React.ReactNode; onHydrated?: () => void }) {
  const [tempUnit, setTempUnitState] = useState<"F" | "C">("F");
  const [weightUnit, setWeightUnitState] = useState<"g" | "oz">("g");
  const [timeFormat, setTimeFormatState] = useState<"12h" | "24h">("12h");
  const [starterTutorialMode, setStarterTutorialModeState] = useState<boolean>(false);
  const [tutorialDay, setTutorialDayState] = useState<number>(1);
  const [baselineVolume, setBaselineVolumeState] = useState<number>(0);
  const [tutorialMetadata, setTutorialMetadataState] = useState<any>({});

  useEffect(() => {
    // Load all settings on mount
    Promise.all([
      AsyncStorage.getItem(TEMP_KEY),
      AsyncStorage.getItem(WEIGHT_KEY),
      AsyncStorage.getItem(TIME_KEY),
      AsyncStorage.getItem(STARTER_TUTORIAL_ACTIVE_KEY),
      AsyncStorage.getItem(STARTER_TUTORIAL_DAY_KEY),
      AsyncStorage.getItem(TUTORIAL_BASELINE_VOLUME_KEY),
      AsyncStorage.getItem(TUTORIAL_METADATA_KEY),
    ]).then(([temp, weight, time, tutorialActive, day, baseline, meta]) => {
      if (temp === "F" || temp === "C") setTempUnitState(temp);
      if (weight === "g" || weight === "oz") setWeightUnitState(weight);
      if (time === "12h" || time === "24h") setTimeFormatState(time);
      if (tutorialActive !== null) setStarterTutorialModeState(tutorialActive === "true");
      if (day !== null) setTutorialDayState(parseInt(day, 10));
      if (baseline !== null) setBaselineVolumeState(parseFloat(baseline));
      if (meta !== null) setTutorialMetadataState(safeParse(meta, {}));

      onHydrated?.();
    }).catch(() => {
      onHydrated?.();
    });
  }, [onHydrated]);

  const setTempUnit = (value: "F" | "C") => {
    setTempUnitState(value);
    AsyncStorage.setItem(TEMP_KEY, value);
  };

  const setWeightUnit = (value: "g" | "oz") => {
    setWeightUnitState(value);
    AsyncStorage.setItem(WEIGHT_KEY, value);
  };

  const setTimeFormat = (value: "12h" | "24h") => {
    setTimeFormatState(value);
    AsyncStorage.setItem(TIME_KEY, value);
  };

  const setTutorialDay = (value: number) => {
    setTutorialDayState(value);
    AsyncStorage.setItem(STARTER_TUTORIAL_DAY_KEY, String(value));
  };

  const setBaselineVolume = (value: number) => {
    setBaselineVolumeState(value);
    AsyncStorage.setItem(TUTORIAL_BASELINE_VOLUME_KEY, String(value));
  };

  const setTutorialMetadata = (value: any) => {
    setTutorialMetadataState(value);
    AsyncStorage.setItem(TUTORIAL_METADATA_KEY, JSON.stringify(value));
  };

  const setStarterTutorialMode = (value: boolean) => {
    setStarterTutorialModeState(value);
    AsyncStorage.setItem(STARTER_TUTORIAL_ACTIVE_KEY, String(value));
    if (value && tutorialDay < 1) {
      setTutorialDay(1);
    }
  };

  return (
    <PreferencesContext.Provider
      value={{
        tempUnit,
        setTempUnit,
        weightUnit,
        setWeightUnit,
        timeFormat,
        setTimeFormat,
        starterTutorialMode,
        setStarterTutorialMode,
        tutorialDay,
        setTutorialDay,
        baselineVolume,
        setBaselineVolume,
        tutorialMetadata,
        setTutorialMetadata,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
