import { ResourcePage } from '../../../components/common/ResourcePage';
import { DebtAging } from '../../../components/common/FeaturePanels';
import { isMockMode } from '../../../services/config';
import { PaymentManagementPage } from '../../payments/PaymentManagementPage';
export default function DebtsPage() {
  return isMockMode ? (
    <ResourcePage kind="debts" variant="table" before={<DebtAging />} />
  ) : (
    <PaymentManagementPage debtOnly />
  );
}
