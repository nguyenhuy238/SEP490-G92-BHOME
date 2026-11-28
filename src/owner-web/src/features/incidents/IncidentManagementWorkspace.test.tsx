// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { IncidentManagementWorkspace } from './IncidentManagementWorkspace';
import type { IncidentQueueFilters } from './IncidentQueueWorkspace';

vi.mock('./IncidentQueueWorkspace', () => ({
  IncidentQueueWorkspace: ({
    maintenance,
    incidentFilter,
    initialFilters,
    onFiltersChange,
    onSelect,
    onClearIncidentFilter,
  }: {
    maintenance: boolean;
    incidentFilter: string;
    initialFilters: IncidentQueueFilters;
    onFiltersChange: (value: IncidentQueueFilters) => void;
    onSelect: (id: string) => void;
    onClearIncidentFilter: () => void;
  }) => (
    <div>
      <span>Hàng đợi {maintenance ? 'sửa chữa' : 'sự cố'}</span>
      <span>Đang lọc sự cố: {incidentFilter || 'Tất cả'}</span>
      <span>Trạng thái hàng đợi: {initialFilters.status || 'Tất cả'}</span>
      <button onClick={() => onFiltersChange({ ...initialFilters, status: 'InProgress' })}>
        Lọc đang xử lý
      </button>
      <button onClick={() => onSelect(maintenance ? 'work-1' : 'incident-1')}>Mở hồ sơ</button>
      <button onClick={onClearIncidentFilter}>Bỏ lọc sự cố</button>
    </div>
  ),
}));
vi.mock('./IncidentDetailWorkspace', () => ({
  IncidentDetailWorkspace: ({ id, onBack }: { id: string; onBack: () => void }) => (
    <div>
      <span>Chi tiết sự cố {id}</span>
      <button onClick={onBack}>Quay lại hàng đợi</button>
    </div>
  ),
}));
vi.mock('./WorkOrderDetailWorkspace', () => ({
  WorkOrderDetailWorkspace: ({ id, onBack }: { id: string; onBack: () => void }) => (
    <div>
      <span>Chi tiết lệnh {id}</span>
      <button onClick={onBack}>Quay lại hàng đợi</button>
    </div>
  ),
}));

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="query-string">{location.search}</div>;
}

function mount(start: string, maintenance = false) {
  render(
    <MemoryRouter initialEntries={[start]}>
      <LocationSpy />
      <IncidentManagementWorkspace maintenance={maintenance} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

it('opens exactly one incident detail and restores the queue without losing filters', () => {
  mount('/incidents?locationId=l-1');
  expect(screen.getByText('Hàng đợi sự cố')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Lọc đang xử lý' }));
  expect(screen.getByText('Trạng thái hàng đợi: InProgress')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Mở hồ sơ' }));
  expect(screen.getByText('Chi tiết sự cố incident-1')).toBeVisible();
  expect(screen.queryByText('Hàng đợi sự cố')).not.toBeInTheDocument();
  expect(screen.getByTestId('query-string')).toHaveTextContent('locationId=l-1');
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại hàng đợi' }));
  expect(screen.getByText('Hàng đợi sự cố')).toBeVisible();
  expect(screen.getByText('Trạng thái hàng đợi: InProgress')).toBeVisible();
  expect(screen.getByTestId('query-string')).not.toHaveTextContent('incidentId=');
});

it('opens a deep-linked work order without showing the queue and preserves incident context on back', () => {
  mount('/maintenance?workOrderId=work-1&incidentId=incident-1', true);
  expect(screen.getByText('Chi tiết lệnh work-1')).toBeVisible();
  expect(screen.queryByText('Hàng đợi sửa chữa')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại hàng đợi' }));
  expect(screen.getByText('Hàng đợi sửa chữa')).toBeVisible();
  expect(screen.getByText('Đang lọc sự cố: incident-1')).toBeVisible();
  expect(screen.getByTestId('query-string')).not.toHaveTextContent('workOrderId=');
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc sự cố' }));
  expect(screen.getByText('Đang lọc sự cố: Tất cả')).toBeVisible();
  expect(screen.getByTestId('query-string')).not.toHaveTextContent('incidentId=');
});
