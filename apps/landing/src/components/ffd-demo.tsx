import { sitePath } from '../lib/ffd';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  Award,
  Bell,
  CalendarDays,
  ChevronLeft,
  Clock,
  Heart,
  IdCard,
  ListMusic,
  MapPin,
  Music2,
  ScanLine,
  Search,
  Settings,
  Share,
  SlidersHorizontal,
  Trophy,
  User,
  Users,
  UsersRound,
  ClipboardList,
  X,
  BatteryFull,
  Wifi,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './ui/dialog';

import { CompetitionDetail } from './competition-detail';

// Web adaptation of the client screens at 0e257a11b8f9e052a042f1f58e53d0c706daef64.
// See APP_PREVIEW.md for source paths, preserved styling and deliberate deviations.
export type DemoView = 'competitions' | 'licence' | 'audio' | 'organisation';
const events = [
  {
    title: 'Open de Lyon',
    city: 'Lyon',
    date: '24 octobre 2026',
    status: 'À venir',
    mine: true,
    registered: true,
  },
  {
    title: 'Trophée des Alpes',
    city: 'Grenoble',
    date: '14 novembre 2026',
    status: 'À venir',
    mine: true,
    registered: false,
  },
  {
    title: 'Coupe Atlantique',
    city: 'Nantes',
    date: '28 novembre 2026',
    status: 'À venir',
    mine: false,
    registered: false,
  },
  {
    title: 'Rencontre d’automne',
    city: 'Paris',
    date: '7 octobre 2026',
    status: 'En cours',
    mine: true,
    registered: true,
  },
  {
    title: 'Grand Prix d’été',
    city: 'Bordeaux',
    date: '12 septembre 2026',
    status: 'Passées',
    mine: true,
    registered: true,
  },
];
const dances = [
  'Samba',
  'Cha-cha-cha',
  'Rumba',
  'Paso doble',
  'Jive',
  'Valse lente',
  'Tango',
  'Valse viennoise',
  'Slow fox',
  'Quickstep',
];
const cadences = [50, 30, 25, 60, 43, 29, 32, 58, 28, 50];

