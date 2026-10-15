# Politique de confidentialité

_Dernière mise à jour : 15 octobre 2026_

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

| Catégorie                     | Exemples                                                                                                                                                                                                                                                                                                           | Origine                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Identité & compte**         | nom, prénom, adresse e-mail, mot de passe (haché), rôle (danseur, club, admin)                                                                                                                                                                                                                                     | fournies par l'utilisateur                                 |
| **Données de licence**        | numéro de licence, club, discipline, catégorie                                                                                                                                                                                                                                                                     | saisies / extraites du certificat                          |
| **Données de santé** ⚠️       | certificat médical de non contre-indication, date d'aptitude, informations extraites par OCR, décision de la vérification (motif d'un refus, commentaire de l'administrateur)                                                                                                                                      | fournies par l'utilisateur                                 |
| **Accord parental** (mineurs) | statut de la demande, dates (envoi, accord, retrait), version des CGU acceptée, adresse e-mail du représentant légal **masquée** (« p\*\*\*@g\*\*\*.fr ») et son **empreinte** (hachage SHA-256) — l'adresse elle-même n'est pas conservée                                                                         | fournie par le mineur, confirmée par le représentant légal |
| **Compétitions**              | inscriptions, résultats, palmarès                                                                                                                                                                                                                                                                                  | usage de l'app                                             |
| **Paiement**                  | transactions d'inscription (traitées par HelloAsso — nous ne stockons **pas** les données bancaires)                                                                                                                                                                                                               | via HelloAsso                                              |
| **Contenu**                   | musiques ajoutées à la bibliothèque, partenaires recherchés                                                                                                                                                                                                                                                        | usage de l'app                                             |
| **Techniques**                | logs d'erreur, adresse IP (seul son réseau est conservé dans les logs)                                                                                                                                                                                                                                             | automatique                                                |
| **Appareils**                 | jeton de notification push (identifiant d'appareil FCM), plateforme (iOS / Android), dates d'usage                                                                                                                                                                                                                 | automatique (à la connexion)                               |
| **Pass Wallet**               | nom, prénom, numéro et type de licence, date de fin de validité, QR code signé (voir §4 bis)                                                                                                                                                                                                                       | à la demande de l'utilisateur                              |
| **Usage anonyme**             | écrans consultés et durée, événements (connexion, inscription, scan de licence, ajout au Wallet, consultation d'une compétition), date et heure à la minute, plateforme, version de l'application, espace actif — rattachés à un identifiant d'installation aléatoire renouvelé chaque mois, jamais à votre compte | automatique (application mobile, désactivable)             |

Les **données de santé** sont des données sensibles au sens de l'article 9 du RGPD et font l'objet de mesures de protection renforcées (voir §7).

## 3. Finalités et bases légales

| Finalité                                                                           | Base légale                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Créer et gérer le compte utilisateur                                               | Exécution du contrat (CGU)                                                                                   |
| Gérer les licences et vérifier l'aptitude médicale                                 | Obligation légale / intérêt légitime de la fédération                                                        |
| Inscrire aux compétitions et encaisser les paiements                               | Exécution du contrat                                                                                         |
| Vérifier le certificat médical (lecture automatique et vérification par l'éditeur) | **Consentement explicite** de la personne (art. 9-2-a)                                                       |
| Recueillir l'accord du représentant légal d'un mineur et en garder la preuve       | Obligation légale (preuve du consentement : art. 7 et 8 du RGPD, art. 45 de la loi Informatique et Libertés) |
| Envoyer des notifications (rappels d'échéance, résultats)                          | Consentement / intérêt légitime                                                                              |
| Ajouter sa licence à Apple Wallet ou Google Wallet                                 | Exécution du contrat, à la demande de l'utilisateur                                                          |
| Produire des statistiques agrégées pour l'administration de la plateforme          | Intérêt légitime de la fédération                                                                            |
| Assurer la sécurité et corriger les bugs                                           | Intérêt légitime                                                                                             |
| Mesurer l'audience de l'application de façon anonyme                               | Intérêt légitime (mesure d'audience exemptée de consentement, recommandations CNIL)                          |

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
| **Google Wallet**                       | émission du pass de licence Google Wallet           | Google Ireland / hors UE (voir §6) |

**Certificat médical.** Le certificat médical déposé avec une demande de renouvellement de licence est vérifié par une personne : l'éditeur, en tant qu'administrateur de la plateforme, en est destinataire. Seuls les administrateurs de la plateforme y ont accès ; à ce jour, l'éditeur est le seul administrateur. Tant que la demande est en attente, il peut ouvrir le fichier du certificat et voir les informations lues automatiquement sur le document (aptitude, date, médecin, numéro de licence). Ces informations ne sont que des indices : c'est l'éditeur qui décide, au vu du document. Chaque consultation de la demande et chaque ouverture du fichier sont tracées (auteur, date, document ouvert — jamais son contenu). Une fois la demande traitée, le fichier n'est plus consultable. En cas de refus, vous voyez dans l'application le motif du refus et, le cas échéant, un commentaire libre de l'administrateur.

Les administrateurs de la plateforme peuvent consulter et corriger les informations de profil (club, catégorie, classe d'âge, niveaux) ; chaque modification est tracée (auteur, date, valeurs avant/après) et, à la suppression du compte, ces traces sont conservées mais dépouillées de toute donnée personnelle (seuls l'action, la date et un identifiant technique subsistent). Les administrateurs peuvent également désactiver un compte (mesure réversible : le compte ne peut plus se connecter, ses données sont conservées) ou le supprimer définitivement (mêmes effets que la suppression demandée depuis l'application) ; ces actions sont elles aussi tracées, et les traces conservées après la suppression ne contiennent aucune donnée personnelle.

**Accès support.** Pour répondre à une demande d'assistance, un administrateur ou un membre du staff de la plateforme peut ouvrir l'application telle que la voit un utilisateur donné (« se connecter en tant que »). Cet accès est encadré : il n'est jamais possible de cibler un administrateur, un membre du staff ne peut cibler qu'un licencié ou un club, et il doit indiquer un motif (obligatoire pour le staff, facultatif pour l'administrateur). La session dure 15 minutes, sans possibilité de renouvellement, et certaines actions sensibles (export des données, suppression du compte, changement de mot de passe) sont bloquées pendant sa durée. **Chaque accès est journalisé** : date, motif, rôle de l'intervenant et date de fin. Ces informations figurent dans votre export (§9), sans l'identité de l'intervenant ni son adresse IP. Ces traces sont conservées comme piste d'audit ; elles ne sont pas purgées automatiquement et subsistent après la suppression du compte. Leur durée de conservation n'est pas encore fixée dans la section 5.

Aucune donnée n'est vendue à des tiers.

## 4 bis. Pass Apple Wallet et Google Wallet

L'application propose d'ajouter votre licence à l'application Wallet de votre
téléphone (Apple Wallet sur iOS, Google Wallet sur Android). Cet ajout est
**facultatif** et n'a lieu que si vous le demandez.

**Données figurant sur le pass** : vos nom et prénom, votre numéro et votre type de
licence, sa date de fin de validité, ainsi qu'un **QR code signé** par le serveur
FFD Connect, qui permet de vérifier que le QR n'a pas été falsifié. Aucune donnée de
santé (certificat médical) ne figure sur le pass.

**Qui stocke le pass** :

- **Apple Wallet** : le pass est généré par FFD Connect puis remis directement à
  votre appareil, où il est conservé par l'application Wallet d'Apple. Selon vos
  réglages, Apple peut le synchroniser entre vos appareils via votre compte Apple.
  Ce stockage relève de votre relation avec Apple et de ses propres conditions.
- **Google Wallet** : pour créer le pass, FFD Connect transmet les données
  ci-dessus à Google, qui l'enregistre sur ses serveurs, l'associe à votre compte
  Google et l'affiche sur votre appareil. Google intervient à ce titre comme
  prestataire de FFD Connect (voir §4 et §6).

**Le pass est une copie** : il reflète vos informations au moment de l'ajout. Si
votre licence change (renouvellement, nouvelle date de validité), ajoutez à nouveau
le pass depuis l'application.

**Retirer le pass** : vous pouvez le supprimer à tout moment depuis l'application
Wallet de votre téléphone. FFD Connect ne peut pas effacer un pass déjà présent sur
votre appareil : **la suppression de votre compte FFD Connect ne retire pas le
pass**, c'est à vous de le supprimer dans Wallet (voir
[suppression du compte](./suppression-compte.md)).

Le pass est un justificatif pratique généré par FFD Connect, projet indépendant :
ce n'est **pas** une carte ni un document officiel de la Fédération Française de
Danse.

## 5. Durées de conservation

- **Compte & licence** : pendant la durée d'activité du compte, puis **3 ans** après la dernière connexion, à l'issue desquels le compte est supprimé.
- **Données de santé (certificat médical)** : conservées le temps nécessaire à la vérification de l'aptitude, puis supprimées **au plus tard 12 mois après la fin de validité** du certificat. Un certificat **refusé** est supprimé **au plus tard 30 jours après la décision**, avec les informations lues sur le document et le commentaire de l'administrateur ; un motif de refus d'ordre médical (contre-indication) est alors remplacé par un motif neutre.
- **Résultats de compétition** : après la suppression du compte, ils sont conservés **sans aucun lien** avec votre compte ni avec votre nom, afin de ne pas fausser le classement des autres couples (seuls l'épreuve, le tour et le classement subsistent). Les classements de la FFD étant publics à la source, il s'agit d'une **pseudonymisation** et non d'une anonymisation complète. Si le résultat de votre couple est rattaché au compte de votre partenaire, il reste le sien : la partie du libellé qui vous nomme est remplacée par « Partenaire supprimé », lorsque l'épreuve permet de faire le lien avec votre compte.
- **Données de paiement** : conservées par HelloAsso selon ses propres obligations comptables.
- **Jetons de notification push (identifiants d'appareil)** : **90 jours** sans réutilisation de l'appareil. L'application réenregistre le jeton à chaque ouverture de session : passé ce délai sans signe de vie, l'appareil est considéré comme abandonné (application désinstallée, appareil remplacé) et la ligne est supprimée automatiquement. Le jeton est également supprimé immédiatement à la déconnexion, à la suppression du compte, et dès que Firebase le déclare invalide.
- **Accord parental (mineurs)** : la preuve de l'accord (statut, dates, version des CGU, adresse masquée et empreinte) est conservée tant que le compte existe, et supprimée avec lui. Une demande non confirmée cesse d'être valable **7 jours** après son envoi ; elle reste dans l'historique du compte (sans l'adresse en clair). Le lien envoyé au représentant légal n'est jamais stocké en clair (seule son empreinte l'est).
- **Jetons de session** : 30 jours maximum.
- **Logs techniques** : **12 mois**.
- **Journal des accès aux données de santé** : **1 an**, puis suppression automatique. Il ne contient que des identifiants techniques (personne concernée, auteur de l'accès), la nature de l'accès, sa date et son point d'entrée — jamais le certificat ni les informations qui y figurent. Il subsiste après la suppression du compte jusqu'au terme de ce délai, afin qu'un accès ne puisse pas être effacé en supprimant un compte.
- **Données d'usage anonymes** : **90 jours** avec l'identifiant d'installation, puis statistiques agrégées sans identifiant conservées **25 mois**.
- **Sauvegardes de la base de données** : **7 jours** glissants. Une donnée supprimée peut y subsister jusqu'à 7 jours ; les sauvegardes ne servent qu'à la restauration du service après incident. Les fichiers envoyés (certificats) ne sont pas sauvegardés.

## 6. Transferts hors Union européenne

L'hébergement, la base de données, l'OCR et la synthèse vocale sont opérés dans
l'Union européenne (Azure, Irlande), et le suivi d'erreurs sur l'instance européenne
de Sentry.

Trois traitements peuvent impliquer un transfert hors UE :

- **Resend** (États-Unis) — envoi des e-mails transactionnels : adresse e-mail et
  contenu du message.
- **Google Firebase** — acheminement des notifications push : jeton d'appareil et
  contenu de la notification.
- **Google Wallet** — émission du pass de licence, uniquement si vous l'ajoutez à
  Google Wallet : données figurant sur le pass (voir §4 bis).

Ces transferts sont encadrés par les **clauses contractuelles types** de la Commission
européenne et, le cas échéant, par le cadre de protection des données
UE–États-Unis (Data Privacy Framework).

## 7. Sécurité — mesures spécifiques aux données de santé

- Chiffrement en transit (HTTPS/TLS) et **au repos** (chiffrement du stockage et de la base de données Azure).
- **Chiffrement applicatif renforcé des données de santé** (objectif AES-256) — voir la feuille de route sécurité (issue #418).
- Accès restreint selon le rôle ; tokens d'authentification hachés (SHA-256) en base.
- Vérification du certificat : réservée aux administrateurs de la plateforme — à ce jour, l'éditeur seul —, uniquement tant que la demande est en attente ; chaque ouverture est tracée.
- **Journal des accès aux données de santé** : chaque consultation ou téléchargement d'un certificat par un administrateur, chaque consultation d'une demande de renouvellement lors d'un accès support (« se connecter en tant que »), chaque export de vos données et chaque suppression d'un certificat (par vous, par un administrateur ou par la purge automatique) est enregistré : qui, en quelle qualité, quoi, quand et par quel point d'entrée. Le journal ne recopie jamais le contenu du certificat ; il est conservé 1 an (§5).
- Consentement explicite recueilli avant tout traitement d'un certificat médical.

## 8. Mineurs

Le traitement des données d'un mineur, et en particulier de ses données de santé,
requiert le consentement d'un titulaire de l'autorité parentale (article 3 des
[CGU](./cgu.md)). Il est recueilli par **double confirmation par e-mail** :

1. **Qui est concerné** — tout utilisateur de **moins de 18 ans**, d'après la date
   de naissance encodée dans son numéro de licence fédérale. Un majeur n'est jamais
   concerné.
2. **Demande** — le mineur indique l'adresse e-mail d'un représentant légal, à
   l'inscription ou depuis son profil. Un lien personnel, valable **7 jours** pour
   confirmer, est envoyé à cette adresse (par Resend, voir §4 et §6). Le mineur peut
   renvoyer une demande : le lien précédent cesse alors de fonctionner.
3. **Accord** — sur la page du lien, le représentant légal donne deux accords
   distincts : le traitement des données du mineur conformément aux CGU, et le
   traitement **explicite** de son certificat médical (article 9 du RGPD). L'accord
   est horodaté et rattaché à la version des CGU en vigueur.
4. **Compte limité** — tant que l'accord n'est pas donné (ou après son retrait),
   aucun certificat médical ne peut être déposé ni soumis.
5. **Retrait** — le même lien permet de retirer l'accord **à tout moment**. Le
   retrait a un effet immédiat : le compte redevient limité, une demande de
   renouvellement en attente revient en brouillon, et les informations lues sur
   les certificats médicaux du mineur sont effacées sur-le-champ ; les fichiers
   sont supprimés par la purge de rétention, au plus tard dans l'heure qui suit.

**Minimisation.** L'adresse e-mail du représentant légal sert à envoyer le lien et
n'est pas conservée en clair : seules une forme masquée (montrée au mineur) et une
empreinte (permettant de vérifier, si elle est présentée plus tard, qu'il s'agit
bien de cette adresse) sont gardées. La page du lien ne montre au représentant
légal que le prénom du mineur.

**Âge inconnu.** Lorsque le numéro de licence ne permet pas de déduire la date de
naissance, le compte n'est pas soumis à ce dispositif à ce jour ; ce point est en
cours d'arbitrage.

## 9. Vos droits

Conformément au RGPD, vous disposez des droits d'**accès**, de **rectification**, d'**effacement**, de **limitation**, d'**opposition** et de **portabilité** de vos données, ainsi que du droit de retirer votre consentement à tout moment.

Pour exercer ces droits : privacy@gabin-simond.fr. Une réponse vous sera apportée sous un mois.

L'application permet d'exercer directement l'accès et la portabilité (export de vos données, dans Réglages → Confidentialité et données → Exporter mes données) ainsi que l'effacement (suppression du compte). L'export, au format JSON, contient :

- **votre profil** : identité, date de naissance, club, rôle, catégorie, classe d'âge, niveaux, classement national, licence WDSF le cas échéant, date de dernière connexion et, le cas échéant, la date de désactivation de votre compte par un administrateur ;
- **votre licence** : numéro, catégorie, club, date de validité ;
- **vos demandes de renouvellement de licence** : statut, dates (création, soumission, décision), motif d'un refus et commentaire de l'administrateur — jamais son identité — et, pour chaque document déposé, son type, sa date de dépôt et les seules informations lues sur le document (aptitude, date et médecin pour le certificat médical ; numéro et échéance pour l'attestation de licence). Le fichier lui-même n'y est pas joint ;
- **vos inscriptions aux compétitions**, y compris lorsque vous êtes le partenaire d'un couple inscrit par un autre licencié : pour ce second cas, seul le contexte de l'épreuve figure (spécialité, classe d'âge, niveau, compétition), sans les données du licencié qui a inscrit le couple ;
- **vos partenariats** (dates de début et de fin, statut), sans les données de votre partenaire ;
- **vos résultats** de compétition (classement, tour, contexte de l'épreuve, nombre de participants), sans le nom du couple ni les noms des autres participants ;
- **vos réservations de places** sur les plans de compétition (emplacement, statut, date, compétition) et vos **équipes** (nom, niveau, date d'adhésion) ;
- **vos musiques proposées** et vos **propositions de correction** de musiques : le contenu soumis et la décision, sans l'identité de l'administrateur qui a relu la proposition ; le nom d'une musique modérée reste masqué ;
- **vos notifications** reçues (titre, contenu, lu ou non, date) et vos **préférences** de notification ;
- **vos signalements de bug** envoyés depuis l'application (message, appareil, date), sans la trace technique de l'erreur ;
- **vos appareils** enregistrés pour les notifications : plateforme et dates. La valeur du jeton lui-même n'y figure pas, car sa divulgation permettrait de détourner la livraison de vos notifications vers un autre compte ;
- **vos sessions de connexion** : dates de création, d'expiration et de révocation, sans le jeton ;
- **les accès support à votre compte** (voir §4) : date, motif, rôle de l'intervenant et date de fin, sans son identité ;
- **l'historique de l'accord parental** (comptes de mineurs, voir §8) : statut de chaque demande, dates, version des CGU et adresse du représentant légal sous forme masquée — ni le lien, ni l'empreinte de l'adresse.

**Ce qui n'est pas inclus.** L'export ne contient ni votre mot de passe, ni la valeur d'aucun jeton, ni les fichiers déposés. Le **journal d'audit des administrateurs**, qui recense les actions effectuées par les administrateurs sur la plateforme, est exclu de l'export : c'est un journal de traçabilité, dont les lignes contiennent des données de tiers. Il peut toutefois être communiqué sur demande écrite à privacy@gabin-simond.fr, après occultation des données de tiers.

Vous pouvez également introduire une réclamation auprès de la **CNIL** (www.cnil.fr).

## 10. Cookies / traceurs

L'application mobile n'utilise pas de cookies publicitaires. Les identifiants
techniques (session, appareil pour les notifications) sont strictement nécessaires au
fonctionnement.

L'application mesure aussi son audience de façon anonyme, sans outil tiers : un
identifiant d'installation aléatoire, renouvelé chaque mois et sans lien avec votre
compte. Vous pouvez la désactiver à tout moment dans Réglages → Confidentialité et
données → Mesure d'audience anonyme.

Le site vitrine ne dépose aucun cookie et n'utilise aucune mesure d'audience.

## 11. Modifications

Cette politique peut être mise à jour. La date de dernière mise à jour figure en tête de document ; les changements substantiels seront notifiés dans l'application.
