import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TenantFeatureDirectory } from '../components/TenantFeatureDirectory';
export function TenantFeaturesScreen() {
  const { contractId } = useLocalSearchParams<{ contractId?: string }>();
  return (
    <TenantFeatureDirectory
      all
      contractId={typeof contractId === 'string' ? contractId : undefined}
    />
  );
}
