import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { TenantsApiPage } from '../TenantsApiPage';
export default function TenantsPage() {
  return isMockMode ? <ResourcePage kind="tenants" variant="table" /> : <TenantsApiPage />;
}
