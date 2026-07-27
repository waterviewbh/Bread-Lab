import { Tabs } from "expo-router";
import React from "react";
import { useColors } from "@/hooks/useColors";

export default function WebTabLayout() {
  const colors = useColors();

  return (
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
}