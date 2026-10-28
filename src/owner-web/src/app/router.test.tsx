import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  fireEvent.change(screen.getByLabelText('Email hoặc Số điện thoại'), {
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
