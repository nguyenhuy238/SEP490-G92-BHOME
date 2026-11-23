import { ResourcePage } from '../../../components/common/ResourcePage';
import { IncidentManagementWorkspace } from '../../incidents/IncidentManagementWorkspace';
import { isMockMode } from '../../../services/config';
export default function MaintenancePage() {
  return isMockMode ? (
    <ResourcePage kind="maintenance" variant="table" />
  ) : (
    <IncidentManagementWorkspace maintenance />
  );
}
