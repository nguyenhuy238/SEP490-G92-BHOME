import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { TasksApiPage } from '../TasksApiPage';
export default function TasksPage() {
  return isMockMode ? <ResourcePage kind="tasks" variant="table" /> : <TasksApiPage />;
}
