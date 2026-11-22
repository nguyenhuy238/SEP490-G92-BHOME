import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPage, LocationsPage, RoomPage } from './PublicContentPages';

const id = '00000000-0000-0000-0000-000000000001';
const location = {
  locationId: id,
  name: 'Cơ sở kiểm thử',
  address: 'Địa chỉ tổng hợp',
  summary: 'Thông tin công bố',
  amenities: [],
  photos: [],
  contactPhone: null,
  contactEmail: null,
  published: true,
  publishedAt: null,
};
const room = {
  roomId: id,
  locationId: id,
  roomNumber: 'A1',
  floor: null,
  capacity: 2,
  description: 'Phòng tổng hợp',
  amenities: [],
  indicativePrice: null,
  vacancy: 'Unknown',
  photos: [],
  published: true,
  publishedAt: null,
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function show(path = '/locations') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/locations/:id" element={<LocationPage />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => vi.unstubAllGlobals());

describe('Guest public feedback', () => {
  it('announces loading and an explicit empty list without data-entry forms', async () => {
    let complete!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải thông tin');
    await act(async () => complete(json([])));
    expect(await screen.findByText(/Hiện chưa có cơ sở được công bố/)).toBeVisible();
    expect(document.querySelector('form, input, textarea')).toBeNull();
  });

  it('sanitizes server errors and locks the retry button until the read completes', async () => {
    let complete!: (value: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: 'NpgsqlException: private stack' }, 503))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetch);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    const retry = await screen.findByRole('button', { name: 'Đang thử lại…' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/NpgsqlException/)).not.toBeInTheDocument();
    await act(async () => complete(json([location])));
    expect(await screen.findByRole('heading', { name: location.name })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains unavailable/unpublished details without exposing raw backend text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'resource secret' }, 404)));
    show(`/rooms/${id}`);
    expect(
      await screen.findByText('Thông tin không tồn tại hoặc chưa được công bố.'),
    ).toBeVisible();
    expect(screen.queryByText(/resource secret/)).not.toBeInTheDocument();
  });

  it('keeps a loaded location visible when its room list fails and can retry that list', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(location))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', fetch);
    show(`/locations/${id}`);
    expect(await screen.findByRole('heading', { name: location.name })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Cơ sở chưa công bố phòng.')).toBeVisible();
    expect(screen.getByRole('heading', { name: location.name })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('offers an accessible image retry while rejecting private/external image URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json([
          {
            ...location,
            photos: [
              { index: 0, url: `/api/v1/public/locations/${id}/photos/0` },
              { index: 1, url: 'https://private.example.invalid/identity.png' },
            ],
          },
        ]),
      ),
    );
    show();
    fireEvent.error(await screen.findByRole('img', { name: `${location.name} — ảnh 1` }));
    expect(screen.getByRole('status')).toHaveTextContent('Chưa thể tải ảnh 1');
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại ảnh 1' }));
    expect(screen.getByRole('img', { name: `${location.name} — ảnh 1` })).toBeVisible();
    expect(document.querySelector('img[src*="private.example.invalid"]')).toBeNull();
  });

  it('shows only backend-published price/vacancy and passes cancellation to public reads', async () => {
    const fetch = vi.fn().mockResolvedValue(json(room));
    vi.stubGlobal('fetch', fetch);
    show(`/rooms/${id}`);
    expect(await screen.findByText('Chưa công bố giá tham khảo')).toBeVisible();
    expect(screen.getByText(/Chưa công bố tình trạng/)).toBeVisible();
    await waitFor(() => expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal));
    expect(document.querySelector('form, input, textarea')).toBeNull();
  });
});
import '@testing-library/jest-dom/vitest';
