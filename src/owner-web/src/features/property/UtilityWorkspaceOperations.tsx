import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { mutationKeys } from '../../../../../packages/client-core/src/contracts';
import type {
  Reconciliation,
  SetupDocument,
  UtilityBill,
  UtilityMeter,
  UtilityTariffInput,
} from '../../../../../packages/client-core/src/propertySetup';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';
import { SetupEvidenceField } from './SetupEvidenceField';
import { SetupActionFeedback, UtilityField } from './UtilityFormTools';
import {
  periodStart,
  setupDecimal,
  utilityTypes,
  usePrivateSetupEvidence,
  type UtilityValues,
} from './utilityFormValues';

export function UtilitySourcesPanel({ locationId }: { locationId: string }) {
  const [operation, setOperation] = useState('');
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['property-setup'] });
  };
  const meters = useQuery({
    queryKey: ['property-setup', 'source-meters', session?.userId, locationId],
    queryFn: ({ signal }) => api.utilityMeters(locationId, signal),
  });
  const nativeMeters = useQuery({
    queryKey: ['property-setup', 'native-meters', session?.userId, locationId],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string; parentId?: string | null }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(locationId)}/meters`,
        { signal },
      ),
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'meter-rooms', session?.userId, locationId],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(locationId)}/rooms`,
        { signal },
      ),
  });
  const readings = useQuery({
    queryKey: ['property-setup', 'source-readings', session?.userId, locationId],
    queryFn: ({ signal }) => api.sourceReadings(locationId, signal),
  });
  const links = useQuery({
    queryKey: ['property-setup', 'meter-links', session?.userId, locationId],
    queryFn: ({ signal }) => api.meterLinks(locationId, signal),
  });
  const sourceById = new Map((meters.data ?? []).map((meter) => [meter.id, meter]));
  const roomMeters = nativeMeters.data ?? [];
  if (meters.isPending) return <LoadingState />;
  if (meters.error) return <ErrorState error={meters.error} retry={() => void meters.refetch()} />;
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Công tơ tổng và khu chung</Typography>
      {!meters.data.length && (
        <Alert severity="info">
          Chưa có công tơ nguồn. Thêm công tơ tổng trước khi liên kết đồng hồ phòng hoặc ghi chỉ số.
        </Alert>
      )}
      {meters.data.map((meter) => (
        <Paper key={meter.id} variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>{meter.data.code}</Typography>
          <Typography variant="body2" color="text.secondary">
            {meter.data.utilityType === 0 ? 'Điện' : 'Nước'} ·{' '}
            {meter.data.scope === 'Source' ? 'Công tơ tổng' : 'Khu chung'}
          </Typography>
        </Paper>
      ))}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" onClick={() => setOperation('room-meter')}>
          Thêm đồng hồ cho phòng
        </Button>
        <Button variant="contained" onClick={() => setOperation('meter')}>
          Thêm công tơ nguồn
        </Button>
        <Button
          variant="outlined"
          disabled={
            !meters.data.some((meter) => meter.data.scope === 'Source') ||
            nativeMeters.isPending ||
            !!nativeMeters.error ||
            !nativeMeters.data?.length
          }
          onClick={() => setOperation('link')}
        >
          Liên kết đồng hồ phòng
        </Button>
        <Button
          variant="outlined"
          disabled={!meters.data.length}
          onClick={() => setOperation('reading')}
        >
          Ghi chỉ số nguồn
        </Button>
      </Stack>
      {!meters.data.some((meter) => meter.data.scope === 'Source') && (
        <Alert severity="info">
          Để liên kết đồng hồ phòng với công tơ tổng, hãy thêm công tơ nguồn trước. Bạn vẫn có thể
          tạo đồng hồ cho từng phòng ngay bây giờ.
        </Alert>
      )}
      {!nativeMeters.isPending && !nativeMeters.error && !nativeMeters.data?.length && (
        <Alert severity="info">
          Cơ sở chưa có đồng hồ phòng. Chọn “Thêm đồng hồ cho phòng”, sau đó liên kết với công tơ
          tổng nếu cần đối soát.
        </Alert>
      )}
      {nativeMeters.error && (
        <ErrorState error={nativeMeters.error} retry={() => void nativeMeters.refetch()} />
      )}
      <Stack spacing={1} aria-label="Danh sách đồng hồ phòng">
        <Typography variant="h6">
          Đồng hồ từng phòng ({nativeMeters.isPending ? '…' : roomMeters.length})
        </Typography>
        {nativeMeters.isPending && <LoadingState />}
        {!nativeMeters.isPending && !nativeMeters.error && roomMeters.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Chưa có đồng hồ nào được tạo cho phòng trong cơ sở này.
          </Typography>
        )}
        {roomMeters.map((meter) => {
          const room = rooms.data?.find((item) => item.id === meter.parentId);
          const link = links.data?.find((item) => item.data.meterId === meter.id);
          const source = link ? sourceById.get(link.data.parentMeterId) : undefined;
          return (
            <Paper key={meter.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={0.5}
                sx={{ justifyContent: 'space-between' }}
              >
                <Stack spacing={0.25}>
                  <Typography sx={{ fontWeight: 700 }}>{meter.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Phòng: {room?.label ?? 'Chưa xác định'}
                  </Typography>
                </Stack>
                <Typography variant="body2" color={link ? 'success.main' : 'text.secondary'}>
                  {link
                    ? `Đã liên kết: ${source?.data.code ?? 'Công tơ tổng'}`
                    : 'Chưa liên kết công tơ tổng'}
                </Typography>
              </Stack>
              {link && (
                <Typography variant="caption" color="text.secondary">
                  Hiệu lực liên kết: {link.data.effectiveFrom} →{' '}
                  {link.data.effectiveTo ?? 'Không hạn'}
                </Typography>
              )}
            </Paper>
          );
        })}
      </Stack>
      <Dialog open={!!operation} fullWidth maxWidth="md">
        <DialogTitle>
          {operation === 'room-meter'
            ? 'Thêm đồng hồ cho phòng'
            : operation === 'meter'
              ? 'Công tơ nguồn / khu chung'
              : operation === 'link'
                ? 'Liên kết đồng hồ phòng'
                : 'Chỉ số nguồn'}
        </DialogTitle>
        <DialogContent>
          {operation === 'room-meter' && (
            <RoomMeterEditor
              rooms={rooms.data ?? []}
              roomsLoading={rooms.isPending}
              roomsError={!!rooms.error}
              onSaved={() => {
                void cache.invalidateQueries({
                  queryKey: ['property-setup', 'native-meters', session?.userId, locationId],
                });
                refresh();
              }}
              onClose={() => setOperation('')}
            />
          )}
          {operation === 'meter' && (
            <SourceMeterEditor
              locationId={locationId}
              meters={meters.data}
              onSaved={refresh}
              onClose={() => setOperation('')}
            />
          )}
          {operation === 'link' && nativeMeters.error ? (
            <Stack spacing={2}>
              <ErrorState error={nativeMeters.error} retry={() => void nativeMeters.refetch()} />
              <Button onClick={() => setOperation('')}>Đóng</Button>
            </Stack>
          ) : operation === 'link' ? (
            <MeterLinkEditor
              meters={meters.data}
              nativeMeters={nativeMeters.data ?? []}
              onSaved={refresh}
              onClose={() => setOperation('')}
            />
          ) : null}
          {operation === 'reading' && (
            <SourceReadingEditor
              locationId={locationId}
              meters={meters.data}
              onClose={() => setOperation('')}
            />
          )}
        </DialogContent>
      </Dialog>
      <Typography variant="h6">Liên kết đồng hồ phòng</Typography>
      {links.isPending && <LoadingState />}
      {links.error && <ErrorState error={links.error} retry={() => void links.refetch()} />}
      {links.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Chưa có đồng hồ phòng được liên kết.
        </Typography>
      )}
      {links.data?.map((link) => (
        <Typography key={link.id}>
          Liên kết{' '}
          {nativeMeters.data?.find((meter) => meter.id === link.data.meterId)?.label ??
            'Đồng hồ phòng'}{' '}
          →{' '}
          {meters.data.find((meter) => meter.id === link.data.parentMeterId)?.data.code ??
            'Công tơ tổng'}{' '}
          · {link.data.effectiveFrom} → {link.data.effectiveTo ?? 'Không hạn'}
        </Typography>
      ))}
      <Typography variant="h6">Chỉ số nguồn đã xác nhận</Typography>
      {readings.isPending && <LoadingState />}
      {readings.error && (
        <ErrorState error={readings.error} retry={() => void readings.refetch()} />
      )}
      {readings.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Chưa có chỉ số nguồn được xác nhận.
        </Typography>
      )}
      {readings.data?.map((reading) => (
        <Typography key={reading.id}>
          {meters.data.find((meter) => meter.id === reading.data.meterId)?.data.code ?? 'Công tơ'} ·{' '}
          {reading.data.period} · {setupDecimal(reading.data.opening)} →{' '}
          {setupDecimal(reading.data.closing)}
        </Typography>
      ))}
    </Stack>
  );
}

