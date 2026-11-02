import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { theme } from '../../theme/theme';
import { prepareProperty } from '../property/mockProperty';
import { createSeed } from '../../services/mock/seed';
import { CopyConfigurationWizard } from './components/CopyConfigurationWizard';
import { PolicyVersioningDialog } from './components/PolicyVersioningDialog';
import { LocationOverviewTab } from './components/tabs/LocationOverviewTab';
import { LocationPricingTab } from './components/tabs/LocationPricingTab';
import { LocationHistoryTab } from './components/tabs/LocationHistoryTab';
import type { HouseRuleItem } from './types/locationConfig';

describe('BHOME Owner Web - Initial Location Configuration UI/UX (Vietnamese)', () => {
  const db = prepareProperty(createSeed());
  const sampleLocation = db.records.locations[0];

  it('renders Location Overview Tab with Vietnamese metric KPIs, occupancy rate and readiness checklist', () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <LocationOverviewTab
            db={db}
            location={sampleLocation}
            onLaunchSetupWizard={vi.fn()}
            onLaunchCopyWizard={vi.fn()}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('TỔNG SỐ PHÒNG')).toBeInTheDocument();
    expect(screen.getByText('ĐANG THUÊ')).toBeInTheDocument();
    expect(screen.getByText('TRỐNG KHAI THÁC')).toBeInTheDocument();
    expect(screen.getByText('TỶ LỆ LẤP ĐẦY')).toBeInTheDocument();
    expect(screen.getByText(/Biến động tỷ lệ lấp đầy/i)).toBeInTheDocument();
    expect(screen.getByText('Tình trạng sẵn sàng vận hành')).toBeInTheDocument();
  });

  it('renders Policy Versioning Dialog in Case B (Applied Policy) with Vietnamese warning banner and version bump', () => {
    const appliedPolicy: HouseRuleItem = {
      id: 'rule-elec',
      name: 'Biểu giá điện sinh hoạt',
      category: 'OTHER_OPERATIONS',
      content: 'Tiền điện tính 3.000 VND/kWh theo công tơ.',
      effectiveDate: '2026-09-01',
      status: 'ACTIVE',
      version: 'V1',
      isAppliedToContracts: true,
      history: [
        {
          version: 'V1',
          value: 'Tiền điện tính 3.000 VND/kWh',
          effectiveDate: '2026-09-01',
          status: 'ACTIVE',
        },
      ],
    };

    const handleSaveNewVersion = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <PolicyVersioningDialog
          open={true}
          onClose={vi.fn()}
          policy={appliedPolicy}
          onSaveNewVersion={handleSaveNewVersion}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/Cảnh báo bảo vệ hợp đồng đang hiệu lực/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Quy định này đã được áp dụng trong các hợp đồng thuê đang có hiệu lực/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Đề xuất phiên bản mới (V2)')).toBeInTheDocument();

    const createBtn = screen.getByRole('button', { name: /Tạo phiên bản mới/i });
    expect(createBtn).toBeInTheDocument();
    fireEvent.click(createBtn);

    expect(handleSaveNewVersion).toHaveBeenCalledWith(
      'rule-elec',
      expect.objectContaining({
        version: 'V2',
        status: 'SCHEDULED',
      }),
    );
  });

  it('renders Copy Configuration Wizard with 4 steps in Vietnamese', () => {
    render(
      <ThemeProvider theme={theme}>
        <CopyConfigurationWizard open={true} onClose={vi.fn()} db={db} onCopySuccess={vi.fn()} />
      </ThemeProvider>,
    );

    expect(
      screen.getByText(/Bước 1: Chọn cơ sở nguồn & Cơ sở đích tiếp nhận/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Chọn cơ sở nguồn (Sao chép từ):')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tiếp tục/i }));

    expect(screen.getByText(/Bước 2: Chọn các nhóm cấu hình cần sao chép/i)).toBeInTheDocument();
    expect(screen.getByText('Mẫu loại phòng & Tiện nghi')).toBeInTheDocument();
    expect(screen.getByText('Định mức trang bị tài sản')).toBeInTheDocument();
    expect(screen.getByText('Biểu phí điện, nước & Dịch vụ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tiếp tục/i }));

    expect(screen.getByText(/Bước 3: Xem trước & Xử lý kiểm tra xung đột/i)).toBeInTheDocument();
    expect(screen.getByText('Kiểm tra xung đột')).toBeInTheDocument();
  });

  it('renders Pricing & Fee Policies in Vietnamese with statutory tariff notice and billing preview', () => {
    render(
      <ThemeProvider theme={theme}>
        <LocationPricingTab db={db} location={sampleLocation} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Cơ chế phân cấp định giá phòng')).toBeInTheDocument();
    expect(screen.getByText('Giá thuê đang áp dụng')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Biểu phí điện, nước & Dịch vụ/i }));

    expect(
      screen.getByText(/Cảnh báo quy định biểu giá điện & nước sinh hoạt của Nhà nước/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mô phỏng chi phí hàng tháng của phòng/i)).toBeInTheDocument();
  });

  it('renders Operational History Tab in Vietnamese with timeline', () => {
    render(
      <ThemeProvider theme={theme}>
        <LocationHistoryTab />
      </ThemeProvider>,
    );

    expect(screen.getByText('Lịch sử vận hành & Bảo dưỡng tài sản')).toBeInTheDocument();
    expect(screen.getByText('Bảo trì hoàn tất')).toBeInTheDocument();
    expect(screen.getByText('Thay thế tài sản')).toBeInTheDocument();
  });
});
