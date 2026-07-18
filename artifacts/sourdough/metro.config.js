const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SAFE GUARD: Block the problematic package ONLY during production web builds.
// This completely leaves your native Android/gradle environment untouched.
if (process.env.EXPO_PUBLIC_PLATFORM === 'web' || process.env.NEXT_RUNTIME === 'edge') {
  config.resolver.alias = {
    ...config.resolver.alias,
    'react-native-keyboard-controller': false,
  };
}

module.exports = config;