function Segments({
  value,
  onChange,
  options,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  children?: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className="native-segments">
      <TabsList aria-label={label}>
        {options.map((v) => (
          <TabsTrigger key={v} value={v}>
            {v}
          </TabsTrigger>
        ))}
      </TabsList>
      {options.map((v) => (
        <TabsContent value={v} key={v}>
          {children}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function AppDemo({
  view,
  onNavigate,
  preview = false,
  focusNavigation = false,
}: {
  view: DemoView;
  focusNavigation?: boolean;
  onNavigate?: (v: DemoView) => void;
  preview?: boolean;
}) {
  const [selectedEvent, setSelectedEvent] = useState<(typeof events)[number] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const eventButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const previousEvent = useRef<string | null>(null);
  useEffect(() => {
    if (selectedEvent) {
      previousEvent.current = selectedEvent.title;
      scroll.current?.scrollTo(0, 0);
      heading.current?.focus();
    } else if (previousEvent.current) {
      eventButtons.current[previousEvent.current]?.focus();
      previousEvent.current = null;
    }
  }, [selectedEvent]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('Toutes');
  const [status, setStatus] = useState('À venir');
  const [musicTab, setMusicTab] = useState('Danses');
  const [dance, setDance] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(['Rumba']);
  const [expanded, setExpanded] = useState(true);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [filters, setFilters] = useState(false);
  const [discipline, setDiscipline] = useState('Toutes');
  const title =
    view === 'competitions'
      ? (selectedEvent?.title ?? 'Compétitions')
      : view === 'licence'
        ? 'Mes licences'
        : view === 'audio'
          ? dance || 'Bibliothèque'
          : 'Danse Club Démo';
  const info = (title: string, body: string) => setNotice({ title, body });
  const unavailable = (title: string) =>
    info(
      title,
      'Ce parcours n’est pas inclus dans cet aperçu. Dans l’application, il est accessible selon votre profil et vos droits.',
    );
  const matches = (text: string) =>
    text
      .toLocaleLowerCase('fr')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .includes(
        query
          .toLocaleLowerCase('fr')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, ''),
      );
  const filteredEvents = events.filter(
    (e) =>
      (status === 'Tout' || e.status === status) &&
      (scope === 'Toutes' || e.mine) &&
      matches(e.title + ' ' + e.city),
  );
  const filteredDances = dances.filter(
    (d, i) =>
      matches(d + ' ' + cadences[i]) &&
      (!dance || dance === d) &&
      (musicTab !== 'Favoris' || favorites.includes(d)) &&
      (discipline === 'Toutes' || (discipline === 'Latines' ? i < 5 : i >= 5)),
  );
  const grid = musicTab === 'Danses' && !dance && !query;
  const navigation =
    view === 'organisation'
      ? [
          { label: 'Espace club', Icon: Users, target: 'organisation' },
          { label: 'Compétitions', Icon: Trophy, target: 'competitions' },
          { label: 'Scanner', Icon: ScanLine },
          { label: 'Paramètres', Icon: Settings },
        ]
      : [
          { label: 'Carrière', Icon: Award },
          { label: 'Licence', Icon: IdCard, target: 'licence' },
          { label: 'Bibliothèque', Icon: ListMusic, target: 'audio' },
          { label: 'Compétitions', Icon: Trophy, target: 'competitions' },
          { label: 'Paramètres', Icon: Settings },
        ];
  return (
    <div className={'phone-shell' + (preview ? ' phone-preview' : '')}>
      <div className="phone-screen" inert={preview || undefined} aria-hidden={preview || undefined}>
        <div className="phone-status" aria-hidden="true">
          <span>9:41</span>
          <span className="phone-camera" />
          <span>
            <Wifi size={15} />
            <BatteryFull size={19} />
          </span>
        </div>
        <div className="native-app">
          <header className="native-header">
            {dance && (
              <button
                className="native-icon"
                aria-label="Revenir aux danses"
                onClick={() => setDance(null)}
              >
                <ChevronLeft size={21} />
              </button>
            )}
            {selectedEvent && view === 'competitions' && (
              <button
                className="native-icon"
                aria-label="Revenir aux compétitions"
                onClick={() => setSelectedEvent(null)}
              >
                <ChevronLeft size={21} />
              </button>
            )}
            <h4 ref={heading} tabIndex={-1}>
              {title}
            </h4>
            <div className="native-header-actions">
              {(view === 'audio' || (view === 'competitions' && !selectedEvent)) && (
                <button
                  className="native-icon"
                  aria-label="Filtres de l’aperçu"
                  aria-expanded={filters}
                  onClick={() => setFilters(!filters)}
                >
                  <SlidersHorizontal size={19} />
                </button>
              )}
              {view === 'audio' && (
                <button
                  className="native-icon native-gold"
                  aria-label="Mode compétition"
                  onClick={() => unavailable('Mode compétition')}
                >
                  <Trophy size={20} />
                </button>
              )}
              <button
                className="native-icon"
                aria-label="Notifications de démonstration"
                onClick={() =>
                  info(
                    'Notifications',
                    'Aucune notification dans cette démonstration. Dans l’application, cet espace rassemble les informations liées à votre compte.',
                  )
                }
              >
                <Bell size={19} />
              </button>
              {view === 'licence' && (
                <button
                  className="native-icon"
                  aria-label="Partager la licence"
                  onClick={() =>
                    info(
                      'Partager sa licence',
                      'L’application permet de générer un PDF de votre licence. La carte présentée ici est fictive et ne peut pas être utilisée pour un contrôle.',
                    )
                  }
                >
                  <Share size={19} />
                </button>
              )}
            </div>
          </header>
          {((view === 'competitions' && !selectedEvent) || view === 'audio') && (
            <div className="native-pinned">
              <label className="native-search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    view === 'audio'
                      ? 'Rechercher titre, artiste, danse ou MPM…'
                      : 'Rechercher une compétition…'
                  }
                  aria-label={
                    view === 'audio'
                      ? 'Rechercher dans la bibliothèque de démonstration'
                      : 'Rechercher une compétition de démonstration'
                  }
                />
              </label>
              {filters && (
                <div className="native-filter-panel">
                  {view === 'audio' ? (
                    <Segments
                      value={discipline}
                      onChange={setDiscipline}
                      options={['Toutes', 'Latines', 'Standards']}
                      label="Famille de danses"
                    />
                  ) : (
                    <p>
                      Essayez les filtres de période et « Pour moi » ci-dessous. Les filtres avancés
                      de distance et de discipline sont disponibles dans l’application.
                    </p>
                  )}
                </div>
              )}
              {view === 'competitions' ? (
                <>
                  <Segments
                    value={scope}
                    onChange={setScope}
                    options={['Toutes', 'Pour moi']}
                    label="Compétitions pour votre profil"
                  />
                  <Segments
                    value={status}
                    onChange={setStatus}
                    options={['À venir', 'En cours', 'Passées', 'Tout']}
                    label="Période des compétitions"
                  />
                </>
              ) : (
                <Segments
                  value={musicTab}
                  onChange={(v) => {
                    setMusicTab(v);
                    setDance(null);
                  }}
                  options={['Tout', 'Danses', 'Favoris']}
                  label="Vue de la bibliothèque"
                />
              )}
            </div>
          )}
          <div
            ref={scroll}
            className="native-scroll"
            tabIndex={preview ? undefined : 0}
            aria-label={'Contenu défilant : ' + title}
          >
            {view === 'competitions' && selectedEvent && (
              <CompetitionDetail key={selectedEvent.title} event={selectedEvent} />
            )}
            {view === 'competitions' && !selectedEvent && (
              <div className="native-events">
                {filteredEvents.map((e) => (
                  <button
                    key={e.title}
                    className="native-event"
                    ref={(el) => {
                      eventButtons.current[e.title] = el;
                    }}
                    onClick={() => setSelectedEvent(e)}
                  >
                    <div className="native-event-top">
                      <strong>{e.title}</strong>
                      <div>
                        <span className="native-badge">
                          {e.status === 'Passées' ? 'Terminée' : e.status}
                        </span>
                        {e.status === 'À venir' && (
                          <small className={e.registered ? 'native-success' : ''}>
                            {e.registered ? 'Inscrit' : 'Non inscrit'}
                          </small>
                        )}
                      </div>
                    </div>
                    <p>
                      <CalendarDays size={16} />
                      {e.date}
                    </p>
                    {e.title === 'Open de Lyon' && (
                      <span className="native-deadline">
                        <Clock size={14} />
                        Clôture le 18 octobre
                      </span>
                    )}
                    <p>
                      <MapPin size={16} />
                      {e.city}
                    </p>
                  </button>
                ))}
                {filteredEvents.length === 0 && (
                  <p className="native-empty" role="status">
                    Aucune compétition pour ces critères.
                  </p>
                )}
              </div>
            )}
            {view === 'audio' && (
              <div className={grid ? 'native-dance-grid' : 'native-tracks'}>
                {filteredDances.map((d) =>
                  grid ? (
                    <button key={d} className="native-dance" onClick={() => setDance(d)}>
                      <span>{d.charAt(0)}</span>
                      <strong>{d}</strong>
                      <small>1 titre</small>
                    </button>
                  ) : (
                    <div key={d} className="native-track">
                      <span className="native-track-art">
                        <Music2 size={24} />
                      </span>
                      <div>
                        <strong>{d} — entraînement</strong>
                        <small>Exemple de bibliothèque</small>
                        <span className="native-track-style">{d}</span>
                      </div>
                      <span className="native-mpm">
                        <b>{cadences[dances.indexOf(d)]}</b>
                        <small>MPM</small>
                      </span>
                      <button
                        className="native-heart"
                        aria-label={
                          (favorites.includes(d) ? 'Retirer ' : 'Ajouter ') +
                          d +
                          (favorites.includes(d) ? ' des favoris' : ' aux favoris')
                        }
                        aria-pressed={favorites.includes(d)}
                        onClick={() =>
                          setFavorites((old) =>
                            old.includes(d) ? old.filter((v) => v !== d) : [...old, d],
                          )
                        }
                      >
                        <Heart size={19} fill={favorites.includes(d) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  ),
                )}
                {filteredDances.length === 0 && (
                  <p className="native-empty" role="status">
                    Aucun titre pour ces critères.
                  </p>
                )}
                {!grid && (
                  <p className="native-example-note">
                    Titres fictifs · Aucun morceau audio chargé.
                  </p>
                )}
              </div>
            )}
            {view === 'licence' && (
              <div className="native-license-area">
                <p className="native-season">Saison 2026-2027 · Démonstration</p>
                <div className="native-license-card">
                  <button
                    className="native-license-heading"
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    aria-controls="demo-license-body"
                  >
                    <img src={sitePath('license-source-logo.png')} width="60" height="60" alt="" />
                    <span>
                      <strong>FFD</strong>
                      <b>2026-2027</b>
                    </span>
                    <span className="license-more" aria-hidden="true">
                      •••
                    </span>
                  </button>
                  {expanded && (
                    <div id="demo-license-body">
                      <div className="native-license-body">
                        <div>
                          <h5>Camille Martin</h5>
                          <dl>
                            <dt>Numéro :</dt>
                            <dd>DÉMONSTRATION</dd>
                            <dt>Date de naissance :</dt>
                            <dd>01/01/2000</dd>
                          </dl>
                        </div>
                        <div className="native-license-photo">
                          <div>
                            <User size={38} />
                          </div>
                          <button
                            aria-label="À propos du QR de licence"
                            onClick={() =>
                              info(
                                'Le QR de votre licence',
                                'Dans l’application, le QR s’agrandit pour faciliter sa lecture à l’accueil. Aucun QR de licence valide n’est généré dans cette démonstration.',
                              )
                            }
                          >
                            <ScanLine size={48} />
                            <small>Aperçu</small>
                          </button>
                        </div>
                      </div>
                      <div className="native-license-footer">
                        <dl>
                          <dt>Structure :</dt>
                          <dd>Danse Club Démo</dd>
                          <dt>Assurance :</dt>
                          <dd>Exemple de couverture</dd>
                        </dl>
                        <div>
                          <span>Licence valable jusqu’au</span>
                          <strong>31/08/2027</strong>
                        </div>
                      </div>
                      <p className="native-license-watermark">SPÉCIMEN · NON VALIDE</p>
                    </div>
                  )}
                </div>
                <div className="native-add-license">
                  <IdCard size={24} />
                  <span>Licence WDSF</span>
                  <button onClick={() => unavailable('Ajouter une licence WDSF')}>Découvrir</button>
                </div>
              </div>
            )}
            {view === 'organisation' && (
              <div className="native-club">
                <div className="native-club-heading">
                  <h5>Aperçu</h5>
                  <button
                    className="native-icon"
                    aria-label="Personnaliser le tableau de bord"
                    onClick={() =>
                      info(
                        'Votre tableau de bord',
                        'Dans l’application, vous pouvez afficher, masquer et réordonner les raccourcis de votre espace club.',
                      )
                    }
                  >
                    <Settings size={18} />
                  </button>
                </div>
                <div className="native-club-grid">
                  {[
                    { label: 'Membres', value: '48', Icon: User, color: '#4CAF50' },
                    { label: 'Compétitions', value: '2', Icon: Trophy, color: '#2196F3' },
                    { label: 'Couples', value: '—', Icon: Users, color: '#E91E63' },
                    { label: 'Solo Teams', value: '—', Icon: UsersRound, color: '#9C27B0' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() =>
                        info(
                          item.label,
                          `Exemple d’espace club. La rubrique ${item.label.toLowerCase()} permet d’accéder à sa gestion dans l’application. Les chiffres affichés ici sont fictifs.`,
                        )
                      }
                    >
                      <span style={{ color: item.color, backgroundColor: item.color + '20' }}>
                        <item.Icon size={24} />
                      </span>
                      <strong>{item.value}</strong>
                      <small>{item.label}</small>
                    </button>
                  ))}
                </div>
                <h5>Gestion</h5>
                {[
                  {
                    label: 'Événements',
                    subtitle: 'Gérer les événements et résultats',
                    Icon: Trophy,
                    color: '#2196F3',
                  },
                  {
                    label: 'Gestion des Membres',
                    subtitle: 'Ajouter, modifier, supprimer',
                    Icon: User,
                    color: '#4CAF50',
                  },
                  {
                    label: 'Couples',
                    subtitle: 'Créer et gérer les partenariats',
                    Icon: Users,
                    color: '#E91E63',
                  },
                  {
                    label: 'Inscriptions en attente',
                    subtitle: 'Demandes à valider',
                    Icon: ClipboardList,
                    color: '#FF9800',
                  },
                ].map((item) => (
                  <button
                    className="native-club-row"
                    key={item.label}
                    onClick={() =>
                      info(
                        item.label,
                        item.subtitle +
                          '. Cette gestion s’effectue dans l’application avec un compte club ; aucune modification réelle n’est possible dans cet aperçu.',
                      )
                    }
                  >
                    <span style={{ color: item.color, backgroundColor: item.color + '20' }}>
                      <item.Icon size={20} />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.subtitle}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <nav className="native-bottom" aria-label="Navigation de l’aperçu">
            {navigation.map((item) => (
              <button
                key={item.label}
                title={item.label}
                aria-label={item.label}
                aria-current={item.target === view ? 'page' : undefined}
                data-demo-nav={item.target}
                autoFocus={focusNavigation && item.target === view}
                onClick={() => {
                  if (item.target === 'competitions' && view === 'competitions')
                    setSelectedEvent(null);
                  else if (item.target) onNavigate?.(item.target as DemoView);
                  else unavailable(item.label);
                }}
              >
                <item.Icon size={23} />
              </button>
            ))}
          </nav>
        </div>
        <span className="phone-home-indicator" aria-hidden="true" />
      </div>
      {!preview && (
        <Dialog open={!!notice} onOpenChange={(open) => !open && setNotice(null)}>
          <DialogContent className="preview-dialog" showCloseButton={false}>
            <DialogTitle>{notice?.title}</DialogTitle>
            <DialogDescription>{notice?.body}</DialogDescription>
            <DialogClose className="button button-primary">Revenir à l’aperçu</DialogClose>
            <DialogClose className="preview-dialog-x" aria-label="Fermer">
              <X size={20} />
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
