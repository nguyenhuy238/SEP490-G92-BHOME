import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicRoomsWorkspace } from './PublicRoomsWorkspace';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const a = {
  roomId: 'room-a',
  roomNumber: 'A1',
  version: 3,
  description: '',
  amenities: [],
  indicativePrice: null,
  photos: [],
  published: false,
  publicationStatus: 'Draft',
};
const b = {
  roomId: 'room-b',
  roomNumber: 'B2',
  version: 6,
  description: 'Mô tả phòng nguồn',
  amenities: ['Wifi'],
  indicativePrice: 2000000,
  photos: [{ index: 0 }],
  published: true,
  publicationStatus: 'Published',
};
const defaults = [
  {
    id: 'defaults-a',
    version: 4,
    status: 'Recorded',
    data: {
      name: 'Loại Studio',
      description: 'Mô tả tham khảo',
      defaults: { capacity: 2, area: 22, amenities: ['Wifi'], referenceRent: 2200000 },
    },
  },
];
const preview = {
  previewHash: 'synthetic-preview',
  rooms: [
    {
      roomId: 'room-a',
      roomNumber: 'A1',
      currentVersion: 3,
      status: 'Ready',
      issue: null,
      changes: [
        { field: 'description', oldValue: '', newValue: 'Mô tả tham khảo', conflict: false },
      ],
    },
  ],
};
function show() {
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/rooms/bulk/preview')) return preview;
    if (path.endsWith('/rooms/bulk/apply'))
      return {
        rooms: preview.rooms.map((r) => ({ ...r, status: 'Applied' })),
      };
    if (path.endsWith('/room-defaults')) return defaults;
    if (path.endsWith('/rooms')) return [a, b];
    throw new Error(`unexpected request: ${path}`);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <PublicRoomsWorkspace location="location" onEdit={vi.fn()} />
    </QueryClientProvider>,
  );
}
async function selectOption(label: string, name: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('previews room-default changes and requires explicit approval to apply without publishing', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('Chọn phòng A1'));
  await selectOption('Loại phòng', 'Loại Studio');
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước thay đổi' }));
  await screen.findByText('Mô tả tham khảo');
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/apply'))).toHaveLength(0);
  const sent = mocks.request.mock.calls.find(([path]) => path.endsWith('/preview'));
  expect(JSON.parse(sent![1].body)).toMatchObject({
    mode: 'RoomDefaults',
    sourceId: 'defaults-a',
    sourceVersion: 4,
    fillEmptyOnly: true,
    targets: [{ roomId: 'room-a', expectedVersion: 3 }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận áp dụng thay đổi' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(true),
  );
  const apply = mocks.request.mock.calls.find(([path]) => path.endsWith('/apply'));
  expect(JSON.parse(apply![1].body).previewHash).toBe('synthetic-preview');
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/publish'))).toBe(false);
  expect(await screen.findByText(/Đã áp dụng 1 phòng/)).toBeVisible();
  expect(
    within(screen.getByRole('table', { name: 'Kết quả xử lý từng phòng' })).getByText('Đã áp dụng'),
  ).toBeVisible();
});

it('copies only selected fields from another room and shows the overwrite warning', async () => {
  show();
  fireEvent.click(await screen.findByLabelText('Chọn phòng A1'));
  await selectOption('Cách áp dụng', 'Sao chép từ phòng khác');
  await selectOption('Phòng nguồn', 'Phòng B2');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Giá tham khảo' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tiện nghi' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chỉ điền những trường còn trống' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước thay đổi' }));
  await screen.findByRole('table', { name: 'Xem trước thay đổi hàng loạt' });
  const sent = mocks.request.mock.calls.find(([path]) => path.endsWith('/preview'));
  expect(JSON.parse(sent![1].body)).toMatchObject({
    mode: 'Room',
    sourceId: 'room-b',
    sourceVersion: 6,
    fields: ['description'],
    fillEmptyOnly: false,
  });
  expect(
    within(screen.getByRole('table', { name: 'Xem trước thay đổi hàng loạt' })).getByText(
      'Mô tả tham khảo',
    ),
  ).toBeVisible();
});
