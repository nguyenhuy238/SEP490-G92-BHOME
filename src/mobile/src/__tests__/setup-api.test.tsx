// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  json: vi.fn(),
  roles: ['Owner'],
}));
vi.mock('expo-router', () => ({ Redirect: () => null }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: state,
    session: { roles: state.roles },
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
import { MobileApiError } from '../lib/api';
import { roomSetupInput } from '../services/setup';

beforeEach(() => {
  vi.clearAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [{ id: 'location-1', label: 'Cơ sở mẫu' }];
    return [];
  });
  state.json.mockResolvedValue({ id: 'created' });
});
afterEach(cleanup);

it('loads current Locations without any obsolete Chain or RoomType request', async () => {
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  expect(state.request.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/capture/locations',
    '/api/v1/capture/staff',
  ]);
  expect(screen.queryByLabelText('Tên chuỗi')).toBeNull();
  expect(state.json).not.toHaveBeenCalled();
});

it('creates a Room directly under Location with an explicit validated capacity', async () => {
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  fireEvent.change(screen.getByLabelText('Cơ sở thao tác'), { target: { value: 'location-1' } });
  fireEvent.change(screen.getByLabelText('Số phòng'), { target: { value: 'A101' } });
  expect((screen.getByRole('button', { name: 'Tạo phòng' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('Sức chứa của phòng'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phòng' }));
  await waitFor(() =>
    expect(state.json).toHaveBeenCalledWith('/api/v1/rooms', {
      locationId: 'location-1',
      roomNumber: 'A101',
      capacity: 2,
    }),
  );
  expect(state.request.mock.calls.some(([path]) => /chains|room-types|\/chain$/.test(path))).toBe(
    false,
  );
  await screen.findByText('Máy chủ đã lưu thành công.');
});

it('creates a Location using the strict native DTO', async () => {
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  fireEvent.change(screen.getByLabelText('Tên cơ sở'), { target: { value: ' Cơ sở mới ' } });
  fireEvent.change(screen.getByLabelText('Địa chỉ cơ sở'), { target: { value: ' Địa chỉ mẫu ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo cơ sở' }));
  await waitFor(() =>
    expect(state.json).toHaveBeenCalledWith('/api/v1/locations', {
      name: 'Cơ sở mới',
      address: 'Địa chỉ mẫu',
    }),
  );
});

it('keeps Locations visible when Staff loading fails and supports retry', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/staff')) throw new MobileApiError(403);
    return [{ id: 'location-1', label: 'Cơ sở mẫu' }];
  });
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  await screen.findByText(/không được phép/i);
  state.request.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText(/Chưa có cơ sở/);
});

it('does not report persistence success after a rejected write', async () => {
  state.json.mockRejectedValue(new MobileApiError(400, 'invalid_input'));
  render(<Setup />);
  await screen.findByRole('option', { name: 'Cơ sở mẫu' });
  fireEvent.change(screen.getByLabelText('Tên cơ sở'), { target: { value: 'Cơ sở mới' } });
  fireEvent.change(screen.getByLabelText('Địa chỉ cơ sở'), { target: { value: 'Địa chỉ mẫu' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo cơ sở' }));
  await screen.findByText(/Kiểm tra các ô bắt buộc/);
  expect(screen.queryByText('Máy chủ đã lưu thành công.')).toBeNull();
});

it('does not load or offer configuration mutations to Staff', async () => {
  state.roles = ['Staff'];
  render(<Setup />);
  await screen.findByText('Chỉ Owner quản lý cấu hình và phân công.');
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Tạo cơ sở' })).toBeNull();
});

it('rejects invalid room capacities before request serialization', () => {
  for (const capacity of ['', '0', '-1', '1.5', '32768', 'NaN'])
    expect(() => roomSetupInput('location-1', 'A101', capacity)).toThrow();
  expect(() => roomSetupInput('', 'A101', '2')).toThrow();
});
