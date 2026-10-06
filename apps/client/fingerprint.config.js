/**
 * Empreinte native (runtimeVersion `policy: "fingerprint"`, cf. app.config.js).
 *
 * Une OTA n'atteint que les binaires dont l'empreinte est identique, et EAS
 * Build refuse un build dont l'empreinte calculée sur le builder diffère de
 * celle calculée là où `eas build` a été lancé ("Runtime version mismatch").
 * L'empreinte doit donc être identique sur le runner GitHub, un poste de dev et
 * le builder EAS, pour un même commit et une même variante.
 *
 * `sourceSkips` — on exclut les numéros de version (`version`,
 * `ios.buildNumber`, `android.versionCode`) : release-please bumpe `version` à
 * chaque release, et ce changement ne touche pas le code natif. Sans cette
 * exclusion, chaque release couperait les OTA vers tous les binaires installés.
 *
 * `ignorePaths` (motifs minimatch relatifs à apps/client ; un motif en `**\/`
 * s'applique aussi aux chemins hors du projet, préfixe `../` retiré) :
 *
 * - Config Firebase (`googleServicesFile`). @expo/fingerprint hache le contenu
 *   de ce fichier, mais il n'existe que sur le builder EAS : variable
 *   d'environnement EAS de type "file", secrète, écrite dans
 *   `<workingdir>/eas-environment-secrets/<sha256>`. Le runner et les postes de
 *   dev ne l'ont jamais (ou ont une copie locale dans firebase/). Changer ce
 *   fichier exige un build natif, à déclencher à la main (workflow_dispatch).
 *
 * - `ios/` et `android/` : projet CNG, ces dossiers sont générés par
 *   `expo prebuild` et ignorés par git (apps/client/.gitignore). Le builder EAS
 *   calcule l'empreinte APRÈS le prebuild, sur une archive sans `.git` : la
 *   détection "dossier ignoré par git" de @expo/fingerprint y échoue et le
 *   dossier généré entrait dans l'empreinte. Les ignorer explicitement rend le
 *   résultat indépendant de cette détection.
 *
 * @type {import('expo/fingerprint').Config}
 */
const { SourceSkips } = require("expo/fingerprint");

module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
  ignorePaths: [
    "**/eas-environment-secrets/**",
    "firebase/GoogleService-Info.*.plist",
    "firebase/google-services.*.json",
    "ios/**/*",
    "android/**/*",
  ],
};
