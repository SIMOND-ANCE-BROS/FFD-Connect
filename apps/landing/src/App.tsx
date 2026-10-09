import { sitePath } from './lib/ffd';

import { useEffect, useRef, useState } from 'react';
import {
  Trophy,
  Music2,
  ScanLine,
  Users,
  Check,
  GitBranch,
  Play,
  ShieldCheck,
  Plus,
  BookOpen,
  ArrowUpRight,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './components/ui/accordion';
import { Metronome } from './components/metronome';
import { AppDemo, type DemoView } from './components/ffd-demo';
import { SiteHeader, SiteFooter } from './components/site-chrome';
import { repository, betaUrl } from './lib/ffd';
import { MovementLine } from './components/movement-line';

const modules: {
  id: DemoView;
  n: string;
  name: string;
  icon: typeof Trophy;
  phase: string;
  title: string;
  description: string;
  items: string[];
}[] = [
  {
    id: 'competitions',
    n: '01',
    name: 'Compétitions',
    icon: Trophy,
    phase: 'PRÉPARER SA SAISON',
    title: 'Votre prochain départ.',
    description:
      'Du calendrier aux résultats, retrouvez les rendez-vous qui rythment votre saison de danse.',
    items: ['Repérer les compétitions', 'Préparer ses inscriptions', 'Retrouver ses résultats'],
  },
  {
    id: 'licence',
    n: '02',
    name: 'Licence',
    icon: ScanLine,
    phase: 'ARRIVER L’ESPRIT LIBRE',
    title: 'L’essentiel, avec vous.',
    description:
      'Une licence numérique et vos informations réunies, pour simplifier le passage de l’inscription à l’accueil.',
    items: [
      'Retrouver ses informations',
      'Présenter sa licence numérique',
      'Faciliter le contrôle à l’accueil',
    ],
  },
  {
    id: 'audio',
    n: '03',
    name: 'Musique',
    icon: Music2,
    phase: 'ENTRER DANS LE RYTHME',
    title: 'À chaque danse, son tempo.',
    description:
      'Retrouvez la bibliothèque de l’application : classement par danse, recherche et favoris pour préparer vos entraînements.',
    items: [
      'Organiser sa bibliothèque audio',
      'Préparer les morceaux',
      'Accompagner la régie musicale',
    ],
  },
  {
    id: 'organisation',
    n: '04',
    name: 'Espace club',
    icon: Users,
    phase: 'FAIRE VIVRE L’ÉVÉNEMENT',
    title: 'Ensemble, en coulisses.',
    description:
      'Clubs, membres et équipes d’organisation : relier les informations utiles pour accompagner la vie du club et le jour J.',
    items: [
      'Rassembler les membres du club',
      'Suivre les inscriptions',
      'Organiser l’accueil des participants',
    ],
  },
];

const profiles = {
  danseur: {
    n: '01',
    name: 'Danseur',
    icon: Trophy,
    title: 'Concentrez-vous sur la piste.',
    text: 'Une saison se prépare bien avant le premier passage. Le projet rassemble les repères utiles pour vous accompagner à chaque étape.',
    items: [
      'Vos rendez-vous et vos résultats',
      'Votre licence et vos informations',
      'Votre musique pour vous préparer',
    ],
    module: 'competitions' as DemoView,
    link: 'Explorer le parcours compétition',
  },
  club: {
    n: '02',
    name: 'Club',
    icon: Users,
    title: 'Gardez le lien avec vos membres.',
    text: 'Retrouver les informations de la structure, accompagner les inscriptions et suivre la saison : une vision commune pour la vie du club.',
    items: [
      'La structure et ses membres',
      'Les inscriptions aux compétitions',
      'Les informations à partager',
    ],
    module: 'organisation' as DemoView,
    link: 'Explorer les outils d’organisation',
  },
  organisateur: {
    n: '03',
    name: 'Organisateur',
    icon: ScanLine,
    title: 'Faites place à la compétition.',
    text: 'L’accueil, la musique, les annonces : les outils de terrain sont pensés pour accompagner les équipes pendant l’événement.',
    items: [
      'Le contrôle des présences',
      'La bibliothèque audio et la régie',
      'Le suivi de l’événement',
    ],
    module: 'organisation' as DemoView,
    link: 'Explorer les outils d’organisation',
  },
};
type Profile = keyof typeof profiles;
type Issue = {
  number: number;
  title: string;
  html_url: string;
  milestone: { title: string } | null;
};

function usePageMotion() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-revealed', 'true');
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    if (!preference.matches) {
      targets.forEach((target) => observer.observe(target));
      document.documentElement.dataset.motion = 'ready';
    }
    function updatePreference() {
      if (preference.matches) {
        delete document.documentElement.dataset.motion;
        observer.disconnect();
      }
    }
    preference.addEventListener('change', updatePreference);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', updatePreference);
      delete document.documentElement.dataset.motion;
    };
  }, []);
}

