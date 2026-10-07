# ADR-0020: Key Vault, source de vérité des clés de distribution de l'app

**Date**: 2026-10-07
**Status**: proposed
**Deciders**: Gabin Simond

## Context

La distribution de l'app aux testeurs (job `promote-beta` d'`eas-build.yml`, voir [changelog-beta](../exploitation/changelog-beta.md)) repose sur plusieurs clés de services tiers, aujourd'hui **éparpillées** :

- secrets de l'environnement GitHub `testflight-beta` : clé API App Store Connect (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`) et compte de service Google Play (`PLAY_SERVICE_ACCOUNT_JSON`) ;
- serveurs EAS : une clé App Store Connect (Key ID `JU85D8W92R`, utilisée par `eas submit`) et le compte de service « Play Store Submissions » ;
- Firebase : la clé APNs `.p8`, dans les deux emplacements (développement et production) ;
- dépôt GitHub : `EXPO_TOKEN` (secret de dépôt) ;
- et les fichiers d'origine (`AuthKey_*.p8`, JSON de compte de service) dans un dossier Téléchargements.

Conséquences : aucun inventaire, une rotation se fait de mémoire, et GitHub ne permet pas de relire un secret (impossible de vérifier quelle clé est en place). Apple ne laisse télécharger chaque `.p8` **qu'une seule fois** : perdre le fichier, c'est devoir créer une nouvelle clé.

Deux briques existent déjà :

- **Azure Key Vault** en mode RBAC (`ffd-connect-kv`), utilisé par le backend via identité managée pour les URL de base de données et le compte de service Firebase ([isolation-secrets-db](../exploitation/isolation-secrets-db.md)) ;
- **OIDC GitHub → Entra ID** (`infra/terraform/ci-iam.tf`), sans aucun secret Azure statique dans GitHub.

## Decision

**Azure Key Vault devient la copie maîtresse des clés de distribution que la CI lit.** GitHub Actions les lit au moment de la distribution, via OIDC, au lieu des secrets d'environnement GitHub.

1. **Coffre dédié `ffd-connect-release-kv`** (Terraform, `infra/terraform/release-keys.tf`), distinct de `ffd-connect-kv`. Le RBAC Key Vault s'accorde par coffre (ou par secret) : un coffre séparé permet à l'identité de la CI de lire **ces clés-là et rien d'autre**, sans une attribution de rôle par secret. Les secrets runtime (URL DB, Firebase) restent hors de portée d'un workflow compromis. Mode RBAC, suppression réversible 90 jours, pas de protection contre la purge (coffre supprimable si la beta s'arrête), accès réseau public (les runners GitHub n'ont pas d'IP fixe ; l'authentification Entra ID reste obligatoire).
2. **Identité dédiée** `ffd-connect-production-ci-release-keys` (application Entra ID + principal de service, même modèle que `ci-iam.tf`, sans secret client) :
   - **un seul** credential fédéré, de sujet `…:environment:testflight-beta` : seul un job lié à cet environnement (relecteur obligatoire, branches restreintes) obtient un jeton. Une PR, un fork ou un autre job reçoit `AADSTS700213` ;
   - **un seul** rôle : `Key Vault Secrets User` sur ce coffre. Aucun rôle ARM, aucun accès à `ffd-connect-kv`, à l'ACR ni aux Container Apps.
