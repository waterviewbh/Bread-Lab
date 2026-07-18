const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Project root = artifacts/sourdough; workspace root = Bread-Lab/
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Allow Metro to traverse into workspace packages (e.g. lib/api-client-react)
config.watchFolders = [workspaceRoot];

// Let Metro find node_modules from both the project and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Deduplicate React for web builds.
// require.resolve() returns the canonical physical path (past pnpm symlinks),
// which is the exact key Metro uses in its module registry — guaranteeing
// every package shares one React instance and useState is never null.
if (process.env.EXPO_TARGET === 'web') {
  config.resolver.alias = {
    ...config.resolver.alias,
    'react': require.resolve('react'),
    'react-dom': require.resolve('react-dom'),
  };
}
module.exports = config;