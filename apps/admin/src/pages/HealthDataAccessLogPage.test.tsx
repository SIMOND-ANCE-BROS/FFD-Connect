import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { columnFilterButton, openColumnFilter } from '../test/dataTable';
import { renderWithProviders, setupUser } from '../test/render';
import { mockPhoneViewport } from '../test/viewport';
import { HealthDataAccessLogPage } from './HealthDataAccessLogPage';

const SUBJECT = '4f1c2a8e-1b2c-4d5e-8f90-123456789abc';
const ADMIN = '9a8b7c6d-1b2c-4d5e-8f90-abcdefabcdef';
const GONE = '11111111-1b2c-4d5e-8f90-abcdefabcdef';

const entries = [
  {
    id: 'h1',
    subjectUserId: SUBJECT,
    actorUserId: ADMIN,
    actorRole: 'ADMIN',
    action: 'READ',
    resourceType: 'LICENSE_RENEWAL_REQUEST',
    resourceId: 'r1',
    route: 'GET /admin/license-renewals/:id',
    createdAt: '2026-10-07T10:00:00.000Z',
  },
  {
    id: 'h2',
    subjectUserId: GONE,
    actorUserId: null,
    actorRole: 'SYSTEM',
    action: 'DELETE',
    resourceType: 'MEDICAL_CERTIFICATE',
    resourceId: 'd1',
    route: 'job:health-data-retention',
    createdAt: '2026-10-06T03:00:00.000Z',
  },
];

const NAMES: Record<string, [string, string]> = {
  [SUBJECT]: ['Eva', 'Martin'],
  [ADMIN]: ['Gabin', 'Simond'],
};

function mockApi(total = entries.length) {
  const list = vi.spyOn(sdk, 'healthDataAccessLogControllerList').mockResolvedValue({
    data: { data: entries, meta: { total, skip: 0, take: 25, hasMore: total > 25 } },
    error: undefined,
  } as never);
  const getUser = vi.spyOn(sdk, 'adminControllerGetUser').mockImplementation((({
    path,
  }: {
    path: { id: string };
  }) => {
    const name = NAMES[path.id];
    return Promise.resolve(
      name
        ? { data: { id: path.id, firstName: name[0], lastName: name[1] }, error: undefined }
        : { data: undefined, error: { statusCode: 404, message: 'Utilisateur introuvable' } },
    );
  }) as never);
  return { list, getUser };
}

function Probe() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

function renderPage(route = '/health-data-access-log') {
  return renderWithProviders(
    <>
      <HealthDataAccessLogPage />
      <Probe />
    </>,
    { route },
  );
}

describe('HealthDataAccessLogPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists accesses with names resolved on the admin side, and a deleted account', async () => {
    const { list, getUser } = mockApi();
    renderPage();
    const subject = await screen.findByRole('link', { name: 'Eva Martin' });
    expect(subject).toHaveAttribute('href', `/users/${SUBJECT}`);
    expect(await screen.findByRole('link', { name: 'Gabin Simond' })).toHaveAttribute(
      'href',
      `/users/${ADMIN}`,
    );
    expect(await screen.findByText('Compte supprimé')).toBeInTheDocument();
    expect(screen.getByText('Système')).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Back-office : fiche de renouvellement')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ query: { skip: 0, take: 25 } });
    // One read per distinct account, never one for the system actor.
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it('applies the person filter from the URL and shows it as a removable chip', async () => {
    const { list } = mockApi();
    const user = setupUser();
    renderPage(`/health-data-access-log?subject=${SUBJECT}&page=2`);
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({
        query: { subjectUserId: SUBJECT, skip: 25, take: 25 },
      }),
    );
    const remove = await screen.findByRole('button', {
      name: 'Retirer le filtre : Personne concernée : Eva Martin',
    });
    expect(columnFilterButton('Personne concernée')).toHaveAccessibleName(
      'Filtrer : Personne concernée (filtre actif)',
    );
    await user.click(remove);
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^$/));
  });

  it('filters on an action from the column header', async () => {
    const { list } = mockApi();
    const user = setupUser();
    renderPage();
    await screen.findByRole('link', { name: 'Eva Martin' });
    await openColumnFilter(user, 'Action');
    await user.click(screen.getByRole('radio', { name: 'Export' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?action=EXPORT'));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { action: 'EXPORT', skip: 0, take: 25 } }),
    );
  });

  it('picks the author by name, searched on the server', async () => {
    mockApi();
    const search = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
      data: {
        data: [{ id: ADMIN, firstName: 'Gabin', lastName: 'Simond', email: 'g@x.fr' }],
        meta: { total: 1, skip: 0, take: 10, hasMore: false },
      },
      error: undefined,
    } as never);
    const user = setupUser();
    renderPage();
    await screen.findByRole('link', { name: 'Eva Martin' });
    await openColumnFilter(user, 'Auteur');
    await user.type(screen.getByRole('textbox', { name: 'Auteur' }), 'gab');
    const option = await screen.findByRole('option', { name: /Gabin Simond/, hidden: true });
    expect(search).toHaveBeenCalledWith({ query: { search: 'gab', take: 10 } });
    await user.click(option);
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(`?actor=${ADMIN}`));
  });

  it('shows cards linking to the person on a phone', async () => {
    mockPhoneViewport();
    mockApi();
    renderPage();
    const card = await screen.findByRole('link', { name: /Eva Martin/ });
    expect(card).toHaveAttribute('href', `/users/${SUBJECT}`);
    expect(await screen.findByText(/Gabin Simond \(Administrateur\)/)).toBeInTheDocument();
  });

  it('says so when the journal is empty', async () => {
    vi.spyOn(sdk, 'healthDataAccessLogControllerList').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 25, hasMore: false } },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByText('Journal vide')).toBeInTheDocument();
  });
});
