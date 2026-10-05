# Documentation modules lies backend-client

Cette documentation decrit les modules metier de FFD Connect en mettant l'accent sur le couplage entre `apps/backend` (NestJS) et `apps/client` (React Native/Expo).

## Objectif

- Expliquer les fonctionnalites par domaine metier.
- Rendre explicites les regles et contraintes.
- Montrer la correspondance entre endpoints backend et usages client.
- Faciliter l'onboarding, la maintenance et les evolutions.

## Vue d'ensemble des domaines

1. `auth-users.md` - Authentification, session, profil utilisateur, roles.
2. `competitions.md` - Competitions, inscriptions, check-in, resultats.
3. `clubs.md` - Espace club, membres, couples, solo teams, politiques.
4. `licenses-wdsf.md` - Licences FFD, renouvellement, verification WDSF.
5. `career.md` - Carriere sportive (partenariats, inscriptions, resultats).
6. `media-tracks-tts.md` - Bibliotheque musicale, processing tracks, annonces TTS.
7. `notifications-reports-health.md` - Notifications, signalement, health/observabilite.
8. `payment.md` - Paiement en ligne des places de competition (HelloAsso).
9. `cross-cutting-rules.md` - Regles transverses, securite, erreurs, retry, navigation.

## Cartographie backend (controllers)

Toutes les routes sont prefixees par `/api/v1` sauf `health` (exclu du prefixe pour le monitoring). Les prefixes ci-dessous sont donnes sans le prefixe global.

- `auth`: `/auth/*`
- `users`: `/users/*`
- `clubs`: `/clubs/*`
- `competitions`: `/competitions/*`
- `licenses`: `/licenses/*`
- `career`: `/career/*`
- `tracks`: `/tracks/*`
- `tts`: `/tts`
- `notifications`: `/notifications/*`
- `reports`: `/reports`
- `payment`: `/payment/checkout`, `/payment/webhook`
- `wdsf`: `/wdsf/*`
- `health`: `/health/*` (hors prefixe `/api/v1`)

### Services internes (sans controller REST)

- `storage` (`apps/backend/src/storage/blob-storage.service.ts`) — stockage de fichiers sur Azure Blob. Ce n'est **pas** un module REST : il n'expose aucun endpoint et est consomme par d'autres modules (par exemple `tracks` pour les pistes audio et `licenses` pour les certificats).
- Infra transverse : `common`, `config`, `prisma`, `redis`, `utils`.

## Cartographie client (features principales)

- `auth`, `settings`, `competitions`, `club`, `license`, `career`, `player`, `performance`.
- Navigation centralisee dans `apps/client/src/navigation/AppNavigator.tsx`.
- Acces API via:
  - `apps/client/src/services/api.ts` (Axios + interceptors + retry)
  - `apps/client/src/services/BackendService.ts` (facade HTTP metier)
  - services feature (`AuthService`, `ClubService`, `TrackService`, etc.).

## Convention de lecture des docs module

Chaque module suit la meme structure:

1. Role metier
2. Fonctionnalites
3. Endpoints backend
4. Integration client
5. Regles metier
6. Flux principal
7. Risques et points d'attention
