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
import { clearAllAppData, clearOperationalData, validateOperationalData, safeParse } from "@/lib/storageUtils";
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
  const [transitionPendingData, setTransitionPendingData] = useState<{
    token: string;
    user: AuthUser;
  } | null>(null);

  const reset = () => {
    setFirstName("");
    setStarterName("");
    setLoading(false);
    setMode("name");
    setTransitionPendingData(null);
  };

  const displayName = currentUser
    ? `${currentUser.firstName}'s ${currentUser.starterName}`
    : "";

  const checkHasAnonymousRecords = async (): Promise<boolean> => {
    try {
      const [recipesRaw, bakesRaw, historyRaw, activeBakeRaw, activeFeedRaw] = await Promise.all([
        AsyncStorage.getItem("bread_lab_recipes_v1").catch(() => "__ERROR__"),
        AsyncStorage.getItem("bread_lab_bake_history_v1").catch(() => "__ERROR__"),
        AsyncStorage.getItem("sourdough_feed_history_v1").catch(() => "__ERROR__"),
        AsyncStorage.getItem("bread_lab_bake_v2").catch(() => "__ERROR__"),
        AsyncStorage.getItem("sourdough_feed_session_v1").catch(() => "__ERROR__"),
      ]);

      if (recipesRaw === "__ERROR__" || bakesRaw === "__ERROR__" || historyRaw === "__ERROR__" || activeBakeRaw === "__ERROR__" || activeFeedRaw === "__ERROR__") {
        return true;
      }

      const hasAnon = (raw: string | null) => {
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw);
          const checkOwner = (item: any) => {
            if (!item || typeof item !== "object") return false;
            const owner = item.userId ?? item.user_id;
            return owner === "anonymous";
          };
          if (Array.isArray(parsed)) {
            return parsed.some(checkOwner);
          } else if (parsed && typeof parsed === "object") {
            return checkOwner(parsed);
          }
        } catch {
          return true;
        }
        return false;
      };

      return hasAnon(recipesRaw) || hasAnon(bakesRaw) || hasAnon(historyRaw) || hasAnon(activeBakeRaw) || hasAnon(activeFeedRaw);
    } catch {
      return true;
    }
  };

  const executeFailClosedRecovery = async (): Promise<{ remoteSignout: boolean; localClear: boolean }> => {
    let remoteSignout = false;
    let localClear = false;

    try {
      const res = await api.auth.signout();
      remoteSignout = !!res?.signedOut;
    } catch {
      remoteSignout = false;
    }

    try {
      await clearAuth();
      localClear = true;
    } catch {
      localClear = false;
    }

    // Only reset in-memory identity if local credentials were verified absent!
    if (localClear) {
      onAuthChange(null);
    }

    return { remoteSignout, localClear };
  };

  const handleChoiceImport = async () => {
    if (!transitionPendingData) return;
    setLoading(true);
    try {
      const { token, user } = transitionPendingData;
      await setMigrationPending();
      startMigration();
      const migrationResult = await migrateLocalDataToAccount(token);
      finishMigration(migrationResult);

      const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
      const totalUnresolved = migrationResult.feed.unresolved + migrationResult.bakes.unresolved + migrationResult.recipes.unresolved;
      if (totalFailed > 0 || totalUnresolved > 0) {
        throw new Error(`Import paused (${totalFailed} failure(s), ${totalUnresolved} unresolved). Local workspace retained with pre-sync state.`);
      }

      await clearOperationalData(token);
      await saveAuth(token, user);

      onAuthChange(user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
    } catch (err: any) {
      const recovery = await executeFailClosedRecovery();
      const statusDetails = [
        recovery.remoteSignout ? "Remote session terminated." : "Remote session termination unconfirmed.",
        recovery.localClear ? "Local credentials cleared." : "Local credentials removal failed/unverified."
      ].join(" ");
      const msg = `${err instanceof Error ? err.message : String(err)} (${statusDetails})`;
      if (Platform.OS === 'web') {
        window.alert(`Import Failed: ${msg}`);
      } else {
        Alert.alert("Import Failed", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceProceedWithoutImport = async () => {
    if (!transitionPendingData) return;
    setLoading(true);
    try {
      const { token, user } = transitionPendingData;
      await clearOperationalData(token);
      await saveAuth(token, user);

      onAuthChange(user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
    } catch (err: any) {
      const recovery = await executeFailClosedRecovery();
      const statusDetails = [
        recovery.remoteSignout ? "Remote session terminated." : "Remote session termination unconfirmed.",
        recovery.localClear ? "Local credentials cleared." : "Local credentials removal failed/unverified."
      ].join(" ");
      const msg = `${err instanceof Error ? err.message : String(err)} (${statusDetails})`;
      if (Platform.OS === 'web') {
        window.alert(`Purge/Setup Failed: ${msg}`);
      } else {
        Alert.alert("Purge/Setup Failed", msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceCancel = async () => {
    setLoading(true);
    try {
      const recovery = await executeFailClosedRecovery();
      if (!recovery.remoteSignout || !recovery.localClear) {
        const details = [
          !recovery.remoteSignout ? "Remote session termination unconfirmed." : "",
          !recovery.localClear ? "Local credential removal failed." : ""
        ].filter(Boolean).join(" ");
        const warningMsg = `Cancellation cleanup incomplete: ${details}. Please retry.`;
        if (Platform.OS === 'web') {
          window.alert(warningMsg);
        } else {
          Alert.alert("Cancellation Warning", warningMsg);
        }
        return;
      }
      setTransitionPendingData(null);
      reset();
    } finally {
      setLoading(false);
    }
  };

  const handleIdentify = async () => {
    if (!firstName.trim() || !starterName.trim()) {
      Alert.alert("Fill in both fields.");
      return;
    }
    setLoading(true);
    try {
      // 1. Verify active Supabase session (Account A) — fail closed on lookup errors
      let activeSession: any = null;
      try {
        const sessionResponse = await api.auth.getSession();
        activeSession = sessionResponse?.data?.session ?? null;
      } catch (err) {
        throw new Error(`Supabase session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const sessionUserId = activeSession?.user?.id ?? null;
      const storedToken = await getStoredToken();

      if (sessionUserId && storedToken && sessionUserId !== storedToken) {
        throw new Error("Identity consistency conflict: stored local user ID does not match active Supabase session.");
      }

      const currentToken = sessionUserId ?? storedToken;
      const savedAccountA = currentUser && currentToken ? { token: currentToken, user: currentUser } : null;

      if (currentToken) {
        // 2. Pre-sync local pending records to Account A before switching
        startMigration();
        const preMigrationResult = await migrateLocalDataToAccount(currentToken);
        finishMigration(preMigrationResult);

        const totalFailed = preMigrationResult.feed.failed + preMigrationResult.bakes.failed + preMigrationResult.recipes.failed;
        const totalUnresolved = preMigrationResult.feed.unresolved + preMigrationResult.bakes.unresolved + preMigrationResult.recipes.unresolved;
        if (totalFailed > 0 || totalUnresolved > 0) {
          throw new Error(`Account transition paused: ${totalUnresolved > 0 ? `${totalUnresolved} unresolved local record(s) detected.` : `${totalFailed} sync failure(s).`} Local workspace retained with pre-sync state.`);
        }
      }

      // 3. Non-mutating pre-validation pass before authenticating B
      await validateOperationalData(currentToken);

      // 4. Authenticate Account B FIRST before clearing operational data
      const isSignUp = mode === "name";
      const result = await api.auth.identify({
        firstName: firstName.trim(),
        starterName: starterName.trim(),
        isSignUp,
      });

      // 5. Switching from Account A -> Account B
      if (currentToken && savedAccountA) {
        let wipeSuccess = false;
        try {
          await clearOperationalData(currentToken);
          wipeSuccess = true;
        } catch (wipeErr) {
          console.error("Local operational wipe failed during account switch", wipeErr);
          const recovery = await executeFailClosedRecovery();
          const statusDetails = [
            recovery.remoteSignout ? "Remote session terminated." : "Remote session termination unconfirmed.",
            recovery.localClear ? "Local credentials cleared." : "Local credentials removal failed/unverified."
          ].join(" ");
          throw new Error(`Local workspace clear failed. ${statusDetails} Session reset for safety.`);
        }

        if (wipeSuccess) {
          try {
            await saveAuth(result.token, result.user);
          } catch (saveErr) {
            console.error("Credential persistence failed after local wipe", saveErr);
            const recovery = await executeFailClosedRecovery();
            const statusDetails = [
              recovery.remoteSignout ? "Remote session terminated." : "Remote session termination unconfirmed.",
              recovery.localClear ? "Local credentials cleared." : "Local credentials removal failed/unverified."
            ].join(" ");
            throw new Error(`Credential persistence failed. ${statusDetails} Workspace reset to unauthenticated.`);
          }
          onAuthChange(result.user);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          reset();
          onClose();
          return;
        }
      }

      // 5. Switching from Anonymous -> Account B
      if (!currentToken) {
        const hasAnonRecords = await checkHasAnonymousRecords();
        if (hasAnonRecords) {
          // Present Transition Choice Modal
          setTransitionPendingData({ token: result.token, user: result.user });
          return;
        } else {
          try {
            // No anonymous local records to migrate, verify migration result
            const migrationResult = await migrateLocalDataToAccount(result.token);
            const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
            const totalUnresolved = migrationResult.feed.unresolved + migrationResult.bakes.unresolved + migrationResult.recipes.unresolved;

            if (totalFailed > 0 || totalUnresolved > 0) {
              throw new Error(`Account transition paused: ${totalUnresolved > 0 ? `${totalUnresolved} unresolved local record(s) detected.` : `${totalFailed} sync failure(s).`} Local workspace retained with pre-sync state.`);
            }

            await clearOperationalData(result.token);
            await saveAuth(result.token, result.user);
            onAuthChange(result.user);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            reset();
            onClose();
            return;
          } catch (anonErr) {
            const recovery = await executeFailClosedRecovery();
            const statusDetails = [
              recovery.remoteSignout ? "Remote session terminated." : "Remote session termination unconfirmed.",
              recovery.localClear ? "Local credentials cleared." : "Local credentials removal failed/unverified."
            ].join(" ");
            throw new Error(`Anonymous transition failed: ${anonErr instanceof Error ? anonErr.message : String(anonErr)}. ${statusDetails}`);
          }
        }
      }

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
        let activeSession: any = null;
        try {
          const sessionResponse = await api.auth.getSession();
          activeSession = sessionResponse?.data?.session ?? null;
        } catch (err) {
          throw new Error(`Supabase session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const sessionUserId = activeSession?.user?.id ?? null;
        const currentToken = sessionUserId ?? await getStoredToken();

        if (currentToken) {
          const migrationResult = await migrateLocalDataToAccount(currentToken);
          const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
          const totalUnresolved = migrationResult.feed.unresolved + migrationResult.bakes.unresolved + migrationResult.recipes.unresolved;
          if (totalFailed > 0 || totalUnresolved > 0) {
            throw new Error(`Cannot sign out: local data sync incomplete (${totalUnresolved} unresolved record(s), ${totalFailed} failure(s)). Please check your connection.`);
          }
        }

        const signoutRes = await api.auth.signout();
        if (!signoutRes.signedOut) {
          throw new Error("Failed to sign out from cloud session.");
        }
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

          {transitionPendingData ? (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.cardName, { color: colors.foreground, marginBottom: 8 }]}>
                Offline Workspace Found
              </Text>
              <Text style={[s.cardInfo, { color: colors.mutedForeground, marginBottom: 12 }]}>
                You have local recipes or bakes created offline on this device. Choose how you would like to proceed with {transitionPendingData.user.firstName}&apos;s account:
              </Text>
              <Text style={[s.cardInfo, { color: colors.mutedForeground, marginBottom: 20, fontStyle: "italic" }]}>
                Your anonymous recipes and data will be discarded and won’t be available in your account or on this device in the future.
              </Text>

              <View style={{ gap: 12 }}>
                <Pressable
                  onPress={handleChoiceImport}
                  disabled={loading}
                  style={[s.primaryButton, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={s.primaryButtonText}>Import & Proceed</Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleChoiceProceedWithoutImport}
                  disabled={loading}
                  style={[s.outlineButton, { borderColor: colors.border }]}
                >
                  <Text style={[s.outlineButtonText, { color: colors.foreground, marginLeft: 0 }]}>
                    Proceed Without Importing
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleChoiceCancel}
                  disabled={loading}
                  style={{ alignItems: "center", paddingVertical: 10 }}
                >
                  <Text style={{ color: colors.mutedForeground, fontSize: 14, fontWeight: "600" }}>
                    Cancel Transition
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : currentUser ? (
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
                    New Account
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
                    Find Existing
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
    borderRadius: radius.lg,
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
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
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
