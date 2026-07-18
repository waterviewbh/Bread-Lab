module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          // Force the compiler to run ONLY on native mobile devices.
          // This guarantees it turns off during Vercel web bundle compilation.
          reactCompiler: {
            target: "native"
          }
        }
      ]
    ],
  };
};
