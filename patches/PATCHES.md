# Patches pnpm

Ces patches sont appliqués via `pnpm patch` et référencés dans `patchedDependencies` (`pnpm-workspace.yaml`). Pour régénérer un patch après un upgrade : `pnpm patch <package>@<version>`, appliquer les modifications, puis `pnpm patch-commit <path>`.

| Package        | Version patchée | Raison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Issue upstream                                                                                                                                     |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native` | 0.86.3          | **NSException re-throw depuis un TurboModule async.** Sur iOS 26, une `NSException` re-throw depuis une méthode TurboModule async (queue GCD de fond) est incatchable et fait crasher l'app (SIGABRT / `_objc_terminate`). `RCTTurboModule.mm` `@throw` toujours en 0.86.3 (`performMethodInvocation` branche async + `performVoidMethodInvocation`). Fix : logguer et retourner au lieu de re-throw. Patch défensif : le diagnostic FaceID a montré que la vraie cause était l'absence de `NSFaceIDUsageDescription`, mais ce re-throw reste un crash latent pour tout module natif. Renommé de `react-native@0.86.0` lors de l'alignement SDK 57 (#360), contenu inchangé (`git apply --check` OK sur 0.86.3). | [facebook/react-native#54859](https://github.com/facebook/react-native/issues/54859), [expo/expo#44680](https://github.com/expo/expo/issues/44680) |

À chaque montée de `react-native`, la clé de `patchedDependencies` (`pnpm-workspace.yaml`) **et** le nom du fichier `.patch` doivent suivre la nouvelle version : sinon pnpm échoue sur un patch inutilisé, ou le patch n'est plus appliqué.

## Retirer ce patch

Quand une version de React Native ne re-throw plus l'exception dans `RCTTurboModule.mm` (suivre facebook/react-native#54859) : supprimer l'entrée dans `patchedDependencies` (`pnpm-workspace.yaml`), le fichier `.patch` et la ligne ci-dessus.

Historique : le patch `react-native-track-player@4.1.2` a disparu avec le passage à `expo-audio` (SDK 57).

---

# Config plugins natifs (prebuild)

Certains réglages natifs ne passent pas par `pnpm patch` mais par un **plugin de config Expo** (`apps/client/plugins/`) exécuté au prebuild. La liste active fait foi : tableau `plugins` de `apps/client/app.config.js`.

Aucun plugin ne sert aujourd'hui de **correctif** de dépendance. L'ancien `withFaceIDiOS26Fix.js` (réécriture de `LocalAuthenticationModule.swift`) a été retiré de `app.config.js` puis supprimé du dépôt (#365) : le diagnostic sur appareil a montré qu'aucune exception n'était levée, la vraie cause était `NSFaceIDUsageDescription` (désormais posée dans `ios.infoPlist`). `withKeyboardManager.js` (pod IQKeyboardManager, incompatible RN 0.86) a suivi le même chemin : la barre clavier passe par `react-native-keyboard-controller`.

---

# Overrides pnpm (`pnpm-workspace.yaml` → `overrides`)

Les overrides forcent une version unique d'une dépendance transitive dans tout le monorepo.
A réévaluer lors de chaque montée de version majeure.

| Package                                                               | Version   | Raison                                                                |
| --------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| `typescript`                                                          | ^5.6.0    | Alignement monorepo sur TS 5.6+ (moduleResolution nodenext)           |
| `ansi-styles`                                                         | 4.3.0     | Eviter les doublons ESM/CJS qui cassent chalk dans certains contextes |
| `react`, `react-dom`, `react-test-renderer`                           | 19.2.3    | Version unique React 19 dans tout le monorepo (SDK 57)                |
| `@types/react`, `@types/react-dom`                                    | ~19.2.x   | Alignement types React 19                                             |
| `hermes-parser`, `hermes-estree`, `babel-plugin-syntax-hermes-parser` | 0.36.0    | Version hermes alignee sur RN 0.86 (toolchain SDK 57)                 |
| `multer`                                                              | >=2.1.1   | **Securite** : CVE fix (file upload vulnerability)                    |
| `serialize-javascript`                                                | >=7.0.3   | **Securite** : CVE-2024-11831 (XSS via serialized output)             |
| `rollup`                                                              | >=4.59.0  | **Securite** : CVE fix (path traversal)                               |
| `hono`                                                                | >=4.12.4  | **Securite** : CVE fix                                                |
| `fast-xml-parser`                                                     | >=5.3.6   | **Securite** : CVE fix (XXE/prototype pollution)                      |
| `svgo`                                                                | >=4.0.1   | **Securite** : CVE fix                                                |
| `@hono/node-server`                                                   | >=1.19.10 | **Securite** : CVE fix                                                |
| `flatted`                                                             | >=3.4.2   | **Securite** : prototype pollution fix                                |
| `effect`                                                              | >=3.20.0  | **Securite** : CVE fix                                                |
| `socket.io-parser`                                                    | >=4.2.6   | **Securite** : CVE fix (DoS)                                          |
| `h3`                                                                  | >=1.15.6  | **Securite** : CVE fix                                                |
| `handlebars`                                                          | >=4.7.9   | **Securite** : CVE fix (prototype pollution)                          |
| `node-forge`                                                          | >=1.4.0   | **Securite** : CVE fix (timing attack)                                |
| `picomatch`                                                           | >=4.0.4   | **Securite** : ReDoS fix                                              |
| `path-to-regexp`                                                      | >=8.4.0   | **Securite** : ReDoS fix                                              |
| `lodash`                                                              | >=4.18.0  | **Securite** : prototype pollution fix                                |
