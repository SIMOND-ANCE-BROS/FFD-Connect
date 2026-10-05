# Module Career

## 1) Role metier

Le module career construit la vue "carriere danseur": partenariats, historique d'inscriptions et resultats.

## 2) Fonctionnalites

- Consultation de sa propre carriere.
- Consultation de la carriere d'un autre utilisateur.
- Recherche de membres pour consultation de carriere.

## 3) Endpoints backend

Base controller: `apps/backend/src/career/career.controller.ts`

Routes:

- `GET /career/me`
- `GET /career/search-members?q=...`
- `GET /career/user/:userId`

## 4) Integration client

Points client principaux:

- `apps/client/src/services/BackendService.ts`
- `apps/client/src/features/career/hooks/useCareerLogic.ts`
- `apps/client/src/features/career/hooks/useCareerUserLogic.ts`
- ecrans `CareerScreen`, `ViewCareerScreen`

## 5) Regles metier

- La carriere est un agregat transverse:
  - partenariats (origine clubs)
  - inscriptions (origine competitions)
  - resultats (origine competitions)
- La recherche membre impose un seuil minimal de saisie (>= 2 caracteres cote client).
- La visibilite de certaines donnees depend des droits backend.

## 6) Flux principal

1. Chargement `GET /career/me` pour le profil courant.
2. Recherche membre via `GET /career/search-members`.
3. Ouverture detail tiers via `GET /career/user/:userId`.

## 7) Risques et points d'attention

- Le module depend de la qualite des donnees des autres domaines.
- Forte sensibilite aux regressions de jointure/aggregation cote backend.
- Les performances doivent rester stables pour les profils riches en historique.

