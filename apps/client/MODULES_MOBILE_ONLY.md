# Modules réservés au mobile & fallbacks web

Certaines fonctionnalités reposent sur des modules **natifs** (caméra, audio,
biométrie…) qui n'existent pas sur le web. Le client cible avant tout iOS/Android ;
le web sert de surface secondaire (démo, debug). Pour éviter de casser le bundle web,
chaque module natif a un **fallback web** via l'extension de plateforme `*.web.tsx`
(résolue automatiquement par Metro) ou un mock dans `src/mocks/`.

## Modules natifs (plugins Expo)

Déclarés dans [`app.config.js`](app.config.js) :

| Module                      | Usage                                 | Fallback web                                                                                                    |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `expo-audio`                | Lecteur audio (bibliothèque musicale) | `src/features/player/**/*.web.tsx` (`PlayerContext.web.tsx`, `MiniPlayer.web.tsx`, `AudioPlayerScreen.web.tsx`) |
| `expo-camera`               | Scan QR des licences                  | `src/features/license/screens/ScannerScreen.web.tsx`, `QRCodeView.web.tsx`                                      |
| `expo-local-authentication` | Biométrie (Face ID / empreinte)       | `src/mocks/Biometrics.web.ts`                                                                                   |
| `expo-image-picker`         | Sélection de photos / certificats     | dégradation gracieuse (input fichier navigateur)                                                                |
| `expo-notifications`        | Notifications push (via Firebase)     | désactivé sur web                                                                                               |

## Convention de fallback

- **Extension de plateforme** : `Composant.web.tsx` est chargé sur web à la place de
  `Composant.tsx`. Utilisé pour les écrans/contextes (player, scanner, performance).
- **Mocks** (`src/mocks/*.web.ts`) : stubs neutres pour les modules natifs importés
  transversalement (biométrie, `expo-device`, `expo-sharing`, `BlurView`, `LinearGradient`,
  `RNFS`). Aliasés uniquement pour la cible web — **ne jamais aliaser un paquet installé
  sur la cible native** (cela masquerait le vrai module).

> ℹ️ Quelques mocks historiques subsistent (`TrackPlayer.web.ts`, `Sound.web.ts`,
> `NewRelic.web.ts`) alors que les modules correspondants ont été retirés
> (migration `expo-audio`, monitoring Sentry uniquement). Ils sont sans effet et
> pourront être supprimés lors d'un nettoyage.

## En cas d'ajout d'un module natif

1. Ajouter le plugin dans `app.config.js`.
2. Fournir un fallback web (`*.web.tsx`) ou un mock `src/mocks/*.web.ts` si le module
   est importé sur des chemins partagés avec le web.
3. Vérifier le smoke test correspondant dans [UPGRADES.md](UPGRADES.md).
