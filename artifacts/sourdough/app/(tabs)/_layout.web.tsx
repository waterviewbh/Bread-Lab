import React from "react";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TourSlideshowProvider } from "@/contexts/TourSlideshowContext";
import { TourSlideshow } from "@/components/TourSlideshow";

// DummyTourContext removed — TourContext.tsx is now a no-op stub on all platforms.

function WebTabs() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 70,
          paddingBottom: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="graph"
        options={{
          title: "Graph",
          tabBarIcon: ({ color }) => <Feather name="trending-up" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="recipe"
        options={{
          title: "Recipe",
          tabBarIcon: ({ color }) => <Feather name="list" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => <Feather name="calendar" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: "About",
          tabBarIcon: ({ color }) => <Feather name="info" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function WebTabLayout() {
  // TourSlideshowProvider supplies the context that About's "Take the Tour"
  // button needs; TourSlideshow renders as a Modal overlay when visible.
  return (
    <TourSlideshowProvider>
      <WebTabs />
      <TourSlideshow />
    </TourSlideshowProvider>
  );
}
