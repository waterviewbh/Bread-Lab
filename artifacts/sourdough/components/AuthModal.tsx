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
import { saveAuth, getStoredToken, clearAuth, type AuthUser } from "@/lib/auth";
import { getDeviceId } from "@/lib/deviceId";
import { migrateLocalDataToAccount, setMigrationPending } from "@/lib/migrate";
import { useMigrationToast } from "@/contexts/MigrationToastContext";
import { fonts, spacing, radius, typography } from "@/constants/theme";


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
      // 1. If an account (Account A) is already authenticated, switch securely
      const currentToken = await getStoredToken();
      if (currentToken) {
        startMigration();
        const preMigrationResult = await migrateLocalDataToAccount(currentToken);
        finishMigration(preMigrationResult);

        const totalFailed = preMigrationResult.feed.failed + preMigrationResult.bakes.failed + preMigrationResult.recipes.failed;
        if (totalFailed > 0) {
          throw new Error("Local data preservation under current account failed. Switch aborted to protect your data.");
        }

        await api.auth.signout();
        await clearAuth();
      }

      // 2. Authenticate Account B (destination account)
      const result = await api.auth.identify({
        firstName: firstName.trim(),
        starterName: starterName.trim(),
      });
      await saveAuth(result.token, result.user);
      onAuthChange(result.user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();

      // 3. Migrate local data to Account B
      await setMigrationPending();
      startMigration();
      const migrationResult = await migrateLocalDataToAccount(result.token);
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
        })
        .catch(() => {});
    } catch (error) {
      console.error("Auth Identification/Switch Technical Diagnostics:", error);
      const errMessage = error instanceof Error ? error.message : String(error);

      let userFriendlyTitle = "Switch Failed";
      let userFriendlyMessage = errMessage;

      if (errMessage.includes("preservation failed") || errMessage.includes("Local data preservation")) {
        userFriendlyTitle = "Migration Blocked";
        userFriendlyMessage = errMessage;
      } else if (errMessage.includes("recovery failed") || errMessage.includes("User already registered") || errMessage.includes("already registered")) {
        userFriendlyTitle = "Account Conflict";
        userFriendlyMessage = "This starter name is registered, but the recovery key didn't match. Double-check your spelling or capitalization.";
      } else if (errMessage.includes("Email address") && errMessage.includes("invalid")) {
        userFriendlyTitle = "Invalid Input";
        userFriendlyMessage = "Please enter valid first and starter names.";
      } else if (errMessage.includes("invalid login") || errMessage.includes("invalid credentials")) {
        userFriendlyTitle = "Incorrect Key";
        userFriendlyMessage = "This starter name is registered, but the recovery key didn't match. Double-check your spelling or capitalization.";
      } else if (errMessage.includes("network") || errMessage.includes("fetch") || errMessage.includes("connection")) {
        userFriendlyTitle = "Connection Error";
        userFriendlyMessage = "Unable to reach the cloud. Please check your internet connection and try again.";
      } else if (__DEV__) {
        userFriendlyMessage = `Error: ${errMessage}`;
      }

      if (Platform.OS === 'web') {
        window.alert(`${userFriendlyTitle}: ${userFriendlyMessage}`);
      } else {
        Alert.alert(userFriendlyTitle, userFriendlyMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClearIdentity = async () => {
    const performClear = async () => {
      try {
        const currentToken = await getStoredToken();
        if (currentToken) {
          const migrationResult = await migrateLocalDataToAccount(currentToken);
          const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
          if (totalFailed > 0) {
            throw new Error("Cannot sign out: local data sync incomplete. Please check your connection.");
          }
        }

        await api.auth.signout();
        await clearAuth();
        onAuthChange(null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onClose();
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        if (Platform.OS === 'web') {
          window.alert(`Sign-out failed: ${errMessage}`);
        } else {
          Alert.alert("Sign-out failed", errMessage);
        }
      }
    };

    // WEB FIX: Use window.confirm if on web, otherwise use native Alert
    if (Platform.OS === "web") {
      if (window.confirm("Sign out? Your operational records are preserved locally and synced to the cloud.")) {
        await performClear();
      }
      return;
    }

    // Original Mobile Alert logic
    Alert.alert(
      "Sign out?",
      "Your operational records are preserved locally and synced to the cloud.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: performClear,
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
                {currentUser ? "Starter Account" : "Identify Starter"}
              </Text>
              <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
                {currentUser
                  ? "Manage identity and cloud sync"
                  : "Connect your baking data to the cloud"}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[s.closeButton, { backgroundColor: colors.card }]}
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          {currentUser ? (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.cardHeader}>
                <View style={[s.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={s.avatarText}>{currentUser.firstName.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardName, { color: colors.foreground }]}>{displayName}</Text>
                  <Text style={[s.cardSub, { color: colors.mutedForeground }]}>Active cloud identity</Text>
                </View>
                <View style={[s.badge, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[s.badgeText, { color: colors.primary }]}>Synced</Text>
                </View>
              </View>

              <Text style={[s.cardInfo, { color: colors.mutedForeground }]}>
                Your recipes, bakes, and feed sessions are securely linked to this name. You can sign out or switch starters anytime.
              </Text>

              <Pressable
                onPress={handleClearIdentity}
                style={[s.outlineButton, { borderColor: colors.border }]}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.destructive || "#EF4444"} />
                <Text style={[s.outlineButtonText, { color: colors.destructive || "#EF4444" }]}>
                  Sign Out / Remove Name
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.modeTabs}>
                <Pressable
                  onPress={() => setMode("name")}
                  style={[
                    s.modeTab,
                    mode === "name" && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
                  ]}
                >
                  <Text style={[s.modeTabText, { color: mode === "name" ? colors.foreground : colors.mutedForeground }]}>
                    New / Existing
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMode("find")}
                  style={[
                    s.modeTab,
                    mode === "find" && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
                  ]}
                >
                  <Text style={[s.modeTabText, { color: mode === "find" ? colors.foreground : colors.mutedForeground }]}>
                    Find Name
                  </Text>
                </Pressable>
              </View>

              <View style={s.form}>
                <View style={s.field}>
                  <Text style={[s.label, { color: colors.foreground }]}>Your First Name</Text>
                  <TextInput
                    style={[s.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="e.g. Jane"
                    placeholderTextColor={colors.mutedForeground}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </View>

                <View style={s.field}>
                  <Text style={[s.label, { color: colors.foreground }]}>Starter Name</Text>
                  <TextInput
                    style={[s.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                    placeholder="e.g. DoughtheVoodoo"
                    placeholderTextColor={colors.mutedForeground}
                    value={starterName}
                    onChangeText={setStarterName}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                </View>

                <Pressable
                  onPress={handleIdentify}
                  disabled={loading}
                  style={[s.primaryButton, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={s.primaryButtonText}>
                      {mode === "find" ? "Recover Starter" : "Connect & Sync"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  cardName: {
    fontSize: 18,
    fontWeight: "600",
  },
  cardSub: {
    fontSize: 13,
    marginTop: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  cardInfo: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  outlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 8,
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: radius.md,
    padding: 3,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: radius.sm,
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: "600",
  },
  form: {
    gap: 16,
  },
  field: {
    gap: 6,
  },
  dataPreservationency: {
    // metadata or marker
  },
  label: {
    fontSize: 14,
    net_session: true,
    fontWeight: "600",
  } as any,
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  primaryButton: {
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
