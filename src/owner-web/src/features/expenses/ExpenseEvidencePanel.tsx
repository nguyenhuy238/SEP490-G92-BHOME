import { ValidatedInput } from '../../components/common/ValidatedForm';
import { useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError } from '../../../../../packages/client-core/src/finance';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { useFinanceApi } from './useFinanceApi';

export function ExpenseEvidencePanel({
  expenseId,
  disabled,
}: {
  expenseId: string;
  disabled: boolean;
}) {
  const api = useFinanceApi();
  const { session } = useAuth();
  const files = useQuery({
    queryKey: ['expense-evidence', session?.userId, expenseId],
    queryFn: ({ signal }) => api.expenseEvidence(expenseId, signal),
  });
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false),
    keys = useRef(new Map<string, string>()),
    input = useRef<HTMLInputElement>(null);
  async function upload() {
    if (!file || lock.current || disabled || files.isPending || files.error) return;
    if (
      !['image/png', 'image/jpeg'].includes(file.type) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      setError('Chọn ảnh PNG/JPEG có dung lượng tối đa 5 MB.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      const identity = `${hash}:${file.type}:${bytes.length}`;
      const existing = files.data?.find(
        (f) => f.sha256 === hash && f.contentType === file.type && f.length === bytes!.length,
      );
      const key = existing?.operationKey || keys.current.get(identity) || crypto.randomUUID();
      keys.current.set(identity, key);
      await api.uploadExpenseEvidence(expenseId, bytes, file.type, key);
      const updated = await files.refetch();
      if (updated.error) throw updated.error;
      setNotice('Đã lưu chứng từ riêng tư.');
      setFile(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError(financeError(e));
    } finally {
      bytes?.fill(0);
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Typography variant="h6">Chứng từ khoản chi</Typography>
      <Typography variant="body2">
        Ảnh PNG/JPEG tối đa 5 MB, chỉ Owner được xem. Không tải giấy tờ cá nhân hoặc thông tin đăng
        nhập ngân hàng.
      </Typography>
      {(error || files.error) && (
        <Alert severity="error">
          {error || financeError(files.error)}
          <Button type="button" onClick={() => void files.refetch()}>
            Tải lại chứng từ
          </Button>
        </Alert>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
      {files.isPending && <Typography>Đang tải danh sách chứng từ…</Typography>}
      {files.data?.length === 0 && <Typography>Chưa có ảnh chứng từ.</Typography>}
      {files.data?.map((f, index) => (
        <Stack key={f.id}>
          <Typography>
            Ảnh {index + 1} ·{' '}
            {f.status === 'Uploaded' ? 'Đã lưu' : 'Chưa tải xong; chọn lại đúng ảnh để thử lại'}
          </Typography>
          {f.status === 'Uploaded' && (
            <PrivateEvidenceViewer
              label={`chứng từ ${index + 1}`}
              filename={`chung-tu-${index + 1}`}
              contentType={f.contentType}
              expectedSize={f.length}
              disabled={busy || disabled}
              fetchBlob={(signal) => api.expenseEvidenceFile(expenseId, f.id, signal)}
              errorMessage={financeError}
            />
          )}
        </Stack>
      ))}
      <ValidatedInput
        ref={input}
        aria-label="Chọn ảnh chứng từ khoản chi"
        type="file"
        accept="image/png,image/jpeg"
        disabled={busy || disabled || files.isPending || !!files.error}
        onChange={(e) => {
          setFile(e.target.files?.[0] || null);
          setError('');
          setNotice('');
        }}
      />
      <Button
        type="button"
        disabled={!file || busy || disabled || files.isPending || !!files.error}
        onClick={() => void upload()}
      >
        {busy ? 'Đang xử lý chứng từ…' : 'Tải lên chứng từ'}
      </Button>
    </Stack>
  );
}
