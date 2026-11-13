import { useState } from 'react';
import { Paper, Tab, Tabs } from '@mui/material';
import { PropertyApiPage } from '../../property/PropertyApiPages';
import { LocalAssetSetup } from '../../property/LocalAssetSetup';
import { LocationSection } from '../components/LocationSection';

export function LocationAssetsWorkspace({ locationId }: { locationId: string }) {
  const [tab, setTab] = useState(0);
  return (
    <LocationSection
      title="Tài sản & trang thiết bị"
      description="Quản lý tài sản đã ghi nhận, bộ định mức trang bị và xác nhận kiểm kê theo từng phòng."
    >
      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, value: number) => setTab(value)}
          variant="scrollable"
          aria-label="Quản lý tài sản tại cơ sở"
        >
          <Tab label="Tài sản thực tế" />
          <Tab label="Bộ định mức trang bị" />
          <Tab label="Kiểm kê phòng" />
        </Tabs>
      </Paper>
      {tab === 0 ? (
        <PropertyApiPage kind="assets" />
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
