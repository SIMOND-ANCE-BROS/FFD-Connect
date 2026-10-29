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
import { PublicRoadmap } from './RoadmapSection';

const modules: {
  id: DemoView;
  name: string;
  icon: typeof Trophy;
  title: string;
  description: string;
  items: string[];
  access: string;
  limitation: string;
}[] = [
  {
    id: 'competitions',
    access: 'Dans la bêta · selon votre profil',
    limitation:
      'Programme, résultats et inscriptions dépendent des données et des accès de chaque événement.',
    name: 'Compétitions',
    icon: Trophy,
    title: 'Le programme de chaque compétition',
    description:
      'Recherchez un événement, ouvrez sa fiche pour lire les épreuves et le timing de la journée, puis demandez votre inscription quand elle est ouverte.',
    items: [
      'Rechercher une compétition par nom ou par ville',
      'Lire les épreuves et le timing de la journée',
      'Demander son inscription et suivre sa validation',
    ],
  },
  {
    id: 'licence',
    access: 'Dans la bêta · espace Danseur',
    limitation:
      'La carte et son pass Wallet ne sont pas encore acceptés en compétition. Conservez votre justificatif habituel.',
    name: 'Licence',
    icon: ScanLine,
    title: 'Votre licence, même sans réseau',
    description:
      'Votre carte de licence et son QR code restent consultables sans connexion une fois chargés. Sur iPhone, ajoutez-la à Apple Wallet quand l’option est proposée.',
    items: [
      'Afficher sa carte et son QR code hors ligne',
      'Vérifier sa saison et sa date de validité',
      'Ajouter sa licence WDSF à côté de la licence FFD',
    ],
  },
  {
    id: 'audio',
    access: 'Dans la bêta · Danseur et Admin',
    limitation:
      'La bibliothèque accessible dépend des titres disponibles et de vos droits. Aucun morceau réel n’est joué dans cet aperçu.',
    name: 'Musique',
    icon: Music2,
    title: 'La musique d’entraînement, danse par danse',
    description:
      'Cherchez un titre ou parcourez la bibliothèque par danse. Vos favoris sont téléchargés pour s’écouter sans réseau.',
    items: [
      'Parcourir les titres de chaque danse',
      'Écouter ses favoris hors ligne',
      'Enchaîner les danses d’un tour en mode compétition, avec annonces vocales',
    ],
  },
  {
    id: 'organisation',
    access: 'Dans la bêta · espace Club',
    limitation:
      'La gestion nécessite un compte Club habilité. Les inscriptions en attente dépendent du mode choisi par votre club.',
    name: 'Espace club',
    icon: Users,
    title: 'Les membres et les inscriptions du club',
    description:
      'Avec un compte Club, retrouvez les membres rattachés à votre club, ses couples et ses équipes, et traitez les demandes d’inscription.',
    items: [
      'Ouvrir la fiche de chaque membre',
      'Préparer les couples et les équipes solo',
      'Valider ou refuser les inscriptions en attente',
    ],
  },
];

