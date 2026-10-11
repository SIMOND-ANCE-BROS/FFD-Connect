#!/bin/sh
set -e

echo "Running Prisma migrations..."
# Call the Prisma CLI binary directly (no pnpm/npm in the slim runtime image).
# Explicit --schema for Prisma 7 multi-file schema. prisma.config.ts is not
# auto-loaded by all CLI versions, so we point at the schema folder directly.
PRISMA="./node_modules/.bin/prisma"
if ! "$PRISMA" migrate deploy --schema=./prisma/schema; then
  echo "ERROR: Prisma migration failed. Container will not start."
  echo "Check your DATABASE_URL and migration files."
  echo "To debug: docker exec -it <container> ./node_modules/.bin/prisma migrate status --schema=./prisma/schema"
  exit 1
fi
echo "Migrations applied successfully."

# Seeds staging/beta (jamais en prod : gated sur SEED_TEST_TRACKS=true).
# Lancés en ARRIÈRE-PLAN pour ne pas retarder le démarrage de l'app : sur un
# réveil scale-from-zero, chaque seed est un no-op (idempotent, les données
# persistent en base) mais coûtait ~5 boots Node séquentiels avant que le
# backend n'écoute. L'app sert /health pendant que les seeds tournent ; ordre
# préservé à l'intérieur du bloc (purge avant le compte de validation,
# career/direct après lui). Non-fatal : un échec de seed ne bloque JAMAIS le
# démarrage (log + on continue).
if [ "$SEED_TEST_TRACKS" = "true" ]; then
  (
    # Purge des anciennes pistes métronome "FFD Test" (la bibliothèque est
    # désormais alimentée par track-prep). No-op une fois la purge faite.
    echo "[seed] Purging metronome test tracks..."
    if node dist/scripts/purge-test-tracks.js; then
      echo "[seed] Test tracks purge completed."
    else
      echo "[seed] WARNING: test tracks purge failed (non-fatal)."
    fi

    # Purge des comptes et clubs de TEST (club@/staff@/admin@test.com,
    # beta@test.com, partenaires de démo, cibles de scan…). Seul le compte de
    # validation des stores (licensee@test.com) et son club restent. Doit
    # tourner AVANT le seed du compte de validation (qui pose son drapeau).
    echo "[seed] Purging test accounts..."
    if node dist/scripts/purge-test-accounts.js; then
      echo "[seed] Test accounts purge completed."
    else
      echo "[seed] WARNING: test accounts purge failed (non-fatal)."
    fi

    # Seed de licences bêta-testeurs. Le register exige une licence
    # existante ; la base staging n'a pas les licences FFD réelles, donc on
    # crée des licences NON réclamées pour que les testeurs puissent s'inscrire.
    echo "[seed] Seeding beta-tester licenses..."
    if node dist/scripts/seed-beta-testers.js; then
      echo "[seed] Beta licenses seed completed."
    else
      echo "[seed] WARNING: beta licenses seed failed (non-fatal)."
    fi

    # Compte de validation des stores (licensee@test.com) : ADMIN + tous les
    # rôles, club « Club Test FFD », drapeau isStoreReview (écritures simulées,
    # ni supprimable ni désactivable). Mot de passe = PROFILE_TEST_PASSWORD.
    echo "[seed] Seeding store-review account..."
    if node dist/scripts/seed-profile-test-accounts.js; then
      echo "[seed] Store-review account seed completed."
    else
      echo "[seed] WARNING: store-review account seed failed (non-fatal)."
    fi

    # Career demo data of the store-review account (competitions/events/
    # registrations/results), so the Profile/Career screens render with
    # content. Runs after the store-review account seed.
    echo "[seed] Seeding store-review career data..."
    if node dist/scripts/seed-beta-career.js; then
      echo "[seed] Career seed completed."
    else
      echo "[seed] WARNING: career seed failed (non-fatal)."
    fi

    # Compétition en direct de démo (timing, retard, résultats) où le compte
    # de validation est inscrit. Runs last (needs the store-review account).
    echo "[seed] Seeding live competition demo data..."
    if node dist/scripts/seed-checkin-test.js; then
      echo "[seed] Live demo seed completed."
    else
      echo "[seed] WARNING: live demo seed failed (non-fatal)."
    fi

    echo "[seed] All staging seeds finished."
  ) &
fi

echo "Starting backend..."
exec node dist/src/main.js
