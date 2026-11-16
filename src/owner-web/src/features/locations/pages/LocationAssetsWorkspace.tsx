import { useState } from 'react';
import { Tab, Tabs } from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { PropertyApiPage } from '../../property/PropertyApiPages';
import { LocalAssetSetup } from '../../property/LocalAssetSetup';
import { CommonAssetRequirementsPanel } from '../../property/CommonAssetRequirementsPanel';
import { RoomInventoryReviewPanel } from '../../property/RoomInventoryReviewPanel';
import { LocationSection } from '../components/LocationSection';

export function LocationAssetsWorkspace({ locationId }: { locationId: string }) {
  const [tab, setTab] = useState(0);
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  return (
    <LocationSection title="Tài sản & trang thiết bị">
      <Tabs
        value={tab}
        onChange={(_, value: number) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Quản lý tài sản tại cơ sở"
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 44 },
        }}
      >
        <Tab label="Tài sản thực tế" />
        {owner && <Tab label="Tài sản theo phòng" />}
        {owner && <Tab label="Tài sản chung cơ sở" />}
        <Tab label={owner ? 'Kiểm kê phòng' : 'Kiểm kê bàn giao'} />
      </Tabs>
      {tab === 0 ? (
        <PropertyApiPage
          kind="assets"
          embedded
          onAssetInventory={owner ? () => setTab(3) : undefined}
        />
      ) : owner && tab === 2 ? (
        <CommonAssetRequirementsPanel key={locationId} locationId={locationId} />
      ) : owner && tab === 3 ? (
        <RoomInventoryReviewPanel key={locationId} locationId={locationId} />
      ) : (
        <LocalAssetSetup
          key={locationId}
          locationId={locationId}
          mode={owner ? 'templates' : 'inventory'}
        />
      )}
    </LocationSection>
  );
}
