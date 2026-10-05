# Checklist migration GCP -> Azure

> **Origine :** Google Cloud (credits epuises)
> **Cible :** Azure (2 000 $/an de credits nonprofit)
> **Stack :** VM + Docker Compose (Postgres, Redis, NestJS) + Blob Storage + Azure DNS
> **Domaines :** `api.ffd-connect.fr` (prod), `api-staging.ffd-connect.fr` (staging)

---

## J-7 : Preparation Azure

### Compte & securite

- [ ] Creer le compte Azure nonprofit et appliquer les credits (2 000 $/an)
- [ ] Activer MFA sur le compte principal
- [ ] Creer un utilisateur admin dedie (ne pas utiliser le compte principal au quotidien)
- [ ] Configurer une alerte budget a 150 $/mois via Azure Cost Management
- [ ] Verifier que le dashboard Azure Cost Management remonte bien les couts par ressource

### Terraform

- [ ] Ecrire / adapter les fichiers Terraform pour Azure (Resource Group, VM, NSG, Public IP, DNS, Blob Storage, Managed Disk)
- [ ] `terraform plan` sur l'environnement staging d'abord
- [ ] `terraform apply` sur staging
- [ ] Valider que toutes les ressources sont creees correctement

### Estimation budget mensuel

| Ressource                 | Cout estime    |
| ------------------------- | -------------- |
| VM B2s (2 vCPU, 4 Go)     | ~15 $/mois     |
| Managed Disk (32 Go SSD)  | ~4 $/mois      |
| Blob Storage              | ~3 $/mois      |
| Public IP (statique)      | ~4 $/mois      |
| Azure DNS                 | ~1 $/mois      |
| Backup (snapshots)        | ~3 $/mois      |
| Bande passante sortante   | ~5 $/mois      |
| Divers (logs, monitoring) | ~5 $/mois      |
| **Total**                 | **~40 $/mois** |

---

## J-5 : Provisioning

- [ ] `terraform apply` sur l'environnement de production
- [ ] Verifier l'acces SSH a la VM (`ssh azureuser@<public-ip>`)
- [ ] Docker + Docker Compose installes (via cloud-init ou script post-deploy)
- [ ] Azure CLI installe sur la VM
- [ ] Regles NSG (Network Security Group) verifiees :
  - Port 22 (SSH) — restreint a l'IP admin uniquement
  - Port 80 (HTTP) — ouvert
  - Port 443 (HTTPS) — ouvert
  - Tous les autres ports fermes
- [ ] Cloner le repo sur la VM et verifier que `docker compose up` demarre sans erreur (sans donnees)
- [ ] Configurer les variables d'environnement (`.env`) sur la VM

---

## J-3 : Backup & migration des donnees

### Base de donnees

- [ ] `pg_dump` depuis la VM GCP (dump complet, format custom)
  ```bash
  pg_dump -Fc -h localhost -U ffd ffd_connect > ffd_connect_$(date +%Y%m%d).dump
  ```
- [ ] `scp` du dump vers la VM Azure
  ```bash
  scp ffd_connect_*.dump azureuser@<azure-ip>:/home/azureuser/backups/
  ```
- [ ] `pg_restore` sur le Postgres Azure (dans le container Docker)
  ```bash
  docker compose exec -T postgres pg_restore -U ffd -d ffd_connect --clean --if-exists < /backups/ffd_connect_*.dump
  ```
- [ ] Verifier le nombre de lignes sur les tables critiques (users, competitions, licenses, clubs)

### Fichiers uploads

- [ ] Transferer les uploads vers Azure Blob Storage
  ```bash
  az storage blob upload-batch \
    --destination uploads \
    --source ./uploads \
    --account-name ffdconnectstorage
  ```
- [ ] Verifier que les fichiers sont accessibles via leur URL Blob Storage

### Backup automatique

- [ ] Configurer le cron de backup Postgres sur la VM Azure
- [ ] Verifier qu'un backup automatique se lance correctement
- [ ] Tester la restauration a partir du backup automatique

---

## J-1 : Validation staging

- [ ] Deployer l'environnement staging complet sur Azure (`docker compose --profile full up -d`)
- [ ] Verifier tous les endpoints critiques :
  - [ ] `GET /health` — 200
  - [ ] `POST /auth/login` — connexion fonctionnelle
  - [ ] `GET /competitions` — liste des competitions
  - [ ] `GET /clubs` — liste des clubs
  - [ ] `POST /tracks/upload` — upload de musique (Blob Storage)
  - [ ] Webhooks HelloAsso (payment)
