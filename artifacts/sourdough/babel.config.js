module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          // Use the preset's native web-override structure to disable the compiler
          web: {
            "react-compiler": false
          }
        }
      ]
    ],
  };
};
