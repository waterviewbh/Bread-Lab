import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { TourProvider } from "@/contexts/TourContext";
import { TOUR_CHAPTERS } from "@/constants/TourConfig";
import { CopilotStep, walkthroughable } from "react-native-copilot";

const CopilotView = walkthroughable(View);

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "timer", selected: "timer.fill" }} />
        <Label>Feed</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="graph">
        <Icon sf={{ default: "chart.line.uptrend.xyaxis", selected: "chart.line.uptrend.xyaxis" }} />
        <Label>Graph</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="recipe">
        <Icon sf={{ default: "list.clipboard", selected: "list.clipboard.fill" }} />
        <Label>Recipe</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <Icon sf={{ default: "calendar", selected: "calendar.fill" }} />
        <Label>Calendar</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="about">
        <Icon sf={{ default: "info.circle", selected: "info.circle.fill" }} />
        <Label>About</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
            <Tabs.Screen
              name="index"
              options={{
                title: "Feed",
                tabBarIcon: ({ color }) => (
                  /* We add the style here for consistent sizing even though there is no tour step yet */
                  <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isIOS ? (
                      <SymbolView name="timer" tintColor={color} size={24} />
                    ) : (
                      <Feather name="clock" size={22} color={color} />
                    )}
                  </CopilotView>
                ),
              }}
            />
            <Tabs.Screen
              name="graph"
              options={{
                title: "Graph",
                tabBarIcon: ({ color }) => (
                  <CopilotStep
                    text="When finished, check your growth trends in the Analytics tab."
                    order={10}
                    name="next-chapter-is-graph"
                  >
                    <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      {isIOS ? (
                        <SymbolView name="chart.line.uptrend.xyaxis" tintColor={color} size={24} />
                      ) : (
                        <Feather name="activity" size={22} color={color} />
                      )}
                    </CopilotView>
                  </CopilotStep>
                ),
              }}
            />
            <Tabs.Screen
              name="recipe"
              options={{
                title: "Recipe",
                tabBarIcon: ({ color }) => (
                  <CopilotStep
                    text="Plan your next bake in the Recipes tab."
                    order={12}
                    name="next-chapter-is-recipe"
                  >
                    <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      {isIOS ? (
                        <SymbolView name="list.clipboard" tintColor={color} size={24} />
                      ) : (
                        <Feather name="book-open" size={22} color={color} />
                      )}
                    </CopilotView>
                  </CopilotStep>
                ),
              }}
            />
            <Tabs.Screen
              name="history"
              options={{
                title: "Calendar",
                tabBarIcon: ({ color }) => (
                  <CopilotStep
                    text="View your completed bakes in the Calendar."
                    order={16}
                    name="next-chapter-is-history"
                  >
                    <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      {isIOS ? (
                        <SymbolView name="calendar" tintColor={color} size={24} />
                      ) : (
                        <Feather name="calendar" size={22} color={color} />
                      )}
                    </CopilotView>
                  </CopilotStep>
                ),
              }}
            />
            <Tabs.Screen
              name="about"
              options={{
                title: "About",
                tabBarIcon: ({ color }) => (
                  <CopilotStep
                    text="Finally, learn more about the app in About."
                    order={21}
                    name="next-chapter-is-about"
                  >
                    <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      {isIOS ? (
                        <SymbolView name="info.circle" tintColor={color} size={24} />
                      ) : (
                        <Feather name="info" size={22} color={color} />
                      )}
                    </CopilotView>
                  </CopilotStep>
                ),
              }}
            />
    </Tabs>
  );
}

export default function TabLayout() {
  // 1. Determine which layout to show
  const content = isLiquidGlassAvailable() ? (
    <NativeTabLayout />
  ) : (
    <ClassicTabLayout />
  );

  // 2. Wrap it in the TourProvider so all tabs can see it
  return (
    <TourProvider chapters={TOUR_CHAPTERS}>
      {content}
    </TourProvider>
  );
}
