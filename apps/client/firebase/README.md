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

`app.config.js` ne pose `googleServicesFile` que si le fichier existe vraiment
sur disque, et ne charge les plugins `@react-native-firebase/*` que si au moins
une plateforme est configurée. Conséquences :

- fichier absent → build OK, **push inactives** sur cette variante, avertissement
  au moment de l'évaluation de la config ;
- fichier déposé → push actives au prochain build natif, **sans toucher à la
  config**.

Attention au cas mixte : si une seule des deux plateformes est configurée, les
plugins Firebase sont actifs et un `prebuild`/build de l'autre plateforme
**échouera** (le plugin RNFB exige son fichier). Un avertissement explicite le
signale. Pour builder les deux plateformes, déposer les deux fichiers.

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
