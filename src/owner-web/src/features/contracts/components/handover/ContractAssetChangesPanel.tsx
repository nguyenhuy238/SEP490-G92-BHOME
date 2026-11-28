import { Alert, Button, Stack, Typography } from '@mui/material';
import type { ContractClient } from '../../../../../../../packages/client-core/src/contracts';
import {
  contractError,
  displayContractDate,
} from '../../../../../../../packages/client-core/src/contracts';
import { useContractAssetChanges } from '../../../../../../../packages/client-core/src/useContractAssetChanges';
import { PrivateEvidenceViewer } from '../../../../components/common/PrivateEvidenceViewer';

export function ContractAssetChangesPanel({ api, id }: { api: ContractClient; id: string }) {
  const q = useContractAssetChanges(api, id, false);
  return (
    <Stack spacing={1}>
      <Typography variant="h6">Bàn giao bổ sung, thay thế và thu hồi</Typography>
      <Typography variant="body2">
        Owner quản lý tài sản tại cơ sở; Staff lập bàn giao từ dữ liệu đó trên Mobile. Mỗi Tenant
        xác nhận riêng, giữ nguyên biên bản nhận phòng ban đầu.
      </Typography>
      {q.loading && <Typography>Đang tải thay đổi tài sản…</Typography>}
      {q.error && <Alert severity="error">{q.error}</Alert>}
      {!q.loading && !q.events.length && (
        <Typography>Chưa có bàn giao thay đổi tài sản.</Typography>
      )}
      {q.events.map((event) => (
        <Stack key={event.id} spacing={1}>
          <Typography sx={{ fontWeight: 600 }}>
            {
              (
                { Supplement: 'Bổ sung', Replacement: 'Thay thế', Withdrawal: 'Thu hồi' } as Record<
                  string,
                  string
                >
              )[event.data.kind]
            }{' '}
            · {displayContractDate(event.data.date)}
          </Typography>
          <Typography>{event.data.reason}</Typography>
          {event.data.lines.map((line) => (
            <Typography key={line.groupId}>
              {event.data.assets.find((a) => a.id === line.groupId)?.name}: thêm{' '}
              {line.addedQuantity}, thu hồi {line.withdrawnQuantity} · {line.condition}
            </Typography>
          ))}
          <Typography>
            {event.data.acknowledgements.filter((a) => a.accepted).length}/
            {event.data.parties.length} Tenant đã xác nhận ·{' '}
            {event.status === 'Disputed'
              ? 'Có phản hồi không đồng ý'
              : event.status === 'Confirmed'
                ? 'Đã xác nhận đủ'
                : 'Đang chờ xác nhận'}
          </Typography>
          {event.data.acknowledgements.map((a) => (
            <Typography key={a.contractId} variant="body2">
              Hợp đồng {a.contractId}: {a.accepted ? 'Đã nhận' : 'Không đồng ý'} · {a.reason}
            </Typography>
          ))}
          {event.data.lines.flatMap((line) =>
            line.evidenceIds.map((fileId, n) => (
              <PrivateEvidenceViewer
                key={`${line.groupId}-${fileId}`}
                label={`Ảnh thay đổi tài sản ${n + 1}`}
                filename="thay-doi-tai-san.jpg"
                fetchBlob={(signal) => api.assetChangeEvidence(id, event.id, fileId, signal)}
                errorMessage={contractError}
              />
            )),
          )}
        </Stack>
      ))}
      <Button disabled={q.loading} onClick={q.reload}>
        Tải lại thay đổi tài sản
      </Button>
    </Stack>
  );
}
