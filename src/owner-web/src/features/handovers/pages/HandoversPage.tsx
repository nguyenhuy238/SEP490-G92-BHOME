import { ResourcePage } from '../../../components/common/ResourcePage';
import { Alert } from '@mui/material';
import { isMockMode } from '../../../services/config';
import ContractsPage from '../../contracts/pages/ContractsPage';
export default function HandoversPage() {
  return isMockMode ? (
    <ResourcePage kind="handovers" variant="handover" />
  ) : (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Mở chi tiết hợp đồng Active để xem biên bản nhận phòng, các xác nhận và lịch sử. Staff lập
        biên bản trên Mobile.
      </Alert>
      <ContractsPage />
    </>
  );
}
