// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { contractClient, type ContractRequest } from '../../../../packages/client-core/src/contracts';

vi.mock('../lib/randomUUID', () => ({
  randomUUID: () => 'c353627c-64f3-4961-b606-c16455c85369',
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TextInput: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChangeText(event.target.value)} />
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Action: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  ),
  ui: {},
}));
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));

import { TenantMoveOutProposalPanel } from '../features/contracts/TenantMoveOutProposalPanel';

afterEach(cleanup);

const contractId = '7a6c4943-5c80-4757-bc6e-e75dd0d615d8';
const proposalId = '8e00921b-cc9f-4d46-9192-4fecc963bdf3';
const proposalPath = `/api/v1/contracts/${contractId}/move-out/receivables/proposal`;

function proposal(status: 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated' = 'PendingTenant') {
  return {
    contractId,
    reference: 'inspect-source-v3',
    inspectionId: '1e795e2b-e1c2-49f4-b6aa-c999397d49d9',
    inspectionVersion: 3,
    verifiedDeposit: '3000000',
    availableDeposit: '2800000',
    existingOutstanding: '200000',
    status,
    items: [{ kind: 'RoomCheck', roomCheckCode: 'Wall', label: 'Tường phòng', baseline: 'Tốt', observed: 'Trầy xước', evidenceIds: [] }],
    latestProposal: {
      id: proposalId,
      items: [{ kind: 'RoomCheck', roomCheckCode: 'Wall', amount: '3500000', reason: 'Sơn lại khu vực bị trầy' }],
      verifiedDeposit: '3000000',
      availableDeposit: '2800000',
      existingOutstanding: '200000',
      totalCharges: '3500000',
      signedBalance: '-900000',
      note: 'Đã đối chiếu hiện trạng',
      tenantFeedback: status === 'PendingTenant' ? null : { proposalId, confirmed: status === 'Accepted', reason: '' },
    },
  };
}

it('Tenant sees itemized charges, signs off only after reviewing and sends idempotent proposal feedback', async () => {
  let status: 'PendingTenant' | 'Accepted' = 'PendingTenant';
  const sent: { path: string; init: RequestInit | undefined }[] = [];
  const request = vi.fn<ContractRequest>(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (path === proposalPath) return proposal(status) as T;
    if (path === `${proposalPath}/tenant-feedback`) {
      sent.push({ path, init });
      status = 'Accepted';
      return { id: 'feedback' } as T;
    }
    throw new Error(`Unexpected API: ${path}`);
  });
  const api = contractClient(<T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>);
  const changed = vi.fn();
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);

  expect(await screen.findByText('Tường phòng')).toBeTruthy();
  expect(screen.getByText('Lý do thu: Sơn lại khu vực bị trầy')).toBeTruthy();
  expect(screen.getByText(/−900.000/)).toBeTruthy();
  expect(screen.getByText(/Khoản phải thu hiện có còn nợ:/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý với đề xuất' }));
  expect((screen.getByRole('button', { name: 'Gửi xác nhận đồng ý' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Tôi đã xem và đồng ý/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi xác nhận đồng ý' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(sent).toHaveLength(1);
  expect(sent[0].init?.headers).toEqual({ 'Idempotency-Key': 'c353627c-64f3-4961-b606-c16455c85369' });
  expect(JSON.parse(String(sent[0].init?.body))).toEqual({
    proposalId, expectedReference: 'inspect-source-v3', confirmed: true, reason: '',
  });
  expect(await screen.findByText('Bạn đã đồng ý')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
});

it('Outdated proposal cannot be accepted, and disputing an active proposal requires a reason', async () => {
  const sent: string[] = [];
  let state: 'Outdated' | 'PendingTenant' = 'Outdated';
  const api = contractClient(<T,>(path: string, init?: RequestInit) => {
    if (path === proposalPath) return Promise.resolve(proposal(state) as T);
    if (path.endsWith('/tenant-feedback')) { sent.push(String(init?.body)); return Promise.resolve({} as T); }
    throw new Error('Unexpected request');
  });
  const { rerender } = render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  expect(await screen.findByText(/Thông tin kiểm tra hoặc các khoản thu đã thay đổi/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();

  state = 'PendingTenant';
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại đề xuất' }));
  expect(await screen.findByText('Chờ bạn phản hồi')).toBeTruthy();
  rerender(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu xem xét lại' }));
  expect((screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu xem xét lại'), { target: { value: 'Số tiền chưa phù hợp với tình trạng thực tế.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(JSON.parse(sent[0])).toMatchObject({ proposalId, confirmed: false, reason: 'Số tiền chưa phù hợp với tình trạng thực tế.' });
});
