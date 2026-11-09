import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import IncidentsPage from './incidents/pages/IncidentsPage';
import MaintenancePage from './maintenance/pages/MaintenancePage';
import PublicContentPage from './public-content/pages/PublicContentPage';

it.each([
  [IncidentsPage, 'Sự cố và tình huống khẩn cấp'],
  [MaintenancePage, 'Bảo trì và Work Order'],
  [PublicContentPage, 'Quản lý nội dung công khai'],
] as const)(
  'discloses the missing runtime contract instead of showing demo success',
  (Page, title) => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(/Backend đang chạy chưa cung cấp contract API/)).toBeInTheDocument();
  },
);
