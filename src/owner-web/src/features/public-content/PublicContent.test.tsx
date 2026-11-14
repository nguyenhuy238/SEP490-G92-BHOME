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
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nội dung công khai' }));
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
