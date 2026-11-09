import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { IncidentWorkspace } from '../../incidents/IncidentWorkspace';
export default function MaintenancePage() {
  return isMockMode ? (
    <ResourcePage kind="maintenance" variant="table" />
  ) : (
    <IncidentWorkspace maintenance />
  );
}
