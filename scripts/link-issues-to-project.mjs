#!/usr/bin/env node
/**
 * Lie toutes les issues du dépôt au projet GitHub (Projects v2) et définit
 * leur état de développement (Status) : À faire / En cours / Terminé.
 *
 * Prérequis : gh auth refresh -s read:project,project
 *
 * Usage (depuis la racine du dépôt FFD-Connect, pas depuis apps/backend) :
 *   node scripts/link-issues-to-project.mjs --project-number <NUM> [--owner GabinSMD] [--dry-run]
 *
 * Le numéro du projet est dans l’URL du projet (ex. …/projects/1 → 1).
 *
 * Règles de statut:
 *   - EPIC-21, EPIC-22, EPIC-23 et leurs tâches (CAR-*, COM-*, ADMIN-*) → Todo / À faire
 *   - Toutes les autres issues (EPIC 1–20 et tâches) → Done / Terminé
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getCurrentUserLogin() {
  try {
    return run('gh api user --jq .login').trim();
  } catch (_) {
    return 'GabinSMD';
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const projectNumber = args.includes('--project-number')
    ? args[args.indexOf('--project-number') + 1]
    : null;
  const owner = args.includes('--owner') ? args[args.indexOf('--owner') + 1] : getCurrentUserLogin();
  const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'GabinSMD/FFD-Connect';
  const dryRun = args.includes('--dry-run');
  return { projectNumber, owner, repo, dryRun };
}

function run(cmd, opts = {}) {
  const defaultOpts = { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 };
  return execSync(cmd, { ...defaultOpts, ...opts });
}

function shellEscape(s) {
  return String(s).replace(/'/g, "'\"'\"'");
}

function graphql(query, variables = {}) {
  const q = query.replace(/\s+/g, ' ').trim();
  const parts = ['gh', 'api', 'graphql', '-f', `'query=${shellEscape(q)}'`];
  for (const [k, v] of Object.entries(variables)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') parts.push('-F', `${k}=${v}`);
    else parts.push('-f', `${k}=${String(v).replace(/"/g, '\\"')}`);
  }
  const cmd = parts.join(' ');
  const out = run(cmd);
  const raw = typeof out === 'string' ? out : String(out);
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart > 0) return JSON.parse(trimmed.slice(jsonStart));
  if (jsonStart !== 0) throw new Error('Réponse inattendue de gh: ' + trimmed.slice(0, 80));
  return JSON.parse(trimmed);
}


function getProjectId(owner, projectNumber) {
  const num = parseInt(projectNumber, 10);
  try {
    const out = run('gh project list --format json --limit 100');
    const data = JSON.parse(out);
    const projects = data?.projects || data || [];
    const project = projects.find(
      (p) => p.number === num && (p.owner?.login === owner || p.owner === owner)
    );
    if (project) return { id: project.id, title: project.title || 'Project ' + num };
  } catch (e) {
    if (String(e.stderr || e.message || e).includes('scope')) {
      throw new Error('Scope "project" manquant. Exécutez : gh auth refresh -s read:project,project');
    }
  }
  return null;
}

function getProjectFields(projectId) {
  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2FieldCommon { id name }
              ... on ProjectV2SingleSelectField {
                id name
                options { id name }
              }
            }
          }
        }
      }
    }
  `;
  const r = graphql(query, { id: projectId });
  const node = r?.data?.node;
  if (!node?.fields?.nodes) return { statusFieldId: null, statusOptions: {} };
  const statusField = node.fields.nodes.find((f) => /status|statut/i.test(f.name) && f.options);
  if (!statusField) return { statusFieldId: null, statusOptions: {} };
  const options = {};
  for (const opt of statusField.options || []) {
    const n = (opt.name || '').toLowerCase();
    if (/todo|à faire|backlog|à développer/.test(n)) options.todo = opt.id;
    else if (/progress|en cours/.test(n)) options.inProgress = opt.id;
    else if (/done|terminé|fini/.test(n)) options.done = opt.id;
  }
  return { statusFieldId: statusField.id, statusOptions: options };
}

function getAllIssues(owner, repo) {
  const [o, r] = repo.split('/');
  const issues = [];
  let page = 1;
  while (true) {
    const out = run(`gh api "repos/${o}/${r}/issues?state=all&per_page=100&page=${page}"`);
    const arr = JSON.parse(out || '[]');
    if (!Array.isArray(arr)) break;
    for (const i of arr) {
      if (i.pull_request) continue;
      issues.push({ number: i.number, title: i.title || '', node_id: i.node_id });
    }
    if (arr.length < 100) break;
    page++;
  }
  return issues;
}

function getStatusForIssue(title, statusOptions) {
  const t = title || '';
  const isTodo = /^EPIC-2[123]\s*[: ]/.test(t) || /^(CAR|COM|ADMIN)-\d+:\s/.test(t);
  if (isTodo && statusOptions.todo) return statusOptions.todo;
  if (statusOptions.done) return statusOptions.done;
  if (statusOptions.todo) return statusOptions.todo;
  return null;
}

function addItemToProject(projectId, contentId) {
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;
  const r = graphql(mutation, { projectId, contentId });
  return r?.data?.addProjectV2ItemById?.item?.id;
}

function updateItemStatus(projectId, itemId, fieldId, optionId) {
  const esc = String(optionId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: "${esc}" }
      }) {
        projectV2Item { id }
      }
    }
  `;
  graphql(mutation, { projectId, itemId, fieldId });
}

function main() {
  const { projectNumber, owner, repo, dryRun } = parseArgs();
  if (!projectNumber) {
    console.error('Usage: node scripts/link-issues-to-project.mjs --project-number <NUM> [--owner GabinSMD] [--dry-run]');
    process.exit(1);
  }

  console.log('Liaison des issues au projet GitHub (Projects v2)');
  console.log('Owner (projets):', owner);
  console.log('Récupération du projet...');
  let project;
  try {
    project = getProjectId(owner, projectNumber);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (!project) {
    console.error('Projet non trouvé. Vérifiez --project-number (ex. 4) et --owner (ex. GabinSMD).');
    console.error('Si le projet existe, activez le scope : gh auth refresh -s read:project,project');
    process.exit(1);
  }
  console.log('  Projet:', project.title, '(' + project.id + ')');

  console.log('\nRécupération du champ Status...');
  const { statusFieldId, statusOptions } = getProjectFields(project.id);
  if (!statusFieldId || (!statusOptions.done && !statusOptions.todo)) {
    console.warn('  Champ Status non trouvé ou sans options Todo/Done. Les issues seront ajoutées sans modifier le statut.');
  } else {
    console.log('  Status field:', statusFieldId, '| Options:', Object.keys(statusOptions).join(', '));
  }

  console.log('\nRécupération des issues du dépôt...');
  const issues = getAllIssues(owner, repo);
  console.log('  ', issues.length, 'issues');

  let added = 0;
  let statusSet = 0;
  for (const issue of issues) {
    if (dryRun) {
      const statusOpt = getStatusForIssue(issue.title, statusOptions);
      console.log('  [dry-run] #' + issue.number, issue.title.slice(0, 50) + '...', '→', statusOpt ? 'statut défini' : 'ajout seul');
      added++;
      if (statusOpt) statusSet++;
      continue;
    }
    try {
      const itemId = addItemToProject(project.id, issue.node_id);
      if (itemId) added++;
      const optionId = getStatusForIssue(issue.title, statusOptions);
      if (optionId && statusFieldId && itemId) {
        updateItemStatus(project.id, itemId, statusFieldId, optionId);
        statusSet++;
      }
    } catch (e) {
      console.warn('  Erreur #' + issue.number, e.message?.slice(0, 60));
    }
  }

  console.log('\nTerminé. Issues ajoutées au projet:', added, '| Statut défini:', statusSet);
}

main();
