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

|                                                        |                                                      |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Identité de l'éditeur, contact, durées de conservation | ✅ renseignés (5 octobre 2026)                       |
| Publication à des URL publiques                        | ✅ `deploy-landing.yml` — requis par Apple et Google |
| Lien depuis l'application                              | ✅ Réglages + gate CGU à la première ouverture       |
| **Relecture par un·e juriste**                         | ❌ **jamais faite**                                  |

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

Les traitements décrits reflètent le code au moment de la rédaction ; à tenir à jour
à chaque évolution des données collectées ou des sous-traitants.
