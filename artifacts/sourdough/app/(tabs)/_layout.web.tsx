// app/(tabs)/_layout.web.tsx
import { Tabs } from "expo-router";
import React from "react";
import { useColors } from "@/hooks/useColors";
import { TourSlideshowProvider } from "@/contexts/TourSlideshowContext";
import { TourSlideshow } from "@/components/TourSlideshow";

export default function WebTabLayout() {
  const colors = useColors();
  console.log("=== [PHASE 4] WebTabLayout (Tabs) executing ===");

  const content = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 84,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Feed" }} />
      <Tabs.Screen name="graph" options={{ title: "Graph" }} />
      <Tabs.Screen name="recipe" options={{ title: "Recipe" }} />
      <Tabs.Screen name="history" options={{ title: "Calendar" }} />
      <Tabs.Screen name="about" options={{ title: "About" }} />
    </Tabs>
  );

  return (
    <TourSlideshowProvider>
      {content}
      <TourSlideshow />
    </TourSlideshowProvider>
  );
}