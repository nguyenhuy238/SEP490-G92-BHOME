import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { UnifiedWorkPage } from '../UnifiedWorkPage';
export default function TasksPage() {
  return isMockMode ? <ResourcePage kind="tasks" variant="table" /> : <UnifiedWorkPage />;
}
