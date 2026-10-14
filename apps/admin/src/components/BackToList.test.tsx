import { screen } from '@testing-library/react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { useListParams } from '../lib/useListParams';
import { readUsersParams, writeUsersParams } from '../lib/userList';
import { renderWithProviders, setupUser } from '../test/render';
import { BackToList } from './BackToList';

function List() {
  const [state, update] = useListParams(readUsersParams, writeUsersParams);
  const { search } = useLocation();
  return (
    <>
      <p data-testid="list">{search}</p>
      <button type="button" onClick={() => update({ page: state.page + 1 })}>
        Page suivante
      </button>
      <Link to="/users/u1">Ouvrir</Link>
    </>
  );
}

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/users" element={<List />} />
      <Route path="/users/:id" element={<BackToList listPath="/users" />} />
      <Route
        path="/moderation/:id"
        element={<BackToList listPath="/moderation" search="?status=REJECTED" />}
      />
    </Routes>,
    { route },
  );
}

describe('BackToList (#562)', () => {
  it('goes back to the list with its filters, sort and page as left', async () => {
    const user = setupUser();
    renderApp('/users?f.role=in:CLUB&sort=name&order=desc');
    await user.click(screen.getByRole('button', { name: 'Page suivante' }));
    await user.click(screen.getByRole('link', { name: 'Ouvrir' }));
    const back = screen.getByRole('link', { name: 'Retour à la liste' });
    expect(back).toHaveAttribute('href', '/users?f.role=in%3ACLUB&sort=name&order=desc&page=2');
    await user.click(back);
    expect(screen.getByTestId('list')).toHaveTextContent(
      '?f.role=in%3ACLUB&sort=name&order=desc&page=2',
    );
  });

  it('falls back to the plain list in a tab opened on the record', () => {
    renderApp('/users/u1');
    expect(screen.getByRole('link', { name: 'Retour à la liste' })).toHaveAttribute(
      'href',
      '/users',
    );
  });

  it('prefers the list query carried by the record URL', () => {
    renderApp('/moderation/c1');
    expect(screen.getByRole('link', { name: 'Retour à la liste' })).toHaveAttribute(
      'href',
      '/moderation?status=REJECTED',
    );
  });
});
