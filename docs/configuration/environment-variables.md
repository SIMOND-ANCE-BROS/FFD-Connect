# Variables d'environnement — Backend

Ce document liste les variables d'environnement du backend FFD-Connect.

**Source de vérité :** `apps/backend/src/config/env.validation.ts`. Un modèle
complet est disponible dans `apps/backend/.env.example`.

## Validation au démarrage

Les variables sont validées au boot par `env.validation.ts` (class-validator +
NestJS `ConfigModule`). Si une variable requise manque ou est mal typée,
**l'application refuse de démarrer** avec une erreur explicite.

Deux variables seulement sont **requises**. Toutes les autres sont optionnelles :
soit elles ont une valeur par défaut, soit la fonctionnalité associée est
désactivée en leur absence.

> Ne pas lire `process.env` directement dans le code — utiliser `ConfigService`
> (NestJS). Voir `CLAUDE.md`.

## Requis

| Variable       | Type   | Rôle                                                                 |
| -------------- | ------ | -------------------------------------------------------------------- |
| `DATABASE_URL` | string | URL de connexion PostgreSQL (`postgresql://user:pass@host:port/db`). |
| `JWT_SECRET`   | string | Clé de signature des JWT. **Minimum 32 caractères** (validé).        |

Génération d'un secret : `openssl rand -base64 32`. Une clé distincte par
environnement, jamais commitée.

## Serveur

| Variable       | Défaut        | Rôle                                                                                                                                                                             |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `development` | `development` \| `production` \| `test`.                                                                                                                                         |
| `PORT`         | `3000`        | Port d'écoute HTTP.                                                                                                                                                              |
| `APP_URL`      | —             | URL publique de l'app (liens dans les emails + callbacks HelloAsso).                                                                                                             |
| `FRONTEND_URL` | —             | URL du site web servant `/reset-password` (liens des emails de réinitialisation de mot de passe et d'invitation). Voir `docs/exploitation/reinitialisation-mot-de-passe-web.md`. |

## CORS

| Variable       | Défaut | Rôle                                            |
| -------------- | ------ | ----------------------------------------------- |
| `CORS_ORIGINS` | —      | Origines autorisées, séparées par des virgules. |

> **Obligatoire en production.** Si `CORS_ORIGINS` est absent lorsque
> `NODE_ENV=production`, l'application quitte sur une erreur fatale (voir
> `src/main.ts`). Ne jamais utiliser `*`.

## Redis

| Variable         | Défaut      | Rôle                                      |
| ---------------- | ----------- | ----------------------------------------- |
| `REDIS_HOST`     | `localhost` | Hôte Redis.                               |
| `REDIS_PORT`     | `6379`      | Port Redis.                               |
| `REDIS_PASSWORD` | —           | Mot de passe Redis (si authentification). |

## API FFD

Intégration avec l'API de la Fédération Française de Danse (compétitions).

| Variable             | Défaut | Rôle                                      |
| -------------------- | ------ | ----------------------------------------- |
| `FFD_API_BASE_URL`   | —      | URL de base de l'API FFD.                 |
| `FFD_API_PATH`       | —      | Chemin de l'endpoint (actions fédérales). |
| `FFD_DANCE_FAMILIES` | —      | Familles de danses à récupérer.           |
| `FFD_EVENT_CATEGORY` | —      | Catégorie d'événements à filtrer.         |
| `FFD_ITEMS_PER_PAGE` | `100`  | Nombre d'éléments par page.               |

## Observabilité

