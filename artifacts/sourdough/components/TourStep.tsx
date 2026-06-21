import React from 'react';
import { Platform, View } from 'react-native';

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
  text: string;
  order: number;
  name: string;
  children: React.ReactNode;
  style?: any; // To accept formatting styles seamlessly
}

// Export a web-safe view wrapper
export function CopilotView({ children, style }: { children: React.ReactNode, style?: any }) {
  if (Platform.OS === 'web' || !RealCopilotView) {
    return <View style={style}>{children}</View>;
  }
  return <RealCopilotView style={style}>{children}</RealCopilotView>;
}

// Export a web-safe step wrapper
export function TourStep({ text, order, name, children }: TourStepProps) {
  if (Platform.OS === 'web' || !CopilotStep) {
    return <>{children}</>;
  }
  return (
    <TourStep text={text} order={order} name={name}>
      {children}
    </TourStep>
  );
}