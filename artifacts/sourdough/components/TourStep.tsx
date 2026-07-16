import React from 'react';
import { View } from 'react-native';

// ── Stub: copilot tour replaced by TourSlideshow ──────────────────────────────
// TourStep and CopilotView are kept as transparent pass-throughs so the
// 10+ consumer files that still import them compile and render without change.

interface TourStepProps {
  name: string;
  order: number;
  children: React.ReactNode;
  style?: any;
  text?: string;
}

// Renders children in a plain View so the sizing styles in tab icons still apply.
// The copilot prop is accepted but ignored.
export function CopilotView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
  copilot?: any;
  [key: string]: any;
}) {
  return <View style={style}>{children}</View>;
}

// Renders children directly — no overlay, no step registration.
export function TourStep({ children }: TourStepProps) {
  return <>{children}</>;
}
