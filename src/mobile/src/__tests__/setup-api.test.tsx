// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  json: vi.fn(),
  types: [{ id: 'type-1', name: 'Phòng đôi', defaultCapacity: 2 }],
}));
vi.mock('expo-router', () => ({ Redirect: () => null }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: state,
    session: { roles: ['Owner'] },
  }),
}));
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
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  SegmentedButtons: () => null,
}));
vi.mock('../components/Controls', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  styles: {},
  Field: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
  Select: ({
    label,
    items,
    selected,
    onSelect,
  }: {
    label: string;
    items: { id: string; label: string }[];
    selected: string;
    onSelect: (value: string) => void;
  }) => (
    <select aria-label={label} value={selected} onChange={(e) => onSelect(e.target.value)}>
      <option value="" />
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
import Setup from '../app/setup';

beforeEach(() => {
  vi.clearAllMocks();
  state.types = [{ id: 'type-1', name: 'Phòng đôi', defaultCapacity: 2 }];
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/chain') return { id: 'chain-1', name: 'BHOME', version: 7 };
    if (path === '/api/v1/capture/chains') return [{ id: 'chain-1', label: 'BHOME' }];
    if (path === '/api/v1/capture/locations') return [{ id: 'location-1', label: 'Cơ sở mẫu' }];
    if (path.startsWith('/api/v1/room-types?')) return { items: state.types };
    return [];
  });
  state.json.mockResolvedValue({ id: 'created' });
});
afterEach(cleanup);

it('renames the singleton chain using the current backend version and never posts capture/chains', async () => {
  render(<Setup />);
  await screen.findByRole('option', { name: 'BHOME' });
  fireEvent.change(screen.getByLabelText('Tên chuỗi'), { target: { value: 'BHOME mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đổi tên chuỗi' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/chain',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'BHOME mới',
          version: 7,
          reason: 'Cập nhật tên chuỗi từ Mobile',
        }),
      }),
    ),
  );
  expect(state.json).not.toHaveBeenCalled();
});

it('requires an effective room type and sends its id and capacity when creating a room', async () => {
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  fireEvent.change(screen.getByLabelText('Cơ sở thao tác'), { target: { value: 'location-1' } });
  await screen.findByRole('option', { name: 'Phòng đôi' });
  fireEvent.change(screen.getByLabelText('Số phòng'), { target: { value: 'A101' } });
  expect((screen.getByRole('button', { name: 'Tạo phòng' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Loại phòng'), { target: { value: 'type-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phòng' }));
  await waitFor(() =>
    expect(state.json).toHaveBeenCalledWith('/api/v1/capture/rooms', {
      locationId: 'location-1',
      roomTypeId: 'type-1',
      roomNumber: 'A101',
      capacity: 2,
    }),
  );
});
