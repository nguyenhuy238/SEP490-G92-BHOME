import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { CommonAssetInventoryReviewPanel } from './CommonAssetInventoryReviewPanel';

const context = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: context.roles } }),
}));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => context.request(path, init) as Promise<T>,
    ),
}));

type Item = {
  id: string;
  name: string;
  category: string;
  commonArea: string;
  unit: string;
  quantity: number;
  checked: boolean;
  blockedReason: string | null;
  evidence: { id: string; contentType: string; uploadedAt: string; uploadedBy: string }[];
  referenceUnitCost?: string | null;
  acquisitionUnitCost?: string | null;
};
type View = {
  requirementsId: string;
  requirementsVersion: number;
  stateToken: string;
  state: 'NotChecked' | 'PartiallyChecked' | 'Matched' | 'NeedsReview';
  checkedCount: number;
  totalCount: number;
  reviewedAt: string | null;
  items: Item[];
};
type Confirm = {
  requestId: string;
  requirementsId: string;
  requirementsVersion: number;
  stateToken: string;
  confirmed: true;
  items: { itemId: string; checked: boolean; evidenceIds: string[]; unitCost?: string | null }[];
};

let view: View;
let confirms: Confirm[];
let evidenceUploads: number;
let failNext: boolean;

beforeEach(() => {
  context.roles = ['Owner'];
  view = {
    requirementsId: 'configuration',
    requirementsVersion: 3,
    stateToken: 'initial',
    state: 'NotChecked',
    checkedCount: 0,
    totalCount: 2,
    reviewedAt: null,
    items: [
      {
        id: 'camera',
        name: 'Camera',
        category: 'Điện tử',
        commonArea: 'Hành lang',
        unit: 'Cái',
        quantity: 2,
        checked: false,
        blockedReason: null,
        evidence: [],
        referenceUnitCost: '1500000',
      },
      {
        id: 'broom',
        name: 'Chổi',
        category: 'Vệ sinh',
        commonArea: 'Sân',
        unit: 'Cái',
        quantity: 3,
        checked: false,
        blockedReason: null,
        evidence: [],
      },
    ],
  };
  confirms = [];
  evidenceUploads = 0;
  failNext = false;
  context.request.mockReset();
  context.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/setup-evidence')) {
      evidenceUploads++;
      return { evidenceId: `photo-${evidenceUploads}` };
    }
    if (path.endsWith('/common-asset-inventory-review/confirm')) {
      const input: Confirm = JSON.parse(String(init?.body));
      confirms.push(input);
      if (failNext) {
        failNext = false;
        throw new Error('Connection interrupted');
      }
      view = {
        ...view,
        stateToken: 'updated',
        reviewedAt: '2026-11-15T10:00:00Z',
        items: view.items.map((item) => ({
          ...item,
          checked: input.items.find((entry) => entry.itemId === item.id)!.checked,
        })),
        checkedCount: input.items.filter((item) => item.checked).length,
        state: input.items.every((item) => item.checked) ? 'Matched' : 'PartiallyChecked',
      };
      return view;
    }
    if (path.endsWith('/common-asset-inventory-review')) return view;
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

const mount = () =>
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CommonAssetInventoryReviewPanel locationId="location" />
      </QueryClientProvider>
    </ThemeProvider>,
  );

it('requires Owner confirmation before bulk review and saves configured quantities without quantity inputs', async () => {
  mount();
  await screen.findByText('0/2 nhóm tài sản đã kiểm kê đủ');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm kê nhanh tài sản chung' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('2 Cái')).toBeVisible();
  expect(dialog.getByText('3 Cái')).toBeVisible();
  expect(dialog.queryByRole('spinbutton')).not.toBeInTheDocument();
  const submit = dialog.getByRole('button', { name: 'Xác nhận kiểm kê' });
  expect(submit).toBeDisabled();
  fireEvent.click(dialog.getByRole('checkbox', { name: /Tôi đã trực tiếp kiểm tra/ }));
  fireEvent.click(submit);
  await screen.findByText('2/2 nhóm tài sản đã kiểm kê đủ');
  expect(confirms).toHaveLength(1);
  expect(confirms[0].items).toEqual([
    { itemId: 'camera', checked: true, evidenceIds: [], unitCost: '1500000' },
    { itemId: 'broom', checked: true, evidenceIds: [], unitCost: null },
  ]);
});

