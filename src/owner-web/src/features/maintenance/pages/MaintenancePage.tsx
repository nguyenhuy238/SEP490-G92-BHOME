import { ResourcePage } from '../../../components/common/ResourcePage';
import { UnavailableFeaturePage } from '../../../components/common/UnavailableFeaturePage';
import { isMockMode } from '../../../services/config';
export default function MaintenancePage() {
  return isMockMode ? <ResourcePage kind="maintenance" variant="table" /> : <UnavailableFeaturePage
    title="Bảo trì và Work Order"
    description="Owner duyệt phương án/chi phí, theo dõi tiến độ và xác nhận hoàn tất sửa chữa."
    requirements={[
      'Work Order lifecycle độc lập với OperationalTask.',
      'Duyệt phương án, chi phí, yêu cầu làm lại và xác minh hoàn tất.',
      'Bằng chứng trước/sau, lịch sử tài sản và liên kết OperatingExpense.',
    ]}
  />;
}
