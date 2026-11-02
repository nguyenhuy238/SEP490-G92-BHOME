import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { PaymentManagementPage } from '../PaymentManagementPage';
export default function PaymentsPage() {
  return isMockMode ? <ResourcePage kind="payments" variant="table" /> : <PaymentManagementPage />;
}
