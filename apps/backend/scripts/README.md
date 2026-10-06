# Scripts Utilitaires - Backend

## Scripts Disponibles

### `seed.ts`

**Bootstrap de la base (sans les résultats compete)**

Le seed ne fait plus que :

- Vider la base
- Créer les comptes de base : admin, E2E, CVDS (club + couple de dev, direction@cvds.com)
- Alimenter les **tracks** depuis le dossier `uploads/` (analyse BPM, style)

**Couple de dev** : un couple de licenciés CVDS (cavalier + cavalière) défini dans
`seed-owner-couple.ts`. Les valeurs par défaut sont **fictives** (Lucas BERNARD / Emma MOREAU) :
le dépôt est public, aucune donnée réelle ne doit y figurer. Pour seeder ton propre compte en local,
surcharge chaque champ dans `apps/backend/.env` (non versionné) :

```bash
SEED_OWNER_FIRST_NAME="Lucas"
SEED_OWNER_LAST_NAME="BERNARD"
SEED_OWNER_EMAIL="lucas.bernard@example.com"
SEED_OWNER_BIRTH_DATE="2000-01-01"     # AAAA-MM-JJ
SEED_OWNER_LICENSE="20000101-ber-lu01" # AAAAMMJJ-xxx-yyNN
SEED_PARTNER_FIRST_NAME="Emma"
SEED_PARTNER_LAST_NAME="MOREAU"
SEED_PARTNER_EMAIL="emma.moreau@example.com"
SEED_PARTNER_BIRTH_DATE="2001-01-01"
SEED_PARTNER_LICENSE="20010101-mor-em01"
```

`sync:compete` lit la même configuration (comptes conservés, rattachement par nom aux résultats scrapés).

Il **ne** scrape **pas** les compétitions. Pour charger les résultats compete (licenciés, clubs, compétitions, partenariats), exécuter après le seed :

```bash
pnpm run sync:compete -- --scrape
```

**Usage :**

```bash
pnpm exec tsx scripts/seed.ts
# puis éventuellement :
pnpm run sync:compete -- --scrape
```

### `sync-licensees-from-compete.ts` (commande `sync:compete`)

**Sync des licenciés et clubs à partir des résultats compete**

> **`scraped_data.json` n'est pas versionné** (voir `apps/backend/.gitignore`). Le fichier
> contient les noms de 865 danseurs réels, dont des catégories jeunes (`Juv.` moins de 12 ans,
> `Jun.` 12-15, `Youth` 16-18) — donc des mineurs identifiés — collectés sur un site tiers.
> Ce type de données personnelles n'a pas sa place sous gestion de version. Régénère-le en local
> avec `--scrape` ; sans le fichier, le script s'arrête avec un message explicite.

- Conserve toujours : le couple de dev, CVDS. Supprime le reste des licenciés/clubs puis recharge à partir de `scraped_data.json` (ou en re-scrapant avec `--scrape`).
- Avec **`--scrape`** : récupère la liste des compétitions depuis [l’index](https://chairperson.ddsbagnols.com/resultats/index.php), scrape chaque compétition, met à jour `scraped_data.json`, puis synchronise la base (création/mise à jour sans doublons).
- Gère les couples inter-club (partenariat avec club primaire + secondaire, pas de club factice).
- Normalisation des caractères spéciaux et anti-doublons (partenariats, inscriptions, résultats, schedule).

**Usage:**

```bash
pnpm run sync:compete              # Sync depuis le JSON existant
pnpm run sync:compete -- --scrape  # Re-scraper depuis l’index puis sync
pnpm run sync:compete -- --help    # Aide
```

### Différence entre `seed.ts` et `sync-licensees-from-compete.ts`

|                             | **seed.ts**                                                                                                                   | **sync-licensees-from-compete.ts**                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Objectif**                | **Bootstrap** : vider la base, créer admin, E2E, CVDS (couple de dev, direction), et les tracks.                              | Charger / mettre à jour **uniquement** les données compete (licenciés, clubs, compétitions, résultats) en gardant le couple de dev, CVDS.                                                        |
| **Nettoyage**               | Tout supprime (users, tracks, competitions, etc.).                                                                            | Supprime seulement licenciés, clubs, compétitions/events/résultats/inscriptions. **Ne touche pas** aux tracks ni à admin / E2E / couple de dev / CVDS.                                           |
| **Création**                | Admin, E2E, CVDS (club + couple de dev, direction@cvds.com), **tracks** (dossier `uploads` + BPM). **Aucune** donnée compete. | Recrée clubs, licenciés, partenariats, compétitions/résultats à partir de `scraped_data.json` ou du scrape (`--scrape`). **Prérequis** : avoir déjà exécuté le seed (CVDS et comptes conservés). |
| **Source des compétitions** | Aucune. Le seed affiche la commande à lancer pour charger les résultats.                                                      | `--scrape` = scrape depuis l’index puis sync ; sans `--scrape` = lecture de `scraped_data.json` uniquement.                                                                                      |
| **Quand l’utiliser**        | Première install ou reset complet (base + tracks).                                                                            | Après le seed, ou pour rafraîchir les résultats compete sans refaire un bootstrap.                                                                                                               |

En résumé : **seed** = bootstrap (comptes + tracks) ; **sync:compete** = source unique pour toutes les données compete (licenciés, clubs, partenariats, résultats).

### `update-ip.ts`

**Mise à jour automatique de l'IP locale**

Détecte l'IP locale et met à jour la configuration client (apps/client/src/config.ts) pour le développement.

**Usage:** Automatiquement exécuté via `pnpm start:dev`

### `list-orphan-renewal-blobs.ts`

**Inventaire des documents de renouvellement orphelins (lecture seule)**

Liste les blobs du conteneur `uploads` nommés comme des documents de renouvellement
(`document-<horodatage>-<aléa>.<ext>`, certificats médicaux — donnée de santé, RGPD art. 9 —
et certificats de licence) qu'aucune ligne `LicenseRenewalDocument.filePath` ne référence.
Affiche nom + `lastModified` puis le total. **Ne supprime rien** : la suppression se fait à la
main après revue. À lancer après une alerte Sentry `rgpd: file-deletion-failed`.

**Usage :** `pnpm exec tsx scripts/list-orphan-renewal-blobs.ts` (env : `DATABASE_URL`,
`AZURE_STORAGE_CONNECTION_STRING` ou `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_UPLOADS_CONTAINER`)

---

## Scripts à la racine du projet

### `scripts/backup-database.ts`

**Sauvegarde de la base de données**

Crée une sauvegarde complète de la base de données PostgreSQL.

**Usage:**

```bash
pnpm backup-database
```

### `scripts/start-dev.ts`

**Démarrage de l'environnement de développement**

Démarre automatiquement :

- Docker (si nécessaire)
- Base de données PostgreSQL et Redis via Docker Compose
- Metro bundler (React Native)
- Backend NestJS

**Usage:**

```bash
pnpm start:dev
```

---

## Sauvegardes

Les sauvegardes sont stockées dans `../../backups/` (à la racine du projet).

---

**Dernière mise à jour:** 12 Février 2026
