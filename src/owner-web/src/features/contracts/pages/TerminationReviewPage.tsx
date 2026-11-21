import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  contractError,
  displayContractDate,
  type MoveOut,
} from '../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { useContractsApi } from '../useContractsApi';

const title = 'Yêu cầu kết thúc hợp đồng';
const labels = {
  Requested: 'Chờ phê duyệt',
  Approved: 'Đã chấp nhận',
  Rejected: 'Đã từ chối',
} as const;
const colors = { Requested: 'warning', Approved: 'success', Rejected: 'error' } as const;

export default function TerminationReviewPage() {
  const { contractId = '' } = useParams();
  return <TerminationReview key={contractId} id={contractId} />;
}

function TerminationReview({ id }: { id: string }) {
  const api = useContractsApi();
  const { session } = useAuth();
  const cache = useQueryClient();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const queryKey = ['contract-termination-review', session?.userId, id];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.terminationReview(id, signal),
    retry: false,
  });
  const [decisionDialog, setDecisionDialog] = useState<{
    action: 'approve' | 'reject';
    version: number;
  } | null>(null);
  const dialog = decisionDialog?.action;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string }>();
  const submission = useRef<{
    action: string;
    reason: string;
    version: number;
    key: string;
  } | null>(null);
  const lock = useRef(false);
  const review = query.data;
  const pending = review?.status === 'Requested';

  function openDecision(action: 'approve' | 'reject') {
    if (!review) return;
    setReason('');
    setMessage(undefined);
    setDecisionDialog({ action, version: review.version });
  }

  async function decide() {
    if (!decisionDialog || !pending || lock.current || (dialog === 'reject' && !reason.trim()))
      return;
    const { action: decision, version } = decisionDialog;
    const note = decision === 'reject' ? reason.trim() : '';
    if (
      submission.current?.action !== decision ||
      submission.current.reason !== note ||
      submission.current.version !== version
    ) {
      submission.current = { action: decision, reason: note, version, key: crypto.randomUUID() };
    }
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const updated = await api.mutate<MoveOut>(
        id,
        decision === 'approve' ? `move-out/approve?expectedVersion=${version}` : 'move-out/reject',
        decision === 'reject' ? { reason: note, expectedVersion: version } : {},
        submission.current.key,
      );
      cache.setQueryData(queryKey, {
        ...review,
        version: updated.version,
        status: decision === 'approve' ? 'Approved' : 'Rejected',
        ...(decision === 'reject' ? { rejectionReason: note } : {}),
      });
      setDecisionDialog(null);
      setMessage({
        severity: 'success',
        text: decision === 'approve' ? 'Đã chấp nhận yêu cầu.' : 'Đã từ chối yêu cầu.',
      });
      await Promise.all([
        query.refetch(),
        cache.invalidateQueries({ queryKey: ['contracts'] }),
        cache.invalidateQueries({ queryKey: ['contract-workflow', id] }),
        cache.invalidateQueries({ queryKey: ['contract-expiry-reminders'] }),
        cache.invalidateQueries({ queryKey: ['notification-list'] }),
      ]);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 409
      ) {
        setDecisionDialog(null);
        await query.refetch();
        setMessage({
          severity: 'error',
          text: 'Yêu cầu đã thay đổi. Vui lòng kiểm tra trạng thái mới trước khi tiếp tục.',
        });
      } else {
        setMessage({ severity: 'error', text: contractError(error) });
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 820, mx: 'auto', minWidth: 0 }}>
      <Box>
        <Button
          component={Link}
          to={`/contracts?contractId=${encodeURIComponent(id)}`}
          sx={{ mb: 1 }}
        >
          Về chi tiết hợp đồng
        </Button>
        <Typography component="h1" variant="h4">
          {title}
        </Typography>
      </Box>
      {query.isPending && <LinearProgress aria-label="Đang tải yêu cầu" />}
      {query.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void query.refetch()}>Tải lại</Button>}
        >
          {contractError(query.error)}
        </Alert>
      )}
      {message && !dialog && <Alert severity={message.severity}>{message.text}</Alert>}
      {review && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <Stack spacing={2.5}>
            <Box>
              <Chip label={labels[review.status]} color={colors[review.status]} size="small" />
            </Box>
            <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.75 }}>
              {[
                ['Cơ sở', review.locationName],
                ['Phòng', review.roomNumber],
                ['Người thuê', review.tenantName || 'Chưa có thông tin'],
                [
                  'Thời hạn hợp đồng',
                  `${displayContractDate(review.startDate)} – ${displayContractDate(review.endDate)}`,
                ],
                ['Ngày đề xuất kết thúc', displayContractDate(review.proposedDate)],
                ['Lý do kết thúc', review.reason],
                ...(!pending
                  ? [
                      ['Người xét duyệt', review.decidedBy || 'Chưa có thông tin'],
                      [
                        'Thời điểm xét duyệt',
                        review.decidedAt ? formatInstant(review.decidedAt) : 'Chưa có thông tin',
                      ],
                    ]
                  : []),
                ...(review.status === 'Rejected'
                  ? [['Lý do từ chối', review.rejectionReason]]
                  : []),
              ].map(([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '190px minmax(0, 1fr)' },
                    gap: { xs: 0.25, sm: 2 },
                  }}
                >
                  <Typography component="dt" variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    sx={{ m: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                  >
                    {value || '—'}
                  </Typography>
                </Box>
              ))}
            </Box>
            {pending && (
              <>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}
                >
                  Vui lòng kiểm tra thông tin trước khi quyết định. Chấp nhận yêu cầu sẽ chuyển hồ
                  sơ sang quy trình trả phòng tiếp theo, không kết thúc hợp đồng ngay lập tức.
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'flex-end' }}
                >
                  <Button
                    variant="outlined"
                    disabled={busy || query.isError}
                    onClick={() => openDecision('reject')}
                  >
                    Từ chối
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy || query.isError}
                    onClick={() => openDecision('approve')}
                  >
                    Chấp nhận yêu cầu
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Paper>
      )}
      <Dialog
        open={!!dialog}
        onClose={() => !busy && setDecisionDialog(null)}
        fullWidth
        fullScreen={narrow}
        maxWidth="xs"
        aria-labelledby="termination-decision-title"
      >
        <DialogTitle id="termination-decision-title">
          {dialog === 'reject'
            ? 'Từ chối yêu cầu kết thúc hợp đồng'
            : 'Chấp nhận yêu cầu kết thúc hợp đồng?'}
        </DialogTitle>
        <DialogContent>
          {dialog === 'reject' ? (
            <TextField
              autoFocus
              required
              fullWidth
              multiline
              minRows={3}
              margin="dense"
              label="Lý do từ chối"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          ) : (
            <DialogContentText>
              Yêu cầu sẽ được phê duyệt và chuyển sang quy trình xử lý trả phòng. Hợp đồng vẫn còn
              hiệu lực cho đến khi hoàn tất các thủ tục liên quan.
            </DialogContentText>
          )}
          {message?.severity === 'error' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {message.text}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDecisionDialog(null)}>
            Hủy
          </Button>
          <Button
            variant="contained"
            color={dialog === 'reject' ? 'error' : 'primary'}
            disabled={busy || !pending || (dialog === 'reject' && !reason.trim())}
            onClick={() => void decide()}
          >
            {dialog === 'reject' ? 'Xác nhận từ chối' : 'Xác nhận chấp nhận'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
