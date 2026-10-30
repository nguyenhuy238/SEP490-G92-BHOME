import { ResourcePage } from '../../../components/common/ResourcePage';
import { DebtAging } from '../../../components/common/FeaturePanels';
export default function DebtsPage() {
  return <ResourcePage kind="debts" variant="table" before={<DebtAging />} />;
}
