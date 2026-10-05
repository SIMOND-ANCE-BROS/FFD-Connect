# ADR-0018: Firebase Cloud Messaging pour les notifications push

**Date**: 2026-04-27
**Status**: accepted
**Deciders**: Gabin Simond

## Context

L'application cliente Expo doit envoyer des notifications push cross-platform (iOS + Android) pour les mises à jour d'événements et de compétitions. Le besoin couvre l'envoi côté backend et la réception côté client mobile.

## Decision

Utiliser **Firebase Cloud Messaging (FCM)**.

- **Client** : `@react-native-firebase/app` + `@react-native-firebase/messaging`. Intégration en workflow managed Expo via config plugin ; le fichier de configuration Firebase (`GoogleService-Info.plist` iOS, `google-services.json` Android) est appliqué au bundle id de production via `googleServicesFile` dans `app.config.js`.
- **Backend** : `firebase-admin` pour l'envoi (`apps/backend/src/notifications/`). Les credentials sont fournis soit via `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`, soit via `FIREBASE_SERVICE_ACCOUNT_PATH`. En l'absence de credentials, le service bascule en mode mock (pas d'envoi réel).

> **Mise à jour 2026-09-07** — le backend lit désormais en priorité `FIREBASE_SERVICE_ACCOUNT_JSON` (contenu JSON complet du compte de service, injecté depuis Key Vault), `FIREBASE_SERVICE_ACCOUNT_PATH` restant en repli pour le développement local : Azure Container Apps n'offre aucun système de fichiers où déposer un fichier de clé. Les tokens d'appareil sont stockés côté backend dans `DeviceToken` (`POST` / `DELETE /notifications/device-token`) et les tokens rejetés par FCM comme non enregistrés sont supprimés à l'envoi.
>
> Contrat de dégradation : credentials **absents ou invalides** → mode mock. La résolution complète des credentials (y compris les appels `cert()`, qui lèvent sur un PEM malformé ou un fichier illisible) est protégée : une exception ferait échouer l'init du module NestJS, donc le démarrage du conteneur — et sur une rotation de secret sans redéploiement, il n'y a aucune révision à rollbacker (déploiement single-revision, `minReplicas=0`). Perdre le push est acceptable ; perdre l'API ne l'est pas.
>
> Garde-fous ajoutés dans la même foulée :
>
> - **Anti-abus** : `POST /notifications/device-token` est limité à 5 appels/min et par utilisateur (`ThrottlerUserGuard`), le nombre d'appareils est plafonné à 20 par utilisateur **à l'écriture** (les plus anciens par `lastSeenAt` sont supprimés), et le token entrant est borné à 512 caractères (les tokens FCM font 160-200).
> - **Rétention** (RGPD art. 5.1.e) : purge des tokens sans ré-enregistrement depuis 90 jours, accrochée au cron horaire existant `SessionCleanupService` — pas de nouvelle planification, donc aucun réveil du conteneur scale-to-zero. Le nettoyage sur retour FCM ne suffisait pas : un token hors du top 20 ne reçoit jamais d'envoi, donc ne peut jamais être déclaré mort.
> - **Service externe** : l'envoi FCM passe par le circuit breaker opossum (clé `fcm`) + `withTimeout` (5 s), conformément à l'ADR-0009 — nécessaire dès lors qu'un producteur appelle `sendToUser` depuis un chemin HTTP et peut fanoutter sur 20 appareils.
> - **Premier producteur réel branché** : la validation d'inscription par le club (`RegistrationNotificationService.notifyOnConfirm`) appelle `sendToUser` (push + feed in-app). Les autres producteurs restent sur `createForUser` (feed seul) le temps de valider la chaîne de bout en bout. L'envoi est best-effort : un échec FCM ne fait jamais échouer l'inscription.
> - **RGPD** : l'export de données (art. 15/20) liste les appareils en métadonnées (`platform`, `createdAt`, `lastSeenAt`) sans la valeur du token — l'exporter en clair permettrait de détourner la livraison, l'upsert d'enregistrement étant volontairement ré-attributif.

## Alternatives Considered

### Alternative 1: Expo Push Notifications (expo-notifications)

- **Pros**: Intégration Expo native, pas de configuration Firebase côté client
- **Cons**: Couche d'abstraction supplémentaire au-dessus de FCM/APNs, moins de contrôle sur le payload
- **Why not**: FCM offre un contrôle direct et un backend d'envoi unifié via `firebase-admin`

### Alternative 2: APNs + FCM gérés séparément

- **Pros**: Contrôle total par plateforme
- **Cons**: Deux intégrations distinctes à maintenir côté backend
- **Why not**: FCM fédère iOS (via APNs) et Android derrière une seule API d'envoi

## Consequences

### Positive

- Push natif fiable sur iOS et Android
- Intégration Expo via config plugin, sans quitter le workflow managed
- Envoi backend unifié via `firebase-admin`

### Negative

- Nécessite un build natif (incompatible Expo Go)
- Dépendance à un service Google
