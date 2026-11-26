import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MainContractSettings } from '../../../../../packages/client-core/src/mainDrafts';
import { MainDraftSettingsPanel } from './MainDraftSettingsPanel';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  setSettings: vi.fn(),
  navigate: vi.fn(),
  auth: {
    session: { userId: 'owner' },
    client: { session: null, clear: vi.fn(), refresh: vi.fn() },
  },
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../../../packages/client-core/src/mainDrafts', () => ({
  mainDraftClient: () => mocks,
}));
vi.mock('react-router', async () => ({
  ...(await vi.importActual('react-router')),
  useNavigate: () => mocks.navigate,
}));
vi.mock('./useContractsApi', () => ({ useContractsApi: () => ({}) }));
vi.mock('./ContractWorkflowPanel', () => ({
  ContractConfigurationPanel: () => <div>Thông tin mẫu và quy trình ký</div>,
}));
const settings: MainContractSettings = {
  ownerSignerId: 'owner',
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  paymentTerms: 'Chuyển khoản',
  additionalTerms: '',
  version: 2,
  owner: {
    fullName: 'Owner tổng hợp',
    dateOfBirth: '1990-01-01',
    citizenNumber: '000000000001',
    dateOfIssue: '2020-01-01',
    placeOfIssue: 'Cơ quan tổng hợp',
    address: 'Địa chỉ tổng hợp',
    phone: '+84900000000',
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue(settings);
  mocks.setSettings.mockResolvedValue(undefined);
});
it('loads Owner-wide settings without a Location selector or editable deposit amount', async () => {
  render(<MainDraftSettingsPanel />);
  expect(await screen.findByDisplayValue('Owner tổng hợp')).toBeVisible();
  expect(mocks.settings).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByText('01 tháng tiền thuê phòng')).toBeVisible();
  expect(screen.queryByLabelText(/Tiền cọc đảm bảo/)).not.toBeInTheDocument();
});
it('saves the Owner-wide configuration without a client-supplied deposit amount', async () => {
  render(<MainDraftSettingsPanel />);
  await screen.findByDisplayValue('Owner tổng hợp');
  fireEvent.change(screen.getByDisplayValue('Chuyển khoản'), {
    target: { value: 'Chuyển khoản hàng tháng' },
  });
  fireEvent.submit(document.getElementById('main-contract-settings')!);
  await screen.findByText('Đã lưu cấu hình dùng chung cho tất cả cơ sở.');
  expect(mocks.setSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerSignerId: 'owner',
      expectedVersion: 2,
      paymentTerms: 'Chuyển khoản hàng tháng',
    }),
  );
  expect(mocks.setSettings.mock.calls[0][0]).not.toHaveProperty('securityDeposit');
  expect(mocks.settings).toHaveBeenCalledTimes(2);
});
it('disables save if initial Owner-wide settings cannot be loaded', async () => {
  mocks.settings.mockRejectedValueOnce({ status: 503 });
  render(<MainDraftSettingsPanel />);
  await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/);
  expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
