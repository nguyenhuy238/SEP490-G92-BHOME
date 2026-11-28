import { TextField } from '../../../../components/common/ValidatedForm';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  localSchedule,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type MoveOut,
} from '../../../../../../../packages/client-core/src/contracts';
import {
  settlementBlocker,
  moveOutActionLabel,
  useContractLifecycle,
} from '../../../../../../../packages/client-core/src/useContractLifecycle';
import { formatInstant } from '../../../../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../../../../packages/client-core/src/adjustments';
import { ChartCard } from '../../../../components/common/PortalUI';
import { RefundPanel } from '../../../payments/RefundPanel';
import { DepositDeductionsPanel } from './DepositDeductionsPanel';
import { SettlementReceivablesPanel } from './SettlementReceivablesPanel';
import { handoverAssetSummary } from '../../../../../../../packages/client-core/src/handoverForm';
import { PrivateEvidenceViewer } from '../../../../components/common/PrivateEvidenceViewer';
import { ConfirmActionButton } from '../../../../components/common/ConfirmActionButton';
import { financialState, historyNote, moveOutProgress } from './termination';

const roomCheckNames: Record<string, string> = {
  walls_ceiling_floor: 'Tường, trần và sàn',
  doors_windows_locks: 'Cửa, cửa sổ và khóa',
  electrical_lighting_outlets: 'Đèn, công tắc và ổ điện',
  water_plumbing_drainage: 'Cấp nước, vòi và thoát nước',
  bathroom_toilet: 'Nhà vệ sinh và thiết bị vệ sinh',
  cleanliness: 'Vệ sinh và hiện trạng phòng',
  safety_equipment: 'Thiết bị an toàn',
};
const roomCheckResult: Record<string, string> = {
  Passed: 'Đạt',
  Issue: 'Cần xử lý',
  NotApplicable: 'Cần xác minh',
};

