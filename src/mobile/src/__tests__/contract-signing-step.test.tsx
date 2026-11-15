// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
import { ContractSigningStep } from '../features/contracts/ContractSigningStep';

vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../features/contracts/ContractSigningPanel', () => ({
  ContractSigningPanel: () => <span>Real signing panel</span>,
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: () => null,
  SigningCertificates: () => null,
}));
vi.mock('../features/contracts/SigningSetup', () => ({
  SignaturePlacementField: () => <span>PDF preview</span>,
}));
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));
afterEach(cleanup);

const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const tenant = '33333333-3333-4333-8333-333333333333';
function contract(kind: string, internal: boolean, signed = false): ContractView {
  return {
    id,
    kind,
    status: signed ? 'PendingActivation' : 'PendingSigning',
    ownerSignerId: owner,
    tenantUserId: internal ? null : tenant,
    signingMode: internal ? 'INTERNAL_OTP_DRAWN' : '',
    snapshotHash: 'reviewed-hash',
    approvedAt: '2026-11-15T00:00:00Z',
    signatures: signed
      ? [owner, ...(internal ? [] : [tenant])].map((signerUserId, i) => ({
          id: String(i),
          signerUserId,
          status: 'Signed',
          signedAt: '2026-11-15T00:00:00Z',
          method: 'OTP',
        }))
      : [],
    occupants: [],
    isDevelopmentDemo: false,
  } as unknown as ContractView;
}

it.each([
  ['Holding', true],
  ['Main', true],
  ['Holding', false],
  ['Main', false],
] as const)(
  '%s, invitation=%s: only backend-confirmed signatures unlock existing payment navigation',
  async (kind, internal) => {
    let latest = contract(kind, internal);
    let complete = false;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/internal-signing'))
        return {
          invitations: [],
          tenantAcceptedAt: complete ? '2026-11-15T00:00:00Z' : null,
          ownerAcceptedAt: complete ? '2026-11-15T00:00:00Z' : null,
          canContinue: complete,
        };
      if (path.endsWith('/signing-methods')) return { methods: ['OTP'], default: 'OTP' };
      if (path === `/api/v1/contracts/${id}`) return latest;
      throw new Error('Unexpected request: ' + path);
    });
    const next = vi.fn();
    const api = contractClient(request as unknown as Parameters<typeof contractClient>[0]);
    render(
      <ContractSigningStep
        api={api}
        contract={latest}
        actorId={owner}
        role="Owner"
        onChanged={() => {}}
        onContinue={next}
      />,
    );
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(true);
    latest = contract(kind, internal, true);
    complete = true;
    fireEvent.click(screen.getByText('Làm mới trạng thái ký'));
    await waitFor(() =>
      expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(false),
    );
    const before = request.mock.calls.length;
    fireEvent.click(screen.getByText('Tiếp tục thanh toán'));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(request.mock.calls.length).toBeGreaterThan(before);
  },
);

it('restores completed signatures on reopen and refuses navigation when a fresh backend check fails', async () => {
  const c = contract('Main', true, true);
  let offline = false;
  const request = vi.fn(async (path: string) => {
    if (offline) throw new Error('Offline');
    if (path.endsWith('/internal-signing'))
      return {
        invitations: [],
        tenantAcceptedAt: '2026-11-15T00:00:00Z',
        ownerAcceptedAt: '2026-11-15T00:00:00Z',
        canContinue: true,
      };
    if (path.endsWith('/signing-methods')) return { methods: ['OTP'], default: 'OTP' };
    return c;
  });
  const next = vi.fn();
  render(
    <ContractSigningStep
      api={contractClient(request as unknown as Parameters<typeof contractClient>[0])}
      contract={c}
      actorId={owner}
      role="Owner"
      onChanged={() => {}}
      onContinue={next}
    />,
  );
  await waitFor(() =>
    expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(false),
  );
  offline = true;
  fireEvent.click(screen.getByText('Tiếp tục thanh toán'));
  await waitFor(() =>
    expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(true),
  );
  expect(next).not.toHaveBeenCalled();
});