- [ ] Tester le pipeline GitHub Actions -> Azure VM (deploy automatique)
- [ ] Confirmer que les services externes ne sont pas affectes :
  - [ ] Firebase (auth push notifications) — appels HTTP, pas de changement
  - [ ] Google Cloud Vision (analyse d'images) — appels HTTP, pas de changement
  - [ ] Resend (emails) — appels HTTP, pas de changement
- [ ] Tester les certificats HTTPS via Caddy sur le domaine staging
- [ ] Verifier les logs applicatifs (`docker compose logs -f backend`)

---

## Jour J : Bascule production (~15 min)

### Sequence de bascule

1. [ ] **Mode maintenance** — Activer la page de maintenance sur le frontend si disponible
2. [ ] **Dump final** depuis GCP
   ```bash
   # Sur la VM GCP
   pg_dump -Fc -h localhost -U ffd ffd_connect > ffd_connect_final.dump
   ```
3. [ ] **Copie vers Azure**
   ```bash
   scp ffd_connect_final.dump azureuser@<azure-ip>:/home/azureuser/backups/
   ```
4. [ ] **Restore sur Azure**
   ```bash
   docker compose exec -T postgres pg_restore -U ffd -d ffd_connect --clean --if-exists < /backups/ffd_connect_final.dump
   ```
5. [ ] **Demarrer les containers** sur Azure
   ```bash
   docker compose --profile full up -d
   ```
6. [ ] **Bascule DNS** — Modifier les enregistrements A dans Azure DNS :
   - `api.ffd-connect.fr` -> nouvelle IP Azure
   - `api-staging.ffd-connect.fr` -> nouvelle IP Azure staging
   - TTL bas (300s) deja configure a J-1
7. [ ] **Smoke test** — Verifier les endpoints critiques sur le domaine de production
8. [ ] **Desactiver le mode maintenance**

### Plan de rollback

- Repointer les enregistrements DNS vers les IPs GCP
- Les containers GCP restent actifs pendant 48h apres la bascule
- Temps de rollback estime : < 5 min (propagation DNS avec TTL 300s)

---

## J+1 : Validation post-migration

- [ ] Verifier les logs applicatifs — pas d'erreurs inattendues
- [ ] Verifier les jobs BullMQ (queues Redis) — tous les jobs en cours se traitent correctement
- [ ] Verifier les scheduled tasks (cron jobs NestJS) — declenchement normal
- [ ] Verifier le backup automatique — un nouveau backup a ete cree depuis la migration
- [ ] Configurer les alertes Azure Monitor :
  - [ ] CPU VM > 80% pendant 5 min
  - [ ] Disque > 85% utilise
  - [ ] Container unhealthy
  - [ ] Erreurs 5xx > 10/min
- [ ] Verifier le pipeline CI/CD complet (push -> deploy -> smoke test)
- [ ] Confirmer que les anciens services GCP peuvent etre eteints
- [ ] Mettre a jour la documentation interne (runbooks, diagrammes d'architecture)

---

## Post-migration

### Court terme (1-2 semaines)

- [ ] Supprimer les ressources GCP une fois la stabilite confirmee (apres 1 semaine minimum)
- [ ] Adapter le `BackupService` pour utiliser Azure Blob Storage comme destination de backup
- [ ] Mettre a jour les runbooks CI/CD pour refleter l'infrastructure Azure
- [ ] Verifier les couts reels vs estimation apres 1 semaine

### Moyen terme (1-3 mois)

- [ ] **Blob Storage adapter** — Migrer le stockage des uploads du filesystem local vers Azure Blob Storage natif (adapter le service d'upload dans le backend)
- [ ] **Azure Database for PostgreSQL** — Evaluer la migration vers le service manage (Flexible Server) pour simplifier les backups, la haute disponibilite et les mises a jour
- [ ] **Azure Cache for Redis** — Evaluer la migration vers le service manage pour BullMQ et le cache applicatif
- [ ] **Azure Container Apps** — Evaluer la migration depuis Docker Compose sur VM vers un orchestrateur manage (si le budget le permet)
- [ ] Configurer Azure Advisor pour les recommandations d'optimisation de couts