export function ContractLifecyclePanel({
  api,
  contract,
  moveOut,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  moveOut: MoveOut;
  onChanged: () => void;
}) {
  const q = useContractLifecycle(api, contract.id, 'Owner', !!moveOut.isForced);
  const cache = useQueryClient();
  async function reload() {
    await cache.invalidateQueries({
      predicate: ({ queryKey }) =>
        (queryKey[0] === 'refund-source' &&
          queryKey[2] === 'SecurityDeposit' &&
          queryKey[3] === contract.id) ||
        (queryKey[0] === 'contract-workflow' && queryKey.includes(contract.id)) ||
        (typeof queryKey[0] === 'string' &&
          queryKey[0].startsWith('settlement-') &&
          queryKey.includes(contract.id)) ||
        [
          'contracts',
          'contract-expiry-reminders',
          'notification-list',
          'notification-count',
        ].includes(String(queryKey[0])),
    });
    q.reload();
    onChanged();
  }
  const staff = useQuery({
    queryKey: ['inspection-staff', contract.locationId],
    queryFn: ({ signal }) => api.inspectionStaff(contract.locationId, signal),
    enabled: moveOut.status === 'Approved',
  });
  const [reason, setReason] = useState(''),
    [schedule, setSchedule] = useState(''),
    [assignee, setAssignee] = useState('');
  const [disposition, setDisposition] = useState('');
  const [reviewedReference, setReviewedReference] = useState<string | null>(null),
    [noChargesInspection, setNoChargesInspection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  async function save(operation: string, body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.mutate<MoveOut>(
        contract.id,
        operation,
        body,
        keys.get(operation, body),
      );
      keys.confirmed(operation, body);
      setReviewedReference(null);
      setNoChargesInspection(null);
      setReason('');
      setNotice(
        operation === 'move-out/settlement'
          ? result.financialReviewStatus === 'OwnerReviewed' || result.status === 'Settled'
            ? 'Owner đã xác nhận quyết toán. Đang tải lại kết quả đối chiếu.'
            : 'Đã lưu xem xét. Quyết toán vẫn còn nghĩa vụ cần xử lý; xem dữ liệu đối chiếu mới nhất.'
          : 'Đã lưu tại máy chủ.',
      );
      await reload();
    } catch (e) {
      setError(contractError(e));
      if ((e as { status?: number })?.status === 409) {
        setReviewedReference(null);
        setNoChargesInspection(null);
        await reload();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const inspection = q.inspections[0],
    summary = moveOut.isForced ? null : q.summary;
  const inspectionKey = inspection ? `${contract.id}:${inspection.id}:${inspection.version}` : null;
  const noCharges = !!inspectionKey && noChargesInspection === inspectionKey;
  const checked = !!summary && reviewedReference === summary.reference;
  const money = (v: string | null) => (v === null ? 'Chờ xác minh' : formatContractMoney(v));
  return (
    <ChartCard title="Kết thúc hợp đồng">
      <Stack spacing={2}>
        <Box id={`move-out-${contract.id}`} sx={{ scrollMarginTop: 24 }}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
            <Chip size="small" label={`Hợp đồng: ${text(contract.status)}`} />
            <Chip size="small" label={`Trả phòng: ${text(moveOut.status)}`} />
            <Chip
              size="small"
              variant="outlined"
              label={`Tài chính: ${financialState(summary, moveOut)}`}
            />
          </Stack>
          <Typography>
            Phòng {contract.roomNumber} · {contract.locationName}
          </Typography>
          <Typography variant="body2">
            Người thuê:{' '}
            {contract.occupants?.find((o) => o.representative)?.label || 'Người đại diện hợp đồng'}
            {' · '}Kỳ thuê: {displayContractDate(contract.startDate)} –{' '}
            {displayContractDate(contract.endDate)}
          </Typography>
          <Typography variant="body2">
            Dự kiến trả: {displayContractDate(moveOut.proposedDate)}
            {contract.actualEndDate
              ? ` · Thực tế: ${displayContractDate(contract.actualEndDate)}`
              : ''}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            Lý do: {moveOut.reason}
          </Typography>
          <Stack
            component="ol"
            direction="row"
            useFlexGap
            spacing={1}
            sx={{ flexWrap: 'wrap', listStyle: 'none', p: 0, mt: 2 }}
            aria-label="Tiến trình trả phòng"
          >
            {moveOutProgress(
              moveOut,
              moveOut.ownerConfirmedInspection === true,
              summary?.resolved ?? null,
            ).map((step, index) => (
              <Box component="li" key={step.label}>
                <Typography
                  variant="caption"
                  sx={{
                    color: step.done ? 'text.primary' : 'text.secondary',
                    fontWeight: step.done ? 650 : 400,
                  }}
                >
                  {index + 1}. {step.label}
                  {step.done ? ' · Đã xong' : ' · Chưa xong'}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            {['Lịch kiểm tra', 'Kết quả kiểm tra', 'Quyết toán', 'Lịch sử'].map((label, index) => (
              <Button
                key={label}
                size="small"
                onClick={() =>
                  document
                    .getElementById(`termination-${contract.id}-${index}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {label}
              </Button>
            ))}
          </Stack>
        </Box>
        {moveOut.status === 'Completed' && (
          <Alert severity="info">
            Đã hoàn tất kiểm tra và trả phòng. Nợ, cọc và giao dịch hoàn tiền vẫn được đối chiếu
            riêng; trạng thái này không xác nhận đã thanh toán.
          </Alert>
        )}
        {moveOut.status === 'Approved' && (
          <Alert severity="info">
            Nhiệm vụ kiểm tra trả phòng đã mở cho Staff thuộc cơ sở. Có thể đặt lịch và phân công
            một người phụ trách bên dưới nếu cần; Staff chỉ gửi kết quả kiểm tra khi đến ngày trả
            phòng và có đủ chỉ số điện nước chốt.
          </Alert>
        )}
        {moveOut.pendingReason && (
          <Alert severity="warning">{settlementBlocker(moveOut.pendingReason)}</Alert>
        )}
        <Button disabled={busy || q.loading} onClick={() => void reload()}>
          Tải lại dữ liệu quyết toán
        </Button>
        {q.loading && <Typography>Đang đối chiếu dữ liệu…</Typography>}
        {!!(error || q.error) && <Alert severity="error">{error || q.error}</Alert>}
        {!!notice && <Alert severity="success">{notice}</Alert>}
        <Box id={`termination-${contract.id}-0`} sx={{ scrollMarginTop: 24 }}>
          <Typography variant="h6" component="h3">
            Lịch kiểm tra (tùy chọn)
          </Typography>
          <Typography variant="body2">
            {moveOut.inspectionScheduledAt
              ? formatInstant(moveOut.inspectionScheduledAt) + ' (giờ Việt Nam)'
              : 'Chưa đặt lịch riêng; Staff tại cơ sở đã thấy nhiệm vụ.'}
          </Typography>
          {moveOut.inspectionStaffId && (
            <Typography variant="body2">
              Staff phụ trách:{' '}
              {staff.data?.find((s) => s.id === moveOut.inspectionStaffId)?.label ||
                'Đã phân công tại cơ sở'}
            </Typography>
          )}
        </Box>
        {moveOut.status === 'Approved' && (
          <>
            <TextField
              label="Lịch kiểm tra (giờ Việt Nam)"
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Staff kiểm tra"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <MenuItem value="">Chưa phân công</MenuItem>
              {(staff.data ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
            {staff.error && (
              <Alert severity="error">
                {contractError(staff.error)}
                <Button onClick={() => void staff.refetch()}>Tải lại Staff</Button>
              </Alert>
            )}
            <Button
              disabled={busy || !schedule || !assignee || !!staff.error || staff.isFetching}
              onClick={() => {
                try {
                  void save('move-out/schedule', {
                    scheduledAt: localSchedule(schedule),
                    staffUserId: assignee || null,
                    expectedVersion: moveOut.version,
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Lưu lịch & phân công tùy chọn
            </Button>
            {!assignee && (
              <Alert severity="info">
                Nhiệm vụ đã mở cho cơ sở. Nếu muốn giao cho một Staff cụ thể, hãy chọn người phụ
                trách và lịch kiểm tra.
              </Alert>
            )}
          </>
        )}
        <Typography
          id={`termination-${contract.id}-1`}
          variant="h6"
          component="h3"
          sx={{ scrollMarginTop: 24 }}
        >
          Kết quả kiểm tra trả phòng
        </Typography>
        {!q.loading && !q.inspections.length && !q.sectionErrors.inspections && (
          <Typography color="text.secondary">
            Chưa có kết quả kiểm tra trả phòng. Staff thực hiện và lưu từng mục trong nhiệm vụ được
            giao; không cần lập biên bản hay ký.
          </Typography>
        )}
        {!q.inspections.length &&
          (moveOut.evidenceIds ?? []).map((evidenceId, index) => (
            <PrivateEvidenceViewer
              key={evidenceId}
              label={`Ảnh hiện trạng ${index + 1}`}
              filename={`hien-trang-${index + 1}.jpg`}
              fetchBlob={(signal) => api.evidence(contract.id, evidenceId, signal)}
              errorMessage={contractError}
            />
          ))}
        {q.preparation && !q.preparation.baseline && (
          <Alert severity="info">
            Không có dữ liệu nhận phòng để đối chiếu. Staff vẫn kiểm tra và ghi nhận hiện trạng, số
            lượng thực tế; không tự suy đoán số lượng/tình trạng ban đầu hoặc khoản bồi thường.
          </Alert>
        )}
        {q.inspections.map((i) => (
          <Stack key={i.id} spacing={1}>
            <Typography variant="h6">
              Kết quả kiểm tra lần {i.version} · {formatInstant(i.inspectedAt)}
            </Typography>
            <Typography>
              {i.baseline
                ? `So sánh với hiện trạng lúc nhận phòng (lần ${i.baselineVersion})`
                : 'Không có dữ liệu nhận phòng để đối chiếu; chỉ ghi nhận thực tế khi trả.'}
            </Typography>
            {i.baseline && i.baselineContractId !== contract.id && (
              <Button
                size="small"
                href={`/contracts?contractId=${encodeURIComponent(i.baselineContractId)}`}
              >
                Mở hợp đồng có biên bản nhận phòng gốc
              </Button>
            )}
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={`Đối chiếu trả phòng phiên bản ${i.version}`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Hạng mục</TableCell>
                    <TableCell>Khi nhận</TableCell>
                    <TableCell>Khi trả</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                      Hiện trạng phòng và 7 hạng mục kiểm tra
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Phòng</TableCell>
                    <TableCell>{i.baseline?.roomCondition ?? 'Không có dữ liệu ban đầu'}</TableCell>
                    <TableCell>{i.observed.roomCondition}</TableCell>
                  </TableRow>
                  {(i.observed.roomChecks ?? []).map((check) => (
                    <TableRow key={`room-check-${check.code}`}>
                      <TableCell>{roomCheckNames[check.code] ?? check.code}</TableCell>
                      <TableCell>
                        {(() => {
                          const previous = i.baseline?.roomChecks?.find(
                            (item) => item.code === check.code,
                          );
                          return previous ? (
                            <Stack spacing={0.5}>
                              <Typography variant="body2">
                                {roomCheckResult[previous.status] ?? previous.status}
                              </Typography>
                              {!!previous.notes?.trim() && (
                                <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>
                                  {previous.notes}
                                </Typography>
                              )}
                            </Stack>
                          ) : (
                            'Chưa có dữ liệu đối chiếu'
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Chip
                            size="small"
                            color={check.status === 'Passed' ? 'success' : 'warning'}
                            label={roomCheckResult[check.status] ?? check.status}
                            sx={{ alignSelf: 'flex-start' }}
                          />
                          {!!check.notes?.trim() && (
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                              {check.notes}
                            </Typography>
                          )}
                          {(check.evidenceIds ?? []).map((fileId, index) => (
                            <PrivateEvidenceViewer
                              key={fileId}
                              label={`${roomCheckNames[check.code] ?? check.code} · ảnh ${index + 1}`}
                              filename={`kiem-tra-phong-${check.code}-${index + 1}.jpg`}
                              fetchBlob={(signal) => api.evidence(contract.id, fileId, signal)}
                              errorMessage={contractError}
                            />
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                      Chìa khóa và vật dụng ra vào
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Chìa khóa / quyền truy cập</TableCell>
                    <TableCell>
                      {i.baseline?.accessItems?.length
                        ? i.baseline.accessItems
                            .map((item) => `${item.type}: ${item.quantity}`)
                            .join(' · ')
                        : (i.baseline?.keysAndAccess ?? 'Chưa có dữ liệu đối chiếu')}
                    </TableCell>
                    <TableCell>
                      {i.observed.accessItems?.length
                        ? i.observed.accessItems
                            .map((entry) => `${entry.type}: ${entry.quantity}`)
                            .join(' · ')
                        : i.observed.keysAndAccess}
                    </TableCell>
                  </TableRow>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                      Kiểm kê tài sản so với lúc nhận phòng
                    </TableCell>
                  </TableRow>
                  {i.observed.assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>
                        {(() => {
                          const previous = i.baseline?.assets.find((item) => item.id === a.id);
                          return previous ? (
                            <Stack spacing={0.5}>
                              <Typography variant="body2">
                                Số lượng: {previous.handedOverQuantity ?? 'Chưa xác định'}
                              </Typography>
                              <Typography variant="body2">
                                Tình trạng: {previous.observedCondition || 'Chưa xác định'}
                              </Typography>
                              {(a.physicalObservations ?? []).map((physical, index) => {
                                const original = previous.physicalObservations?.find(
                                  (item) => item.id === physical.id,
                                );
                                return (
                                  <Typography
                                    key={physical.id}
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {'Món ' +
                                      (index + 1) +
                                      ': ' +
                                      (original?.handedOverQuantity ??
                                        original?.quantity ??
                                        'Chưa rõ') +
                                      ' · ' +
                                      (original?.condition || 'Chưa rõ')}
                                  </Typography>
                                );
                              })}
                            </Stack>
                          ) : (
                            'Chưa có dữ liệu đối chiếu'
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography variant="body2">
                            Số lượng thực tế: {a.observedQuantity ?? 'Chưa ghi'}
                          </Typography>
                          <Typography variant="body2">
                            Tình trạng: {a.observedCondition || 'Chưa ghi'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {handoverAssetSummary(a)}
                          </Typography>
                          {(a.physicalObservations ?? []).map((physical, index) => {
                            const proof = i.observed.physicalItemEvidence?.find(
                              (item) =>
                                item.assetId === a.id && item.physicalAssetId === physical.id,
                            );
                            return (
                              <Stack key={physical.id} spacing={0.5} sx={{ pt: 0.5 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                  {'Món ' +
                                    (index + 1) +
                                    ': ' +
                                    physical.quantity +
                                    ' · ' +
                                    physical.condition}
                                </Typography>
                                {!!proof?.notes?.trim() && (
                                  <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {proof.notes}
                                  </Typography>
                                )}
                                {(proof?.evidenceIds ?? []).map((fileId, n) => (
                                  <PrivateEvidenceViewer
                                    key={fileId}
                                    label={a.name + ' · món ' + (index + 1) + ' · ảnh ' + (n + 1)}
                                    filename={
                                      'tai-san-' + a.id + '-' + (index + 1) + '-' + (n + 1) + '.jpg'
                                    }
                                    fetchBlob={(signal) =>
                                      api.evidence(contract.id, fileId, signal)
                                    }
                                    errorMessage={contractError}
                                  />
                                ))}
                              </Stack>
                            );
                          })}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                      Chỉ số điện và nước chốt trả phòng
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Điện</TableCell>
                    <TableCell>{i.baseline?.electricity.value ?? 'Chưa rõ'}</TableCell>
                    <TableCell>
                      {i.observed.electricity.value} ·{' '}
                      {displayContractDate(i.observed.electricity.date)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Nước</TableCell>
                    <TableCell>{i.baseline?.water.value ?? 'Chưa rõ'}</TableCell>
                    <TableCell>
                      {i.observed.water.value} · {displayContractDate(i.observed.water.date)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
            <Typography>{i.observed.notes}</Typography>
            {i.observed.missingBaselineReason && (
              <Alert severity="warning">
                Giới hạn dữ liệu: {i.observed.missingBaselineReason}. Không suy đoán hiện trạng ban
                đầu.
              </Alert>
            )}
            {i.observed.proposedCompensation && (
              <Alert severity="info">
                Đề xuất của Staff, chưa phải khoản phải thu: {i.observed.proposedCompensation}
              </Alert>
            )}
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
              {(i.baseline?.evidenceIds ?? []).map((evidenceId, index) => (
                <PrivateEvidenceViewer
                  key={`baseline-${evidenceId}`}
                  label={`ảnh nhận phòng ${index + 1} phiên bản ${i.baselineVersion}`}
                  filename={`nhan-phong-${i.baselineVersion}-${index + 1}.jpg`}
                  fetchBlob={(signal) =>
                    api.handoverEvidence(i.baselineContractId, evidenceId, signal)
                  }
                  errorMessage={contractError}
                />
              ))}
              {i.observed.evidenceIds.map((evidenceId, index) => (
                <PrivateEvidenceViewer
                  key={evidenceId}
                  label={`ảnh trả phòng ${index + 1} phiên bản ${i.version}`}
                  filename={`tra-phong-${i.version}-${index + 1}.jpg`}
                  fetchBlob={(signal) => api.evidence(contract.id, evidenceId, signal)}
                  errorMessage={contractError}
                />
              ))}
              {(i.observed.keyEvidenceIds ?? []).map((fileId, index) => (
                <PrivateEvidenceViewer
                  key={`key-${fileId}`}
                  label={`ảnh chìa khóa trả phòng ${index + 1}`}
                  filename={`chia-khoa-tra-phong-${index + 1}.jpg`}
                  fetchBlob={(signal) => api.evidence(contract.id, fileId, signal)}
                  errorMessage={contractError}
                />
              ))}
              {(
                [
                  ['điện', i.observed.electricity],
                  ['nước', i.observed.water],
                ] as const
              ).map(
                ([label, reading]) =>
                  reading.id && (
                    <PrivateEvidenceViewer
                      key={`final-${reading.id}`}
                      label={`ảnh chỉ số ${label} chốt phiên bản ${i.version}`}
                      filename={`chi-so-${i.version}.jpg`}
                      fetchBlob={(signal) => api.readingEvidence(reading.id, signal)}
                      errorMessage={contractError}
                    />
                  ),
              )}
            </Stack>
            {i.observed.assets.flatMap((a) =>
              (a.evidenceIds ?? []).map((fileId, n) => (
                <PrivateEvidenceViewer
                  key={`${a.id}-${fileId}`}
                  label={`${a.name} · Ảnh v${i.version} · ${n + 1}`}
                  filename="tai-san-tra-phong.jpg"
                  fetchBlob={(signal) => api.evidence(contract.id, fileId, signal)}
                  errorMessage={contractError}
                />
              )),
            )}
            <Typography>
              {i.ownerDecision === 'Confirmed'
                ? 'Owner đã xác nhận'
                : i.ownerDecision === 'Reinspection'
                  ? 'Yêu cầu kiểm tra lại'
                  : 'Chờ Owner xác nhận'}{' '}
              · {i.ownerReason}
            </Typography>
          </Stack>
        ))}
        <Typography
          id={`termination-${contract.id}-2`}
          variant="h6"
          component="h3"
          sx={{ scrollMarginTop: 24 }}
        >
          Quyết toán tài chính
        </Typography>
        {summary && (
          <>
            <Typography variant="h6">Nguồn quyết toán</Typography>
            <Typography>
              Cọc bảo đảm đã xác minh: {money(summary.verifiedSecurityDeposit)} · Cọc giữ chỗ đã áp
              dụng: {money(summary.appliedHoldingDeposit)}
            </Typography>
            <Typography>
              Nợ riêng hợp đồng: {money(summary.contractSpecificOutstanding)} · Phí cuối kỳ:{' '}
              {money(summary.approvedFinalCharges)}
            </Typography>
            <Typography>
              Khấu trừ đã duyệt: {money(summary.approvedDeductions)} · Hoàn tiền:{' '}
              {money(summary.refundAmount)}
            </Typography>
            {summary.calculation && (
              <>
                <Typography>
                  Đã phát hành: {money(summary.calculation.issuedTotal)} · Phải thu hiệu lực:{' '}
                  {money(summary.calculation.payableTotal)} · Đã phân bổ hóa đơn:{' '}
                  {money(summary.calculation.verifiedInvoicePayments)}
                </Typography>
                <Typography>
                  Cọc đã dùng: {money(summary.calculation.depositAllocated)} · Đã hoàn cọc:{' '}
                  {money(summary.calculation.depositRefunded)} · Cọc giữ chỗ hoàn:{' '}
                  {money(summary.calculation.depositReserved)} · Cọc khả dụng:{' '}
                  {money(summary.calculation.availableSecurityDeposit)}
                </Typography>
              </>
            )}
            <Typography>
              {summary.otherActiveContracts
                ? 'Phòng còn hợp đồng đang thuê khác; hoàn tất người này vẫn giữ phòng Đang thuê.'
                : 'Máy chủ sẽ kiểm tra điều kiện giải phóng phòng khi hoàn tất.'}
            </Typography>
            {summary.invoices.map((i) => (
              <Alert
                key={i.invoiceId}
                severity={i.financials.outstandingAmount === '0' ? 'info' : 'warning'}
              >
                Kỳ {displayContractDate(i.billingPeriod)} ·{' '}
                {i.shared ? 'Hóa đơn chung phòng' : 'Hóa đơn'} · Gốc{' '}
                {money(i.financials.originalIssuedAmount)} · Điều chỉnh{' '}
                {signedVnd(i.financials.approvedAdjustmentTotal)} · Phải thu{' '}
                {money(i.financials.effectivePayableAmount)} · Đã trả{' '}
                {money(i.financials.allocatedPayments)} · Còn nợ{' '}
                {money(i.financials.outstandingAmount)} · Dư{' '}
                {money(i.financials.potentialExcessAmount)}
                <Button
                  size="small"
                  href={`/invoices?invoiceId=${encodeURIComponent(i.invoiceId)}`}
                >
                  Mở hóa đơn
                </Button>
              </Alert>
            ))}
            {summary.unresolvedItems.map((b) => (
              <Alert key={b} severity="warning">
                {settlementBlocker(b)}
              </Alert>
            ))}
            {inspection?.ownerDecision === 'Confirmed' && !summary.depositDeductions && (
              <SettlementReceivablesPanel
                key={`receivables:${contract.id}`}
                api={api}
                id={contract.id}
                inspection={inspection}
                summary={summary}
                saved={async () => {
                  await reload();
                }}
              />
            )}
            {!/^0(?:\.0+)?$/.test(summary.verifiedSecurityDeposit) && (
              <>
                {inspection?.ownerDecision === 'Confirmed' && summary.depositDeductions && (
                  <DepositDeductionsPanel
                    key={`deductions:${summary.reference}`}
                    summary={summary}
                    api={api}
                    contractId={contract.id}
                  />
                )}
                <RefundPanel
                  sourceId={contract.id}
                  sourceKind="SecurityDeposit"
                  onChanged={() => {
                    q.reload();
                    onChanged();
                  }}
                />
              </>
            )}
            {summary.resolved && (
              <Alert severity="success">Các nguồn hiện tại đủ điều kiện xem xét hoàn tất.</Alert>
            )}
          </>
        )}
        {!moveOut.isForced && !q.loading && (q.summary || q.inspections.length > 0) && (
          <>
            <TextField
              label="Lý do / căn cứ của Owner"
              multiline
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            {inspection && !inspection.ownerDecision && moveOut.status === 'Inspected' && (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={noCharges}
                      onChange={(e) =>
                        setNoChargesInspection(e.target.checked ? inspectionKey : null)
                      }
                    />
                  }
                  label="Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu"
                />
                <ConfirmActionButton
                  title="Xác nhận kết quả kiểm tra thực tế"
                  description="Kiểm tra các số liệu, ảnh công tơ và hiện trạng Staff ghi nhận. Đây không phải thao tác lập biên bản, ký nhận hay quyết toán tài chính."
                  confirmationKey={`${inspection.id}:${inspection.version}:${reason}:${noCharges}`}
                  disabled={busy || !reason.trim()}
                  onConfirm={() =>
                    save('move-out/inspection-review', {
                      version: inspection.version,
                      confirmed: true,
                      reason,
                      noAdditionalCharges: noCharges,
                    })
                  }
                >
                  Xác nhận kết quả kiểm tra
                </ConfirmActionButton>
                <ConfirmActionButton
                  title="Yêu cầu kiểm tra lại"
                  description={reason}
                  confirmationKey={`${inspection.id}:${inspection.version}:${reason}`}
                  disabled={busy || !reason.trim()}
                  onConfirm={() =>
                    save('move-out/inspection-review', {
                      version: inspection.version,
                      confirmed: false,
                      reason,
                    })
                  }
                >
                  Yêu cầu kiểm tra lại
                </ConfirmActionButton>
              </>
            )}
            {inspection?.ownerDecision === 'Confirmed' && (
              <>
                <Alert severity="info">
                  Hoàn tất trả phòng độc lập với quyết toán. Phòng có Tenant khác sẽ tiếp tục Đang
                  thuê.
                </Alert>
                <TextField
                  select
                  label="Trạng thái phòng nếu không còn Tenant"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value)}
                  disabled={busy}
                >
                  <MenuItem value="Available">Có thể cho thuê lại</MenuItem>
                  <MenuItem value="Unavailable">Chưa cho thuê · cần bảo trì / kiểm tra</MenuItem>
                </TextField>
                <Button
                  variant="contained"
                  disabled={busy || !disposition}
                  onClick={() =>
                    void save('move-out/complete', {
                      actualEndDate: inspection.observed.date,
                      roomDisposition: disposition,
                    })
                  }
                >
                  Hoàn tất trả phòng
                </Button>
              </>
            )}
            {summary &&
              ['Inspected', 'PendingSettlement', 'Settled', 'Completed'].includes(
                moveOut.status,
              ) && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={checked}
                        onChange={(e) =>
                          setReviewedReference(e.target.checked ? summary.reference : null)
                        }
                      />
                    }
                    label="Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý"
                  />
                  <ConfirmActionButton
                    title="Xác nhận xem xét quyết toán"
                    description="Lưu quyết định theo số liệu đang hiển thị. Chỉ khi máy chủ xác minh đủ nghĩa vụ mới ghi nhận đã quyết toán; HTTP thành công chưa đồng nghĩa hết nợ."
                    confirmationKey={`${summary.reference}:${reason}`}
                    disabled={busy || !checked || !reason.trim()}
                    onConfirm={() =>
                      save('move-out/settlement', {
                        decision: reason,
                        expectedReference: summary.reference,
                      })
                    }
                  >
                    Lưu xem xét quyết toán
                  </ConfirmActionButton>
                </>
              )}
          </>
        )}
        <Typography
          id={`termination-${contract.id}-3`}
          variant="h6"
          component="h3"
          sx={{ scrollMarginTop: 24 }}
        >
          Lịch sử trả phòng
        </Typography>
        {!q.loading && !q.history.length && !q.sectionErrors.history && (
          <Typography color="text.secondary">Chưa có lịch sử trả phòng.</Typography>
        )}
        {q.history.map((h) => (
          <Stack
            key={`${h.version}:${h.action}`}
            spacing={0.5}
            sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}
          >
            <Typography variant="caption">
              {formatInstant(h.occurredAt)} · Phiên bản {h.version} · {moveOutActionLabel(h.action)}
            </Typography>
            {historyNote(h.snapshot) && (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {historyNote(h.snapshot)}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </ChartCard>
  );
}
