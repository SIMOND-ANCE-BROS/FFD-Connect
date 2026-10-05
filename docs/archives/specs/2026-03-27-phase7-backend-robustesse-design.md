# Phase 7 — Backend Robustesse : Design Spec

**Date:** 2026-03-27

## Objectif

Trois améliorations indépendantes qui renforcent la stabilité du backend avant de refactorer le client :

1. **API Versioning** — préfixe `/api/v1` stable pour découpler les releases backend/mobile
2. **Circuit Breakers** — isolation des pannes sur les services externes (Google Vision, Google TTS, WDSF)
3. **Performance DB** — élimination des N+1 identifiés et index manquants

---

## Axe 1 — API Versioning

### Contexte

Aucun préfixe de version n'existe aujourd'hui. Les apps mobile en production ne se mettent pas à jour instantanément — une breaking change sur le backend casse les anciens clients silencieusement.

### Design

Ajouter `app.setGlobalPrefix('api/v1')` dans `main.ts`, juste avant `app.listen`. Toutes les routes existantes (`/auth/login`, `/competitions`, etc.) deviennent `/api/v1/auth/login`, `/api/v1/competitions`, etc. sans modifier un seul contrôleur.

Le client met à jour `API_URL` dans `.env` (et `.env.example`) pour inclure `/api/v1` dans le base URL. `api.ts` (baseURL) ne change pas structurellement.

**Swagger** : le `DocumentBuilder` dans `main.ts` ajoute `.setBasePath('api/v1')` pour que la doc reflète les nouvelles routes.

**Tests** : les tests d'intégration E2E (`/test`) utilisent `supertest` avec des URLs hardcodées — mettre à jour le préfixe dans le helper de test.

### Fichiers

- Modifier : `apps/backend/src/main.ts`
- Modifier : `apps/client/.env.example` + `.env.test`
- Modifier : `apps/backend/test/` (helpers supertest)

### Non-scope

- Pas de multi-versioning (`v1` + `v2` simultanés) — hors scope
- Pas de header-based versioning — inutile pour l'instant

---

## Axe 2 — Circuit Breakers

### Contexte

Trois services externes peuvent tomber indépendamment : Google Vision (OCR licences), Google TTS (synthèse vocale), WDSF (sync compétitions). En cas de panne, `withTimeout` lève une erreur après le délai — mais sans circuit breaker, chaque requête attend le timeout complet et sature les workers NestJS.

### Design

**Librairie :** `opossum` — standard Node.js, bien maintenu, API simple.

**`CircuitBreakerService`** (`src/common/circuit-breaker/circuit-breaker.service.ts`) :

- Injectable NestJS (`@Injectable()`)
- Crée et cache des breakers par clé (`'google-vision'`, `'google-tts'`, `'wdsf'`)
- Méthode `fire(key, fn)` — exécute `fn` via le breaker correspondant
- En état ouvert : lève `ServiceUnavailableException` (503) immédiatement, sans attendre le timeout

**Config par breaker** (valeurs par défaut raisonnables) :

| Breaker       | errorThresholdPercentage | timeout | resetTimeout |
| ------------- | ------------------------ | ------- | ------------ |
| google-vision | 50%                      | 15s     | 30s          |
| google-tts    | 50%                      | 10s     | 30s          |
| wdsf          | 50%                      | 30s     | 60s          |

`withTimeout` reste en place — le circuit breaker s'ajoute en couche externe. L'ordre est : circuit breaker → withTimeout → appel réseau.

**Logging** : on log les événements `open` / `halfOpen` / `close` via le logger Pino existant.

**Intégration** : `OcrService`, `TtsService`, `WdsfService` injectent `CircuitBreakerService` et wrappent leurs appels externes dans `fire(key, fn)`.

### Fichiers

- Créer : `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts`
- Créer : `apps/backend/src/common/circuit-breaker/circuit-breaker.service.spec.ts`
- Modifier : `apps/backend/src/utils/ocr.service.ts`
- Modifier : `apps/backend/src/tts/tts.service.ts`
- Modifier : `apps/backend/src/wdsf/wdsf.service.ts`
- Modifier : `apps/backend/src/common/common.module.ts` (export CircuitBreakerService)

### Non-scope

- Pas de dashboard de monitoring des breakers — New Relic couvre déjà les 503
- Pas de fallback métier (ex: TTS cache) — déjà géré par la Phase 2 ADR-007

---

## Axe 3 — Performance DB

### Contexte

Le slow query logging Prisma (Phase 2, seuil 200ms) est en place. Deux zones à risque de N+1 identifiées :

1. `competition-results.service.ts` : includes imbriqués sur `Registration → Event → Competition`
2. `competition-registration.service.ts` : `findMany` avec `include: { event: { include: { competition: true } } }` répété

### Design

**Audit** : analyser les 4 `include` imbriqués dans `competition-results.service.ts` (lignes 41-100) et les 3 patterns dans `competition-registration.service.ts`. Pour chaque requête :

- Vérifier si le résultat est utilisé dans une boucle (N+1 réel)
- Si oui : réécrire avec une seule requête `findMany` + `select` ciblé, ou déplacer le join dans Prisma

**Index manquants identifiés** (à confirmer avec `EXPLAIN ANALYZE` en dev) :

- `Registration` : index sur `(eventId, status, userId)` composite — pattern fréquent pour "inscriptions actives d'un user à une épreuve"
- `Result` : index sur `(userId, createdAt)` — pour les pages de résultats triés par date

**Migrations** : deux nouvelles migrations Prisma pour les index.

### Fichiers

- Modifier : `apps/backend/prisma/schema.prisma`
- Créer : migrations SQL (`prisma migrate dev`)
- Modifier si N+1 confirmés : `competition-results.service.ts`, `competition-registration.service.ts`

### Non-scope

- Pas de réécriture complète des services — corrections chirurgicales uniquement
- Pas de query caching Redis sur les résultats — hors scope Phase 7

---

## Testing

- **Circuit breakers** : tests unitaires avec mocks `opossum` — états open/closed/halfOpen, propagation 503
- **API versioning** : les tests d'intégration existants valident implicitement les nouvelles routes
- **DB** : pas de tests spécifiques — les tests d'intégration existants couvrent les services modifiés

## Dépendances

- `opossum` + `@types/opossum` à ajouter dans `apps/backend/package.json`
- Aucune autre nouvelle dépendance
