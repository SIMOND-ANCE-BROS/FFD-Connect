







































# Regles transverses backend-client

## 1) Couplage architecturel

- Le backend expose des modules NestJS par domaine; le client adopte une organisation par features metier.
- Le couplage principal passe par:
  - contrats HTTP (routes + payloads),
  - roles utilisateur,
  - conventions d'erreur.

## 2) Auth et securite

- JWT injecte automatiquement via `apps/client/src/services/api.ts`.
- En `401`, le token est purge cote client (sauf exceptions auth explicites).
- Les controles d'autorisation backend restent la source de verite.

## 3) Gestion erreurs et resilence

- Retry automatique pour erreurs reseau/5xx/408/429.
- Pas de retry pour la majorite des `4xx`.
- Timeout API centralise et configurable via `config.ts`.

## 4) Navigation et roles

- `AppNavigator` est role-aware:
  - `CLUB`: onglet club + ecrans gestion club
  - `LICENSEE`: licence + bibliotheque + parcours sportif standard
  - `STAFF/ADMIN`: parcours operationnels (scanner/check-in, administration selon droits)
  - `GUEST`: parcours limite (client-only)

## 5) Contrats et evolution

- Toute evolution endpoint doit etre repercutee dans:
  - service client associe,
  - hooks/context/screen consommateurs,
  - tests API/MSW.
- Prioriser les types partages (`packages/shared`) quand possible pour limiter la derive.

## 6) Observabilite et qualite

- Interceptors logging + metrics cote backend.
- Logging client structure pour diagnostic terrain.
- E2E et tests unitaires present sur domaines critiques (auth, license, competitions, settings).

## 7) Checklist d'impact avant changement module

1. Le role et les droits changent-ils ?
2. Les ecrans de navigation impactes sont-ils identifies ?
3. Les erreurs retour API sont-elles compatibles UX actuelle ?
4. Le retry/timeout est-il adapte au nouveau workflow ?
5. Les tests feature + integration ont-ils ete actualises ?

