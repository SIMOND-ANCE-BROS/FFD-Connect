---
name: Epic
about: Décrire un objectif de haut-niveau et son périmètre métier
title: '[thème]'
type: Epic
assignees: ''
---

<!-- Conventions : docs/guides/gestion-des-issues.md — pas de priorité sur une epic (elle vit sur ses sub-issues), labels de zone, milestone ou icebox. -->

## Objectif

[Une phrase ou deux décrivant la valeur métier et le périmètre de l'epic.]

## Périmètre

| Élément              | Détail                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Module / Feature** | ex. `auth`, `competitions`, `license`, `tracks` (backend) — `auth`, `competitions`, `club`, `player`, `settings` (client) |
| **Stack**            | Backend (NestJS) / Client (Expo) / Transverse                                                                             |

## Livrables (tâches liées)

Les tâches sont liées via la relation **Parent issue** (Relationships). Voir les sub-issues de cette epic.

## Notes

[Optionnel : dépendances, contraintes, liens vers la doc ou l'API.]

- **Definition of Done** : Toutes les sub-issues (tâches) sont fermées et leurs critères d'acceptation validés.
