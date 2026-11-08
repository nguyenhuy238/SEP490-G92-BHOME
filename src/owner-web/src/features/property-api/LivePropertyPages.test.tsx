import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveLocation: vi.fn(),
  locations: vi.fn(),
  occupancy: vi.fn(),
}));
vi.mock('./propertyApi', async (original) => ({
  ...(await original<typeof import('./propertyApi')>()),
  usePropertyApi: () => mocks,
}));
vi.mock('../../app/PortalProvider', () => ({ usePortal: () => ({ notify: vi.fn() }) }));
import { LiveLocationsPage } from './LivePropertyPages';

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <LiveLocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('live property locations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locations.mockResolvedValue({ items: [], page: 1, pageSize: 100, totalCount: 0 });
    mocks.saveLocation.mockResolvedValue({ id: 'location', name: 'BHOME Test' });
  });

  it('creates a location with the Backend DTO instead of a demo record', async () => {
    renderPage();
    await screen.findByText('Chưa có dữ liệu phù hợp.');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm cơ sở' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Tên cơ sở/ }), {
      target: { value: 'BHOME Test' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Địa chỉ/ }), {
      target: { value: 'Hà Nội' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(mocks.saveLocation).toHaveBeenCalledWith(
        { name: 'BHOME Test', address: 'Hà Nội', isActive: true, reason: '', version: 0 },
        undefined,
      ),
    );
  });
});
