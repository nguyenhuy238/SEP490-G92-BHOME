import { vacancyLabel } from './publicPresentation';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
        <QueryProbe />
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
function QueryProbe() {
  const route = useLocation();
  return <span data-testid="query-url">{route.search}</span>;
}
afterEach(() => vi.unstubAllGlobals());

describe('Guest public feedback', () => {
  it('returns to an existing page when refreshed room availability reduces the result set', async () => {
    const available = Array.from({ length: 7 }, (_, index) => ({
      ...room,
      roomId: String(index),
      roomNumber: `P${index + 1}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(json(path.endsWith('/rooms') ? available : location)),
        ),
    );
    const client = show(`/locations/${id}`);
    await screen.findByRole('link', { name: 'Phòng P1' });
    fireEvent.click(screen.getByRole('button', { name: 'Đến trang 2' }));
    expect(screen.getByRole('link', { name: 'Phòng P7' })).toBeVisible();
    await act(async () => {
      client.setQueryData(['public', 'rooms', id], available.slice(0, 1));
    });
    expect(await screen.findByRole('link', { name: 'Phòng P1' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Phòng P7' })).not.toBeInTheDocument();
  });
  it('filters published locations by name/address and keeps search in the URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json([
            location,
            { ...location, locationId: 'other', name: 'Cơ sở phía Nam', address: 'Quận tổng hợp' },
          ]),
        ),
    );
    show();
    await screen.findByRole('heading', { name: location.name });
    fireEvent.change(screen.getByLabelText('Tìm tên cơ sở hoặc địa chỉ'), {
      target: { value: 'phía Nam' },
    });
    expect(screen.queryByRole('heading', { name: location.name })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cơ sở phía Nam' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Tìm tên cơ sở hoặc địa chỉ'), {
      target: { value: 'không có' },
    });
    expect(screen.getByText(/Không có cơ sở phù hợp/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(screen.getByRole('heading', { name: location.name })).toBeVisible();
  });

  it('filters rooms by price without treating unpublished price as zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(
            json(
              path.endsWith('/rooms')
                ? [room, { ...room, roomId: 'priced', roomNumber: 'B2', indicativePrice: 2500000 }]
                : location,
            ),
          ),
        ),
    );
    show(`/locations/${id}`);
    await screen.findByRole('link', { name: 'Phòng B2' });
    fireEvent.change(screen.getByLabelText('Giá tối đa mỗi tháng'), {
      target: { value: '3000000' },
    });
    expect(screen.queryByRole('link', { name: 'Phòng A1' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Phòng B2' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Giá tối đa mỗi tháng'), {
      target: { value: '1000000' },
    });
    expect(screen.getByText(/Không có phòng phù hợp/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(screen.getByRole('link', { name: 'Phòng A1' })).toBeVisible();
  });

  it('restores URL filters, shows only available rooms and resets without losing unrelated queries', async () => {
    const published = [
      {
        ...room,
        roomId: 'vacant',
        roomNumber: 'A2',
        description: 'Mô tả dài dành cho trang chi tiết',
        vacancy: 'Available',
        amenities: ['Wifi', 'Máy lạnh', 'Ban công', 'Thang máy'],
        indicativePrice: 2000000,
      },
      {
        ...room,
        roomId: 'occupied',
        roomNumber: 'B3',
        vacancy: 'Occupied',
        indicativePrice: 2500000,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(json(path.endsWith('/rooms') ? published : location)),
        ),
    );
    show(`/locations/${id}?ref=example&vacant=1&price=2200000`);
    expect(await screen.findByRole('link', { name: 'Phòng A2' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Phòng B3' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mô tả dài dành cho trang chi tiết')).not.toBeInTheDocument();
    expect(screen.getByText('Tìm thấy 1 phòng')).toBeVisible();
    expect(screen.getByText('Wifi')).toBeVisible();
    expect(screen.queryByText('Thang máy')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chỉ xem phòng còn trống' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc thêm' }));
    expect(screen.getByLabelText('Số người ở')).toBeVisible();
    expect(screen.getByLabelText('Tiện nghi')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(screen.getByRole('link', { name: 'Phòng B3' })).toBeVisible();
    expect(screen.getByTestId('query-url')).toHaveTextContent('ref=example');
    expect(screen.getByTestId('query-url')).not.toHaveTextContent('vacant=');
    expect(screen.getByTestId('query-url')).not.toHaveTextContent('price=');
  });

  it('uses four backend status labels and never treats unknown as available', () => {
    expect(['Available', 'OnHold', 'Occupied', 'Unavailable', 'Unknown'].map(vacancyLabel)).toEqual(
      [
        'Còn trống',
        'Đang giữ chỗ',
        'Đã có người ở',
        'Tạm ngừng cho thuê',
        'Chưa công bố tình trạng',
      ],
    );
  });
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
    expect(
      document.querySelector(
        'form, textarea, input[type=password], input[type=email], input[type=tel]',
      ),
    ).toBeNull();
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
    expect(
      screen
        .getAllByRole('status')
        .some((item) => item.textContent?.includes('Chưa thể tải ảnh 1')),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại ảnh 1' }));
    expect(screen.getByRole('img', { name: `${location.name} — ảnh 1` })).toBeVisible();
    expect(document.querySelector('img[src*="private.example.invalid"]')).toBeNull();
  });

  it('shows only backend-published price/vacancy and passes cancellation to public reads', async () => {
    const fetch = vi.fn().mockResolvedValue(json(room));
    vi.stubGlobal('fetch', fetch);
    show(`/rooms/${id}`);
    expect(await screen.findByText('Liên hệ để biết giá')).toBeVisible();
    expect(screen.getByText(/Chưa công bố tình trạng/)).toBeVisible();
    await waitFor(() => expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal));
    expect(document.querySelector('form, input, textarea')).toBeNull();
  });
});
import '@testing-library/jest-dom/vitest';
