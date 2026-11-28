import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type FinalInspection,
  type SettlementReceivables,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';
import { SettlementReceivablesPanel } from './SettlementReceivablesPanel';

const view = {
  contractId: 'contract',
  reference: 'approved-source-v1',
  availableDeposit: '400000',
  offsets: [],
  receivables: [
    {
      charge: { id: 'charge', description: 'Synthetic damage', amount: '600000' },
      allocated: '0',
      outstanding: '600000',
      status: 'Unpaid',
    },
  ],
} as unknown as SettlementReceivables;
function mount(
  observed: Partial<FinalInspection['observed']> = {},
  server: SettlementReceivables = view,
  baseline?: Partial<FinalInspection['observed']>,
) {
  const request = vi.fn<ContractRequest>(
    async <T,>(_path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST') throw { status: 503 };
      return server as T;
    },
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettlementReceivablesPanel
        api={api}
        id="contract"
        inspection={
          {
            id: 'inspection',
            version: 2,
            baseline,
            observed: { assets: [], evidenceIds: ['proof'], ...observed },
          } as unknown as FinalInspection
        }
        summary={
          {
            reference: 'financial-source',
            invoices: [],
            unresolvedItems: ['final_charges_and_damage_policy_pending'],
          } as unknown as SettlementSummary
        }
        saved={vi.fn(async () => {})}
      />
    </QueryClientProvider>,
  );
  return request;
}
it('approves damage above the deposit as a separate receivable and preserves the retry key', async () => {
  const request = mount();
  await screen.findByLabelText('Số tiền phải thu thiệt hại (VND)');
  fireEvent.change(screen.getByLabelText('Số tiền phải thu thiệt hại (VND)'), {
    target: { value: '600000' },
  });
  fireEvent.change(screen.getByLabelText('Mô tả và căn cứ chi phí'), {
    target: { value: 'Synthetic repair cost' },
  });
  fireEvent.click(screen.getByLabelText('Dùng ảnh biên bản 1'));
  const button = screen.getByRole('button', { name: 'Duyệt khoản phải thu thiệt hại' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận thiệt hại, chứng từ và khoản này chưa được tính trên hóa đơn hoặc khoản phải thu khác',
    ),
  );
  fireEvent.click(button);
  await confirmPendingAction();
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
  );
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await confirmPendingAction();
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][0]).toMatch(/\/receivables\/damage$/);
  expect(JSON.parse(posts[0][1]?.body as string)).toMatchObject({
    amount: '600000',
    inspectionId: 'inspection',
    inspectionVersion: 2,
    expectedReference: view.reference,
    evidenceIds: ['proof'],
    humanConfirmed: true,
  });
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
});
it('requires a separate source-specific confirmation for a deposit offset', async () => {
  const request = mount();
  await screen.findByLabelText('Số tiền cấn trừ (VND)');
  fireEvent.mouseDown(screen.getByLabelText('Khoản đích cấn trừ'));
  fireEvent.click(await screen.findByRole('option', { name: /Synthetic damage/ }));
  fireEvent.change(screen.getByLabelText('Số tiền cấn trừ (VND)'), { target: { value: '250000' } });
  fireEvent.change(screen.getByLabelText('Căn cứ duyệt cấn trừ'), {
    target: { value: 'Synthetic deposit source checked' },
  });
  const button = screen.getByRole('button', { name: 'Duyệt cấn trừ' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Tôi xác nhận nguồn cọc, khoản đích và số tiền cấn trừ'));
  fireEvent.click(button);
  await confirmPendingAction();
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([path, init]) => path.endsWith('/receivables/deposit-offsets') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]?.body as string)).toMatchObject({
    amount: '250000',
    receivableId: 'charge',
    invoiceId: null,
    expectedReference: view.reference,
    humanConfirmed: true,
  });
});

it('shows unpaid damage as one existing Tenant receivable instead of a second invoice liability', async () => {
  mount(
    {},
    {
      ...view,
      receivables: [
        {
          charge: {
            id: 'damage-1',
            kind: 'TenantDamage',
            description: 'Giường hỏng',
            amount: '600000',
          },
          allocated: '250000',
          outstanding: '350000',
          status: 'PartiallyPaid',
        },
      ] as SettlementReceivables['receivables'],
    },
  );
  expect(await screen.findByText(/Bồi thường còn phải thu sau các khoản/)).toBeInTheDocument();
  expect(screen.getAllByText(/350.000/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/không lập thêm khoản nợ thứ hai/)).toBeInTheDocument();
});