function RoomMeterEditor({
  rooms,
  roomsLoading,
  roomsError,
  onSaved,
  onClose,
}: {
  rooms: { id: string; label: string }[];
  roomsLoading: boolean;
  roomsError: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    roomId: '',
    code: '',
    utilityType: '0',
    display: '0',
    decimalPlaces: '0',
    installedOn: '',
  });
  return (
    <Stack
      component="form"
      spacing={2}
      sx={{ pt: 1 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!rooms.some((room) => room.id === values.roomId)) return;
        action.run(async () => {
          await api.request('/api/v1/capture/meters', {
            method: 'POST',
            body: JSON.stringify({
              roomId: values.roomId,
              code: values.code.trim(),
              utilityType: Number(values.utilityType),
              display: Number(values.display),
              decimalPlaces: Number(values.decimalPlaces),
              installedOn: values.installedOn,
            }),
          });
          onSaved();
        }, 'Đã tạo đồng hồ phòng. Có thể tiếp tục liên kết với công tơ tổng.');
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Tạo đồng hồ điện hoặc nước gắn trực tiếp với phòng trong cơ sở này. Không bắt buộc tạo công
        tơ tổng trước.
      </Typography>
      {roomsLoading && <LoadingState />}
      {roomsError && (
        <Alert severity="error">Không tải được danh sách phòng. Đóng rồi mở lại để thử lại.</Alert>
      )}
      {!roomsLoading && !roomsError && rooms.length === 0 && (
        <Alert severity="warning">Cơ sở chưa có phòng để gắn đồng hồ.</Alert>
      )}
      <TextField
        select
        required
        label="Phòng gắn đồng hồ"
        value={values.roomId}
        onChange={(event) => setValues((old) => ({ ...old, roomId: event.target.value }))}
      >
        {rooms.map((room) => (
          <MenuItem key={room.id} value={room.id}>
            {room.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        required
        label="Mã đồng hồ phòng"
        value={values.code}
        slotProps={{ htmlInput: { maxLength: 80 } }}
        onChange={(event) => setValues((old) => ({ ...old, code: event.target.value }))}
      />
      <TextField
        select
        label="Loại đồng hồ"
        value={values.utilityType}
        onChange={(event) => setValues((old) => ({ ...old, utilityType: event.target.value }))}
      >
        <MenuItem value="0">Điện</MenuItem>
        <MenuItem value="1">Nước</MenuItem>
      </TextField>
      <TextField
        select
        label="Kiểu hiển thị"
        value={values.display}
        onChange={(event) => setValues((old) => ({ ...old, display: event.target.value }))}
      >
        <MenuItem value="0">Cơ (đồng hồ kim/số)</MenuItem>
        <MenuItem value="1">Điện tử</MenuItem>
      </TextField>
      <TextField
        type="number"
        required
        label="Số chữ số thập phân"
        value={values.decimalPlaces}
        slotProps={{ htmlInput: { min: 0, max: 4, step: 1 } }}
        onChange={(event) => setValues((old) => ({ ...old, decimalPlaces: event.target.value }))}
      />
      <TextField
        type="date"
        required
        label="Ngày lắp đặt"
        value={values.installedOn}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(event) => setValues((old) => ({ ...old, installedOn: event.target.value }))}
      />
      <SetupActionFeedback {...action} />
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          type="submit"
          disabled={
            action.busy ||
            roomsLoading ||
            roomsError ||
            !rooms.length ||
            !rooms.some((room) => room.id === values.roomId) ||
            !values.code.trim() ||
            !values.installedOn ||
            !Number.isInteger(Number(values.decimalPlaces)) ||
            Number(values.decimalPlaces) < 0 ||
            Number(values.decimalPlaces) > 4
          }
        >
          Lưu đồng hồ phòng
        </Button>
        <Button disabled={action.busy} onClick={onClose}>
          Đóng
        </Button>
      </Stack>
    </Stack>
  );
}

function SourceMeterEditor({
  locationId,
  meters,
  onSaved,
  onClose,
}: {
  locationId: string;
  meters: SetupDocument<UtilityMeter>[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    utilityType: '0',
    scope: 'Source',
    code: '',
    parentMeterId: '',
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.saveUtilityMeter({
              locationId,
              utilityType: Number(values.utilityType),
              scope: values.scope as 'Source' | 'Common',
              code: values.code,
              parentMeterId: values.scope === 'Common' ? values.parentMeterId || null : null,
            });
            onSaved();
          }, 'Máy chủ đã lưu công tơ nguồn.');
        }}
      >
        <Typography variant="h6">Thêm công tơ nguồn / khu chung</Typography>
        {[
          { name: 'code', label: 'Mã công tơ nguồn' },
          { name: 'utilityType', label: 'Loại công tơ nguồn', options: utilityTypes },
          {
            name: 'scope',
            label: 'Phạm vi công tơ',
            options: [
              { id: 'Source', label: 'Công tơ tổng' },
              { id: 'Common', label: 'Công tơ khu chung' },
            ],
          },
          {
            name: 'parentMeterId',
            label: 'Công tơ tổng cấp trên',
            optional: values.scope === 'Source',
            disabled: values.scope === 'Source',
            options: meters
              .filter(
                (meter) =>
                  meter.data.scope === 'Source' &&
                  meter.data.utilityType === Number(values.utilityType),
              )
              .map((meter) => ({ id: meter.id, label: meter.data.code })),
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupActionFeedback {...action} />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" type="submit" disabled={action.busy}>
            Lưu công tơ nguồn
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function MeterLinkEditor({
  meters,
  nativeMeters,
  onSaved,
  onClose,
}: {
  meters: SetupDocument<UtilityMeter>[];
  nativeMeters: { id: string; label: string }[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    meterId: '',
    parentMeterId: '',
    effectiveFrom: '',
    effectiveTo: '',
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.linkMeter({
              meterId: values.meterId,
              parentMeterId: values.parentMeterId,
              scope: 'Room',
              effectiveFrom: values.effectiveFrom,
              effectiveTo: values.effectiveTo || null,
            });
            onSaved();
          }, 'Máy chủ đã lưu liên kết đồng hồ.');
        }}
      >
        <Typography variant="h6">Liên kết đồng hồ phòng với công tơ tổng</Typography>
        {[
          { name: 'meterId', label: 'Đồng hồ phòng để liên kết', options: nativeMeters },
          {
            name: 'parentMeterId',
            label: 'Công tơ tổng nhận liên kết',
            options: meters
              .filter((meter) => meter.data.scope === 'Source')
              .map((meter) => ({
                id: meter.id,
                label: `${meter.data.code} · ${meter.data.utilityType === 0 ? 'Điện' : 'Nước'}`,
              })),
          },
          { name: 'effectiveFrom', label: 'Liên kết hiệu lực từ', type: 'date' as const },
          {
            name: 'effectiveTo',
            label: 'Liên kết hiệu lực đến',
            type: 'date' as const,
            optional: true,
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupActionFeedback {...action} />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" type="submit" disabled={action.busy}>
            Lưu liên kết đồng hồ
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function SourceReadingEditor({
  locationId,
  meters,
  onClose,
}: {
  locationId: string;
  meters: SetupDocument<UtilityMeter>[];
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const evidence = usePrivateSetupEvidence(locationId);
  const [values, setValues] = useState<UtilityValues>({
    meterId: '',
    period: '',
    opening: '',
    closing: '',
    confirmed: 'false',
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(
            async () =>
              api.sourceReading({
                meterId: values.meterId,
                period: periodStart(values.period),
                opening: values.opening,
                closing: values.closing,
                evidenceObjectKey: await evidence.getKey(),
                humanConfirmed: values.confirmed === 'true',
              }),
            'Máy chủ đã ghi nhận chỉ số nguồn đã xác nhận.',
          );
        }}
      >
        <Typography variant="h6">Xác nhận chỉ số công tơ nguồn</Typography>
        {[
          {
            name: 'meterId',
            label: 'Công tơ cần ghi chỉ số',
            options: meters.map((meter) => ({ id: meter.id, label: meter.data.code })),
          },
          { name: 'period', label: 'Tháng ghi chỉ số nguồn', type: 'month' as const },
          { name: 'opening', label: 'Chỉ số nguồn đầu kỳ' },
          { name: 'closing', label: 'Chỉ số nguồn cuối kỳ' },
          {
            name: 'confirmed',
            label: 'Đã kiểm tra và xác nhận chỉ số nguồn',
            type: 'check' as const,
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupEvidenceField value={evidence.file} onChange={evidence.setFile} />
        <SetupActionFeedback {...action} />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            type="submit"
            disabled={action.busy || !evidence.file || values.confirmed !== 'true'}
          >
            Xác nhận chỉ số nguồn
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function UtilityBillsPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState('');
  const bills = useQuery({
    queryKey: ['property-setup', 'source-bills', session?.userId, locationId],
    queryFn: ({ signal }) => api.sourceBills(locationId, signal),
  });
  const meters = useQuery({
    queryKey: ['property-setup', 'source-meters', session?.userId, locationId],
    queryFn: ({ signal }) => api.utilityMeters(locationId, signal),
  });
  const reconciliations = useQuery({
    queryKey: ['property-setup', 'reconciliations', session?.userId, locationId],
    queryFn: ({ signal }) => api.reconciliations(locationId, signal),
  });
  const bill = bills.data?.find((row) => row.id === selected);
  const reconciliation = reconciliations.data?.find((row) => row.data.sourceBillId === selected);
  return (
    <Stack spacing={2}>
      <Button
        variant="contained"
        sx={{ alignSelf: 'flex-start' }}
        disabled={
          meters.isPending ||
          !!meters.error ||
          !meters.data?.some((meter) => meter.data.scope === 'Source')
        }
        onClick={() => setCreate(true)}
      >
        Thêm hóa đơn nhà cung cấp
      </Button>
      {meters.error && <ErrorState error={meters.error} retry={() => void meters.refetch()} />}
      {bills.isPending ? (
        <LoadingState />
      ) : bills.error ? (
        <ErrorState error={bills.error} retry={() => void bills.refetch()} />
      ) : (
        <>
          {!bills.data.length && <Typography>Chưa có hóa đơn nguồn.</Typography>}
          {bills.data.map((row) => (
            <Paper key={row.id} variant="outlined" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700 }}>
                {row.data.reference} · {setupDecimal(row.data.amount)} ₫
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {row.data.utilityType === 0 ? 'Điện' : 'Nước'} · Kỳ{' '}
                {row.data.period.slice(0, 7).split('-').reverse().join('/')} ·{' '}
                {setupDecimal(row.data.consumption)} {row.data.utilityType === 0 ? 'kWh' : 'm³'}
              </Typography>
              <Button onClick={() => setSelected(row.id)}>Đối soát hóa đơn nguồn</Button>
            </Paper>
          ))}
        </>
      )}
      <Dialog open={create} fullWidth maxWidth="md">
        <DialogTitle>Hóa đơn nhà cung cấp</DialogTitle>
        <DialogContent>
          {create && (
            <SourceBillEditor
              locationId={locationId}
              meters={meters.data ?? []}
              onClose={() => setCreate(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      {reconciliations.error && (
        <ErrorState error={reconciliations.error} retry={() => void reconciliations.refetch()} />
      )}
      {bill && reconciliations.isPending && <LoadingState />}
      {bill && !reconciliations.isPending && !reconciliations.error && (
        <ReconciliationEditor
          key={`${bill.id}:${reconciliation?.version ?? 0}`}
          locationId={locationId}
          bill={bill}
          source={reconciliation}
        />
      )}
    </Stack>
  );
}

function SourceBillEditor({
  locationId,
  meters,
  onClose,
}: {
  locationId: string;
  meters: SetupDocument<UtilityMeter>[];
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const evidence = usePrivateSetupEvidence(locationId);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const [values, setValues] = useState<UtilityValues>({
    meterId: '',
    period: '',
    consumption: '',
    amount: '',
    reference: '',
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            const meter = meters.find((row) => row.id === values.meterId);
            if (!meter) throw new Error('A scoped source meter is required.');
            const input: UtilityBill = {
              locationId,
              meterId: values.meterId,
              utilityType: meter.data.utilityType,
              period: periodStart(values.period),
              consumption: values.consumption,
              amount: values.amount,
              reference: values.reference,
              evidenceObjectKey: await evidence.getKey(),
            };
            await api.sourceBill(input, keys.get('source-bill', input));
            keys.confirmed('source-bill', input);
            onClose();
          }, 'Máy chủ đã lưu hóa đơn nhà cung cấp.');
        }}
      >
        <Typography variant="h6">Hóa đơn nhà cung cấp</Typography>
        {[
          {
            name: 'meterId',
            label: 'Công tơ tổng của hóa đơn',
            options: meters
              .filter((meter) => meter.data.scope === 'Source')
              .map((meter) => ({ id: meter.id, label: meter.data.code })),
          },
          { name: 'period', label: 'Tháng hóa đơn nguồn', type: 'month' as const },
          { name: 'consumption', label: 'Sản lượng trên hóa đơn nguồn' },
          { name: 'amount', label: 'Tổng tiền hóa đơn nguồn VND', type: 'money' as const },
          { name: 'reference', label: 'Số tham chiếu hóa đơn nhà cung cấp' },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupEvidenceField value={evidence.file} onChange={evidence.setFile} />
        <SetupActionFeedback {...action} />
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={action.busy || !evidence.file}>
            Lưu hóa đơn nhà cung cấp
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng hóa đơn nguồn
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function ReconciliationEditor({
  locationId,
  bill,
  source,
}: {
  locationId: string;
  bill: SetupDocument<UtilityBill>;
  source?: SetupDocument<Reconciliation>;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    tolerance: String(source?.data.tolerance ?? ''),
    reason: source?.data.reason ?? '',
  });
  const [preview, setPreview] = useState<Reconciliation | null>(null);
  const input = () => ({
    locationId,
    sourceBillId: bill.id,
    tolerance: values.tolerance,
    reason: values.reason,
    expectedVersion: source?.version ?? 0,
  });
  const result = preview ?? source?.data;
  const status = result?.status;
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Đối soát {bill.data.reference}</Typography>
        <Alert severity="info">
          Máy chủ đối chiếu chỉ số xác nhận và hóa đơn nguồn. Chấp thuận chênh lệch không tự thu
          thêm hoặc hoàn tiền Tenant.
        </Alert>
        {['tolerance', 'reason'].map((name) => (
          <UtilityField
            key={name}
            field={{
              name,
              label:
                name === 'tolerance'
                  ? 'Sai lệch cho phép do Owner chọn'
                  : 'Lý do đối soát / quyết định',
              disabled: action.busy,
            }}
            values={values}
            setValues={(next) => {
              setValues(next);
              setPreview(null);
            }}
          />
        ))}
        <Button
          disabled={action.busy || !values.tolerance || !values.reason.trim()}
          onClick={() =>
            action.run(
              async () => setPreview(await api.previewReconciliation(input())),
              'Máy chủ đã tính đối soát; chưa lưu kết quả.',
            )
          }
        >
          Xem trước đối soát
        </Button>
        {result && (
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {preview ? 'Kết quả xem trước từ máy chủ · Chưa lưu' : 'Kết quả đối soát đã lưu'}
            </Typography>
            <Alert
              severity={
                status === 'Reconciled' || status === 'VarianceReviewed' ? 'success' : 'warning'
              }
            >
              {status === 'MissingConfirmedInputs'
                ? 'Thiếu dữ liệu đã xác nhận; cần bổ sung trước khi duyệt.'
                : status === 'Reconciled'
                  ? 'Đã khớp trong sai lệch cho phép.'
                  : status === 'VarianceReviewed'
                    ? 'Owner đã ghi nhận quyết định chênh lệch.'
                    : 'Có chênh lệch cần Owner kiểm tra.'}
            </Alert>
            <Typography>
              Nguồn: {setupDecimal(result.sourceConsumption)} · Phòng:{' '}
              {setupDecimal(result.roomConsumption)} · Khu chung:{' '}
              {setupDecimal(result.commonConsumption)} · Chênh lệch: {setupDecimal(result.variance)}{' '}
              {bill.data.utilityType === 0 ? 'kWh' : 'm³'}
            </Typography>
          </Stack>
        )}
        {preview && (
          <Button
            disabled={action.busy}
            onClick={() =>
              action.run(() => api.saveReconciliation(input()), 'Máy chủ đã lưu đối soát.')
            }
          >
            Lưu kết quả đối soát
          </Button>
        )}
        {source && preview && preview.inputsHash !== source.data.inputsHash && (
          <Alert severity="warning">
            Đầu vào đã thay đổi. Lưu lại đối soát và kiểm tra trước khi quyết định.
          </Alert>
        )}
        {source &&
          preview &&
          preview.inputsHash === source.data.inputsHash &&
          preview.status !== 'MissingConfirmedInputs' && (
            <Stack direction="row">
              <Button
                disabled={action.busy || !values.reason.trim()}
                onClick={() =>
                  action.run(
                    () => api.reviewReconciliation(source.id, true, values.reason, source.version),
                    'Máy chủ đã lưu quyết định chênh lệch của Owner.',
                  )
                }
              >
                Chấp thuận chênh lệch đã kiểm tra
              </Button>
              <Button
                disabled={action.busy || !values.reason.trim()}
                onClick={() =>
                  action.run(
                    () => api.reviewReconciliation(source.id, false, values.reason, source.version),
                    'Máy chủ đã ghi nhận yêu cầu xem xét lại.',
                  )
                }
              >
                Yêu cầu kiểm tra lại
              </Button>
            </Stack>
          )}
        <SetupActionFeedback {...action} />
      </Stack>
    </Paper>
  );
}

type Breakdown = Awaited<ReturnType<ReturnType<typeof usePropertySetupApi>['breakdowns']>>[number];
interface Segment {
  id: string;
  from: string;
  to: string;
  tariffId: string;
  consumption: string;
  freeQuantity: string;
  evidenceObjectKey: string;
  file: File | null;
}
export function UtilityBreakdownsPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [editing, setEditing] = useState<Breakdown | null | undefined>();
  const rows = useQuery({
    queryKey: ['property-setup', 'breakdowns', session?.userId, locationId],
    queryFn: ({ signal }) => api.breakdowns(locationId, signal),
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomOptions(locationId, signal),
  });
  const tariffs = useQuery({
    queryKey: ['property-setup', 'tariffs', session?.userId, locationId],
    queryFn: ({ signal }) => api.tariffs(locationId, signal),
  });
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Khi đổi biểu giá giữa tháng, nhập các đoạn liên tiếp bao phủ cả tháng, sản lượng đã kiểm tra
        và ảnh bằng chứng. Máy chủ kiểm tra tổng sản lượng và tính giá chính thức.
      </Alert>
      <Button
        variant="contained"
        sx={{ alignSelf: 'flex-start' }}
        disabled={rooms.isPending || !!rooms.error || tariffs.isPending || !!tariffs.error}
        onClick={() => setEditing(null)}
      >
        Xác nhận phân đoạn kỳ
      </Button>
      {rows.isPending ? (
        <LoadingState />
      ) : rows.error ? (
        <ErrorState error={rows.error} retry={() => void rows.refetch()} />
      ) : rows.data.length ? (
        rows.data.map((row) => (
          <Paper key={row.id} variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>
              {rooms.data?.find((room) => room.id === row.data.roomId)?.label ?? 'Phòng'} ·{' '}
              {row.data.utilityType === 0 ? 'Điện' : 'Nước'} ·{' '}
              {row.data.period.slice(0, 7).split('-').reverse().join('/')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Phiên bản {row.version} · {row.status === 'Verified' ? 'Đã xác minh' : row.status}
            </Typography>
            <Button
              disabled={rooms.isPending || !!rooms.error || tariffs.isPending || !!tariffs.error}
              onClick={() => setEditing(row)}
            >
              Xem / sửa phân đoạn
            </Button>
          </Paper>
        ))
      ) : (
        <Typography color="text.secondary">Chưa có phân đoạn kỳ.</Typography>
      )}
      {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
      {tariffs.error && <ErrorState error={tariffs.error} retry={() => void tariffs.refetch()} />}
      <Dialog open={editing !== undefined} fullWidth maxWidth="md">
        <DialogTitle>Phân đoạn sản lượng theo kỳ</DialogTitle>
        <DialogContent>
          {editing !== undefined && (
            <BreakdownEditor
              key={editing?.id ?? 'new'}
              locationId={locationId}
              source={editing}
              rooms={rooms.data ?? []}
              tariffs={tariffs.data ?? []}
              onClose={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function BreakdownEditor({
  locationId,
  source,
  rooms,
  tariffs,
  onClose,
}: {
  locationId: string;
  source: Breakdown | null;
  rooms: { id: string; label: string }[];
  tariffs: SetupDocument<UtilityTariffInput>[];
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const uploaded = useRef(new Map<File, string>());
  const [values, setValues] = useState<UtilityValues>({
    roomId: source?.data.roomId ?? '',
    utilityType: String(source?.data.utilityType ?? 0),
    period: source?.data.period.slice(0, 7) ?? '',
  });
  const [confirmed, setConfirmed] = useState(false);
  const [segments, setSegments] = useState<Segment[]>(
    source?.data.segments.map((segment) => ({
      ...segment,
      id: crypto.randomUUID(),
      consumption: String(segment.consumption),
      freeQuantity: String(segment.freeQuantity),
      file: null,
    })) ?? [],
  );
  const change = (id: string, changes: Partial<Segment>) =>
    setSegments((old) =>
      old.map((segment) => (segment.id === id ? { ...segment, ...changes } : segment)),
    );
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed) return;
          action.run(async () => {
            const inputs = [];
            for (const segment of segments) {
              let key = segment.evidenceObjectKey;
              if (segment.file) {
                key =
                  uploaded.current.get(segment.file) ??
                  (await api.uploadEvidence(locationId, segment.file)).objectKey;
                uploaded.current.set(segment.file, key);
              }
              if (!key) throw new Error('Every segment requires verified evidence.');
              inputs.push({
                from: segment.from,
                to: segment.to,
                tariffId: segment.tariffId,
                consumption: segment.consumption,
                freeQuantity: segment.freeQuantity,
                evidenceObjectKey: key,
              });
            }
            await api.breakdown({
              locationId,
              roomId: values.roomId,
              utilityType: Number(values.utilityType),
              period: periodStart(values.period),
              segments: inputs,
              humanConfirmed: true,
              expectedVersion: source?.version ?? 0,
            });
            onClose();
          }, 'Máy chủ đã lưu phân đoạn được xác nhận.');
        }}
      >
        <Typography variant="h6">Phân đoạn sản lượng trong tháng</Typography>
        {[
          { name: 'roomId', label: 'Phòng cần phân đoạn kỳ', options: rooms, disabled: !!source },
          {
            name: 'utilityType',
            label: 'Loại điện nước phân đoạn',
            options: utilityTypes,
            disabled: !!source,
          },
          { name: 'period', label: 'Tháng phân đoạn', type: 'month' as const, disabled: !!source },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        {segments.map((segment, index) => (
          <Stack key={segment.id} spacing={1}>
            <Typography>Đoạn {index + 1}</Typography>
            <TextField
              required
              type="date"
              label={`Đoạn ${index + 1} từ ngày`}
              slotProps={{ inputLabel: { shrink: true } }}
              value={segment.from}
              onChange={(event) => change(segment.id, { from: event.target.value })}
            />
            <TextField
              required
              type="date"
              label={`Đoạn ${index + 1} đến ngày`}
              slotProps={{ inputLabel: { shrink: true } }}
              value={segment.to}
              onChange={(event) => change(segment.id, { to: event.target.value })}
            />
            <TextField
              required
              select
              label={`Biểu giá đoạn ${index + 1}`}
              value={segment.tariffId}
              onChange={(event) => change(segment.id, { tariffId: event.target.value })}
            >
              <MenuItem value="">Chọn biểu giá đã xác minh</MenuItem>
              {tariffs
                .filter(
                  (tariff) =>
                    tariff.status === 'Verified' &&
                    tariff.data.utilityType === Number(values.utilityType),
                )
                .map((tariff) => (
                  <MenuItem key={tariff.id} value={tariff.id}>
                    {tariff.data.supplier} · {tariff.data.effectiveFrom}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              required
              label={`Sản lượng đoạn ${index + 1}`}
              value={segment.consumption}
              onChange={(event) => change(segment.id, { consumption: event.target.value })}
            />
            <TextField
              required
              label={`Miễn phí đoạn ${index + 1}`}
              value={segment.freeQuantity}
              onChange={(event) => change(segment.id, { freeQuantity: event.target.value })}
            />
            {segment.evidenceObjectKey && (
              <Typography>Đã có bằng chứng được lưu riêng tư.</Typography>
            )}
            <SetupEvidenceField
              value={segment.file}
              onChange={(file) => change(segment.id, { file })}
            />
            <Button
              onClick={() => setSegments((old) => old.filter((row) => row.id !== segment.id))}
            >
              Bỏ đoạn {index + 1}
            </Button>
          </Stack>
        ))}
        <Button
          disabled={segments.length >= 31}
          onClick={() =>
            setSegments((old) => [
              ...old,
              {
                id: crypto.randomUUID(),
                from: '',
                to: '',
                tariffId: '',
                consumption: '',
                freeQuantity: '0',
                evidenceObjectKey: '',
                file: null,
              },
            ])
          }
        >
          Thêm đoạn kỳ
        </Button>
        <FormControlLabel
          label="Đã kiểm tra và xác nhận các đoạn sản lượng"
          control={
            <Checkbox
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
          }
        />
        <SetupActionFeedback {...action} />
        <Stack direction="row">
          <Button
            type="submit"
            variant="contained"
            disabled={
              action.busy ||
              !confirmed ||
              !segments.length ||
              segments.some((segment) => !segment.file && !segment.evidenceObjectKey)
            }
          >
            Lưu phân đoạn đã xác nhận
          </Button>
          <Button onClick={onClose} disabled={action.busy}>
            Đóng phân đoạn
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
