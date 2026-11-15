// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
import { ContractSigningPanel } from '../features/contracts/ContractSigningPanel';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, View: () => null, Pressable: () => null, TextInput: () => null }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Checkbox: { Item: ({ onPress, label }: { onPress: () => void; label: string }) => <button role="checkbox" onClick={onPress}>{label}</button> },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {}, Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>, Pill: () => null,
  Action: ({ children, disabled, onPress }: { children: React.ReactNode; disabled: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{children}</button>,
}));
vi.mock('../components/WorkflowControls', () => ({ ChoiceField: () => null }));
vi.mock('../features/contracts/SignaturePad', () => ({ SignaturePad: () => null }));
vi.mock('../features/contracts/SigningSetup', () => ({ SignaturePlacementField: () => <div>Reviewed PDF</div>, SignatureImageSection: () => null }));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
afterEach(cleanup);

it.each(['Holding', 'Main'])('%s Owner signs without requesting OTP, including a pending old OTP', async (kind) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const transport = vi.fn().mockResolvedValue({ status: 'Signed', method: 'OWNER_SESSION' });
  const changed = vi.fn();
  render(<ContractSigningPanel api={contractClient(transport)} actorId={id} contract={{
    id, kind, ownerSignerId: id, status: 'PendingSigning', signatures: [{ id, signerUserId: id, status: 'Pending', method: 'OTP' }],
  } as ContractView} methods={{ methods: ['OWNER_SESSION'], default: 'OWNER_SESSION' }} onChanged={changed} />);
  const button = screen.getByRole('button', { name: 'Ký hợp đồng' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(transport).toHaveBeenCalledOnce();
  expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({ method: 'OWNER_SESSION', consent: true });
});
