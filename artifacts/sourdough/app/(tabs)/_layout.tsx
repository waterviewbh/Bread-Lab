import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { TourSlideshowProvider } from "@/contexts/TourSlideshowContext";
import { TourSlideshow } from "@/components/TourSlideshow";
import { TourStep, CopilotView } from "@/components/TourStep";

// const CopilotView = walkthroughable(View); red-tagged for web-0.1 rmv after 3 revs

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
                  // Sizing wrapper only — tour transition anchor lives at bottom of Graph screen
                  <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isIOS ? (
                      <SymbolView name="chart.line.uptrend.xyaxis" tintColor={color} size={24} />
                    ) : (
                      <Feather name="activity" size={22} color={color} />
                    )}
                  </CopilotView>
                ),
              }}
            />
            <Tabs.Screen
              name="recipe"
              options={{
                title: "Recipe",
                tabBarIcon: ({ color }) => (
                  // Sizing wrapper only — tour transition anchor lives at bottom of Recipe screen
                  <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isIOS ? (
                      <SymbolView name="list.clipboard" tintColor={color} size={24} />
                    ) : (
                      <Feather name="book-open" size={22} color={color} />
                    )}
                  </CopilotView>
                ),              }}
            />
            <Tabs.Screen
              name="history"
              options={{
                title: "Calendar",
                tabBarIcon: ({ color }) => (
                  // Sizing wrapper only — tour transition anchor lives at bottom of Calendar screen
                  <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isIOS ? (
                      <SymbolView name="calendar" tintColor={color} size={24} />
                    ) : (
                      <Feather name="calendar" size={22} color={color} />
                    )}
                  </CopilotView>
                ),
              }}
            />
            <Tabs.Screen
              name="about"
              options={{
                title: "About",
                tabBarIcon: ({ color }) => (
                  // Sizing wrapper only — tour transition anchor lives at bottom of About screen
                  <CopilotView style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    {isIOS ? (
                      <SymbolView name="info.circle" tintColor={color} size={24} />
                    ) : (
                      <Feather name="info" size={22} color={color} />
                    )}
                  </CopilotView>
                ),
              }}
            />
    </Tabs>
  );
}

export default function TabLayout() {
  // 1. Determine which layout to show
  /*const content = isLiquidGlassAvailable() ? (
  () ? (
    <NativeTabLayout />
  ) : (
    <ClassicTabLayout />
  );
*/
  const content = <ClassicTabLayout />
  // 2. Wrap in the slideshow provider so all tabs can trigger the tour.
  //    TourSlideshow renders as a Modal — it overlays everything when visible.
  return (
    <TourSlideshowProvider>
      {content}
      <TourSlideshow />
    </TourSlideshowProvider>
  );
}