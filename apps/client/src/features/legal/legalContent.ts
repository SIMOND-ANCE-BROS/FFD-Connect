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
    updatedAt: "6 juillet 2026",
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
        heading: "5. Mineurs",
        body: "L'application est réservée aux personnes majeures. Le traitement des données d'un mineur, en particulier ses données de santé, requiert le consentement d'un titulaire de l'autorité parentale ; tant que ce dispositif n'est pas en place, aucun compte de mineur n'est accepté.",
      },
      {
        heading: "6. Disponibilité et responsabilité",
        body: "Le service est fourni « en l'état », en version bêta. L'éditeur ne garantit pas une disponibilité continue et ne saurait être tenu responsable des dommages indirects liés à l'utilisation de l'application.",
      },
      {
        heading: "7. Résiliation",
        body: "Vous pouvez supprimer votre compte à tout moment depuis Réglages → Confidentialité et données. L'éditeur peut suspendre un compte en cas de violation des présentes conditions.",
      },
      {
        heading: "8. Droit applicable",
        body: "Les présentes conditions sont soumises au droit français. Tout litige relève des juridictions françaises compétentes.",
      },
    ],
  },

  privacy: {
    title: "Politique de confidentialité",
    updatedAt: "6 juillet 2026",
    sections: [
      {
        heading: "Responsable de traitement",
        body: "Gabin Simond, éditeur de l'application. Contact pour toute question relative aux données personnelles : privacy@gabin-simond.fr\nL'éditeur n'est pas tenu de désigner un délégué à la protection des données.",
      },
      {
        heading: "Données collectées",
        body: "• Identité : nom, prénom, date de naissance, email\n• Licence fédérale : numéro, catégorie, club, validité, niveau (passeport danse), classement\n• Compétitions : inscriptions, résultats, partenariats\n• Santé : certificat médical d'aptitude et informations extraites par OCR (données sensibles, article 9 du RGPD)\n• Techniques : jetons d'authentification (chiffrés), jeton de notification de l'appareil, signalements de bugs",
      },
      {
        heading: "Finalités et bases légales",
        body: "• Gestion des licences et compétitions — exécution du contrat / mission fédérale\n• Authentification et sécurité du compte — intérêt légitime\n• Notifications (rappels d'échéance, résultats) — consentement / intérêt légitime\nAucune donnée n'est vendue ni transmise à des tiers à des fins publicitaires.",
      },
      {
        heading: "Durées de conservation",
        body: "• Compte : jusqu'à suppression, et au plus tard 3 ans après la dernière connexion\n• Certificat médical : au plus tard 12 mois après la fin de sa validité\n• Jetons de session : 30 jours maximum\n• Jeton de notification de l'appareil : 90 jours sans réutilisation\n• Logs techniques : 12 mois\n• Sauvegardes de la base de données : 7 jours glissants",
      },
      {
        heading: "Vos droits (RGPD)",
        body: "Vous disposez des droits d'accès, de rectification, d'effacement, de portabilité et d'opposition.\n• Exporter mes données : Réglages → Confidentialité et données → Exporter (JSON complet)\n• Supprimer mon compte : Réglages → Confidentialité et données → Supprimer mon compte (irréversible ; la licence fédérale, propriété de la FFD, est simplement détachée)\nPour toute autre demande : privacy@gabin-simond.fr. Vous pouvez saisir la CNIL (cnil.fr) si vous estimez vos droits non respectés.",
      },
      {
        heading: "Sécurité",
        body: "Mots de passe hachés (bcrypt), jetons stockés hachés côté serveur et dans l'enclave sécurisée du téléphone (Keychain/Keystore) côté client, chiffrement TLS en transit, secrets gérés via Azure Key Vault.",
      },
      {
        heading: "Sous-traitants",
        body: "• Microsoft Azure — hébergement (Union européenne)\n• Expo (EAS) — distribution des mises à jour de l'application\n• Google Firebase — acheminement des notifications push\n• Sentry — télémétrie d'erreurs (données techniques uniquement)\n• HelloAsso — paiements des inscriptions\n• Resend — envoi des e-mails transactionnels",
      },
    ],
  },
};
