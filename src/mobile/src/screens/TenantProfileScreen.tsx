import React from 'react';
import { ProfileScreen } from './ProfileScreen';

// Compatibility entry point; all roles now use the same API-backed screen.
export function TenantProfileScreen() {
  return <ProfileScreen />;
}
