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

it('shows one global policy with fixed holding terms and no location selector', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/contracts/holding-settings')
      return {
        ownerUserId: 'owner',
        holdingMonths: 1,
        depositRentMonths: '1',
        terms: 'Điều khoản hiện hành',
        version: 2,
        updatedAt: '2026-11-25T00:00:00Z',
        updatedByUserId: 'owner',
      };
    if (path.endsWith('/versions')) return [];
    return undefined;
  });
  render(<HoldingSettingsPage />);
  expect(
    await screen.findByText(
      'Áp dụng thống nhất cho tất cả cơ sở hiện tại và cơ sở tạo mới thuộc Owner này.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('1 tháng dương lịch')).toBeInTheDocument();
  expect(screen.getByText('Bằng 1 tháng tiền thuê')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/contracts/holding-settings',
    expect.anything(),
  );
});

it('requires confirmation and saves only edited terms to the global endpoint', async () => {
  const current = {
    ownerUserId: 'owner',
    holdingMonths: 1,
    depositRentMonths: '1',
    terms: 'Điều khoản cũ',
    version: 2,
    updatedAt: '2026-11-25T00:00:00Z',
    updatedByUserId: 'owner',
  };
  const next = { ...current, terms: 'Điều khoản mới', version: 3 };
  let saved = false;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/contracts/holding-settings' && init?.method === 'PUT') {
      saved = true;
      return undefined;
    }
    if (path === '/api/v1/contracts/holding-settings') return saved ? next : current;
    if (path.endsWith('/versions')) return [next, current];
    return undefined;
  });
  render(<HoldingSettingsPage />);
  const field = await screen.findByRole('textbox', { name: 'Điều khoản giữ chỗ' });
  fireEvent.change(field, { target: { value: 'Điều khoản mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'Hợp đồng và cấu hình lịch sử hiện có được giữ nguyên.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/contracts/holding-settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ terms: 'Điều khoản mới', expectedVersion: 2 }),
      }),
    ),
  );
  expect(await screen.findByText('Đã lưu chính sách giữ chỗ toàn hệ thống.')).toBeInTheDocument();
});
