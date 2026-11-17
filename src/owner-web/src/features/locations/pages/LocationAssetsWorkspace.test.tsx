import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { theme } from '../../../theme/theme';
import { LocationAssetsWorkspace } from './LocationAssetsWorkspace';

const state = vi.hoisted(() => ({ roles: ['Owner'] }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { roles: state.roles } }),
}));
vi.mock('../../property/PropertyApiPages', () => ({
  PropertyApiPage: ({ onAssetInventory }: { onAssetInventory?: () => void }) => (
    <button onClick={() => onAssetInventory?.()}>Mở kiểm kê</button>
  ),
}));
vi.mock('../../property/LocalAssetSetup', () => ({
  LocalAssetSetup: ({ mode }: { mode: string }) => <div data-testid="legacy-inventory">{mode}</div>,
}));
vi.mock('../../property/CommonAssetRequirementsPanel', () => ({
  CommonAssetRequirementsPanel: () => <div data-testid="common-assets" />,
}));
vi.mock('../../property/RoomInventoryReviewPanel', () => ({
  RoomInventoryReviewPanel: () => <div data-testid="owner-review" />,
}));
vi.mock('../../property/CommonAssetInventoryReviewPanel', () => ({
  CommonAssetInventoryReviewPanel: () => <div data-testid="common-review" />,
}));

afterEach(cleanup);
function mount(initialPath = '/locations/location/assets') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider theme={theme}>
        <LocationAssetsWorkspace locationId="location" />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

it('keeps Owner configuration and attestation tabs separate from the legacy Staff workflow', () => {
  state.roles = ['Owner'];
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Tài sản theo phòng' }));
  expect(screen.getByTestId('legacy-inventory')).toHaveTextContent('templates');
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm kê tài sản' }));
  expect(screen.getByTestId('owner-review')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm kê khu vực chung' }));
  expect(screen.getByTestId('common-review')).toBeInTheDocument();
});

it('opens the inventory review tab directly from a finance link', () => {
  state.roles = ['Owner'];
  mount('/locations/location/assets?tab=review&scope=common');
  expect(screen.getByRole('tab', { name: 'Kiểm kê tài sản' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Kiểm kê khu vực chung' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('common-review')).toBeInTheDocument();
});

it('shows Staff only the dedicated handover inventory entry and keeps its legacy flow', () => {
  state.roles = ['Staff'];
  mount();
  expect(screen.getByRole('tab', { name: 'Kiểm kê bàn giao' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Tài sản theo phòng' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Tài sản chung cơ sở' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Kiểm kê tài sản' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm kê bàn giao' }));
  expect(screen.getByTestId('legacy-inventory')).toHaveTextContent('inventory');
});
