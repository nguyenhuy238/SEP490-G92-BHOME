import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/owner-web/src/app/App';

it('renders the Vietnamese application shell', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Chào mừng đến với BHOME' })).toBeInTheDocument();
});