3. **Aucune valeur dans Terraform** : pas de `azurerm_key_vault_secret`, sinon la valeur serait en clair dans l'état distant. Les noms sont fixés par convention (`asc-key-id`, `asc-issuer-id`, `asc-key-p8`, `play-service-account-json`) et Gabin pose les valeurs avec `az keyvault secret set --file …`.
4. **Écriture humaine** : `Key Vault Secrets Officer` sur ce coffre seulement, accordé par Terraform au principal qui lance `terraform apply` (Gabin), ou à la liste `release_keys_officer_principal_ids`. Sur `ffd-connect-kv`, ce rôle avait été attribué à la main ; il est ici déclaré.
5. **Workflow : deux jobs, deux approbations.** La promotion est coupée en deux jobs liés tous deux à l'environnement `testflight-beta`, donc deux relectures humaines :
   - `promote-beta` (approbation 1 : « on lance le build / l'envoi ? ») : notes, build, tag & release, `eas submit`, et l'OTA. Il exécute `pnpm install` et `eas-cli@latest` : il n'a **ni** `id-token: write` **ni** aucune clé de distribution ;
   - `distribute-beta` (approbation 2 : « le build est sur le store, on l'envoie aux testeurs ? ») : seul job avec `id-token: write`. Il ne fait ni `pnpm install` ni eas-cli : checkout restreint aux deux scripts, `actions/setup-node`, puis `node scripts/testflight-distribute.ts` / `play-distribute.ts` (Node ≥ 22.18 retire les types TypeScript nativement ; les scripts n'importent que des modules intégrés, la CI le vérifie). L'état de chaque jambe (ID et numéro de build, état de l'envoi, notes) passe par un artefact `beta-state-<plateforme>` ; la distribution ne part que si l'envoi est `finished`.
   - Dans `distribute-beta`, la jambe iOS lit `asc-*`, la jambe Android `play-service-account-json` ; l'OTA ne crée pas ce job. Les clés ne vivent que dans **une** étape : lues dans des fichiers `$RUNNER_TEMP` (umask 077), chaque ligne masquée (`::add-mask::`) avant tout autre usage, et pour le JSON Play chaque valeur texte et chaque ligne de `private_key` décodée ; passées au seul processus `node` (jamais `$GITHUB_ENV`) ; fichiers effacés et `az logout` en sortie (trap). Un job « Bêta — suivi » écrit la commande de reprise, y compris si la 2ᵉ approbation est refusée.
