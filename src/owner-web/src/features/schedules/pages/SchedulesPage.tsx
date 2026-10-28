import { ResourcePage } from '../../../components/common/ResourcePage';
import { ScheduleTools } from '../../../components/common/FeaturePanels';
export default function SchedulesPage() {
  return <ResourcePage kind="schedules" variant="schedule" before={<ScheduleTools />} />;
}
