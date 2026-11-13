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
vi.mock('../../../services/config', () => ({ apiBaseUrl: '' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
  await screen.findByLabelText('Số tháng giữ chỗ');
  expect(
    (screen.getByLabelText('Tiền giữ chỗ bằng bao nhiêu tháng tiền phòng?') as HTMLInputElement)
      .value,
  ).toBe('1');
  fireEvent.change(screen.getByLabelText('Số tháng giữ chỗ'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Tiền giữ chỗ bằng bao nhiêu tháng tiền phòng?'), {
    target: { value: '1.5' },
  });
  fireEvent.change(screen.getByLabelText('Điều khoản giữ chỗ'), {
    target: { value: 'Điều khoản cơ sở A' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình cho cơ sở này' }));
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
    expect((screen.getByLabelText('Số tháng giữ chỗ') as HTMLInputElement).value).toBe(''),
  );
  expect((screen.getByLabelText('Điều khoản giữ chỗ') as HTMLInputElement).value).toBe('');
  expect(
    state.request.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([path]) => path),
  ).toEqual(['/api/v1/contracts/holding-settings/a']);
});
