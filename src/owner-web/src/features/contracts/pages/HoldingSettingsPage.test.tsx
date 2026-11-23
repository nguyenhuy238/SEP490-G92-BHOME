import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import HoldingSettingsPage from './HoldingSettingsPage';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  client: { session: { accessToken: 'synthetic' }, clear: vi.fn(), refresh: vi.fn() },
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ client: state.client }),
}));
vi.mock('../../../../../../packages/client-core/src/api', () => ({
  createApiClient: () => state.request,
}));
vi.mock('../../../services/config', () => ({ apiBaseUrl: '', isMockMode: false }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('keeps unsaved changes on cancellation and previews deposits from the saved version', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations')
      return [
        { id: 'a', label: 'Cơ sở A' },
        { id: 'b', label: 'Cơ sở B' },
      ];
    if (path.includes('/rooms')) return [{ id: 'r1', label: 'Phòng A01' }];
    if (path.includes('/preparation?'))
      return {
        roomNumber: 'A01',
        monthlyRent: '3000000',
        holdingDeposit: '4500000',
        holdingMonths: 2,
        settingsVersion: 3,
      };
    if (path.endsWith('/versions'))
      return [
        { version: 3, holdingMonths: 2, depositRentMonths: '1.5', terms: 'Điều khoản đã lưu' },
      ];
    return { holdingMonths: 2, depositRentMonths: '1.5', terms: 'Điều khoản đã lưu', version: 3 };
  });
  render(<HoldingSettingsPage />);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở áp dụng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở A' }));
  const factor = await screen.findByLabelText(/Hệ số tiền giữ chỗ/);
  fireEvent.change(factor, { target: { value: '2' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở áp dụng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở B' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), {
    timeout: 5000,
  });
  expect(factor).toHaveValue(2);
  fireEvent.click(await screen.findByRole('button', { name: 'Xem theo phòng' }));
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Phòng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Phòng A01' }));
  expect(await screen.findByRole('cell', { name: '1.5' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: 'A01' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử phiên bản' }));
  expect(await screen.findByText('Phiên bản 3')).toBeInTheDocument();
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('saves explicit Holding months and rent multiplier under the selected location only', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/capture/locations')
      return [
        { id: 'a', label: 'Cơ sở A' },
        { id: 'b', label: 'Cơ sở B' },
      ];
    if (path.includes('/rooms')) return [];
    if (init?.method === 'PUT') return undefined;
    return null;
  });
  render(<HoldingSettingsPage />);
  fireEvent.mouseDown(screen.getByLabelText('Cơ sở áp dụng'));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở A' }));
  await screen.findByLabelText(/Thời hạn giữ chỗ/);
  expect((screen.getByLabelText(/Hệ số tiền giữ chỗ/) as HTMLInputElement).value).toBe('1');
  fireEvent.change(screen.getByLabelText(/Thời hạn giữ chỗ/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Hệ số tiền giữ chỗ/), {
    target: { value: '1.5' },
  });
  fireEvent.change(screen.getByLabelText(/Điều khoản giữ chỗ/), {
    target: { value: 'Điều khoản cơ sở A' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/contracts/holding-settings/a',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          holdingMonths: 2,
          depositRentMonths: '1.5',
          terms: 'Điều khoản cơ sở A',
          expectedVersion: 0,
        }),
      }),
    ),
  );
  fireEvent.mouseDown(screen.getByLabelText('Cơ sở áp dụng'));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở B' }));
  await waitFor(() =>
    expect((screen.getByLabelText(/Thời hạn giữ chỗ/) as HTMLInputElement).value).toBe(''),
  );
  expect((screen.getByLabelText(/Điều khoản giữ chỗ/) as HTMLInputElement).value).toBe('');
  expect(
    state.request.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([path]) => path),
  ).toEqual(['/api/v1/contracts/holding-settings/a']);
});
