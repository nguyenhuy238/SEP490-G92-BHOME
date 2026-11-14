import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  locationSetupClient,
  type RoomConfigurationView,
  type RoomConfigurationWrite,
  type LocalRoomDefaultsData,
} from '../../../../../packages/client-core/src/locationSetup';
import type {
  LocalAssetItem,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import {
  formatBillingDecimal,
  invoiceError,
} from '../../../../../packages/client-core/src/invoices';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { MoneyField } from '../../components/common/MoneyField';
import { ConflictReload } from '../locations/components/ConflictReload';
import { todayVietnam } from '../staff/staffContracts';
import { usePropertySetupApi } from './usePropertySetupApi';
import { AssetRequirementFields } from './AssetRequirementFields';

function tomorrow(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function RoomConfigurationEditor({
  locationId,
  roomId,
  close,
  saved,
}: {
  locationId: string;
  roomId: string;
  close: () => void;
  saved: () => void;
}) {
  const api = locationSetupClient(usePropertySetupApi().request);
  const { session } = useAuth();
  const cache = useQueryClient();
  const [revision, setRevision] = useState(0);
  const key = ['property-setup', 'room-configuration', session?.userId, locationId, roomId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.roomConfiguration(locationId, roomId, signal),
  });
  const defaults = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, locationId],
    queryFn: ({ signal }) => api.localRoomDefaults(locationId, signal),
  });
  return (
    <Dialog open fullWidth maxWidth="md" aria-labelledby="room-edit-title">
      <DialogTitle id="room-edit-title">
        Chỉnh sửa phòng {query.data?.room.roomNumber ?? ''}
      </DialogTitle>
      {query.isPending || query.error ? (
        <>
          <DialogContent>
            {query.error ? (
              <ErrorState error={query.error} retry={() => void query.refetch()} />
            ) : (
              <LoadingState />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Đóng</Button>
          </DialogActions>
        </>
      ) : (
        <RoomConfigurationForm
          key={revision}
          view={query.data}
          defaults={defaults.data ?? []}
          defaultsError={defaults.error}
          retryDefaults={() => void defaults.refetch()}
          close={close}
          save={async (input) => {
            await api.saveRoomConfiguration(locationId, roomId, input);
            await cache.invalidateQueries({ queryKey: ['property-setup'] });
            saved();
          }}
          reload={async () => {
            const latest = await query.refetch({ throwOnError: true });
            if (latest.data) setRevision((old) => old + 1);
          }}
        />
      )}
    </Dialog>
  );
}

function RoomConfigurationForm({
  view,
  defaults,
  defaultsError,
  retryDefaults,
  close,
  save,
  reload,
}: {
  view: RoomConfigurationView;
  defaults: SetupDocument<LocalRoomDefaultsData>[];
  defaultsError: unknown;
  retryDefaults: () => void;
  close: () => void;
  save: (input: RoomConfigurationWrite) => Promise<void>;
  reload: () => Promise<void>;
}) {
  // The loaded snapshot and versions remain stable while the Owner edits, even if
  // a background refetch brings newer data. Reload is an explicit discard action.
  const [initial] = useState(view);
  const room = initial.room;
  const source = initial.provenance?.data;
  const [number, setNumber] = useState(room.roomNumber);
  const [floor, setFloor] = useState(room.floor ?? '');
  const [capacity, setCapacity] = useState(String(room.capacity));
  const [status, setStatus] = useState(String(room.status));
  const [type, setType] = useState(source?.roomDefaultsId ?? '');
  const [typeVersion, setTypeVersion] = useState<number | undefined>();
  const [area, setArea] = useState(source?.area != null ? String(source.area) : '');
  const [amenities, setAmenities] = useState(source?.amenities.join('\n') ?? '');
  const [reason, setReason] = useState('');
  const rent = initial.scheduledRent ?? initial.rent;
  const currentRent =
    initial.rent && initial.rent.id !== initial.scheduledRent?.id ? initial.rent : null;
  const [rate, setRate] = useState(rent ? String(rent.rate) : '');
  const today = todayVietnam();
  const usedRoomRent =
    rent?.roomId === room.id && (rent.effectiveFrom <= today || !!rent.firstUsedAt);
  const effectiveMin =
    rent?.roomId === room.id
      ? tomorrow(usedRoomRent && rent.effectiveFrom > today ? rent.effectiveFrom : today)
      : today;
  const initialEffective =
    rent?.effectiveFrom && rent.effectiveFrom >= effectiveMin ? rent.effectiveFrom : effectiveMin;
  const [effectiveFrom, setEffectiveFrom] = useState(initialEffective);
  const current = initial.inventory.desired.find(
    (item) => item.id === initial.inventory.currentDesiredId,
  );
  const originalItems = current?.data.items ?? [];
  const [items, setItems] = useState<LocalAssetItem[]>(originalItems);
  const assetsChanged = JSON.stringify(items) !== JSON.stringify(originalItems);
  const rentChanged =
    rate !== (rent ? String(rent.rate) : '') || effectiveFrom !== initialEffective;
  const typeChanged = type !== (source?.roomDefaultsId ?? '');
  const chosenType = defaults.find((item) => item.id === type);
  const staleType =
    typeChanged &&
    (!chosenType || chosenType.status !== 'Recorded' || chosenType.version !== typeVersion);
  const locked = !initial.canEdit || !view.canEdit;
  const submitting = useRef(false);
  const mutation = useMutation({ mutationFn: save });
  const busy = mutation.isPending;
  const disabled = locked || busy;
  const validRent = !rentChanged || (/^\d+(?:\.\d+)?$/.test(rate) && effectiveFrom >= effectiveMin);
  const validItems =
    !assetsChanged ||
    items.every(
      (item) =>
        item.name.trim() &&
        item.category.trim() &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 10000,
    );
  const valid =
    !staleType &&
    !!number.trim() &&
    Number.isInteger(Number(capacity)) &&
    Number(capacity) > 0 &&
    !!reason.trim() &&
    validRent &&
    validItems &&
    (!area || Number(area) > 0);
  return (
    <Box
      component="form"
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !valid || submitting.current) return;
        const input: RoomConfigurationWrite = {
          roomNumber: number.trim(),
          floor: floor.trim() || null,
          capacity: Number(capacity),
          status: Number(status),
          expectedVersion: room.version,
          expectedProvenanceVersion: initial.provenance?.version ?? 0,
          ...(typeChanged ? { roomDefaultsId: type, expectedDefaultsVersion: typeVersion } : {}),
          ...(area ? { area: Number(area) } : {}),
          ...(source || typeChanged || amenities.trim()
            ? {
                amenities: amenities
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(rentChanged
            ? {
                rent: {
                  rate,
                  effectiveFrom,
                  ...(rent
                    ? { expectedPolicyId: rent.id, expectedPolicyVersion: rent.version }
                    : {}),
                },
              }
            : {}),
          ...(assetsChanged
            ? { assets: { items, expectedAssignmentVersion: initial.inventory.assignmentVersion } }
            : {}),
          reason: reason.trim(),
        };
        submitting.current = true;
        void mutation
          .mutateAsync(input)
          .catch(() => {})
          .finally(() => {
            submitting.current = false;
          });
      }}
    >
      <DialogContent>
        <Stack spacing={2}>
          {locked && (
            <Alert severity="info">
              {view.lockReason === 'location_inactive'
                ? 'Cơ sở đã ngừng hoạt động. Không thể chỉnh sửa cấu hình phòng.'
                : view.lockReason === 'room_has_obligations'
                  ? 'Phòng còn nghĩa vụ chưa hoàn tất. Cấu hình được giữ nguyên.'
                  : 'Phòng đang có hợp đồng chưa kết thúc. Giá thuê, cấu hình và định mức được giữ nguyên.'}
            </Alert>
          )}
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
            Thông tin phòng
          </Typography>
          <Box
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}
          >
            <TextField
              label="Số phòng"
              required
              disabled={disabled}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
            <TextField
              label="Tầng"
              disabled={disabled}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            />
            <TextField
              label="Sức chứa (người)"
              type="number"
              required
              disabled={disabled}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
            />
            <TextField
              select
              label="Trạng thái"
              disabled={disabled}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <MenuItem value="0">Trống khai thác</MenuItem>
              <MenuItem value="1" disabled>
                Đang giữ chỗ
              </MenuItem>
              <MenuItem value="2" disabled>
                Đang có khách thuê
              </MenuItem>
              <MenuItem value="3">Ngừng khai thác</MenuItem>
            </TextField>
            <TextField
              select
              label="Loại phòng"
              disabled={disabled || !!defaultsError || !defaults.length}
              value={type}
              onChange={(e) => {
                const choice = defaults.find((item) => item.id === e.target.value);
                if (!choice) return;
                setType(choice.id);
                setTypeVersion(choice.version);
                setArea(String(choice.data.defaults.area));
                setAmenities(choice.data.defaults.amenities.join('\n'));
                setCapacity(String(choice.data.defaults.capacity));
              }}
            >
              <MenuItem value="" disabled>
                Chưa có loại phòng
              </MenuItem>
              {type && !defaults.some((item) => item.id === type && item.status === 'Recorded') && (
                <MenuItem value={type} disabled>
                  {source?.name ?? 'Loại phòng đã lưu'}
                </MenuItem>
              )}
              {defaults
                .filter((item) => item.status === 'Recorded')
                .map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.data.name}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label="Diện tích (m²)"
              type="number"
              disabled={disabled}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              helperText={source?.area != null ? 'Để trống: giữ diện tích đã lưu' : undefined}
              slotProps={{ htmlInput: { min: 0.01, step: 'any' } }}
            />
            <TextField
              multiline
              minRows={2}
              label="Tiện nghi"
              helperText="Mỗi dòng một tiện nghi"
              disabled={disabled}
              value={amenities}
              onChange={(e) => setAmenities(e.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />
          </Box>
          {typeChanged && (
            <Typography variant="caption" color="text.secondary">
              Định mức trang bị vẫn giữ nguyên nếu không chỉnh sửa phần tài sản.
            </Typography>
          )}
          {!!defaultsError && (
            <Alert severity="warning" action={<Button onClick={retryDefaults}>Thử lại</Button>}>
              Chưa tải được danh sách loại phòng.
            </Alert>
          )}
          {staleType && (
            <Alert severity="warning">
              Loại phòng đã thay đổi. Chọn lại loại phòng để kiểm tra cấu hình mới.
            </Alert>
          )}
          <Divider />
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
            Giá thuê
          </Typography>
          {initial.scheduledRent && currentRent && (
            <Typography variant="body2" color="text.secondary">
              Giá đang hiệu lực: {formatBillingDecimal(currentRent.rate)} đ/tháng. Đang chỉnh sửa
              mức giá đã lên lịch.
            </Typography>
          )}
          <Box
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}
          >
            <MoneyField
              allowDecimal
              label="Giá thuê (VND/tháng)"
              disabled={disabled}
              value={rate}
              onValueChange={setRate}
            />
            <TextField
              type="date"
              label="Ngày hiệu lực giá mới"
              disabled={disabled}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: effectiveMin } }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Giá mới chỉ áp dụng theo ngày hiệu lực cho hợp đồng tương lai.{' '}
            {usedRoomRent
              ? 'Giá phòng hiện hành hoặc đã được sử dụng chỉ được thay thế từ ngày hiệu lực mới.'
              : rent?.roomId === null
                ? 'Phòng hiện dùng giá của cơ sở; thay đổi sẽ tạo giá riêng.'
                : initial.scheduledRent
                  ? 'Mức giá đã lên lịch chỉ được chỉnh sửa trước ngày hiệu lực.'
                  : ''}
          </Typography>
          <Divider />
          <Stack spacing={0.5}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
              Định mức trang bị của phòng
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Thay đổi chỉ áp dụng cho phòng này. Tài sản vật lý đã ghi nhận (
              {initial.inventory.physical.length} bản ghi) được giữ nguyên để kiểm kê.
            </Typography>
          </Stack>
          <AssetRequirementFields items={items} onChange={setItems} disabled={disabled} />
          {initial.inventory.physical.length > 0 && (
            <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: '10px' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Tài sản thực tế
              </Typography>
              {initial.inventory.physical.map((asset) => (
                <Typography key={asset.id} variant="body2" color="text.secondary">
                  {asset.name} · {asset.code || 'Chưa có mã'} · {asset.condition}
                </Typography>
              ))}
            </Box>
          )}
          <TextField
            label="Lý do thay đổi"
            required
            disabled={disabled}
            multiline
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {mutation.error && <Alert severity="error">{invoiceError(mutation.error)}</Alert>}
          <ConflictReload error={mutation.error} reload={reload} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          {locked ? 'Đóng' : 'Hủy'}
        </Button>
        {!locked && (
          <Button variant="contained" type="submit" disabled={disabled || !valid}>
            Lưu cấu hình
          </Button>
        )}
      </DialogActions>
    </Box>
  );
}
