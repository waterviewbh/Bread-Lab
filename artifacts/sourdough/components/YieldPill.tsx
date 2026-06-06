import React from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';

interface YieldPillProps {
  isBuilder: boolean;
  value: string;
  onChangeValue?: (text: string) => void;
}

export const YieldPill = React.memo(({ isBuilder, value, onChangeValue }: YieldPillProps) => {
  return (
    <View style={styles.pillContainer}>
      <Text style={styles.pillLabel}>Yield: </Text>
      {isBuilder ? (
        <TextInput
          style={styles.pillInputNumber}
          keyboardType="numeric"
          value={value}
          onChangeText={onChangeValue}
          placeholder="1"
          maxLength={4}
          placeholderTextColor="#A3968E"
        />
      ) : (
        <View style={styles.runnerYieldContainer}>
          <Text style={styles.pillValueText}>{value}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF', // Matches your card surface color
    borderRadius: 12,           // Matches your interface radius layout
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#E8E1DA',     // Matches your standard soft borders
  },
  pillLabel: {
    color: '#706053',           // Muted brown for labels
    fontSize: 14,
    fontWeight: '500',
  },
  pillValueText: {
    color: '#2C2520',           // Dark brown primary text
    fontSize: 14,
    fontWeight: '600',
  },
  pillInputNumber: {
    width: 40,
    textAlign: 'center',
    color: '#2C2520',
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  runnerYieldContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
