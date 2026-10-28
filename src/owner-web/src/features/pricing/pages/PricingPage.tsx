import { ResourcePage } from '../../../components/common/ResourcePage';
import { PricingPanel } from '../../../components/common/FeaturePanels';
export default function PricingPage() {
  return <ResourcePage kind="pricing" variant="table" before={<PricingPanel />} />;
}
