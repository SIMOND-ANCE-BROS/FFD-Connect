# Politique de confidentialité

_Dernière mise à jour : 5 octobre 2026_

> **Projet indépendant.** FFD Connect n'est pas une application officielle de la
> Fédération Française de Danse. La fédération n'en est ni l'éditrice, ni
> l'hébergeuse, ni la responsable de traitement.

La présente politique décrit comment l'application **FFD-Connect** collecte et traite les données personnelles de ses utilisateurs, conformément au Règlement Général sur la Protection des Données (RGPD, UE 2016/679) et à la loi « Informatique et Libertés ».

## 1. Responsable de traitement

Le responsable de traitement est **Gabin Simond**, éditeur de l'application (voir
[mentions légales](./mentions-legales.md)).

L'éditeur n'est pas tenu de désigner un délégué à la protection des données.

**Contact pour toute question relative aux données personnelles** : privacy@gabin-simond.fr.

## 2. Données que nous collectons

| Catégorie               | Exemples                                                                                             | Origine                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Identité & compte**   | nom, prénom, adresse e-mail, mot de passe (haché), rôle (danseur, club, admin)                       | fournies par l'utilisateur        |
| **Données de licence**  | numéro de licence, club, discipline, catégorie                                                       | saisies / extraites du certificat |
| **Données de santé** ⚠️ | certificat médical de non contre-indication, date d'aptitude, informations extraites par OCR         | fournies par l'utilisateur        |
| **Compétitions**        | inscriptions, résultats, palmarès                                                                    | usage de l'app                    |
| **Paiement**            | transactions d'inscription (traitées par HelloAsso — nous ne stockons **pas** les données bancaires) | via HelloAsso                     |
| **Contenu**             | musiques ajoutées à la bibliothèque, partenaires recherchés                                          | usage de l'app                    |
| **Techniques**          | logs d'erreur, adresse IP                                                                            | automatique                       |
| **Appareils**           | jeton de notification push (identifiant d'appareil FCM), plateforme (iOS / Android), dates d'usage   | automatique (à la connexion)      |

Les **données de santé** sont des données sensibles au sens de l'article 9 du RGPD et font l'objet de mesures de protection renforcées (voir §7).

## 3. Finalités et bases légales

| Finalité                                                  | Base légale                                            |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Créer et gérer le compte utilisateur                      | Exécution du contrat (CGU)                             |
| Gérer les licences et vérifier l'aptitude médicale        | Obligation légale / intérêt légitime de la fédération  |
| Inscrire aux compétitions et encaisser les paiements      | Exécution du contrat                                   |
| Traiter le certificat médical (OCR)                       | **Consentement explicite** de la personne (art. 9-2-a) |
| Envoyer des notifications (rappels d'échéance, résultats) | Consentement / intérêt légitime                        |
| Assurer la sécurité et corriger les bugs                  | Intérêt légitime                                       |

## 4. Sous-traitants et destinataires

Nous faisons appel aux prestataires suivants, qui agissent comme sous-traitants et n'utilisent les données que pour la fourniture de leur service :

| Sous-traitant                           | Rôle                                                | Localisation                       |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| **Microsoft Azure**                     | hébergement, base de données, stockage des fichiers | UE (Irlande)                       |
| **HelloAsso**                           | paiement des inscriptions                           | UE (France)                        |
| **Sentry**                              | suivi des erreurs applicatives                      | UE (instance allemande, Francfort) |
| **Google Firebase**                     | notifications push                                  | Google Ireland / hors UE (voir §6) |
| **Microsoft Azure AI** (Vision, Speech) | OCR du certificat, synthèse vocale                  | UE (Irlande)                       |
| **Resend**                              | envoi d'e-mails transactionnels                     | États-Unis (voir §6)               |

Les administrateurs de la plateforme peuvent consulter et corriger les informations de profil (club, catégorie, classe d'âge, niveaux) ; chaque modification est tracée (auteur, date, valeurs avant/après) et, à la suppression du compte, ces traces sont conservées mais dépouillées de toute donnée personnelle (seuls l'action, la date et un identifiant technique subsistent).

Aucune donnée n'est vendue à des tiers.

## 5. Durées de conservation

- **Compte & licence** : pendant la durée d'activité du compte, puis **3 ans** après la dernière connexion, à l'issue desquels le compte est supprimé.
- **Données de santé (certificat médical)** : conservées le temps nécessaire à la vérification de l'aptitude, puis supprimées **au plus tard 12 mois après la fin de validité** du certificat.
- **Données de paiement** : conservées par HelloAsso selon ses propres obligations comptables.
- **Jetons de notification push (identifiants d'appareil)** : **90 jours** sans réutilisation de l'appareil. L'application réenregistre le jeton à chaque ouverture de session : passé ce délai sans signe de vie, l'appareil est considéré comme abandonné (application désinstallée, appareil remplacé) et la ligne est supprimée automatiquement. Le jeton est également supprimé immédiatement à la déconnexion, à la suppression du compte, et dès que Firebase le déclare invalide.
- **Jetons de session** : 30 jours maximum.
- **Logs techniques** : **12 mois**.
- **Sauvegardes de la base de données** : **7 jours** glissants. Une donnée supprimée peut y subsister jusqu'à 7 jours ; les sauvegardes ne servent qu'à la restauration du service après incident. Les fichiers envoyés (certificats) ne sont pas sauvegardés.

## 6. Transferts hors Union européenne

L'hébergement, la base de données, l'OCR et la synthèse vocale sont opérés dans
l'Union européenne (Azure, Irlande), et le suivi d'erreurs sur l'instance européenne
de Sentry.

Deux traitements impliquent un transfert hors UE :

- **Resend** (États-Unis) — envoi des e-mails transactionnels : adresse e-mail et
  contenu du message.
- **Google Firebase** — acheminement des notifications push : jeton d'appareil et
  contenu de la notification.

Ces transferts sont encadrés par les **clauses contractuelles types** de la Commission
européenne et, le cas échéant, par le cadre de protection des données
UE–États-Unis (Data Privacy Framework).

## 7. Sécurité — mesures spécifiques aux données de santé

- Chiffrement en transit (HTTPS/TLS) et **au repos** (chiffrement du stockage et de la base de données Azure).
- **Chiffrement applicatif renforcé des données de santé** (objectif AES-256) — voir la feuille de route sécurité (issue #418).
- Accès restreint selon le rôle ; tokens d'authentification hachés (SHA-256) en base.
- Consentement explicite recueilli avant tout traitement d'un certificat médical.

## 8. Mineurs

L'application est **réservée aux personnes majeures** (article 3 des [CGU](./cgu.md)).

Le traitement des données d'un mineur, et en particulier de ses données de santé,
requiert le consentement d'un titulaire de l'autorité parentale. Tant que le
dispositif de recueil de ce consentement n'est pas en place, aucun compte de mineur
n'est accepté. Cette restriction sera levée lorsque ce dispositif sera mis en œuvre.

## 9. Vos droits

Conformément au RGPD, vous disposez des droits d'**accès**, de **rectification**, d'**effacement**, de **limitation**, d'**opposition** et de **portabilité** de vos données, ainsi que du droit de retirer votre consentement à tout moment.

Pour exercer ces droits : privacy@gabin-simond.fr. Une réponse vous sera apportée sous un mois.

L'application permet d'exercer directement l'accès/portabilité (export de vos données) et l'effacement (suppression du compte). L'export liste vos appareils enregistrés pour les notifications sous forme de métadonnées (plateforme, dates) : la valeur du jeton lui-même n'y figure pas, car sa divulgation permettrait de détourner la livraison de vos notifications vers un autre compte.

Vous pouvez également introduire une réclamation auprès de la **CNIL** (www.cnil.fr).

## 10. Cookies / traceurs

L'application mobile n'utilise pas de cookies publicitaires. Les identifiants
techniques (session, appareil pour les notifications) sont strictement nécessaires au
fonctionnement.

Le site vitrine ne dépose aucun cookie et n'utilise aucune mesure d'audience.

## 11. Modifications

Cette politique peut être mise à jour. La date de dernière mise à jour figure en tête de document ; les changements substantiels seront notifiés dans l'application.
