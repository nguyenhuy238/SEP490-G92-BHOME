import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import {
  contractError,
  mutationKeys,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { useContractsApi, useMainDraftApi } from './useContractsApi';
import { ContractDocumentViewer } from './ContractDocumentViewer';
import { contractPdfName } from '../../../../../packages/client-core/src/contractPdfName';

export function MainDraftReleasePanel({
  draft,
  disabled,
  onReleased,
}: {
  draft: MainDraftView;
  disabled: boolean;
  onReleased: () => void;
}) {
  const api = useMainDraftApi(),
    contracts = useContractsApi();
  const { session } = useAuth();
  const representative = useQuery({
    queryKey: ['main-draft-representative', session?.userId, draft.input?.representativeResidentId],
    enabled: !!draft.input?.representativeResidentId,
    queryFn: ({ signal }) =>
      contracts.transport<{
        id: string;
        roomId: string | null;
        verificationStatus: string;
        residentType: string;
        tenantUserId: string | null;
      }>('/api/v1/residents/' + draft.input.representativeResidentId, { signal }),
  });
  const signer = representative.data;
  const validSigner =
    !!signer &&
    signer.id === draft.input?.representativeResidentId &&
    signer.roomId === draft.input?.roomId &&
    signer.verificationStatus === 'Verified' &&
    signer.residentType === 'Representative';
  const [file, setFile] = useState<PreviewDocument | null>(null),
    [url, setUrl] = useState('');
  const [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    active = useRef(true),
    objectUrl = useRef('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  function message(e: unknown) {
    const code = (e as { code?: string })?.code;
    return (code && mainDraftMessages[code]) || contractError(e);
  }
  async function preview() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setReviewed(false);
    try {
      const next = await api.signingReview(draft.id);
      const bytes = await api.file(draft.id, next.id);
      try {
        if (active.current) {
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          setFile(next);
          setUrl(objectUrl.current);
        }
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function release() {
    if (lock.current || disabled || !file || !reviewed || !validSigner) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const input = {
      tenantUserId: signer?.tenantUserId ?? null,
      expectedVersion: draft.version,
      reviewedFileId: file.id,
      humanReviewed: true,
    };
    try {
      await api.release(draft.id, input, keys.get('main-draft-release', input));
      keys.confirmed('main-draft-release', input);
      if (active.current) onReleased();
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Chuyển bản nháp sang ký</Typography>
      <Alert severity="info">
        Owner duyệt PDF của phiên bản đã lưu. Người ở mới ký bằng OTP trước khi tạo tài khoản.
        Chuyển sang ký chưa có nghĩa đã ký hoặc đã thanh toán; backend tiếp tục kiểm tra trước khi
        kích hoạt.
      </Alert>
      {disabled && (
        <Alert severity="info">Lưu thay đổi bản nháp trước khi tạo tài liệu đưa đi ký.</Alert>
      )}
      {(error || representative.error) && (
        <Alert severity="error">{error || message(representative.error)}</Alert>
      )}
      <Typography>
        Người đại diện:{' '}
        {draft.preparation?.residents.find(
          (person) => person.id === draft.input?.representativeResidentId,
        )?.fullName ?? 'Theo hồ sơ đã xác minh'}
      </Typography>
      {representative.isPending && (
        <Alert severity="info">Đang kiểm tra hồ sơ người đại diện…</Alert>
      )}
      {!representative.isPending && !validSigner && !representative.error && (
        <Alert severity="warning">
          Chưa xác minh được đúng người đại diện của phòng. Tải lại hồ sơ trước khi chuyển sang ký.
        </Alert>
      )}
      <Button disabled={busy || disabled} onClick={() => void preview()}>
        {busy ? 'Đang xử lý…' : 'Tạo và xem PDF đưa đi ký'}
      </Button>
      {url && (
        <ContractDocumentViewer
          title="PDF được chọn để đưa đi ký"
          url={url}
          filename={contractPdfName('Main', draft.id)}
        />
      )}
      <FormControlLabel
        label="Tôi đã xem đúng PDF trên và xác nhận người đại diện"
        control={
          <Checkbox
            checked={reviewed}
            disabled={!url || busy || disabled}
            onChange={(_, value) => setReviewed(value)}
          />
        }
      />
      <Button
        variant="contained"
        disabled={!reviewed || !file || busy || disabled || !validSigner}
        onClick={() => void release()}
      >
        Xác nhận chuyển sang ký
      </Button>
    </Stack>
  );
}
