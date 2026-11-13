import { useState } from 'react';
import { Tab, Tabs } from '@mui/material';
import { PropertyApiPage } from '../../property/PropertyApiPages';
import { LocalAssetSetup } from '../../property/LocalAssetSetup';
import { LocationSection } from '../components/LocationSection';

export function LocationAssetsWorkspace({ locationId }: { locationId: string }) {
  const [tab, setTab] = useState(0);
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
        <Tab label="Bộ định mức trang bị" />
        <Tab label="Kiểm kê phòng" />
      </Tabs>
      {tab === 0 ? (
        <PropertyApiPage kind="assets" embedded />
      ) : (
        <LocalAssetSetup
          key={locationId}
          locationId={locationId}
          mode={tab === 1 ? 'templates' : 'inventory'}
        />
      )}
    </LocationSection>
  );
}
