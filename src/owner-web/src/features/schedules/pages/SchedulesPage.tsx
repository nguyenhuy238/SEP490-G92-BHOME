import { ResourcePage } from '../../../components/common/ResourcePage';
import { ScheduleTools } from '../../../components/common/FeaturePanels';
import { Alert, Button, Stack } from '@mui/material';
import { Link } from 'react-router';
import { PageHeader } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
export default function SchedulesPage() {
  return isMockMode ? (
    <ResourcePage kind="schedules" variant="schedule" before={<ScheduleTools />} />
  ) : (
    <Stack spacing={2}>
      <PageHeader
        title="Lịch làm việc"
        subtitle="Phân công trách nhiệm cơ sở và công việc vận hành."
      />
      <Alert severity="info">
        Phân ca chưa thuộc phạm vi MVP và chưa có luồng API được tích hợp. Không có lịch mẫu hoặc
        thao tác xuất bản lịch trong chế độ API.
      </Alert>
      <Button component={Link} to="/staff">
        Phân công Staff theo cơ sở
      </Button>
      <Button component={Link} to="/tasks">
        Công việc và thời hạn
      </Button>
    </Stack>
  );
}
