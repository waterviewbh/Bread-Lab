import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api";
import { saveAuth, clearAuth, type AuthUser } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { migrateLocalDataToAccount, setMigrationPending, clearMigrationPending } from "@/lib/migrate";
import { useMigrationToast } from "@/contexts/MigrationToastContext";
import { fonts, spacing, radius, typography } from "@/constants/theme";

const HISTORY_KEY = "sourdough_feed_history_v1";
const BAKE_HISTORY_KEY = "bread_lab_bake_history_v1";
const RECIPES_KEY = "bread_lab_recipes_v1";

interface Props {
  visible: boolean;
  currentUser: AuthUser | null;
  onClose: () => void;
  onAuthChange: (user: AuthUser | null) => void;
}

export default function AuthModal({ visible, currentUser, onClose, onAuthChange }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const { startMigration, finishMigration } = useMigrationToast();

  const [mode, setMode] = useState<"name" | "find">("name");
  const [firstName, setFirstName] = useState("");
  const [starterName, setStarterName] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setFirstName("");
    setStarterName("");
    setLoading(false);
    setMode("name");
  };

  const displayName = currentUser
    ? `${currentUser.firstName}'s ${currentUser.starterName}`
    : "";

  const handleIdentify = async () => {
    if (!firstName.trim() || !starterName.trim()) {
      Alert.alert("Fill in both fields.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.auth.identify({
        firstName: firstName.trim(),
        starterName: starterName.trim(),
      });
      await saveAuth(result.token, result.user);
      onAuthChange(result.user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
      await setMigrationPending();
      startMigration();
      const migrationResult = await migrateLocalDataToAccount(result.token).catch(() => null);
      finishMigration(migrationResult);
      await getDeviceId()
        .then(async (deviceId) => {
          let linked = false;
          for (let attempt = 0; attempt < 3 && !linked; attempt++) {
            try {
              await api.auth.linkDevice(deviceId, result.token);
              linked = true;
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
            }
          }
          // Suppress the "Sync Notice" Alert — the migration toast already
          // communicates any sync failure to the user, and showing both
          // simultaneously causes conflicting messages.
        })
        .catch(() => {});
    } catch (error) {
      console.error("Auth Identification Error:", error);
      if (Platform.OS === 'web') {
        // window.alert is reliable for debugging on web
        window.alert("Auth Error: " + (error instanceof Error ? error.message : "Check console"));
      } else {
        Alert.alert("Something went wrong", "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClearIdentity = async () => {

  const performClear = async () => {
    await api.auth.signout().catch(() => {});
    await clearAuth();
    await clearMigrationPending().catch(() => {});
    await AsyncStorage.multiRemove([HISTORY_KEY, BAKE_HISTORY_KEY, RECIPES_KEY]).catch(() => {});
    onAuthChange(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
  };

  // WEB FIX: Use window.confirm if on web, otherwise use native Alert
  if (Platform.OS === "web") {
    if (window.confirm("Remove name? Your data stays synced to the server. You can re-enter your name any time to reconnect.")) {
      await performClear();
    }
    return;
  }

  // Original Mobile Alert logic
    Alert.alert(
      "Remove name?",
      "Your data stays synced to the server. You can re-enter your name any time to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await api.auth.signout().catch(() => {});
            await clearAuth();
            await clearMigrationPending().catch(() => {});
            await AsyncStorage.multiRemove([HISTORY_KEY, BAKE_HISTORY_KEY, RECIPES_KEY]).catch(() => {});
            onAuthChange(null);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onClose();
          },
        },
      ]
    );
  };

  const isFind = mode === "find";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <ScrollView
          contentContainerStyle={[
            s.content,
            { paddingTop: insets.top + webTop + 28, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: colors.foreground }]}>
                {currentUser ? displayName : isFind ? "Find your data" : "Name your data"}
              </Text>
              <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
                {currentUser
                  ? "Your data syncs automatically across devices."
                  : isFind
                  ? "Enter your first name and starter name to reconnect to your existing data."
                  : "Your data already syncs automatically. Adding a name lets you access it on another device or after reinstalling."}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {currentUser ? (
            <View style={[s.identityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[s.avatarCircle, { backgroundColor: colors.primary }]}>
                <Text style={[s.avatarInitial, { color: colors.primaryForeground }]}>
                  {currentUser.firstName?.[0]?.toUpperCase() ?? "?"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.identityName, { color: colors.foreground }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[s.identityLabel, { color: colors.mutedForeground }]}>
                  Data named · syncing automatically
                </Text>
              </View>
              <Pressable
                onPress={handleClearIdentity}
                style={({ pressed }) => [s.clearBtn, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[s.clearBtnText, { color: colors.mutedForeground }]}>Track different starter</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[s.label, { color: colors.mutedForeground }]}>First name</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Jerry"
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoComplete="given-name"
                returnKeyType="next"
              />

              <Text style={[s.label, { color: colors.mutedForeground, marginTop: 16 }]}>Starter name</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Dough for Justice"
                placeholderTextColor={colors.mutedForeground}
                value={starterName}
                onChangeText={setStarterName}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleIdentify}
              />

              <Pressable
                onPress={handleIdentify}
                disabled={loading}
                style={({ pressed }) => [
                  s.submitBtn,
                  { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1, marginTop: 24 },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[s.submitText, { color: colors.primaryForeground }]}>
                    {isFind ? "Find my data" : "Save"}
                  </Text>
                )}
              </Pressable>

              <View style={[s.divider, { borderTopColor: colors.border }]} />

              <Pressable
                onPress={() => {
                  setMode(isFind ? "name" : "find");
                  setFirstName("");
                  setStarterName("");
                  Haptics.selectionAsync();
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignItems: "center" })}
              >
                <Text style={[s.switchLink, { color: colors.primary }]}>
                  {isFind ? "← Name my data instead" : "Already named? Find my data →"}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,             // 24
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: spacing.lg + 4,              // 28 — matches original
  },
  title: {
    ...typography.headlineLgMobile,            // LibreCaslonText_700Bold, 28px — modal headline in serif
    letterSpacing: -0.5,
    marginBottom: spacing.xs,                  // 4
  },
  subtitle: {
    fontFamily: fonts.sans,                    // HankenGrotesk_400Regular
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily: fonts.sansMedium,              // HankenGrotesk_500Medium
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: radius.lg,                   // 12
    fontFamily: fonts.sans,                    // HankenGrotesk_400Regular
  },
  submitBtn: {
    height: 52,
    borderRadius: radius.lg,                   // 12
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontFamily: fonts.sansSemiBold,            // HankenGrotesk_600SemiBold — primary action
    fontSize: 16,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: spacing.md + 4,            // 20 — matches original
  },
  switchLink: {
    fontFamily: fonts.sansMedium,              // HankenGrotesk_500Medium
    fontSize: 13,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,                       // 16
    borderRadius: radius.lg,                   // 12
    borderWidth: 1,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontFamily: fonts.serifBold,               // LibreCaslonText_700Bold — initial letter in serif feels artisanal
    fontSize: 18,
  },
  identityName: {
    fontFamily: fonts.sansMedium,              // HankenGrotesk_500Medium
    fontSize: 15,
  },
  identityLabel: {
    ...typography.metaLabel,                   // HankenGrotesk_400Regular, 12px
    marginTop: 2,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,                   // 8
    borderWidth: 1,
  },
  clearBtnText: {
    fontFamily: fonts.sans,                    // HankenGrotesk_400Regular
    fontSize: 13,
  },
});