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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  assetLifecycleClient,
  lifecycleError,
  type EquipmentDetails,
  type EquipmentUnit,
  type LifecyclePolicy,
} from '../../../../../packages/client-core/src/assetLifecycle';
import type {
  PhysicalAsset,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { useMeterApi } from '../meters/useMeterApi';

export function AssetLifecyclePanel({ asset }: { asset: PhysicalAsset }) {
  const { request } = useMeterApi();
  const api = assetLifecycleClient(request);
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SetupDocument<EquipmentUnit> | 'new' | null>(null);
  const [policyForm, setPolicyForm] = useState(false);
  const units = useQuery({
    queryKey: ['asset-lifecycle-units', asset.id, page],
    queryFn: ({ signal }) => api.units(asset.id, page, signal),
  });
  const summary = useQuery({
    queryKey: ['asset-lifecycle-summary', asset.id],
    queryFn: ({ signal }) => api.summary(asset.id, signal),
  });
  const policies = useQuery({
    queryKey: ['asset-lifecycle-policies', asset.locationId],
    queryFn: ({ signal }) => api.policies(asset.locationId, 1, signal),
  });
  const publish = useMutation({
    mutationFn: (item: SetupDocument<LifecyclePolicy>) => api.publishPolicy(item.id, item.version),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['asset-lifecycle-policies'] });
    },
  });
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Thiết bị và vòng đời</Typography>
      {summary.data && (
        <Typography>
          Số lượng nhóm {summary.data.quantity} · Thiết bị hiện có {summary.data.activeUnits} ·
          Không được sử dụng {summary.data.failedUnits} · Đã ngừng sử dụng{' '}
          {summary.data.retiredUnits}
        </Typography>
      )}
      {summary.data?.configurationStatus === 'NeedsConfiguration' && (
        <Alert severity="info">Cần bổ sung thông tin từng thiết bị và đối soát số lượng.</Alert>
      )}
      {(units.isError || summary.isError || policies.isError || publish.isError) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void units.refetch();
                void summary.refetch();
                void policies.refetch();
              }}
            >
              Tải lại
            </Button>
          }
        >
          {lifecycleError(units.error ?? summary.error ?? policies.error ?? publish.error)}
        </Alert>
      )}
      {units.isPending && <Typography role="status">Đang tải thiết bị…</Typography>}
      <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>
        Ghi nhận thiết bị
      </Button>
      {units.data?.items.length === 0 && <Typography>Chưa ghi nhận chi tiết thiết bị.</Typography>}
      {!!units.data?.items.length && (
        <Table size="small" aria-label="Thiết bị thuộc nhóm">
          <TableHead>
            <TableRow>
              <TableCell>Thiết bị / vị trí</TableCell>
              <TableCell>Serial</TableCell>
              <TableCell>Tình trạng</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {units.data.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {item.data.details.label}
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {item.data.details.position}
                  </Typography>
                </TableCell>
                <TableCell>{item.data.details.serialNumber || 'Chưa xác định'}</TableCell>
                <TableCell>
                  {item.status === 'InService'
                    ? 'Đang sử dụng'
                    : item.status === 'Unsafe'
                      ? 'Không được sử dụng'
                      : 'Đã ngừng sử dụng'}
                </TableCell>
                <TableCell>
                  {item.status !== 'Retired' && (
                    <Button onClick={() => setEditing(item)}>Cập nhật</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {units.data && units.data.totalCount > 20 && (
        <Pagination
          count={Math.ceil(units.data.totalCount / 20)}
          page={page}
          onChange={(_, value) => setPage(value)}
        />
      )}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1">Chính sách vòng đời</Typography>
        <Button onClick={() => setPolicyForm(true)}>Thêm phiên bản</Button>
      </Stack>
      {policies.data?.items
        .filter((item) => item.data.category === asset.category)
        .map((item) => (
          <Stack
            key={item.id}
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
          >
            <Stack>
              <Typography>
                {item.data.name} · {item.status === 'Published' ? 'Đã công bố' : 'Bản nháp'}
              </Typography>
              <Typography variant="caption">
                Hiệu lực {displayContractDate(item.data.effectiveFrom)} ·{' '}
                {item.data.sourceReference}
              </Typography>
            </Stack>
            {item.status === 'Draft' && (
              <Button disabled={publish.isPending} onClick={() => publish.mutate(item)}>
                Công bố
              </Button>
            )}
          </Stack>
        ))}
      {editing && (
        <EquipmentForm
          asset={asset}
          record={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void cache.invalidateQueries({ queryKey: ['asset-lifecycle-units', asset.id] });
            void cache.invalidateQueries({ queryKey: ['asset-lifecycle-summary', asset.id] });
          }}
        />
      )}
      {policyForm && (
        <LifecyclePolicyForm
          asset={asset}
          onClose={() => setPolicyForm(false)}
          onSaved={() => {
            setPolicyForm(false);
            void cache.invalidateQueries({ queryKey: ['asset-lifecycle-policies'] });
          }}
        />
      )}
    </Stack>
  );
}

function EquipmentForm({
  asset,
  record,
  onClose,
  onSaved,
}: {
  asset: PhysicalAsset;
  record?: SetupDocument<EquipmentUnit>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [status, setStatus] = useState<EquipmentDetails['status']>(
    record?.data.details.status ?? 'InService',
  );
  const mutation = useMutation({
    mutationFn: (value: EquipmentDetails) =>
      assetLifecycleClient(request).saveUnit(asset.id, id, value),
    onSuccess: onSaved,
  });
  const details = record?.data.details;
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const text = (key: string) => String(values.get(key) ?? '').trim() || null;
          mutation.mutate({
            label: text('label')!,
            position: text('position')!,
            serialNumber: text('serialNumber'),
            manufacturer: text('manufacturer'),
            model: text('model'),
            manufacturedOn: text('manufacturedOn'),
            commissionedOn: text('commissionedOn'),
            status,
            retiredOn: status === 'Retired' ? text('retiredOn') : null,
            retirementReason: status === 'Retired' ? text('retirementReason') : null,
            replacesUnitId: details?.replacesUnitId ?? null,
            expectedVersion: record?.version ?? 0,
          });
        }}
      >
        <DialogTitle>{record ? 'Cập nhật thiết bị' : 'Ghi nhận thiết bị'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {mutation.isError && <Alert severity="error">{lifecycleError(mutation.error)}</Alert>}
            <TextField required label="Nhãn nhận diện" name="label" defaultValue={details?.label} />
            <TextField
              required
              label="Vị trí cụ thể"
              name="position"
              defaultValue={details?.position ?? asset.commonArea ?? ''}
            />
            <TextField
              label="Serial nếu có"
              name="serialNumber"
              defaultValue={details?.serialNumber ?? ''}
            />
            <TextField
              label="Nhà sản xuất"
              name="manufacturer"
              defaultValue={details?.manufacturer ?? ''}
            />
            <TextField label="Model" name="model" defaultValue={details?.model ?? ''} />
            <TextField
              type="date"
              label="Ngày sản xuất"
              name="manufacturedOn"
              defaultValue={details?.manufacturedOn ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="Ngày đưa vào sử dụng"
              name="commissionedOn"
              defaultValue={details?.commissionedOn ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Tình trạng"
              value={status}
              onChange={(event) => setStatus(event.target.value as EquipmentDetails['status'])}
            >
              <MenuItem value="InService">Đang sử dụng</MenuItem>
              <MenuItem value="Unsafe">Không được sử dụng</MenuItem>
              <MenuItem value="Retired">Ngừng sử dụng</MenuItem>
            </TextField>
            {status === 'Retired' && (
              <>
                <TextField
                  required
                  type="date"
                  label="Ngày ngừng sử dụng"
                  name="retiredOn"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField required label="Lý do ngừng sử dụng" name="retirementReason" />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Lưu thiết bị
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function LifecyclePolicyForm({
  asset,
  onClose,
  onSaved,
}: {
  asset: PhysicalAsset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const [id] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (value: LifecyclePolicy) =>
      assetLifecycleClient(request).savePolicy(asset.locationId, id, value),
    onSuccess: onSaved,
  });
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const text = (key: string) => String(values.get(key) ?? '').trim();
          mutation.mutate({
            name: text('name'),
            category: asset.category,
            individualTracking: values.has('individualTracking'),
            inspectionIntervalDays: text('inspection') ? Number(text('inspection')) : null,
            maintenanceIntervalDays: text('maintenance') ? Number(text('maintenance')) : null,
            certificationRequired: values.has('certification'),
            evidenceRequired: values.has('evidence'),
            checklist: text('checklist')
              .split('\n')
              .filter(Boolean)
              .map((label, index) => ({
                code: String(index + 1),
                label,
                notApplicableReasonRequired: true,
              })),
            basisType: text('basisType') as LifecyclePolicy['basisType'],
            sourceReference: text('source'),
            technicalStandard: text('standard') || null,
            manufacturerInstructions: text('instructions') || null,
            effectiveFrom: text('effectiveFrom'),
          });
        }}
      >
        <DialogTitle>Phiên bản chính sách vòng đời</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {mutation.isError && <Alert severity="error">{lifecycleError(mutation.error)}</Alert>}
            <TextField required label="Tên chính sách" name="name" />
            <TextField
              type="number"
              label="Chu kỳ kiểm tra (ngày)"
              name="inspection"
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <TextField
              type="number"
              label="Chu kỳ bảo dưỡng (ngày)"
              name="maintenance"
              slotProps={{ htmlInput: { min: 1 } }}
            />
            <FormControlLabel
              control={<Checkbox name="individualTracking" defaultChecked />}
              label="Theo dõi từng thiết bị"
            />
            <FormControlLabel control={<Checkbox name="evidence" />} label="Yêu cầu bằng chứng" />
            <FormControlLabel
              control={<Checkbox name="certification" />}
              label="Yêu cầu kiểm định"
            />
            <TextField
              required
              multiline
              minRows={3}
              label="Checklist, mỗi dòng một hạng mục"
              name="checklist"
            />
            <TextField select label="Loại căn cứ" name="basisType" defaultValue="OwnerPolicy">
              <MenuItem value="OwnerPolicy">Chính sách vận hành Owner</MenuItem>
              <MenuItem value="Legal">Quy định pháp lý đã xác minh</MenuItem>
              <MenuItem value="TechnicalStandard">Tiêu chuẩn kỹ thuật</MenuItem>
              <MenuItem value="Manufacturer">Hướng dẫn nhà sản xuất</MenuItem>
            </TextField>
            <TextField required label="Căn cứ áp dụng / tài liệu nguồn" name="source" />
            <TextField label="Tiêu chuẩn kỹ thuật" name="standard" />
            <TextField multiline label="Hướng dẫn nhà sản xuất" name="instructions" />
            <TextField
              required
              type="date"
              label="Ngày hiệu lực"
              name="effectiveFrom"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Lưu bản nháp
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
