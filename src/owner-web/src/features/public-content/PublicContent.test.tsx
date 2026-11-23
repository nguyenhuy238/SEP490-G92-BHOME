import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentRecord } from './PublicContentApiPage';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const baseContent = {
  locationId: 'location',
  name: 'Synthetic location',
  address: 'Synthetic address',
  summary: 'Approved summary',
  amenities: ['Wifi'],
  contactPhone: null,
  contactEmail: 'public@example.invalid',
  photos: [],
  published: true,
  publishedAt: '2026-11-22T00:00:00Z',
};
function editor() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContentRecord target="locations" id="location" />
    </QueryClientProvider>,
  );
}

it('allows republishing a saved published draft and marks preview as private', async () => {
  mocks.request.mockResolvedValue(baseContent);
  editor();
  expect(await screen.findByRole('button', { name: 'Xuất bản nội dung đã lưu' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước nội dung' }));
  expect(screen.getByText('Bản xem trước — Chưa công khai')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Bản xem trước' })).getByText('Approved summary'),
  ).toBeVisible();
  expect(
    mocks.request.mock.calls.every(([path]) => path.startsWith('/api/v1/public-content/')),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Giới thiệu công khai'), {
    target: { value: 'Unsaved draft' },
  });
  expect(screen.getByRole('button', { name: 'Xuất bản nội dung đã lưu' })).toBeDisabled();
});

it('validates contact email and retains text after a failed save for retry', async () => {
  mocks.request.mockImplementation(async (_, init) => {
    if (init?.method === 'PUT') throw { status: 503 };
    return baseContent;
  });
  editor();
  fireEvent.change(await screen.findByLabelText('Email liên hệ tĩnh'), {
    target: { value: 'invalid' },
  });
  expect(screen.getByRole('button', { name: 'Lưu bản nháp' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Email liên hệ tĩnh'), {
    target: { value: 'next@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Giới thiệu công khai'), {
    target: { value: 'Retained draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
  );
  expect(screen.getByLabelText('Giới thiệu công khai')).toHaveValue('Retained draft');
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('preserves unsaved drafts when selecting another record and returning', async () => {
  mocks.request.mockImplementation(async (path) => ({
    ...baseContent,
    locationId: path.endsWith('/other') ? 'other' : 'location',
    name: path.endsWith('/other') ? 'Other location' : baseContent.name,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const drafts = new Map();
  const view = (id: string) => (
    <QueryClientProvider client={client}>
      <ContentRecord key={id} target="locations" id={id} drafts={drafts} />
    </QueryClientProvider>
  );
  const rendered = render(view('location'));
  fireEvent.change(await screen.findByLabelText('Giới thiệu công khai'), {
    target: { value: 'Keep my draft' },
  });
  rendered.rerender(view('other'));
  await screen.findByText('Other location');
  rendered.rerender(view('location'));
  expect(await screen.findByLabelText('Giới thiệu công khai')).toHaveValue('Keep my draft');
});

it('uploads only validated images and confirms deletion using stable server indices', async () => {
  const OriginalURL = URL;
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL() {
        return 'blob:synthetic';
      }
      static revokeObjectURL() {}
    },
  );
  let content = {
    ...baseContent,
    photos: [] as { index: number; url: string; contentType: string; length: number }[],
  };
  mocks.request.mockImplementation(async (path, init) => {
    if (init?.method === 'PUT' && path.endsWith('/photos'))
      content = {
        ...content,
        photos: [{ index: 8, url: 'approved-photo', contentType: 'image/png', length: 4 }],
      };
    if (init?.method === 'DELETE') content = { ...content, photos: [] };
    if (!init?.method && path.endsWith('/photos/8')) return new Blob(['test']);
    return content;
  });
  editor();
  await screen.findByLabelText('Giới thiệu công khai');
  fireEvent.change(screen.getByLabelText('Ảnh công khai mới'), {
    target: { files: [new File(['test'], 'photo.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh được phép công khai' }));
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await screen.findByRole('button', { name: 'Xóa ảnh 9' });
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh 9' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path, init]) => path.endsWith('/photos/8') && init?.method === 'DELETE',
      ),
    ).toBe(true),
  );
});

it('recovers an uncertain upload by reloading the album without replaying the upload', async () => {
  const OriginalURL = URL;
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL() {
        return 'blob:synthetic';
      }
      static revokeObjectURL() {}
    },
  );
  let uploaded = false;
  mocks.request.mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') {
      uploaded = true;
      throw { status: 503 };
    }
    if (path.endsWith('/photos/12')) return new Blob(['test']);
    return {
      ...baseContent,
      photos: uploaded
        ? [{ index: 12, url: 'approved-photo', contentType: 'image/png', length: 4 }]
        : [],
    };
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContentRecord target="locations" id="location" drafts={new Map()} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Giới thiệu công khai');
  fireEvent.change(screen.getByLabelText('Ảnh công khai mới'), {
    target: { files: [new File(['test'], 'photo.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh được phép công khai' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  const dialog = screen.getByRole('dialog');
  await within(dialog).findByRole('alert');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Hủy' })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await screen.findByRole('button', { name: 'Tải lại danh sách ảnh và trạng thái' });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách ảnh và trạng thái' }));
  await screen.findByRole('button', { name: 'Xóa ảnh 13' });
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});
it('saves only the public whitelist and requires saving edits before publishing', async () => {
  const content = {
    locationId: 'location',
    name: 'Synthetic location',
    address: 'Synthetic address',
    summary: 'Original summary',
    amenities: ['Wifi'],
    contactPhone: null,
    contactEmail: null,
    photos: [],
    published: false,
    publishedAt: null,
  };
  mocks.request.mockResolvedValue(content);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContentRecord target="locations" id="location" />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Giới thiệu công khai'), {
    target: { value: 'Approved public summary' },
  });
  expect(screen.getByRole('button', { name: 'Xuất bản nội dung đã lưu' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1),
  );
  const write = mocks.request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(write[0]).toBe('/api/v1/public-content/locations/location');
  expect(JSON.parse(write[1].body)).toEqual({
    summary: 'Approved public summary',
    amenities: ['Wifi'],
    contactPhone: null,
    contactEmail: null,
  });
});
it('retries failed content loading without showing a stale editor', async () => {
  mocks.request.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({
    locationId: 'location',
    name: 'Synthetic location',
    summary: 'Approved summary',
    contactEmail: 'public@example.invalid',
    amenities: [],
    photos: [],
    published: false,
    publishedAt: null,
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContentRecord target="locations" id="location" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Thử tải lại nội dung' }));
  await screen.findByLabelText('Giới thiệu công khai');
  expect(screen.getByText('Chưa xuất bản')).toBeInTheDocument();
});
it('requires confirmation and refreshes the server publication state after publishing and removal', async () => {
  let content = {
    locationId: 'location',
    name: 'Synthetic location',
    summary: 'Approved summary',
    contactEmail: 'public@example.invalid',
    amenities: [],
    photos: [],
    published: false,
    publishedAt: null as string | null,
  };
  mocks.request.mockImplementation(async (path, init) => {
    if (init?.method === 'POST')
      content = {
        ...content,
        published: path.endsWith('/publish'),
        publishedAt: path.endsWith('/publish') ? '2026-11-10T00:00:00Z' : null,
      };
    return content;
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContentRecord target="locations" id="location" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Xuất bản nội dung đã lưu' }));
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await screen.findByText('Đã xuất bản');
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ xuất bản' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await screen.findByText('Chưa xuất bản');
  expect(
    mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([p]) => p),
  ).toEqual([
    '/api/v1/public-content/locations/location/publish',
    '/api/v1/public-content/locations/location/unpublish',
  ]);
});
