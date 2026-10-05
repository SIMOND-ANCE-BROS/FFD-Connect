# Mises à jour Expo / React Native — checklist manuelle

Ce document réduit le risque de **régressions silencieuses** après une montée de version d’**Expo**, de **React Native** ou de dépendances natives. Rien ne remplace un smoke test ciblé : la CI ne couvre pas tous les chemins matériels (caméra, audio, push, etc.).

**À faire à chaque upgrade majeur** (SDK Expo, saut de version RN, ou bump de modules listés dans [patches/PATCHES.md](../../patches/PATCHES.md)).

## Avant de merger la branche d’upgrade

- [ ] `pnpm install` à la racine sans erreur (patches pnpm inclus).
- [ ] Client : `pnpm --filter client typecheck` et `pnpm --filter client test`.
- [ ] `pnpm --filter client exec expo-doctor` (corriger les avertissements critiques).
- [ ] Build **dev** iOS + Android au moins une fois (ou EAS profile `development`).

## Smoke test par domaine (ordre suggéré)

Cocher ce qui est pertinent selon les paquets effectivement mis à jour. Les modules listés correspondent aux zones **sensibles** du client (natif / bridge).

| Domaine                | Modules / zone                                     | Vérifier                                                                          |
| ---------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Auth & session         | JWT, AsyncStorage, intercepteurs                   | Login, logout, session restaurée au cold start                                    |
| Navigation             | React Navigation, Reanimated, Screens              | Navigation stack + tabs, pas de flash / freeze                                    |
| Réseau temps réel      | `socket.io-client`                                 | Flux live (compétition) si applicable                                             |
| Musique                | `expo-audio`                                       | Lecture, file, fond Android/iOS, contrôles écran verrouillé, pas de crash au skip |
| Caméra / scan          | `expo-camera`, `react-native-vision-camera`, QR    | Scan licence / check-in, permissions                                              |
| Push                   | `@react-native-firebase/messaging`                 | Réception ou pipeline d’inscription (selon env)                                   |
| Fichiers               | `expo-file-system`, `expo-sharing`, `expo-print`   | Export PDF / partage si touché                                                    |
| Localisation / clavier | `react-native-google-places-autocomplete`, clavier | Saisie d’adresse, pas de régression clavier (iOS)                                 |
| Biométrie              | `expo-local-authentication`                        | Déverrouillage si la feature est utilisée                                         |
| Perf liste             | `@shopify/flash-list`                              | Scroll fluide sur listes denses                                                   |

## Web (Expo Web)

Si le build web est dans le périmètre de release :

- [ ] `npx expo export --platform web` (ou flux CI équivalent).
- [ ] Parcours auth + un écran métier critique sous navigateur cible.

## Après l’upgrade

- Mettre à jour les mentions de version dans la doc si nécessaire (README, ce fichier).
- Si un patch npm a été retiré ou modifié, documenter la décision dans [patches/PATCHES.md](../../patches/PATCHES.md).

## Voir aussi

- Architecture client : [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Patterns monorepo : [docs/architecture/patterns.md](../../docs/architecture/patterns.md)
- Problèmes connus (Metro, scripts post-install) : [KNOWN_ISSUES.md](../../KNOWN_ISSUES.md)