const profiles = {
  danseur: {
    name: 'Danseur',
    icon: Trophy,
    title: 'Votre licence et vos compétitions au même endroit',
    text: 'L’espace Danseur réunit votre licence, les compétitions, votre carrière et la bibliothèque musicale.',
    items: [
      'Votre licence FFD (et WDSF), consultable hors ligne',
      'Le programme des compétitions et vos inscriptions',
      'Votre carrière et vos musiques favorites',
    ],
    module: 'competitions' as DemoView,
    link: 'Explorer le parcours compétition',
  },
  club: {
    name: 'Club',
    icon: Users,
    title: 'Membres, couples et inscriptions',
    text: 'L’espace Club, réservé aux comptes Club, sert à suivre les membres rattachés au club et leurs inscriptions aux compétitions.',
    items: [
      'Les fiches des membres',
      'Les couples et les équipes solo',
      'Les inscriptions en attente de validation',
    ],
    module: 'organisation' as DemoView,
    link: 'Explorer l’espace club',
  },
  organisateur: {
    name: 'Organisateur',
    icon: ScanLine,
    title: 'Le contrôle des licences à l’accueil',
    text: 'L’espace Staff donne accès au programme des compétitions et au scanner : lire le QR code d’une licence enregistre l’arrivée du participant, selon les autorisations de l’événement.',
    items: [
      'Le scanner de QR code des licences',
      'Le résultat du contrôle : validé, déjà enregistré ou refusé',
      'Les épreuves et le timing de la journée',
    ],
    module: 'competitions' as DemoView,
    link: 'Explorer le programme d’une compétition',
  },
};
type Profile = keyof typeof profiles;
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
              APPLICATION INDÉPENDANTE DE DANSE SPORTIVE
            </p>
            <h1 id="hero-title">
              Licence, compétitions
              <br />
              <em>et musique.</em>
            </h1>
            <p className="hero-promise">Bêta ouverte sur iPhone et Android.</p>
            <p className="hero-lede">
              Votre licence consultable sans réseau, le programme des compétitions, la musique
              d’entraînement par danse et la gestion des membres de votre club.
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
            <p className="hero-product-caption">Écrans adaptés de l’app, à essayer ci-dessous.</p>
          </div>
          <div className="hero-audiences">
            <span>CONÇUE POUR</span>
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
                <h2 id="modules-title">
                  Ce que fait l’app
                  <br />
                  <em>aujourd’hui.</em>
                </h2>
              </div>
              <p>
                Quatre modules de la bêta,
                <br />à essayer ici sur des données fictives.
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
                    <h3>{module.title}</h3>
                    <p className="module-description">{module.description}</p>
                    <div className="module-availability">
                      <strong>{module.access}</strong>
                      <p>{module.limitation}</p>
                      <a href={sitePath('documentation/utilisateurs/disponibilites/')}>
                        Fonctions, accès et limites →
                      </a>
                    </div>
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
                <h2 id="profiles-title">
                  Un espace
                  <br />
                  <em>pour chaque rôle.</em>
                </h2>
              </div>
              <p>
                L’app affiche les onglets de votre rôle.
                <br />
                Vous en avez plusieurs ? Changez d’espace dans Réglages.
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
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
              {(Object.entries(profiles) as [Profile, (typeof profiles)[Profile]][]).map(
                ([id, p]) => (
                  <TabsContent value={id} key={id} className="profile-panel">
                    <div className="profile-title">
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
              <h2 id="project-title">
                Les prochaines
                <br />
                <em>évolutions.</em>
              </h2>
              <span className="project-status">
                <CodeMark />
                Bêta ouverte · en développement
              </span>
              <p>
                FFD Connect est une application indépendante, conçue et développée par Gabin Simond.
                La bêta est ouverte sur iPhone via TestFlight et sur Android via le test fermé
                Google Play. L’app n’est pas encore publiée sur l’App Store ni sur Google Play.
              </p>
              <p>
                La liste ci-contre reprend les tickets GitHub en cours ; elle ne garantit aucune
                date. Les limites connues de la bêta sont décrites dans la documentation.
              </p>
              <div className="project-links">
                <a className="text-link" href={betaUrl}>
                  <ArrowUpRight size={17} />
                  Rejoindre la bêta
                </a>
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
                <span>Feuille de route</span>
                <span>GITHUB</span>
              </div>
              <PublicRoadmap />
              <a className="tracker-footer" href={repository} target="_blank" rel="noreferrer">
                SIMOND-ANCE-BROS / FFD-Connect
              </a>
            </div>
          </div>
          <div className="contribute-banner" data-reveal>
            <div>
              <h3>
                Un bug, une idée ?
                <br />
                Proposez-la sur GitHub.
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
            <h2 id="faq-title">
              Questions
              <br /> fréquentes.
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
                a: 'Oui, une bêta est proposée sur iPhone et iPad via TestFlight, et sur Android via le test fermé Google Play. La page d’inscription détaille les étapes pour chaque plateforme. Il s’agit d’une version de test susceptible de contenir des bugs. L’app n’est pas encore publiée sur l’App Store ni sur Google Play.',
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
