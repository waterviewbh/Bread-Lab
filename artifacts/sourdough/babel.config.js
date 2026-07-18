module.exports = function (api) {
  api.cache(true);

  // Check if the current bundler execution is targeting the web platform
  const isWeb = process.env.EXPO_PUBLIC_PLATFORM === 'web';

  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          // Explicitly turn off the React Compiler ONLY when compiling for the web browser
          reactCompiler: isWeb ? false : true
        }
      ]
    ],
  };
};
