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
