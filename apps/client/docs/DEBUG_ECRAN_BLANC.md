# Debug écran blanc

## En build Preview (écran blanc dès l’ouverture)

Le profil **preview** dans `eas.json` a `EXPO_PUBLIC_DEBUG_BOOT=1`. Après un nouveau build preview :

1. **Ouvre l’app** → tu dois voir en haut un **bandeau orange « App OK »**.
2. **Si tu vois le bandeau** → le JS et la racine React rendent. Le blanc vient de plus bas (navigation, écran Login, ou un provider). Prochaine étape : simplifier l’arbre (voir §3) ou vérifier LoginScreen / NavigationContainer.
3. **Si tu ne vois pas le bandeau** → crash ou blocage **avant** le premier rendu (bundle JS, import, erreur native). Vérifier Sentry, ou tester un build minimal (voir §5).

Pour enlever le bandeau en preview une fois le bug trouvé : retirer `EXPO_PUBLIC_DEBUG_BOOT` du profil `preview` dans `eas.json` et refaire un build.

---

## 1. Voir les erreurs JS (recommandé en dev)

En **build développement** avec Metro, les erreurs s’affichent en rouge dans l’app et dans le terminal.

```bash
cd apps/client && pnpm run ios
# ou
pnpm run start:dev
# puis ouvrir l’app sur le simulateur (dev client)
```

- **Écran rouge** → lire la stack trace (fichier + ligne).
- **Écran blanc** → regarder le **terminal Metro** : la dernière erreur avant le blanc est souvent la cause.

## 2. Bandeau « App OK » (dev uniquement)

En `__DEV__`, un bandeau vert **« App OK »** en haut de l’écran indique que la racine React a rendu.

- **Bandeau visible** → le problème vient d’un écran ou de la navigation (plus bas dans l’arbre).
- **Pas de bandeau** → crash ou blocage avant le premier rendu (regarder Metro, ou erreur native).

## 3. Cibler un provider ou un écran

Pour savoir **quel bloc** provoque le blanc, commenter temporairement des parties de l’arbre dans `App.tsx` :

1. **Navigation seule**  
   Remplacer tout le contenu de `ThemedAppContent` par un `<Text>Nav OK</Text>`.
   - Si tu vois « Nav OK » → problème dans un écran (ex. Login, Main, onglets).
   - Si toujours blanc → problème dans un des providers (Theme, Auth, Club, Track, Library, etc.).

2. **Providers un par un**  
   Commenter un provider (et son contenu) à la fois, par exemple :
   - `LibraryProvider` + tout ce qu’il enveloppe,
   - puis `TrackProvider`,
   - puis `ClubProvider`,
   - etc.  
     Revenir en arrière dès que l’écran réapparaît : le dernier provider décommenté est suspect.

## 4. Build preview / production (pas de Metro)

En build **preview** ou **production**, il n’y a pas d’écran rouge ni de logs Metro.

- **Sentry** : si configuré, vérifier les erreurs/crashes pour la même version.
- **Tester en dev** : reproduire le scénario (même écran, même action) avec `pnpm run ios` et regarder Metro + bandeau « App OK ».

## 5. Build minimal (si en preview tu ne vois même pas « App OK »)

Pour vérifier que le build preview affiche bien du contenu :

1. Dans `App.tsx`, **remplace temporairement** tout le contenu du return de `App` par :
   ```tsx
   return (
     <GestureHandlerRootView style={[styles.root, { backgroundColor: "#333" }]}>
       <View
         style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
       >
         <Text style={{ color: "#fff", fontSize: 18 }}>FFD Connect OK</Text>
       </View>
     </GestureHandlerRootView>
   );
   ```
2. Build preview, installe, ouvre l’app.
3. **Si tu vois « FFD Connect OK »** → le bundle et le natif vont bien, le blanc vient de ton arbre React (providers / navigation / écrans). Remets le vrai `App` et cible avec §3.
4. **Si l’écran reste blanc** → problème plus bas niveau (splash qui ne se cache pas, crash natif avant React, ou config de build).

## 6. Vérifications utiles

- **ErrorBoundary** : en cas d’erreur React attrapée, l’écran « Oups ! » s’affiche (pas un écran totalement blanc).
- **Écran blanc sans « Oups ! »** : souvent une erreur **avant** le rendu (import, config, module natif) ou une **promise non gérée** qui fait planter le JS.
- **Logs natifs** (Console.app / Xcode) : filtrer sur ton bundle ID (`fr.ffdanse.connect`) pour les crashs natifs ; les messages `locationd`, `cloudd`, etc. sont du système, pas de l’app.

## Résumé

**En preview (écran blanc dès l’ouverture)**

1. Refaire un build preview (le profil a déjà `EXPO_PUBLIC_DEBUG_BOOT=1`).
2. Ouvrir l’app : vois-tu le **bandeau orange « App OK »** en haut ?
   - **Oui** → le problème est plus bas (navigation, Login, providers). Simplifier l’arbre (§3) ou inspecter LoginScreen.
   - **Non** → crash avant le premier rendu. Tester le build minimal (§5) ou Sentry.

**En dev**

1. Lancer avec Metro, regarder le terminal et le bandeau vert « App OK ».
2. Simplifier l’arbre (écrans / providers) pour trouver le bloc en cause.
3. Corriger l’erreur indiquée par la stack trace ou par le provider identifié.
