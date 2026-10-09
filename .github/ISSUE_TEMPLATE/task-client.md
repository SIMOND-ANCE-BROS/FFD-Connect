---
name: Tâche Client (App/Web)
about: Décrire une tâche technique spécifique au côté client (écran, hook, composant...)
title: 'DOMAINE: [résultat attendu]'
labels: 'client'
type: Task
assignees: ''
---

<!-- Conventions : docs/guides/gestion-des-issues.md — type d'issue, une priorité (P0…P3 ou icebox), labels de zone, milestone, epic parente. -->

## Contexte

[Une phrase pour situer la tâche dans l'epic ou le flux utilisateur.]

## Description

[Comportement attendu, écran ou feature concernée, cas nominal et limites.]

## Critères d'acceptation

- [ ] [Critère 1 mesurable]
- [ ] [Critère 2]
- [ ] [Critère 3]

## QA & Tests requis

- [ ] Tests unitaires (si applicable) — _cible 75–80%_ (hooks, utils)
- [ ] Tests d'intégration / UI (si applicable) — _cible 50–60%_ (écrans)
- [ ] Éléments interactifs avec `testID` (si applicable)

## Notes techniques (optionnel)

- Écran : `Screens/...`
- Hooks concernés : `use...(...)`
- **Branche suggérée** : `feat/ID-nom-de-la-feature` ou `fix/ID-nom-du-bug`

## Sous-tâches (optionnel)

Pour détailler en sub-issues, créer des issues et les lier avec **Parent issue** pointant vers cette issue.