| Variable             | Défaut | Rôle                                                                                                           |
| -------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`         | —      | DSN Sentry. **Absent → tracking des erreurs désactivé.**                                                       |
| `SENTRY_ENVIRONMENT` | —      | Sépare prod et staging dans Sentry (les deux ont `NODE_ENV=production`).                                       |
| `APP_VERSION`        | —      | SHA git du build, injecté par le pipeline de déploiement. Exposé par `/health` pour vérifier le build déployé. |

## Email (Resend)

| Variable            | Défaut | Rôle                                                  |
| ------------------- | ------ | ----------------------------------------------------- |
| `RESEND_API_KEY`    | —      | Clé API Resend (emails transactionnels).              |
| `RESEND_FROM_EMAIL` | —      | Adresse expéditrice (doit être vérifiée dans Resend). |

## Notifications push (Firebase)

| Variable                        | Défaut | Rôle                                                                                       |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | —      | JSON complet du compte de service (injecté depuis Key Vault). **Forme utilisée en cloud.** |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | —      | Chemin vers le fichier de compte de service. Repli pour le développement local.            |
| `FIREBASE_PROJECT_ID`           | —      | ID du projet Firebase.                                                                     |
| `FIREBASE_CLIENT_EMAIL`         | —      | Email du compte de service.                                                                |
| `FIREBASE_PRIVATE_KEY`          | —      | Clé privée du compte de service.                                                           |

Ordre de résolution des credentials par le backend
(`NotificationsService.onModuleInit`) : `FIREBASE_SERVICE_ACCOUNT_JSON`, puis
`FIREBASE_SERVICE_ACCOUNT_PATH`.

Credentials **absents OU invalides** → notifications en **mode mock** (le service
log l'envoi, sans jamais journaliser le token de l'appareil, et ne crashe pas).
« Invalides » couvre aussi bien un JSON illisible ou incomplet qu'une clé privée
malformée ou un fichier de clé introuvable : `cert()` lève dans ces cas, et
l'exception est rattrapée. C'est délibéré et non négociable — une exception
remontée ferait échouer l'init du module NestJS, donc le démarrage du conteneur.
Sur une **rotation de secret sans redéploiement**, il n'existe aucune révision à
rollbacker (déploiement single-revision) et le backend, à `minReplicas=0`,
crash-looperait à chaque réveil. Le symptôme d'un secret cassé est donc
« plus de push » (log `ERROR Failed to initialize Firebase Admin`), jamais
« plus d'API ». Le message du parseur JSON n'est jamais journalisé : il
recopierait une fenêtre du texte source, donc potentiellement un fragment de la
clé privée, dans Log Analytics.

Sur Azure Container Apps il n'y a pas de système de fichiers où déposer une clé :
seul `FIREBASE_SERVICE_ACCOUNT_JSON` est utilisable (référence Key Vault +
managed identity). `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
`FIREBASE_PRIVATE_KEY` sont validées mais **pas encore lues** par le service.

## WDSF (World DanceSport Federation)

Vérification des licences athlètes. Voir `.env.example` pour le détail des deux
modes d'authentification (token API v2 ou Basic Auth v1).

| Variable          | Défaut | Rôle                                       |
| ----------------- | ------ | ------------------------------------------ |
| `WDSF_API_KEY`    | —      | Token API v2 (header `X-WDSF-API-KEY`).    |
| `WDSF_USERNAME`   | —      | Identifiant Basic Auth (API v1, fallback). |
| `WDSF_PASSWORD`   | —      | Mot de passe Basic Auth (API v1).          |
| `WDSF_API_V1_URL` | —      | URL de l'API v1.                           |
| `WDSF_API_V2_URL` | —      | URL de l'API v2.                           |

## GitHub (rapports de bugs)

| Variable       | Défaut | Rôle                                                      |
| -------------- | ------ | --------------------------------------------------------- |
| `GITHUB_TOKEN` | —      | Token d'accès avec permission `repo` (création d'issues). |
| `GITHUB_OWNER` | —      | Propriétaire du dépôt (utilisateur ou organisation).      |
| `GITHUB_REPO`  | —      | Nom du dépôt où créer les issues.                         |

## Paiement (HelloAsso)

| Variable                   | Défaut | Rôle                                         |
| -------------------------- | ------ | -------------------------------------------- |
| `HELLOASSO_WEBHOOK_SECRET` | —      | Secret de validation des webhooks HelloAsso. |

## QR de licence signé (#168)

