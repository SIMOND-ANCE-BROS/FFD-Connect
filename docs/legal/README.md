# Documents légaux — FFD-Connect

Documents légaux/RGPD requis pour la publication de l'application (stores) et la
conformité (issue #424).

**Ce sont les textes de référence.** Ils sont publiés tels quels sur le site vitrine
(`/confidentialite/`, `/cgu/`, `/mentions-legales/`, `/suppression-compte/`, rendus au build par
`apps/landing/legal-plugin.ts`) et résumés dans l'application
(`apps/client/src/features/legal/legalContent.ts`). Toute évolution des données
collectées ou des sous-traitants doit être répercutée aux deux endroits.

| Document                           | Fichier                                                        | Rôle                                                   |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Mentions légales                   | [mentions-legales.md](./mentions-legales.md)                   | éditeur, hébergeur, propriété intellectuelle           |
| Conditions Générales d'Utilisation | [cgu.md](./cgu.md)                                             | règles d'usage, comptes, responsabilités               |
| Politique de confidentialité       | [politique-confidentialite.md](./politique-confidentialite.md) | RGPD : données, finalités, sous-traitants, droits      |
| Suppression du compte              | [suppression-compte.md](./suppression-compte.md)               | procédure + données conservées (exigé par Google Play) |

## État

|                                                        |                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Identité de l'éditeur, contact, durées de conservation | ✅ renseignés (5 octobre 2026)                                                   |
| Publication à des URL publiques                        | ✅ `deploy-landing.yml` — requis par Apple et Google                             |
| Lien depuis l'application                              | ✅ Réglages + gate CGU à la première ouverture                                   |
| **Relecture par un·e juriste**                         | ❌ **jamais faite**                                                              |
| CGU en vigueur                                         | version 2 (11 octobre 2026) — re-acceptation demandée dans l'app (`CGU_VERSION`) |

Les textes décrivent les traitements réellement implémentés, ce qui est le minimum
exigible — pas une validation juridique. Deux points méritent un avis avant un
lancement grand public :

- **Mineurs** : ils sont aujourd'hui **exclus** par l'article 3 des CGU, faute de
  dispositif de recueil du consentement parental (#418). La FFD licencie des mineurs,
  donc cette exclusion est une impasse à terme, pas une solution.
- **Données de santé** (certificat médical, art. 9 RGPD) : le chiffrement applicatif
  renforcé est encore une cible, pas un acquis (#418).

**Rétention des données de santé — désormais appliquée par le code** (#62). La durée
annoncée au §5 de la politique n'était tenue par aucun mécanisme : rien ne supprimait
jamais le fichier archivé ni les données extraites par OCR. Une purge s'exécute
maintenant toutes les heures, et à chaque démarrage — le backend dort à
`minReplicas=0`, et le démarrage est le seul instant dont on soit certain.

L'échéance est calculée à partir de la date d'émission lue sur le certificat. **Quand
l'OCR ne l'a pas trouvée**, elle est calculée depuis la date de dépôt sans compter la
durée de validité : le document peut alors être supprimé jusqu'à un an plus tôt que
nécessaire. C'est délibéré — la politique promet « au plus tard », donc supprimer en
avance la respecte, tandis que supposer une émission tardive risquerait de la violer.

**Vérification humaine du certificat médical** (#270, épique #19). Les CGU (§5) et la
politique (§2 à §5, §7, §9) annoncent que l'éditeur, administrateur de la plateforme,
vérifie lui-même le certificat : il ouvre le fichier tant que la demande est en
attente, chaque ouverture est tracée, et la lecture OCR ne donne que des indices.
Un certificat refusé est purgé au plus tard 30 jours après la décision, avec le
commentaire de l'administrateur. Ce passage aux CGU v2 doit être publié au plus tard
avec la fin de l'auto-approbation (#271).

- **Publication** : le site ne publie `docs/legal` qu'au push sur `staging`, et
  `CGU_VERSION` n'atteint l'app qu'avec le build ou la mise à jour suivante. Une
  fusion dans `develop` ne publie rien : ces textes doivent arriver sur `staging`
  dans la même promotion que #271, ou avant — jamais après.
- **Administrateurs** : les textes affirment qu'à ce jour l'éditeur est le seul
  administrateur, donc le seul destinataire des certificats. Créer un autre compte
  administrateur impose d'abord de mettre à jour la section « destinataires » (§4)
  de la politique.

Les traitements décrits reflètent le code au moment de la rédaction ; à tenir à jour
à chaque évolution des données collectées ou des sous-traitants.
