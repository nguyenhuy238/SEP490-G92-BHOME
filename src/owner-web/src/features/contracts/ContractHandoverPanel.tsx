import { useRef, useState } from 'react';
import { Alert, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import {
  contractError,
  mutationKeys,
  displayContractDate,
  text,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useContractHandover } from '../../../../../packages/client-core/src/useContractHandover';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ChartCard } from '../../components/common/PortalUI';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { handoverAssetSummary } from '../../../../../packages/client-core/src/handoverForm';
import { ContractAssetChangesPanel } from './ContractAssetChangesPanel';

export function ContractHandoverPanel({ api, id }: { api: ContractClient; id: string }) {
  const query = useContractHandover(api, id, false);
  const h = query.data?.record;
  const [reason, setReason] = useState(''),
    [plan, setPlan] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const sourceId = h?.sourceContractId ?? id;
  async function review(accepted: boolean) {
    if (!h || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = { version: h.version, accepted, reason, handlingPlan: plan };
    try {
      await api.mutate(id, 'handover/owner-review', body, keys.get('review', body));
      keys.confirmed('review', body);
      setReason('');
      setPlan('');
      query.reload();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ChartCard
      title="Bàn giao nhận phòng (UC-17)"
      subtitle="Staff ghi nhận · Tenant xác nhận phiên bản · Staff hoàn tất"
    >
      <Stack spacing={1}>
        {query.loading && <LinearProgress />}
        {!!query.error && <Alert severity="error">{query.error}</Alert>}
        {!!error && <Alert severity="error">{error}</Alert>}
        {!query.loading && !query.error && !h && (
          <Typography>
            Chưa có biên bản nhận phòng. Staff được phân công lập biên bản trên Mobile sau khi hợp
            đồng Active.
          </Typography>
        )}
        {h && (
          <>
            <Typography>
              Phiên bản {h.version} · {text(h.status)} · Ngày {displayContractDate(h.snapshot.date)}
            </Typography>
            <Typography>
              Phòng {h.snapshot.roomNumber}: {h.snapshot.roomCondition}
            </Typography>
            <Typography>Chìa khóa / quyền truy cập: {h.snapshot.keysAndAccess}</Typography>
            <Typography>{h.snapshot.notes}</Typography>
            {h.snapshot.assets.map((a) => (
              <Typography key={a.id}>{handoverAssetSummary(a)}</Typography>
            ))}
            {h.snapshot.noAssetsConfirmed && (
              <Alert severity="info">Owner đã xác nhận phòng không có tài sản bàn giao.</Alert>
            )}
            {h.snapshot.ownerAcceptance && (
              <Alert severity="info">
                Ngoại lệ đã duyệt: {h.snapshot.ownerAcceptance.reason} · Phương án:{' '}
                {h.snapshot.ownerAcceptance.handlingPlan}
              </Alert>
            )}
            {h.status !== 'Confirmed' && (
              <>
                <Alert severity="warning">
                  Bàn giao chưa hoàn tất; Tenant có thể ở phòng trong khi chờ xử lý. Mỗi quyết định
                  tạo phiên bản mới và cần Tenant xác nhận lại.
                </Alert>
                <TextField
                  label="Lý do quyết định ngoại lệ bàn giao"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  multiline
                  disabled={busy}
                />
                <TextField
                  label="Phương án bổ sung / sửa chữa / kiểm tra lại"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  multiline
                  disabled={busy}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    disabled={busy || !reason.trim() || !plan.trim()}
                    onClick={() => void review(true)}
                  >
                    Chấp nhận bàn giao theo thực tế
                  </Button>
                  <Button
                    disabled={busy || !reason.trim() || !plan.trim()}
                    onClick={() => void review(false)}
                  >
                    Yêu cầu Staff kiểm tra lại
                  </Button>
                </Stack>
              </>
            )}
            <Typography>
              Điện: {h.snapshot.electricity.value} · Nước: {h.snapshot.water.value} · chỉ số đã xác
              nhận ngày {displayContractDate(h.snapshot.date)}
            </Typography>
            <Typography>
              Tenant:{' '}
              {h.tenantConfirmedAt
                ? formatInstant(h.tenantConfirmedAt)
                : 'Chưa xác nhận phiên bản này'}{' '}
              · Staff: {h.staffConfirmedAt ? formatInstant(h.staffConfirmedAt) : 'Chưa hoàn tất'}
            </Typography>
            {h.snapshot.evidenceIds.map((fileId, i) => (
              <PrivateEvidenceViewer
                key={fileId}
                label={`Ảnh bàn giao ${i + 1}`}
                filename={`ban-giao-${i + 1}.jpg`}
                fetchBlob={(signal) => api.handoverEvidence(sourceId, fileId, signal)}
                errorMessage={contractError}
              />
            ))}
            {h.snapshot.assets.flatMap((a) =>
              (a.evidenceIds ?? []).map((fileId, index) => (
                <PrivateEvidenceViewer
                  key={`${a.id}-${fileId}`}
                  label={`${a.name} · Ảnh ${index + 1}`}
                  filename="tai-san.jpg"
                  fetchBlob={(signal) => api.handoverEvidence(sourceId, fileId, signal)}
                  errorMessage={contractError}
                />
              )),
            )}
            {[h.snapshot.electricity, h.snapshot.water].map((reading, i) => (
              <PrivateEvidenceViewer
                key={reading.id}
                label={`Ảnh chỉ số ${i === 0 ? 'điện' : 'nước'}`}
                filename={`chi-so-ban-giao-${i + 1}.jpg`}
                fetchBlob={(signal) => api.handoverMeterEvidence(sourceId, reading.id, signal)}
                errorMessage={contractError}
              />
            ))}
          </>
        )}
        {query.data?.history.map((event, i) => (
          <Typography key={i} variant="body2">
            {formatInstant(event.occurredAt)} · v{event.version} · {text(event.action)} {event.note}
          </Typography>
        ))}
        {query.data?.documents.map((document) => (
          <PrivateEvidenceViewer
            key={document.id}
            label={`${text(document.kind)} · PDF v${document.templateVersion}`}
            filename="bien-ban-ban-giao.pdf"
            contentType="application/pdf"
            fetchBlob={(signal) => api.handoverDocument(document.contractId, document.id, signal)}
            errorMessage={contractError}
          />
        ))}
        {h?.status === 'Confirmed' && <ContractAssetChangesPanel api={api} id={id} />}
        <Button onClick={query.reload} disabled={query.loading}>
          Tải lại bàn giao
        </Button>
      </Stack>
    </ChartCard>
  );
}
