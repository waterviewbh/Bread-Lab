import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface Props {
  onNameMyData: () => void;
  onDismiss: () => void;
}

export default function NudgeBanner({ onNameMyData, onDismiss }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabBarPad = Platform.OS === "web" ? 84 : 49;

  return (
    <Animated.View
      entering={FadeInDown.duration(380).springify()}
      exiting={FadeOutDown.duration(260)}
      style={[
        s.container,
        {
          backgroundColor: colors.primary,
          bottom: insets.bottom + tabBarPad + 10,
          shadowColor: colors.primary,
        },
      ]}
    >
      <View style={s.inner}>
        <Ionicons
          name="sync-outline"
          size={16}
          color={colors.primaryForeground}
          style={{ marginTop: 1, flexShrink: 0 }}
        />
        <Text style={[s.message, { color: colors.primaryForeground }]}>
          Your data is syncing — add a name to access it from another device.
        </Text>
      </View>
      <View style={s.actions}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onNameMyData();
          }}
          style={({ pressed }) => [
            s.nameBtn,
            { backgroundColor: colors.primaryForeground + "22", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[s.nameBtnText, { color: colors.primaryForeground }]}>
            Name my data
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDismiss();
          }}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 2 })}
        >
          <Ionicons name="close" size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  inner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nameBtn: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  nameBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
