import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material';
import { AuthProvider } from '../../../../packages/client-core/src/auth';
import { PortalProvider } from './PortalProvider';
import { AppRouter } from './router';
import { portalRoutes } from './routePaths';
import { demoAuth, DEMO_USER, DEMO_PASSWORD } from '../services/demoAuth';
import { theme } from '../theme/theme';
vi.mock('../services/config', () => ({ isMockMode: true }));
// jsdom has no physical chart/grid layout; behavioral smoke tests do not assert pixels.
vi.mock('recharts', async () => {
  const real = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...real,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});
beforeAll(async () => {
  await demoAuth.login(DEMO_USER, DEMO_PASSWORD);
});
beforeEach(() => localStorage.clear());
it('protects deep links and returns to the requested screen after demo login', async () => {
  await demoAuth.logout();
  render(
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <PortalProvider>
          <MemoryRouter initialEntries={['/invoices']}>
            <AppRouter />
          </MemoryRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Đăng nhập tài khoản' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: DEMO_USER },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: DEMO_PASSWORD } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
  expect(
    await screen.findByRole(
      'heading',
      { name: 'Quản lý hóa đơn tiền phòng & dịch vụ' },
      { timeout: 12000 },
    ),
  ).toBeInTheDocument();
}, 15000);
it.each(portalRoutes)(
  'renders independent route %s without API calls',
  async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ThemeProvider theme={theme}>
        <AuthProvider>
          <PortalProvider>
            <MemoryRouter initialEntries={[path]}>
              <AppRouter />
            </MemoryRouter>
          </PortalProvider>
        </AuthProvider>
      </ThemeProvider>,
    );
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: 12000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  },
  15000,
);

it('renders the investment child route inside a Location Workspace', async () => {
  render(
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <PortalProvider>
          <MemoryRouter initialEntries={['/locations/loc-1/investment']}>
            <AppRouter />
          </MemoryRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
  expect(
    await screen.findByRole('heading', { name: 'Đầu tư ban đầu & Chi phí' }, { timeout: 10000 }),
  ).toBeInTheDocument();
}, 15000);

it('keeps property functions inside the selected Location Workspace', async () => {
  render(
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <PortalProvider>
          <MemoryRouter initialEntries={['/locations']}>
            <AppRouter />
          </MemoryRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>,
  );

  const navigation = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
  // One accessibility-tree scan per group avoids repeating expensive jsdom visibility/name
  // calculations. Keep exact accessible names, uniqueness and absent-link assertions.
  const expectedLinks: Record<string, string> = {
    '/locations': 'Cơ sở',
    '/configuration/room-types': 'Mẫu loại phòng',
    '/configuration/assets': 'Danh mục tài sản',
  };
  const propertyLinks = within(navigation).getAllByRole('link', {
    name: /^(Cơ sở|Mẫu loại phòng|Danh mục tài sản)$/,
  });
  expect(propertyLinks.map((link) => link.getAttribute('href')).sort()).toEqual(
    Object.keys(expectedLinks).sort(),
  );
  propertyLinks.forEach((link) =>
    expect(link).toHaveAccessibleName(expectedLinks[link.getAttribute('href')!]),
  );
  expect(
    within(navigation).queryByRole('link', {
      name: /^(Phòng|Loại phòng|Tài sản|Giá thuê & Biểu phí)$/,
    }),
  ).not.toBeInTheDocument();
  // Select the exact anchor text before checking semantics/visibility, rather than
  // computing accessible names for every unrelated link in the page.
  const locationLinks = await screen.findAllByText('Xem cơ sở', { selector: 'a', exact: true });
  locationLinks.forEach((link) => {
    expect(link).toHaveRole('link');
    expect(link).toHaveAccessibleName('Xem cơ sở');
    expect(link).toBeVisible();
  });
  expect(locationLinks[0]).toHaveAttribute('href', '/locations/loc-1/overview');
  fireEvent.click(locationLinks[0]);
  expect(
    await screen.findByRole(
      'heading',
      { level: 1, name: 'BHOME Central 1 - Bạch Đằng' },
      { timeout: 12000 },
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Phòng & Sơ đồ tầng' })).toHaveAttribute(
    'href',
    '/locations/loc-1/rooms',
  );
  expect(screen.getByRole('tab', { name: 'Vốn & Chi phí' })).toHaveAttribute(
    'href',
    '/locations/loc-1/investment',
  );
  expect(screen.getByRole('heading', { name: 'Không gian phòng theo tầng' })).toBeInTheDocument();
  expect(document.querySelector('a[href="/rooms/room-0"]')).toBeInTheDocument();
  expect(document.querySelector('a[href="/rooms/room-25"]')).not.toBeInTheDocument();
}, 15000);

it('isolates the room space by Location route context', async () => {
  render(
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <PortalProvider>
          <MemoryRouter initialEntries={['/locations/loc-2/overview']}>
            <AppRouter />
          </MemoryRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>,
  );

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'BHOME Riverside 2 - Phan Xích Long',
    }),
  ).toBeInTheDocument();
  expect(document.querySelector('a[href="/rooms/room-25"]')).toBeInTheDocument();
  expect(document.querySelector('a[href="/rooms/room-0"]')).not.toBeInTheDocument();
}, 15000);
