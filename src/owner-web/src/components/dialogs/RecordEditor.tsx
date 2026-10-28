import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { makeRecord } from '../../services/mock/seed';
import { usePortalAction } from '../../hooks/usePortalData';
import { usePortal } from '../../app/PortalProvider';
import type { DemoDatabase, FeatureDefinition, PortalRecord } from '../../types/portal';

const schema = z.object({
  name: z.string().trim().min(2, 'Nhập ít nhất 2 ký tự.').max(200),
  code: z.string().trim().min(1, 'Mã hồ sơ là bắt buộc.').max(64),
  amount: z.number().int('Số tiền phải là số nguyên VND.').min(0).max(Number.MAX_SAFE_INTEGER),
  description: z.string().max(2000),
  date: z.string().min(1),
  endDate: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;
export function RecordEditor({
  definition,
  database,
  record,
  onClose,
}: {
  definition: FeatureDefinition;
  database: DemoDatabase;
  record: PortalRecord | null;
  onClose: () => void;
}) {
  const { repository } = usePortal();
  const action = usePortalAction();
  const [draft, setDraft] = useState(() => structuredClone(record || makeRecord(definition.kind)));
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: draft.name,
      code: draft.code,
      amount: draft.amount,
      description: draft.description,
      date: draft.date,
      endDate: draft.endDate,
    },
  });
  const immutableInvoice = definition.kind === 'invoices' && !!record && record.status !== 'Nháp';
  const set = (key: keyof PortalRecord, value: string | boolean) =>
    setDraft((old) => ({ ...old, [key]: value }));
  function submit(values: FormValues) {
    action.mutate(() => repository.save(definition.kind, { ...draft, ...values }), {
      onSuccess: onClose,
    });
  }
  const rooms = database.records.rooms.filter(
    (room) => !draft.locationId || room.locationId === draft.locationId,
  );
  const tenants = database.records.tenants.filter(
    (tenant) => !draft.roomId || tenant.roomId === draft.roomId,
  );
  const extraFields = Array.from(
    new Set([
      ...definition.columns.map((column) => column.field),
      ...(definition.kind === 'rooms' ? ['floor', 'capacity'] : []),
      ...(definition.kind === 'public-content'
        ? ['address', 'manager', 'amenities', 'imageUrl']
        : []),
      ...(['schedules'].includes(definition.kind)
        ? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        : []),
    ]),
  ).filter(
    (field) =>
      ![
        'name',
        'code',
        'amount',
        'status',
        'location',
        'room',
        'tenant',
        'date',
        'period',
        'contract',
        'signature',
        'staff',
        'debt',
        'occupancy',
        'category',
      ].includes(field),
  );
  return (
    <Dialog open onClose={action.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <Box component="form" onSubmit={form.handleSubmit(submit)}>
        <DialogTitle>
          {record ? 'Chỉnh sửa' : 'Tạo mới'} • {definition.title}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Chỉ lưu dữ liệu mô phỏng trên trình duyệt. Không tạo giao dịch, chữ ký hay hồ sơ bên
              ngoài.
            </Alert>
            {immutableInvoice && (
              <Alert severity="warning">
                Hóa đơn đã phát hành bất biến. Yêu cầu điều chỉnh trong khung chi tiết.
              </Alert>
            )}
            <TextField
              label="Mã hồ sơ"
              {...form.register('code')}
              error={!!form.formState.errors.code}
              helperText={form.formState.errors.code?.message}
            />
            <TextField
              autoFocus
              label="Tên / Nội dung"
              {...form.register('name')}
              error={!!form.formState.errors.name}
              helperText={form.formState.errors.name?.message}
            />
            <TextField
              select
              label="Cơ sở"
              value={draft.locationId}
              onChange={(e) =>
                setDraft({ ...draft, locationId: e.target.value, roomId: '', tenantId: '' })
              }
            >
              <MenuItem value="">Toàn chuỗi / Chưa gán</MenuItem>
              {database.records.locations.map((row) => (
                <MenuItem key={row.id} value={row.id}>
                  {row.name}
                </MenuItem>
              ))}
            </TextField>
            {!['locations', 'rooms', 'room-types', 'staff', 'schedules', 'public-content'].includes(
              definition.kind,
            ) && (
              <TextField
                select
                label="Phòng"
                value={draft.roomId}
                onChange={(e) => {
                  const room = database.records.rooms.find((row) => row.id === e.target.value);
                  setDraft({
                    ...draft,
                    roomId: e.target.value,
                    locationId: room?.locationId || draft.locationId,
                    tenantId: '',
                  });
                }}
              >
                <MenuItem value="">Khu vực chung / Chưa gán</MenuItem>
                {rooms.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.code} •{' '}
                    {
                      database.records.locations.find((location) => location.id === row.locationId)
                        ?.code
                    }
                  </MenuItem>
                ))}
              </TextField>
            )}
            {['contracts', 'handovers', 'invoices', 'temporary-residence', 'meters'].includes(
              definition.kind,
            ) && (
              <TextField
                select
                label="Khách thuê"
                value={draft.tenantId}
                onChange={(e) => {
                  const tenant = database.records.tenants.find((row) => row.id === e.target.value);
                  setDraft({
                    ...draft,
                    tenantId: e.target.value,
                    contractId: tenant?.contractId || '',
                  });
                }}
              >
                <MenuItem value="">Chưa gán</MenuItem>
                {tenants.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              label={
                definition.kind === 'incidents'
                  ? 'Mức độ (Khẩn cấp / Thông thường)'
                  : 'Loại / Danh mục'
              }
              value={draft.category}
              onChange={(e) => set('category', e.target.value)}
            />
            {definition.kind === 'rooms' && (
              <TextField
                select
                label="Loại phòng"
                value={draft.category}
                onChange={(e) => set('category', e.target.value)}
              >
                {database.records['room-types'].map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              label="Số tiền (VND)"
              type="number"
              {...form.register('amount', { valueAsNumber: true })}
              error={!!form.formState.errors.amount}
              helperText={form.formState.errors.amount?.message}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                label="Ngày bắt đầu / Ngày ghi nhận"
                type="date"
                {...form.register('date')}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                fullWidth
                label="Ngày kết thúc"
                type="date"
                {...form.register('endDate')}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            {['locations', 'staff', 'tasks', 'maintenance', 'schedules'].includes(
              definition.kind,
            ) && (
              <TextField
                select
                label="Nhân viên phụ trách"
                value={draft.staffId}
                onChange={(e) => set('staffId', e.target.value)}
              >
                <MenuItem value="">Chưa phân công</MenuItem>
                {database.records.staff
                  .filter((row) => !draft.locationId || row.locationId === draft.locationId)
                  .map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.name}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {definition.kind === 'maintenance' && (
              <>
                <TextField
                  select
                  label="Sự cố liên quan"
                  value={draft.incidentId}
                  onChange={(e) => set('incidentId', e.target.value)}
                >
                  <MenuItem value="">Bảo trì định kỳ</MenuItem>
                  {database.records.incidents.map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.code} • {row.name.slice(0, 50)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Tài sản liên quan"
                  value={draft.assetId}
                  onChange={(e) => set('assetId', e.target.value)}
                >
                  <MenuItem value="">Chưa gán tài sản</MenuItem>
                  {database.records.assets.map((row) => (
                    <MenuItem key={row.id} value={row.id}>
                      {row.code} • {row.name.slice(0, 40)}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
            {definition.kind === 'contracts' && (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.signed}
                      onChange={(e) => set('signed', e.target.checked)}
                    />
                  }
                  label="Đã ghi nhận xác nhận hai bên (demo)"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.depositConfirmed}
                      onChange={(e) => set('depositConfirmed', e.target.checked)}
                    />
                  }
                  label="Đã xác nhận cọc (demo)"
                />
              </>
            )}
            {definition.kind === 'meters' && (
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Chỉ số cũ"
                  type="number"
                  value={draft.previous}
                  onChange={(e) => setDraft({ ...draft, previous: Number(e.target.value) })}
                />
                <TextField
                  label="Chỉ số mới"
                  type="number"
                  value={draft.current}
                  onChange={(e) => setDraft({ ...draft, current: Number(e.target.value) })}
                />
              </Stack>
            )}
            {extraFields.map((field) => (
              <TextField
                key={field}
                label={definition.columns.find((column) => column.field === field)?.label || field}
                value={draft.attributes[field] || ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    attributes: { ...draft.attributes, [field]: e.target.value },
                  })
                }
              />
            ))}
            <TextField
              multiline
              minRows={3}
              label="Mô tả / Ghi chú"
              {...form.register('description')}
              error={!!form.formState.errors.description}
            />
            {action.isError && <Alert severity="error">{action.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={action.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" variant="contained" disabled={action.isPending || immutableInvoice}>
            {action.isPending ? 'Đang lưu...' : 'Lưu dữ liệu demo'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
