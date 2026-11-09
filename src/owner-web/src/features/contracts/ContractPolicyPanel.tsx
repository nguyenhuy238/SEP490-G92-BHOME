import { useMemo, useState } from 'react';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  mutationKeys,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';
import { useSetupAction } from '../property/useSetupAction';

export function ContractPolicyPanel({
  api: contracts,
  contract,
  actorId,
  onChanged,
}: {
  api: ContractClient;
  contract: Pick<ContractView, 'id' | 'locationId' | 'status' | 'kind'>;
  actorId: string;
  onChanged: (nextId?: string) => void;
}) {
  const api = useMemo(() => propertySetupClient(contracts.transport), [contracts]);
  const action = useSetupAction();
  const [policyId, setPolicyId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [createdId, setCreatedId] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const agreement = useQuery({
    queryKey: ['property-setup', 'contract-policy', actorId, contract.id],
    queryFn: ({ signal }) => api.agreedPolicy(contract.id, signal),
  });
  const policies = useQuery({
    queryKey: ['property-setup', 'policies', actorId, contract.locationId],
    queryFn: ({ signal }) => api.policies(contract.locationId, signal),
    enabled: contract.status === 'Active' && !!contract.locationId,
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Nội quy đã thỏa thuận & Phụ lục</Typography>
        {agreement.error && <Alert severity="error">{invoiceError(agreement.error)}</Alert>}
        {agreement.data && (
          <>
            <Typography>
              {agreement.data.status === 'Accepted'
                ? 'Đã có bằng chứng chấp thuận'
                : agreement.data.status === 'NotRecorded'
                  ? 'Chưa có nội quy được ghi nhận trong hợp đồng'
                  : 'Cần kiểm tra bằng chứng chấp thuận'}
            </Typography>
            {agreement.data.policy && (
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {agreement.data.policy.title}
                {'\n'}
                {agreement.data.policy.content}
              </Typography>
            )}
          </>
        )}
        {policies.error && <Alert severity="error">{invoiceError(policies.error)}</Alert>}
        {action.error && <Alert severity="error">{action.error}</Alert>}
        {action.notice && <Alert severity="success">{action.notice}</Alert>}
        {contract.status === 'Active' && contract.kind !== 'Addendum' && (
          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              const input = { policyId, date, reason };
              action.run(async () => {
                const result = await api.amendPolicy(
                  contract.id,
                  policyId,
                  date,
                  reason,
                  keys.get('policy-amendment', input),
                );
                setCreatedId(result.contractId);
                keys.confirmed('policy-amendment', input);
              }, 'Máy chủ đã tạo phụ lục nháp. Cần ký và Owner áp dụng theo quy trình hợp đồng.');
            }}
          >
            <Alert severity="info">
              Không sửa trực tiếp nội quy đã ký. Phụ lục cần đủ chữ ký hợp lệ trước khi Owner áp
              dụng.
            </Alert>
            <TextField
              required
              select
              label="Nội quy đề xuất cho phụ lục"
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
            >
              <MenuItem value="">Chọn nội quy đã công bố</MenuItem>
              {policies.data
                ?.filter((policy) => policy.status === 'Published')
                .map((policy) => (
                  <MenuItem key={policy.id} value={policy.id}>
                    {policy.data.title} · {policy.data.effectiveFrom}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              required
              type="date"
              label="Ngày hiệu lực phụ lục"
              slotProps={{ inputLabel: { shrink: true } }}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <TextField
              required
              label="Lý do thay đổi nội quy"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button type="submit" disabled={action.busy || !policyId || !date || !reason.trim()}>
              Tạo phụ lục nội quy
            </Button>
          </Stack>
        )}
        {createdId && (
          <Button onClick={() => onChanged(createdId)}>Mở phụ lục để ký và áp dụng</Button>
        )}
        {contract.kind === 'Addendum' &&
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status) && (
            <>
              <TextField
                required
                label="Lý do hủy phụ lục"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                disabled={action.busy || !reason.trim()}
                onClick={() =>
                  action.run(async () => {
                    await api.cancelAmendment(
                      contract.id,
                      reason,
                      keys.get('policy-cancel', { reason }),
                    );
                    keys.confirmed('policy-cancel', { reason });
                    onChanged();
                  }, 'Máy chủ đã hủy đề xuất phụ lục chưa áp dụng.')
                }
              >
                Hủy đề xuất phụ lục
              </Button>
            </>
          )}
      </Stack>
    </Paper>
  );
}
