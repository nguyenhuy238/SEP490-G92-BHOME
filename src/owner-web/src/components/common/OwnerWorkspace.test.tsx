import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OwnerTable } from './OwnerWorkspace';
import { StatusChip } from './PortalUI';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('renders after resetting mocks without losing the default media query implementation', () => {
  vi.resetAllMocks();
  expect(window.matchMedia('(max-width:599px)').matches).toBe(false);
  render(
    <OwnerTable
      rows={['Phòng 101']}
      columns={[{ label: 'Phòng', render: (row) => row }]}
      id={(row) => row}
    />,
  );
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('Phòng 101')).toBeVisible();
});
it('prioritizes loading and failure over a misleading empty state and supports retry', () => {
  const retry = vi.fn();
  const props = { rows: [] as string[], columns: [], id: (row: string) => row };
  const view = render(<OwnerTable {...props} loading />);
  expect(screen.getByRole('status', { name: 'Đang tải dữ liệu' })).toBeInTheDocument();
  view.rerender(<OwnerTable {...props} error={new Error('Synthetic unavailable')} retry={retry} />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Không có dữ liệu phù hợp với bộ lọc.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<OwnerTable {...props} />);
  expect(screen.getByRole('status')).toHaveTextContent('Không có dữ liệu phù hợp');
});

it('keeps exact mobile data and the primary action in the visible record row', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
  const row = {
    id: 'invoice',
    name: 'Phòng 101',
    due: '12.345.678.901.234,1234 đ',
    status: 'Chờ xác nhận',
  };
  const select = vi.fn();
  render(
    <OwnerTable
      rows={[row]}
      id={(item) => item.id}
      columns={[
        { label: 'Phòng', render: (item) => item.name },
        { label: 'Dư nợ', render: (item) => item.due },
        { label: 'Trạng thái', render: (item) => <StatusChip label={item.status} /> },
      ]}
      select={select}
      selectLabel="Chọn hóa đơn"
    />,
  );
  const table = screen.getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Phòng', 'Thao tác']);
  const identity = within(table).getByRole('rowheader');
  expect(within(identity).getByText(row.name)).toBeVisible();
  expect(within(identity).getByText(row.due)).toBeVisible();
  expect(within(identity).getByText(row.status)).toBeVisible();
  fireEvent.click(within(table).getByRole('button', { name: 'Chọn hóa đơn' }));
  expect(select).toHaveBeenCalledWith(row);
});

it.each([
  ['Đã kết thúc', 'neutral'],
  ['Đã lưu trữ', 'neutral'],
  ['Đã từ chối', 'error'],
  ['Chờ xác minh', 'warning'],
  ['Đã xác minh', 'success'],
  ['Đang thuê', 'info'],
  ['Chưa xuất bản', 'neutral'],
])('uses the business status tone for %s rather than its prefix', (label, tone) => {
  render(<StatusChip label={label} />);
  expect(screen.getByText(label).closest('[data-status-tone]')).toHaveAttribute(
    'data-status-tone',
    tone,
  );
});
