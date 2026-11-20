import { useRef, useState } from 'react';
import { Alert, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import {
  contractError,
  mutationKeys,
  text,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useContractHandover } from '../../../../../packages/client-core/src/useContractHandover';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ChartCard } from '../../components/common/PortalUI';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { ContractAssetChangesPanel } from './ContractAssetChangesPanel';
import { HandoverDocumentPreview } from './HandoverDocumentPreview';
import { OwnerHandoverDraftPanel } from './OwnerHandoverDraftPanel';

export function ContractHandoverPanel({
  api,
  id,
  contractStatus,
  showDraft = true,
}: {
  api: ContractClient;
  id: string;
  contractStatus?: string;
  showDraft?: boolean;
}) {
  return (
    <Stack spacing={2}>
      {showDraft && <OwnerHandoverDraftPanel api={api} id={id} contractStatus={contractStatus} />}
      <LegacyContractHandoverPanel api={api} id={id} />
    </Stack>
  );
}

function LegacyContractHandoverPanel({ api, id }: { api: ContractClient; id: string }) {
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
  if (
    typeof api.transport === 'function' &&
    !query.loading &&
    !query.error &&
    !h &&
    !query.data?.documents?.length &&
    !query.data?.history?.length
  )
    return null;
  return (
    <ChartCard
      title="Lịch sử và bằng chứng bàn giao (UC-17)"
      subtitle="Các biên bản và quyết định đã được ghi nhận trước đây"
    >
      <Stack spacing={1}>
        {query.loading && <LinearProgress />}
        {!!query.error && <Alert severity="error">{query.error}</Alert>}
        {!!error && <Alert severity="error">{error}</Alert>}
        {!query.loading && !query.error && !h && (
          <Typography>
            Chưa có bản nháp bàn giao cho hợp đồng này. Kiểm tra lại sau khi hợp đồng được tạo và
            đồng bộ với máy chủ.
          </Typography>
        )}
        {h && (
          <>
            <Typography variant="body2" color="text.secondary">
              Trạng thái máy chủ: {text(h.status)}
            </Typography>
            <HandoverDocumentPreview record={h} />
            {h.snapshot?.ownerAcceptance && (
              <Alert severity="info">
                Ngoại lệ đã duyệt: {h.snapshot.ownerAcceptance.reason} · Phương án:{' '}
                {h.snapshot.ownerAcceptance.handlingPlan}
              </Alert>
            )}
            {h.snapshot?.tenantFeedback?.confirmed === false && (
              <Alert severity="warning">
                Tenant yêu cầu điều chỉnh: {h.snapshot.tenantFeedback.reason}
              </Alert>
            )}
            {h.status !== 'Confirmed' && h.status !== 'Ready' && (
              <>
                <Typography variant="subtitle2">Xem xét ngoại lệ hiện trạng</Typography>
                <Typography variant="body2" color="text.secondary">
                  Nếu kết quả kiểm kê có sai khác, Owner có thể chấp nhận kèm lý do và phương án xử
                  lý, hoặc yêu cầu Staff kiểm tra lại. Mỗi quyết định tạo phiên bản mới.
                </Typography>
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
            {(h.snapshot?.evidenceIds ?? []).map((fileId, i) => (
              <PrivateEvidenceViewer
                key={fileId}
                label={`Ảnh bàn giao ${i + 1}`}
                filename={`ban-giao-${i + 1}.jpg`}
                fetchBlob={(signal) => api.handoverEvidence(sourceId, fileId, signal)}
                errorMessage={contractError}
              />
            ))}
            {(h.snapshot?.assets ?? []).flatMap((a) =>
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
            {[h.snapshot?.electricity, h.snapshot?.water]
              .filter((reading) => !!reading?.id)
              .map((reading, i) => (
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
