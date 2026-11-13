import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { contractClient } from '../../../../../packages/client-core/src/contracts';
import type { MainContractSettings } from '../../../../../packages/client-core/src/mainDrafts';
import { MainDraftSettingsPanel } from './MainDraftSettingsPanel';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  setSettings: vi.fn(),
  auth: { session: { userId: 'owner' }, client: {} },
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../../../packages/client-core/src/mainDrafts', () => ({
  mainDraftClient: () => mocks,
}));
const settings: MainContractSettings = {
  ownerSignerId: 'owner',
  effectiveFrom: '2026-11-01',
  effectiveTo: null,
  securityDeposit: '3000000',
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
    phone: '0000000000',
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue(settings);
  mocks.setSettings.mockResolvedValue(undefined);
});
async function open() {
  const api = contractClient(vi.fn());
  api.preparation = vi.fn().mockResolvedValue({
    locations: [
      { id: 'a', label: 'Cơ sở A' },
      { id: 'b', label: 'Cơ sở B' },
    ],
  });
  render(<MainDraftSettingsPanel api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cấu hình bên cho thuê & tiền cọc' }));
  await choose('Cơ sở A');
}
async function choose(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
it('saves the current version and reloads persisted settings before showing success', async () => {
  await open();
  await screen.findByDisplayValue('3.000.000');
  fireEvent.change(screen.getByLabelText(/Tiền cọc đảm bảo/), { target: { value: '4000000' } });
  mocks.settings.mockResolvedValue({ ...settings, version: 3, securityDeposit: '4000000' });
  fireEvent.submit(document.getElementById('main-contract-settings')!);
  await screen.findByText('Đã lưu cấu hình.');
  expect(mocks.setSettings).toHaveBeenCalledWith(
    'a',
    expect.objectContaining({ securityDeposit: '4000000', expectedVersion: 2 }),
  );
  expect(mocks.settings).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText(/Tiền cọc đảm bảo/)).toHaveValue('4.000.000');
});
it('clears old values during location loading and ignores a late response from an aborted request', async () => {
  let finish!: (value: MainContractSettings) => void;
  mocks.settings.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('a', expect.any(AbortSignal)));
  expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
  await choose('Cơ sở B');
  await screen.findByDisplayValue('3.000.000');
  await act(async () => {
    finish({ ...settings, securityDeposit: '9999999' });
  });
  expect(screen.queryByDisplayValue('9.999.999')).not.toBeInTheDocument();
  expect(mocks.settings.mock.calls[0][1].aborted).toBe(true);
});
it('does not offer stale values after a failed reload or report a failed save as successful', async () => {
  await open();
  await screen.findByDisplayValue('3.000.000');
  mocks.setSettings.mockRejectedValue({ status: 409 });
  fireEvent.submit(document.getElementById('main-contract-settings')!);
  await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
  expect(screen.queryByText('Đã lưu cấu hình.')).not.toBeInTheDocument();
  mocks.settings.mockRejectedValue({ status: 503 });
  await choose('Cơ sở B');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled());
  expect(screen.queryByDisplayValue('3.000.000')).not.toBeInTheDocument();
});
