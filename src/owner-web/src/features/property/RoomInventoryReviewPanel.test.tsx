import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { RoomInventoryReviewPanel } from './RoomInventoryReviewPanel';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));

type Evidence = { id: string; contentType: string; uploadedAt: string; uploadedBy: string };
type ReviewItem = {
  id: string;
  name: string;
  category: string;
  unit: string | null;
  quantity: number;
  checked: boolean;
  evidence: Evidence[];
  referenceUnitCost?: string | null;
  acquisitionUnitCost?: string | null;
};
type ReviewRoom = {
  roomId: string;
  roomNumber: string;
  desiredId: string | null;
  desiredVersion: number;
  stateToken: string;
  items: ReviewItem[];
  state: 'NotChecked' | 'PartiallyChecked' | 'Matched' | 'NeedsReview';
  checkedCount: number;
  totalCount: number;
  unlinkedAssetCount: number;
  blockedReason: string | null;
  reviewedAt: string | null;
};
type ReviewResponse = { rooms: ReviewRoom[] };
type ConfirmInput = {
  requestId: string;
  confirmed: true;
  rooms: {
    roomId: string;
    desiredId: string | null;
    desiredVersion: number;
    stateToken: string;
    items: { itemId: string; checked: boolean; evidenceIds: string[]; unitCost?: string | null }[];
  }[];
};

const room = (id: string, roomNumber: string, itemIds: string[]): ReviewRoom => ({
  roomId: id,
  roomNumber,
  desiredId: `desired-${id}`,
  desiredVersion: 3,
  stateToken: `hash-${id}`,
  items: itemIds.map((itemId, index) => ({
    id: itemId,
    name: index ? 'Đèn bàn' : 'Ghế',
    category: 'Nội thất',
    unit: 'Cái',
    quantity: index ? 2 : 4,
    checked: false,
    referenceUnitCost: index ? null : '1200000',
    evidence: [],
  })),
  state: 'NotChecked',
  checkedCount: 0,
  totalCount: itemIds.length,
  unlinkedAssetCount: 0,
  blockedReason: null,
  reviewedAt: null,
});
const fixture = (): ReviewResponse => ({
  rooms: [
    room('a', 'P.101', ['chair-a', 'lamp-a']),
    room('b', 'P.102', ['chair-b']),
    {
      ...room('c', 'P.103', []),
      desiredId: null,
      desiredVersion: 0,
      state: 'NeedsReview',
      blockedReason: 'no_asset_requirements',
    },
  ],
});
let result: ReviewResponse;
let writes: ConfirmInput[];
let uploads: { path: string; init?: RequestInit }[];
let failNextConfirm: boolean;

beforeEach(() => {
  state.roles = ['Owner'];
  result = fixture();
  writes = [];
  uploads = [];
  failNextConfirm = false;
  state.request.mockReset();
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/setup-evidence')) {
      uploads.push({ path, init });
      return {
        objectKey: 'setup/location/evidence/synthetic',
        evidenceId: `evidence-${uploads.length}`,
      };
    }
    if (path.endsWith('/room-inventory-review/confirm') && init?.method === 'POST') {
      const input: ConfirmInput = JSON.parse(String(init.body));
      writes.push(input);
      if (failNextConfirm) {
        failNextConfirm = false;
        throw new Error('Network lost');
      }
      result = {
        rooms: result.rooms.map((current) => {
          const submitted = input.rooms.find((row) => row.roomId === current.roomId);
          if (!submitted) return current;
          const items = current.items.map((item) => {
            const confirmation = submitted.items.find((row) => row.itemId === item.id)!;
            return {
              ...item,
              checked: confirmation.checked,
              evidence: confirmation.evidenceIds.map((id) => ({
                id,
                contentType: 'image/png',
                uploadedAt: '2026-11-15T10:00:00Z',
                uploadedBy: 'owner',
              })),
            };
          });
          const checkedCount = items.filter((item) => item.checked).length;
          return {
            ...current,
            items,
            checkedCount,
            state: checkedCount === items.length ? 'Matched' : 'PartiallyChecked',
            stateToken: 'updated-state-token',
            reviewedAt: '2026-11-15T10:00:00Z',
          };
        }),
      };
      return result;
    }
    if (path.endsWith('/room-inventory-review')) return result;
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RoomInventoryReviewPanel locationId="location" />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function checkAndUpload(
  dialog: ReturnType<typeof within>,
  itemId: string,
  itemName: string,
  roomNumber: string,
  fileName: string,
) {
  fireEvent.click(
    dialog.getByLabelText(`Đã kiểm tra và đủ theo thiết lập · ${itemName} (${roomNumber})`),
  );
  const file = new File(['evidence'], fileName, { type: 'image/png' });
  fireEvent.change(dialog.getByLabelText(`Ảnh bằng chứng ${itemId}`), {
    target: { files: [file] },
  });
  await dialog.findByText(fileName);
}

it.each([
  { selected: false, button: 'Kiểm kê nhanh toàn cơ sở', roomIds: ['a', 'b'] },
  { selected: true, button: 'Kiểm kê nhanh 1 phòng đã chọn', roomIds: ['a'] },
])(
  'requires explicit attestation for $button without evidence',
  async ({ selected, button, roomIds }) => {
    mount();
    await screen.findByText('0/3 nhóm tài sản đã xác nhận');
    if (selected) fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn phòng P.101' }));
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: button }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(selected ? 'P.101' : 'P.101, P.102')).toBeVisible();
    expect(dialog.queryByText(/P\.103/)).toBeNull();
    expect(dialog.queryByLabelText(/Ảnh bằng chứng/)).toBeNull();
    const submit = dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' });
    expect(submit).toBeDisabled();
    fireEvent.click(dialog.getByRole('checkbox', { name: /Tôi đã kiểm tra/ }));
    expect(writes).toHaveLength(0);
    fireEvent.click(submit);
    await screen.findByText(`${roomIds.length}/3 phòng đã kiểm kê đủ`);
    expect(writes).toHaveLength(1);
    expect(writes[0].rooms.map((room) => room.roomId)).toEqual(roomIds);
    expect(
      writes[0].rooms
        .flatMap((room) => room.items)
        .every((item) => item.checked && item.evidenceIds.length === 0),
    ).toBe(true);
    expect(uploads).toHaveLength(0);
  },
);

