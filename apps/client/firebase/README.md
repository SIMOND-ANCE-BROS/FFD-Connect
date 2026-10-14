# Config Firebase par variante (non versionnée)

Ce dossier reçoit les fichiers de configuration Firebase (FCM) **de chaque
variante, prod comprise**. Ils ne sont **jamais committés** : `.gitignore` ignore
tout `firebase/*` sauf ce README.

Toutes les variantes sont des apps du **même** projet Firebase (`ffd-connect-app`).
Ne jamais reprendre un fichier d'un autre projet : un ancien repli embarquait la
config d'un projet supprimé, avec des push mortes sans aucune erreur.

## Convention de nommage

`<env>` est la valeur de `EXPO_PUBLIC_APP_ENV` :
`development` | `preview` | `beta` | `production`.

| Plateforme | Fichier attendu                           | Bundle id / package         |
| ---------- | ----------------------------------------- | --------------------------- |
| iOS        | `firebase/GoogleService-Info.<env>.plist` | voir `BUNDLE_ID` ci-dessous |
| Android    | `firebase/google-services.<env>.json`     | idem                        |

| `<env>`       | Bundle id / package          |
| ------------- | ---------------------------- |
| `production`  | `fr.ffdanse.connect`         |
| `beta`        | `fr.ffdanse.connect.beta`    |
| `preview`     | `fr.ffdanse.connect.staging` |
| `development` | `fr.ffdanse.connect.dev`     |

La **prod** n'a plus de fichier versionné à la racine du package : elle suit la
même convention que les autres variantes (`firebase/*.production.*` ou variable
EAS).

## Comportement si un fichier manque

Il dépend de la variante :

- **`preview`, `beta`, `production`** (variantes distribuées) : les plugins
  `@react-native-firebase/*`, l'entitlement APNs et `UIBackgroundModes` sont
  **toujours** actifs, que le fichier soit présent ou non. Un prebuild/build sans
  le fichier **échoue** (le plugin RNFB exige son fichier) — mieux qu'un binaire
  distribué sans push. Hors builder EAS c'est la norme (le secret n'existe que
  là-bas) : pour un prebuild local d'une de ces variantes, déposer le fichier ici.
- **`development`** : `googleServicesFile` n'est posé et les plugins ne sont
  chargés que si un fichier existe (push inactives sinon), pour que
  `expo run:ios` marche sans config Firebase.

Pourquoi pas « actif seulement si le fichier existe » partout : la
`runtimeVersion` est une empreinte de la config évaluée. Le fichier n'existant
que sur le builder EAS, l'empreinte du runner GitHub (sans Firebase) et celle
du builder (avec) divergeaient, et EAS refusait le build (« Runtime version
mismatch »). Le contenu du fichier est aussi exclu de l'empreinte
(`fingerprint.config.js`) : **changer ce fichier exige un build natif lancé à la
main**, aucune empreinte ne le détectera.

## Builds EAS / CI

Un build lancé depuis CI part d'un checkout neuf : les fichiers ignorés par git
n'y sont pas. Il faut alors les fournir en **variable d'environnement EAS de type
`file`**, nommée par variante (le suffixe est obligatoire car `preview` et `beta`
partagent l'environnement EAS `preview` avec deux bundle ids différents) :

| Plateforme | Variable EAS                      |
| ---------- | --------------------------------- |
| iOS        | `GOOGLE_SERVICE_INFO_PLIST_<ENV>` |
| Android    | `GOOGLE_SERVICES_JSON_<ENV>`      |

EAS écrit le fichier sur le disque du builder et la variable contient son chemin,
que `app.config.js` résout en priorité.

Les builds natifs sur **runner GitHub** (`eas build --local`, #508 — chemin par
défaut de `build-staging`, `build-production` et `promote-beta`) n'ont pas accès
aux variables EAS secrètes : ils lisent la même config depuis un **secret
d'environnement GitHub** encodé en base64, et vérifient avant le build que le
fichier contient bien le package / bundle id de la variante.

| Variante     | Environnement GitHub | Secrets                                                                     |
| ------------ | -------------------- | --------------------------------------------------------------------------- |
| `preview`    | `preview`            | `FIREBASE_IOS_PLIST_PREVIEW_B64`, `FIREBASE_ANDROID_JSON_PREVIEW_B64`       |
| `beta`       | `testflight-build`   | `FIREBASE_IOS_PLIST_BETA_B64`, `FIREBASE_ANDROID_JSON_BETA_B64`             |
| `production` | `app-production`     | `FIREBASE_IOS_PLIST_PRODUCTION_B64`, `FIREBASE_ANDROID_JSON_PRODUCTION_B64` |

Une variante distribuée doit donc avoir son fichier aux **deux** endroits
(variable EAS pour un build cloud, secret GitHub pour un build sur runner).

## Ajouter une plateforme à une variante (première fois)

Symptôme d'une app absente : prebuild en échec sur
`Path to google-services.json is not defined` (Android) ou
`Path to GoogleService-Info.plist is not defined` (iOS), ou, sur runner GitHub,
`secret FIREBASE_…_B64 absent de l'environnement GitHub de ce job`.

1. Firebase Console, projet `ffd-connect-app` → _Paramètres du projet_ →
   _Ajouter une application_ → Android, package de la variante (tableau
   ci-dessus), ou iOS, bundle id. Pour Android, ajouter l'empreinte SHA-1 du
   keystore de la variante si une fonction Firebase l'exige (`eas credentials`).
2. Télécharger `google-services.json` (ou le plist) dans
   `apps/client/firebase/google-services.<env>.json`. Le json téléchargé contient
   tous les clients Android du projet : vérifier qu'il contient le package
   attendu (`jq '.client[].client_info.android_client_info.package_name'`).
3. Variable EAS (build cloud), depuis `apps/client` :

   ```bash
   eas env:set <env-eas> --name GOOGLE_SERVICES_JSON_<ENV> --type file \
     --value ./firebase/google-services.<env>.json --visibility secret
   ```

   (`<env-eas>` = `preview` pour `preview` et `beta`, `production` pour
   `production`.)

4. Secret GitHub (build sur runner), depuis la racine du dépôt : commandes dans
   `docs/exploitation/ci-cd.md`, section « Builds natifs sur runner GitHub ».
5. Lancer un build natif de la variante pour la plateforme : l'empreinte ne
   change pas, la CI ne le fera pas d'elle-même.

## Changer un fichier (rotation)

Le contenu de ces fichiers est **hors empreinte** (`fingerprint.config.js`) :
après une mise à jour de la variable EAS, ni la CI ni l'empreinte ne déclenchent
de build natif, et les OTA continuent de cibler les binaires construits avec
l'ancien fichier. Il faut donc :

1. mettre à jour la variable EAS `file` de la variante (environnement EAS
   `preview` pour `preview` et `beta`, `production` pour `production`) ;
2. lancer **à la main** un build natif pour chaque profil et chaque plateforme
   concernés ;
3. distribuer ce binaire : seuls les appareils qui l'installent utilisent la
   nouvelle config.

Procédure détaillée (commandes, déclenchement par profil) :
`docs/exploitation/ci-cd.md`, section « Rotation de la config Firebase ».
