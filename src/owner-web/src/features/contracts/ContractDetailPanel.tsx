import { useRef, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, useInRouterContext } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useContractDetail } from '../../../../../packages/client-core/src/useContractDetail';
import {
  contractActions,
  contractError,
  dateOnly,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractAction,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { formatBillingDecimal } from '../../../../../packages/client-core/src/invoices';
import { ChartCard, StatusChip } from '../../components/common/PortalUI';
import { ContractActionDialog } from './ContractActionDialog';
import { ContractWorkflowPanel } from './ContractWorkflowPanel';
import { ContractHandoverPanel } from './ContractHandoverPanel';
import { HoldingDepositPanel } from './HoldingDepositPanel';
import { DepositReceiptPanel } from './DepositReceiptPanel';
import { ContractLifecyclePanel } from './ContractLifecyclePanel';
import { MainDraftDetailPanel } from './MainDraftDetailPanel';
import { ContractPolicyPanel } from './ContractPolicyPanel';
import { OwnerSigningPanel } from './OwnerSigningPanel';
import { useSigningMethods } from './useContractsApi';
import { signingMethodLabel } from '../../../../../packages/client-core/src/signing';
import { InternalSigningPanel } from './InternalSigningPanel';

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ContractDetailPanel({
  api,
  id,
  actorId,
  locationId,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  actorId: string;
  locationId: string;
  onChanged: (id?: string) => void;
}) {
  const detail = useContractDetail(api, id, 'Owner', 5000);
  const signingMethods = useSigningMethods(api);
  const cache = useQueryClient();
  const [action, setAction] = useState<ContractAction | null>(null);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (detail.loading) return <LinearProgress aria-label="Đang tải hợp đồng" />;
  if (detail.error)
    return (
      <Alert severity="error">
        {detail.error}
        <Button onClick={detail.reload}>Tải lại</Button>
      </Alert>
    );
  if (!detail.data) return null;
  const { contract: c, moveOut: m, readiness: r, history } = detail.data;
  if (c.onboardingDraft)
    return (
      <MainDraftDetailPanel
        id={c.id}
        onChanged={() => onChanged()}
        onReleased={() => {
          detail.reload();
          onChanged();
        }}
      />
    );
  const actions = contractActions(c, m, 'Owner', actorId, signingMethods?.methods).filter(
    (a) =>
      !['move-out/settlement', 'move-out/schedule'].includes(a.operation) &&
      !(m?.status === 'Requested' && ['move-out/approve', 'move-out/reject'].includes(a.operation)) &&
      !(c.kind === 'Holding' && a.operation === 'holding-approval') &&
      !(c.signingMode === 'INTERNAL_OTP_DRAWN' && a.operation.startsWith('signing')),
  );
  const signer = c.ownerSignerId === actorId;
  const done = (status: string) => ['Signed', 'Simulated'].includes(status);
  const parties = [
    { id: c.ownerSignerId, party: 'Bên A', role: 'Chủ nhà' },
    { id: c.tenantUserId, party: 'Bên B', role: 'Người thuê' },
  ].map((p) => ({ ...p, signature: c.signatures.filter((a) => a.signerUserId === p.id).at(-1) }));
  const signedCount = parties.filter((p) => p.signature && done(p.signature.status)).length;
  const anySigned = signedCount > 0;
  const activated = !!c.activatedAt || ['Active', 'Terminated', 'Superseded'].includes(c.status);
  const depositDone = activated || (!!r && Number(r.remainingDeposit) === 0);
  const steps = [
    { label: 'Bản nháp', done: c.status !== 'Draft' || (c.kind === 'Holding' && !!c.approvedAt) },
    {
      label:
        c.signingMode === 'INTERNAL_OTP_DRAWN' ? 'Xác nhận hai bên' : `Ký số (${signedCount}/2)`,
      done:
        c.signingMode === 'INTERNAL_OTP_DRAWN'
          ? c.status === 'PendingActivation' || activated
          : signedCount === 2 || activated,
    },
    { label: 'Xác minh cọc', done: depositDone },
    { label: 'Kích hoạt', done: activated },
  ];
  const nextStep = steps.findIndex((s) => !s.done);
  const activeStep = nextStep < 0 ? steps.length : nextStep;
  const representative =
    c.occupants?.find((o) => o.representative)?.label || c.representativeResidentId;
  const facts: [string, ReactNode][] = [
    ['Kỳ thuê', `${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`],
    [
      'Tiền thuê',
      <span key="rent">
        <strong>{formatContractMoney(c.monthlyRent)}</strong> / tháng
      </span>,
    ],
    ['Cọc yêu cầu', formatContractMoney(c.requiredDeposit)],
    ['Cọc giữ chỗ áp dụng', formatContractMoney(c.appliedHoldingDeposit)],
    ['Người ở', `${c.residentIds.length} người · Đại diện: ${representative}`],
    ...(c.actualEndDate
      ? ([['Kết thúc thực tế', displayContractDate(c.actualEndDate)]] as [string, string][])
      : []),
    ...(c.activatedAt
      ? ([['Kích hoạt lúc', formatInstant(c.activatedAt)]] as [string, string][])
      : []),
  ];
  async function openSigned() {
    // Open the tab now (a tab opened after an await is blocked as a pop-up), fill it when the PDF arrives.
    const tab = window.open('', '_blank');
    await run(async () => {
      const pdf = new Blob([await api.document(id)], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdf);
      if (tab) tab.location.href = url;
      else downloadBlob(pdf, 'hop-dong.pdf');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    });
  }
  return (
    <Stack spacing={2}>
      {c.isDevelopmentDemo && (
        <Alert severity="warning">
          HỢP ĐỒNG DEMO · SIMULATED SIGNING · Không có giá trị pháp lý.
        </Alert>
      )}

      {/* 1. Summary: what this contract is and where it stands */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700, mr: 0.5 }}>
            Phòng {c.roomNumber || c.roomId}
            {c.locationName ? ` · ${c.locationName}` : ''}
          </Typography>
          <StatusChip label={text(c.status)} />
          <Chip size="small" variant="outlined" label={text(c.kind)} />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Tải lại trạng thái">
            <span>
              <IconButton
                size="small"
                aria-label="Tải lại trạng thái"
                disabled={busy}
                onClick={detail.reload}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          Mã hợp đồng {c.id}
        </Typography>
        <ContractNavigation id={c.id} />
        <Stepper
          activeStep={activeStep}
          alternativeLabel
          sx={{
            my: 1.5,
            '& .MuiStep-root': { px: { xs: 0.25, sm: 1 } },
            '& .MuiStepLabel-label': { overflowWrap: 'anywhere' },
          }}
        >
          {steps.map((s) => (
            <Step key={s.label} completed={s.done}>
              <StepLabel>{s.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            columnGap: 3,
            rowGap: 1,
          }}
        >
          {facts.map(([label, value]) => (
            <Box key={label}>
              <Typography component="dt" variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" sx={{ m: 0 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        {c.previousContractId && (
          <Button size="small" sx={{ mt: 1 }} onClick={() => onChanged(c.previousContractId!)}>
            Xem hợp đồng trước
          </Button>
        )}
      </Paper>

      {!!error && <Alert severity="error">{error}</Alert>}
      {!!notice && <Alert severity="success">{notice}</Alert>}
      {c.signingMode === 'INTERNAL_OTP_DRAWN' && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
          <InternalSigningPanel api={api} contract={c} onChanged={detail.reload} />
        </Paper>
      )}

      {/* 2. What to do next: the actions the server allows now, and what still blocks activation */}
      <ChartCard title="Việc cần làm">
        <Stack spacing={1.5}>
          {r && !activated && (
            <Box>
              {r.ready ? (
                <Alert severity="success">
                  {['Main', 'Holding'].includes(c.kind)
                    ? 'Đủ điều kiện. Hệ thống đang tự động cập nhật trạng thái hợp đồng.'
                    : 'Đủ điều kiện để Owner xác nhận kích hoạt.'}
                </Alert>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Chưa kích hoạt được vì (máy chủ kiểm tra lại khi kích hoạt):
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {r.blockers.map((b) => (
                      <Typography component="li" variant="body2" key={b}>
                        {text(b)}
                      </Typography>
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Cọc đã xác minh: {formatContractMoney(r.verifiedDeposit)} · Còn thiếu:{' '}
                    {formatContractMoney(r.remainingDeposit)}
                  </Typography>
                </>
              )}
            </Box>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {actions.map((a) => (
              <Button
                key={a.operation}
                variant={
                  a.operation === 'activate' || a.operation === 'signing' ? 'contained' : 'outlined'
                }
                disabled={
                  busy || (['activate', 'holding-activation'].includes(a.operation) && !r?.ready)
                }
                onClick={() => {
                  setAction(a);
                  setNotice('');
                  setError('');
                }}
              >
                {a.label}
              </Button>
            ))}
          </Stack>
          {!actions.length && (
            <Typography color="text.secondary">
              Không có thao tác phù hợp với trạng thái hiện tại.
            </Typography>
          )}
        </Stack>
      </ChartCard>

      {c.agreedCharges?.length ||
      c.priceLockedAt ||
      ['Active', 'PendingSigning', 'PendingActivation', 'Terminated', 'Superseded'].includes(
        c.status,
      ) ? (
        <ChartCard title="Giá & phí theo hợp đồng">
          <Stack spacing={1.5}>
            {c.agreedCharges?.length ? (
              <>
                <Alert severity="info">
                  {c.priceLockedAt || c.approvedAt || c.status !== 'Draft'
                    ? 'Biểu phí đã chốt được giữ nguyên trong suốt hợp đồng. Hóa đơn sử dụng đơn giá này, không sử dụng biểu giá mới của phòng.'
                    : 'Biểu phí dự kiến của bản nháp; sẽ được khóa khi hợp đồng có ràng buộc.'}
                </Alert>
                {c.agreedCharges.map((charge) => (
                  <Stack
                    key={charge.chargeCode}
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{
                      justifyContent: 'space-between',
                      gap: { xs: 0.5, sm: 2 },
                      overflowWrap: 'anywhere',
                    }}
                  >
                    <Typography variant="body2">
                      {charge.name || charge.chargeCode} · {charge.chargeCode}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatBillingDecimal(charge.rate)} đ/
                      {charge.category === 1
                        ? 'kWh'
                        : charge.category === 2
                          ? 'm³'
                          : charge.method === 2
                            ? 'người/tháng'
                            : 'tháng'}
                    </Typography>
                  </Stack>
                ))}
              </>
            ) : (
              <Alert severity="warning">
                Hợp đồng chưa có biểu phí đã chốt để đối chiếu. Không sử dụng giá cấu hình hiện tại
                thay thế.
              </Alert>
            )}
          </Stack>
        </ChartCard>
      ) : null}

      {/* 3. Signatures: one line per party, then the signed PDF */}
      {c.signingMode !== 'INTERNAL_OTP_DRAWN' && (
        <ChartCard
          title="Chữ ký số"
          subtitle={
            c.isDevelopmentDemo
              ? 'Mô phỏng Development — không dùng chứng thư hoặc chữ ký điện tử'
              : signingMethods && !signingMethods.methods.includes('VIETTEL_MYSIGN')
                ? 'Chủ trọ ký số MySign (chứng thư qua VNeID) · Người thuê ký điện tử, xác thực OTP email'
                : 'Mỗi bên ký bằng chứng thư Viettel MySign của chính mình'
          }
          action={
            signer &&
            !c.isDevelopmentDemo &&
            (!signingMethods || signingMethods.methods.includes('VIETTEL_MYSIGN')) ? (
              <SigningSetupLink />
            ) : undefined
          }
        >
          <Stack divider={<Divider flexItem />} spacing={1}>
            {parties.map((p) => (
              <Stack
                key={p.party}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Typography sx={{ fontWeight: 600, minWidth: 150 }}>
                  {p.party} · {p.role}
                  {p.id === actorId ? ' (bạn)' : ''}
                </Typography>
                {p.signature ? (
                  <StatusChip label={text(p.signature.status)} />
                ) : (
                  <Chip size="small" variant="outlined" label="Chưa có yêu cầu ký" />
                )}
                {p.signature && !c.isDevelopmentDemo && (
                  <Typography variant="body2" color="text.secondary">
                    {signingMethodLabel(p.signature.method)}
                  </Typography>
                )}
                {p.signature?.signedAt && (
                  <Typography variant="body2" color="text.secondary">
                    {formatInstant(p.signature.signedAt)}
                  </Typography>
                )}
                {p.signature?.certificateSubject && p.signature.method !== 'OTP' && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {p.signature.certificateSubject}
                    {p.signature.certificateIssuer ? ` (${p.signature.certificateIssuer})` : ''}
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
          {signer && (
            <Box sx={{ mt: 2 }}>
              <OwnerSigningPanel
                api={api}
                contract={c}
                actorId={actorId}
                methods={signingMethods}
                onChanged={() => {
                  detail.reload();
                  onChanged();
                }}
              />
            </Box>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              disabled={busy || !anySigned}
              onClick={() => void openSigned()}
            >
              Xem hợp đồng đã ký
            </Button>
            <Button
              disabled={busy || !anySigned}
              onClick={() =>
                void run(async () => downloadBlob(await api.document(id), 'hop-dong.pdf'))
              }
            >
              Tải tài liệu ký
            </Button>
          </Stack>
        </ChartCard>
      )}

      {/* 4. Reference material, folded away until needed */}
      {['Main', 'Holding'].includes(c.kind) && !c.previousContractId && (
        <DepositReceiptPanel
          contract={c}
          changed={() => {
            detail.reload();
            onChanged();
          }}
        />
      )}
      {c.kind === 'Holding' && (
        <HoldingDepositPanel
          contract={c}
          changed={() => {
            detail.reload();
            onChanged();
          }}
        />
      )}
      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 600 }}>Điều khoản đưa đi ký</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {!!c.occupants?.length && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Người ở: {c.occupants.map((o) => o.label).join(', ')}
            </Typography>
          )}
          <Box
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            {c.terms}
          </Box>
        </AccordionDetails>
      </Accordion>
      <ContractWorkflowPanel api={api} contract={c} />
      {c.kind !== 'Holding' && typeof api.transport === 'function' && (
        <ContractPolicyPanel
          api={api}
          contract={c}
          actorId={actorId}
          onChanged={(next) => {
            detail.reload();
            onChanged(next);
          }}
        />
      )}

      {c.kind !== 'Holding' && (
        <ContractHandoverPanel
          api={api}
          id={c.id}
          contractStatus={c.status}
          showDraft={
            c.kind === 'Main' &&
            !c.previousContractId &&
            !['Cancelled', 'Terminated', 'Expired'].includes(c.status)
          }
        />
      )}
      {!m && c.kind !== 'Holding' && c.status === 'Active' && (
        <ChartCard title="Kết thúc hợp đồng">
          <Typography color="text.secondary">
            Chưa có hồ sơ trả phòng. Chọn “Lập yêu cầu trả phòng khi hết hạn” trong các thao tác hợp
            đồng để bắt đầu. Không tạo thêm nếu các bên đang xử lý gia hạn.
          </Typography>
        </ChartCard>
      )}
      {m?.status === 'Requested' && (
        <Paper id={`move-out-${c.id}`} variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
          <Stack spacing={2}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" component="h3" fontWeight={700}>Yêu cầu kết thúc hợp đồng</Typography>
              <Chip size="small" color="warning" variant="outlined" label="Chờ Owner quyết định" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Người thuê đề nghị trả phòng {c.roomNumber} · {c.locationName} vào ngày{' '}
              <strong>{displayContractDate(m.proposedDate)}</strong>.
            </Typography>
            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">Lý do của người thuê</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.reason}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Chấp nhận để chuyển sang bước lập lịch và giao kiểm tra trả phòng cho Staff phụ trách cơ sở. Hợp đồng chưa kết thúc và chưa quyết toán ở bước này.
            </Typography>
            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} justifyContent="flex-end">
              <Button variant="outlined" color="error" onClick={() => setAction(contractActions(c, m, 'Owner', actorId, signingMethods?.methods).find(a => a.operation === 'move-out/reject') ?? null)}>
                Từ chối
              </Button>
              <Button variant="contained" onClick={() => setAction(contractActions(c, m, 'Owner', actorId, signingMethods?.methods).find(a => a.operation === 'move-out/approve') ?? null)}>
                Chấp nhận
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
      {m?.status === 'Rejected' && (
        <Paper id={`move-out-${c.id}`} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
          <Typography fontWeight={700}>Yêu cầu kết thúc hợp đồng đã bị từ chối</Typography>
          <Typography variant="body2" color="text.secondary">Hợp đồng vẫn còn hiệu lực. Người thuê có thể gửi lại yêu cầu khác.</Typography>
          <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>Lý do từ chối: {m.pendingReason}</Typography>
        </Paper>
      )}
      {m && !['Requested', 'Rejected'].includes(m.status) && (
        <>
          {m.status === 'Approved' && (
            <FinalMeterTask
              api={api}
              id={id}
              roomId={c.roomId}
              locationId={c.locationId || locationId}
              proposedDate={m.proposedDate}
            />
          )}
          <ContractLifecyclePanel
            api={api}
            contract={c}
            moveOut={m}
            onChanged={() => {
              detail.reload();
              onChanged();
            }}
          />
          {detail.data.historyError && (
            <Alert severity="warning">
              Không tải được lịch sử quyết toán: {detail.data.historyError}
            </Alert>
          )}
          {!!history.length && (
            <ChartCard title="Lịch sử xem xét quyết toán">
              <Stack spacing={1}>
                {history.map((review) => (
                  <Box
                    key={review.id}
                    sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}
                  >
                    <Typography variant="caption">
                      {formatInstant(review.reviewedAt)} ·{' '}
                      {review.settled ? 'Đã xác minh quyết toán' : 'Còn chờ đối chiếu'}
                    </Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {review.decision}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </ChartCard>
          )}
        </>
      )}
      {action && (
        <ContractActionDialog
          api={api}
          contract={c}
          action={action}
          keys={keys}
          actorId={actorId}
          onConflict={() => {
            detail.reload();
            onChanged();
          }}
          onClose={() => {
            setAction(null);
            detail.reload();
          }}
          onSuccess={(next) => {
            void cache.invalidateQueries({ queryKey: ['contract-workflow', id] });
            setAction(null);
            setNotice('Máy chủ đã ghi nhận thao tác. Trạng thái đang được tải lại.');
            detail.reload();
            onChanged(next);
          }}
        />
      )}
    </Stack>
  );
}
function ContractNavigation({ id }: { id: string }) {
  const routed = useInRouterContext();
  if (!routed) return null;
  return (
    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
      <Button component={RouterLink} to={`/handovers?contractId=${encodeURIComponent(id)}`}>
        Mở biên bản bàn giao
      </Button>
      <Button component={RouterLink} to="/temporary-residence">
        Theo dõi tạm trú
      </Button>
      <Button
        onClick={() =>
          document
            .getElementById(`move-out-${id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      >
        Kết thúc hợp đồng
      </Button>
      <Button component={RouterLink} to="/maintenance">
        Bảo trì sau bàn giao
      </Button>
    </Stack>
  );
}

// Certificates, signature picture and the Viettel account live on their own page (menu "Ký số (MySign)").
function SigningSetupLink() {
  const routed = useInRouterContext();
  return routed ? (
    <Button size="small" component={RouterLink} to="/digital-signing">
      Thiết lập ký số
    </Button>
  ) : (
    <Button size="small" href="/digital-signing">
      Thiết lập ký số
    </Button>
  );
}

function FinalMeterTask({
  api,
  id,
  roomId,
  locationId,
  proposedDate,
}: {
  api: ContractClient;
  id: string;
  roomId: string;
  locationId: string;
  proposedDate: string;
}) {
  const [meterId, setMeterId] = useState(''),
    [date, setDate] = useState(proposedDate),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const meters = useQuery({
    queryKey: ['contract-final-meters', id, locationId],
    enabled: !!locationId,
    queryFn: async ({ signal }) => api.meters(locationId, signal),
  });
  return (
    <Stack spacing={1}>
      <Divider />
      <Typography variant="subtitle2">Tạo tác vụ ghi chỉ số chốt cho Staff</Typography>
      <Typography variant="caption">
        Tạo riêng tác vụ cho đồng hồ điện và nước của phòng. Staff chụp ảnh và xác nhận trên mobile.
      </Typography>
      {meters.error && <Alert severity="error">{contractError(meters.error)}</Alert>}
      <TextField
        select
        label="Đồng hồ chốt"
        value={meterId}
        disabled={busy}
        onChange={(e) => setMeterId(e.target.value)}
      >
        {(meters.data ?? [])
          .filter((o) => o.parentId === roomId)
          .map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {o.label}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        label="Ngày ghi chỉ số chốt"
        type="date"
        value={date}
        slotProps={{ inputLabel: { shrink: true } }}
        disabled={busy}
        onChange={(e) => setDate(e.target.value)}
      />
      <Button
        disabled={busy || !meterId}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            await api.finalTask(id, meterId, dateOnly(date));
            setMessage('Đã tạo tác vụ chốt. Staff xem trong danh sách công việc được phân công.');
          } catch (e) {
            setMessage(contractError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Tạo tác vụ chốt
      </Button>
      {!!message && <Typography role="status">{message}</Typography>}
    </Stack>
  );
}
