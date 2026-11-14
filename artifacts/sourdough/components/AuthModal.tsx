import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
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
import { getStoredToken, getStoredUser, type AuthUser } from "@/lib/auth";
import { clearAllAppData, clearOperationalData, safeParse } from "@/lib/storageUtils";
import { executeWorkspaceTransition, recoverTransition, ActiveFeedNotAcknowledgedError, getCoordinatorState } from "@/lib/transitionCoordinator";
import { getDeviceId } from "@/lib/deviceId";
import { migrateLocalDataToAccount } from "@/lib/migrate";
import { confirmActiveFeedTransition, NLA_LOCAL_WORK_TITLE, NLA_LOCAL_WORK_PARAGRAPHS } from "@/lib/activeWork";
import {
  inventoryNlaWorkspace,
  buildPurgePlan,
  authorizeDiscardPlan,
  authorizeNlaTransitionIntent,
  summarizeInventory,
  describeInventory,
  type NlaInventory,
} from "@/lib/nlaWorkspace";
import {
  importNlaWorkspace,
  describeImportReport,
  reportToMigrationResult,
  ImportNotVerifiedError,
  IMPORT_STILL_OFFLINE_SENTENCE,
  type ImportReport,
} from "@/lib/nlaImport";
import { closeOrphanRemoteSession } from "@/lib/remoteSessionGuard";
import { useMigrationToast } from "@/contexts/MigrationToastContext";
import { fonts, spacing, radius, typography } from "@/constants/theme";


interface Props {
  visible: boolean;
  currentUser: AuthUser | null;
  onClose: () => void;
  onAuthChange: (user: AuthUser | null) => void;
  initialTransitionData?: { token: string; user: AuthUser } | null;
}

export async function executeFailClosedRecovery(
  onAuthChangeFn: (user: AuthUser | null) => void = () => {}
): Promise<{ remoteSignout: boolean; localClear: boolean }> {
  console.log(`[BL-DIAG] [AuthModal] executeFailClosedRecovery delegating to coordinator recovery...`);
  const recovery = await recoverTransition();

  if (recovery.remoteSignout && recovery.localClear) {
    onAuthChangeFn(null);
  }

  return recovery;
}

