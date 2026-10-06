import { motion, useReducedMotion } from 'framer-motion';
import { RoadmapSection } from './RoadmapSection';

const ease = [0.22, 1, 0.36, 1] as const;

const MARQUEE_ITEMS = [
  'Temps réel',
  'Licence',
  'Audio',
  'Organisation',
  'FFD',
  'Compétition',
  'API',
  'Clubs',
];

const FEATURES = [
  {
    n: '01',
    title: 'Compétitions en direct',
    body: 'Listes, passages, résultats — le fil de la compétition dans votre main.',
    tags: ['Classements', 'Alertes piste', 'Historique'],
  },
  {
    n: '02',
    title: 'Bibliothèque audio',
    body: 'Vos morceaux, votre tempo, votre rythme — même hors ligne.',
    tags: ['Import', 'Pitch / tempo', 'Offline'],
  },
  {
    n: '03',
    title: 'Licence numérique',
    body: 'QR dynamique, contrôle instantané, file qui avance.',
    tags: ['QR sécurisé', 'Check-in', 'Validation'],
  },
  {
    n: '04',
    title: 'Outils organisateur',
    body: 'Scan rapide, présences visibles, synchro avec les systèmes fédéraux.',
    tags: ['Scan', 'Stats', 'Cloud FFD'],
  },
] as const;

export default function App() {
  const appUrl = import.meta.env.VITE_APP_URL || '/';
  const docsUrl = import.meta.env.VITE_DOCS_URL || '/docs';

  return (
    <div className="site">
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>

      <SiteHeader appUrl={appUrl} docsUrl={docsUrl} />
      <Hero appUrl={appUrl} />
      <MarqueeStrip />
      <Manifesto />
      <Features />
      <PlatformBlock />
      <RoadmapSection />
      <CtaBand appUrl={appUrl} />
      <SiteFooter appUrl={appUrl} docsUrl={docsUrl} />
    </div>
  );
}

