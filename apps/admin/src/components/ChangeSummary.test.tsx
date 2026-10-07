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
});
