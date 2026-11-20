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
import { clearAllAppData, clearOperationalData, safeParse, hasAnyRestorableQuarantine } from "@/lib/storageUtils";
import { executeWorkspaceTransition, recoverTransition, ActiveFeedNotAcknowledgedError, getCoordinatorState, hasPendingSignoutRecovery } from "@/lib/transitionCoordinator";
import { getDeviceId } from "@/lib/deviceId";
import { migrateLocalDataToAccount } from "@/lib/migrate";
import { confirmActiveFeedTransition, NLA_LOCAL_WORK_TITLE, describeActiveNlaWork } from "@/lib/activeWork";
import {
  inventoryNlaWorkspace,
  buildPurgePlan,
  authorizeDiscardPlan,
  authorizeNlaTransitionIntent,
  inventoryIsEmpty,
  summarizeInventory,
  describeInventory,
  type NlaInventory,
} from "@/lib/nlaWorkspace";
import {
  importNlaWorkspace,
  readBackUploadedRows,
  describeImportReport,
  reportToMigrationResult,
  ImportNotVerifiedError,
  IMPORT_STILL_OFFLINE_SENTENCE,
  type ImportReport,
} from "@/lib/nlaImport";
import { closeOrphanRemoteSession, getVerifiedRemoteSessionOwner } from "@/lib/remoteSessionGuard";
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
  const ensureActiveFeedAck = async (ownerId?: string): Promise<boolean> => {
    if (activeFeedAckRef.current) return true;
    const ok = await confirmActiveFeedTransition(ownerId);
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

  const handleChoiceProceedWithoutImport = async (
    pendingData = transitionPendingData,
    inventory = nlaInventory
  ) => {
    if (!pendingData || recoveryIncompleteRef.current) return;
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
    let destinationUser: AuthUser | null = pendingData.user ?? null;
    try {
      const intent = authorizeNlaTransitionIntent("discard", inventory.raw);
      await executeWorkspaceTransition(null, null, null, null, {
        activeFeedAcknowledged: true,
        nlaTransitionIntent: intent,
        prepareIncoming: async () => {
          let token = pendingData.token;
          let user = pendingData.user;
          if (!token || !user) {
            const result = await api.auth.identify({
              firstName: pendingData.firstName,
              starterName: pendingData.starterName,
              isSignUp: pendingData.isSignUp,
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
      const recovered = await failChoice("Couldn't continue", err);
      if (!recovered && getCoordinatorState() !== "IDLE") setTransitionPendingData(pendingData);
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
      let sessionUserId = await getVerifiedRemoteSessionOwner();
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
      const pendingData = {
        firstName: firstName.trim(),
        starterName: starterName.trim(),
        isSignUp: mode === "name",
      };
      const hasQuarantine = await hasAnyRestorableQuarantine();
      if (inventoryIsEmpty(inventory) && !hasQuarantine) {
        await handleChoiceProceedWithoutImport(pendingData, inventory);
      } else {
        setTransitionPendingData(pendingData);
      }
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
        if (getCoordinatorState() === "RECOVERY_REQUIRED" || await hasPendingSignoutRecovery()) {
          const recovery = await executeFailClosedRecovery(onAuthChange);
          if (recovery.remoteSignout && recovery.localClear) {
            onClose();
            return;
          }
          throw new Error("Sign-out recovery is still incomplete. Keep this screen open and retry Sign Out / Remove Name.");
        }
        const currentToken = await getVerifiedRemoteSessionOwner();
        if (!currentToken || await getStoredToken() !== currentToken) {
          throw new Error("Identity consistency conflict: stored sign-in could not be confirmed.");
        }
        const storedUser = await getStoredUser();
        if (!storedUser || storedUser.id !== currentToken) {
          throw new Error("Identity consistency conflict: stored sign-in could not be confirmed.");
        }
        if (!(await ensureActiveFeedAck(currentToken))) return;

        // The coordinator owns the authoritative readiness gate. Sync only after it passes, under the same
        // transition mutex, and before the coordinator changes local identity or retires the workspace.
        await executeWorkspaceTransition(currentToken, null, null, null, {
          activeFeedAcknowledged: activeFeedAckRef.current,
          beforeTransition: async () => {
            if (await getVerifiedRemoteSessionOwner() !== currentToken || await getStoredToken() !== currentToken) {
              throw new Error("Identity consistency conflict: stored sign-in could not be confirmed.");
            }
            const migrationResult = await migrateLocalDataToAccount(currentToken, { reportUploads: true });
            const totalFailed = migrationResult.feed.failed + migrationResult.bakes.failed + migrationResult.recipes.failed;
            const totalUnresolved = migrationResult.feed.unresolved + migrationResult.bakes.unresolved + migrationResult.recipes.unresolved;
            if (totalFailed > 0 || totalUnresolved > 0) {
              console.warn("[AuthModal] Sign-out sync incomplete", { totalUnresolved, totalFailed });
              throw new Error("You’re still signed in. We couldn’t finish syncing your saved work. Check your connection and try again.");
            }
            try {
              const uploads = migrationResult.uploads;
              const counts = { recipe: migrationResult.recipes.ok, bake: migrationResult.bakes.ok, feed: migrationResult.feed.ok };
              if (!uploads || uploads.some(upload => !upload.ok || upload.destinationId !== upload.localId)) {
                throw new Error("Outgoing uploads are missing or changed record IDs.");
              }
              for (const kind of ["recipe", "bake", "feed"] as const) {
                const sent = uploads.filter(upload => upload.kind === kind);
                if (sent.length !== counts[kind]) throw new Error(`Incomplete ${kind} upload accounting.`);
                const failures = await readBackUploadedRows(kind, sent, currentToken);
                if (failures.length) throw new Error(failures.map(failure => failure.reason).join("; "));
              }
            } catch (error) {
              console.warn("[AuthModal] Sign-out read-back incomplete", error);
              throw new Error("You’re still signed in. We couldn’t verify your saved work in the cloud. Try signing out again.");
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
      if (window.confirm("Sign out? Saved records will sync before sign-out. Unfinished Feed or Bake work will not carry into the offline workspace.")) {
        await performClear();
      }
      return;
    }

    Alert.alert(
      "Sign out?",
      "Saved records will sync before sign-out. Unfinished Feed or Bake work will not carry into the offline workspace.",
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
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={[
            s.content,
            { paddingTop: insets.top + webTop + 28, paddingBottom: insets.bottom + 32, flexGrow: 1 },
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
                  {describeActiveNlaWork(nlaInventory).map((paragraph) => (
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
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[s.primaryButtonText, { color: colors.primaryForeground }]}>Import & Proceed</Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => { void handleChoiceProceedWithoutImport(); }}
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
              <View style={[s.modeTabs, { backgroundColor: colors.muted }]}>
                <Pressable
                  onPress={() => setMode("name")}
                  style={[
                    s.modeTab,
                    mode === "name" && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
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
                    mode === "find" && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
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
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[s.primaryButtonText, { color: colors.primaryForeground }]}>
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
    fontSize: 16,
    fontWeight: "600",
  },
});
