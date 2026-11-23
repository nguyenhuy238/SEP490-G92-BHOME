import { ValidatedInput } from '../../../components/common/ValidatedForm';
import { TextField } from '../../../components/common/ValidatedForm';
import { useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowRight, RefreshCw, WalletCards, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { formatContractMoney } from '../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { TenantRefundPetition } from '../../../../../../packages/client-core/src/refunds';
import { LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { OwnerPagination, OwnerTable } from '../../../components/common/OwnerWorkspace';
import { PrivateEvidenceViewer } from '../../../components/common/PrivateEvidenceViewer';
import { ownerError } from '../../../hooks/useOwnerWorkspace';
import { isMockMode } from '../../../services/config';
import { useTenantRefundRequestsApi } from '../useTenantRefundRequestsApi';

const PAGE_SIZE = 20;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

const labelByStatus: Record<string, string> = {
  REQUESTED: 'Chờ Owner duyệt',
  APPROVED: 'Đã duyệt · chờ hoàn tiền',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Đã ghi nhận hoàn tiền',
};

function statusOf(status: string) {
  return status.toUpperCase();
}

function RefundStatus({ status }: { status: string }) {
  const current = statusOf(status);
  const color =
    current === 'COMPLETED'
      ? 'success'
      : current === 'REJECTED'
        ? 'error'
        : current === 'APPROVED'
          ? 'info'
          : 'warning';
  return (
    <Chip
      variant="outlined"
      size="small"
      color={color}
      label={labelByStatus[current] ?? status}
      sx={{ fontWeight: 650, maxWidth: '100%' }}
    />
  );
}

export default function TenantRefundRequestsPage() {
  return (
    <>
      <PageHeader
        title="Yêu cầu hoàn tiền"
        subtitle="Tiếp nhận đơn Tenant gửi, đối chiếu thông tin và phản hồi quyết định hoàn tiền."
      />
      {isMockMode ? (
        <Alert severity="info">
          Danh sách đơn hoàn tiền của Tenant chỉ có khi kết nối API. Chế độ demo không thể duyệt, từ
          chối hoặc xác nhận chuyển khoản hoàn.
        </Alert>
      ) : (
        <OwnerTenantRefundRequestList />
      )}
    </>
  );
}

function OwnerTenantRefundRequestList() {
  const { session } = useAuth();
  const owner = !!session?.roles?.includes('Owner');
  const actor = session?.userId ?? '';
  const api = useTenantRefundRequestsApi();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const list = useQuery({
    queryKey: ['tenant-refund-requests', actor, page],
    queryFn: ({ signal }) => api.ownerList(page, PAGE_SIZE, signal),
    enabled: owner && !!actor,
  });
  const rows: TenantRefundPetition[] = list.data?.items ?? [];
  const selected = rows.find((item) => item.id === selectedId);
  const changePage = (next: number) => {
    setSelectedId('');
    setNotice('');
    setPage(next);
  };

  if (!owner) {
    return <Alert severity="warning">Chỉ Owner được xem và xử lý đơn hoàn tiền của Tenant.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={<WalletCards size={21} aria-hidden="true" />}>
        BHOME lưu yêu cầu và chứng từ, không tự chuyển tiền. Owner cần kiểm tra nguồn tiền và hợp
        đồng liên quan (nếu có), sau đó chuyển khoản ngoài hệ thống trước khi ghi nhận hoàn.
      </Alert>
      <Paper
        component="section"
        aria-label="Danh sách yêu cầu hoàn tiền"
        variant="outlined"
        sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2, minWidth: 0 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          sx={{ gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
        >
          <Box>
            <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 750 }}>
              Đơn từ khách thuê
            </Typography>
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {list.isPending
                ? 'Đang tải yêu cầu…'
                : list.error
                  ? 'Chưa tải được danh sách'
                  : `${list.data?.totalCount ?? 0} đơn trên tất cả cơ sở`}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshCw size={17} aria-hidden="true" />}
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, minHeight: { xs: 44, sm: 36 } }}
          >
            Làm mới danh sách
          </Button>
        </Stack>
        {notice && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {notice}
          </Alert>
        )}
        {list.isFetching && <LinearProgress aria-label="Đang cập nhật yêu cầu hoàn tiền" />}
        {list.error ? (
          <Alert
            severity="error"
            sx={{ mt: 1 }}
            action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
          >
            Không tải được đơn hoàn tiền. {ownerError(list.error)}
          </Alert>
        ) : list.isPending ? (
          <LoadingState />
        ) : !list.isPending && rows.length === 0 ? (
          <Stack sx={{ alignItems: 'center', py: { xs: 3, md: 5 }, textAlign: 'center', gap: 1 }}>
            <WalletCards size={32} aria-hidden="true" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Chưa có đơn hoàn tiền
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
              Khi Tenant gửi yêu cầu, đơn sẽ xuất hiện tại đây dù có hoặc không gắn với giao dịch
              thanh toán hay hợp đồng.
            </Typography>
          </Stack>
        ) : (
          <OwnerTable
            label="Danh sách đơn hoàn tiền từ Tenant"
            rows={rows}
            id={(row) => row.id}
            select={(row) => {
              setSelectedId(row.id);
              setNotice('');
            }}
            selectLabel="Xem và xử lý"
            columns={[
              {
                label: 'Khách thuê',
                render: (row) => (
                  <Stack spacing={0.25}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.tenantLabel || 'Khách thuê chưa có tên hiển thị'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Gửi {formatInstant(row.createdAt)}
                    </Typography>
                  </Stack>
                ),
              },
              {
                label: 'Số tiền yêu cầu',
                render: (row) => (
                  <Typography sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                    {formatContractMoney(row.amount)}
                  </Typography>
                ),
              },
              { label: 'Trạng thái', render: (row) => <RefundStatus status={row.status} /> },
              {
                label: 'Liên kết',
                render: (row) => (
                  <Typography variant="body2" color="text.secondary">
                    {[
                      row.sourcePaymentId ? 'Thanh toán' : '',
                      row.sourceContractId ? 'Hợp đồng' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Không gắn nguồn'}
                  </Typography>
                ),
              },
            ]}
          />
        )}
        {list.data && list.data.totalCount > PAGE_SIZE && (
          <Box sx={{ mt: 2 }}>
            <OwnerPagination
              page={page}
              size={PAGE_SIZE}
              total={list.data.totalCount}
              change={changePage}
              busy={list.isFetching}
            />
          </Box>
        )}
      </Paper>
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => setSelectedId('')}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' } } }}
      >
        {selected && (
          <TenantRefundRequestDetails
            key={`${selected.id}:${selected.version}:${selected.status}:${selected.executionIntent?.key ?? ''}`}
            row={selected}
            onClose={() => setSelectedId('')}
            onReload={() => list.refetch().then(() => undefined)}
            onSaved={(message) => {
              setNotice(message);
            }}
          />
        )}
      </Drawer>
    </Stack>
  );
}

