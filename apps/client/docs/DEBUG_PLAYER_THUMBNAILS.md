# Debug : Player et thumbnails

Si les **poches (thumbnails)** ne s’affichent pas ou que le **bouton Play** ne fait rien en build preview/production, suivez ces étapes.

## 1. Vérifier les logs au lancement

Au démarrage de l’app, le client log :

- **`[config] BACKEND_URL:`**
  - `(vide)` → l’URL de l’API n’est pas définie (voir §2).
  - `https://...` ou `http://...` → l’URL est bien prise en compte.

- **`[config] iOS bloque souvent les requêtes HTTP (ATS)...`**  
  → En production, l’API doit être en **HTTPS**. En HTTP, iOS bloque souvent les requêtes (images + audio).

## 2. Variable d’environnement (preview / production)

Les URLs des pistes et des artworks sont construites avec **BACKEND_URL** (issue de **EXPO_PUBLIC_API_URL**).

- Dans le **profil EAS** (ex. `preview`) : définir **EXPO_PUBLIC_API_URL** = URL de ton backend (ex. `https://api.example.com`).
- Rebuild après modification des variables (elles sont injectées au build).

Si **BACKEND_URL** est vide en build, tu verras `(vide)` dans les logs et ni les thumbnails ni le player ne pourront fonctionner.

## 3. Activer les logs détaillés (player / bibliothèque)

Pour voir les URLs construites et les erreurs de chargement d’images :

- En **dev** : les logs détaillés sont déjà actifs.
- En **build EAS** : ajouter dans l’environnement du profil (ex. `preview`) :  
  **EXPO_PUBLIC_DEBUG_PLAYER=1**  
  Puis refaire un build.

Tu obtiendras notamment :

- **`[Library] Debug first track`** : premier track (raw `filename`/`artwork` de l’API, `computedUrl` / `computedArtwork`).
- **`playTrack called`** : `url: empty` ou `url: length=...`, et `hasArtwork`.
- **`[Library] Artwork load failed`** : échec de chargement d’une image (URI + erreur native).

## 4. Causes fréquentes

| Symptôme                                                               | Piste                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BACKEND_URL `(vide)` en preview                                        | EXPO_PUBLIC_API_URL non défini ou mal nommé dans l’environnement EAS du profil utilisé pour le build.                         |
| Thumbnails vides mais URL correcte dans les logs                       | CORS, certificat HTTPS, ou fichier absent côté backend (`/uploads/<artwork>`). Vérifier que l’URL s’ouvre dans un navigateur. |
| Play ne fait rien, log "Cannot play track without URL"                 | Même cause : BACKEND_URL vide ou piste sans `filename` → URL non construite.                                                  |
| iOS : images et audio ne chargent pas alors que l’URL est en `http://` | App Transport Security : utiliser **HTTPS** pour l’API en production.                                                         |

## 5. Sentry : ne voit pas les logs / erreurs

- **Vérifier le DSN** : `EXPO_PUBLIC_SENTRY_DSN` doit être une **vraie** URL (pas le placeholder `https://...@...ingest.sentry.io/...`). En dev : dans `apps/client/.env`. En build EAS : dans les variables d’environnement du profil (preview/production).
- **Rebuild après changement** : les variables `EXPO_PUBLIC_*` sont injectées au **build**. Après modification du DSN sur EAS, refaire un build.
- **Message de test** : au démarrage, l’app envoie un message « FFD Connect app started » (niveau info). S’il n’apparaît pas dans Sentry, le DSN n’est pas pris en compte ou le SDK n’est pas initialisé.
- **En dev** : lancer avec `pnpm start` (ou `expo start`) et regarder la console. Si Sentry est initialisé avec `debug: true`, des logs Sentry s’affichent. Vérifier aussi que `.env` contient bien `EXPO_PUBLIC_SENTRY_DSN=` avec ton DSN réel.
- **Projet Sentry** : dans Sentry, vérifier que tu regardes le bon **projet** (ex. `ffd-client`) et la bonne **organisation** (ex. `gabin-simond`).

---

## 6. Voir les logs sur iPhone (app installée via QR)

En build preview, l’app tourne sur l’appareil sans Metro. Pour savoir pourquoi la bibliothèque est vide ou le player ne marche pas :

### Option A : Sentry (recommandé)

Si **EXPO_PUBLIC_SENTRY_DSN** est configuré (profil EAS preview), l’app envoie déjà des erreurs à Sentry. On a ajouté des **breadcrumbs** pour la bibliothèque :

- Ouvre le **dashboard Sentry** de ton projet.
- Va dans **Issues** ou **Discover**.
- Après avoir ouvert l’onglet Bibliothèque sur ton iPhone, tu devrais voir :
  - un breadcrumb **"Loading library"** avec un aperçu de `backendUrl` (ou `(vide)`),
  - soit **"Library loaded"** avec `count` et `hasMore`,
  - soit **"Library load failed"** + une erreur (ex. réseau, 401, 404),
  - ou un message **"Library empty (0 tracks from API)"** si l’API renvoie 0 pistes.

Tu peux aussi déclencher un **test** manuel : dans l’app, ouvre la bibliothèque puis vérifie dans Sentry les derniers événements / breadcrumbs pour cette session.

### Option B : Safari Web Inspector (Mac + câble)

Pour voir la **console JavaScript** de l’app sur ton iPhone :

1. **iPhone** : Réglages > Safari > Avancé > **Inspecteur Web** = activé.
2. Connecte l’iPhone au Mac en **USB**, déverrouille et accepte « Faire confiance » si demandé.
3. **Mac** : Ouvre **Safari** > menu **Développement** > [nom de ton iPhone] > choisis **Expo** ou **FFD Connect** (ou l’entrée correspondant à l’app).
4. La console s’ouvre : tu vois les `console.log` / `console.warn` (ex. `[config] BACKEND_URL`, `[Library] Debug first track` si `EXPO_PUBLIC_DEBUG_PLAYER=1`).

**Note :** Sur un build **release** (preview/production), la console peut être limitée ou vide. Les breadcrumbs Sentry restent alors la solution la plus fiable.

### Option C : Build dev + Metro (logs en direct)

Pour avoir les logs en direct comme en dev :

1. Installe un **build development** sur l’iPhone (`pnpm run build:dev`, puis installe via le lien fourni par EAS).
2. Lance Metro sur ton Mac : `cd apps/client && pnpm start`.
3. Ouvre l’app sur l’iPhone ; elle se connecte à Metro et les logs s’affichent dans le terminal.

---

## 7. Taille de l’archive EAS (390 Mo → moins)

Les scripts `pnpm run build:beta` et `pnpm run build:beta:ios` sont exécutés **depuis la racine du repo** (pas depuis `apps/client`). L’archive est donc créée à la racine et le fichier **racine** **`.easignore`** s’applique (exclusion de `apps/backend/`, `apps/landing/`, etc.). Pour que ça reste le cas, lance bien le build depuis la racine : `pnpm run build:beta:ios`.

---

## 8. Vérifications côté backend

- **GET /tracks** : chaque élément doit avoir `filename` (pour l’URL de la piste) et si possible `artwork` (nom de fichier, ex. `xxx.jpg`).
- Les fichiers doivent être servis sous **/uploads/** (ex. `GET /uploads/track.jpg`).
- En production, le domaine de l’API doit être en **HTTPS** pour éviter les blocages iOS.
