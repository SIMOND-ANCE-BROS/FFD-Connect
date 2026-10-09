import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { ChangeSummary } from './ChangeSummary';

describe('ChangeSummary', () => {
  it('renders a single Club row with names when the audit carries clubId and clubName', () => {
    render(
      <MantineProvider>
        <ChangeSummary
          before={{ clubId: '11111111-aaaa', clubName: 'Club A' }}
          after={{ clubId: '22222222-bbbb', clubName: 'Club B' }}
        />
      </MantineProvider>,
    );
    expect(screen.getAllByText('Club')).toHaveLength(1);
    expect(screen.getByText('Club A')).toBeInTheDocument();
    expect(screen.getByText('Club B')).toBeInTheDocument();
    expect(screen.queryByText(/11111111|22222222/)).not.toBeInTheDocument();
  });

  it('labels club fields and shows registration modes and roles in French', () => {
    render(
      <MantineProvider>
        <ChangeSummary
          before={{ name: 'Club A', registrationMode: 'CLUB_ONLY', role: 'LICENSEE' }}
          after={{ name: 'Club Z', registrationMode: 'MEMBERS_AUTO_CONFIRM', role: 'STAFF' }}
        />
      </MantineProvider>,
    );
    expect(screen.getByText('Nom du club')).toBeInTheDocument();
    expect(screen.getByText("Mode d'inscription")).toBeInTheDocument();
    expect(screen.getByText('Le club seul inscrit ses licenciés')).toBeInTheDocument();
    expect(screen.getByText('Licenciés, validation automatique')).toBeInTheDocument();
    expect(screen.getByText('Licencié')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
  });

  it('labels track fields and shows clashes as m:ss', () => {
    render(
      <MantineProvider>
        <ChangeSummary
          before={{ bpm: 60, clashTimecodes: [40, 80], style: 'Paso Doble' }}
          after={{ bpm: 62, clashTimecodes: [], style: 'Rumba' }}
        />
      </MantineProvider>,
    );
    expect(screen.getByText('MPM')).toBeInTheDocument();
    expect(screen.getByText('Clashes paso')).toBeInTheDocument();
    expect(screen.getByText('Danse')).toBeInTheDocument();
    expect(screen.getByText('0:40, 1:20')).toBeInTheDocument();
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
  });

  it('labels the track moderation flags, the status and the source, booleans in French', () => {
    render(
      <MantineProvider>
        <ChangeSummary
          before={{ titleMasked: false, blacklisted: true, status: 'ERROR', sourceKey: null }}
          after={{ titleMasked: true, blacklisted: false, status: 'READY', sourceKey: 'apple:1' }}
        />
      </MantineProvider>,
    );
    expect(screen.getByText('Titre masqué')).toBeInTheDocument();
    expect(screen.getByText('Blacklistée')).toBeInTheDocument();
    expect(screen.getByText('Statut')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getAllByText('Oui')).toHaveLength(2);
    expect(screen.getAllByText('Non')).toHaveLength(2);
    expect(screen.getByText('En erreur')).toBeInTheDocument();
    expect(screen.getByText('Prête')).toBeInTheDocument();
    expect(screen.getByText('apple:1')).toBeInTheDocument();
  });
});
