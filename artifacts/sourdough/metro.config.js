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
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// SAFE GUARD: Resolve web compilation errors strictly in the cloud.
// This leaves your local mobile/gradle environment completely untouched.
if (process.env.EXPO_PUBLIC_PLATFORM === 'web' || process.env.NEXT_RUNTIME === 'edge') {
  config.resolver.alias = {
    ...config.resolver.alias,
    // Block native package side-effects
    'react-native-keyboard-controller': false,

    // FORCE every dependency to share the exact same React instance on web
    'react': path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    '@types/react': path.resolve(__dirname, 'node_modules/@types/react'),
  };
}

module.exports = config;
