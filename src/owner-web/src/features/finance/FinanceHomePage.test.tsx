import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import FinanceHomePage from './FinanceHomePage';

function renderFinanceHome() {
  render(
    <MemoryRouter>
      <FinanceHomePage />
    </MemoryRouter>,
  );
}

it('shows three visible work areas with direct links to each core finance task', () => {
  renderFinanceHome();

  expect(
    screen.getByRole('heading', { name: 'Tài chính & Hóa đơn', level: 1 }),
  ).toBeInTheDocument();

  const destinations = [
    {
      area: 'Lập hóa đơn',
      links: [
        ['Mở danh sách hóa đơn', '/invoices'],
        ['Chỉ số điện nước', '/meters'],
        ['Lịch lập hóa đơn', '/billing-automation'],
        ['Giá & biểu phí', '/pricing'],
        ['Điều chỉnh hóa đơn', '/invoice-adjustments'],
      ],
    },
    {
      area: 'Thu tiền & công nợ',
      links: [
        ['Đối soát thanh toán', '/payments'],
        ['Công nợ', '/debts'],
        ['Yêu cầu hoàn tiền', '/tenant-refund-requests'],
      ],
    },
    {
      area: 'Chi phí & báo cáo',
      links: [
        ['Xem báo cáo', '/reports'],
        ['Chi phí & đầu tư', '/expenses'],
        ['Kịch bản What-if', '/what-if'],
      ],
    },
  ] as const;

  for (const group of destinations) {
    const area = screen.getByRole('region', { name: group.area });
    expect(within(area).getByRole('heading', { name: group.area, level: 2 })).toBeVisible();
    for (const [label, href] of group.links) {
      expect(within(area).getByRole('link', { name: new RegExp(label) })).toHaveAttribute(
        'href',
        href,
      );
    }
  }

  expect(screen.getByRole('link', { name: /Thuế & chứng từ/ })).toHaveAttribute(
    'href',
    '/finance/tax-records',
  );
  expect(screen.getAllByRole('link')).toHaveLength(12);
});

it('keeps all destinations visible without speculative progress, figures or hidden tabs', () => {
  renderFinanceHome();

  const guide = screen.getByRole('region', { name: 'Quy trình thu tiền thường gặp' });
  for (const stage of [
    'Kiểm tra giá & phí',
    'Kiểm tra chỉ số',
    'Lập và phát hành',
    'Đối soát thanh toán',
  ]) {
    expect(within(guide).getByText(stage)).toBeVisible();
  }
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByText('Hôm nay bạn cần làm gì?')).not.toBeInTheDocument();
  expect(screen.queryByText(/Bước [1-9]/)).not.toBeInTheDocument();
  expect(screen.queryByText(/đang chờ xử lý hôm nay/i)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Đối soát thanh toán/i })).toBeVisible();
  expect(screen.getByRole('link', { name: /Xem báo cáo/i })).toBeVisible();
});
