/**
 * Empreinte native (runtimeVersion `policy: "fingerprint"`, cf. app.config.js).
 *
 * Une OTA n'atteint que les binaires dont l'empreinte est identique. On exclut
 * les numéros de version (`version`, `ios.buildNumber`, `android.versionCode`) :
 * release-please bumpe `version` à chaque release, et ce changement ne touche
 * pas le code natif. Sans cette exclusion, chaque release couperait les OTA vers
 * tous les binaires déjà installés.
 *
 * @type {import('expo/fingerprint').Config}
 */
const { SourceSkips } = require("expo/fingerprint");

module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
};
