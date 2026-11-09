import { ResourcePage } from '../../../components/common/ResourcePage';
import { IncidentWorkspace } from '../../incidents/IncidentWorkspace';
import { isMockMode } from '../../../services/config';
export default function MaintenancePage() {
  return isMockMode ? (
    <ResourcePage kind="maintenance" variant="table" />
  ) : (
    <IncidentWorkspace maintenance />
  );
}
