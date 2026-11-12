import { useState } from 'react';
import { Alert, Button } from '@mui/material';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';

export function ConflictReload({ error, reload }: { error: unknown; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  return (
    <Alert
      severity="warning"
      action={
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailure('');
            void reload()
              .catch((e) => setFailure(invoiceError(e)))
              .finally(() => setBusy(false));
          }}
        >
          Bỏ bản nhập & tải bản mới
        </Button>
      }
    >
      Dữ liệu đang nhập được giữ nguyên. Hãy kiểm tra xung đột trước khi thử lại. Nút tải bản mới sẽ
      thay nội dung đang nhập bằng dữ liệu đã lưu.
      {failure && ` ${failure}`}
    </Alert>
  );
}
