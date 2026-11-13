import { useEffect, useState } from 'react';
import { Button, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  ArrowLeft,
  Building2,
  Coins,
  Copy,
  DoorOpen,
  History,
  Package,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
} from 'lucide-react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePortalData } from '../../../hooks/usePortalData';
import type { PortalRecord } from '../../../types/portal';
import { CopyConfigurationWizard } from '../components/CopyConfigurationWizard';
import { InitialLocationSetupWizard } from '../components/InitialLocationSetupWizard';
import { LocationAssetsTab } from '../components/tabs/LocationAssetsTab';
import { LocationHistoryTab } from '../components/tabs/LocationHistoryTab';
import { LocationOverviewTab } from '../components/tabs/LocationOverviewTab';
import { LocationPricingTab } from '../components/tabs/LocationPricingTab';
import { LocationRoomsTab } from '../components/tabs/LocationRoomsTab';
import { LocationRulesTab } from '../components/tabs/LocationRulesTab';
import { LocationSettingsTab } from '../components/tabs/LocationSettingsTab';
import type { CopyConfigurationGroup } from '../types/locationConfig';
import { isMockMode } from '../../../services/config';
import { LocationApiWorkspace } from './LocationApiWorkspace';

const LOCATION_WORKSPACE_TABS = [
  ['overview', 'Tổng quan', Building2],
  ['rooms', 'Phòng & Sơ đồ tầng', DoorOpen],
  ['assets', 'Tài sản & Trang thiết bị', Package],
  ['pricing', 'Giá thuê & Biểu phí', Coins],
  ['rules', 'Nội quy & Quy định', ScrollText],
  ['history', 'Lịch sử vận hành', History],
  ['settings', 'Thiết lập cơ sở', Settings],
  ['investment', 'Vốn & Chi phí', Scale],
] as const;

export function LocationWorkspace() {
  return isMockMode ? <MockLocationWorkspace /> : <LocationApiWorkspace />;
}

function MockLocationWorkspace() {
  const { locationId = '' } = useParams();
  const route = useLocation();
  const portal = usePortal();
  const query = usePortalData();

  // Tab path mapping
  const currentSubPath = route.pathname.split('/')[3] || 'overview';
  // Map legacy subpaths if needed
  const activeTab =
    currentSubPath === 'room-types' ? 'rooms' : currentSubPath === 'utilities' ? 'pricing' : currentSubPath;

  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const [isCopyWizardOpen, setIsCopyWizardOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    if (locationId && portal.locationId !== locationId) {
      portal.setLocationId(locationId);
      portal.setSearch('');
    }
  }, [locationId, portal]);

  // Finance has its own real API data source. The Location prototype provider must
  // not prevent the implemented finance child route from loading in API mode.
  if (!isMockMode && activeTab === 'investment') return <Outlet />;

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const db = query.data;
  const selected = db.records.locations.find((item) => item.id === locationId);
  if (!selected) return <Navigate to="/locations" replace />;

  const handleCopySuccess = (result: {
    sourceId: string;
    destinationId: string;
    copiedGroups: CopyConfigurationGroup[];
    actionSummary: string;
  }) => {
    setSuccessToast(
      `Đã sao chép thành công ${result.copiedGroups.length} nhóm cấu hình vào cơ sở này.`,
    );
  };

  const handleSetupComplete = (newLocationRecord: PortalRecord) => {
    if (!isMockMode) {
      portal.notify(
        'Backend chưa có API commit nguyên tử cho toàn bộ Wizard. Không có dữ liệu nào được thay đổi.',
        true,
      );
      return;
    }
    db.records.locations.push(newLocationRecord);
    setSuccessToast(`Đã hoàn tất cấu hình cơ sở mới: ${newLocationRecord.name}.`);
  };

  return (
    <>
      <PageHeader
        group={null}
        title={selected.name}
        actions={
          <Stack direction="row" spacing={1.5}>
            <Button
              component={Link}
              to="/locations"
              variant="outlined"
              startIcon={<ArrowLeft size={16} />}
            >
              Danh sách cơ sở
            </Button>
            <Button
              variant="outlined"
              startIcon={<Copy size={16} />}
              onClick={() => {
                if (isMockMode) setIsCopyWizardOpen(true);
                else
                  portal.notify(
                    'Backend chưa có API sao chép cấu hình nguyên tử giữa hai cơ sở.',
                    true,
                  );
              }}
            >
              Sao chép cấu hình
            </Button>
            <Button
              variant="contained"
              startIcon={<Sparkles size={16} />}
              onClick={() => {
                if (isMockMode) setIsSetupWizardOpen(true);
                else
                  portal.notify(
                    'Backend chưa có API commit nguyên tử cho toàn bộ Wizard cấu hình cơ sở.',
                    true,
                  );
              }}
            >
              Cấu hình cơ sở
            </Button>
          </Stack>
        }
      />

      {successToast && (
        <Paper
          sx={{
            p: 1.75,
            mb: 2.5,
            bgcolor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            borderRadius: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 750 }}>
            {successToast}
          </Typography>
          <Button size="small" onClick={() => setSuccessToast(null)} sx={{ color: '#166534' }}>
            Đóng
          </Button>
        </Paper>
      )}

      {/* 8 Section Navigation Tabs */}
      <Tabs
        value={LOCATION_WORKSPACE_TABS.some(([key]) => key === activeTab) ? activeTab : 'overview'}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {LOCATION_WORKSPACE_TABS.map(([key, label, IconComponent]) => (
          <Tab
            key={key}
            value={key}
            label={label}
            icon={<IconComponent size={16} />}
            iconPosition="start"
            component={Link}
            to={`/locations/${selected.id}/${key}`}
          />
        ))}
      </Tabs>

      {/* Render the appropriate tab component based on URL route */}
      {activeTab === 'overview' && (
        <LocationOverviewTab
          db={db}
          location={selected}
          onLaunchSetupWizard={() => setIsSetupWizardOpen(true)}
          onLaunchCopyWizard={() => setIsCopyWizardOpen(true)}
        />
      )}

      {activeTab === 'rooms' && <LocationRoomsTab db={db} location={selected} />}

      {activeTab === 'assets' && <LocationAssetsTab db={db} location={selected} />}

      {activeTab === 'pricing' && <LocationPricingTab db={db} location={selected} />}

      {activeTab === 'rules' && <LocationRulesTab locationId={selected.id} />}

      {activeTab === 'history' && <LocationHistoryTab />}

      {activeTab === 'settings' && (
        <LocationSettingsTab
          location={selected}
          onLaunchCopyWizard={() => setIsCopyWizardOpen(true)}
        />
      )}

      {/* If any other route was triggered */}
      {(activeTab === 'investment' ||
        !LOCATION_WORKSPACE_TABS.some(([key]) => key === activeTab)) && <Outlet />}

      {/* Integrated Setup & Copy Modals */}
      <InitialLocationSetupWizard
        open={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        db={db}
        onComplete={handleSetupComplete}
      />

      <CopyConfigurationWizard
        open={isCopyWizardOpen}
        onClose={() => setIsCopyWizardOpen(false)}
        db={db}
        initialSourceLocationId={selected.id}
        onCopySuccess={handleCopySuccess}
      />
    </>
  );
}
