import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { View } from "react-native";

// 1. Import your original TourContext infrastructure
import { TourProvider } from "@/contexts/TourContext";
import { TOUR_CHAPTERS } from "@/constants/TourConfig";

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

// 2. Wrap the tabs layout with TourProvider so child elements don't panic
export default function WebTabLayout() {
  return (
    <TourProvider chapters={TOUR_CHAPTERS}>
      <WebTabs />
    </TourProvider>
  );
}