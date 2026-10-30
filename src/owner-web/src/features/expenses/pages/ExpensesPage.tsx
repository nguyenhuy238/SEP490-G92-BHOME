import { ResourcePage } from '../../../components/common/ResourcePage';
import { ExpenseCharts } from '../../../components/common/FeaturePanels';
export default function ExpensesPage() {
  return <ResourcePage kind="expenses" variant="table" before={<ExpenseCharts />} />;
}
