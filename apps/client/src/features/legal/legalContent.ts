/**
 * Textes légaux de l'application (#424).
 *
 * Version courte, affichée dans l'app par LegalScreen. La version de référence
 * vit dans docs/legal/ et est publiée sur le site ; les deux doivent rester
 * cohérentes — toute évolution des données collectées ou des sous-traitants se
 * répercute ici ET là-bas.
 *
 * ⚠️ Non relus par un juriste à ce jour. Ils décrivent les traitements
 * réellement implémentés, ce qui est le minimum, pas une validation juridique.
 */

export type LegalDoc = "cgu" | "privacy" | "mentions";

export interface LegalSection {
  heading?: string;
  body: string;
}

export interface LegalDocument {
  title: string;
  updatedAt: string;
  sections: LegalSection[];
}

export const LEGAL_DOCUMENTS: Record<LegalDoc, LegalDocument> = {
  mentions: {
    title: "Mentions légales",
    updatedAt: "6 juillet 2026",
    sections: [
      {
        heading: "Éditeur de l'application",
        body: "FFD Connect est éditée par Gabin Simond, personne physique agissant à titre non professionnel.\nContact : contact@gabin-simond.fr\n\nFFD Connect n'est pas une application officielle de la Fédération Française de Danse : la fédération n'en est ni l'éditrice, ni l'hébergeuse, ni la responsable de traitement, et ne l'a pas endossée.",
      },
      {
        heading: "Directeur de la publication",
        body: "Gabin Simond.",
      },
      {
        heading: "Hébergement",
        body: "Les services backend et les données sont hébergés par Microsoft Azure (Microsoft Ireland Operations Ltd, One Microsoft Place, South County Business Park, Leopardstown, Dublin 18, Irlande), dans des centres de données situés dans l'Union européenne.",
      },
      {
        heading: "Propriété intellectuelle",
        body: "L'application, sa charte graphique et ses contenus sont protégés par le droit de la propriété intellectuelle. Toute reproduction non autorisée est interdite. Les marques et logos de la Fédération Française de Danse appartiennent à leurs titulaires respectifs.",
      },
    ],
  },

  cgu: {
    title: "Conditions générales d'utilisation",
    updatedAt: "15 octobre 2026",
    sections: [
      {
        heading: "1. Objet",
        body: "Les présentes conditions encadrent l'utilisation de l'application FFD Connect, projet indépendant non affilié à la Fédération Française de Danse, qui permet aux licenciés, clubs et officiels de gérer licences, inscriptions aux compétitions, musiques d'entraînement et résultats.",
      },
      {
        heading: "2. Compte et licence",
        body: "L'inscription requiert une licence fédérale valide. Vous êtes responsable de la confidentialité de vos identifiants. Un compte est strictement personnel ; les comptes club sont réservés aux représentants habilités.",
      },
      {
        heading: "3. Usage acceptable",
        body: "Vous vous engagez à ne pas détourner l'application de son usage sportif : pas d'usurpation d'identité, pas de tentative d'accès non autorisé, pas d'import de contenus dont vous ne détenez pas les droits (notamment des enregistrements musicaux protégés).",
      },
      {
        heading: "4. Inscriptions et paiements",
        body: "Les inscriptions aux compétitions sont soumises au règlement sportif de la fédération. Les paiements éventuels sont opérés par HelloAsso, selon ses propres conditions.",
      },
      {
        heading: "5. Certificat médical",
        body: "Le certificat médical déposé pour renouveler une licence est vérifié par une personne : l'éditeur, en tant qu'administrateur de la plateforme. La lecture automatique du document ne fournit que des indices et ne décide pas du renouvellement. Le dépôt vaut consentement explicite à ce traitement, y compris à la consultation du certificat par l'éditeur ; pour un mineur, ce consentement est donné par son représentant légal (§6). En cas de refus, le motif et, le cas échéant, un commentaire vous sont communiqués dans l'application.",
      },
      {
        heading: "6. Mineurs",
        body: "Un mineur peut créer un compte avec l'accord d'un titulaire de l'autorité parentale (« représentant légal »). Il indique son adresse e-mail, à l'inscription ou depuis son profil ; le représentant légal reçoit un lien pour donner son accord. Tant que cet accord n'est pas donné, le compte est limité : aucun certificat médical ne peut être déposé. En donnant son accord, le représentant légal accepte les présentes conditions pour le mineur et consent explicitement au traitement de son certificat médical. Il peut retirer son accord à tout moment avec le même lien : le compte redevient limité et les certificats médicaux du mineur sont supprimés. La qualité de mineur est déduite de la date de naissance encodée dans le numéro de licence ; un majeur n'est jamais concerné.",
      },
      {
        heading: "7. Disponibilité et responsabilité",
        body: "Le service est fourni « en l'état », en version bêta. L'éditeur ne garantit pas une disponibilité continue et ne saurait être tenu responsable des dommages indirects liés à l'utilisation de l'application.",
      },
      {
        heading: "8. Résiliation",
        body: "Vous pouvez supprimer votre compte à tout moment depuis Réglages → Confidentialité et données. L'éditeur peut suspendre un compte en cas de violation des présentes conditions.",
      },
      {
        heading: "9. Droit applicable",
        body: "Les présentes conditions sont soumises au droit français. Tout litige relève des juridictions françaises compétentes.",
      },
    ],
  },

  privacy: {
    title: "Politique de confidentialité",
    updatedAt: "17 octobre 2026",
    sections: [
      {
        heading: "Responsable de traitement",
        body: "Gabin Simond, éditeur de l'application. Contact pour toute question relative aux données personnelles : privacy@gabin-simond.fr\nL'éditeur n'est pas tenu de désigner un délégué à la protection des données.",
      },
      {
        heading: "Données collectées",
        body: "• Identité : nom, prénom, date de naissance, email\n• Licence fédérale : numéro, catégorie, club, validité, niveau (passeport danse), classement\n• Compétitions : inscriptions, résultats, partenariats\n• Santé : certificat médical d'aptitude, informations extraites par OCR, motif d'un refus et commentaire de l'administrateur (données sensibles, article 9 du RGPD)\n• Accord parental (mineurs) : statut de la demande, dates, version des CGU acceptée, adresse e-mail du représentant légal masquée et son empreinte (l'adresse elle-même n'est pas conservée)\n• Techniques : jetons d'authentification (chiffrés), jeton de notification de l'appareil, signalements de bugs\n• Usage anonyme : écrans consultés et durée, principaux événements, plateforme, version de l'application, espace actif et, pour une consultation de compétition, l'identifiant de la compétition — rattachés à un identifiant d'installation aléatoire renouvelé chaque mois, jamais à votre compte\n• Pass Wallet (si vous ajoutez votre licence au Wallet) : nom, prénom, numéro et type de licence, date de fin de validité, QR code signé",
      },
      {
        heading: "Finalités et bases légales",
        body: "• Gestion des licences et compétitions — exécution du contrat / mission fédérale\n• Vérification du certificat médical (lecture automatique et vérification par l'éditeur) — consentement explicite (article 9-2-a du RGPD)\n• Accord du représentant légal d'un mineur et preuve de cet accord — obligation légale (articles 7 et 8 du RGPD)\n• Authentification et sécurité du compte — intérêt légitime\n• Notifications (rappels d'échéance, résultats) — consentement / intérêt légitime\n• Mesure d'audience anonyme de l'application — intérêt légitime (exemptée de consentement), désactivable dans Réglages → Confidentialité et données → Mesure d'audience anonyme\n• Ajout de la licence à Apple Wallet ou Google Wallet — exécution du contrat, à la demande\n• Assistance (accès « se connecter en tant que ») — intérêt légitime, base à valider\nAucune donnée n'est vendue ni transmise à des tiers à des fins publicitaires.",
      },
      {
        heading: "Vérification du certificat médical",
        body: "Votre certificat médical est vérifié par une personne : l'éditeur, en tant qu'administrateur de la plateforme (à ce jour le seul). Tant que votre demande est en attente, il peut ouvrir le fichier et voir les informations lues automatiquement, qui ne sont que des indices. Chaque ouverture est tracée, sans le contenu du document, comme chaque consultation de votre demande lors d'un accès support, chaque export de vos données et chaque suppression d'un certificat (par vous, par un administrateur ou par la purge automatique) : qui, en quelle qualité, quoi, quand et par quel point d'entrée. Une fois la demande traitée, le fichier n'est plus consultable. En cas de refus, vous voyez dans l'application le motif et, le cas échéant, un commentaire de l'administrateur.",
      },
      {
        heading: "Mineurs : accord parental",
        body: "Tout utilisateur de moins de 18 ans (d'après la date de naissance encodée dans son numéro de licence) a besoin de l'accord d'un représentant légal. Il indique son adresse e-mail ; un lien valable 7 jours lui est envoyé (par Resend). Sur la page du lien, le représentant légal donne deux accords distincts : le traitement des données du mineur, et le traitement explicite de son certificat médical. L'accord est horodaté et rattaché à la version des CGU.\nTant que l'accord n'est pas donné, ou après son retrait, aucun certificat médical ne peut être déposé ni soumis. Le représentant légal peut retirer son accord à tout moment avec le même lien : une demande de renouvellement en attente revient en brouillon, les informations lues sur les certificats sont effacées immédiatement et les fichiers supprimés au plus tard dans l'heure.\nL'adresse du représentant légal n'est pas conservée en clair (seules une forme masquée et une empreinte le sont) ; la page du lien ne lui montre que le prénom du mineur. Si le numéro de licence ne permet pas de connaître l'âge, le compte n'est pas soumis à ce dispositif à ce jour (point en cours d'arbitrage).",
      },
      {
        heading: "Pass Apple Wallet et Google Wallet",
        body: "L'ajout de votre licence à Apple Wallet ou Google Wallet est facultatif et n'a lieu que sur votre demande. Le pass contient vos nom et prénom, votre numéro et type de licence, sa date de fin de validité et un QR code signé par FFD Connect. Aucune donnée de santé n'y figure.\nApple Wallet le conserve sur votre appareil (Apple peut le synchroniser entre vos appareils selon vos réglages). Pour Google Wallet, FFD Connect transmet ces données à Google, qui les enregistre et les associe à votre compte Google.\nLe pass est une copie de vos informations au moment de l'ajout. La suppression de votre compte FFD Connect ne le retire pas de votre téléphone : supprimez-le depuis l'application Wallet.",
      },
      {
        heading: "Contrôle d'entrée aux compétitions (QR d'entrée)",
        body: "Le QR d'entrée de votre E-Licence change toutes les 30 secondes. Il contient votre numéro de licence, l'identifiant interne de la licence et vos nom et prénom, signés par le serveur FFD Connect : un organisateur ou un bénévole peut le vérifier même sans réseau et voir à qui il appartient. Pour qu'il fonctionne sans réseau, votre téléphone garde les QR des 12 prochaines heures ; ils sont effacés à la déconnexion.\nUn scan fait sans réseau reste sur le téléphone du scanner (avec, pour un bénévole, son lien d'accès) jusqu'au retour du réseau, 12 heures au plus, puis est envoyé au serveur avec l'heure du scan. Le check-in enregistre l'heure de réception par le serveur et, pour un scan hors ligne, l'heure de scan déclarée ; ces informations suivent la durée de conservation de votre inscription.",
      },
      {
        heading: "Accès support",
        body: "Pour répondre à une demande d'assistance, un administrateur ou un membre du staff peut ouvrir l'application telle que vous la voyez (« se connecter en tant que »). Cet accès est encadré : un administrateur ne peut jamais être ciblé, un membre du staff ne peut cibler qu'un licencié ou un club et doit indiquer un motif (facultatif pour l'administrateur). Un compte désactivé ne peut pas être ciblé. La session dure 15 minutes, sans renouvellement.\nPendant la session, l'intervenant ne peut pas exporter vos données, supprimer le compte, changer le mot de passe, obtenir un lot de QR d'entrée, demander un accord parental, ni importer ou supprimer des résultats de compétition. Il peut consulter vos demandes de renouvellement de licence ; chaque consultation est tracée.\nChaque accès est journalisé : date de début, motif, rôle de l'intervenant et, s'il met fin lui-même à la session, date de fin. Le motif est celui saisi par l'intervenant : la saisie doit éviter toute donnée personnelle de tiers. Ces informations figurent dans votre export, sans l'identité de l'intervenant. L'adresse IP de l'intervenant est conservée en base dans cette piste d'audit, mais n'est pas communiquée. Ces traces sont conservées comme piste d'audit, ne sont pas purgées automatiquement et subsistent après la suppression du compte ; leur durée de conservation n'est pas encore fixée.",
      },
      {
        heading: "Résultats de compétition",
        body: "Les classements affichés sont ceux que l'organisateur de la compétition publie, importés par un membre du staff, un administrateur ou le club organisateur : épreuve, tour, rang, nom du couple, dossard, club et, lorsqu'ils figurent au classement, les numéros de licence. Ils nomment aussi des danseurs sans compte FFD Connect.\n• Les numéros de licence servent uniquement à rattacher un résultat à votre compte (palmarès, notification) et ne sont pas conservés avec le résultat.\n• Base légale : intérêt légitime à présenter des résultats déjà rendus publics par l'organisateur ; aucune autre donnée n'est collectée sur les personnes sans compte.\n• Toute personne nommée, avec ou sans compte, peut s'opposer à l'affichage de son nom : privacy@gabin-simond.fr, en précisant la compétition. Le nom, le dossard et le club sont alors retirés dans le mois ; seuls l'épreuve, le tour et le rang restent, avec le nombre de participants, le statut et les marques de la ligne, et un import ultérieur ne les republie pas.\n• Après la suppression d'un compte, une empreinte de ses numéros de licence (calculée avec une clé secrète, qui ne permet pas de retrouver le numéro) est conservée pour qu'un classement importé plus tard ne republie pas son nom.",
      },
      {
        heading: "Durées de conservation",
        body: "• Compte : jusqu'à suppression, et au plus tard 3 ans après la dernière connexion\n• Certificat médical : au plus tard 12 mois après la fin de sa validité ; un certificat refusé, au plus tard 30 jours après la décision\n• Résultats de compétition : après la suppression du compte, conservés sans aucun lien avec votre compte ni votre nom, pour ne pas fausser le classement des autres couples (l'épreuve, le tour, le classement, le nombre de participants, le statut et les marques subsistent) ; les classements FFD étant publics à la source, il s'agit d'une pseudonymisation ; un résultat de couple rattaché au compte de votre partenaire reste le sien, votre nom y étant remplacé par « Partenaire supprimé »\n• Accord parental : conservé tant que le compte existe, supprimé avec lui ; un lien non confirmé cesse d'être valable 7 jours après son envoi\n• Jetons de session : 30 jours maximum\n• Jeton de notification de l'appareil : 90 jours sans réutilisation\n• Logs techniques : 12 mois\n• Journal des accès aux données de santé : 1 an, puis suppression automatique ; il ne contient que des identifiants techniques, la nature, la date et le point d'entrée de chaque accès, jamais le certificat ni ce qu'il contient, et subsiste après la suppression du compte jusqu'au terme de ce délai\n• Usage anonyme : 90 jours avec l'identifiant d'installation, puis statistiques agrégées sans identifiant pendant 25 mois\n• Sauvegardes de la base de données : 7 jours glissants\n• Journal des accès support : durée non encore fixée ; ses lignes ne sont pas purgées automatiquement",
      },
      {
        heading: "Vos droits (RGPD)",
        body: "Vous disposez des droits d'accès, de rectification, d'effacement, de portabilité et d'opposition.\n• Exporter mes données : Réglages → Confidentialité et données → Exporter mes données (fichier JSON)\nL'export contient : votre profil (nom, prénom, e-mail, date de naissance, club, rôles, catégorie, classe d'âge, niveaux, classement, licence WDSF, dernière connexion, date de désactivation éventuelle) ; votre licence ; vos demandes de renouvellement de licence (statut, dates, motif de refus et commentaire de l'administrateur sans son identité, et pour chaque document son type, sa date de dépôt et les seules informations lues) ; vos inscriptions (statut, dossard, présence, paiement, nom du partenaire tel que saisi, épreuve), y compris comme partenaire (statut, dossard et épreuve uniquement) ; vos partenariats ; vos résultats, y compris comme partenaire reconnu d'un couple (sans les noms des participants) ; vos réservations de places (avec le motif d'une libération) et vos équipes ; vos musiques proposées et propositions de correction (sans l'identité de l'administrateur) ; vos notifications et préférences ; vos signalements de bug ; vos appareils enregistrés (plateforme et dates) ; vos sessions de connexion (dates) ; les accès support à votre compte (date de début, motif, rôle de l'intervenant, date de fin lorsqu'elle est connue, sans son identité ni son adresse IP) ; l'historique de l'accord parental (statut, dates, version des CGU, adresse masquée du représentant légal).\nNe sont pas inclus : votre mot de passe, la valeur des jetons, les fichiers déposés, ni le journal d'audit des administrateurs (journal de traçabilité contenant des données de tiers, communicable sur demande écrite à privacy@gabin-simond.fr après occultation des données de tiers), ni à ce jour le journal des accès aux données de santé (les accès qui vous concernent sont communiqués sur demande écrite à la même adresse).\n• Supprimer mon compte : Réglages → Confidentialité et données → Supprimer mon compte (irréversible ; la licence fédérale, propriété de la FFD, est simplement détachée)\nPour toute autre demande : privacy@gabin-simond.fr. Vous pouvez saisir la CNIL (cnil.fr) si vous estimez vos droits non respectés.",
      },
      {
        heading: "Sécurité",
        body: "Mots de passe hachés (bcrypt), jetons stockés hachés côté serveur et dans l'enclave sécurisée du téléphone (Keychain/Keystore) côté client, chiffrement TLS en transit, secrets gérés via Azure Key Vault.",
      },
      {
        heading: "Sous-traitants",
        body: "• Microsoft Azure — hébergement (Union européenne)\n• Microsoft Azure AI — OCR du certificat et synthèse vocale (Union européenne)\n• Google Wallet — uniquement si vous ajoutez le pass à Google Wallet\n• Expo (EAS) — distribution des mises à jour de l'application\n• Google Firebase — acheminement des notifications push\n• Sentry — télémétrie d'erreurs (données techniques uniquement)\n• HelloAsso — paiements des inscriptions\n• Resend — envoi des e-mails transactionnels",
      },
    ],
  },
};
