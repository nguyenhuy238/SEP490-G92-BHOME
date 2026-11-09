import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { StaffApiPage } from '../StaffApiPage';
export default function StaffPage() {
  return isMockMode ? <ResourcePage kind="staff" variant="table" /> : <StaffApiPage />;
}
