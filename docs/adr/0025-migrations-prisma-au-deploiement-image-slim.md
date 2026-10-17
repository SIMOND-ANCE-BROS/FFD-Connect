# ADR-0025: Migrations Prisma exécutées au déploiement, image runtime sans CLI Prisma

**Date**: 2026-10-16
**Status**: accepted (2026-10-16)
**Deciders**: Gabin Simond (analyse : agent architect)

Décision : Gabin, 2026-10-16. Démarrage par la phase 0 sur staging ; résultats dans [Mesures de la phase 0](../exploitation/migrations-adr-0025-phase-0.md).

**Avancement** : phase 0 terminée (2026-10-16). **Phase 1 en cours** sur staging, en **option A** (Gabin, 2026-10-18 ; voir [Phase 1 : option A](#phase-1--option-a-2026-10-18)) ; runbook : [Migrations par job Container Apps](../exploitation/migrations-job-adr-0025.md).

## Context

Aujourd'hui, `apps/backend/docker-entrypoint.sh` lance `prisma migrate deploy` **à chaque démarrage de conteneur**, avant `node dist/src/main.js`. En cas d'échec, le conteneur sort en code 1. Il en découle trois choses :

- **La CLI Prisma est une dépendance runtime** (`prisma` est dans les `dependencies` du backend). L'image de production embarque donc la CLI, le binaire du schema engine (`@prisma/engines`) et les dépendances de la CLI 7.10 : `@prisma/dev`, `@prisma/studio-core` (React / React DOM), `mysql2`, `postgres` et `typescript` en dépendance optionnelle. Rien de tout cela ne sert à l'application, qui passe par `@prisma/client` et `@prisma/adapter-pg`.
- **Les migrations tournent à chaque réveil.** Le backend est en `minReplicas = 0` (ADR-0019) : chaque réveil paie un cold start de ~60-120 s (pull de l'image, migrations, boot NestJS). Quand le schéma est à jour, `migrate deploy` ne fait rien, mais il coûte quand même un démarrage de la CLI, le lancement du schema engine, une connexion TLS à PostgreSQL et la prise d'un verrou consultatif (advisory lock).
- **La disponibilité de l'app dépend de l'état des migrations en base.** Si une migration échoue, elle reste marquée en échec dans `_prisma_migrations`. D'après le comportement documenté de Prisma (P3009), `migrate deploy` refuse alors de s'exécuter tant que la migration n'est pas résolue (`prisma migrate resolve`). Comme chaque réveil passe par `migrate deploy`, **aucune image ne redémarre plus, y compris l'image précédente rappelée par le rollback automatique** (`deploy-backend.yml`). Sur une app scale-to-zero, l'ancienne révision ne tourne pas en permanence pour amortir le problème : au prochain réveil, elle exécute l'entrypoint et bute sur la même erreur.

Ce qui est déjà acquis et que cette décision ne doit pas faire régresser :

- **ADR-0017** et le contrôle CI `scripts/check-migrations.ts` (#494) : les migrations sont **additives**, sauf marqueur d'approbation explicite. C'est ce qui rend le rollback par image sûr, puisque le schéma peut avoir une version d'avance sur le code.
- **#618 / #486** : la porte Trivy (HIGH/CRITICAL corrigeables) et le retrait de npm, npx, corepack et yarn du stage runtime.
- **#430** (taille d'image) et **#415** (résolution des migrations Prisma 7 multi-fichiers via `--schema=./prisma/schema`).
- Le déploiement single-revision avec smoke test (`/health` doit renvoyer `version` == SHA déployé) et rollback automatique.
- Les secrets DB par environnement, en Key Vault et lus par identité managée (`docs/exploitation/isolation-secrets-db.md`).
- La purge ACR qui recense **toutes** les révisions des apps **et des jobs** avant toute suppression (incident #681).

Un point ouvert est lié à cette décision sans en faire partie : l'image n'est pas reproductible, car le stage `deploy` lance `pnpm deploy --prod --legacy`, qui résout les dépendances sans tenir compte du lockfile.

L'issue #32, partie (b), demande de trancher entre la migration au boot et la migration au déploiement.

## Decision

**Les migrations Prisma sont exécutées par un job Azure Container Apps dédié, déclenché par `deploy-backend.yml` avant de basculer l'app vers la nouvelle image. L'image runtime ne contient plus la CLI Prisma et ne lance plus aucune migration.**

### Artefacts

- Le `Dockerfile` produit **deux cibles à partir des mêmes stages `deps` et `build`**, dans le même build CI, donc avec la même résolution de dépendances :
  - **`production`** : l'image de l'app. Elle contient `dist`, le client Prisma généré et les `node_modules` de prod **sans** `prisma` ni `@prisma/engines`. `prisma` passe en `devDependencies`. La génération du client se fait dans le stage `deploy` avec la CLI du stage `build`. L'entrypoint ne fait plus que les seeds staging et `exec node`.
  - **`migrate`** : une image minimale dédiée aux migrations. Elle contient la CLI Prisma (version épinglée du lockfile), `prisma/schema` (migrations comprises) et rien d'autre. `CMD` = `prisma migrate deploy --schema=./prisma/schema`.
- Les deux images sont poussées avec **le même tag SHA**, dans deux repositories ACR : `ffd-connect-backend:<sha>` et `ffd-connect-backend-migrate:<sha>`. Le tag reste un SHA pur, pour que `acr-purge.sh` applique la même rétention aux deux repositories. Un suffixe `-migrate` ferait du tag un tag « non-SHA », que le script conserve indéfiniment.

### Jobs Container Apps

- Un job par environnement, `backend-migrate-staging` et `backend-migrate-prod`, dans l'environnement Container Apps existant, donc avec le même accès réseau à PostgreSQL que les apps.
- Paramètres :
  - déclenchement **manuel** (`triggerType: Manual`) ;
  - `parallelism = 1`, `replicaCompletionCount = 1` ;
  - **`replicaRetryLimit = 0`** : une migration en échec n'est jamais rejouée automatiquement ;
  - `replicaTimeout = 600` s ;
  - 0,5 vCPU / 1 Gi.
- La chaîne de connexion à la base utilise **la même référence Key Vault et la même identité managée que l'app du même environnement**, si cette identité est assignée par l'utilisateur. Sinon, une attribution RBAC supplémentaire, limitée au même secret. Aucun nouveau secret, aucun secret dans GitHub.
- Les jobs et le rôle CI sont déclarés en Terraform. Le rôle personnalisé, limité aux deux jobs, autorise le démarrage d'une exécution, la lecture des exécutions et la mise à jour de l'image du job.

### Workflow `deploy-backend.yml`

Nouvelle étape entre « Capture current image » et « Deploy to Container Apps », pour staging comme pour prod :

1. `az containerapp job update --image <acr>/ffd-connect-backend-migrate:<sha>` ;
2. `az containerapp job start`, puis suivi de l'exécution jusqu'à `Succeeded` ou `Failed` (délai max 10 min). Les logs de l'exécution sont affichés dans le job GitHub ;
3. **en cas d'échec, le workflow s'arrête AVANT `containerapp update`**. L'app reste sur son image actuelle et l'étape de rollback n'a pas lieu d'être.

La concurrence est déjà sérialisée par le groupe global `deploy-backend`. En dernier recours, le verrou consultatif de `prisma migrate deploy` protège contre une exécution manuelle lancée en même temps.

### Contrôle du schéma au démarrage (sans CLI)

L'image `production` connaît, depuis le build, le nom de la **dernière migration attendue** (dernier dossier de `prisma/schema/migrations`). Au démarrage, une lecture `SELECT` sur `_prisma_migrations` via le client Prisma vérifie qu'elle est appliquée. `/health` expose `database.schema: "ok" | "behind"`, et le smoke test exige `"ok"`.

Ce contrôle ne bloque **pas** le démarrage, pour qu'un réveil ne casse jamais à cause de lui. Il attrape une image déployée sans que son job ait tourné (déploiement manuel, redémarrage de prod). Une image plus ancienne, après un rollback, attend une migration plus ancienne, donc déjà présente : le contrôle reste `"ok"`.

### Exploitation

- **Migration en échec** :
  1. diagnostiquer avec une exécution du job lancée avec la commande `prisma migrate status` ;
  2. corriger la base si besoin ;
  3. lancer `prisma migrate resolve --rolled-back|--applied <nom>` par le même mécanisme.

  Ce runbook sera ajouté à `deploiement-azure.md`.

- **Redémarrage de `backend-prod`** : prod est arrêtée et sa base est en retard depuis le gel de `master`. Il faut lancer `backend-migrate-prod` sur l'image cible **avant** de redémarrer l'app et de la déployer.
- **Local (`docker compose --profile full`)** : ajout d'un service ponctuel `migrate` (cible `migrate`), dont dépend le backend (`depends_on: condition: service_completed_successfully`).

### Plan de migration (chaque phase est additive et réversible)

| Phase                                          | Contenu                                                                                                                                                                                                                                                                                                                                        | Réversibilité                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **0. Mesurer** (sans changement)               | <ul><li>Mesurer dans les logs Container Apps la durée de `migrate deploy` à vide lors d'un réveil.</li><li>Mesurer le poids de la CLI dans l'image.</li><li>Vérifier sur une base jetable le comportement P3009 avec une image plus ancienne.</li><li>Prérequis : passer à un `pnpm deploy` qui respecte le lockfile (issue dédiée).</li></ul> | sans objet                                                        |
| **1. Job en parallèle** (staging)              | <ul><li>Cible `migrate`, repository ACR, job `backend-migrate-staging`, étape dans le workflow staging.</li><li>**L'entrypoint migre toujours** : le job applique, le boot ne trouve rien à faire.</li><li>Valider sur au moins 5 déploiements staging, dont un avec une vraie migration.</li></ul>                                            | supprimer l'étape du workflow                                     |
| **2. Arrêt de la migration au boot** (staging) | <ul><li>L'entrypoint lit `MIGRATE_ON_BOOT` : `true` par défaut, `false` sur `backend-staging`.</li><li>Ajout du contrôle de schéma dans `/health` et dans le smoke test.</li></ul>                                                                                                                                                             | remettre `MIGRATE_ON_BOOT=true` (nouvelle révision, sans rebuild) |
| **3. Image slim**                              | <ul><li>`prisma` passe en `devDependencies` ; la cible `production` n'a plus la CLI.</li><li>La branche « migrate » de l'entrypoint et la variable `MIGRATE_ON_BOOT` disparaissent.</li><li>Mise à jour de la documentation d'exploitation, de `docker-compose.yml` et de l'agent infra.</li></ul>                                             | revert du commit                                                  |
| **4. Prod**                                    | Job `backend-migrate-prod` et étape prod, appliqués **au redémarrage de prod**, pas avant.                                                                                                                                                                                                                                                     | identique à la phase 1                                            |

### Résultats de la phase 0 (2026-10-16)

Détail, méthode et commandes : [Mesures de la phase 0](../exploitation/migrations-adr-0025-phase-0.md).

- **Réveil de `backend-staging`** (image de 482 Mo) : 29,5 s jusqu'à la première réponse quand Redis est déjà réveillé, 57,5 s quand Redis dort aussi. Le pull de l'image et la création du conteneur prennent 18 à 21 s, soit environ deux tiers du réveil. `migrate deploy` à vide prend environ **3 à 6 s** sur 0,5 vCPU, soit 10 à 20 % du réveil (1,3 s sur un poste de dev). Le boot NestJS jusqu'à l'écoute prend environ 5 s.
- **Poids de la CLI** : 111 paquets, environ **236 Mio** sur les 833 Mio de `node_modules` du bundle (environ 28 %). Les plus gros sont `@prisma/studio-core`, `prisma`, `effect`, `@prisma/engines`, `@electric-sql/pglite` et `@prisma/dev`.
- **P3009 confirmé** sur une base jetable : après l'échec d'une migration, `migrate deploy` sort en code 1 à chaque démarrage, **y compris avec l'image précédente**, qui ne contient pas la migration fautive. `migrate resolve --rolled-back` lancé depuis l'image précédente débloque. **La migration en échec était appliquée à moitié** : la colonne ajoutée par sa première instruction est restée en base. Avec un `BEGIN; … COMMIT;` explicite, rien n'est resté.
- **Prérequis lockfile** : déjà rempli par #692 (le `Dockerfile` n'utilise plus `pnpm deploy --legacy`). Le point ouvert du contexte et le risque « Résolution non reproductible » sont donc levés.
- **Identité** : `backend-staging` utilise une identité managée **attribuée par le système**. Le job ne pourra pas la partager : il faudra l'attribution RBAC supplémentaire prévue, limitée au secret Key Vault de la chaîne de connexion staging.

### Phase 1 : option A (2026-10-18)

Décision de Gabin : la phase 1 **réutilise l'image de l'app**, qui contient encore la CLI Prisma, au lieu de produire tout de suite la cible `migrate` et son repository ACR. Ce qui change par rapport au plan ci-dessus, pour la phase 1 seulement :

- **Pas de cible `migrate` ni de repository `ffd-connect-backend-migrate`** : ils arrivent en phase 3, quand la CLI sort de l'image de l'app. Aucun stockage ACR en plus, aucun push de plus par build.
- **Démarrage par surcharge, sans `job update`** : chaque exécution reçoit l'image `ffd-connect-backend:<sha>`, la commande `prisma migrate deploy --schema=./prisma/schema` et `DATABASE_URL` (via l'API `jobs/start`). Le rôle CI n'a donc pas besoin de `jobs/write`. Le modèle du job porte une image publique d'attente : il n'épingle aucun tag ACR.
- **Identité propre au job** (attribuée par l'utilisateur), `Key Vault Secrets User` limité au secret `db-url-staging`, plus `AcrPull`, comme prévu pour le cas d'une identité d'app attribuée par le système.
- **Aucun texte de log dans les journaux Actions** (dépôt public, #774) : le workflow n'affiche qu'un résumé (nombre de lignes, codes Prisma et SQLSTATE) ; le détail se lit en local. L'environnement n'a **pas de Log Analytics** : les logs d'une exécution sont perdus une fois le réplica nettoyé.
- **Coût** : ≈ 0 € (exécutions dans l'offre gratuite Container Apps, minutes Actions gratuites sur dépôt public, aucun stockage ACR en plus).
- La purge ACR recense aussi les images des exécutions de jobs non terminées.
- Lignes de l'entrypoint horodatées (recommandation 2 de la phase 0).

Implémentation : `infra/terraform/migrate-job.tf`, étape « Run DB migrations (job, ADR-0025) » de `deploy-backend.yml` (staging seulement). Le job prod est paramétré (`migrate_jobs`) mais ne sera créé qu'en phase 4.

**Évolution possible, hors périmètre** : séparer les privilèges DB, avec un rôle de migration (DDL) réservé au job et un rôle applicatif réduit au DML. Ce découpage n'est possible qu'une fois les migrations sorties de l'app. Il ajoute un secret par environnement, d'où une décision séparée. De même, les seeds staging pourraient passer dans le job.

## Alternatives Considered

### Alternative A : garder les migrations au démarrage du conteneur (statu quo)

- **Pros** :
  - zéro changement et une seule image ;
  - impossible de déployer une image sans son schéma ;
  - la migration se fait automatiquement au redémarrage de prod.
- **Cons** :
  - le no-op de `migrate deploy` est payé à **chaque** réveil ;
  - la CLI et ses dépendances restent dans l'image runtime, plus lourde au pull et plus exposée à la porte Trivy ;
  - **une migration en échec bloque tous les démarrages de toutes les images, rollback compris** : l'app reste hors service jusqu'à un `migrate resolve` manuel ;
  - plusieurs réplicas qui démarrent ensemble se sérialisent sur le verrou consultatif, et une migration longue provoque des redémarrages parasites ;
  - le rôle DB de l'app garde forcément les droits DDL.
- **Why not** : le gain de simplicité ne compense pas une panne qui laisse l'app hors service, rollback inclus, sur l'environnement que les bêta-testeurs utilisent.

### Alternative C : init container (image app slim, migrations à chaque démarrage de réplica)

- **Pros** : image slim, pas de nouvelle ressource job, pas de modification du workflow.
- **Cons** :
  - l'init container s'exécute **à chaque réveil** : le cold start empire (second pull, migration, boot) ;
  - une migration en échec bloque toujours tous les réplicas.
- **Why not** : on garde les défauts de A et on y ajoute un second pull au réveil.

### Alternative C1 : job au déploiement ET migration au boot conservée

- **Pros** : double sécurité.
- **Cons** :
  - l'image ne peut pas être slim ;
  - le no-op au réveil reste ;
  - le blocage par une migration en échec reste.
- **Why not** : retenue **uniquement comme phase de transition** (phases 1-2).

### Alternative B' : migrer depuis le runner GitHub

- **Pros** : aucune ressource Azure en plus, logs directement dans GitHub.
- **Cons** :
  - il faudrait ouvrir le pare-feu PostgreSQL aux runners GitHub ;
  - il faudrait placer une chaîne de connexion avec droits DDL dans les secrets GitHub, sur un repo public.
- **Why not** : régression de sécurité nette par rapport au modèle Key Vault + identité managée.

### Alternative B'' : `az containerapp exec` dans un réplica

- **Pros** : aucune nouvelle ressource.
- **Cons** :
  - il faut réveiller l'app ;
  - la commande s'exécute dans **l'ancienne** image, qui n'a pas les nouvelles migrations ;
  - elle est interactive et peu fiable en CI ;
  - elle impose de garder la CLI dans l'image.
- **Why not** : elle ne répond pas au besoin.

## Consequences

### Positive

- **Une migration en échec n'interrompt plus le service** : le déploiement s'arrête avant la bascule, et l'ancienne révision continue de servir et de se réveiller normalement.
- **Cold start réduit** : plus de `migrate deploy` à chaque réveil, et une image plus légère. Le gain, estimé à quelques secondes, sera chiffré en phase 0 ; ce n'est pas la raison principale de la décision.
- **Surface d'attaque réduite** : ni CLI Prisma, ni schema engine, ni leurs dépendances dans l'image runtime.
- **Une seule exécution par déploiement** : plus de course entre réplicas sur le verrou consultatif.
- **Le moindre privilège DB devient possible**, même si cela relève d'une décision ultérieure.
- **Règle de rétrocompatibilité inchangée** : ADR-0017 et `check-migrations.ts` restent la garantie du rollback.

### Negative

- Deux ressources en plus à exploiter, une étape de workflow avec suivi d'exécution et un rôle CI personnalisé.
- Deux images par SHA, donc un push de plus par build et un repository ACR de plus à purger.
- **Coût** (à confirmer par cost-manager) :
  - Azure : moins de 0,10 €/mois, les quelques exécutions mensuelles restant dans l'offre gratuite Container Apps ;
  - ACR : quelques tags de plus, à vérifier contre le quota d'ACR Basic ;
  - GitHub Actions : 0 € (repo public), pour environ 1 à 3 minutes de plus par déploiement.
- Une image peut être déployée sans son schéma (déploiement manuel, redémarrage de prod). Le contrôle de schéma de `/health` et le runbook de redémarrage interceptent ce cas.
- Le `docker compose` local a besoin d'un service `migrate`.

### Risks

| Risque                                                                                                         | Mitigation                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Migration appliquée à moitié** : Prisma n'enveloppe pas systématiquement une migration dans une transaction. | Garder des migrations courtes et isolées, avec le runbook `migrate status` / `migrate resolve`. |
| **Décalage entre l'image du job et celle de l'app.**                                                           | Même build, même SHA, même tag.                                                                 |
| **Résolution non reproductible** (`pnpm deploy --legacy`).                                                     | Passer à un `pnpm deploy` qui respecte le lockfile en phase 0.                                  |
| **Prod redémarrée sans migration.**                                                                            | Lancer le job prod d'abord, puis le smoke test sur `database.schema == "ok"`.                   |
| **Purge ACR.**                                                                                                 | Ajouter le repository `-migrate` à la purge, en tags SHA purs.                                  |

**Retour en arrière** : chaque phase se défait par une variable d'environnement ou par un revert, sans migration de données.