function Roadmap() {
  const [data, setData] = useState<Issue[] | null>(null);
  const [error, setError] = useState(false);
  const section = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        timer = setTimeout(() => {
          setError(true);
          controller.abort();
        }, 6500);
        fetch(
          'https://api.github.com/repos/SIMOND-ANCE-BROS/FFD-Connect/issues?state=open&per_page=20&sort=updated',
          { signal: controller.signal },
        )
          .then((response) => {
            if (!response.ok) throw new Error();
            return response.json() as Promise<(Issue & { pull_request?: unknown })[]>;
          })
          .then((result) => {
            clearTimeout(timer);
            setData(result.filter((issue) => !issue.pull_request));
          })
          .catch(() => {
            clearTimeout(timer);
            if (!controller.signal.aborted) setError(true);
          });
      },
      { rootMargin: '400px' },
    );
    if (section.current) observer.observe(section.current);
    return () => {
      clearTimeout(timer);
      controller.abort();
      observer.disconnect();
    };
  }, []);
  return (
    <div
      className="project-feed"
      ref={section}
      aria-live="polite"
      aria-busy={data === null && !error}
    >
      {error ? (
        <div className="feed-fallback">
          <GitBranch size={28} />
          <h3>Le suivi continue sur GitHub.</h3>
          <p>
            Les sujets en cours ne peuvent pas être affichés ici pour le moment. Retrouvez-les
            directement dans le dépôt.
          </p>
          <a className="text-link" href={repository + '/issues'} target="_blank" rel="noreferrer">
            Consulter les sujets en cours
          </a>
        </div>
      ) : data === null ? (
        <div className="feed-loading">
          <span aria-hidden="true" />
          <p>Chargement des sujets en cours…</p>
        </div>
      ) : data.length === 0 ? (
        <div className="feed-fallback">
          <Check size={28} />
          <h3>Aucun sujet ouvert à afficher.</h3>
          <a className="text-link" href={repository + '/issues'} target="_blank" rel="noreferrer">
            Voir l’historique du projet
          </a>
        </div>
      ) : (
        <ol className="project-issues">
          {data.slice(0, 4).map((issue) => (
            <li key={issue.number}>
              <a href={issue.html_url} target="_blank" rel="noreferrer">
                <span className="issue-index">#{issue.number}</span>
                <div>
                  <h3>{issue.title}</h3>
                  {issue.milestone && (
                    <span className="issue-milestone">{issue.milestone.title}</span>
                  )}
                </div>
                <Plus size={18} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function App() {
  usePageMotion();
  const [metronomeOpen, setMetronomeOpen] = useState(false);
  const [view, setView] = useState<DemoView>('competitions');
  const navigationFocus = useRef<DemoView | null>(null);
  const [profile, setProfile] = useState<Profile>('danseur');

  function showModule(next: DemoView) {
    setView(next);
    const target = document.getElementById('modules');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }

  return (
    <>
      <SiteHeader />
      <main id="contenu" tabIndex={-1}>
        <section className="hero section-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-line" />
              LA DANSE SPORTIVE, AU QUOTIDIEN
            </p>
            <h1 id="hero-title">
              La danse,
              <br />
              <em>connectée.</em>
            </h1>
            <p className="hero-promise">Votre saison, de la préparation à la piste.</p>
            <p className="hero-lede">
              Compétitions, licence, musique et vie de club : le projet d’app qui relie votre
              quotidien de danseur.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={betaUrl}>
                Rejoindre la bêta
                <ArrowUpRight size={18} />
              </a>
              <a className="text-link" href="#modules">
                <Play size={16} />
                Essayer l’aperçu
              </a>
            </div>
            <p className="hero-note">
              <ShieldCheck size={16} />
              iOS via TestFlight · Android via Google Play
            </p>
          </div>
          <div
            className="hero-product"
            role="img"
            aria-label="Aperçu adapté de la bibliothèque FFD Connect : catégories de danses et navigation flottante"
          >
            <div className="hero-product-backdrop">
              <img src={sitePath('dance.jpg')} alt="" width="4592" height="2584" />
            </div>
            <MovementLine />
            <AppDemo view="audio" preview />
            <p className="hero-product-caption">L’interface du projet, à découvrir ci-dessous.</p>
          </div>
          <div className="hero-audiences">
            <span>UN PROJET POUR</span>
            {(Object.entries(profiles) as [Profile, (typeof profiles)[Profile]][]).map(
              ([id, p]) => (
                <a href="#profils" key={id} onClick={() => setProfile(id)}>
                  <p.icon size={17} />
                  {id === 'danseur'
                    ? 'Les danseurs'
                    : id === 'club'
                      ? 'Les clubs'
                      : 'Les organisateurs'}
                </a>
              ),
            )}
          </div>
        </section>

        <section
          className="modules-section"
          id="modules"
          tabIndex={-1}
          aria-labelledby="modules-title"
        >
          <div className="section-width">
            <div className="section-heading" data-reveal>
              <div>
                <p className="eyebrow">01 / L’APPLICATION</p>
                <h2 id="modules-title">
                  Tous les temps
                  <br />
                  <em>de votre saison.</em>
                </h2>
              </div>
              <p>
                Une fenêtre sur FFD Connect.
                <br />
                Naviguez dans les écrans adaptés du projet.
              </p>
            </div>
            <Tabs
              value={view}
              onValueChange={(value) => setView(value as DemoView)}
              className="module-tabs"
            >
              <TabsList className="module-nav" aria-label="Explorer les modules">
                {modules.map((module) => (
                  <TabsTrigger value={module.id} key={module.id}>
                    <span className="module-tab-number" aria-hidden="true">
                      {module.n}
                    </span>
                    <module.icon size={20} />
                    <span>{module.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {modules.map((module) => (
                <TabsContent value={module.id} key={module.id} className="module-panel">
                  <div className="demo-stage">
                    <MovementLine />
                    <div className="demo-stage-label">
                      <span>APERÇU NAVIGABLE</span>
                      <span aria-hidden="true">{module.n} / 04</span>
                    </div>
                    <AppDemo
                      view={module.id}
                      focusNavigation={navigationFocus.current === module.id}
                      onNavigate={(next) => {
                        navigationFocus.current = next;
                        setView(next);
                      }}
                    />
                    <p className="demo-stage-note">
                      {module.id === 'competitions'
                        ? 'Ouvrez une compétition pour découvrir sa fiche et son programme.'
                        : 'Touchez l’écran pour explorer ce module.'}
                      <br />
                      Adaptation web · Données fictives
                    </p>
                  </div>
                  <div className="module-story">
                    <p className="eyebrow">
                      <span className="step-dot" aria-hidden="true" />
                      {module.phase}
                    </p>
                    <h3>{module.title}</h3>
                    <p className="module-description">{module.description}</p>
                    <ul>
                      {module.items.map((item) => (
                        <li key={item}>
                          <Check size={18} />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <div className="demo-mission">
                      <p className="eyebrow">À ESSAYER DANS CET APERÇU</p>
                      <ol>
                        {(module.id === 'competitions'
                          ? [
                              'Recherchez « Lyon ».',
                              'Ouvrez « Open de Lyon ».',
                              'Consultez les onglets Épreuves puis Timing.',
                            ]
                          : module.id === 'audio'
                            ? [
                                'Dans Danses, ouvrez « Samba ».',
                                'Ajoutez le titre aux favoris avec le cœur.',
                                'Ouvrez Favoris pour le retrouver.',
                              ]
                            : module.id === 'licence'
                              ? [
                                  'Vérifiez l’identité et la saison sur la carte.',
                                  'Touchez le QR pour comprendre son utilisation.',
                                  'Repliez puis rouvrez la carte FFD.',
                                ]
                              : [
                                  'Repérez le nombre de membres.',
                                  'Ouvrez « Gestion des Membres » pour lire son rôle.',
                                  'Découvrez les raccourcis Couples et Solo Teams.',
                                ]
                        ).map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <a
                        className="text-link"
                        href={sitePath(
                          `documentation/utilisateurs/${module.id === 'organisation' ? 'clubs' : 'danseurs'}/`,
                        )}
                      >
                        Consulter le guide pas à pas →
                      </a>
                    </div>
                    <a href={betaUrl} className="text-link">
                      Passer à l’application : rejoindre la bêta
                    </a>
                    <p className="preview-source">
                      Repris du{' '}
                      <a
                        href={
                          repository +
                          '/tree/0e257a11b8f9e052a042f1f58e53d0c706daef64/apps/client/src'
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        client de l’application
                      </a>{' '}
                      : structure, couleurs et navigation. Parcours limité, sans connexion à un
                      compte.
                    </p>
                    {module.id === 'audio' && (
                      <details
                        className="metronome-details"
                        onToggle={(event) => setMetronomeOpen(event.currentTarget.open)}
                      >
                        <summary>Essayer aussi le métronome du site</summary>
                        <p>Un outil sonore complémentaire à cet aperçu de la bibliothèque.</p>
                        {metronomeOpen && <Metronome />}
                      </details>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </section>

        <section
          className="profiles-section"
          id="profils"
          tabIndex={-1}
          aria-labelledby="profiles-title"
        >
          <div className="section-width">
            <div className="profile-heading" data-reveal>
              <div>
                <p className="eyebrow">02 / VOTRE PLACE DANS LE PROJET</p>
                <h2 id="profiles-title">
                  Chacun son rôle.
                  <br />
                  <em>Le même élan.</em>
                </h2>
              </div>
              <p>
                Un projet commun, pensé depuis
                <br />
                les deux côtés de la piste.
              </p>
              <MovementLine />
            </div>
            <Tabs
              value={profile}
              onValueChange={(value) => setProfile(value as Profile)}
              className="profile-tabs"
            >
              <TabsList className="profile-nav" aria-label="Choisir votre profil">
                {(Object.entries(profiles) as [Profile, (typeof profiles)[Profile]][]).map(
                  ([id, p]) => (
                    <TabsTrigger value={id} key={id}>
                      <p.icon size={20} />
                      <span>{p.name}</span>
                      <span className="profile-tab-index" aria-hidden="true">
                        {p.n}
                      </span>
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
              {(Object.entries(profiles) as [Profile, (typeof profiles)[Profile]][]).map(
                ([id, p]) => (
                  <TabsContent value={id} key={id} className="profile-panel">
                    <div className="profile-title">
                      <span className="profile-large-number" aria-hidden="true">
                        {p.n}
                      </span>
                      <h3>{p.title}</h3>
                    </div>
                    <div className="profile-details">
                      <p>{p.text}</p>
                      <ul>
                        {p.items.map((item) => (
                          <li key={item}>
                            <Check size={17} />
                            {item}
                          </li>
                        ))}
                      </ul>
                      <button
                        className="text-link"
                        type="button"
                        onClick={() => showModule(p.module)}
                      >
                        {p.link}
                      </button>
                    </div>
                  </TabsContent>
                ),
              )}
            </Tabs>
          </div>
        </section>

        <section
          className="project-section section-width"
          id="roadmap"
          tabIndex={-1}
          aria-labelledby="project-title"
        >
          <div className="project-grid">
            <div className="project-intro" data-reveal>
              <p className="eyebrow">03 / LE PROJET</p>
              <h2 id="project-title">
                La suite
                <br />
                <em>s’écrit ensemble.</em>
              </h2>
              <span className="project-status">
                <CodeMark />
                Prototype en développement
              </span>
              <p>
                Conçu par Gabin Simond, FFD Connect explore une façon plus simple de relier les
                usages de la danse sportive.
              </p>
              <p>
                Les avancées, les limites connues et les sujets en cours sont documentés dans le
                dépôt du projet.
              </p>
              <div className="project-links">
                <a className="text-link" href={sitePath('documentation')}>
                  <BookOpen size={17} />
                  Consulter la documentation
                </a>
                <a
                  className="text-link"
                  href={repository + '/milestones'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Voir les jalons sur GitHub
                </a>
              </div>
              <img
                className="project-brand-image"
                src={sitePath('app-presentation.png')}
                width="1024"
                height="500"
                loading="lazy"
                alt="FFD Connect — La danse, connectée. Compétitions, licence, musique."
              />
            </div>
            <div className="project-tracker" data-reveal>
              <div className="project-source">
                <GitBranch size={21} />
                <span>Les sujets en cours</span>
                <span>GITHUB</span>
              </div>
              <Roadmap />
              <a className="tracker-footer" href={repository} target="_blank" rel="noreferrer">
                SIMOND-ANCE-BROS / FFD-Connect
              </a>
            </div>
          </div>
          <div className="contribute-banner" data-reveal>
            <div>
              <p className="eyebrow">VOTRE EXPÉRIENCE COMPTE</p>
              <h3>
                Vous connaissez le terrain.
                <br />
                Faisons évoluer les usages.
              </h3>
            </div>
            <a
              href={repository + '/issues/new/choose'}
              className="button button-white"
              target="_blank"
              rel="noreferrer"
            >
              <Plus size={18} />
              Proposer une amélioration
            </a>
          </div>
        </section>

        <section className="faq-section section-width" aria-labelledby="faq-title">
          <div data-reveal>
            <p className="eyebrow">QUELQUES REPÈRES</p>
            <h2 id="faq-title">
              Avant de
              <br /> commencer.
            </h2>
          </div>
          <Accordion type="single" collapsible className="faq-list" data-reveal>
            {[
              {
                q: 'FFD Connect est-elle une application officielle ?',
                a: 'Non. FFD Connect est un prototype indépendant conçu et développé par Gabin Simond. La Fédération Française de Danse n’en est ni l’éditrice ni l’hébergeuse.',
              },
              {
                q: 'Puis-je télécharger l’application ?',
                a: 'Oui, une bêta est proposée sur iPhone et iPad via TestFlight, et sur Android via le test fermé Google Play. La page d’inscription détaille les étapes pour chaque plateforme. Il s’agit d’une version de test susceptible de contenir des bugs.',
                link: true,
              },
              {
                q: 'Ces écrans sont-ils ceux de l’application ?',
                a: 'Ces aperçus sont des adaptations web réalisées à partir du code des écrans de FFD Connect : structure, couleurs, cartes et navigation. Ce ne sont pas des captures ni l’application complète. La recherche, les filtres, les favoris et le parcours compétition fonctionnent sur des données fictives. Les actions nécessitant un compte restent explicatives. Aucun compte ni service de l’application n’est connecté.',
              },
            ].map((item, index) => (
              <AccordionItem value={'question-' + index} key={item.q}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>
                  <p>{item.a}</p>
                  {item.link && (
                    <a className="text-link" href={betaUrl}>
                      Rejoindre la bêta
                    </a>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function CodeMark() {
  return (
    <span className="code-mark" aria-hidden="true">
      {'{ }'}
    </span>
  );
}