function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ gap: { xs: 0.25, sm: 1 }, justifyContent: 'space-between' }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        sx={{ fontWeight: 600, overflowWrap: 'anywhere', textAlign: { sm: 'right' } }}
      >
        {children}
      </Typography>
    </Stack>
  );
}

function TenantRefundRequestDetails({
  row,
  onClose,
  onReload,
  onSaved,
}: {
  row: TenantRefundPetition;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const api = useTenantRefundRequestsApi();
  const cache = useQueryClient();
  const intent = row.executionIntent;
  const [reason, setReason] = useState(intent?.reason ?? '');
  const [reference, setReference] = useState(intent?.externalReference ?? '');
  const [executedAt, setExecutedAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const requestKey = useRef(intent?.key ?? crypto.randomUUID());
  const state = statusOf(row.status);
  const decision = state === 'REQUESTED';
  // Move-out petitions are contextual approvals. Their payout must be recorded
  // ONLY by the separately verified deposit refund ledger, not as a second
  // independent bank transfer from this generic petition screen.
  const execution = state === 'APPROVED' && !row.moveOutProposalId;

  function updateFields() {
    if (!intent) requestKey.current = crypto.randomUUID();
    setChecked(false);
    setError('');
  }

  async function submit(approve?: boolean) {
    if (lock.current || !checked || (!intent && !reason.trim()) || !(decision || execution)) return;
    setError('');
    if (reason.trim().length > 2000) {
      setError('Lý do hoặc ghi chú không được quá 2.000 ký tự.');
      return;
    }
    if (execution) {
      if ((!intent && (!reference.trim() || !executedAt)) || !file) {
        setError('Nhập tham chiếu, thời điểm hoàn và chọn ảnh chứng từ chuyển khoản.');
        return;
      }
      if (
        !intent &&
        (reference.trim().length > 200 || !/^[A-Za-z0-9_:/.-]+$/.test(reference.trim()))
      ) {
        setError('Mã tham chiếu tối đa 200 ký tự, gồm chữ, số hoặc các dấu - _ : . /.');
        return;
      }
      if (
        !['image/png', 'image/jpeg'].includes(file.type) ||
        file.size === 0 ||
        file.size > MAX_EVIDENCE_BYTES
      ) {
        setError('Chỉ chấp nhận ảnh PNG/JPEG hợp lệ, tối đa 5 MB.');
        return;
      }
      if (!intent) {
        const timestamp = new Date(`${executedAt}+07:00`);
        if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > Date.now()) {
          setError('Thời điểm hoàn tiền phải hợp lệ và không được trong tương lai.');
          return;
        }
        if (row.decidedAt && timestamp.getTime() < new Date(row.decidedAt).getTime()) {
          setError('Thời điểm chuyển khoản không được trước thời điểm Owner duyệt đơn.');
          return;
        }
      } else if (file.size !== intent.length || file.type !== intent.contentType) {
        setError(
          'Chứng từ không khớp yêu cầu đang chờ. Chọn đúng ảnh chuyển khoản đã tải lên trước đó.',
        );
        return;
      }
    }

    lock.current = true;
    setBusy(true);
    try {
      if (execution && intent && file) {
        let sha256 = '';
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          try {
            sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
              .map((value) => value.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase();
          } finally {
            bytes.fill(0);
          }
        } catch {
          setError(
            'Không thể đọc hoặc kiểm tra ảnh chứng từ. Hãy chọn lại đúng tệp đã gửi trước đó.',
          );
          return;
        }
        if (sha256 !== intent.sha256.toUpperCase()) {
          setError(
            'Chứng từ không khớp yêu cầu đang chờ. Chọn đúng ảnh chuyển khoản đã tải lên trước đó.',
          );
          return;
        }
      }
      if (decision) {
        await api.decide(
          row.id,
          {
            expectedVersion: row.version,
            approve: approve === true,
            reason: reason.trim(),
            humanConfirmed: true,
          },
          requestKey.current,
        );
      } else if (file) {
        await api.execute(
          row.id,
          {
            expectedVersion: row.version,
            executedAt: intent?.executedAt ?? new Date(`${executedAt}+07:00`).toISOString(),
            externalReference: intent?.externalReference ?? reference.trim(),
            reason: intent?.reason ?? reason.trim(),
            humanConfirmed: true,
          },
          file,
          requestKey.current,
        );
      }
      await cache.invalidateQueries({ queryKey: ['tenant-refund-requests'] });
      onSaved(
        decision
          ? approve
            ? 'Đã duyệt đơn hoàn tiền.'
            : 'Đã từ chối đơn và lưu lý do.'
          : 'Đã ghi nhận chứng từ chuyển khoản hoàn tiền.',
      );
    } catch (cause) {
      setError(ownerError(cause));
      try {
        await onReload();
      } catch {
        // Keep the original operation error visible if refreshing also fails.
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack
        direction="row"
        sx={{
          p: 2,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 750 }}>
            Chi tiết yêu cầu hoàn tiền
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {row.tenantLabel || 'Khách thuê chưa có tên hiển thị'}
          </Typography>
        </Box>
        <Button aria-label="Đóng chi tiết" onClick={onClose} sx={{ minWidth: 44, minHeight: 44 }}>
          <X size={20} />
        </Button>
      </Stack>
      <Stack spacing={2.25} sx={{ p: { xs: 2, sm: 2.5 }, overflowY: 'auto', flex: 1 }}>
        <Stack spacing={1.25}>
          <Stack
            direction="row"
            useFlexGap
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
          >
            <Typography variant="h6" sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
              {formatContractMoney(row.amount)}
            </Typography>
            <RefundStatus status={row.status} />
          </Stack>
          <DetailLine label="Ngày gửi">{formatInstant(row.createdAt)}</DetailLine>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Lý do Tenant gửi
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {row.reason}
          </Typography>
        </Stack>
        <Divider />
        {row.moveOutProposalId && (
          <Alert severity="info">
            Đây là yêu cầu hoàn tiền cọc từ đề xuất quyết toán trả phòng đã được Tenant chấp
            thuận. Owner có thể duyệt hoặc từ chối tại đây, nhưng việc chuyển khoản hoàn cọc và
            lưu chứng từ phải được xử lý trong luồng hoàn cọc của hợp đồng để tránh trả trùng.
            {state === 'APPROVED' && ' Đơn đã duyệt; vui lòng mở hợp đồng để xử lý hoàn cọc.'}
          </Alert>
        )}
        <Stack spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Giao dịch và hợp đồng liên quan
          </Typography>
          {row.sourcePaymentId ? (
            <Button
              component={Link}
              to={`/payments?transferId=${encodeURIComponent(row.sourcePaymentId)}`}
              variant="outlined"
              endIcon={<ArrowRight size={16} />}
              sx={{ alignSelf: 'flex-start', minHeight: 40 }}
            >
              Xem thanh toán liên quan
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Không liên kết giao dịch thanh toán.
            </Typography>
          )}
          {row.sourceContractId ? (
            <Button
              component={Link}
              to={`/contracts?contractId=${encodeURIComponent(row.sourceContractId)}`}
              variant="outlined"
              endIcon={<ArrowRight size={16} />}
              sx={{ alignSelf: 'flex-start', minHeight: 40 }}
            >
              Xem hợp đồng liên quan
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Không liên kết hợp đồng.
            </Typography>
          )}
        </Stack>
        {(row.decidedAt ||
          row.decisionReason ||
          row.executedAt ||
          row.externalReference ||
          row.hasEvidence) && (
          <>
            <Divider />
            <Stack spacing={1}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Kết quả xử lý
              </Typography>
              {row.decidedAt && (
                <DetailLine label="Quyết định lúc">{formatInstant(row.decidedAt)}</DetailLine>
              )}
              {row.decisionReason && (
                <DetailLine label="Lý do quyết định">{row.decisionReason}</DetailLine>
              )}
              {row.executedAt && (
                <DetailLine label="Chuyển khoản lúc">{formatInstant(row.executedAt)}</DetailLine>
              )}
              {row.externalReference && (
                <DetailLine label="Mã tham chiếu ngân hàng">{row.externalReference}</DetailLine>
              )}
              {row.hasEvidence && (
                <PrivateEvidenceViewer
                  label="Chứng từ chuyển khoản hoàn"
                  filename="chung-tu-hoan-tien"
                  fetchBlob={(signal) => api.ownerEvidence(row.id, signal)}
                  errorMessage={ownerError}
                />
              )}
            </Stack>
          </>
        )}
        {(decision || execution) && (
          <>
            <Divider />
            <Stack
              component="section"
              aria-label={decision ? 'Quyết định yêu cầu' : 'Ghi nhận đã hoàn tiền'}
              spacing={1.5}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  {decision ? 'Duyệt hoặc từ chối đơn' : 'Ghi nhận chuyển khoản hoàn'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {decision
                    ? 'Đối chiếu số tiền, người gửi và tài liệu liên quan trước khi đưa ra quyết định.'
                    : 'Chỉ xác nhận sau khi đã chuyển khoản thật và đối chiếu sao kê ngân hàng.'}
                </Typography>
              </Box>
              {intent && (
                <Alert severity="warning">
                  Hệ thống đã nhận thông tin chuyển khoản nhưng chưa hoàn tất lưu chứng từ. Chọn lại
                  đúng ảnh trước đó để phục hồi; không thay đổi mã giao dịch, thời gian hay lý do.
                  Nếu đã chuyển tiền, không chuyển khoản thêm lần nữa.
                </Alert>
              )}
              <TextField
                label={decision ? 'Lý do quyết định' : 'Ghi chú xác minh chuyển khoản'}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  updateFields();
                }}
                disabled={busy || !!intent}
                multiline
                minRows={2}
                required
                fullWidth
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
              {execution && (
                <>
                  <TextField
                    label="Mã tham chiếu trên sao kê"
                    value={reference}
                    onChange={(event) => {
                      setReference(event.target.value);
                      updateFields();
                    }}
                    disabled={busy || !!intent}
                    required
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                  {intent ? (
                    <DetailLine label="Thời điểm chuyển khoản đã khai">
                      {formatInstant(intent.executedAt)}
                    </DetailLine>
                  ) : (
                    <TextField
                      label="Thời điểm chuyển khoản (giờ Việt Nam)"
                      type="datetime-local"
                      value={executedAt}
                      onChange={(event) => {
                        setExecutedAt(event.target.value);
                        updateFields();
                      }}
                      disabled={busy}
                      slotProps={{ inputLabel: { shrink: true } }}
                      required
                      fullWidth
                    />
                  )}
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      Ảnh chứng từ chuyển khoản
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      PNG/JPEG tối đa 5 MB. Tránh tải giấy tờ tùy thân hoặc thông tin đăng nhập.
                    </Typography>
                    <ValidatedInput
                      type="file"
                      accept="image/png,image/jpeg"
                      aria-label="Ảnh chứng từ chuyển khoản"
                      disabled={busy}
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        updateFields();
                      }}
                    />
                    {file && <Typography variant="caption">Đã chọn: {file.name}</Typography>}
                  </Stack>
                </>
              )}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => setChecked(event.target.checked)}
                  />
                }
                label={
                  decision
                    ? 'Tôi đã xem yêu cầu và xác minh thông tin trước khi quyết định'
                    : 'Tôi xác nhận đã chuyển khoản đúng người nhận, đúng số tiền và kiểm tra sao kê'
                }
              />
              {error && (
                <Alert severity="error" role="alert">
                  {error}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1 }}>
                {decision ? (
                  <>
                    <Button
                      variant="contained"
                      disabled={busy || !checked || !reason.trim()}
                      onClick={() => void submit(true)}
                      sx={{ minHeight: 44 }}
                    >
                      Duyệt yêu cầu
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      disabled={busy || !checked || !reason.trim()}
                      onClick={() => void submit(false)}
                      sx={{ minHeight: 44 }}
                    >
                      Từ chối và gửi lý do
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      !checked ||
                      (!intent && (!reason.trim() || !reference.trim() || !executedAt)) ||
                      !file
                    }
                    onClick={() => void submit()}
                    sx={{ minHeight: 44 }}
                  >
                    {intent
                      ? 'Phục hồi chứng từ chuyển khoản'
                      : 'Xác nhận đã chuyển khoản và lưu chứng từ'}
                  </Button>
                )}
              </Stack>
              {busy && <LinearProgress aria-label="Đang lưu quyết định hoàn tiền" />}
            </Stack>
          </>
        )}
      </Stack>
    </Stack>
  );
}
