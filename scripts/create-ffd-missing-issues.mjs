#!/usr/bin/env node
/**
 * Crée les Epic et tâches manquantes issus de ffd.md (sections 3.4, 3.5, 3.6)
 * puis les lie en sub-issues à leur Epic. Utilise le format des templates .github/ISSUE_TEMPLATE/
 *
 * Usage: node scripts/create-ffd-missing-issues.mjs [--dry-run]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const repo = 'GabinSMD/FFD-Connect';

function run(cmd, opts = {}) {
  if (dryRun && (cmd.includes('issue create') || cmd.includes('sub_issues'))) {
    console.log('[dry-run]', cmd.slice(0, 100) + '...');
    return dryRun ? '' : execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, ...opts });
  }
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, ...opts });
}

function getIssueId(issueNumber) {
  const out = run(`gh api repos/${repo}/issues/${issueNumber} --jq .id`);
  return out ? parseInt(out.trim(), 10) : null;
}

function createIssue(title, body, labels) {
  const bodyFile = path.join(__dirname, '.gh-body-create.txt');
  fs.writeFileSync(bodyFile, body, 'utf-8');
  try {
    const out = run(`gh issue create --repo ${repo} --title "${title}" --body-file "${bodyFile}" --label "${labels.join(',')}"`);
    const url = out.trim();
    const num = url.match(/\/issues\/(\d+)/)?.[1];
    return num ? parseInt(num, 10) : null;
  } finally {
    try { fs.unlinkSync(bodyFile); } catch (_) {}
  }
}

function addSubIssue(parentIssueNumber, subIssueGlobalId) {
  const body = JSON.stringify({ sub_issue_id: subIssueGlobalId });
  const tmp = path.join(__dirname, '.gh-api-body.json');
  fs.writeFileSync(tmp, body, 'utf-8');
  try {
    run(`gh api repos/${repo}/issues/${parentIssueNumber}/sub_issues -X POST -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --input "${tmp}"`);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

const epicBody = (objectif, moduleName, stack) => `## Objectif

${objectif}

## Périmètre

| Élément | Détail |
|--------|--------|
| **Module / Feature** | \`${moduleName}\` |
| **Stack** | ${stack} |

## Livrables (tâches liées)

Les tâches sont liées via la relation **Parent issue** (Relationships). Voir les sub-issues de cette epic.

## Notes

[Optionnel : dépendances, contraintes, liens vers la doc ou l'API.]
- **Definition of Done** : Toutes les sub-issues (tâches) sont fermées et leurs critères d'acceptation validés.
`;

const taskBody = (contexte, description, criteria, id, slug) => `## Contexte

${contexte}

## Description

${description}

## Critères d'acceptation

${criteria}

## QA & Tests requis

- [ ] Tests unitaires (si applicable) — Services, Utils
- [ ] Tests E2E (si applicable) — endpoints critiques, contrôleurs

## Notes techniques (optionnel)

- **Branche suggérée** : \`feat/${id}-${slug}\` ou \`fix/${id}-${slug}\`

## Sous-tâches (optionnel)

Pour détailler en sub-issues, créer des issues et les lier avec **Parent issue** pointant vers cette issue.
`;

function slug(title) {
  const w = (title.split(/[\s(]+/)[0] || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
  return w || 'feature';
}

function getEpic23Number() {
  const out = run(`gh issue list --repo ${repo} --label epic --state all --limit 30 --json number,title`);
  const list = JSON.parse(out || '[]');
  const found = list.find((i) => (i.title || '').match(/^EPIC-23\s*[: ]/));
  return found ? found.number : null;
}

function main() {
  console.log('--- EPIC-23 : Portail Admin Web ---');
  let epic23Num = getEpic23Number();
  if (!epic23Num && !dryRun) {
    const epic23Body = epicBody(
      "Offrir à la FFD un outil de pilotage et de communication directe (dashboard, notifications ciblées, modération des certificats).",
      "admin-web",
      "Backend (NestJS) / Web (Back-Office)"
    );
    epic23Num = createIssue("EPIC-23 : Portail Admin Web (Back-Office Fédéral)", epic23Body, ["epic", "backend"]);
    if (epic23Num) console.log('  Créé Epic #' + epic23Num);
  } else if (epic23Num) {
    console.log('  Epic existante #' + epic23Num);
  } else if (dryRun) {
    epic23Num = 136;
    console.log('  Epic #' + epic23Num + ' (simulé)');
  }

  const tasks = [
    {
      parent: 134,
      epicLabel: 'Carrière',
      list: [
        { id: 'CAR-1', title: 'Palmarès (historique compétitions, classements, points)', desc: 'API et stockage : historique complet des compétitions, classements et points acquis du licencié. PostgreSQL partitionné.', crit: '- [ ] API exposant l’historique par utilisateur\n- [ ] Données cohérentes avec les résultats compétitions' },
        { id: 'CAR-2', title: 'Suivi de progression (points, montée de niveau, qualif CF)', desc: 'Jauge visuelle des points restants pour la montée de niveau ou la qualification aux Championnats de France. Calcul et exposition API.', crit: '- [ ] Règles de points et niveaux définies\n- [ ] Endpoint ou données pour affichage jauge' },
        { id: 'CAR-3', title: 'Règlements intelligents (recherche full-text par catégorie)', desc: 'Moteur de recherche filtrant les règles par catégorie (ex: tenues autorisées Junior I). Full-Text Search (TSVECTOR) sur règlements tagués.', crit: '- [ ] Indexation règlements tagués\n- [ ] API recherche par catégorie / mot-clé' },
      ],
    },
    {
      parent: 135,
      epicLabel: 'Communautaire',
      list: [
        { id: 'COM-1', title: 'Bourse aux partenaires (matching niveau, taille, géo)', desc: 'Matching sécurisé réservé aux licenciés par niveau, taille et géographie. PostGIS + Geohashing (privacy).', crit: '- [ ] API critères de matching\n- [ ] Respect vie privée (géohash)' },
        { id: 'COM-2', title: 'Covoiturage événementiel', desc: 'Mise en relation des danseurs d’une même région se rendant à la même compétition.', crit: '- [ ] Modèle données covoiturage / événement\n- [ ] API proposition et réservation' },
        { id: 'COM-3', title: 'Vide-Dressing (revente matériel d’occasion certifié)', desc: 'Espace de revente de matériel d’occasion certifié (licenciés).', crit: '- [ ] Modèle annonces / catégories\n- [ ] API CRUD annonces (authentifié)' },
      ],
    },
    {
      parent: epic23Num,
      epicLabel: 'Admin Web',
      list: [
        { id: 'ADMIN-1', title: 'Dashboard analytique (carte chaleur, statistiques usage)', desc: 'Carte de chaleur et statistiques d’usage pour le pilotage FFD. Back-office web.', crit: '- [ ] Agrégations métier exposées (API ou intégrées)\n- [ ] Visualisation carte / stats' },
        { id: 'ADMIN-2', title: 'Centre de notification (Push ciblés région / discipline)', desc: 'Envoi de Push ciblés par région ou discipline. Intégration FCM / centre de notification.', crit: '- [ ] API ou interface d’envoi ciblé\n- [ ] Ciblage région / discipline' },
        { id: 'ADMIN-3', title: 'Modération (validation manuelle certificats rejetés IA)', desc: 'Validation manuelle des certificats rejetés par l’IA. Interface de modération pour les équipes FFD.', crit: '- [ ] Liste des certificats en attente / rejetés\n- [ ] Action de validation / rejet manuel' },
      ],
    },
  ];

  for (const group of tasks) {
    if (!group.parent) continue;
    console.log('\n--- Tâches pour Epic #' + group.parent + ' (' + group.epicLabel + ') ---');
    const label = group.epicLabel === 'Admin Web' ? 'backend' : 'backend';
    for (const t of group.list) {
      const body = taskBody(t.desc, t.desc, t.crit, t.id, slug(t.title));
      const num = createIssue(`${t.id}: ${t.title}`, body, [label]);
      if (num && !dryRun) {
        const globalId = getIssueId(num);
        if (globalId) {
          addSubIssue(group.parent, globalId);
          console.log('  Créé et lié #' + num, t.id);
        }
      } else if (dryRun) {
        console.log('  [dry-run]', t.id, t.title);
      }
    }
  }

  console.log('\nTerminé.' + (dryRun ? ' (dry-run)' : ''));
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
