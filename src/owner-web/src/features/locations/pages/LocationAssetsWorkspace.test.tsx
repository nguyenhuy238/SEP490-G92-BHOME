import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
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

afterEach(cleanup);
function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <LocationAssetsWorkspace locationId="location" />
    </ThemeProvider>,
  );
}

it('keeps Owner configuration and attestation tabs separate from the legacy Staff workflow', () => {
  state.roles = ['Owner'];
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Tài sản theo phòng' }));
  expect(screen.getByTestId('legacy-inventory')).toHaveTextContent('templates');
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm kê phòng' }));
  expect(screen.getByTestId('owner-review')).toBeInTheDocument();
});

it('shows Staff only the dedicated handover inventory entry and keeps its legacy flow', () => {
  state.roles = ['Staff'];
  mount();
  expect(screen.getByRole('tab', { name: 'Kiểm kê bàn giao' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Tài sản theo phòng' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Tài sản chung cơ sở' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Kiểm kê phòng' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm kê bàn giao' }));
  expect(screen.getByTestId('legacy-inventory')).toHaveTextContent('inventory');
});