6. **Repli de transition** : si la variable `AZURE_RELEASE_KEYS_CLIENT_ID` n'est pas posée, si la connexion échoue ou si un secret manque dans le coffre, la jambe reprend **toutes** ses clés dans les secrets GitHub, passés par l'`env:` de la seule étape de distribution et effacés de son environnement avant le lancement du script (avertissement dans le log et le résumé). Tout-ou-rien par jambe : mélanger coffre et GitHub pendant une rotation associerait un Key ID et un `.p8` qui ne vont pas ensemble. Une fois le chemin Key Vault éprouvé, une PR séparée supprime le repli et les secrets GitHub.
7. **Copies hors CI** : EAS, Firebase et les consoles des stores ne savent pas appeler Key Vault, ils gardent leur propre copie, tenue à jour par le runbook [rotation-cles-distribution](../exploitation/rotation-cles-distribution.md). La clé APNs et la clé App Store Connect d'EAS ne sont lues par aucun job : elles ne vont **pas** dans ce coffre (l'identité CI pourrait les lire), leur copie maîtresse est celle du service qui les consomme, plus la sauvegarde hors ligne chiffrée.
8. **Audit** : un paramètre de diagnostic peut envoyer la catégorie `AuditEvent` du coffre (chaque `SecretGet`, avec l'identité appelante) vers Log Analytics. Aucun espace n'existe dans l'abonnement : Terraform en crée un dédié, plafonné (0,1 Go/jour, 30 jours), **sur option** (`release_keys_audit_enabled`, `false` par défaut).
9. **`EXPO_TOKEN` reste un secret GitHub de dépôt.** Il sert à tous les jobs EAS (gate, builds staging/production, OTA), dont la plupart ne sont liés à aucun environnement et tournent avec le sujet OIDC `ref:refs/heads/develop` (`workflow_run`). Le lire dans le coffre imposerait des credentials fédérés de branche sur l'identité de distribution, donc élargirait l'accès au lieu de le restreindre. Sa rotation est décrite dans le runbook.

## Alternatives Considered

### Alternative 1 : tout dans les secrets GitHub (statu quo)

- **Pros** : rien à construire ; déjà protégé par l'environnement (relecteur, branches).
- **Cons** : secrets illisibles une fois posés (impossible de vérifier quelle clé est en place) ; aucun inventaire ; perdus si le dépôt est recréé (cas de la bascule en dépôt public) ; aucune trace d'accès.
- **Why not** : ne résout ni l'éparpillement ni la traçabilité, et la recréation du dépôt les efface.

### Alternative 2 : gestionnaire de mots de passe personnel seulement

- **Pros** : gratuit, déjà en place pour d'autres comptes ; utile comme sauvegarde.
- **Cons** : la CI ne peut pas le lire, il faut recopier dans GitHub à chaque rotation ; lié à une personne.
- **Why not** : retenu comme **sauvegarde hors ligne** des `.p8` (voir Risques), pas comme source de la CI.

### Alternative 3 : tous les consommateurs lisent le coffre

- **Pros** : une seule copie, rotation en un point.
- **Cons** : EAS, Firebase, App Store Connect et Play Console n'offrent aucune intégration Key Vault : ils exigent un téléversement.
- **Why not** : impossible. Le coffre est la copie maîtresse, ces services gardent une copie synchronisée par le runbook.

### Alternative 4 : réutiliser `ffd-connect-kv`

- **Pros** : un coffre de moins.
- **Cons** : `Key Vault Secrets User` sur ce coffre donnerait à la CI les URL de base de données et le compte de service Firebase. Restreindre par secret imposerait une attribution par secret, créée après le secret lui-même (hors Terraform, puisque les secrets n'y sont pas déclarés).
- **Why not** : moindre privilège. Un coffre en plus ne coûte rien.

### Alternative 5 : identité managée assignée par l'utilisateur au lieu d'une application Entra ID

- **Pros** : ressource Azure, pas d'objet dans l'annuaire.
- **Cons** : un modèle différent de celui de `ci-iam.tf` pour le même usage.
- **Why not** : on suit le modèle existant (application + credential fédéré), sans différence de sécurité pour l'OIDC.

## Consequences

### Positive

- Inventaire unique et relisible (`az keyvault secret list`), avec dates de création et d'expiration.
- Moindre privilège : l'identité ne lit que ce coffre, et seulement depuis l'environnement `testflight-beta` approuvé ; le jeton OIDC n'est mintable que dans `distribute-beta`, qui n'exécute aucun code tiers téléchargé (pas de `pnpm install`, pas d'eas-cli).
- Une relecture humaine juste avant l'envoi aux testeurs (2ᵉ approbation), distincte de celle qui lance le build.
- Les clés survivent à une recréation du dépôt GitHub.
- Rotation documentée, clé par clé, avec une vérification sans rebuild (`action=resume`).

### Negative

- Une variable de plus (`AZURE_RELEASE_KEYS_CLIENT_ID`) sur l'environnement `testflight-beta`, et un `terraform apply`.
- Deux approbations par promotion bêta au lieu d'une ; une promotion non approuvée la 2ᵉ fois reste à distribuer (`action=resume`).
- Les copies EAS, Firebase et stores restent à synchroniser à la main : le coffre ne supprime pas la double saisie, il la cadre.
- Pendant la transition, deux copies coexistent (coffre et secrets GitHub) : à résorber par la PR de nettoyage.

### Coût

- Key Vault Standard : pas de frais fixes, environ 0,03 USD pour 10 000 opérations. Quatre lectures par promotion : quelques centimes par an.
- GitHub Actions : `distribute-beta` est un job court (checkout restreint, setup-node, `azure/login`, lecture, distribution) : ~1 minute facturée par jambe iOS/Android (arrondi par job ; l'attente de l'approbation n'est pas facturée, l'attente du traitement Apple l'est comme avant). Le job de suivi : ~1 minute par run. Soit ~3 minutes de plus par promotion `all`, négligeable.
- Log Analytics (si l'audit est activé) : quelques Ko d'`AuditEvent` par mois, dans la franchise gratuite de 5 Go/mois ; rétention 30 jours incluse. 0 € en pratique, plafond journalier contre un emballement.
- Entra ID (application, credential fédéré, attributions de rôle) : gratuit.

### Risks

- **Abonnement Azure financé par des crédits annuels** : s'ils s'arrêtent, le coffre devient inaccessible. Mitigation : **sauvegarde hors ligne chiffrée** des `.p8` Apple (App Store Connect et APNs), qu'Apple ne laisse télécharger qu'une fois ; le JSON Google et `EXPO_TOKEN` peuvent être régénérés. Le repli sur les secrets GitHub ne fonctionne que tant qu'ils existent : la PR de nettoyage le supprime.
- **Workflow compromis dans l'environnement `testflight-beta`** : il lirait les clés de distribution, comme aujourd'hui avec les secrets GitHub. Mitigation : deux relectures, branches restreintes, actions épinglées par SHA, et un job de distribution qui n'installe aucune dépendance (une dépendance npm ou eas-cli compromise tourne dans `promote-beta`, qui ne peut pas obtenir le jeton).
- **Nom de coffre déjà pris** (les noms Key Vault sont globaux) : `terraform apply` échoue. Changer `release_keys_vault_name` **et** `KV_NAME` dans `eas-build.yml`.
