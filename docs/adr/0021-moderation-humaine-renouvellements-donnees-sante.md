# ADR-0021: Modération humaine des renouvellements et accès aux données de santé depuis le back-office

**Date**: 2026-10-10
**Status**: proposed
**Deciders**: Gabin Simond

## Context

Le renouvellement de licence repose sur deux documents déposés depuis l'app : un certificat médical (donnée de santé, RGPD art. 9) et une attestation de licence. Jusqu'ici, la soumission **s'auto-approuvait** dès que l'OCR lisait « apte », une date récente et un numéro de licence (`submitRenewalRequest` → `approveRenewalRequest`). Personne ne regardait le document : une photo floue mais « lisible », un certificat d'un tiers ou un document qui n'est pas un certificat passaient si l'OCR s'y trompait.

L'épic #19 remplace cette décision automatique par une décision humaine. Le cadrage (commentaire du 2026-10-10 sur #19) a fixé :

- **Modérateur** : l'éditeur seul, rôle `ADMIN`. Pas de délégation à des tiers ; la revue humaine sera déclarée dans la politique de confidentialité et les CGU avant la mise en service.
- **OCR** : uniquement des indices. Aucun refus automatique, même en cas de contre-indication lue : tout passe par l'humain.
- **Saison accordée** : calculée à la date de la décision (règle de #259).
- **Certificat refusé** : purgé 30 jours après la décision ; plus consultable une fois la décision prise, seule la trace de la décision reste.

Deux défauts relevés en chemin sont corrigés par la même brique : l'approbation n'était ni atomique ni conditionnelle (#261 : deux approbations concurrentes passaient, un plantage entre les deux écritures laissait une licence prolongée et une demande `PENDING`), et elle inventait un numéro de licence aléatoire quand aucun n'était connu (#262).

C'est la **première fois** qu'un écran d'administration donne accès au contenu d'un document de santé : il faut en décider explicitement les conditions.

## Decision

**Une file `PENDING` modérée par l'administrateur depuis le back-office, avec accès au document limité à la durée de la décision, et une trace de chaque accès et de chaque décision sans aucune donnée de santé.** Livré par #266 (API) ; l'auto-approbation reste en place jusqu'à #271, livrée en dernier, pour que rien ne change côté licencié avant que le back-office, l'app et les notifications soient prêts. Pas de drapeau de fonctionnalité.

1. **Données** (migration additive, ADR-0017) sur `LicenseRenewalRequest` : `submittedAt` (rattrapé à `updatedAt` pour les demandes déjà soumises), `reviewedById` (`onDelete: SetNull`), `reviewedAt`, `rejectionReason`, `reviewComment`, index `(status, submittedAt)`. Le motif de refus est une **chaîne validée côté TypeScript** (`ILLEGIBLE`, `INCOMPLETE`, `CERTIFICATE_TOO_OLD`, `NOT_A_MEDICAL_CERTIFICATE`, `IDENTITY_MISMATCH`, `LICENSE_MISMATCH`, `MEDICAL_RESTRICTION`, `OTHER`), pas un enum PostgreSQL : ajouter un motif reste un changement de code.
2. **API** sous `/admin/license-renewals`, contrôleur protégé **au niveau de la classe** par `JwtAuthGuard + RolesGuard + @Roles(ADMIN)` : liste paginée (≤ 50, plus anciennes d'abord, sans motif de refus : elle n'est pas tracée), détail (motif et commentaire compris) (avec les indices OCR tant que la demande est `PENDING`), fichier d'un document, approbation (`{ licenseNumber? }`), refus (`{ reason, comment? }`, commentaire ≤ 500). L'ancienne route `POST /licenses/renewal/:id/approve` est supprimée.
3. **Accès au document** : flux authentifié servi **par l'API** depuis Blob Storage (disjoncteur `azure-blob` + délai, ADR-0009), jamais d'URL signée ni de lien direct au conteneur. En-têtes `Cache-Control: no-store`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. **`410 Gone` dès que la demande n'est plus `PENDING`.** Limité à 30 ouvertures par minute et par administrateur.
4. **Décision atomique** : une seule `$transaction` — `updateMany … where status = PENDING` d'abord (0 ligne ⇒ `409`), puis l'upsert de la licence (validité calculée à la date de décision, jamais raccourcie), puis la ligne d'audit. L'auto-approbation emprunte le même cœur (`approvePendingRenewal`). Le numéro de licence n'est **jamais inventé** : numéro confirmé par l'administrateur, sinon lecture OCR (seulement si elle a la forme d'un numéro de licence), sinon numéro de la licence existante ; aucun ⇒ `400`, numéro déjà attribué à un autre compte ⇒ `409`. Sur le chemin automatique, ces deux cas ne renvoient pas d'erreur au licencié (le `409` révélerait qu'un numéro existe) : la transaction est annulée et la demande reste `PENDING` pour l'administrateur.
5. **Journal d'audit** (`AdminAuditLog`, cible `LICENSE_RENEWAL`) : `LICENSE_RENEWAL_VIEW` (détail), `LICENSE_RENEWAL_DOCUMENT_VIEW` (fichier, avec l'identifiant et le type du document), `LICENSE_RENEWAL_APPROVE`, `LICENSE_RENEWAL_REJECT`. La consultation est tracée **avant** que la donnée ne soit servie : sans trace, rien n'est montré. `before` / `after` ne portent que le statut et la validité accordée — **jamais le motif** (`MEDICAL_RESTRICTION` est une donnée de santé), ni le commentaire, ni une lecture OCR.
6. **Rétention** : au refus, `purgeDueAt` du certificat médical = `min(échéance existante, décision + 30 jours)`. La purge horaire (#62) efface le fichier, les données OCR **et `reviewComment`** (qui peut décrire le certificat), et ramène le motif `MEDICAL_RESTRICTION` (donnée de santé) à `OTHER` ; restent le statut, un motif neutre et les dates. Un refus avec commentaire ou avec `MEDICAL_RESTRICTION` est refusé (`400`) quand la demande n'a plus de certificat médical : rien ne viendrait alors jamais les effacer.
7. **RGPD** : l'export des données (#253) inclut `submittedAt`, `reviewedAt`, `rejectionReason`, `reviewComment` — pas l'identité de l'administrateur.
8. **Compte de validation des stores** (`isStoreReview`, rôle `ADMIN`) : pages vides sur les lectures, décisions simulées, aucun certificat servi (comportement habituel de ce compte).

## Alternatives Considered

### Alternative 1 : garder l'auto-approbation et ne modérer que les refus de l'OCR

- **Pros** : aucun délai pour le licencié dans le cas nominal ; peu de charge de modération.
- **Cons** : l'OCR reste seul juge des cas qu'il accepte, précisément ceux où il se trompe sans le savoir ; pas de contrôle de l'identité ni du numéro.
- **Why not** : l'objectif de #19 est qu'aucune licence ne soit accordée sans regard humain sur le certificat.

### Alternative 2 : ne jamais montrer le document, valider sur la seule foi de l'OCR et d'un envoi par un autre canal

- **Pros** : aucun nouvel accès aux données de santé depuis le back-office.
- **Cons** : déplace le certificat vers un canal moins maîtrisé (e-mail) sans trace d'accès ; la décision humaine porte sur un résumé et non sur la pièce.
- **Why not** : moins protecteur en pratique qu'un accès authentifié, borné dans le temps et tracé.

### Alternative 3 : URL signée (SAS) à durée courte vers le blob

- **Pros** : pas de flux à faire transiter par l'API.
- **Cons** : le lien est rejouable par quiconque l'obtient pendant sa validité, il échappe au contrôle de rôle et au `410`, et sa consultation n'est pas tracée côté application.
- **Why not** : le flux par l'API garantit qu'à chaque ouverture le rôle, l'état de la demande et la trace sont vérifiés.

### Alternative 4 : déléguer la modération (FFD, bénévoles)

- **Pros** : charge répartie.
- **Cons** : élargit le cercle des personnes accédant à des données de santé, demande des engagements contractuels et une mise à jour de l'information des personnes.
- **Why not** : décision du propriétaire du projet : l'éditeur seul, pour l'instant.

## Consequences

### Positive

- Chaque licence renouvelée l'est après un regard humain sur le certificat ; l'OCR n'est plus qu'une aide.
- Plus de double décision ni d'état incohérent (#261), plus de numéro de licence inventé (#262).
- Chaque accès à un document de santé depuis le back-office laisse une trace consultable dans le journal d'audit, sans y recopier la donnée (#63).
- Un certificat refusé disparaît au plus tard 30 jours après la décision.
- Aucune nouvelle ressource cloud, aucun coût supplémentaire.

### Negative

- Délai de renouvellement pour le licencié dès #271 (dépend de la disponibilité de l'administrateur, seul modérateur).
- Le back-office manipule désormais des données de santé : le poste de l'administrateur entre dans le périmètre à protéger.
- La politique de confidentialité et les CGU doivent être mises à jour **avant** l'arrêt de l'auto-approbation.

### Risks

- **Fuite par le navigateur** (cache, téléchargement involontaire, script dans un PDF) : en-têtes `no-store`, `nosniff`, `sandbox`, affichage `inline`.
- **Extraction en masse** par un compte administrateur compromis : limitation à 30 ouvertures par minute, trace de chaque ouverture, accès fermé dès la décision.
- **Donnée de santé dans le journal ou les logs** : audit limité au statut et à la validité, motif et commentaire exclus, logs ne contenant que des identifiants opaques ; corps des requêtes retirés des évènements Sentry (Sentry 11 les collecte par défaut) ; tests dédiés.
- **Rollback de déploiement** : migration strictement additive ; la révision précédente ignore les nouvelles colonnes.
