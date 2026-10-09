import { sitePath } from '../lib/ffd';

import { useRef } from 'react';
import { CalendarDays, MapPin, User, Clock } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

export function CompetitionDetail({
  event,
}: {
  event: { title: string; city: string; date: string; status: string };
}) {
  const program = useRef<HTMLDivElement>(null);
  return (
    <div className="native-detail">
      <p className="native-detail-label">COMPÉTITION FICTIVE · APERÇU</p>
      <div className="native-info-card">
        {[
          { Icon: CalendarDays, label: 'Date', value: event.date },
          { Icon: MapPin, label: 'Lieu', value: 'Complexe sportif · ' + event.city },
          { Icon: User, label: 'Organisateur', value: 'Danse Club Démo' },
        ].map(({ Icon, label, value }) => (
          <div className="native-info-row" key={label}>
            <Icon size={20} />
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      <button
        className="native-program-jump"
        onClick={() => {
          program.current?.focus();
          program.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }}
      >
        Consulter le programme <Clock size={16} />
      </button>
      <div
        className="native-program-anchor"
        tabIndex={-1}
        ref={program}
        role="group"
        aria-label={'Programme et timing de ' + event.title}
      >
        <Tabs defaultValue="events" className="native-detail-tabs">
          <TabsList aria-label="Programme de la compétition">
            <TabsTrigger value="events">Épreuves</TabsTrigger>
            <TabsTrigger value="timing">Timing</TabsTrigger>
          </TabsList>
          <TabsContent value="events">
            <section className="native-program-card">
              <h5>Programme des épreuves</h5>
              <span className="native-badge">Standards & Latines</span>
              <p>
                Une journée de danse sportive, avec des épreuves en couple pour les catégories
                adultes et seniors.
              </p>
              <p>
                Standards le matin, latines l’après-midi. Le programme ci-dessous illustre le
                parcours dans l’application.
              </p>
              <div className="native-demo-schedule">
                <strong>Matin · Standards</strong>
                <span>Valse lente · Tango · Valse viennoise · Slow fox · Quickstep</span>
                <strong>Après-midi · Latines</strong>
                <span>Samba · Cha-cha-cha · Rumba · Paso doble · Jive</span>
              </div>
              <p className="native-example-note">Programme d’exemple, sans inscription réelle.</p>
            </section>
            <a
              className="native-detail-guide"
              href={sitePath('documentation/architecture/modules/competitions')}
            >
              Comprendre le module compétitions ↗
            </a>
          </TabsContent>
          <TabsContent value="timing">
            <section className="native-program-card">
              <h5>Timing de la journée</h5>
              <p className="native-example-note">Horaires fictifs · Aucune donnée en direct</p>
              <ol className="native-timing">
                {[
                  ['08:30', 'Accueil des participants', 'Retrait des dossards'],
                  ['09:30', 'Épreuves Standards', 'Premiers tours · Adultes'],
                  ['11:30', 'Épreuves Standards', 'Finales · Seniors'],
                  ['12:30', 'Pause', 'Reprise à 14 h'],
                  ['14:00', 'Épreuves Latines', 'Premiers tours · Adultes'],
                  ['17:00', 'Finales & remise des prix', 'Fin de journée'],
                ].map(([time, title, sub]) => (
                  <li key={time}>
                    <time>{time}</time>
                    <div>
                      <strong>{title}</strong>
                      <small>{sub}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
