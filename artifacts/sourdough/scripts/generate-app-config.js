#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Determine which version file to use
const localVersionPath = path.join(__dirname, '../version.local.json');
const productionVersionPath = path.join(__dirname, '../version.json');
const versionPath = fs.existsSync(localVersionPath) ? localVersionPath : productionVersionPath;

const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

// Read the base app config template
const baseConfigPath = path.join(__dirname, '../app.config.json');
const baseConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));

// Update with version data
baseConfig.expo.version = versionData.version;
baseConfig.expo.android.versionCode = versionData.versionCode;

// Write the generated app.json
const appJsonPath = path.join(__dirname, '../app.json');
fs.writeFileSync(appJsonPath, JSON.stringify(baseConfig, null, 2) + '\n');

console.log(`✓ Generated app.json from ${path.basename(versionPath)}`);
console.log(`  Version: ${versionData.version}`);
console.log(`  Version Code: ${versionData.versionCode}`);
