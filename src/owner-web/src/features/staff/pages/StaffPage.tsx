import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import LiveStaffPage from './LiveStaffPage';
export default function StaffPage() {
  return isMockMode ? <ResourcePage kind="staff" variant="table" /> : <LiveStaffPage />;
}
