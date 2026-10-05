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
# préservé à l'intérieur du bloc (career dépend des licences). Non-fatal : un
# échec de seed ne bloque JAMAIS le démarrage (log + on continue).
if [ "$SEED_TEST_TRACKS" = "true" ]; then
  (
    # Seed de pistes de TEST (métronomes ffmpeg royalty-free).
    echo "[seed] Seeding test tracks (SEED_TEST_TRACKS=true)..."
    if node dist/scripts/seed-test-tracks.js; then
      echo "[seed] Test tracks seed completed."
    else
      echo "[seed] WARNING: test tracks seed failed (non-fatal)."
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

    # Career demo data for beta testers (competitions/events/registrations/
    # results), so the Profile/Career screens render with content. Runs after
    # the license seed (needs the tester to have claimed the license).
    echo "[seed] Seeding beta-tester career data..."
    if node dist/scripts/seed-beta-career.js; then
      echo "[seed] Beta career seed completed."
    else
      echo "[seed] WARNING: beta career seed failed (non-fatal)."
    fi

    # Comptes de test par rôle (LICENSEE/CLUB/STAFF/ADMIN) pour le switch de
    # profil côté preview.
    echo "[seed] Seeding profile test accounts..."
    if node dist/scripts/seed-profile-test-accounts.js; then
      echo "[seed] Profile test accounts seed completed."
    else
      echo "[seed] WARNING: profile test accounts seed failed (non-fatal)."
    fi

    # Données de test pour la bannière d'expiration de licence + le scan QR de
    # check-in (compétition active + 2 licenciés inscrits). Runs last (needs
    # beta@test.com to exist).
    echo "[seed] Seeding check-in test data..."
    if node dist/scripts/seed-checkin-test.js; then
      echo "[seed] Check-in test seed completed."
    else
      echo "[seed] WARNING: check-in test seed failed (non-fatal)."
    fi

    echo "[seed] All staging seeds finished."
  ) &
fi

echo "Starting backend..."
exec node dist/src/main.js
