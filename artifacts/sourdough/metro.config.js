// Replace the EXPO_TARGET env-var guard with a platform check. 
// This is more reliable — it runs on every Linux/macOS build (Vercel, EAS cloud) 
// and safely skips on Windows where C:\ paths cause the ESM URL error.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// resolver.alias was insufficient: pnpm symlink paths and their real paths
// were registering as two separate Metro module cache entries, causing
// ReactSharedInternals.H (the dispatcher) to be set on one React instance
// while hooks read from a second instance — giving null.useState/useEffect.
//
// resolveRequest intercepts every require() in the entire bundle (including
// inside react-dom's own source). fs.realpathSync collapses symlinks so
// Metro always caches React under one canonical path = one instance.
//
// Skipped on Windows: C:\ paths are rejected by Node's ESM URL loader.
if (process.platform !== 'win32') {
    const canonicalize = (id) => fs.realpathSync(require.resolve(id));
    const moduleMap = {
        'react':              canonicalize('react'),
        'react-dom':          canonicalize('react-dom'),
        'react-dom/client':   canonicalize('react-dom/client'),
        'react/jsx-runtime':  canonicalize('react/jsx-runtime'),
        'react/jsx-dev-runtime': canonicalize('react/jsx-dev-runtime'),
    };
    console.warn('[metro] React deduplication via resolveRequest, platform:', process.platform);
    console.warn('[metro]  react ->', moduleMap['react']);
    const upstream = config.resolver.resolveRequest;
    config.resolver.resolveRequest = (context, moduleName, platform) => {
        const canonical = moduleMap[moduleName];
        if (canonical) return { filePath: canonical, type: 'sourceFile' };
        if (upstream) return upstream(context, moduleName, platform);
        return context.resolveRequest(context, moduleName, platform);
    };
}
module.exports = config;