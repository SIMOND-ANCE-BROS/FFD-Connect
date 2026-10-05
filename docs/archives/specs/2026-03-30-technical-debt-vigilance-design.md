# Design : Réduction de la dette technique — Points de vigilance

**Date :** 2026-03-30
**Scope :** Qualité technique transverse (sécurité, lisibilité, architecture, tests, intégrations)
**Approche :** Impact/effort — quick wins d'abord, puis complexité croissante

---

## Contexte

Suite à une analyse technique du projet FFD-Connect, 5 points de vigilance ont été identifiés. Aucun n'est bloquant fonctionnellement, mais chacun représente un risque latent (sécurité, maintenabilité, fiabilité). Ce plan les adresse par ordre croissant d'effort.

---

## Point 1 — bcrypt : cost factor insuffisant

### Problème

Le service d'authentification utilise bcrypt avec 6 rounds. À ce niveau, un attaquant disposant des hashes peut tenter environ 10 000 mots de passe par seconde sur du matériel standard. La recommandation actuelle est 12 rounds (~2 tentatives/sec).

### Solution

- Passer le cost factor à **12** dans le service d'auth
- Implémenter une **migration transparente au login** : après authentification réussie avec un hash existant, détecter si ce hash a été généré avec < 12 rounds via `bcrypt.getRounds()` et le remplacer silencieusement
- Aucune migration de base de données, aucun impact utilisateur

### Périmètre

- `apps/backend/src/auth/auth.service.ts` — constante SALT_ROUNDS + logique de rehash
- `apps/backend/src/auth/auth.service.spec.ts` — tests du rehash

### Tests

- Vérifier que le login fonctionne avec un ancien hash (6 rounds) et que le hash est mis à jour
- Vérifier que le login fonctionne avec un nouveau hash (12 rounds) sans rehash
- Vérifier que les nouveaux comptes sont créés avec 12 rounds

---

## Point 2 — Prisma schema : découpage en fichiers thématiques

### Problème

Le schema Prisma (`prisma/schema.prisma`) fait 481 lignes dans un seul fichier. Difficile à naviguer et à maintenir lors de l'ajout de nouveaux modèles.

### Solution

Activer la preview feature `prismaSchemaFolder` de Prisma v7 et découper en fichiers thématiques. Cette feature est stable en usage depuis Prisma v5.15 et supportée nativement en v7.

Structure cible :

```
prisma/
  schema/
    _base.prisma          # generator + datasource
    user.prisma           # User, UserRole, RefreshToken
    competition.prisma    # Competition, Heat, Result, Registration, SeatBooking
    license.prisma        # License, RenewalRequest, Document
    club.prisma           # Club, Partnership, SoloTeam, SoloTeamMember
    notification.prisma   # Notification, PushToken
    payment.prisma        # Ticket, Payment
    wdsf.prisma           # WdsfAthlete, WdsfSync
    report.prisma         # Report
```

### Changements techniques

- Activer `previewFeatures = ["prismaSchemaFolder"]` dans le generator
- Déplacer `schema.prisma` → `schema/_base.prisma`
- Répartir les modèles sans modifier aucune définition
- La CLI Prisma, les migrations et le client généré restent identiques
- Mettre à jour les scripts qui référencent `--schema prisma/schema.prisma` → `--schema prisma/schema/`

### Tests

- `pnpm prisma validate` doit passer sans erreur
- `pnpm prisma generate` doit produire le même client
- `pnpm test:integration` doit passer sans modification

---

## Point 3 — Zustand : isolation et interfaces stables entre stores

### Problème

4 stores Zustand coexistent (auth, player, competition, club/performance). Sans règles explicites, les stores peuvent s'importer mutuellement, créant un couplage implicite difficile à déboguer et à tester.

### Solution

Appliquer 3 règles sans refactor architectural :

**Règle 1 — Pas d'import direct entre stores**
Si une action dans `competitionStore` a besoin du `userId`, elle le reçoit en paramètre depuis le composant appelant. Les stores ne s'importent pas mutuellement.

**Règle 2 — Barrel `stores/index.ts`**
Exposer les selectors publics de chaque store depuis un point d'entrée unique. Les composants importent depuis `stores/`, pas depuis `stores/authStore.ts` directement.

