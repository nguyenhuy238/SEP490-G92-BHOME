import { TextField } from '../../../components/common/ValidatedForm';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { DrawnSignature } from '../../../../../../packages/client-core/src/signing';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { PrivateEvidenceViewer } from '../../../components/common/PrivateEvidenceViewer';
import { useOwnerAction } from '../../../hooks/useOwnerWorkspace';
import { useMeterApi } from '../../meters/useMeterApi';
import { DrawPad } from '../../contracts/OwnerSigningPanel';
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
  const [reworkNote, setReworkNote] = useState('');
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
  const needsApproval =
    task.status === 'PendingVerification' && (!data || data.status === 'Superseded');
  const reviewed = reviewedVersion === task.version;

  async function approve() {
    if (!reviewed || !needsApproval || action.busy) return;
    const ok = await action.run(
      () =>
        action.command(path + '/approve', 'POST', {
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

  async function sign(ink: DrawnSignature) {
    if (!data || data.status !== 'PendingOwnerSignature' || action.busy) return;
    const ok = await action.run(
      () =>
        action.command(path + '/sign', 'POST', {
          revision: data.revision,
          snapshotSha256: data.snapshotSha256,
          confirmed: true,
          ink,
        }),
      'Đã ký trực tiếp biên bản bàn giao.',
    );
    if (ok) {
      await report.refetch();
      notify('Owner đã ký. Đang chờ Staff xác nhận cùng phiên bản.');
    }
  }

  async function requestRework() {
    const note = reworkNote.trim();
    if (
      task.status !== 'PendingVerification' ||
      !reworkItemIds.length ||
      note.length < 10 ||
      action.busy ||
      data?.staffSignature
    )
      return;
    const ok = await action.run(
      () =>
        action.command(path + '/rework', 'POST', {
          taskVersion: task.version,
          itemIds: reworkItemIds,
          note,
        }),
      'Đã yêu cầu Staff kiểm tra lại các mục được chọn.',
    );
    if (ok) {
      setReworkNote('');
      setReviewedVersion(null);
      await report.refetch();
      onReworked?.();
      notify('Đã chuyển công việc về đang thực hiện. Staff cần kiểm tra lại các mục được chọn.');
    }
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="h6" sx={{ fontSize: 17, fontWeight: 700 }}>
          Biên bản bàn giao tài sản
        </Typography>
        <Button
          size="small"
          onClick={() => void report.refetch()}
          disabled={report.isFetching || action.busy}
        >
          Tải lại biên bản
        </Button>
      </Stack>
      <OwnerFeedback busy={report.isFetching || action.busy} error={report.error || action.error} />
      {report.error && <Button onClick={() => void report.refetch()}>Tải lại biên bản</Button>}
      {!report.isPending && !report.error && needsApproval && (
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 14 }}>
            Staff đã nộp kết quả kiểm kê. Kiểm tra checklist và lịch sử báo cáo ở trên trước khi
            duyệt.
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
            control={
              <Checkbox
                checked={reviewed}
                onChange={(_, value) => setReviewedVersion(value ? task.version : null)}
              />
            }
          />
          <Button
            variant="contained"
            disabled={!reviewed || action.busy}
            onClick={() => void approve()}
          >
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
            disabled={
              action.busy ||
              !reworkItemIds.length ||
              reworkNote.trim().length < 10 ||
              !!data?.staffSignature
            }
            onClick={() => void requestRework()}
          >
            Gửi yêu cầu kiểm tra lại
          </Button>
        </Stack>
      )}
      {data && (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography sx={{ fontSize: 15, fontWeight: 700, mr: 'auto' }}>
                Biên bản phiên bản {data.revision}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={
                  data.status === 'Completed'
                    ? 'success'
                    : data.status === 'Superseded'
                      ? 'error'
                      : 'primary'
                }
                label={
                  data.status === 'Completed'
                    ? 'Đã hoàn tất'
                    : data.status === 'PendingOwnerSignature'
                      ? 'Chờ Owner ký'
                      : data.status === 'PendingStaffSignature'
                        ? 'Chờ Staff ký'
                        : 'Đã thay thế'
                }
              />
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={`${data.totalItems} mục tài sản`} />
              <Chip
                size="small"
                variant="outlined"
                label={`${data.directItems} kiểm kê trực tiếp`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`${data.inheritedItems} kế thừa Tenant`}
              />
            </Stack>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Owner duyệt: {formatInstant(data.approvedAt)}
            </Typography>
            <Divider />
            <Stack spacing={0.5}>
              <Typography sx={{ fontSize: 14, fontWeight: 650 }}>Tài liệu bàn giao</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                {data.status === 'Completed'
                  ? 'PDF chính thức có chữ ký của Owner và Staff.'
                  : data.status === 'PendingStaffSignature'
                    ? 'PDF đã có chữ ký Owner. Staff sẽ đối chiếu trước khi ký nhận.'
                    : 'Kiểm tra toàn bộ PDF trước khi ký xác nhận.'}
              </Typography>
              <PrivateEvidenceViewer
                key={`${data.revision}:${data.snapshotSha256}:${data.status}`}
                label={`biên bản bàn giao tài sản phiên bản ${data.revision}`}
                filename={`bien-ban-tai-san-${task.id}-v${data.revision}.pdf`}
                contentType="application/pdf"
                fetchBlob={(signal) => request<Blob>(path + '/document', { signal }, 'blob')}
                disabled={action.busy}
                compactActions
              />
            </Stack>
            <Accordion variant="outlined" disableGutters sx={{ '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Thông tin xác thực</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <Stack spacing={1}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Phiên bản biên bản: {data.revision} · Phiên bản công việc: {data.taskVersion}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Người phê duyệt: {data.approvedBy}
                  </Typography>
                  <Box sx={{ overflowWrap: 'anywhere' }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
                      SHA-256 nội dung kiểm kê
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {data.snapshotSha256}
                    </Typography>
                  </Box>
                  <Box sx={{ overflowWrap: 'anywhere' }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
                      SHA-256 tài liệu PDF
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {data.pdfSha256}
                    </Typography>
                  </Box>
                </Stack>
              </AccordionDetails>
            </Accordion>
            {data.exceptionDecision && (
              <Alert severity="info">Quyết định ngoại lệ: {data.exceptionDecision}</Alert>
            )}
            {data.status === 'Superseded' && (
              <Alert severity="warning">
                Phân công hoặc dữ liệu đã đổi sau khi lập biên bản. Tải lại công việc và kiểm tra
                phiên bản mới.
              </Alert>
            )}
            {data.status === 'PendingOwnerSignature' && (
              <OwnerHandoverSignature
                key={`${task.version}:${data.revision}:${data.snapshotSha256}`}
                busy={action.busy}
                onSign={(ink) => void sign(ink)}
              />
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
              <Alert severity="success">
                Hai bên đã xác nhận bàn giao. PDF cuối cùng đã sẵn sàng lưu trữ.
              </Alert>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function OwnerHandoverSignature({
  busy,
  onSign,
}: {
  busy: boolean;
  onSign: (ink: DrawnSignature) => void;
}) {
  const [ink, setInk] = useState<DrawnSignature | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Stack spacing={1.5} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Owner ký bàn giao</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
        Đọc và đối chiếu PDF ở trên, sau đó dùng chuột hoặc cảm ứng để ký trong ô bên dưới.
      </Typography>
      <DrawPad onChange={setInk} disabled={busy} />
      <FormControlLabel
        label="Tôi đã xem biên bản phiên bản này và đồng ý ký xác nhận bằng chữ ký tay của mình"
        control={
          <Checkbox
            checked={confirmed}
            disabled={busy}
            onChange={(_, value) => setConfirmed(value)}
          />
        }
      />
      <Button
        variant="contained"
        disabled={!confirmed || !ink || busy}
        onClick={() => ink && confirmed && onSign(ink)}
        sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
      >
        Owner ký xác nhận
      </Button>
    </Stack>
  );
}