it('prices only damaged assets or failed room checks, with independent source and matching proof', async () => {
  const request = mount(
    {
      assets: [
        {
          id: 'good-chair',
          name: 'Ghế tốt',
          observedCondition: 'Good',
          missingQuantity: 0,
          damagedQuantity: 0,
        },
        {
          id: 'damaged-bed',
          name: 'Giường hỏng',
          observedCondition: 'Damaged',
          checked: true,
          missingQuantity: 0,
          damagedQuantity: 1,
          evidenceIds: ['bed-photo'],
        },
      ] as FinalInspection['observed']['assets'],
      roomChecks: [
        {
          code: 'walls_ceiling_floor',
          status: 'Issue',
          notes: 'Tường bong tróc',
          evidenceIds: ['wall-photo'],
        },
        { code: 'cleanliness', status: 'Passed', notes: '', evidenceIds: [] },
      ],
    },
    { ...view, roomCheckChargesSupported: true, receivables: [] },
    {
      assets: [
        {
          id: 'good-chair',
          checked: true,
          missingQuantity: 0,
          damagedQuantity: 0,
          handedOverQuantity: 1,
        },
        {
          id: 'damaged-bed',
          checked: true,
          missingQuantity: 0,
          damagedQuantity: 0,
          handedOverQuantity: 1,
        },
      ] as FinalInspection['observed']['assets'],
    },
  );
  await screen.findByText('Tường bong tróc');
  fireEvent.mouseDown(screen.getByLabelText('Nguồn thiệt hại'));
  expect(await screen.findByRole('option', { name: /Giường hỏng/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Ghế tốt/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Tường, trần và sàn/ }));
  expect(screen.getByLabelText('Dùng ảnh biên bản 1')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Số tiền phải thu thiệt hại (VND)'), {
    target: { value: '150000' },
  });
  fireEvent.change(screen.getByLabelText('Mô tả và căn cứ chi phí'), {
    target: { value: 'Tường hỏng, sửa chữa 150000đ' },
  });
  fireEvent.click(screen.getByLabelText('Dùng ảnh biên bản 1'));
  fireEvent.click(screen.getByLabelText(/Tôi xác nhận thiệt hại/));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt khoản phải thu thiệt hại' }));
  await confirmPendingAction();
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([path, init]) => path.endsWith('/receivables/damage') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const post = request.mock.calls.find(
    ([path, init]) => path.endsWith('/receivables/damage') && init?.method === 'POST',
  )!;
  expect(JSON.parse(post[1]?.body as string)).toMatchObject({
    assetId: null,
    roomCheckCode: 'walls_ceiling_floor',
    evidenceIds: ['wall-photo'],
    amount: '150000',
  });
});

it('recognizes an already priced room-check charge by the backend canonical roomCheckCode', async () => {
  mount(
    {
      roomChecks: [
        {
          code: 'walls_ceiling_floor',
          status: 'Issue',
          notes: 'Tường bong tróc',
          evidenceIds: ['wall-photo'],
        },
      ],
    },
    {
      ...view,
      roomCheckChargesSupported: true,
      receivables: [
        {
          charge: {
            id: 'wall-charge',
            kind: 'TenantDamage',
            assetId: null,
            roomCheckCode: 'walls_ceiling_floor',
            sourceKey: 'damage:contract:walls_ceiling_floor',
            description: 'Tường bong tróc',
            amount: '150000',
          },
          allocated: '0',
          outstanding: '150000',
          status: 'Unpaid',
        },
      ] as SettlementReceivables['receivables'],
    },
  );
  expect(await screen.findByText(/Đã duyệt 150.000/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nhập giá' })).not.toBeInTheDocument();
});

it('allows Owner to price missing returned room keys using key-specific photo and access_room_key source', async () => {
  const request = mount(
    {
      accessItems: [{ type: 'RoomKey', quantity: 4, notes: 'Thiếu một chìa khóa' }],
      keyEvidenceIds: ['keys-photo'],
      roomChecks: [{ code: 'walls_ceiling_floor', status: 'Passed', notes: '', evidenceIds: [] }],
    },
    { ...view, roomCheckChargesSupported: true, receivables: [] },
    { accessItems: [{ type: 'RoomKey', quantity: 5, notes: 'Nhận đủ 5 chìa' }] },
  );
  expect(await screen.findByText('Chìa khóa trả thiếu')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nhập giá' }));
  expect(screen.getByLabelText('Mô tả và căn cứ chi phí')).toHaveValue(
    'Bồi thường 1 chìa khóa chưa trả',
  );
  fireEvent.change(screen.getByLabelText('Số tiền phải thu thiệt hại (VND)'), {
    target: { value: '50000' },
  });
  fireEvent.click(screen.getByLabelText('Dùng ảnh biên bản 1'));
  fireEvent.click(screen.getByLabelText(/Tôi xác nhận thiệt hại/));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt khoản phải thu thiệt hại' }));
  await confirmPendingAction();
  const post = request.mock.calls.find(
    ([path, init]) => path.endsWith('/receivables/damage') && init?.method === 'POST',
  );
  expect(post).toBeDefined();
  expect(JSON.parse(post![1]?.body as string)).toMatchObject({
    assetId: null,
    roomCheckCode: 'access_room_key',
    evidenceIds: ['keys-photo'],
    amount: '50000',
  });
});

async function confirmPendingAction() {
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận thực hiện' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