it('allows Owner to override the catalog reference cost before confirmation and keeps unknown distinct from free', async () => {
  mount();
  await screen.findByText('0/2 nhóm tài sản đã kiểm kê đủ');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm kê nhanh tài sản chung' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByLabelText('Đơn giá mua (VNĐ) · Camera')).toHaveValue('1.500.000');
  expect(dialog.getByLabelText('Đơn giá mua (VNĐ) · Chổi')).toHaveValue('');
  fireEvent.change(dialog.getByLabelText('Đơn giá mua (VNĐ) · Camera'), {
    target: { value: '2.750.000' },
  });
  fireEvent.change(dialog.getByLabelText('Đơn giá mua (VNĐ) · Chổi'), { target: { value: '0' } });
  fireEvent.click(dialog.getByRole('checkbox', { name: /Tôi đã trực tiếp kiểm tra/ }));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận kiểm kê' }));
  await screen.findByText('2/2 nhóm tài sản đã kiểm kê đủ');
  expect(confirms[0].items.map((item) => item.unitCost)).toEqual(['2750000', '0']);
});

it('saves partial review, including zero confirmed assets', async () => {
  mount();
  await screen.findByText('0/2 nhóm tài sản đã kiểm kê đủ');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra từng tài sản' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getAllByRole('checkbox', { name: 'Đã kiểm tra và đủ' })[0]);
  fireEvent.click(dialog.getByRole('checkbox', { name: /Tôi đã trực tiếp kiểm tra/ }));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận kiểm kê' }));
  await screen.findByText('1/2 nhóm tài sản đã kiểm kê đủ');
  expect(confirms[0].items.map((item) => item.checked)).toEqual([true, false]);

  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra từng tài sản' }));
  const second = within(screen.getByRole('dialog'));
  fireEvent.click(second.getAllByRole('checkbox', { name: 'Đã kiểm tra và đủ' })[0]);
  fireEvent.click(second.getByRole('checkbox', { name: /Tôi đã trực tiếp kiểm tra/ }));
  fireEvent.click(second.getByRole('button', { name: 'Xác nhận kiểm kê' }));
  await screen.findByText('0/2 nhóm tài sản đã kiểm kê đủ');
  expect(confirms[1].items.every((item) => !item.checked)).toBe(true);
});

it('rejects more than five photos before uploading and retries the exact command after network failure', async () => {
  failNext = true;
  mount();
  await screen.findByText('0/2 nhóm tài sản đã kiểm kê đủ');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra từng tài sản' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getAllByRole('checkbox', { name: 'Đã kiểm tra và đủ' })[0]);
  const files = Array.from(
    { length: 6 },
    (_, index) => new File(['abc'], `${index}.jpg`, { type: 'image/jpeg' }),
  );
  fireEvent.change(dialog.getByLabelText('Ảnh bằng chứng Camera'), { target: { files } });
  expect(dialog.getByText('Mỗi nhóm tài sản chỉ được đính kèm tối đa 5 ảnh.')).toBeVisible();
  expect(evidenceUploads).toBe(0);
  fireEvent.click(dialog.getByRole('checkbox', { name: /Tôi đã trực tiếp kiểm tra/ }));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận kiểm kê' }));
  await waitFor(() => expect(confirms).toHaveLength(1));
  await waitFor(() => expect(dialog.getByRole('alert')).toBeVisible());
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận kiểm kê' }));
  await screen.findByText('1/2 nhóm tài sản đã kiểm kê đủ');
  expect(confirms).toHaveLength(2);
  expect(confirms[0]).toEqual(confirms[1]);
});

it('blocks review for Staff', () => {
  context.roles = ['Staff'];
  mount();
  expect(screen.getByText('Chỉ Owner được xác nhận kiểm kê tài sản chung.')).toBeVisible();
  expect(context.request).not.toHaveBeenCalled();
});
