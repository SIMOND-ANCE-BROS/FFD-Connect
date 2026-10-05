# Documentation FFD Connect

Index de la documentation projet (technique et métier). Pour démarrer le projet,
voir le [README racine](../README.md).

## 🏗️ Architecture & décisions

- [Vue d'ensemble de l'architecture](architecture/README.md) — stack, monorepo, où trouver quoi
- [Patterns transverses](architecture/patterns.md) — DI, décomposition de services, hooks, upload Azure, offline-first, monitoring
- [Modules backend](architecture/modules/) — un document par domaine (auth, clubs, compétitions, licences, tracks, paiement…)
- [Règles transverses client](architecture/modules/cross-cutting-rules.md) — navigation, rôles, erreurs
- [Soft deletes](architecture/soft-deletes.md) — ⚠️ proposition, non implémentée
- [Décisions d'architecture (ADR)](adr/) — 18 ADR, index dans [adr/README.md](adr/README.md)

## 🕺 Règles métier FFD

- [Rôles utilisateur](regles-metier/roles.md)
- [Niveaux, couples & accession](regles-metier/niveaux-couples-accession.md)
- [Épreuves solo](regles-metier/epreuves-solo.md)
- [Inscriptions aux compétitions](regles-metier/inscriptions-competitions.md)

## ⚙️ Configuration

- [Variables d'environnement](configuration/environment-variables.md) — liste canonique (source : `env.validation.ts`)

## 🚢 Exploitation (CI/CD, déploiement)

- [Pipeline CI/CD complet](exploitation/ci-cd.md) — schémas, tiers, monitoring
- [Quick reference CI/CD](exploitation/ci-cd-minimal.md) — jobs, échecs courants, KPI
- [Déploiement Azure Container Apps](exploitation/deploiement-azure.md) — flux, smoke test, rollback
- [Changelog beta automatique](exploitation/changelog-beta.md)
- [Isolation des secrets DB](exploitation/isolation-secrets-db.md) — users par env, Key Vault

## 🧪 Tests

- [Vue d'ensemble](tests/README.md) · [Bonnes pratiques](tests/bonnes-pratiques.md) · [Stratégies](tests/strategies.md)

## 📡 API

- [Documentation API](api/README.md) · [Codes d'erreur Swagger](api/swagger-error-codes.md)

## 📘 Guides

- [Gestion des erreurs](guides/gestion-erreurs.md) — format API, retry, messages centralisés
- [Hooks](guides/hooks.md) — index des hooks utilitaires et métier

## ⚖️ Légal

- [Documents légaux](legal/) — ⚠️ brouillons (CGU, mentions légales, confidentialité) à valider avant publication

## 📚 Références

- [Règlement sportif FFD 2025](references/ffd-reglement-2025/) — données source (OCR)

## 🗄️ Archives

- [Documentation historique](archives/) — non maintenue (plans/specs livrés, patch Metro, snapshots datés)
