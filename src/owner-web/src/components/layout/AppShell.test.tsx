import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import { AppShell } from './AppShell';

const mocks = vi.hoisted(() => ({
  data: undefined as
    { records: { locations: { id: string; code: string; name: string }[] } } | undefined,
  isError: false,
  setLocationId: vi.fn(),
  setSearch: vi.fn(),
}));
vi.mock('../../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
vi.mock('../../app/PortalProvider', () => ({
  usePortal: () => ({
    locationId: 'all',
    search: '',
    setLocationId: mocks.setLocationId,
    setSearch: mocks.setSearch,
  }),
}));
vi.mock('../../hooks/usePortalData', () => ({
  usePortalData: () => ({ data: mocks.data, isError: mocks.isError }),
  usePortalAction: () => ({ isPending: false }),
}));
vi.mock('../../features/notifications/NotificationBell', () => ({ NotificationBell: () => null }));

function CurrentPath() {
  return <h1>{useLocation().pathname}</h1>;
}
function shell(path = '/dashboard') {
  return (
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentPath />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.data = undefined;
  mocks.isError = false;
});

it('preserves named navigation and active state when collapsed, and restores the preference on remount', () => {
  const first = render(shell());
  const toggle = screen.getByRole('button', { name: 'Thu gọn thanh điều hướng' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Mở rộng thanh điều hướng' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  fireEvent.click(within(nav).getByRole('link', { name: 'Cơ sở' }));
  expect(screen.getByRole('heading', { name: '/locations' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Cơ sở' })).toHaveAttribute('aria-current', 'page');
  first.unmount();

  render(shell());
  fireEvent.click(screen.getByRole('button', { name: 'Mở rộng thanh điều hướng' }));
  expect(screen.getByRole('button', { name: 'Thu gọn thanh điều hướng' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

it('keeps the location from the deep link during loading and switches to another location on the same section', () => {
  const { rerender } = render(shell('/locations/loc-1/rooms'));
  const selector = screen.getByRole('combobox', { name: 'Chọn cơ sở' });
  expect(selector).toHaveAttribute('aria-disabled', 'true');
  expect(selector).toHaveTextContent('Đang tải cơ sở');

  mocks.data = {
    records: {
      locations: [
        { id: 'loc-1', code: 'CS-01', name: 'Cơ sở thứ nhất' },
        { id: 'loc-2', code: 'CS-02', name: 'Cơ sở thứ hai' },
      ],
    },
  };
  rerender(shell('/locations/loc-1/rooms'));
  expect(selector).toHaveTextContent('Cơ sở thứ nhất');
  fireEvent.mouseDown(selector);
  fireEvent.click(screen.getByRole('option', { name: 'Cơ sở thứ hai' }));
  expect(mocks.setLocationId).toHaveBeenCalledWith('loc-2');
  expect(screen.getByRole('heading', { name: '/locations/loc-2/rooms' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Chọn cơ sở' })).toHaveTextContent('Cơ sở thứ hai');
});

it('does not show an unrelated selected location if the current location is missing from the list', () => {
  mocks.data = { records: { locations: [{ id: 'loc-2', code: 'CS-02', name: 'Cơ sở thứ hai' }] } };
  render(shell('/locations/loc-1/overview'));
  expect(screen.getByRole('combobox', { name: 'Chọn cơ sở' })).toHaveTextContent('Cơ sở hiện tại');
  expect(mocks.setLocationId).not.toHaveBeenCalled();
});

it('distinguishes a failed location list from a loading request without changing location context', () => {
  mocks.isError = true;
  render(shell('/locations/loc-1/overview'));
  const selector = screen.getByRole('combobox', { name: 'Chọn cơ sở' });
  expect(selector).toHaveAttribute('aria-disabled', 'true');
  expect(selector).toHaveTextContent('Không tải được danh sách cơ sở');
  expect(mocks.setLocationId).not.toHaveBeenCalled();
});
