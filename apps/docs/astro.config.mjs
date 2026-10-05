import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.FRONTEND_DOMAIN
    ? `https://${process.env.FRONTEND_DOMAIN}`
    : "https://docs.ffd-connect.local",
  base: "/docs",
  integrations: [
    starlight({
      title: "FFD-Connect Documentation",
      defaultLocale: "root",
      customCss: ["./src/styles/custom.css"],
      locales: {
        root: {
          label: "Français",
          lang: "fr",
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/GabinSMD/FFD-Connect",
        },
      ],
      components: {
        Header: "./src/components/Header.astro",
        Head: "./src/components/CustomHead.astro",
        PageFrame: "./src/components/PageFrame.astro",
      },
      sidebar: [
        {
          label: "🚀 Démarrage",
          items: [{ label: "Introduction", link: "/guide/introduction/" }],
        },
        {
          label: "📋 Licence",
          items: [
            { label: "Vue d'ensemble", link: "/licence/" },
            { label: "Consulter ma licence", link: "/licence/statut/" },
            {
              label: "Ajouter une licence WDSF",
              link: "/licence/ajouter-wdsf/",
            },
            { label: "Renouveler ma licence", link: "/licence/renouveler/" },
          ],
        },
        {
          label: "🏆 Compétitions",
          items: [
            { label: "Vue d'ensemble", link: "/competitions/" },
            {
              label: "Parcourir les compétitions",
              link: "/competitions/parcourir/",
            },
            {
              label: "Voir les participants",
              link: "/competitions/participants/",
            },
            {
              label: "Consulter les résultats",
              link: "/competitions/resultats/",
            },
            { label: "Résultats en direct", link: "/competitions/live/" },
          ],
        },
        {
          label: "🏠 Club",
          collapsed: true,
          items: [
            { label: "Vue d'ensemble", link: "/club/" },
            { label: "Tableau de bord", link: "/club/dashboard/" },
            { label: "Gérer les membres", link: "/club/membres/" },
            {
              label: "Créer une compétition",
              link: "/club/creer-competition/",
            },
            { label: "Suivi des inscriptions", link: "/club/inscriptions/" },
          ],
        },
        {
          label: "🎵 Bibliothèque musicale",
          collapsed: true,
          items: [
            { label: "Vue d'ensemble", link: "/musique/" },
            { label: "Ajouter une musique", link: "/musique/ajouter/" },
            { label: "Scanner mes fichiers", link: "/musique/scanner/" },
            { label: "Mode Passage en compétition", link: "/musique/passage/" },
          ],
        },
        {
          label: "⚙️ Mon compte",
          collapsed: true,
          items: [
            { label: "Modifier mon profil", link: "/compte/profil/" },
            { label: "Notifications", link: "/compte/notifications/" },
            { label: "Connexion & sécurité", link: "/compte/securite/" },
          ],
        },
        {
          label: "📖 Référence API",
          link: "/api-docs/",
        },
        {
          label: "📝 Changelog",
          link: "/changelog/",
        },
      ],
    }),
    react(),
  ],
});
