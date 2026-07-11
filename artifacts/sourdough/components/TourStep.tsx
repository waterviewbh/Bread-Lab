import React from 'react';
import { Platform, View } from 'react-native';
import { TOUR_STEP_TEXT } from '@/constants/TourConfig';

// 1. Isolate the mobile-only libraries from the web bundler
let CopilotStep: any = null;
let walkthroughable: any = null;
let RealCopilotView: any = null;

if (Platform.OS !== 'web') {
  try {
    const copilot = require('react-native-copilot');
    CopilotStep = copilot.CopilotStep;
    walkthroughable = copilot.walkthroughable;
    RealCopilotView = walkthroughable(View);
  } catch (e) {
    console.warn("Copilot failed to load on mobile platforms:", e);
  }
}

interface TourStepProps {
  name: string;
  order: number;
  children: React.ReactNode;
  style?: any;
  text?: string; // optional override — omit in normal usage
}

// Accept `copilot` (injected by CopilotStep via cloneElement) and any
// other forwarded props, then pass them through to the walkthroughable View
// so react-native-copilot can attach its wrapperRef and measure the element.
export function CopilotView({
  children,
  style,
  copilot,
  ...rest
}: {
  children: React.ReactNode;
  style?: any;
  copilot?: any;
  [key: string]: any;
}) {
  if (Platform.OS === 'web' || !RealCopilotView) {
    return <View style={style}>{children}</View>;
  }
  return (
    <RealCopilotView copilot={copilot} style={style} {...rest}>
      {children}
    </RealCopilotView>
  );
}

// Export a web-safe step wrapper
export function TourStep({ text, order, name, children }: TourStepProps) {
  // Prefer explicit prop (escape hatch), fall back to TourConfig lookup
  const resolvedText = text ?? TOUR_STEP_TEXT[name] ?? '';
  if (Platform.OS === 'web' || !CopilotStep) {
    return <>{children}</>;
  }
  if (__DEV__ && resolvedText === '') {
    console.warn(`[TourStep] No text found in TourConfig for step name: "${name}"`);
  }
  return (
    <CopilotStep text={resolvedText} order={order} name={name}>
      {children}
    </CopilotStep>
  );
}