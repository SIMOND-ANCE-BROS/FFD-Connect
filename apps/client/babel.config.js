const path = require("path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // SDK 57 ships Reanimated 4.5 + react-native-worklets 0.10. Let
      // babel-preset-expo auto-include react-native-worklets/plugin (its default
      // when worklets !== false and the package is installed). Do NOT add a
      // trailing react-native-reanimated/plugin manually — on Reanimated 4 that
      // plugin just re-exports worklets/plugin, so a manual entry double-applies
      // the transform and breaks worklet detection ("non-worklet function ...
      // on the UI thread" red box).
      ["babel-preset-expo"],
    ],
    plugins: [
      [
        "module:react-native-dotenv",
        {
          moduleName: "@env",
          path: ".env",
        },
      ],
      [
        "module-resolver",
        {
          extensions: [
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
            ".android.js",
            ".android.tsx",
            ".ios.js",
            ".ios.tsx",
            ".web.js",
            ".web.tsx",
          ],
          alias: {
            react: path.resolve(__dirname, "../../node_modules/react"),
            "react-dom": path.resolve(
              __dirname,
              "../../node_modules/react-dom",
            ),
            "react-native-linear-gradient": path.resolve(
              __dirname,
              "src/mocks/LinearGradient.web.tsx",
            ),
            "react-native-fs": path.resolve(__dirname, "src/mocks/RNFS.web.ts"),
            "react-native-track-player": path.resolve(
              __dirname,
              "src/mocks/TrackPlayer.web.ts",
            ),
            "react-native-sound": path.resolve(
              __dirname,
              "src/mocks/Sound.web.ts",
            ),
            "react-native-biometrics": path.resolve(
              __dirname,
              "src/mocks/Biometrics.web.ts",
            ),
            // NE PAS aliaser expo-device / expo-sharing ici : module-resolver
            // réécrit l'import sur TOUTES les plateformes (pas de notion de
            // plateforme en babel), ce qui servait le mock web sur natif
            // (« Système : iOS Web », export RGPD sans partage). Ces paquets
            // sont installés ; le web est mocké via metro resolveRequest
            // (MOCKS, gated sur platform === "web"). Les alias ci-dessus
            // restent car leurs paquets sont désinstallés (legacy).
            "merge-options": path.resolve(
              __dirname,
              "src/mocks/merge-options.js",
            ),
            "@react-native-community/blur": path.resolve(
              __dirname,
              "src/mocks/BlurView.web.tsx",
            ),
          },
        },
      ],
      // NOTE: the worklets/reanimated babel plugin is added automatically by
      // babel-preset-expo (see presets above) and must run last, which the
      // preset guarantees. Do not re-add react-native-reanimated/plugin here.
    ],
  };
};
