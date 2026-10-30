import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/mobile/src/app/App';

it('renders the Vietnamese application shell', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'BHOME trên thiết bị di động' })).toBeInTheDocument();
});
