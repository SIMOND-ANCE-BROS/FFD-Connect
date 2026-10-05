# Patches pnpm

Ces patches sont appliqués via `pnpm patch` et référencés dans `patchedDependencies` (`pnpm-workspace.yaml`). Pour régénérer un patch après un upgrade : `pnpm patch <package>@<version>`, appliquer les modifications, puis `pnpm patch-commit <path>`.

| Package                     | Version patchée | Raison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Issue upstream                                                                                                                                     |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-track-player` | 4.1.2           | Crash Android natif : `getTrack(index)` retourne null quand l'index est invalide. Fix : null-check sur `originalItem` avant `Arguments.fromBundle()`.                                                                                                                                                                                                                                                                                                                                                                                                                                 | [doublesymmetry/react-native-track-player](https://github.com/doublesymmetry/react-native-track-player)                                            |
| `react-native`              | 0.86.0          | **iOS 26 TurboModule NSException crash.** Sur iOS 26, une `NSException` re-throw depuis une méthode TurboModule async (queue GCD de fond) est incatchable et fait crasher l'app (SIGABRT / `_objc_terminate`). C'est la cause racine du crash FaceID (`expo-local-authentication` → `LAContext.canEvaluatePolicy`). RN 0.86 `@throw` toujours dans `RCTTurboModule.mm` (`performMethodInvocation` branche async + `performVoidMethodInvocation`), identique à 0.83. Fix : logguer et retourner au lieu de re-throw. Remplace l'ancien patch `react-native@0.83.6` (montée SDK 55→57). | [facebook/react-native#54859](https://github.com/facebook/react-native/issues/54859), [expo/expo#44680](https://github.com/expo/expo/issues/44680) |

## Retirer ce patch

Vérifier si la v5 stable intègre le fix, puis supprimer l'entrée dans `patchedDependencies` (`pnpm-workspace.yaml`) et ce fichier.

---

# Config plugins natifs (prebuild)

Certains correctifs natifs ne passent pas par `pnpm patch` mais par un **plugin de config Expo** (`apps/client/plugins/`) exécuté au prebuild.

| Plugin                  | Cible                       | Raison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withFaceIDiOS26Fix.js` | `expo-local-authentication` | **Fix natif iOS 26 FaceID (cause racine).** Réécrit `LocalAuthenticationModule.swift` pour que chaque `LAContext.canEvaluatePolicy` tourne sur le **main thread** ET soit encapsulé dans un shim ObjC `@try/@catch` (`EXFaceIDExceptionShim.h/.m` injecté dans le pod, exposé via son module map). La `NSException` levée sur iOS 26 est ainsi rattrapée **nativement** et convertie en `false` sûr, avant d'atteindre le bridge TurboModule. Le patch `react-native@0.86.0` (swallow au niveau du bridge) reste un backstop défensif. Plugin idempotent. **La validation ne peut se faire QUE sur un appareil iOS 26 physique via `eas build --profile preview --platform ios`** (le profil `preview` pose `EXPO_PUBLIC_ENABLE_IOS26_BIOMETRICS=1` pour lever le garde applicatif). |

### Retirer ce plugin

À supprimer une fois qu'`expo-local-authentication` intègre nativement un try/catch ObjC + main-thread dispatch autour de `canEvaluatePolicy` (suivre expo/expo#44680). Retirer alors l'entrée du tableau `plugins` dans `apps/client/app.config.js`, le fichier `apps/client/plugins/withFaceIDiOS26Fix.js`, et le garde iOS 26 dans `apps/client/src/utils/biometrics-adapter.ts`.

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
