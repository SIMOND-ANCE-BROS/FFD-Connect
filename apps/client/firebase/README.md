# Config Firebase par variante (non versionnée)

Ce dossier reçoit les fichiers de configuration Firebase (FCM) **d'une variante
autre que la prod**. Ils ne sont **jamais committés** : `.gitignore` ignore tout
`firebase/*` sauf ce README.

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

La **prod** garde ses fichiers historiques versionnés à la racine du package
(`apps/client/GoogleService-Info.plist`, `apps/client/google-services.json`) ;
rien à déposer ici pour elle.

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
