import { ResourcePage } from '../../../components/common/ResourcePage';
import { IncidentWorkspace } from '../IncidentWorkspace';
import { isMockMode } from '../../../services/config';
export default function IncidentsPage() {
  return isMockMode ? <ResourcePage kind="incidents" variant="table" /> : <IncidentWorkspace />;
}
