const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');const config = getDefaultConfig(__dirname);

// Deduplicate React across workspace packages to prevent hook conflicts on web.
// Only applied during web export builds (EXPO_TARGET=web set in vercel.json buildCommand).
// Never runs during EAS native builds — avoids Windows absolute-path/ESM-URL conflict.
if (process.env.EXPO_TARGET === 'web') {
  config.resolver.alias = {
    ...config.resolver.alias,
    'react': path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    '@types/react': path.resolve(__dirname, 'node_modules/@types/react'),
  };
}module.exports = config;