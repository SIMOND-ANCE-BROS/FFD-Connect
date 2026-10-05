# Documents légaux — FFD-Connect

Documents légaux/RGPD requis pour la publication de l'application (stores) et la
conformité (issue #424).

**Ce sont les textes de référence.** Ils sont publiés tels quels sur le site vitrine
(`/confidentialite/`, `/cgu/`, `/mentions-legales/`, rendus au build par
`apps/landing/legal-plugin.ts`) et résumés dans l'application
(`apps/client/src/features/legal/legalContent.ts`). Toute évolution des données
collectées ou des sous-traitants doit être répercutée aux deux endroits.

| Document                           | Fichier                                                        | Rôle                                              |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Mentions légales                   | [mentions-legales.md](./mentions-legales.md)                   | éditeur, hébergeur, propriété intellectuelle      |
| Conditions Générales d'Utilisation | [cgu.md](./cgu.md)                                             | règles d'usage, comptes, responsabilités          |
| Politique de confidentialité       | [politique-confidentialite.md](./politique-confidentialite.md) | RGPD : données, finalités, sous-traitants, droits |

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

Les traitements décrits reflètent le code au moment de la rédaction ; à tenir à jour
à chaque évolution des données collectées ou des sous-traitants.