export default function AuthModal({ visible, currentUser, onClose, onAuthChange, initialTransitionData }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webTop = Platform.OS === "web" ? 67 : 0;
  const { startMigration, finishMigration } = useMigrationToast();

  const [mode, setMode] = useState<"name" | "find">("name");
  const [firstName, setFirstName] = useState("");
  const [starterName, setStarterName] = useState("");
  const [loading, setLoading] = useState(false);
  // What is on this device in the offline (NLA) workspace, shown on the choice screen.
  const [nlaInventory, setNlaInventory] = useState<NlaInventory | null>(null);
  const [choiceMessage, setChoiceMessage] = useState<string | null>(null);
  const [recoveryIncomplete, setRecoveryIncomplete] = useState(false);
  const recoveryIncompleteRef = useRef(false);
  const markRecoveryIncomplete = (incomplete: boolean) => {
    recoveryIncompleteRef.current = incomplete;
    setRecoveryIncomplete(incomplete);
  };
  const [transitionPendingData, setTransitionPendingData] = useState<{
    firstName: string;
    starterName: string;
    isSignUp: boolean;
    token?: string;
    user?: AuthUser;
  } | null>(initialTransitionData ? { firstName: initialTransitionData.user.firstName, starterName: initialTransitionData.user.starterName, isSignUp: false, token: initialTransitionData.token, user: initialTransitionData.user } : null);

  const activeFeedAckRef = useRef(false);
  const ensureActiveFeedAck = async (): Promise<boolean> => {
    if (activeFeedAckRef.current) return true;
    const ok = await confirmActiveFeedTransition();
    if (ok) activeFeedAckRef.current = true;
    return ok;
  };
  useEffect(() => {
    if (!visible) activeFeedAckRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (transitionPendingData && !nlaInventory) {
      inventoryNlaWorkspace().then(setNlaInventory).catch(() => {});
    }
  }, [transitionPendingData, nlaInventory]);

  const reset = () => {
    activeFeedAckRef.current = false;
    setFirstName("");
    setStarterName("");
    setLoading(false);
    setMode("name");
    setTransitionPendingData(null);
    setNlaInventory(null);
    setChoiceMessage(null);
    markRecoveryIncomplete(false);
  };

  const refreshInventory = async () => {
    try {
      setNlaInventory(await inventoryNlaWorkspace());
    } catch {
      /* retry */
    }
  };

  const displayName = currentUser
    ? `${currentUser.firstName}'s ${currentUser.starterName}`
    : "";

  const failChoice = async (title: string, err: unknown): Promise<boolean> => {
    let detail = err instanceof Error ? err.message : String(err);
    if (getCoordinatorState() === "IDLE") {
      if (Platform.OS === "web") window.alert(`${title}: ${detail}`);
      else Alert.alert(title, detail);
      await refreshInventory();
      setChoiceMessage(detail);
      return false;
    }
    const recovery = await executeFailClosedRecovery(onAuthChange);
    const closed = recovery.remoteSignout && recovery.localClear;
    if (!closed) detail = detail.replace(IMPORT_STILL_OFFLINE_SENTENCE, "").replace(/\s{2,}/g, " ").trim();
    const statusDetails = [
      recovery.remoteSignout ? "Your account session was closed." : "Closing your account session could not be confirmed.",
      recovery.localClear ? (closed ? "You are still in your offline workspace." : "") : "Local sign-in cleanup could not be verified.",
      closed ? "" : "Your account status is uncertain, so the earlier choices no longer apply. Choose Cancel Transition to try closing it again.",
    ].filter(Boolean).join(" ");
    const msg = `${detail} ${statusDetails}`;
    if (Platform.OS === "web") {
      window.alert(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
    if (closed) {
      setTransitionPendingData(null);
      setNlaInventory(null);
    } else {
      markRecoveryIncomplete(true);
      await refreshInventory();
      setChoiceMessage(msg);
    }
    return closed;
  };

  const noteLeftovers = (note: string, leftovers: boolean) => {
    if (!leftovers) return;
    if (Platform.OS === "web") window.alert(note);
    else Alert.alert("Some items stayed on this device", note);
  };

  const handleChoiceImport = async () => {
    if (!transitionPendingData || recoveryIncompleteRef.current) return;
    const inventory = nlaInventory;
    if (!inventory || !inventory.readable) {
      await refreshInventory();
      setChoiceMessage("Please review what is on this device, then choose again.");
      return;
    }
    setLoading(true);
    setChoiceMessage(null);
    const reportRef: { current: ImportReport | null } = { current: null };
    let destinationUser: AuthUser | null = transitionPendingData.user ?? null;
    try {
      const intent = authorizeNlaTransitionIntent("import", inventory.raw);
      await executeWorkspaceTransition(null, null, null, null, {
        activeFeedAcknowledged: true,
        nlaTransitionIntent: intent,
        prepareIncoming: async () => {
          let token = transitionPendingData.token;
          let user = transitionPendingData.user;
          if (!token || !user) {
            const result = await api.auth.identify({
              firstName: transitionPendingData.firstName,
              starterName: transitionPendingData.starterName,
              isSignUp: transitionPendingData.isSignUp,
            });
            token = result.token;
            user = result.user;
          }
          destinationUser = user;

          startMigration();
          const outcome = await importNlaWorkspace(token, { storageMutexHeld: true });
          reportRef.current = outcome.report;
          finishMigration(reportToMigrationResult(outcome.report));
          setNlaInventory(outcome.inventory);
          if (!outcome.report.ok || !outcome.purgePlan) {
            throw new ImportNotVerifiedError(describeImportReport(outcome.report));
          }
          return {
            ownerId: token,
            token,
            user,
            nlaDisposition: { mode: "import", plan: outcome.purgePlan, snapshotRaw: outcome.inventory.raw },
          };
        },
      });

      const completedReport = reportRef.current;
      if (!completedReport) throw new Error("Import did not return a verified result.");
      if (!destinationUser) throw new Error("Destination identity was not prepared.");
      onAuthChange(destinationUser);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
      noteLeftovers(describeImportReport(completedReport), completedReport.cannotImport.length + completedReport.unresolved.length + completedReport.draftsRenamed.length > 0);
    } catch (err: any) {
      await failChoice("Import didn't complete", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceProceedWithoutImport = async () => {
    if (!transitionPendingData || recoveryIncompleteRef.current) return;
    const inventory = nlaInventory;
    if (!inventory) {
      await refreshInventory();
      setChoiceMessage("Please review what is on this device, then choose again.");
      return;
    }
    if (!inventory.readable) {
      setChoiceMessage("Some data on this device could not be read, so nothing was changed.");
      return;
    }
    setLoading(true);
    setChoiceMessage(null);
    let destinationUser: AuthUser | null = transitionPendingData.user ?? null;
    try {
      const intent = authorizeNlaTransitionIntent("discard", inventory.raw);
      await executeWorkspaceTransition(null, null, null, null, {
        activeFeedAcknowledged: true,
        nlaTransitionIntent: intent,
        prepareIncoming: async () => {
          let token = transitionPendingData.token;
          let user = transitionPendingData.user;
          if (!token || !user) {
            const result = await api.auth.identify({
              firstName: transitionPendingData.firstName,
              starterName: transitionPendingData.starterName,
              isSignUp: transitionPendingData.isSignUp,
            });
            token = result.token;
            user = result.user;
          }
          destinationUser = user;
          const plan = authorizeDiscardPlan(buildPurgePlan(inventory, "discard"));
          return {
            ownerId: token,
            token,
            user,
            nlaDisposition: { mode: "discard", plan, snapshotRaw: inventory.raw },
          };
        },
      });

      const left = inventory.unresolved.length;
      if (!destinationUser) throw new Error("Destination identity was not prepared.");
      onAuthChange(destinationUser);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
      noteLeftovers(describeInventory(summarizeInventory(inventory)), left > 0);
    } catch (err: any) {
      await failChoice("Couldn't continue", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceCancel = async () => {
    setLoading(true);
    try {
      if (recoveryIncompleteRef.current) {
        const recovery = await executeFailClosedRecovery(onAuthChange);
        if (recovery.remoteSignout && recovery.localClear) {
          reset();
          return;
        }
        const message = [
          recovery.remoteSignout ? "Your account session was closed." : "Closing your account session could not be confirmed.",
          recovery.localClear ? "" : "Local sign-in cleanup could not be verified.",
          "Your account status is uncertain. Keep this screen open and try Cancel Transition again.",
        ].filter(Boolean).join(" ");
        await refreshInventory();
        setChoiceMessage(message);
        if (Platform.OS === "web") window.alert(`Transition recovery incomplete: ${message}`);
        else Alert.alert("Transition recovery incomplete", message);
        return;
      }

      // Cancel leaves baker in NLA and performs no destination authentication.
      setTransitionPendingData(null);
      reset();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleRequestClose = () => {
    if (recoveryIncompleteRef.current) {
      const message = "Finish transition recovery with Cancel Transition before closing this screen.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Transition recovery required", message);
      return;
    }
    onClose();
  };

  const handleIdentify = async () => {
    if (!firstName.trim() || !starterName.trim()) {
      Alert.alert("Fill in both fields.");
      return;
    }
    setLoading(true);
    try {
      let activeSession: any = null;
      try {
        const sessionResponse = await api.auth.getSession();
        activeSession = sessionResponse?.data?.session ?? null;
      } catch (err) {
        throw new Error(`Supabase session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      let sessionUserId = activeSession?.user?.id ?? null;
      let hasOrphanRemoteSession = false;
      const storedToken = await getStoredToken();

      if (sessionUserId && storedToken && sessionUserId !== storedToken) {
        throw new Error("Identity consistency conflict: stored local user ID does not match active Supabase session.");
      }

      if (sessionUserId && !storedToken) {
        hasOrphanRemoteSession = true;
        sessionUserId = null;
      }

      const currentToken = sessionUserId ?? storedToken;

      if (currentToken) {
        throw new Error("Already signed in. Please sign out (return to offline workspace) before signing in to another account.");
      }

      // NLA -> Authenticated: Inventory NLA data and present choice screen BEFORE destination authentication.
      const inventory = await inventoryNlaWorkspace();
      if (!inventory.readable) {
        throw new Error("Some data on this device could not be read, so no identity change can proceed.");
      }
      if (hasOrphanRemoteSession) await closeOrphanRemoteSession();
      setNlaInventory(inventory);
      setChoiceMessage(null);
      setTransitionPendingData({
        firstName: firstName.trim(),
        starterName: starterName.trim(),
        isSignUp: mode === "name",
      });
    } catch (error) {
      console.error("Auth Identification Technical Diagnostics:", error);
      const errMessage = error instanceof Error ? error.message : String(error);
      if (Platform.OS === 'web') {
        window.alert(`Identification Failed: ${errMessage}`);
      } else {
        Alert.alert("Identification Failed", errMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClearIdentity = async () => {
    const performClear = async () => {
      try {
        // A prior sign-out may have cleared local credentials while remote closure remained uncertain.
        // Retry through coordinator recovery before attempting another identity transition.
        if (getCoordinatorState() === "RECOVERY_REQUIRED") {
          const recovery = await executeFailClosedRecovery(onAuthChange);
          if (recovery.remoteSignout && recovery.localClear) {
            onClose();
            return;
          }
          throw new Error("Sign-out recovery is still incomplete. Keep this screen open and retry Sign Out / Remove Name.");
        }
        if (!(await ensureActiveFeedAck())) return;
        let activeSession: any = null;
        try {
          const sessionResponse = await api.auth.getSession();
          activeSession = sessionResponse?.data?.session ?? null;
        } catch (err) {
          throw new Error(`Supabase session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const sessionUserId = activeSession?.user?.id ?? null;
        const storedToken = await getStoredToken();
        const currentToken = sessionUserId ?? storedToken;
        if (!currentToken) {
          throw new Error("No active account found to sign out from.");
        }
        const storedUser = await getStoredUser();
        if (!storedUser || storedUser.id !== currentToken) {
          throw new Error("Identity consistency conflict: stored sign-in could not be confirmed.");
        }

        // The coordinator owns the authoritative readiness gate. Sync only after it passes, under the same
        // transition mutex, and before the coordinator changes local identity or retires the workspace.
        await executeWorkspaceTransition(currentToken, null, null, null, {
          activeFeedAcknowledged: activeFeedAckRef.current,
          beforeTransition: async () => {
            const migrationResult = await migrateLocalDataToAccount(currentToken);
            const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
            const totalUnresolved = migrationResult.feed.unresolved + migrationResult.bakes.unresolved + migrationResult.recipes.unresolved;
            if (totalFailed > 0 || totalUnresolved > 0) {
              throw new Error(`Cannot sign out: local data sync incomplete (${totalUnresolved} unresolved record(s), ${totalFailed} failure(s)). Please check your connection.`);
            }
          },
          closeRemoteSession: true,
        });

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

    if (Platform.OS === "web") {
      if (window.confirm("Sign out? Your operational records are preserved locally and synced to the cloud.")) {
        await performClear();
      }
      return;
    }

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
      onRequestClose={handleRequestClose}
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
              onPress={handleRequestClose}
              style={[s.closeButton, { backgroundColor: colors.card }]}
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          {transitionPendingData ? (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.cardName, { color: colors.foreground, marginBottom: 8 }]}>
                Your offline workspace
              </Text>
              <Text style={[s.cardInfo, { color: colors.mutedForeground, marginBottom: 12 }]}>
                {nlaInventory ? describeInventory(summarizeInventory(nlaInventory)) : "Checking what is on this device…"}
              </Text>
              {nlaInventory && summarizeInventory(nlaInventory).activeWork > 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[s.cardName, { color: colors.foreground, fontSize: 15, marginBottom: 6 }]}>
                    {NLA_LOCAL_WORK_TITLE}
                  </Text>
                  {NLA_LOCAL_WORK_PARAGRAPHS.map((paragraph) => (
                    <Text key={paragraph} style={[s.cardInfo, { color: colors.mutedForeground, marginBottom: 6 }]}>
                      {paragraph}
                    </Text>
                  ))}
                </View>
              ) : null}
              {recoveryIncomplete ? null : (
              <Text style={[s.cardInfo, { color: colors.mutedForeground, marginBottom: 12 }]}>
                Import & Proceed adds these records to your account, confirms each one, and then clears them from this device. Proceed Without Importing continues without them and clears them from this device. Nothing in your account is deleted either way.
              </Text>
              )}
              {choiceMessage ? (
                <Text style={[s.cardInfo, { color: colors.foreground, marginBottom: 12 }]}>{choiceMessage}</Text>
              ) : null}
              <View style={{ gap: 12 }}>
                {recoveryIncomplete ? null : (<>
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
                </>)}

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
