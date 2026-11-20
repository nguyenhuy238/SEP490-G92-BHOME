import { useState } from 'react';
import { Stack, Tab, Tabs } from '@mui/material';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { PropertyApiPage } from '../../property/PropertyApiPages';
import { LocalAssetSetup } from '../../property/LocalAssetSetup';
import { CommonAssetRequirementsPanel } from '../../property/CommonAssetRequirementsPanel';
import { RoomInventoryReviewPanel } from '../../property/RoomInventoryReviewPanel';
import { CommonAssetInventoryReviewPanel } from '../../property/CommonAssetInventoryReviewPanel';
import { LocationSection } from '../components/LocationSection';

export function LocationAssetsWorkspace({ locationId }: { locationId: string }) {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'review' ? 3 : 0);
  const [reviewScope, setReviewScope] = useState<'rooms' | 'common'>(
    params.get('scope') === 'common' ? 'common' : 'rooms',
  );
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
        <Tab label={owner ? 'Kiểm kê tài sản' : 'Kiểm kê bàn giao'} />
      </Tabs>
      {tab === 0 ? (
        <PropertyApiPage
          kind="assets"
          embedded
          onAssetInventory={
            owner
              ? (scope) => {
                  setReviewScope(scope === 'common' ? 'common' : 'rooms');
                  setTab(3);
                }
              : undefined
          }
        />
      ) : owner && tab === 2 ? (
        <CommonAssetRequirementsPanel key={locationId} locationId={locationId} />
      ) : owner && tab === 3 ? (
        <Stack spacing={2}>
          <Tabs
            value={reviewScope}
            onChange={(_, value: 'rooms' | 'common') => setReviewScope(value)}
            aria-label="Phạm vi kiểm kê tài sản"
          >
            <Tab value="rooms" label="Kiểm kê theo phòng" />
            <Tab value="common" label="Kiểm kê khu vực chung" />
          </Tabs>
          {reviewScope === 'rooms' ? (
            <RoomInventoryReviewPanel
              key={locationId}
              locationId={locationId}
              focusRoomId={params.get('roomId') ?? undefined}
            />
          ) : (
            <CommonAssetInventoryReviewPanel key={locationId} locationId={locationId} />
          )}
        </Stack>
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
