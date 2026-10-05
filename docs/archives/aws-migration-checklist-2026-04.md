# Migration GCP → AWS — Checklist J-7 à J+1

## Context

- **Origine** : Google Cloud (crédits épuisés)
- **Cible** : AWS (2000$/an de crédits)
- **Stack** : EC2 + Docker Compose (Postgres, Redis, NestJS) + S3 + Route 53
- **Domaines** : `api.ffd-connect.fr` (prod), `api-staging.ffd-connect.fr` (staging)

---

## J-7 : Préparation AWS

### Compte & budget

- [ ] Créer/configurer le compte AWS + appliquer les crédits
- [ ] Activer MFA sur le compte root
- [ ] Créer un utilisateur IAM admin (ne jamais utiliser root)
- [ ] Configurer une alerte budget AWS à 150$/mois (seuil warning à 120$)
- [ ] Activer AWS Cost Explorer

### Terraform — infra de base

- [ ] Écrire le Terraform (VPC, SG, EC2, EBS, Elastic IP, S3, Route 53)
- [ ] Inclure snapshot EBS automatique (AWS Backup, quotidien, rétention 7j)
- [ ] Créer le bucket S3 `ffd-connect-uploads` (versionné, lifecycle 90j pour les anciennes versions)
- [ ] Créer le bucket S3 `ffd-connect-backups` (lifecycle: suppression après 30j)
- [ ] `terraform plan` — vérifier les coûts estimés
- [ ] `terraform apply` sur un workspace `staging` d'abord

### Estimation budget (marge 25% incluse)

| Service                | Coût/mois (eu-west-3) | Avec marge 25%           |
| ---------------------- | --------------------- | ------------------------ |
| EC2 t3.small           | ~15$                  | ~19$                     |
| EBS 50 GB gp3          | ~4$                   | ~5$                      |
| S3 (uploads + backups) | ~3$                   | ~4$                      |
| Snapshots EBS (7j)     | ~2$                   | ~3$                      |
| Elastic IP             | 0$ (attachée)         | 0$                       |
| Route 53               | ~1$                   | ~1$                      |
| Data transfer (~10 GB) | ~5$                   | ~6$                      |
| CloudWatch (alertes)   | ~3$                   | ~4$                      |
| **Total**              | **~33$**              | **~42$/mois = ~504$/an** |

**Marge restante : ~1496$/an** pour upgrade t3.medium, RDS, ou ElastiCache si besoin.

---

## J-5 : Provisioning & configuration

### Instance EC2

- [ ] `terraform apply` — provisionner l'instance (eu-west-3, Paris)
- [ ] SSH fonctionnel avec la clé déployée
- [ ] Installer Docker + Docker Compose
- [ ] Installer AWS CLI (pour les backups S3)
- [ ] Configurer les alertes CloudWatch :
  - CPU > 80% pendant 5 min
  - Disque > 80% utilisé
  - StatusCheckFailed

### Security groups

- [ ] Port 22 (SSH) : restreint aux IPs GitHub Actions + votre IP
- [ ] Port 80/443 (HTTP/HTTPS) : ouvert (0.0.0.0/0)
- [ ] Port 5432/6379 : fermés (internes Docker uniquement)

### Docker Compose

- [ ] Copier `docker-compose.yml` + `docker-compose.production.yml` sur l'instance
- [ ] Configurer `.env.production` avec les nouvelles valeurs
- [ ] `docker compose up -d` — vérifier que tout démarre
- [ ] Vérifier le health check : `curl http://localhost:3000/health`

---

## J-3 : Backup & migration des données

### Dump PostgreSQL (depuis GCP)

```bash
# Sur l'instance GCP
docker exec postgres pg_dump -U ffd -d ffd_connect_prod \
  --format=custom --compress=9 \
  -f /tmp/ffd_connect_prod.dump

# Copier vers AWS
scp /tmp/ffd_connect_prod.dump ec2-user@<AWS_IP>:/tmp/
```

### Restaurer sur AWS

```bash
# Sur l'instance AWS
docker exec -i postgres pg_restore -U ffd -d ffd_connect_prod \
  --clean --if-exists \
  /tmp/ffd_connect_prod.dump
```

### Migrer les uploads vers S3

```bash
# Depuis GCP : copier les fichiers locaux
scp -r uploads/ ec2-user@<AWS_IP>:/tmp/uploads/

# Sur AWS : upload vers S3
aws s3 sync /tmp/uploads/ s3://ffd-connect-uploads/
```