it('saves a room with only some groups confirmed', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm kê P.101' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('0/2 nhóm đã kiểm tra')).toBeVisible();
  expect(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' })).toBeEnabled();
  fireEvent.click(dialog.getByLabelText('Đã kiểm tra và đủ theo thiết lập · Ghế (P.101)'));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' }));
  await screen.findByText('Đã lưu xác nhận kiểm kê.');
  expect(writes[0].rooms[0].items.map((item) => item.checked)).toEqual([true, false]);
  expect(writes[0].rooms[0].items.map((item) => item.evidenceIds)).toEqual([[], []]);
  expect(writes[0].rooms[0].items.map((item) => item.unitCost)).toEqual(['1200000', null]);
});

it('lets Owner override default per-unit acquisition cost without entering quantity or condition', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm kê P.101' }));
  const dialog = within(screen.getByRole('dialog'));
  const price = dialog.getByLabelText('Đơn giá mua (VNĐ) · Ghế (P.101)');
  expect(price).toHaveValue('1.200.000');
  expect(dialog.queryByRole('spinbutton')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByLabelText('Đã kiểm tra và đủ theo thiết lập · Ghế (P.101)'));
  fireEvent.change(price, { target: { value: '3.000.000' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' }));
  await screen.findByText('Đã lưu xác nhận kiểm kê.');
  expect(writes[0].rooms[0].items[0].unitCost).toBe('3000000');
  expect(writes[0].rooms[0].items[1].unitCost).toBeNull();
});

it('rejects more than five photos for one group before uploading', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm kê P.101' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByLabelText('Đã kiểm tra và đủ theo thiết lập · Ghế (P.101)'));
  fireEvent.change(dialog.getByLabelText('Ảnh bằng chứng chair-a'), {
    target: {
      files: Array.from(
        { length: 6 },
        (_, index) => new File(['evidence'], `photo-${index}.png`, { type: 'image/png' }),
      ),
    },
  });
  expect(await dialog.findByText('Mỗi nhóm tài sản chỉ được đính kèm tối đa 5 ảnh.')).toBeVisible();
  expect(uploads).toHaveLength(0);
});

it('retries an uncertain confirmation with the same request ID and exact evidence payload', async () => {
  failNextConfirm = true;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm kê P.101' }));
  const dialog = within(screen.getByRole('dialog'));
  await checkAndUpload(dialog, 'chair-a', 'Ghế', 'P.101', 'chair.png');
  await checkAndUpload(dialog, 'lamp-a', 'Đèn bàn', 'P.101', 'lamp.png');
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' }));
  await dialog.findByRole('alert');
  await waitFor(() =>
    expect(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' })).toBeEnabled(),
  );
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận đã kiểm tra' }));
  await screen.findByText('1/3 phòng đã kiểm kê đủ');
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
});

it('does not expose Owner confirmation to Staff', async () => {
  state.roles = ['Staff'];
  mount();
  expect(await screen.findByText('Chỉ Owner được xác nhận kiểm kê theo thiết lập.')).toBeVisible();
  expect(state.request).not.toHaveBeenCalled();
});
