/**
 * Expo config plugin: active les modular headers uniquement pour GoogleUtilities
 * (requis par FirebaseCoreInternal) sans toucher aux autres pods.
 * Évite les conflits avec Reanimated, Worklets, etc.
 * Requis pour EAS Build et prebuild --clean.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const GOOGLE_UTILITIES_LINE = "pod 'GoogleUtilities', :modular_headers => true";
const ANCHOR = /use_expo_modules!/;

function withModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        "Podfile",
      );
      let contents = await fs.promises.readFile(podfilePath, "utf8");

      if (contents.includes("pod 'GoogleUtilities'")) {
        return modConfig;
      }

      if (!ANCHOR.test(contents)) {
        return modConfig;
      }

      contents = contents.replace(
        ANCHOR,
        `use_expo_modules!\n  ${GOOGLE_UTILITIES_LINE}`,
      );

      await fs.promises.writeFile(podfilePath, contents);
      return modConfig;
    },
  ]);
}

module.exports = withModularHeaders;
