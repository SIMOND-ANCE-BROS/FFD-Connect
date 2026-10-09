---
name: Tâche Backend
about: Décrire une tâche technique spécifique au backend (endpoint, service...)
title: 'DOMAINE: [résultat attendu]'
labels: 'backend'
type: Task
assignees: ''
---

<!-- Conventions : docs/guides/gestion-des-issues.md — type d'issue, une priorité (P0…P3 ou icebox), labels de zone, milestone, epic parente. -->

## Contexte

[Une phrase pour situer la tâche dans l'epic ou le flux utilisateur.]

## Description

[Comportement attendu, endpoint ou module concerné, cas nominal et limites.]

## Critères d'acceptation

- [ ] [Critère 1 mesurable]
- [ ] [Critère 2]
- [ ] [Critère 3]

## QA & Tests requis

- [ ] Tests unitaires (si applicable) — Services, Utils
- [ ] Tests E2E (si applicable) — endpoints critiques, contrôleurs

## Notes techniques (optionnel)

- Endpoint : `METHOD /path`
- Fichiers concernés : `src/...`
- Contraintes : rate limit, rôles, etc.
- **Branche suggérée** : `feat/ID-nom-de-la-feature` ou `fix/ID-nom-du-bug`

## Sous-tâches (optionnel)

Pour détailler en sub-issues, créer des issues et les lier avec **Parent issue** pointant vers cette issue.
