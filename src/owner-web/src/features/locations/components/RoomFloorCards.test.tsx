import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../../packages/client-core/src/propertySetup';
import { RoomFloorCards } from './RoomFloorCards';
import { RoomInspector } from './RoomInspector';
import { readRoomOperationsPages } from './useRoomOperations';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const room = {
  id: 'room',
  locationId: 'location',
  roomNumber: 'P101',
  floor: '1',
  capacity: 3,
  status: 2,
  version: 7,
  roomTypeId: 'type',
};
const occupants = [
  { residentId: 'resident1', displayLabel: 'Người tổng hợp 1', role: 'Representative' },
  { residentId: 'resident2', displayLabel: 'Người tổng hợp 2', role: 'CoOccupant' },
];
beforeEach(() => {
  state.request.mockReset();
  state.request.mockImplementation(async (path: string) => {
    if (path.includes('/occupancy?'))
      return {
        items: [{ roomId: room.id, locationId: room.locationId, occupants }],
        totalCount: 1,
      };
    if (path.includes('/incidents?'))
      return {
        items: path.includes('status=0')
          ? [
              {
                id: 'incident',
                roomId: room.id,
                code: 'INC-SYNTHETIC',
                description: 'Sự cố tổng hợp',
                status: 'Submitted',
                severity: 'Emergency',
              },
            ]
          : [],
        totalCount: path.includes('status=0') ? 1 : 0,
      };
    if (path.includes('/prices?'))
      return { charges: [{ category: 0, rate: '3500000' }], missingRequiredCharges: [] };
    return room;
  });
});
afterEach(cleanup);
function mount(children: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}
it('shows server occupants and open emergency reports and wires the room view/edit actions', async () => {
  const inspect = vi.fn(),
    edit = vi.fn();
  mount(
    <RoomFloorCards locationId="location" rooms={[room]} total={1} inspect={inspect} edit={edit} />,
  );
  await screen.findByText('2/3');
  await screen.findByText(/Có sự cố khẩn cấp · 1 đang mở/);
  fireEvent.click(screen.getByRole('button', { name: 'Xem phòng P101' }));
  expect(inspect).toHaveBeenCalledWith('room');
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
  expect(edit).toHaveBeenCalledWith(room);
  expect(
    state.request.mock.calls.every(
      ([path]) => !path.includes('locationId=') || path.includes('locationId=location'),
    ),
  ).toBe(true);
});
it('never represents failed occupancy/incident reads as zero people or no incidents', async () => {
  state.request.mockRejectedValue(new Error('Synthetic failure'));
  mount(<RoomFloorCards locationId="location" rooms={[room]} total={1} inspect={vi.fn()} />);
  await screen.findByText(/Chưa tải được số người ở/);
  await screen.findByText(/Chưa tải được báo cáo sự cố/);
  expect(screen.getByText('—/3')).toBeInTheDocument();
  expect(screen.queryByText('0/3')).toBeNull();
  expect(screen.queryByText('Không có báo cáo sự cố đang mở')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
});
it('follows server pagination for operation data and marks bounded results incomplete', async () => {
  const request = vi.fn().mockResolvedValue({
    items: Array.from({ length: 100 }, (_, id) => ({ id })),
    totalCount: 1001,
  });
  const result = await readRoomOperationsPages(
    request,
    '/api/v1/incidents?locationId=location',
    new AbortController().signal,
  );
  expect(request).toHaveBeenCalledTimes(10);
  expect(result.complete).toBe(false);
  expect(result.items).toHaveLength(1000);
});
it('opens current room data with an edit callback using the detail version, plus its scoped incident link', async () => {
  const edit = vi.fn();
  mount(<RoomInspector roomId="room" close={vi.fn()} edit={edit} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa phòng' }));
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: 'room', version: 7 }));
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Xem báo cáo' })).toHaveAttribute(
      'href',
      '/incidents?incidentId=incident',
    ),
  );
  expect(screen.getByText(/3.500.000 đ/)).toBeInTheDocument();
});