**Règle 3 — Tests d'isolation**
Un test par store vérifiant qu'il s'initialise et fonctionne sans les autres stores.

### Périmètre

- Audit des imports croisés actuels entre les 4 stores
- Corrections si violations trouvées
- Création de `apps/client/src/stores/index.ts`
- Ajout de tests d'isolation dans `apps/client/src/stores/__tests__/`

---

## Point 4 — Couverture de tests : modules critiques

### Problème

La couverture globale de branches est à 56%. Certains modules business-critical (paiement, licences, auth avancé) ont des seuils trop bas pour détecter des régressions.

### Approche

Cibler les chemins à risque réel plutôt que viser un pourcentage global. Ne pas toucher aux modules déjà bien couverts (health, common : 95%+).

### Modules prioritaires et objectifs

| Module          | Situation actuelle | Objectif branches |
| --------------- | ------------------ | ----------------- |
| `auth/`         | ~88% fonctions     | 90%+ branches     |
| `payment/`      | non mesuré         | 85%+ branches     |
| `licenses/`     | non mesuré         | 80%+ branches     |
| `competitions/` | non mesuré         | 80%+ branches     |

### Actions par module

**auth/** — Couvrir : refresh token expiré, tentative de login avec mauvais mot de passe, rehash bcrypt, password reset flow complet

**payment/** — Couvrir : erreur HelloAsso (timeout, 422, 500), paiement déjà effectué, webhook de confirmation, remboursement

**licenses/** — Couvrir : OCR échoué, document invalide, renouvellement déjà en cours, transitions d'état invalides

**competitions/** — Couvrir : inscription après deadline, inscription doublon, publication de résultats partiels, transitions de statut invalides

### Type de tests

- Tests d'intégration avec vraie DB pour les workflows multi-étapes
- Tests unitaires pour les cas d'erreur isolés

### Seuils jest.config.js

Mettre à jour les seuils par module après implémentation pour les rendre contraignants.

---

## Point 5 — Intégrations externes : contrats et isolation

### Problème

5+ intégrations externes (Google Vision, Google TTS, WDSF, HelloAsso, Resend, Firebase) sans contrat formel. Les mocks dans les tests peuvent diverger silencieusement des vraies APIs.

### Solution en 2 niveaux

**Niveau 1 — Mocks stricts (tous les wrappers d'intégration)**

Pour chaque service wrapper (`WdsfService`, `TtsService`, `VisionService`, `PaymentService`, `NotificationService`) :

- Vérifier que les mocks reflètent fidèlement le contrat réel (types de retour, structure des erreurs)
- Ajouter des tests de cas d'erreur explicites : timeout, 429 rate limit, 500 serveur, payload inattendu, network error

**Niveau 2 — VCR pattern sur les APIs critiques (WDSF, HelloAsso, Google Vision)**

Enregistrer de vraies réponses API dans des fixtures JSON. Les tests rejouent ces fixtures via `nock` pour intercepter les appels HTTP. Si le parsing côté app casse suite à un changement d'API, les tests le détectent immédiatement.

Structure :

```
apps/backend/test/fixtures/
  wdsf/
    athlete-profile.json
    competition-results.json
    error-401.json
  helloasso/
    payment-confirmed.json
    payment-failed.json
    webhook-payload.json
  google-vision/
    license-scan-success.json
    license-scan-low-confidence.json
```

**Pas de pact testing** — trop lourd sans serveur de contrats dédié.

### Périmètre prioritaire

- `wdsf/` — sync des athlètes et résultats
- `payment/` — HelloAsso webhooks et confirmations
- `licenses/` — Google Vision OCR

---

## Ordre d'implémentation recommandé

1. **bcrypt** — 1 fichier, risque éliminé immédiatement (~1h)
2. **Prisma schema** — refactor structurel pur, 0 impact fonctionnel (~2h)
3. **Zustand isolation** — audit + barrel + tests (~2h)
4. **Tests modules critiques** — le plus long, par module (~1-2j)
5. **Intégrations externes** — fixtures + mocks stricts (~1j)

---

## Non-périmètre

- Refactoring architectural majeur des modules
- Migration vers une nouvelle technologie de state management
- Pact testing avec serveur de contrats
- Augmentation de la couverture des modules déjà bien couverts
