import { useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { MoneyField } from '../../components/common/MoneyField';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import type { IncidentEvidence, WorkOrder } from './incidentContracts';

interface Compensation {
  id: string;
  contractId: string;
  collectionMethod: 'Invoice' | 'Deposit';
  status: string;
  amount: string;
  reason: string;
  invoiceId: string | null;
  decidedAt: string;
  version: number;
}
const statuses: Record<string, string> = {
  InvoiceIssued: 'Đã phát hành hóa đơn riêng',
  PaymentRecorded: 'Đã ghi nhận thanh toán, xem số dư hóa đơn',
  DepositPending: 'Chờ khấu trừ khi quyết toán trả phòng',
  Deducted: 'Đã khấu trừ khi quyết toán',
  Cancelled: 'Đã hủy quyết định',
};
export function CompensationPanel({
  work,
  evidence,
}: {
  work: WorkOrder;
  evidence: IncidentEvidence[];
}) {
  const path = `/api/v1/work-orders/${work.id}/compensation`;
  const query = useOwnerQuery<Compensation | null>(['maintenance-compensation', work.id], path);
  const contracts = useOwnerQuery<
    { id: string; status: string; startDate: string; endDate: string }[]
  >(['compensation-contracts', work.id], path + '/contracts');
  const [contract, setContract] = useState('');
  const [method, setMethod] = useState('Invoice');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const action = useOwnerAction();
  const row = query.data;
  const history = useOwnerQuery<Compensation[]>(
    ['compensation-history', work.id],
    path + '/history',
    !!row,
  );
  async function create() {
    await action.run(async () => {
      if (
        !contract ||
        !/^[1-9]\d*$/.test(amount) ||
        !reason.trim() ||
        images.length === 0 ||
        (method === 'Invoice' && !due)
      )
        throw new Error(
          'Chọn hợp đồng chịu trách nhiệm, nhập số tiền, lý do, bằng chứng và ngày đến hạn nếu thu hóa đơn.',
        );
      await action.command(path, 'POST', {
        contractId: contract,
        amount,
        collectionMethod: method,
        dueDate: method === 'Invoice' ? due : null,
        reason: reason.trim(),
        evidenceIds: images,
      });
    });
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Bồi thường thiệt hại phòng</Typography>
      <OwnerFeedback
        busy={query.isFetching || action.busy}
        error={query.error || contracts.error || action.error}
        notice={action.notice}
      />
      {(query.error || contracts.error) && (
        <Button
          onClick={() => {
            void query.refetch();
            void contracts.refetch();
          }}
        >
          Thử lại dữ liệu bồi thường
        </Button>
      )}
      {row ? (
        <>
          <Typography>
            {statuses[row.status] ?? row.status} · {formatContractMoney(row.amount)}
          </Typography>
          <Typography>
            Hợp đồng {row.contractId} · {formatInstant(row.decidedAt)}
          </Typography>
          <Typography>{row.reason}</Typography>
          <details>
            <summary>Lịch sử quyết định bồi thường</summary>
            <OwnerFeedback busy={history.isFetching} error={history.error} />
            {history.error && (
              <Button onClick={() => void history.refetch()}>Thử lại lịch sử</Button>
            )}
            {history.data?.map((version) => (
              <Typography key={version.version} variant="body2">
                {formatInstant(version.decidedAt)} · {statuses[version.status] ?? version.status} ·{' '}
                {formatContractMoney(version.amount)} · {version.reason}
              </Typography>
            ))}
          </details>
          {row.invoiceId && (
            <Button component={Link} to={`/invoices?invoiceId=${row.invoiceId}`}>
              Xem hóa đơn, QR và đối soát
            </Button>
          )}
          {row.status === 'DepositPending' && (
            <>
              <Alert severity="info">
                Máy chủ kiểm tra trả phòng, xác nhận kiểm tra và số cọc còn lại trước khi khấu trừ
                toàn bộ nghĩa vụ.
              </Alert>
              <TextField
                label="Lý do quyết toán hoặc hủy quyết định"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={action.busy}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  disabled={action.busy || !reason.trim()}
                  onClick={() =>
                    void action.run(() =>
                      action.command(path + '/deduct', 'POST', { version: row.version, reason }),
                    )
                  }
                >
                  Khấu trừ khi quyết toán
                </Button>
                <Button
                  disabled={action.busy || !reason.trim()}
                  onClick={() =>
                    void action.run(() =>
                      action.command(path + '/cancel', 'POST', { version: row.version, reason }),
                    )
                  }
                >
                  Hủy quyết định chờ thu
                </Button>
              </Stack>
            </>
          )}
        </>
      ) : (
        !query.isFetching &&
        !query.error && (
          <>
            <Alert severity="info">
              Owner xác nhận trách nhiệm theo bằng chứng. Mỗi nghĩa vụ có một phương thức thu. Số
              tiền tối đa bằng chi phí sửa chữa thực tế.
            </Alert>
            <TextField
              select
              label="Hợp đồng chịu trách nhiệm"
              required
              value={contract}
              onChange={(e) => setContract(e.target.value)}
            >
              {(contracts.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.startDate.split('-').reverse().join('/')} –{' '}
                  {c.endDate.split('-').reverse().join('/')} · {c.id}
                </MenuItem>
              ))}
            </TextField>
            <MoneyField
              label="Mức bồi thường (VND)"
              required
              value={amount}
              onValueChange={setAmount}
            />
            <TextField
              select
              label="Phương thức thu"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <MenuItem value="Invoice">Hóa đơn bồi thường riêng</MenuItem>
              <MenuItem value="Deposit">Khấu trừ cọc khi trả phòng</MenuItem>
            </TextField>
            {method === 'Invoice' && (
              <TextField
                required
                type="date"
                label="Ngày đến hạn"
                slotProps={{ inputLabel: { shrink: true } }}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            )}
            <TextField
              label="Lý do và căn cứ trách nhiệm"
              required
              multiline
              minRows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Typography>Chọn bằng chứng đã ghi nhận</Typography>
            {evidence
              .filter((e) => e.activityId)
              .map((e, index) => (
                <FormControlLabel
                  key={e.id}
                  label={`Ảnh ${index + 1} · ${e.kind === 'Completion' ? 'Kết quả sửa chữa' : 'Kiểm tra'}`}
                  control={
                    <Checkbox
                      checked={images.includes(e.id)}
                      onChange={(_, checked) =>
                        setImages((value) =>
                          checked ? [...value, e.id] : value.filter((id) => id !== e.id),
                        )
                      }
                    />
                  }
                />
              ))}
            <Button
              variant="contained"
              disabled={action.busy || !!contracts.error || images.length === 0}
              onClick={() => void create()}
            >
              Xác nhận trách nhiệm và phương thức thu
            </Button>
          </>
        )
      )}
    </Stack>
  );
}
