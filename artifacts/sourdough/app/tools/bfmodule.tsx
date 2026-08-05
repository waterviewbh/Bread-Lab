// artifacts/sourdough/components/bench/bfmodule.tsx
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { typography, spacing, radius } from '@/constants/theme';
import { lookupTargetFraction, lookupExpectedDuration } from '@/lib/bulkFermentEngine';

export default function BulkTool() {
  const colors = useColors();
  const [flour, setFlour] = useState('500');
  const [starter, setStarter] = useState('100');
  const [temp, setTemp] = useState('76');

  const stats = useMemo(() => {
    const f = parseFloat(flour) || 0;
    const s = parseFloat(starter) || 0;
    const t = parseFloat(temp) || 76;

    const inoculation = f > 0 ? (s / f) * 100 : 0;
    const targetRise = lookupTargetFraction(t);
    const durationMs = lookupExpectedDuration(t, inoculation <= 15 ? 10 : inoculation >= 25 ? 30 : 20);

    return {
      inoculation: inoculation.toFixed(1),
      targetRise: (targetRise * 100).toFixed(0),
      durationHrs: (durationMs / 3600000).toFixed(1)
    };
  }, [flour, starter, temp]);

  return (
    <ScrollView style={[s.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Bulk Estimator', headerShown: true }} />

      <View style={s.card}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>Flour Weight (g)</Text>
        <TextInput style={[s.input, { color: colors.text, borderColor: colors.border }]} value={flour} onChangeText={setFlour} keyboardType="numeric" />

        <Text style={[s.label, { color: colors.mutedForeground }]}>Starter Weight (g)</Text>
        <TextInput style={[s.input, { color: colors.text, borderColor: colors.border }]} value={starter} onChangeText={setStarter} keyboardType="numeric" />

        <Text style={[s.label, { color: colors.mutedForeground }]}>Dough Temp (°F)</Text>
        <TextInput style={[s.input, { color: colors.text, borderColor: colors.border }]} value={temp} onChangeText={setTemp} keyboardType="numeric" />
      </View>

      <View style={[s.resultCard, { backgroundColor: colors.secondary }]}>
        <Text style={[s.resultTitle, { color: colors.primary }]}>Estimates</Text>
        <Text style={{ color: colors.text }}>Inoculation: {stats.inoculation}%</Text>
        <Text style={{ color: colors.text }}>Target Rise: {stats.targetRise}%</Text>
        <Text style={{ color: colors.text, marginTop: 8, fontWeight: 'bold' }}>Est. Total Time: {stats.durationHrs} hours</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  card: { padding: 20, borderRadius: radius.lg, backgroundColor: 'white', marginBottom: 20 },
  label: { ...typography.labelSm, marginBottom: 8 },
  input: { borderBottomWidth: 1, paddingVertical: 8, fontSize: 18, marginBottom: 20 },
  resultCard: { padding: 20, borderRadius: radius.lg },
  resultTitle: { ...typography.titleMd, marginBottom: 12 },
});