import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PortalProvider } from '../../app/PortalProvider';
import { theme } from '../../theme/theme';
import { SharedConfigurationProvider } from './SharedConfigurationContext';
import { ConfigurationLibraryPage } from './pages/ConfigurationLibraryPage';

vi.mock('../../services/config', () => ({ isMockMode: true }));

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <PortalProvider>
        <SharedConfigurationProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </SharedConfigurationProvider>
      </PortalProvider>
    </ThemeProvider>
  );
}

describe('Thư viện cấu hình dùng chung', () => {
  it('tạo mẫu loại phòng và hiển thị trong phiên hiện tại', () => {
    render(
      <Providers>
        <ConfigurationLibraryPage kind="room" />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], {
      target: { value: 'Phòng nhỏ nâng cao' },
    });
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '23' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tạo mẫu' }));
    expect(screen.getByText('Phòng nhỏ nâng cao')).toBeInTheDocument();
    expect(screen.getByText(/đã có thể sử dụng trong phiên hiện tại/i)).toBeInTheDocument();
  });
});
