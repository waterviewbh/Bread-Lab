// Replace the EXPO_TARGET env-var guard with a platform check. 
// This is more reliable — it runs on every Linux/macOS build (Vercel, EAS cloud) 
// and safely skips on Windows where C:\ paths cause the ESM URL error:

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// Deduplicate React on all non-Windows platforms (Vercel + EAS cloud).
// Skipped on Windows because C:\ paths are rejected by Node's ESM URL loader.
// Without this, React DOM sets its dispatcher on one React instance while
// the component's hooks call through a second instance — useState/useEffect = null.
if (process.platform !== 'win32') {
    console.warn('[metro] Applying React deduplication aliases, platform:', process.platform);
    config.resolver.alias = {
        ...config.resolver.alias,
        'react': require.resolve('react'),
        'react-dom': require.resolve('react-dom'),
    };
}

module.exports = config;
