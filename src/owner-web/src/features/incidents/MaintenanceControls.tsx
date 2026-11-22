import { TextField } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import {
  OwnerLocationPicker,
  OwnerRoomPicker,
  OwnerAssetPicker,
} from '../../components/common/OwnerSelectors';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { vietnamInstant } from '../tasks/taskContracts';

export function CreateProactiveMaintenance() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)}>
        Tạo bảo trì chủ động
      </Button>
      {open && <ProactiveForm close={() => setOpen(false)} />}
    </>
  );
}

function ProactiveForm({ close }: { close: () => void }) {
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [area, setArea] = useState('');
  const [asset, setAsset] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [deadline, setDeadline] = useState('');
  const [validation, setValidation] = useState('');
  const action = useOwnerAction();
  const assignment = useOwnerQuery<{ staffId: string | null; available: boolean }>(
    ['maintenance-assignment', location],
    `/api/v1/work-orders/assignment?locationId=${location}`,
    !!location,
  );
  async function save() {
    if (
      !location ||
      description.trim().length < 10 ||
      description.trim().length > 8000 ||
      !outcome.trim() ||
      !deadline ||
      (!room && !area.trim())
    ) {
      setValidation(
        'Chọn cơ sở, phòng hoặc khu vực chung, nhập mô tả 10–8.000 ký tự, kết quả và thời hạn.',
      );
      return;
    }
    let targetCompletionAt: string;
    try {
      targetCompletionAt = vietnamInstant(deadline);
    } catch (error) {
      setValidation((error as Error).message);
      return;
    }
    setValidation('');
    const saved = await action.run(() =>
      action.command('/api/v1/work-orders', 'POST', {
        locationId: location,
        roomId: room || null,
        commonArea: room ? null : area.trim(),
        assetId: asset || null,
        description: description.trim(),
        expectedOutcome: outcome.trim(),
        targetCompletionAt,
      }),
    );
    if (saved) close();
  }
  return (
    <Dialog
      open
      onClose={action.busy ? undefined : close}
      fullWidth
      maxWidth="sm"
      aria-labelledby="proactive-title"
    >
      <DialogTitle id="proactive-title">Tạo bảo trì chủ động</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <OwnerLocationPicker
            required
            value={location}
            change={(value) => {
              setLocation(value);
              setRoom('');
              setAsset('');
            }}
          />
          <OwnerRoomPicker
            location={location}
            value={room}
            change={(value) => {
              setRoom(value);
              setAsset('');
            }}
          />
          {!room && (
            <TextField
              label="Khu vực chung"
              required
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                setAsset('');
              }}
            />
          )}
          <OwnerAssetPicker
            location={location}
            room={room}
            area={area}
            value={asset}
            change={setAsset}
          />
          <TextField
            label="Nội dung bảo trì"
            required
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField
            label="Kết quả yêu cầu"
            required
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <TextField
            label="Hạn hoàn thành"
            required
            type="datetime-local"
            slotProps={{ inputLabel: { shrink: true } }}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
          <OwnerFeedback
            busy={assignment.isFetching || action.busy}
            error={validation || assignment.error || action.error}
          />
          {assignment.data && (
            <Alert severity={assignment.data.available ? 'info' : 'warning'}>
              {assignment.data.available
                ? 'Máy chủ sẽ giao cho Staff đang phụ trách cơ sở hôm nay.'
                : 'Cơ sở chưa có Staff đủ điều kiện. Cập nhật phân công trước khi giao việc.'}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Đóng
        </Button>
        <Button
          variant="contained"
          disabled={action.busy || assignment.isFetching || !assignment.data?.available}
          onClick={() => void save()}
        >
          Tạo và giao việc
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface Policy {
  version: number;
  activeCategories: string[];
}
export function FastRepairPolicyPanel() {
  const [open, setOpen] = useState(false);
  const policy = useOwnerQuery<Policy>(
    ['fast-repair-policy'],
    '/api/v1/work-orders/fast-repair-policy',
    open,
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>Chính sách sửa nhanh</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="fast-policy-title"
      >
        <DialogTitle id="fast-policy-title">Chính sách sửa nhanh toàn hệ thống</DialogTitle>
        <DialogContent>
          <OwnerFeedback busy={policy.isFetching} error={policy.error} />
          {policy.error && <Button onClick={() => void policy.refetch()}>Thử lại</Button>}
          {policy.data && (
            <PolicyForm
              key={policy.data.version}
              policy={policy.data}
              close={() => setOpen(false)}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
function PolicyForm({ policy, close }: { policy: Policy; close: () => void }) {
  const [categories, setCategories] = useState(policy.activeCategories.join('\n'));
  const action = useOwnerAction();
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Alert severity="info">
        Chỉ áp dụng công việc 0 VND, không sử dụng vật tư. Owner xác minh kết quả trước khi hoàn
        tất.
      </Alert>
      <TextField
        label="Nhóm công việc được kích hoạt, mỗi dòng một nhóm"
        multiline
        minRows={4}
        value={categories}
        onChange={(e) => setCategories(e.target.value)}
        disabled={action.busy}
      />
      <Typography variant="body2">
        Gợi ý chưa kích hoạt. Chọn để thêm vào danh sách rồi lưu quyết định.
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
        {['Điều chỉnh cài đặt thiết bị', 'Kiểm tra và khởi động lại thiết bị'].map((name) => (
          <Chip
            key={name}
            label={name}
            variant="outlined"
            onClick={() =>
              setCategories((value) =>
                Array.from(new Set([...value.split('\n').filter(Boolean), name])).join('\n'),
              )
            }
          />
        ))}
      </Stack>
      <OwnerFeedback busy={action.busy} error={action.error} />
      <Button
        variant="contained"
        disabled={action.busy}
        onClick={() =>
          void action
            .run(() =>
              action.command('/api/v1/work-orders/fast-repair-policy', 'POST', {
                version: policy.version,
                activeCategories: categories
                  .split('\n')
                  .map((c) => c.trim())
                  .filter(Boolean),
              }),
            )
            .then((saved) => {
              if (saved) close();
            })
        }
      >
        Lưu chính sách
      </Button>
    </Stack>
  );
}
