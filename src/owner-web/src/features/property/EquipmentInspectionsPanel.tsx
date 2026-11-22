import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Pagination,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router';
import {
  equipmentInspectionClient,
  inspectionLabels,
  type EquipmentInspection,
} from '../../../../../packages/client-core/src/equipmentInspections';
import {
  assetLifecycleClient,
  lifecycleError,
  type LifecyclePolicy,
} from '../../../../../packages/client-core/src/assetLifecycle';
import type {
  PhysicalAsset,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { useMeterApi } from '../meters/useMeterApi';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';

export function EquipmentInspectionsPanel({ asset }: { asset: PhysicalAsset }) {
  const { request } = useMeterApi();
  const api = equipmentInspectionClient(request);
  const [page, setPage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);
  const [open, setOpen] = useState(false);
  const cache = useQueryClient();
  const cycles = useQuery({
    queryKey: ['equipment-inspections', asset.id, page],
    queryFn: () => api.list(asset.id, page),
  });
  const schedules = useQuery({
    queryKey: ['equipment-inspection-schedules', asset.id, schedulePage],
    queryFn: () => api.schedules(asset.id, schedulePage),
  });
  const generate = useMutation({
    mutationFn: api.generate,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['equipment-inspections'] });
    },
  });
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Kiểm tra thiết bị</Typography>
        <Button onClick={() => setOpen(true)}>Lập lịch kiểm tra</Button>
      </Stack>
      {(cycles.isError || schedules.isError || generate.isError) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void cycles.refetch();
                void schedules.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {lifecycleError(cycles.error ?? schedules.error ?? generate.error)}
        </Alert>
      )}
      {cycles.isPending && <Typography role="status">Đang tải kiểm tra…</Typography>}
      {schedules.data?.items.map((item) => (
        <Stack
          key={item.id}
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Typography>
            Từ {displayContractDate(item.data.startsOn)} ·{' '}
            {item.data.intervalDays ? `Mỗi ${item.data.intervalDays} ngày` : 'Một lần'}
            {item.status === 'NeedsConfiguration' ? ' · Cần bổ sung thiết bị' : ''}
          </Typography>
          <Button
            disabled={generate.isPending || !item.data.enabled}
            onClick={() => generate.mutate(item.id)}
          >
            Tạo nhiệm vụ đến kỳ
          </Button>
        </Stack>
      ))}
      {schedules.data && schedules.data.totalCount > 20 && (
        <Pagination
          page={schedulePage}
          count={Math.ceil(schedules.data.totalCount / 20)}
          onChange={(_, value) => setSchedulePage(value)}
        />
      )}
      {generate.isSuccess && (
        <Typography role="status">Đã tạo {generate.data.created} nhiệm vụ mới.</Typography>
      )}
      {cycles.data?.totalCount === 0 && <Typography>Chưa có kỳ kiểm tra.</Typography>}
      {cycles.data?.items.map((item) => (
        <InspectionReviewPanel key={`${item.id}:${item.version}`} document={item} />
      ))}
      {cycles.data && cycles.data.totalCount > 20 && (
        <Pagination
          page={page}
          count={Math.ceil(cycles.data.totalCount / 20)}
          onChange={(_, value) => setPage(value)}
        />
      )}
      {open && (
        <InspectionScheduleForm
          asset={asset}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void cache.invalidateQueries({ queryKey: ['equipment-inspection-schedules'] });
          }}
        />
      )}
    </Stack>
  );
}

export function TaskInspectionReview({ taskId }: { taskId: string }) {
  const { request } = useMeterApi();
  const query = useQuery({
    queryKey: ['equipment-inspection-task', taskId],
    queryFn: ({ signal }) => equipmentInspectionClient(request).forTask(taskId, signal),
  });
  if (query.isError)
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
      >
        {lifecycleError(query.error)}
      </Alert>
    );
  return query.data?.kind === 'EquipmentInspection' ? (
    <InspectionReviewPanel key={`${query.data.id}:${query.data.version}`} document={query.data} />
  ) : null;
}