| Variable            | Défaut | Rôle                                                                                                                                                                                                                                             |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QR_SIGNING_SECRET` | —      | Clé HMAC-SHA256 des QR de licence (≥ 32 caractères, sinon ignorée). **Absent → QR non signés et non vérifiés** (équivalent au mode `off`), le backend démarre quand même. Changer la clé invalide tous les QR déjà émis (passes Wallet compris). |
| `QR_SIGNATURE_MODE` | `warn` | Vérification au check-in : `off` (aucune), `warn` (QR non signé, falsifié ou expiré accepté mais signalé au staff), `enforce` (refusé).                                                                                                          |

Précisions :

- La clé est lue après suppression des espaces en début et fin (`.trim()`). Tout autre générateur de QR (passe Wallet) doit utiliser la même valeur nettoyée.
- Le QR est valable jusqu'à la fin du jour d'expiration de la licence, **à l'heure de Paris**.
- **`enforce` exige un `QR_SIGNING_SECRET` d'au moins 32 caractères** : sans lui, le backend refuse de démarrer (erreur explicite) au lieu de refuser silencieusement tous les check-ins. `off` et `warn` sans secret démarrent normalement (mode `off` de fait).
- **Avant de passer en `enforce`**, chaque utilisateur doit avoir mis à jour l'app **et rouvert sa licence en ligne** au moins une fois : le QR signé n'est mis en cache (E-Licence hors ligne) qu'à ce moment-là. Sinon il présentera encore l'ancien QR non signé, refusé en `enforce`. Rester en `warn` pendant la transition et surveiller les avertissements « QR non vérifié » au check-in.

## Pass Apple Wallet de la licence (#162)

Les cinq variables sont nécessaires. Une seule absente ou invalide ⇒ **fonctionnalité désactivée** : le backend démarre, `appleWalletAvailable` vaut `false` dans la licence (`GET /users/me`, `GET /licenses/my`) et les routes du pass répondent 503. Le pass exige aussi un `QR_SIGNING_SECRET` valide : jamais de pass avec un QR non signé.

| Variable                    | Défaut | Rôle                                                                                               |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `WALLET_APPLE_PASS_CERT`    | —      | Certificat de signature du Pass Type ID (PEM).                                                     |
| `WALLET_APPLE_PASS_KEY`     | —      | Clé privée de ce certificat (PEM, **non chiffrée**). Doit correspondre au certificat.              |
| `WALLET_APPLE_WWDR_CERT`    | —      | Certificat intermédiaire Apple WWDR **G4** (PEM).                                                  |
| `WALLET_APPLE_PASS_TYPE_ID` | —      | Identifiant du type de pass, de la forme `pass.<domaine inversé>` (doit être celui du certificat). |
| `WALLET_APPLE_TEAM_ID`      | —      | Team ID du compte développeur Apple (10 caractères majuscules/chiffres).                           |

Précisions :

- Contenus PEM complets (`-----BEGIN …-----` inclus). Une valeur sur une seule ligne avec des `\n` littéraux est acceptée.
- Au démarrage, le backend vérifie le format des identifiants, la lecture des PEM, la correspondance clé/certificat et l'expiration du certificat ; le motif d'une désactivation est journalisé **sans jamais le contenu des PEM**.
- Un échec de signature à l'exécution répond 503 et remonte dans Sentry (message expurgé des blocs PEM).
- Le certificat de pass expire (1 an) : le renouveler côté Apple puis mettre à jour les deux premières variables. Les pass déjà installés restent valides.
- Aucune requête planifiée : le pass est généré à la demande, sans web service de mise à jour (#167).
- Le lien de téléchargement remis à l'app vaut **5 minutes et 5 téléchargements au plus** (pas un seul : Firefox iOS et d'autres navigateurs récupèrent le fichier plusieurs fois avant de le passer à Wallet). Émettre un nouveau lien remplace le précédent et remet le compteur à zéro. Une requête `HEAD` ne décompte rien.

## Azure AI Vision (OCR licences)

| Variable                | Défaut | Rôle                                                                                                          |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `AZURE_VISION_ENDPOINT` | —      | Endpoint Azure AI Vision. Exemple : `https://nom.cognitiveservices.azure.com`. **Absent → OCR en mode mock.** |

Auth par managed identity (aucune clé téléchargée).

