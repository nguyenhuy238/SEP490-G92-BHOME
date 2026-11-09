import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { IncidentWorkspace } from '../IncidentWorkspace';
export default function IncidentsPage() {
  return isMockMode ? <ResourcePage kind="incidents" variant="table" /> : <IncidentWorkspace />;
}
