import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/public-web/src/app/App';

it('renders the Vietnamese application shell', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'Tìm hiểu không gian sống cùng BHOME' }),
  ).toBeInTheDocument();
});