## Azure AI Speech (TTS)

Synthèse vocale de l'application (annonces de compétition). Auth par managed
identity — aucune clé de service n'est stockée.

| Variable                   | Défaut               | Rôle                                                                                                          |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AZURE_SPEECH_ENDPOINT`    | —                    | Endpoint Azure AI Speech. Exemple : `https://nom.cognitiveservices.azure.com`. **Requis si synthèse active.** |
| `AZURE_SPEECH_VOICE`       | `fr-FR-DeniseNeural` | Voix neurale FR (Denise par défaut).                                                                          |
| `AZURE_SPEECH_RESOURCE_ID` | —                    | ARM resource id du compte Speech (optionnel). Utilisé pour l'auth Entra ID.                                   |

## Gemini (obsolète)

La réécriture des annonces TTS par Gemini a été retirée : le client envoie
désormais des annonces rédigées en français, synthétisées telles quelles par
Azure. `GOOGLE_API_KEY` reste acceptée par `env.validation.ts` pour ne pas
casser les environnements qui la définissent encore, mais elle n'est plus lue.

## Azure Blob Storage (uploads)

Stockage sans état des pistes audio et des certificats de licence.

| Variable                          | Défaut    | Rôle                                                                                                                   |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AZURE_STORAGE_ACCOUNT_NAME`      | —         | Compte de stockage (managed identity), ou connection string. **Absent → blob désactivé (fallback local / mode test).** |
| `AZURE_STORAGE_CONTAINER`         | `tracks`  | Conteneur des pistes audio.                                                                                            |
| `AZURE_STORAGE_UPLOADS_CONTAINER` | `uploads` | Conteneur des documents de licence.                                                                                    |

## Flags

| Variable               | Défaut | Rôle                                                                                                                                                                                                                                     |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_IP_BLACKLIST`  | —      | Active le middleware de blacklist d'IP.                                                                                                                                                                                                  |
| `SEED_TEST_TRACKS`     | —      | `"true"` → seed de pistes métronome de test au démarrage. Staging/beta **uniquement**, jamais en production.                                                                                                                             |
| `BETA_AUTO_LICENSE`    | —      | `"true"` → un numéro de licence inconnu est auto-créé à l'inscription (voir ci-dessous). Staging **uniquement**, jamais en production.                                                                                                   |
| `BETA_TESTER_LICENSES` | —      | Numéros de licence des bêta-testeurs à pré-seeder, séparés par des virgules (`scripts/seed-beta-testers.ts`, si `SEED_TEST_TRACKS=true`). Hors du code car ils encodent la date de naissance. Vide → seed sauté. Staging **uniquement**. |

### `BETA_AUTO_LICENSE` (staging uniquement)

Seule la valeur exacte `"true"` l'active ; absente ou toute autre valeur = comportement normal
(numéro inconnu → 404). Une fois activé, `POST /auth/register` crée à la volée, dans la même
transaction que le compte, une licence pour un numéro inconnu (catégorie « Ten Dance », club
fictif « Club bêta-test (licence auto-créée) », validité 1 an), afin que les bêta-testeurs puissent
s'inscrire sans que leur numéro ait été pré-seedé (`scripts/seed-beta-testers.ts`). Les licences
existantes gardent leurs contrôles (déjà rattachée → 409, expirée → 400) ; deux inscriptions
concurrentes sur le même numéro → 409.

La variable n'est pas gérée par Terraform (les Container Apps n'y sont qu'en `data`) : elle se pose
directement sur l'application staging, comme `SEED_TEST_TRACKS` :

```bash
az containerapp update -n backend-staging -g <rg> --set-env-vars BETA_AUTO_LICENSE=true
```

**Ne jamais la poser sur `backend-prod`.**

## Voir aussi

- `apps/backend/.env.example` — modèle à copier vers `.env`.
- `docs/exploitation/isolation-secrets-db.md` — gestion des secrets DB par
  environnement (Azure Key Vault + managed identity).
- `docs/exploitation/deploiement-azure.md` — injection des variables en
  production (Azure Container Apps).
