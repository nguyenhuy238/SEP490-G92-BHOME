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
      description="Theo dõi tài sản thực tế hoặc chuẩn bị bộ mẫu trang bị và kiểm kê cho từng phòng. Công bố mẫu không tự xác nhận tài sản đã được lắp đặt."
    >
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable">
          <Tab label="Tài sản thực tế" />
          <Tab label="Bộ mẫu & kiểm kê phòng" />
        </Tabs>
      </Paper>
      {tab === 0 ? <PropertyApiPage kind="assets" /> : <LocalAssetSetup locationId={locationId} />}
    </LocationSection>
  );
}
