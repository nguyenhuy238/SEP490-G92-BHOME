import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/owner-web/src/app/App';

it('returns an unauthenticated dashboard visitor to the public startup page', () => {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Chào mừng đến với BHOME' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Bảng điều khiển' })).not.toBeInTheDocument();
});
