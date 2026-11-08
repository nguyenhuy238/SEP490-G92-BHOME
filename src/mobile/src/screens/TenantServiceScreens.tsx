import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import { IncidentListScreen } from '../features/incidents/IncidentScreens';
import React from 'react';
export { TenantResidenceScreen } from './TenantResidenceScreen';

export function TenantIncidentScreen() {
  return <IncidentReportForm />;
}
export function TenantRequestsScreen() {
  return <IncidentListScreen />;
}
