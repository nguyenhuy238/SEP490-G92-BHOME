import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Heading } from '../../../components/WorkspaceKit';
import { TenantFeatureDirectory } from '../../../components/TenantFeatureDirectory';
export function TenantFeaturesScreen() {
  const { contractId } = useLocalSearchParams<{ contractId?: string }>();
  return (
    <>
      <Heading
        title="Tất cả chức năng"
        detail="Chọn công việc bạn cần, không phải tìm trong nhiều màn hình."
      />
      <TenantFeatureDirectory
        all
        contractId={typeof contractId === 'string' ? contractId : undefined}
      />
    </>
  );
}
