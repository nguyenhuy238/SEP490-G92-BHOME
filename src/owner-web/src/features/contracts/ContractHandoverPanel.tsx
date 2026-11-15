import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material';
import {
  contractError,
  displayContractDate,
  text,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useContractHandover } from '../../../../../packages/client-core/src/useContractHandover';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ChartCard } from '../../components/common/PortalUI';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';

export function ContractHandoverPanel({ api, id }: { api: ContractClient; id: string }) {
  const query = useContractHandover(api, id, false);
  const h = query.data?.record;
  return (
    <ChartCard
      title="Bàn giao nhận phòng (UC-17)"
      subtitle="Staff ghi nhận · Tenant xác nhận phiên bản · Staff hoàn tất"
    >
      <Stack spacing={1}>
        {query.loading && <LinearProgress />}
        {!!query.error && <Alert severity="error">{query.error}</Alert>}
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
              <Typography key={a.id}>
                {a.name}: {a.observedCondition} (kiểm kê: {a.inventoryCondition})
              </Typography>
            ))}
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
                fetchBlob={(signal) => api.handoverEvidence(id, fileId, signal)}
                errorMessage={contractError}
              />
            ))}
            {[h.snapshot.electricity, h.snapshot.water].map((reading, i) => (
              <PrivateEvidenceViewer
                key={reading.id}
                label={`Ảnh chỉ số ${i === 0 ? 'điện' : 'nước'}`}
                filename={`chi-so-ban-giao-${i + 1}.jpg`}
                fetchBlob={(signal) => api.handoverMeterEvidence(id, reading.id, signal)}
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
        <Button onClick={query.reload} disabled={query.loading}>
          Tải lại bàn giao
        </Button>
      </Stack>
    </ChartCard>
  );
}