function SiteHeader({ appUrl, docsUrl }: { appUrl: string; docsUrl: string }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-logo" href="/" aria-label="FFD Connect — accueil">
          <img src="/ffd-logo.svg" alt="" width={36} height={36} />
          <span className="site-logo__text">
            <span className="site-logo__ffd">FFD</span>
            <span className="site-logo__connect">Connect</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Navigation">
          <a href="#manifeste">Manifeste</a>
          <a href="#modules">Modules</a>
          <a href="#socle">Socle</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
        <div className="site-header__actions">
          <a href={docsUrl} className="link-quiet">
            Docs
          </a>
          <a href={appUrl} className="btn btn--primary">
            Beta
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero({ appUrl }: { appUrl: string }) {
  const reduce = useReducedMotion();

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__grid">
        <div className="hero__mark" aria-hidden>
          <span className="hero__slash" />
        </div>

        <motion.div
          className="hero__title-block"
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <p className="hero__kicker">Fédération Française de Danse</p>
          <h1 id="hero-title" className="hero__title">
            <span className="hero__title-line">CONNECT</span>
          </h1>
          <p className="hero__tagline">
            Une plateforme pour les danseurs, les clubs et l’administration — compétitions, licence,
            audio et contrôle, dans un seul écosystème.
          </p>
          <div className="hero__actions">
            <a href={appUrl} className="btn btn--inverse">
              Entrer sur la beta
            </a>
            <a href="#modules" className="btn btn--ghost">
              Voir les modules
            </a>
          </div>
        </motion.div>

        <motion.div
          className="hero__aside"
          initial={reduce ? false : { opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: reduce ? 0 : 0.12, ease }}
        >
          <dl className="hero__stats">
            <div className="hero__stat">
              <dt>Profils</dt>
              <dd>Danseur · Club · Admin</dd>
            </div>
            <div className="hero__stat">
              <dt>Stack</dt>
              <dd>Expo · NestJS · PostgreSQL</dd>
            </div>
            <div className="hero__stat">
              <dt>Accès</dt>
              <dd>Mobile first · API documentée</dd>
            </div>
          </dl>
          <div className="hero__frame" aria-hidden>
            <div className="hero__frame-inner" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function MarqueeStrip() {
  return (
    <div className="marquee" role="presentation" aria-hidden>
      <div className="marquee__fade marquee__fade--left" />
      <div className="marquee__fade marquee__fade--right" />
      <div className="marquee__track">
        {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((label, i) => (
          <span key={`${label}-${i}`} className="marquee__item">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Manifesto() {
  return (
    <section className="manifesto" id="manifeste" aria-labelledby="manifesto-title">
      <div className="manifesto__inner" id="contenu">
        <h2 id="manifesto-title" className="manifesto__title">
          Moins d’outils dispersés.
          <br />
          <span className="manifesto__title-accent">Plus de temps sur la piste.</span>
        </h2>
        <p className="manifesto__text">
          FFD Connect centralise ce qui compte pour l’écosystème compétition : authentification,
          parcours licence, services métiers et intégrations — avec une API unique et une app pensée
          pour le terrain.
        </p>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="features" id="modules" aria-labelledby="features-title">
      <div className="features__head">
        <h2 id="features-title" className="features__title">
          Modules
        </h2>
        <p className="features__lede">
          Quatre blocs, une logique : tout ce dont vous avez besoin le jour J.
        </p>
      </div>
      <ol className="features__list">
        {FEATURES.map((f, index) => (
          <motion.li
            key={f.n}
            className="feature-row"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, delay: index * 0.05, ease }}
          >
            <span className="feature-row__n" aria-hidden>
              {f.n}
            </span>
            <div className="feature-row__body">
              <h3 className="feature-row__title">{f.title}</h3>
              <p className="feature-row__desc">{f.body}</p>
              <ul className="feature-row__tags">
                {f.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function PlatformBlock() {
  return (
    <section className="platform" id="socle" aria-labelledby="platform-title">
      <div className="platform__inner">
        <div className="platform__intro">
          <h2 id="platform-title" className="platform__title">
            Un socle technique
          </h2>
          <p className="platform__lede">
            Application mobile Expo pour l’usage réel, API NestJS pour le métier — monorepo
            TypeScript, contrats partagés, qualité outillée.
          </p>
        </div>
        <div className="platform__panels">
          <article className="platform-card">
            <h3 className="platform-card__label">Mobile</h3>
            <p className="platform-card__text">
              Parcours danseur &amp; club : médias, notifications, licence, compétition.
            </p>
            <ul className="platform-card__chips">
              <li>Expo</li>
              <li>React Native</li>
              <li>TypeScript</li>
            </ul>
          </article>
          <article className="platform-card">
            <h3 className="platform-card__label">API</h3>
            <p className="platform-card__text">
              Services métiers, rôles, données — prêts pour l’app et les intégrations.
            </p>
            <ul className="platform-card__chips">
              <li>NestJS</li>
              <li>Prisma</li>
              <li>PostgreSQL</li>
              <li>Redis</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function CtaBand({ appUrl }: { appUrl: string }) {
  return (
    <section className="cta-band" aria-labelledby="cta-title">
      <div className="cta-band__inner">
        <h2 id="cta-title" className="cta-band__title">
          Rejoindre la beta
        </h2>
        <p className="cta-band__text">
          Testez les parcours et influencez la feuille de route produit.
        </p>
        <a href={appUrl} className="btn btn--on-red">
          Liste d’attente
        </a>
      </div>
    </section>
  );
}

function SiteFooter({ appUrl, docsUrl }: { appUrl: string; docsUrl: string }) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <img src="/ffd-logo.svg" alt="" width={28} height={28} />
          <span>FFD Connect</span>
        </div>
        <nav className="site-footer__nav" aria-label="Liens de pied de page">
          <a href="#manifeste">Manifeste</a>
          <a href="#modules">Modules</a>
          <a href="#socle">Socle</a>
          <a href="#roadmap">Roadmap</a>
          <a href={docsUrl}>Documentation</a>
          <a href={appUrl}>Web</a>
          <a href={`${import.meta.env.BASE_URL}beta/`}>Installer la bêta</a>
          <a href={`${import.meta.env.BASE_URL}confidentialite/`}>Confidentialité</a>
          <a href={`${import.meta.env.BASE_URL}cgu/`}>CGU</a>
          <a href={`${import.meta.env.BASE_URL}mentions-legales/`}>Mentions légales</a>
          <a href={`${import.meta.env.BASE_URL}suppression-compte/`}>Supprimer son compte</a>
        </nav>
        <p className="site-footer__legal">
          Projet indépendant — non affilié à la Fédération Française de Danse
        </p>
      </div>
    </footer>
  );
}
