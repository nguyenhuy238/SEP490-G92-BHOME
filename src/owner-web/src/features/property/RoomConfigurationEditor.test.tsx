import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import type { RoomConfigurationView } from '../../../../../packages/client-core/src/locationSetup';
import { theme } from '../../theme/theme';
import { todayVietnam } from '../staff/staffContracts';
import { RoomConfigurationEditor } from './RoomConfigurationEditor';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));

const item = {
  id: 'item',
  name: 'Giường',
  category: 'Nội thất',
  trackingMode: 'Serialized' as const,
  quantity: 1,
};
const view: RoomConfigurationView = {
  room: {
    id: 'room',
    locationId: 'location',
    roomNumber: 'A101',
    floor: '1',
    capacity: 2,
    status: 0,
    version: 7,
  },
  provenance: {
    id: 'provenance',
    locationId: 'location',
    kind: 'RoomProvenance',
    status: 'Recorded',
    version: 4,
    data: {
      roomId: 'room',
      roomDefaultsId: 'type',
      roomDefaultsVersion: 3,
      name: 'Studio',
      area: 25,
      amenities: ['Ban công'],
      defaultCapacity: 2,
      referenceRent: '3000000',
    },
  },
  canEdit: true,
  lockReason: null,
  scheduledRent: null,
  rent: {
    id: 'rent',
    locationId: 'location',
    roomId: 'room',
    category: 0,
    chargeCode: 'RENT',
    name: 'Giá thuê',
    method: 0,
    rate: '3000000',
    effectiveFrom: todayVietnam(),
    effectiveTo: null,
    version: 5,
  },
  inventory: {
    physical: [],
    desired: [
      {
        id: 'desired',
        locationId: 'location',
        kind: 'DesiredAssets',
        status: 'PendingVerification',
        version: 1,
        data: {
          roomId: 'room',
          templateId: 'template',
          templateVersion: 1,
          items: [item],
          status: 'PendingVerification',
        },
      },
    ],
    currentDesiredId: 'desired',
    assignmentVersion: 3,
    assignedTemplateId: 'template',
  },
};
const path = '/api/v1/locations/location/rooms/room/configuration';
const defaults = [
  {
    id: 'type',
    locationId: 'location',
    kind: 'RoomDefaults',
    status: 'Recorded',
    version: 3,
    data: {
      name: 'Studio',
      defaults: { capacity: 2, area: 25, amenities: ['Ban công'], referenceRent: '3000000' },
    },
  },
];

beforeEach(() => {
  state.request.mockReset();
  state.request.mockImplementation(async (url: string) =>
    url.endsWith('/room-defaults') ? defaults : view,
  );
});
afterEach(cleanup);
function mount() {
  const saved = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RoomConfigurationEditor
          locationId="location"
          roomId="room"
          close={vi.fn()}
          saved={saved}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return saved;
}

it('saves room details, exact rent and edited requirements atomically with loaded versions', async () => {
  const saved = mount();
  const money = await screen.findByLabelText('Giá thuê (VND/tháng)');
  expect(money).toHaveValue('3.000.000');
  fireEvent.change(money, { target: { value: '4500000' } });
  expect(money).toHaveValue('4.500.000');
  fireEvent.change(screen.getByLabelText(/Sức chứa/), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Diện tích (m²)'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText(/Số lượng 1/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), {
    target: { value: 'Cập nhật phòng' },
  });
  const date = screen.getByLabelText('Ngày hiệu lực giá mới') as HTMLInputElement;
  expect(date.value > todayVietnam()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const writes = state.request.mock.calls.filter(([, init]) => init?.method);
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(path);
  expect(writes[0][1].method).toBe('PUT');
  expect(JSON.parse(writes[0][1].body)).toEqual({
    roomNumber: 'A101',
    floor: '1',
    capacity: 3,
    status: 0,
    expectedVersion: 7,
    expectedProvenanceVersion: 4,
    area: 30,
    amenities: ['Ban công'],
    reason: 'Cập nhật phòng',
    rent: {
      rate: '4500000',
      effectiveFrom: date.value,
      expectedPolicyId: 'rent',
      expectedPolicyVersion: 5,
    },
    assets: { items: [{ ...item, quantity: 2 }], expectedAssignmentVersion: 3 },
  });
});

it('does not replace unchanged rent or assets when editing room metadata', async () => {
  const saved = mount();
  fireEvent.change(await screen.findByLabelText(/Số phòng/), { target: { value: 'A102' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Đổi số phòng' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const [, init] = state.request.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  const input = JSON.parse(init.body);
  expect(input.roomNumber).toBe('A102');
  expect(input).not.toHaveProperty('rent');
  expect(input).not.toHaveProperty('assets');
});

it('locks all editing and sends no mutation when the server reports a binding contract', async () => {
  state.request.mockImplementation(async (url: string) =>
    url.endsWith('/room-defaults')
      ? defaults
      : { ...view, canEdit: false, lockReason: 'room_configuration_locked_by_contract' },
  );
  mount();
  await screen.findByText(/Phòng đang có hợp đồng chưa kết thúc/);
  expect(screen.getByLabelText(/Số phòng/)).toBeDisabled();
  expect(screen.getByLabelText('Giá thuê (VND/tháng)')).toBeDisabled();
  expect(screen.getByLabelText(/Số lượng 1/)).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Lưu cấu hình' })).not.toBeInTheDocument();
  expect(state.request.mock.calls.some(([, init]) => init?.method)).toBe(false);
});

it('keeps edits on a stale response until the Owner explicitly reloads', async () => {
  let version = 7;
  state.request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/room-defaults')) return defaults;
    if (init?.method === 'PUT') {
      version = 8;
      throw new ApiError(409, { code: 'stale_version' });
    }
    return {
      ...view,
      room: { ...view.room, version, roomNumber: version === 7 ? 'A101' : 'A103' },
    };
  });
  const saved = mount();
  fireEvent.change(await screen.findByLabelText(/Số phòng/), { target: { value: 'A102' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Đổi số phòng' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  const reload = await screen.findByRole('button', { name: 'Bỏ bản nhập & tải bản mới' });
  expect(screen.getByLabelText(/Số phòng/)).toHaveValue('A102');
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(reload);
  await waitFor(() => expect(screen.getByLabelText(/Số phòng/)).toHaveValue('A103'));
});