### Configurer le backup PostgreSQL automatique

```bash
# Cron quotidien sur l'instance AWS (à ajouter)
# /etc/cron.d/pg-backup
0 3 * * * root docker exec postgres pg_dump -U ffd -d ffd_connect_prod \
  --format=custom --compress=9 \
  -f /tmp/pg_backup_$(date +\%Y\%m\%d).dump \
  && aws s3 cp /tmp/pg_backup_$(date +\%Y\%m\%d).dump \
  s3://ffd-connect-backups/postgres/ \
  && find /tmp -name "pg_backup_*.dump" -mtime +3 -delete
```

---

## J-1 : Staging validation

- [ ] Déployer le staging sur AWS (`docker-compose.staging.yml`)
- [ ] Vérifier tous les endpoints critiques :
  - `GET /health`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/competitions`
  - WebSocket connexion
  - Upload de fichier
- [ ] Tester le pipeline GitHub Actions → SSH AWS staging
- [ ] Vérifier les push notifications (Firebase — appels API, pas affecté)
- [ ] Vérifier les APIs Google Cloud (Vision, TTS — appels API, pas affecté)
- [ ] Vérifier Resend (email — pas affecté)
- [ ] Monitorer les logs : `docker compose logs -f backend`
- [ ] Valider que le backup Postgres S3 fonctionne

---

## Jour J : Bascule production

### Séquence (fenêtre de maintenance ~15 min)

```
1. [T+0]   Annoncer la maintenance (si utilisateurs actifs)
2. [T+1]   Dump final PostgreSQL sur GCP
3. [T+3]   Copier le dump vers AWS + restaurer
4. [T+8]   Démarrer les conteneurs AWS
5. [T+10]  Vérifier le health check
6. [T+11]  Basculer le DNS (Route 53 : api.ffd-connect.fr → Elastic IP AWS)
7. [T+13]  Vérifier la propagation DNS (dig api.ffd-connect.fr)
8. [T+14]  Mettre à jour les secrets GitHub Actions (SSH_HOST)
9. [T+15]  Smoke test complet en production
```

### Rollback plan

Si problème critique après bascule :

```bash
# Repointer le DNS vers GCP (TTL court = propagation rapide)
# Les données GCP sont encore intactes (on n'a rien supprimé)
# Temps de rollback : ~2 min (changement DNS)
```

**Important : ne pas supprimer l'instance GCP avant J+7 minimum.**

---

## J+1 : Validation post-migration

- [ ] Vérifier les logs backend (pas d'erreurs)
- [ ] Vérifier que les jobs BullMQ tournent (Redis ok)
- [ ] Vérifier les tâches schedulées (`@nestjs/schedule`)
- [ ] Confirmer le backup PostgreSQL automatique (vérifier S3)
- [ ] Confirmer les snapshots EBS (vérifier AWS Backup)
- [ ] Vérifier les alertes CloudWatch fonctionnent (test CPU spike)
- [ ] Pipeline CI/CD : push un commit, vérifier le deploy sur AWS
- [ ] Monitorer les coûts AWS (Cost Explorer)

---

## Post-migration : plan d'évolution

### Court terme (mois 1-2)

- [ ] Migrer les uploads du volume Docker vers S3 (modifier multer → S3 adapter)
- [ ] Configurer les logs vers CloudWatch Logs (au lieu de stdout)

### Moyen terme (quand la charge augmente)

- [ ] Migrer PostgreSQL conteneur → RDS (backup managé, failover, replicas)
- [ ] Migrer Redis conteneur → ElastiCache (persistence, monitoring)
- [ ] Passer en t3.medium si CPU > 70% en moyenne

### Signaux pour migrer vers services managés

| Signal                      | Action                     |
| --------------------------- | -------------------------- |
| Perte de données PostgreSQL | → RDS immédiatement        |
| Redis OOM / crash           | → ElastiCache              |
| Besoin de haute dispo       | → RDS Multi-AZ + ALB       |
| Trafic x10                  | → ALB + Auto Scaling Group |

---

## Notes

- Les APIs Google Cloud (Vision, TTS, GenAI) restent sur GCP — ce sont des appels HTTP, pas de colocation nécessaire
- Firebase (push notifications) : aucun changement
- New Relic / Sentry : aucun changement (agents embarqués dans le conteneur)
- TTL DNS : baisser à 60s 48h avant la bascule pour accélérer la propagation
