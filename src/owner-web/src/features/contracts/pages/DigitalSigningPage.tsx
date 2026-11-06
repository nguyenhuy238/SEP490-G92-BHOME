import { Alert, Paper, Stack, Typography } from '@mui/material';
import { useContractsApi, useSigningApi } from '../useContractsApi';
import { SigningCertificates } from '../SigningCertificates';
import { SignatureImagePanel } from '../SignatureImagePanel';
import { ViettelSettingsPanel } from '../ViettelSettingsPanel';
import { isMockMode } from '../../../services/config';

// "Ký số": everything a signer prepares once, before any contract — the Viettel MySign account (Owner), their
// MySign certificate and their signature picture. Signing itself happens on the contract (Yêu cầu ký MySign).
export default function DigitalSigningPage() {
  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <div>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Ký số hợp đồng (Viettel MySign)
        </Typography>
        <Typography color="text.secondary">
          Chuẩn bị một lần: tài khoản Viettel MySign, chứng thư của bạn và ảnh chữ ký. Sau đó vào
          Hợp đồng → chọn hợp đồng → Yêu cầu ký MySign.
        </Typography>
      </div>
      {isMockMode ? (
        <Alert severity="info">
          Ký số dùng tài khoản và chứng thư thật, chỉ hoạt động ở chế độ API (VITE_API_MODE=api).
        </Alert>
      ) : (
        <LiveDigitalSigningPage />
      )}
    </Stack>
  );
}
function LiveDigitalSigningPage() {
  const api = useContractsApi();
  const signing = useSigningApi(api);
  return (
    <>
      <Alert severity="info">
        Khóa bí mật nằm ở Viettel: BHOME chỉ gửi mã băm của hợp đồng, bạn xác nhận ký trên ứng dụng
        MySign. Mỗi lần ký thật tốn một lượt trong gói MySign.
      </Alert>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <ViettelSettingsPanel signing={signing} />
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SigningCertificates api={api} />
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SignatureImagePanel signing={signing} />
      </Paper>
    </>
  );
}
