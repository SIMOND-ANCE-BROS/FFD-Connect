import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AppLayout } from './AppLayout';

describe('AppLayout', () => {
  it('lists the sections of the back-office, without a "new user" shortcut', () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/users" element={<p>content</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Journal d'audit" })).toBeInTheDocument();
    expect(screen.queryByText('Nouvel utilisateur')).toBeNull();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