function InspectionReviewPanel({
  document: record,
}: {
  document: SetupDocument<EquipmentInspection>;
}) {
  const { request } = useMeterApi();
  const cache = useQueryClient();
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const data = record.data;
  const api = equipmentInspectionClient(request);
  const mutation = useMutation({
    mutationFn: (action: 'Verify' | 'Rework' | 'Cancel' | 'Remediate') =>
      action === 'Remediate'
        ? api.remediate(
            record.id,
            record.version,
            note,
            'Khắc phục và kiểm tra lại thiết bị',
            `${deadline}T23:59:59+07:00`,
          )
        : api.review(record.id, record.version, action, note),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['equipment-inspections'] });
      void cache.invalidateQueries({ queryKey: ['equipment-inspection-task'] });
      void cache.invalidateQueries({ queryKey: ['asset-lifecycle-units'] });
      void cache.invalidateQueries({ queryKey: ['asset-lifecycle-summary'] });
      void cache.invalidateQueries({ queryKey: ['owner-workspace'] });
    },
  });
  return (
    <Stack spacing={1} sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
      <Typography variant="subtitle1">
        Kỳ {displayContractDate(data.period)} · {inspectionLabels[record.status]} ·{' '}
        {inspectionLabels[data.outcome]}
      </Typography>
      {data.progress && (
        <Typography>
          Đã kiểm tra {data.progress.inspected}/{data.progress.total} · Đạt {data.progress.passed} ·
          Không đạt {data.progress.failed} · Chưa kiểm tra {data.progress.notInspected}
        </Typography>
      )}
      <Typography variant="caption">
        {data.policySnapshot.name} · Phiên bản {data.policyVersion}
      </Typography>
      <Button component={Link} to={`/operational-tasks?taskId=${data.taskId}`}>
        Xem ảnh và lịch sử nhiệm vụ
      </Button>
      {data.units.map((unit) => (
        <Stack key={unit.id}>
          <Typography sx={{ fontWeight: 600 }}>
            {unit.label} · {unit.position}
          </Typography>
          {data.answers
            .filter((answer) => answer.unitId === unit.id)
            .map((answer) => (
              <Typography key={answer.checklistCode} variant="body2">
                {
                  data.policySnapshot.checklist.find((item) => item.code === answer.checklistCode)
                    ?.label
                }{' '}
                · {inspectionLabels[answer.result]}
                {answer.note ? ` · ${answer.note}` : ''}
              </Typography>
            ))}
        </Stack>
      ))}
      {data.reviewNote && <Typography>Ghi chú Owner · {data.reviewNote}</Typography>}
      {mutation.isError && <Alert severity="error">{lifecycleError(mutation.error)}</Alert>}
      {(record.status === 'Draft' ||
        record.status === 'Submitted' ||
        (record.status === 'Verified' &&
          data.outcome === 'Failed' &&
          !data.remediationWorkOrderId)) && (
        <TextField
          label="Ghi chú xác minh / vấn đề cần khắc phục"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          multiline
        />
      )}
      {record.status === 'Submitted' && (
        <Stack direction="row" spacing={1}>
          <Button
            disabled={mutation.isPending || !note.trim()}
            onClick={() => mutation.mutate('Verify')}
          >
            Xác minh kết quả
          </Button>
          <Button
            disabled={mutation.isPending || !note.trim()}
            onClick={() => mutation.mutate('Rework')}
          >
            Yêu cầu kiểm tra lại
          </Button>
        </Stack>
      )}
      {['Draft', 'Submitted'].includes(record.status) && (
        <Button
          disabled={mutation.isPending || !note.trim()}
          onClick={() => mutation.mutate('Cancel')}
        >
          Hủy kỳ kiểm tra theo ghi chú
        </Button>
      )}
      {record.status === 'Verified' &&
        data.outcome === 'Failed' &&
        !data.remediationWorkOrderId && (
          <>
            <TextField
              type="date"
              label="Hạn khắc phục"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button
              disabled={mutation.isPending || !note.trim() || !deadline}
              onClick={() => mutation.mutate('Remediate')}
            >
              Tạo bảo trì chủ động
            </Button>
          </>
        )}
      {data.remediationWorkOrderId && (
        <Button component={Link} to={`/maintenance?workOrderId=${data.remediationWorkOrderId}`}>
          Theo dõi bảo trì
        </Button>
      )}
    </Stack>
  );
}

function InspectionScheduleForm({
  asset,
  onClose,
  onSaved,
}: {
  asset: PhysicalAsset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const [policyPage, setPolicyPage] = useState(1);
  const [selectedPolicy, setSelectedPolicy] = useState<SetupDocument<LifecyclePolicy> | null>(null);
  const policies = useQuery({
    queryKey: ['asset-lifecycle-policies', asset.locationId, policyPage],
    queryFn: ({ signal }) =>
      assetLifecycleClient(request).policies(asset.locationId, policyPage, signal),
  });
  const [id] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const policy = selectedPolicy;
      if (!policy) throw new Error('policy_required');
      return equipmentInspectionClient(request).schedule(asset.id, id, {
        assetId: asset.id,
        policyId: policy.id,
        policyVersion: policy.version,
        startsOn: String(form.get('startsOn')),
        intervalDays: form.has('recurring') ? policy.data.inspectionIntervalDays : null,
        completionWindowDays: Number(form.get('window')),
        enabled: true,
      });
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <DialogTitle>Lập lịch kiểm tra</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {(mutation.isError || policies.isError) && (
              <Alert severity="error">{lifecycleError(mutation.error ?? policies.error)}</Alert>
            )}
            <TextField
              required
              select
              label="Chính sách đã công bố"
              name="policy"
              value={selectedPolicy?.id ?? ''}
              onChange={(event) =>
                setSelectedPolicy(
                  policies.data?.items.find((item) => item.id === event.target.value) ?? null,
                )
              }
            >
              {selectedPolicy &&
                !policies.data?.items.some((item) => item.id === selectedPolicy.id) && (
                  <MenuItem value={selectedPolicy.id}>{selectedPolicy.data.name}</MenuItem>
                )}
              {policies.data?.items
                .filter(
                  (item) => item.status === 'Published' && item.data.category === asset.category,
                )
                .map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.data.name}
                  </MenuItem>
                ))}
            </TextField>
            {policies.data && policies.data.totalCount > 20 && (
              <Pagination
                page={policyPage}
                count={Math.ceil(policies.data.totalCount / 20)}
                onChange={(_, value) => setPolicyPage(value)}
              />
            )}
            <TextField
              required
              type="date"
              label="Ngày bắt đầu"
              name="startsOn"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              required
              type="number"
              label="Số ngày để hoàn thành mỗi kỳ"
              name="window"
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
            />
            <FormControlLabel
              control={<Checkbox name="recurring" />}
              label="Lặp theo chu kỳ kiểm tra đã cấu hình trong policy"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={mutation.isPending} type="submit">
            Lưu lịch kiểm tra
          </Button>
        </DialogActions>
      </ValidatedForm>
    </Dialog>
  );
}
