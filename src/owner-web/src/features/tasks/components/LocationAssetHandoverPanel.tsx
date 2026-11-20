import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerAction } from '../../../hooks/useOwnerWorkspace';
import { useMeterApi } from '../../meters/useMeterApi';
import type { OwnerTask } from '../taskContracts';
import { taskRoot } from '../useOperationalTasksApi';

interface Acceptance {
  actorId: string;
  signedAt: string;
  method: string;
  snapshotSha256: string;
}
export interface LocationAssetHandoverReport {
  taskId: string;
  locationId: string;
  assignmentId: string;
  staffId: string;
  taskVersion: number;
  revision: number;
  status: 'PendingOwnerSignature' | 'PendingStaffSignature' | 'Completed' | 'Superseded';
  totalItems: number;
  directItems: number;
  inheritedItems: number;
  snapshotSha256: string;
  pdfSha256: string;
  approvedAt: string;
  approvedBy: string;
  exceptionDecision: string | null;
  ownerSignature: Acceptance | null;
  staffSignature: Acceptance | null;
  canDownloadFinal: boolean;
}

export function LocationAssetHandoverPanel({
  task,
  notify,
  reworkItemIds = [],
  onReworked,
}: {
  task: OwnerTask;
  notify: (message: string) => void;
  reworkItemIds?: string[];
  onReworked?: () => void;
}) {
  const path = `${taskRoot}/${task.id}/location-asset-handover`;
  const { session } = useAuth();
  const { request } = useMeterApi();
  const action = useOwnerAction();
  const [decision, setDecision] = useState('');
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [reworkNote, setReworkNote] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const report = useQuery({
    queryKey: ['owner-workspace', session?.userId, 'location-asset-handover', task.id],
    enabled: !!session?.roles.includes('Owner'),
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 1,
    queryFn: async ({ signal }): Promise<LocationAssetHandoverReport | null> => {
      try {
        return await request<LocationAssetHandoverReport>(path, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const data = report.data;
  const needsApproval = task.status === 'PendingVerification' && (!data || data.status === 'Superseded');
  const reviewed = reviewedVersion === task.version;
  const signatureKey = data ? `${data.revision}:${data.snapshotSha256}:${data.status}` : '';
  const confirmed = !!signatureKey && confirmedKey === signatureKey;

  async function approve() {
    if (!reviewed || !needsApproval || action.busy) return;
    const ok = await action.run(
      () => action.command(path + '/approve', 'POST', {
        taskVersion: task.version,
        exceptionDecision: decision.trim() || null,
      }),
      'Đã đối soát và tạo biên bản bàn giao.',
    );
    if (ok) {
      setReviewedVersion(null);
      await report.refetch();
      notify('Đã tạo biên bản. Owner cần xem PDF và ký xác nhận.');
    }
  }

  async function sign() {
    if (!data || data.status !== 'PendingOwnerSignature' || !confirmed || action.busy) return;
    const ok = await action.run(
      () => action.command(path + '/sign', 'POST', {
        revision: data.revision,
        snapshotSha256: data.snapshotSha256,
        confirmed: true,
      }),
      'Đã ký xác nhận điện tử biên bản.',
    );
    if (ok) {
      setConfirmedKey(null);
      await report.refetch();
      notify('Owner đã ký. Đang chờ Staff xác nhận cùng phiên bản.');
    }
  }

  async function requestRework() {
    const note = reworkNote.trim();
    if (task.status !== 'PendingVerification' || !reworkItemIds.length ||
        note.length < 10 || action.busy || data?.staffSignature) return;
    const ok = await action.run(
      () => action.command(path + '/rework', 'POST', {
        taskVersion: task.version,
        itemIds: reworkItemIds,
        note,
      }),
      'Đã yêu cầu Staff kiểm tra lại các mục được chọn.',
    );
    if (ok) {
      setReworkNote('');
      setReviewedVersion(null);
      setConfirmedKey(null);
      await report.refetch();
      onReworked?.();
      notify('Đã chuyển công việc về đang thực hiện. Staff cần kiểm tra lại các mục được chọn.');
    }
  }

  async function document() {
    if (!data || downloadBusy) return;
    setDownloadError('');
    setDownloadBusy(true);
    let url = '';
    try {
      const blob = await request<Blob>(path + '/document', {}, 'blob');
      url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `bien-ban-tai-san-${task.id}.pdf`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setDownloadError('Không mở được PDF. Hãy tải lại biên bản và thử lại.');
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadBusy(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" sx={{ fontSize: 16 }}>
        Duyệt và ký biên bản bàn giao tài sản
      </Typography>
      <Button onClick={() => void report.refetch()} sx={{ alignSelf: 'flex-start' }}
        disabled={report.isFetching || action.busy}>
        Tải lại biên bản
      </Button>
      <OwnerFeedback busy={report.isFetching || action.busy} error={report.error || action.error} />
      {report.error && <Button onClick={() => void report.refetch()}>Tải lại biên bản</Button>}
      {!report.isPending && !report.error && needsApproval && (
        <Stack spacing={1.5}>
            <Typography sx={{ fontSize: 14 }}>
              Staff đã nộp kết quả kiểm kê. Kiểm tra checklist và lịch sử báo cáo ở trên trước khi duyệt.
            </Typography>
            <TextField
              multiline
              minRows={2}
              label="Quyết định ngoại lệ / cách xử lý vướng mắc (khi cần)"
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              disabled={action.busy}
              helperText="Cần ghi quyết định nếu có sự cố chưa xử lý xong hoặc danh sách kiểm kê trống."
            />
            <FormControlLabel
              label="Tôi đã đối chiếu đầy đủ tài sản, hồ sơ Tenant và các vướng mắc"
              control={<Checkbox checked={reviewed} onChange={(_, value) =>
                setReviewedVersion(value ? task.version : null)} />}
            />
            <Button variant="contained" disabled={!reviewed || action.busy}
              onClick={() => void approve()}>
              Duyệt và lập biên bản
            </Button>
        </Stack>
      )}
      {!report.isPending && !report.error && !data && !needsApproval && (
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          Biên bản được lập sau khi Staff kiểm kê và gửi kết quả cho Owner.
        </Typography>
      )}
      {task.status === 'PendingVerification' && (
        <Stack spacing={1.5} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Yêu cầu kiểm tra lại</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Đã chọn {reworkItemIds.length} tài sản từ danh sách kiểm kê phía trên.
          </Typography>
          <TextField
            label="Nội dung cần Staff kiểm tra lại"
            multiline
            minRows={2}
            value={reworkNote}
            onChange={(event) => setReworkNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
            helperText="Mô tả rõ vướng mắc hoặc mục cần đối chiếu lại (ít nhất 10 ký tự)."
            disabled={action.busy}
          />
          <Button
            variant="outlined"
            color="warning"
            disabled={action.busy || !reworkItemIds.length || reworkNote.trim().length < 10 ||
              !!data?.staffSignature}
            onClick={() => void requestRework()}
          >
            Gửi yêu cầu kiểm tra lại
          </Button>
        </Stack>
      )}
      {data && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 14 }}>Phiên bản biên bản: {data.revision}</Typography>
            <Typography sx={{ fontSize: 14 }}>
              Tài sản: {data.totalItems} mục (tự kiểm tra {data.directItems}; kế thừa {data.inheritedItems})
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Chủ cơ sở duyệt: {formatInstant(data.approvedAt)}
          </Typography>
          <Box sx={{ overflowWrap: 'anywhere' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Mã đối chiếu nội dung SHA-256</Typography>
            <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{data.snapshotSha256}</Typography>
          </Box>
          {data.exceptionDecision && (
            <Alert severity="info">Quyết định ngoại lệ: {data.exceptionDecision}</Alert>
          )}
          <Button variant="outlined" disabled={downloadBusy} onClick={() => void document()}>
            {downloadBusy ? 'Đang tải PDF…' : 'Xem / lưu biên bản PDF'}
          </Button>
          {!!downloadError && <Alert severity="error">{downloadError}</Alert>}
          {data.status === 'Superseded' && (
            <Alert severity="warning">
              Phân công hoặc dữ liệu đã đổi sau khi lập biên bản. Tải lại công việc và kiểm tra phiên bản mới.
            </Alert>
          )}
          {data.status === 'PendingOwnerSignature' && (
            <Stack spacing={1}>
              <Typography sx={{ fontSize: 14 }}>
                Mở PDF và đối chiếu mã nội dung trước khi ký xác nhận.
              </Typography>
              <FormControlLabel
                label="Tôi đã xem biên bản phiên bản này và đồng ý ký xác nhận bằng tài khoản Owner đang đăng nhập"
                control={<Checkbox checked={confirmed} onChange={(_, value) =>
                  setConfirmedKey(value ? signatureKey : null)} />}
              />
              <Button variant="contained" disabled={!confirmed || action.busy}
                onClick={() => void sign()}>Owner ký xác nhận</Button>
            </Stack>
          )}
          {data.ownerSignature && (
            <Typography sx={{ fontSize: 13 }}>
              Owner đã ký: {formatInstant(data.ownerSignature.signedAt)}
            </Typography>
          )}
          {data.status === 'PendingStaffSignature' && (
            <Alert severity="info">
              Owner đã ký. Staff cần đọc và ký xác nhận đúng phiên bản này để hoàn tất bàn giao.
            </Alert>
          )}
          {data.staffSignature && (
            <Typography sx={{ fontSize: 13 }}>
              Staff đã ký: {formatInstant(data.staffSignature.signedAt)}
            </Typography>
          )}
          {data.status === 'Completed' && (
            <Alert severity="success">Hai bên đã xác nhận bàn giao. PDF cuối cùng đã sẵn sàng lưu trữ.</Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}
