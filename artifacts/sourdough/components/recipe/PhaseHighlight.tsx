// components/recipe/PhaseHighlight.tsx
// ─── Animated glow wrapper for the next pending phase card ────────────────────
// When `active` flips to true it briefly pulses an accent-coloured shadow,
// drawing the baker's eye after the auto-scroll lands on the next phase.
import React, { useEffect } from "react";
import { Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

interface PhaseHighlightProps {
  children: React.ReactNode;
  // Trigger the glow by flipping this to true; parent resets it after ~1 s.
  active: boolean;
  accentColor: string;
}

export function PhaseHighlight({ children, active, accentColor }: PhaseHighlightProps) {
  const isWeb = Platform.OS === 'web';
  const glow = useSharedValue(0);  useEffect(() => {
    if (active) {
      // Quick flash in (60 ms) then slow fade out (750 ms).
      glow.value = withSequence(
        withTiming(1, { duration: 60 }),
        withTiming(0, { duration: 750 })
      );
    }
  }, [active]);

  const animStyle = useAnimatedStyle(() => ({
    borderRadius: 12,
    shadowColor: accentColor,
    shadowOpacity: glow.value * 0.45,
    shadowRadius: glow.value * 14,
    elevation: Math.round(glow.value * 7),
  }), [glow]);
  return <Animated.View style={animStyle}>{children}</Animated.View>;
}