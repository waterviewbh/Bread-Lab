import React, { createContext } from "react";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

// 1. We create an explicit empty dummy context object to satisfy child hooks
export const DummyTourContext = createContext({
  currentChapter: null,
  startTour: () => {},
  stopTour: () => {},
  isTourActive: false,
});

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

// 2. Wrap your web screens inside the fake provider instead of importing your mobile tour files
export default function WebTabLayout() {
  return (
    <DummyTourContext.Provider value={{ currentChapter: null, startTour: () => {}, stopTour: () => {}, isTourActive: false }}>
      <WebTabs />
    </DummyTourContext.Provider>
  );
}