// artifacts/sourdough/app/tools/bfmodule.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { typography, spacing, radius, fonts } from '@/constants/theme';
import { lookupTargetFraction, lookupExpectedDuration } from '@/lib/bulkFermentEngine';

// --- Reusable Input Component ---
// Defined OUTSIDE to prevent focus loss on parent re-renders
const DashboardInput = ({ label, value, onChange, placeholder = "—", colors }: any) => (
  <View style={s.dashboardCol}>
    <Text style={[s.colLabel, { color: colors.mutedForeground }]}>{label}</Text>
    <TextInput
      style={[s.dashboardInput, { color: colors.foreground, borderColor: colors.border }]}
      value={value}
      onChangeText={(v) => {
        onChange(v);
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType="numeric"
    />
  </View>
);

export default function BulkTool() {
  const colors = useColors();

  // --- Formula Inputs ---
  // Defaulting to empty strings per user request
  const [flour, setFlour] = useState('');
  const [starter, setStarter] = useState('');
  const [water, setWater] = useState('');
  const [yeast, setYeast] = useState('');
  const [salt, setSalt] = useState('');
  const [temp, setTemp] = useState('');

  // --- Timeline & Volume ---
  const [startVolume, setStartVolume] = useState('');
  const [startTime, setStartTime] = useState(new Date());

  // Keep a "Now" ticker for the Ready At calculation
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    const f = parseFloat(flour) || 0;
    const s = parseFloat(starter) || 0;
    const w = parseFloat(water) || 0;
    const y = parseFloat(yeast) || 0;
    const sa = parseFloat(salt) || 0;
    const t = parseFloat(temp) || 76;

    // We only calculate duration if we have the core dough components
    const hasBase = f > 0 && (s > 0 || y > 0);

    // 1g Instant Yeast = 28.5g Starter Equiv
    const effectiveStarter = s + (y * 28.5);
    const totalFlour = f + (s / 2); // Assume starter is 50/50
    const totalWater = w + (s / 2);

    const inoculation = totalFlour > 0 ? (effectiveStarter / totalFlour) * 100 : 0;
    const hydration = totalFlour > 0 ? (totalWater / totalFlour) * 100 : 0;
    const totalWeight = f + s + w + y + sa;

    const targetRise = lookupTargetFraction(t);
    const durationMs = lookupExpectedDuration(t, inoculation <= 15 ? 10 : inoculation >= 25 ? 30 : 20);

    const readyAt = new Date(startTime.getTime() + durationMs);

    const sVol = parseFloat(startVolume) || 0;
    const targetVol = sVol > 0 ? Math.round(sVol * (1 + targetRise)) : null;

    return {
      hasBase,
      inoculation: inoculation.toFixed(1),
      hydration: hydration.toFixed(0),
      totalWeight: Math.round(totalWeight),
      targetRise: (targetRise * 100).toFixed(0),
      durationHrs: (durationMs / 3600000).toFixed(1),
      readyAt: readyAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      targetVol
    };
  }, [flour, starter, water, yeast, salt, temp, startTime, startVolume]);

  const handleReset = () => {
    setFlour('');
    setStarter('');
    setWater('');
    setYeast('');
    setSalt('');
    setTemp('');
    setStartVolume('');
    setStartTime(new Date());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ScrollView style={[s.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{
        title: 'Bulk Estimator',
        headerShown: true,
        headerRight: () => (
          <Pressable onPress={handleReset} style={{ marginRight: 8 }}>
            <Ionicons name="refresh" size={20} color={colors.mutedForeground} />
          </Pressable>
        )
      }} />

      {/* Hero Prediction Section */}
      <View style={s.heroTimerSection}>
        <Text style={[s.heroTimerLabel, { color: colors.mutedForeground }]}>ESTIMATED BULK DURATION</Text>
        <Text style={[s.heroTimerText, { color: stats.hasBase ? colors.foreground : colors.mutedForeground }]}>
          {stats.hasBase ? `${stats.durationHrs}h` : '—'}
        </Text>
        {stats.hasBase && (
          <View style={[s.readyAtPill, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="clock" size={14} color={colors.primary} />
            <Text style={[s.readyAtText, { color: colors.primary }]}>Ready for shaping at {stats.readyAt}</Text>
          </View>
        )}
      </View>

      {/* Main Grid: Flour & Water (1), Starter & Yeast (2), Salt & Temp (3) */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.dashboardGrid}>
          <DashboardInput label="FLOUR (g)" value={flour} onChange={setFlour} colors={colors} />
          <View style={[s.vDivider, { backgroundColor: colors.border }]} />
          <DashboardInput label="WATER (g)" value={water} onChange={setWater} colors={colors} />
        </View>

        <View style={[s.hDivider, { backgroundColor: colors.border }]} />

        <View style={s.dashboardGrid}>
          <DashboardInput label="STARTER (g)" value={starter} onChange={setStarter} colors={colors} />
          <View style={[s.vDivider, { backgroundColor: colors.border }]} />
          <DashboardInput label="YEAST (g)" value={yeast} onChange={setYeast} colors={colors} />
        </View>

        <View style={[s.hDivider, { backgroundColor: colors.border }]} />

        <View style={s.dashboardGrid}>
          <DashboardInput label="SALT (g)" value={salt} onChange={setSalt} colors={colors} />
          <View style={[s.vDivider, { backgroundColor: colors.border }]} />
          <DashboardInput label="TEMP (°F)" value={temp} onChange={setTemp} colors={colors} />
        </View>
      </View>

      {/* Volume Helper */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
        <Text style={[s.sectionLabel, { color: colors.mutedForeground, marginBottom: 12 }]}>Volume Helper</Text>
        <View style={s.dashboardGrid}>
          <DashboardInput label="START VOL (ml)" value={startVolume} onChange={setStartVolume} colors={colors} />
          <View style={[s.vDivider, { backgroundColor: colors.border }]} />
          <View style={s.dashboardCol}>
            <Text style={[s.colLabel, { color: colors.mutedForeground }]}>TARGET VOL (ml)</Text>
            <View style={s.targetVolDisplay}>
              <Text style={[s.targetVolText, { color: stats.targetVol ? colors.accent : colors.mutedForeground }]}>
                {stats.targetVol || '—'}
              </Text>
              {stats.targetVol && <Text style={[s.riseHint, { color: colors.mutedForeground }]}>{stats.targetRise}% rise</Text>}
            </View>
          </View>
        </View>
      </View>

      {/* Bottom Summary Bar */}
      <View style={[s.summaryBar, { backgroundColor: colors.secondary }]}>
        <View style={s.summaryItem}>
          <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>TOTAL WEIGHT</Text>
          <Text style={[s.summaryValue, { color: colors.text }]}>{stats.totalWeight > 0 ? `${stats.totalWeight}g` : '—'}</Text>
        </View>
        <View style={s.summaryItem}>
          <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>HYDRATION</Text>
          <Text style={[s.summaryValue, { color: colors.text }]}>{stats.hydration > 0 ? `${stats.hydration}%` : '—'}</Text>
        </View>
        <View style={s.summaryItem}>
          <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>INOCULATION</Text>
          <Text style={[s.summaryValue, { color: colors.text }]}>{stats.inoculation > 0 ? `${stats.inoculation}%` : '—'}</Text>
        </View>
      </View>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  card: { borderRadius: radius.lg, borderWidth: 1, paddingVertical: 8 },
  heroTimerSection: {
    alignItems: "center",
    marginVertical: 32,
  },
  heroTimerLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTimerText: {
    fontFamily: fonts.serifBold,
    fontSize: 64,
    letterSpacing: -2,
  },
  readyAtPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginTop: 8,
  },
  readyAtText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
  dashboardGrid: {
    flexDirection: "row",
    alignItems: "center",
  },
  dashboardCol: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  colLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  dashboardInput: {
    width: 80,
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 18,
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  vDivider: {
    width: 1,
    height: 40,
    opacity: 0.2,
  },
  hDivider: {
    height: 1,
    width: '90%',
    alignSelf: 'center',
    opacity: 0.1,
  },
  sectionLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  targetVolDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
  },
  targetVolText: {
    fontFamily: fonts.mono,
    fontSize: 22,
    lineHeight: 28,
  },
  riseHint: {
    fontFamily: fonts.sans,
    fontSize: 10,
    marginTop: -2,
  },
  summaryBar: {
    flexDirection: 'row',
    marginTop: 20,
    padding: 16,
    borderRadius: radius.lg,
    justifyContent: 'space-between',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryValue: {
    fontFamily: fonts.mono,
    fontSize: 14,
  },
});
