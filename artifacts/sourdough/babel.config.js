module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          // Disable the React compiler on web to avoid concurrent-mode conflicts.
          web: {
            "react-compiler": false,
          },
        },
      ],
    ],
    // react-native-reanimated/plugin MUST be the last entry in plugins.
    // In Reanimated 4.x this is a thin re-export of react-native-worklets/plugin.
    // Without it, worklet functions (used internally by FadeInDown etc.) are never
    // transpiled and the worklet runtime crashes with "ae is not a function" on web.
    plugins: ["react-native-reanimated/plugin"],
  };
};