import { ResourcePage } from '../../../components/common/ResourcePage';
import { IncidentManagementWorkspace } from '../IncidentManagementWorkspace';
import { isMockMode } from '../../../services/config';
export default function IncidentsPage() {
  return isMockMode ? (
    <ResourcePage kind="incidents" variant="table" />
  ) : (
    <IncidentManagementWorkspace />
  );
}
