// artifacts/sourdough/contexts/PreferencesContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

const TEMP_KEY = "bread_lab_temp_unit_v1";
const WEIGHT_KEY = "bread_lab_weight_unit_v1";
const TIME_KEY = "bread_lab_time_format_v1";

interface PreferencesContextValue {
  tempUnit: "F" | "C";
  setTempUnit: (value: "F" | "C") => void;
  weightUnit: "g" | "oz";
  setWeightUnit: (value: "g" | "oz") => void;
  timeFormat: "12h" | "24h";
  setTimeFormat: (value: "12h" | "24h") => void;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  tempUnit: "F",
  setTempUnit: () => {},
  weightUnit: "g",
  setWeightUnit: () => {},
  timeFormat: "12h",
  setTimeFormat: () => {},
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [tempUnit, setTempUnitState] = useState<"F" | "C">("F");
  const [weightUnit, setWeightUnitState] = useState<"g" | "oz">("g");
  const [timeFormat, setTimeFormatState] = useState<"12h" | "24h">("12h");

  useEffect(() => {
    // Load all settings on mount
    Promise.all([
      AsyncStorage.getItem(TEMP_KEY),
      AsyncStorage.getItem(WEIGHT_KEY),
      AsyncStorage.getItem(TIME_KEY),
    ]).then(([temp, weight, time]) => {
      if (temp === "F" || temp === "C") setTempUnitState(temp);
      if (weight === "g" || weight === "oz") setWeightUnitState(weight);
      if (time === "12h" || time === "24h") setTimeFormatState(time);
    });
  }, []);

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

  return (
    <PreferencesContext.Provider
      value={{
        tempUnit,
        setTempUnit,
        weightUnit,
        setWeightUnit,
        timeFormat,
        setTimeFormat,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}