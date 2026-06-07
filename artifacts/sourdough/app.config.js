// ============================================================================
// NOTICE: DO NOT EDIT version OR versionCode IN THIS FILE.
// THE SINGLE SOURCE OF TRUTH IS: artifacts/sourdough/version.json
// ============================================================================

const versionData = require('./version.json');

module.exports = {
  name: "Bread Lab",
  slug: "sourdough",
  version: versionData.version,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "sourdough",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/icon.png",
    resizeMode: "contain",
    backgroundColor: "#F5F0E6"
  },
  ios: {
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "Used to photograph your dough and starter at each stage.",
      NSPhotoLibraryUsageDescription: "Used to select photos of your dough or starter."
    }
  },
  android: {
    package: "com.waterviewbakehouse.breadlab",
    versionCode: versionData.versionCode,
    targetSdkVersion: 34,    // Force stable SDK 34 (Android 14)
    compileSdkVersion: 35,   // Use stable SDK 35 (Android 15)
    permissions: [
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.RECORD_AUDIO"
    ]
  },
  web: {
    favicon: "./assets/images/icon.png",
    name: "Bread Lab",
    shortName: "Bread Lab",
    description: "Bread Lab is a sourdough baker's companion: track starter feeds, log pH and temperature readings, run recipe phases with live timers, chart fermentation over time, and bake with volume tracking and notes.",
    lang: "en",
    themeColor: "#5C3527",
    backgroundColor: "#F5F0E6"
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-web-browser",
    [
      "expo-image-picker",
      {
        "photosPermission": "Allow Bread Lab to access your photos to document your dough.",
        "cameraPermission": "Allow Bread Lab to use your camera to photograph your dough."
      }
    ]
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true
  },
  extra: {
    eas: {
      projectId: "f9341997-8d63-4ef8-a2ed-e7ae9c5a8f47"
    }
  }
};