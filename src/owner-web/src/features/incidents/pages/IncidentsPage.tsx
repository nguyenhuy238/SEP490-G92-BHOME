import { ResourcePage } from '../../../components/common/ResourcePage';
import { UnavailableFeaturePage } from '../../../components/common/UnavailableFeaturePage';
import { isMockMode } from '../../../services/config';
export default function IncidentsPage() {
  return isMockMode ? <ResourcePage kind="incidents" variant="table" /> : <UnavailableFeaturePage
    title="Sự cố và tình huống khẩn cấp"
    description="Tiếp nhận, phân loại và theo dõi sự cố trong phạm vi cơ sở của Owner."
    requirements={[
      'Danh sách/chi tiết Incident có phân trang và phạm vi Location.',
      'Owner review, phân loại, từ chối/trùng lặp và tạo Work Order.',
      'Lịch sử, bằng chứng riêng tư, concurrency và audit cho mọi quyết định.',
    ]}
  />;
}
