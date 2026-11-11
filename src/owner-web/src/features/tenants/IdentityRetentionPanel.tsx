import { useState } from 'react';
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
import {
  type IdentityRetentionView,
  identityRetentionReason,
} from '../../../../../packages/client-core/src/identityRetention';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';

export function IdentityRetentionPanel({ residentId }: { residentId: string }) {
  const [open, setOpen] = useState(false),
    [operation, setOperation] = useState('Review'),
    [holdId, setHoldId] = useState(''),
    [reason, setReason] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const path = `/api/v1/residents/${residentId}/identity-retention`;
  const query = useOwnerQuery<IdentityRetentionView>(
    ['identity-retention', residentId],
    path,
    open,
  );
  const action = useOwnerAction();
  const signature = JSON.stringify([residentId, query.data?.reference, operation, holdId, reason]);
  const checked = confirmation === signature;
  async function save() {
    if (
      !query.data ||
      query.isFetching ||
      !checked ||
      !reason.trim() ||
      (operation === 'ReleaseHold' && !query.data.activeHolds.some((h) => h.id === holdId))
    )
      return;
    const ok = await action.run(
      () =>
        action.command(path + '/reviews', 'POST', {
          expectedReference: query.data!.reference,
          action: operation,
          holdId: operation === 'ReleaseHold' ? holdId : null,
          reason: reason.trim(),
          humanConfirmed: true,
        }),
      'Đã lưu metadata rà soát; dữ liệu định danh được giữ nguyên.',
    );
    if (ok) {
      setConfirmation('');
      setReason('');
      setHoldId('');
    }
  }
  return (
    <Stack spacing={2}>
      <Button onClick={() => setOpen((value) => !value)}>
        {open ? 'Ẩn lưu giữ định danh' : 'Lưu giữ và rà soát định danh'}
      </Button>
      {open && (
        <>
          <OwnerFeedback
            busy={query.isFetching || action.busy}
            error={query.error || action.error}
            notice={action.notice}
          />
          <Button disabled={query.isFetching || action.busy} onClick={() => void query.refetch()}>
            Tải lại metadata lưu giữ
          </Button>
          <Alert severity="info">
            Chưa có thao tác xóa hoặc ẩn danh hóa tại đây. Không nhập số CCCD hoặc thông tin định
            danh vào lý do rà soát.
          </Alert>
          {query.data && (
            <>
              <Typography>
                Quyết định chính sách:{' '}
                {query.data.policy.approvedDecisionReference || 'Chưa được phê duyệt/cấu hình'} ·
                Thời hạn:{' '}
                {query.data.policy.retentionDays == null
                  ? 'Chưa được duyệt'
                  : `${query.data.policy.retentionDays} ngày theo cấu hình`}
              </Typography>
              <Typography>
                Căn cứ tính:{' '}
                {query.data.policy.startBasis === 'LatestActualMoveOut'
                  ? 'Lần kết thúc cư trú thực tế gần nhất'
                  : query.data.policy.startBasis === 'IdentityVerification'
                    ? 'Ngày xác minh định danh'
                    : 'Chưa được duyệt'}{' '}
                · Ngày bắt đầu:{' '}
                {query.data.startDate ? displayContractDate(query.data.startDate) : 'Chưa có'} ·
                Ngày xét lại:{' '}
                {query.data.reviewAfter ? displayContractDate(query.data.reviewAfter) : 'Chưa có'}
              </Typography>
              {query.data.blockingReasons.map((code) => (
                <Typography key={code}>{identityRetentionReason(code)}</Typography>
              ))}
              {!query.data.blockingReasons.length && (
                <Typography>
                  Đủ dữ liệu để rà soát theo chính sách. Việc này chưa cho phép xóa hồ sơ.
                </Typography>
              )}
              <TextField
                select
                label="Thao tác metadata lưu giữ"
                value={operation}
                disabled={action.busy}
                onChange={(e) => setOperation(e.target.value)}
              >
                <MenuItem value="Review">Ghi nhận rà soát</MenuItem>
                <MenuItem value="PlaceHold">Đặt giữ hồ sơ</MenuItem>
                <MenuItem value="ReleaseHold">Gỡ một lệnh giữ</MenuItem>
              </TextField>
              {operation === 'ReleaseHold' && (
                <TextField
                  select
                  label="Lệnh giữ cần gỡ"
                  value={holdId}
                  disabled={action.busy}
                  onChange={(e) => setHoldId(e.target.value)}
                >
                  {query.data.activeHolds.map((hold) => (
                    <MenuItem value={hold.id} key={hold.id}>
                      {formatInstant(hold.at)} · {hold.reason}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label="Lý do rà soát/giữ hồ sơ"
                value={reason}
                multiline
                slotProps={{ htmlInput: { maxLength: 1000 } }}
                disabled={action.busy}
                onChange={(e) => setReason(e.target.value)}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked}
                    disabled={action.busy || query.isFetching}
                    onChange={(_, value) => setConfirmation(value ? signature : '')}
                  />
                }
                label="Tôi đã đọc chính sách, nghĩa vụ và các lệnh giữ đang hiển thị"
              />
              <Button
                disabled={
                  action.busy ||
                  query.isFetching ||
                  !checked ||
                  !reason.trim() ||
                  (operation === 'ReleaseHold' &&
                    !query.data.activeHolds.some((h) => h.id === holdId))
                }
                onClick={() => void save()}
              >
                Lưu metadata rà soát
              </Button>
              <Typography variant="subtitle1">Lịch sử rà soát</Typography>
              {!query.data.history.length && <Typography>Chưa có rà soát lưu giữ.</Typography>}
              {query.data.history
                .slice()
                .reverse()
                .map((entry) => (
                  <Typography key={entry.id}>
                    {formatInstant(entry.at)} ·{' '}
                    {entry.action === 'PlaceHold'
                      ? 'Đặt giữ'
                      : entry.action === 'ReleaseHold'
                        ? 'Gỡ giữ'
                        : 'Rà soát'}{' '}
                    · {entry.reason}
                  </Typography>
                ))}
            </>
          )}
        </>
      )}
    </Stack>
  );
}
