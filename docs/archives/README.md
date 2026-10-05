# Archives documentaires

Ce dossier conserve la documentation **historique** : elle a eu de la valeur à un
moment donné mais ne décrit plus l'état actuel du projet. On la garde comme trace
(contexte de décisions, post-mortem, réutilisation ponctuelle) **hors du chemin de
lecture principal** pour que la doc active reste fiable.

> ⚠️ Le contenu de ce dossier n'est **pas maintenu** et peut contredire le code actuel.
> Pour l'état à jour, voir [l'index de la documentation](../README.md).

## Contenu

| Élément                              | Nature                                         | Pourquoi archivé                                                                  |
| ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `plans/`                             | Plans d'implémentation datés (mars–avril 2026) | Travail livré ; conservés comme trace de conception                               |
| `specs/`                             | Specs de conception associées aux plans        | Idem                                                                              |
| `metro-patch/`                       | Analyse du patch Metro (6 docs)                | Patch Metro retiré ; seul `react-native` reste patché (voir `patches/PATCHES.md`) |
| `analyse-approfondie-2026-02.md`     | Audit ponctuel du code (février 2026)          | Snapshot périmé (des centaines de commits depuis)                                 |
| `test-coverage-analysis-2026-02.md`  | Analyse de couverture (février 2026)           | Seuils et chiffres obsolètes ; la stratégie vivante est dans `../tests/`          |
| `github-issue-body-templates.md`     | Exemples de corps d'issues                     | Redondant : la source de vérité est `.github/ISSUE_TEMPLATE/`                     |
| `dependency-audit-2026-04.md`        | Audit de dépendances (avril 2026)              | Snapshot ; relancer `pnpm audit` pour l'état réel                                 |
| `aws-migration-checklist-2026-04.md` | Checklist migration AWS                        | Abandonnée : l'infra est sur Azure (voir `../exploitation/deploiement-azure.md`)  |
