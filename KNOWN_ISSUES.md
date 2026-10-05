# Problèmes connus & workarounds

Ce fichier recense les problèmes récurrents du monorepo et leurs contournements. La plupart concernent le client mobile (Expo / React Native) et sa chaîne de build native.

## Patches pnpm

Un seul patch pnpm est actif (voir `patchedDependencies` dans `pnpm-workspace.yaml` et [patches/PATCHES.md](./patches/PATCHES.md)).

| Symptôme                                                                                                            | Cause                                                                                                                           | Workaround                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crash natif iOS 26 au démarrage / à l'usage de FaceID (`expo-local-authentication`) — `SIGABRT` / `_objc_terminate` | `NSException` re-throw depuis une méthode TurboModule async, incatchable sur iOS 26 (RN 0.86 `@throw` dans `RCTTurboModule.mm`) | Patch `react-native@0.86.0` (log + return au lieu de re-throw) appliqué automatiquement au `pnpm install`. Un plugin de config Expo `withFaceIDiOS26Fix.js` corrige la cause racine au prebuild. Détails : [patches/PATCHES.md](./patches/PATCHES.md). |

## Scripts post-install

`pnpm install` applique le patch pnpm ci-dessus (via `patchedDependencies` dans `pnpm-workspace.yaml`). Aucun script `postinstall` custom n'est requis dans l'état actuel.

| Symptôme                                                                                                   | Cause                                                                  | Workaround                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Le client Expo ne démarre pas juste après `pnpm install` (erreurs de résolution de modules, exports Metro) | Résolution des dépendances dans le monorepo pnpm pas encore stabilisée | Relancer `pnpm install` depuis la racine. Purger le cache Metro si besoin (`expo start -c`). |

## Fragilité des montées de version Expo / React Native

| Symptôme                                                                                             | Cause                                                                                               | Workaround                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Régressions silencieuses (caméra, audio, push, biométrie) après un bump Expo SDK / RN / module natif | La CI ne couvre pas les chemins matériels ; les patches et plugins natifs peuvent devenir obsolètes | Suivre la checklist manuelle de smoke test : [apps/client/UPGRADES.md](./apps/client/UPGRADES.md). Réévaluer les patches et overrides : [patches/PATCHES.md](./patches/PATCHES.md). |
| `expo-doctor` signale des versions de modules désalignées avec le SDK                                | Modules Expo épinglés sur un ancien major vs versioning unifié du SDK                               | Aligner les versions sur celles attendues par le SDK avant de builder en natif.                                                                                                     |

## Reanimated figé en v3

`react-native-reanimated` doit rester en **v3** (worklets). Ne pas monter en v4 sans validation : la migration des worklets casse la navigation et les animations. Vérifier ce point à chaque upgrade Expo / RN.

## Lecteur audio (expo-audio)

Le lecteur est basé sur **expo-audio** (migration depuis `react-native-track-player` en SDK 57). Après un upgrade, vérifier lecture, file d'attente, lecture en arrière-plan (Android/iOS) et contrôles de l'écran verrouillé (voir la ligne « Musique » de [apps/client/UPGRADES.md](./apps/client/UPGRADES.md)).

## Voir aussi

- Patches pnpm et plugins de config natifs : [patches/PATCHES.md](./patches/PATCHES.md)
- Checklist d'upgrade Expo / RN : [apps/client/UPGRADES.md](./apps/client/UPGRADES.md)
