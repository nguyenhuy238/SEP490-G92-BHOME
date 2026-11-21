import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { TaskInspectionReview } from './EquipmentInspectionsPanel';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
it('renders authoritative failed counts and retains the review note on stale state', async () => {
  request.mockImplementation((path: string) =>
    path.endsWith('/review')
      ? Promise.reject({ status: 409 })
      : Promise.resolve({
          id: 'synthetic-inspection',
          version: 3,
          status: 'Submitted',
          kind: 'EquipmentInspection',
          data: {
            taskId: 'synthetic-task',
            period: '2026-11-16',
            policyVersion: 2,
            policySnapshot: { name: 'Synthetic policy', checklist: [] },
            units: [],
            answers: [],
            outcome: 'Failed',
            progress: { total: 4, inspected: 4, passed: 3, failed: 1, notInspected: 0 },
          },
        }),
  );
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TaskInspectionReview taskId="synthetic-task" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Đã kiểm tra 4\/4 · Đạt 3 · Không đạt 1/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Ghi chú xác minh / vấn đề cần khắc phục'), {
    target: { value: 'Cần đối chiếu.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh kết quả' }));
  expect(await screen.findByText(/Dữ liệu đã thay đổi/)).toBeInTheDocument();
  expect(screen.getByLabelText('Ghi chú xác minh / vấn đề cần khắc phục')).toHaveValue(
    'Cần đối chiếu.',
  );
  expect(request).toHaveBeenCalledWith(
    '/api/v1/equipment-inspections/synthetic-inspection/review',
    expect.objectContaining({
      body: JSON.stringify({ expectedVersion: 3, action: 'Verify', note: 'Cần đối chiếu.' }),
    }),
  );
});
