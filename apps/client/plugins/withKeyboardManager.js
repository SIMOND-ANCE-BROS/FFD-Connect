/**
 * Expo config plugin: ajoute IQKeyboardManagerSwift au Podfile pour la barre
 * native (^ v ✓) au-dessus du clavier iOS.
 * @see https://github.com/douglasjunior/react-native-keyboard-manager
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const POD_LINE =
  "  pod 'IQKeyboardManagerSwift', :git => 'https://github.com/douglasjunior/IQKeyboardManager.git', :branch => 'react-native-keyboard-manager'";

function withKeyboardManager(config) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        "Podfile",
      );
      let contents = await fs.promises.readFile(podfilePath, "utf8");

      if (contents.includes("IQKeyboardManagerSwift")) {
        return modConfig;
      }

      const anchor = "use_expo_modules!";
      const idx = contents.indexOf(anchor);
      if (idx === -1) {
        return modConfig;
      }
      const insertPos = idx + anchor.length;
      contents =
        contents.slice(0, insertPos) +
        "\n  " +
        POD_LINE.trim() +
        "\n" +
        contents.slice(insertPos);

      await fs.promises.writeFile(podfilePath, contents);
      return modConfig;
    },
  ]);
}

module.exports = withKeyboardManager;
