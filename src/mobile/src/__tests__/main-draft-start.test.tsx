// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContractClient } from '../../../../packages/client-core/src/contracts';
const state = vi.hoisted(() => ({ prepare: vi.fn(), opened: vi.fn() }));
vi.mock('expo-router', () => ({ router: { setParams: vi.fn() } }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({ label, onPress, status }: { label: string; onPress: () => void; status: string }) => (
      <button
        role="checkbox"
        aria-label={label}
        aria-checked={status === 'checked'}
        onClick={onPress}
      >
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" />
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../features/contracts/MainDraftScreen', () => ({
  MainDraftScreen: (props: { onSaved?: (id: string) => void; onCancel: () => void }) => {
    state.opened(props);
    return (
      <>
        <span>Form nháp</span>
        <button onClick={() => props.onSaved?.('saved-draft')}>Test saved</button>
        <button onClick={props.onCancel}>Test close</button>
      </>
    );
  },
}));
import { MainDraftStart } from '../features/contracts/MainDraftStart';
import { router } from 'expo-router';
beforeEach(() => {
  vi.clearAllMocks();
  state.prepare.mockResolvedValue({
    locations: [{ id: 'location', label: 'Cơ sở' }],
    rooms: [
      { id: 'room', label: '101' },
      { id: 'room-2', label: '102' },
    ],
    residents: [
      { id: 'verified', roomId: 'room', label: 'Đã xác minh', verified: true, tenantUserId: null },
      {
        id: 'pending',
        roomId: 'room',
        label: 'Chưa xác minh',
        verified: false,
        tenantUserId: null,
      },
    ],
    ownerSigners: [],
  });
});
afterEach(cleanup);
async function setup() {
  render(
    <MainDraftStart
      api={{ preparation: state.prepare } as unknown as ContractClient}
      onCancel={vi.fn()}
      onList={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Phòng') as HTMLSelectElement).disabled).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Phòng'), { target: { value: 'room' } });
}
it('starts a draft from a verified resident without requiring a Tenant account', async () => {
  await setup();
  expect(screen.queryByRole('checkbox', { name: 'Chưa xác minh' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đã xác minh' }));
  fireEvent.change(screen.getByLabelText('Người đại diện hợp đồng'), {
    target: { value: 'verified' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng nháp' }));
  expect(state.opened).toHaveBeenCalledWith(
    expect.objectContaining({
      roomId: 'room',
      representativeResidentId: 'verified',
      residentIds: ['verified'],
    }),
  );
});
it('clears the old representative and members when changing rooms', async () => {
  await setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đã xác minh' }));
  fireEvent.change(screen.getByLabelText('Người đại diện hợp đồng'), {
    target: { value: 'verified' },
  });
  fireEvent.change(screen.getByLabelText('Phòng'), { target: { value: 'room-2' } });
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng nháp' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(state.opened).not.toHaveBeenCalled();
});
it('reopens the saved draft instead of creating another one after closing the standalone form', async () => {
  await setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đã xác minh' }));
  fireEvent.change(screen.getByLabelText('Người đại diện hợp đồng'), {
    target: { value: 'verified' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng nháp' }));
  fireEvent.click(screen.getByRole('button', { name: 'Test saved' }));
  fireEvent.click(screen.getByRole('button', { name: 'Test close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mở lại hợp đồng nháp' }));
  expect(state.opened).toHaveBeenLastCalledWith(
    expect.objectContaining({ initialId: 'saved-draft', persistRoute: false }),
  );
});
it('keeps independent representatives separate, includes only explicitly selected co-occupants and persists the Owner draft route', async () => {
  state.prepare.mockResolvedValue({
    locations: [{ id: 'location', label: 'Location' }],
    rooms: [{ id: 'room', label: 'Room' }],
    residents: [
      {
        id: 'a',
        roomId: 'room',
        label: 'Individual A',
        verified: true,
        residentType: 'Representative',
      },
      {
        id: 'b',
        roomId: 'room',
        label: 'Individual B',
        verified: true,
        residentType: 'Representative',
      },
      {
        id: 'member',
        roomId: 'room',
        label: 'Confirmed co-occupant',
        verified: true,
        residentType: 'CoOccupant',
      },
    ],
    ownerSigners: [],
  });
  const saved = vi.fn();
  render(
    <MainDraftStart
      owner
      onSaved={saved}
      api={{ preparation: state.prepare } as unknown as ContractClient}
      onCancel={vi.fn()}
      onList={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Phòng') as HTMLSelectElement).disabled).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Phòng'), { target: { value: 'room' } });
  fireEvent.change(screen.getByLabelText('Bên thuê / đại diện đã xác minh'), {
    target: { value: 'a' },
  });
  expect(screen.queryByRole('checkbox', { name: 'Individual B' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmed co-occupant' }));
  fireEvent.change(screen.getByLabelText('Bên thuê / đại diện đã xác minh'), {
    target: { value: 'b' },
  });
  await waitFor(() =>
    expect((screen.getByText('Tiếp tục tạo hợp đồng nháp') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText('Tiếp tục tạo hợp đồng nháp'));
  expect(state.opened).toHaveBeenLastCalledWith(
    expect.objectContaining({ representativeResidentId: 'b', residentIds: ['b'] }),
  );
  fireEvent.click(screen.getByText('Test saved'));
  expect(saved).toHaveBeenCalledWith('saved-draft');
  expect(router.setParams).toHaveBeenCalledWith({
    contractId: 'saved-draft',
    mainDraftId: '',
    roomId: '',
  });
});
