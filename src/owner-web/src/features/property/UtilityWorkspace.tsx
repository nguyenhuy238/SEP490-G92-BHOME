import { MoneyField } from '../../components/common/MoneyField';
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  SetupDocument,
  UtilityProfileInput,
  UtilityQuotaInput,
  UtilityTariffInput,
  UtilityTier,
} from '../../../../../packages/client-core/src/propertySetup';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';
import { SetupActionFeedback, UtilityField } from './UtilityFormTools';
import { periodStart, setupDecimal, utilityTypes, type UtilityValues } from './utilityFormValues';
import {
  UtilitySourcesPanel,
  UtilityBillsPanel,
  UtilityBreakdownsPanel,
} from './UtilityWorkspaceOperations';

export function UtilityWorkspace({ locationId }: { locationId: string }) {
  const { session } = useAuth();
  const [tab, setTab] = useState('tariffs');
  if (!session?.roles.includes('Owner'))
    return <Alert severity="warning">Chỉ Owner được quản lý cấu hình điện nước.</Alert>;
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h5">Điện & nước</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Quản lý từ biểu giá, công tơ và chỉ số đến hóa đơn nguồn và đối soát theo kỳ. Chọn nhóm
          nghiệp vụ bên dưới để bắt đầu.
        </Typography>
      </Paper>
      <Alert severity="info">
        Giá và định mức do Owner xác minh. Phép tính chính thức, kiểm tra thiếu dữ liệu và chênh
        lệch do máy chủ quyết định.
      </Alert>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
        sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {[
          ['tariffs', 'Biểu giá'],
          ['profiles', 'Cấu hình phòng'],
          ['sources', 'Công tơ & Chỉ số'],
          ['bills', 'Hóa đơn nguồn & Đối soát'],
          ['breakdowns', 'Phân đoạn kỳ'],
        ].map(([key, label]) => (
          <Tab key={key} value={key} label={label} />
        ))}
      </Tabs>
      {tab === 'tariffs' ? (
        <TariffsPanel locationId={locationId} />
      ) : tab === 'profiles' ? (
        <ProfilesPanel locationId={locationId} />
      ) : tab === 'sources' ? (
        <UtilitySourcesPanel locationId={locationId} />
      ) : tab === 'bills' ? (
        <UtilityBillsPanel locationId={locationId} />
      ) : (
        <UtilityBreakdownsPanel locationId={locationId} />
      )}
    </Stack>
  );
}

function TariffsPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [source, setSource] = useState<SetupDocument<UtilityTariffInput> | null>(null);
  const [editing, setEditing] = useState(false);
  const tariffs = useQuery({
    queryKey: ['property-setup', 'tariffs', session?.userId, locationId],
    queryFn: ({ signal }) => api.tariffs(locationId, signal),
  });
  return (
    <Stack spacing={2}>
      <Button
        onClick={() => {
          setSource(null);
          setEditing(true);
        }}
      >
        Thêm biểu giá điện nước
      </Button>
      {tariffs.isPending ? (
        <LoadingState />
      ) : tariffs.error ? (
        <ErrorState error={tariffs.error} retry={() => void tariffs.refetch()} />
      ) : (
        <>
          {!tariffs.data.length && <Typography>Chưa có biểu giá.</Typography>}
          {tariffs.data.map((tariff) => (
            <Paper key={tariff.id} sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="h6">
                  {tariff.data.supplier} · {tariff.data.classification}
                </Typography>
                <Typography>
                  {tariff.data.utilityType === 0 ? 'Điện' : 'Nước'} · {tariff.data.effectiveFrom} →{' '}
                  {tariff.data.effectiveTo ?? 'Không hạn'} · {tariff.status}
                </Typography>
                {tariff.data.tiers.map((tier, index) => (
                  <Typography key={index}>
                    Bậc {index + 1}:{' '}
                    {tier.through == null ? 'Phần còn lại' : `Đến ${setupDecimal(tier.through)}`} ·{' '}
                    {setupDecimal(tier.rate)} VND/đơn vị
                  </Typography>
                ))}
                {tariffs.data.some((row) => row.data.replacesId === tariff.id) ? (
                  <Typography>Đã có biểu giá thay thế.</Typography>
                ) : (
                  <Button
                    onClick={() => {
                      setSource(tariff);
                      setEditing(true);
                    }}
                  >
                    Tạo biểu giá thay thế
                  </Button>
                )}
              </Stack>
            </Paper>
          ))}
        </>
      )}
      <Dialog open={editing} fullWidth maxWidth="md">
        <DialogTitle>
          {source ? 'Thay thế biểu giá điện nước' : 'Thêm biểu giá điện nước'}
        </DialogTitle>
        <DialogContent>
          {editing && (
            <TariffEditor
              key={source?.id ?? 'new'}
              locationId={locationId}
              source={source}
              onClose={() => setEditing(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function TariffEditor({
  locationId,
  source,
  onClose,
}: {
  locationId: string;
  source: SetupDocument<UtilityTariffInput> | null;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    utilityType: String(source?.data.utilityType ?? 0),
    rounding: String(source?.data.rounding ?? 0),
    supplier: source?.data.supplier ?? '',
    classification: source?.data.classification ?? '',
    sourceReference: source?.data.sourceReference ?? '',
    effectiveFrom: '',
    effectiveTo: '',
    verified: 'false',
  });
  const [tiers, setTiers] = useState<{ through: string; rate: string }[]>(
    source?.data.tiers.map((tier) => ({
      through: String(tier.through ?? ''),
      rate: String(tier.rate),
    })) ?? [{ through: '', rate: '' }],
  );
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            const normalized: UtilityTier[] = tiers.map((tier) => ({
              through: tier.through || null,
              rate: tier.rate,
            }));
            await api.saveTariff(
              {
                locationId,
                utilityType: Number(values.utilityType),
                rounding: Number(values.rounding),
                supplier: values.supplier,
                classification: values.classification,
                sourceReference: values.sourceReference,
                effectiveFrom: values.effectiveFrom,
                effectiveTo: values.effectiveTo || null,
                verified: values.verified === 'true',
                tiers: normalized,
              },
              source?.id,
            );
            onClose();
          }, 'Máy chủ đã lưu biểu giá; lịch sử nguồn được giữ nguyên.');
        }}
      >
        <Typography variant="h6">
          {source ? 'Biểu giá thay thế từ ngày mới' : 'Biểu giá mới'}
        </Typography>
        {[
          {
            name: 'utilityType',
            label: 'Loại điện nước',
            options: utilityTypes,
            disabled: !!source,
          },
          { name: 'supplier', label: 'Nhà cung cấp' },
          { name: 'classification', label: 'Nhóm áp dụng' },
          { name: 'sourceReference', label: 'Căn cứ giá do Owner kiểm tra' },
          { name: 'effectiveFrom', label: 'Biểu giá hiệu lực từ', type: 'date' as const },
          {
            name: 'effectiveTo',
            label: 'Biểu giá hiệu lực đến',
            type: 'date' as const,
            optional: true,
          },
          {
            name: 'rounding',
            label: 'Làm tròn tổng VND',
            options: [
              { id: '0', label: 'Làm tròn .5 lên' },
              { id: '1', label: 'Làm tròn .5 về số chẵn' },
            ],
          },
          {
            name: 'verified',
            label: 'Đã xác minh căn cứ giá',
            type: 'check' as const,
            optional: true,
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        {tiers.map((tier, index) => (
          <Stack key={index} direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <TextField
              label={`Bậc ${index + 1} đến sản lượng (trống ở bậc cuối)`}
              value={tier.through}
              onChange={(event) =>
                setTiers((old) =>
                  old.map((row, i) =>
                    i === index ? { ...row, through: event.target.value } : row,
                  ),
                )
              }
            />
            <MoneyField
              allowDecimal
              required
              label={`Đơn giá bậc ${index + 1}`}
              value={tier.rate}
              onValueChange={(raw) =>
                setTiers((old) => old.map((row, i) => (i === index ? { ...row, rate: raw } : row)))
              }
            />
            <Button
              disabled={tiers.length === 1}
              onClick={() => setTiers((old) => old.filter((_, i) => i !== index))}
            >
              Bỏ bậc {index + 1}
            </Button>
          </Stack>
        ))}
        <Button
          disabled={tiers.length >= 50}
          onClick={() => setTiers((old) => [...old, { through: '', rate: '' }])}
        >
          Thêm bậc giá
        </Button>
        <SetupActionFeedback {...action} />
        <Stack direction="row">
          <Button variant="contained" type="submit" disabled={action.busy}>
            Lưu biểu giá điện nước
          </Button>
          <Button onClick={onClose} disabled={action.busy}>
            Đóng biểu giá
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function ProfilesPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [profile, setProfile] = useState<SetupDocument<UtilityProfileInput> | null | undefined>();
  const [quota, setQuota] = useState<SetupDocument<UtilityQuotaInput> | null | undefined>();
  const profiles = useQuery({
    queryKey: ['property-setup', 'utility-profiles', session?.userId, locationId],
    queryFn: ({ signal }) => api.profiles(locationId, signal),
  });
  const quotas = useQuery({
    queryKey: ['property-setup', 'utility-quotas', session?.userId, locationId],
    queryFn: ({ signal }) => api.quotas(locationId, signal),
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
      <Stack direction="row">
        <Button onClick={() => setProfile(null)}>Gán biểu giá cho phòng</Button>
        <Button onClick={() => setQuota(null)}>Thêm định mức miễn phí</Button>
      </Stack>
      {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
      {tariffs.error && <ErrorState error={tariffs.error} retry={() => void tariffs.refetch()} />}
      {profiles.isPending ? (
        <LoadingState />
      ) : profiles.error ? (
        <ErrorState error={profiles.error} retry={() => void profiles.refetch()} />
      ) : (
        profiles.data.map((row) => (
          <Paper key={row.id} sx={{ p: 2 }}>
            <Typography>
              {rooms.data?.find((room) => room.id === row.data.roomId)?.label ?? 'Phòng'} ·{' '}
              {row.data.utilityType === 0 ? 'Điện' : 'Nước'} · {row.data.effectiveFrom} →{' '}
              {row.data.effectiveTo ?? 'Không hạn'}
            </Typography>
            {profiles.data.some((next) => next.data.replacesId === row.id) ? (
              <Typography>Có cấu hình thay thế.</Typography>
            ) : (
              <Button onClick={() => setProfile(row)}>Thay cấu hình phòng từ ngày mới</Button>
            )}
          </Paper>
        ))
      )}
      <Dialog open={profile !== undefined} fullWidth maxWidth="md">
        <DialogTitle>Cấu hình biểu giá của phòng</DialogTitle>
        <DialogContent>
          {profile !== undefined && (
            <ProfileEditor
              key={profile?.id ?? 'new'}
              locationId={locationId}
              source={profile}
              rooms={rooms.data ?? []}
              tariffs={tariffs.data ?? []}
              onClose={() => setProfile(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Typography variant="h6">Định mức theo kỳ đã lưu</Typography>
      {quotas.error && <ErrorState error={quotas.error} retry={() => void quotas.refetch()} />}
      {quotas.data?.map((row) => (
        <Paper key={row.id} sx={{ p: 2 }}>
          <Typography>
            {rooms.data?.find((room) => room.id === row.data.roomId)?.label ?? 'Phòng'} ·{' '}
            {row.data.period} · {setupDecimal(row.data.freeQuantity)} · {row.status}
          </Typography>
          <Button onClick={() => setQuota(row)}>Chỉnh định mức</Button>
        </Paper>
      ))}
      <Dialog open={quota !== undefined} fullWidth maxWidth="sm">
        <DialogTitle>Định mức miễn phí theo kỳ</DialogTitle>
        <DialogContent>
          {quota !== undefined && (
            <QuotaEditor
              key={quota?.id ?? 'new'}
              locationId={locationId}
              source={quota}
              rooms={rooms.data ?? []}
              onClose={() => setQuota(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function ProfileEditor({
  locationId,
  source,
  rooms,
  tariffs,
  onClose,
}: {
  locationId: string;
  source: SetupDocument<UtilityProfileInput> | null;
  rooms: { id: string; label: string }[];
  tariffs: SetupDocument<UtilityTariffInput>[];
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    roomId: source?.data.roomId ?? '',
    utilityType: String(source?.data.utilityType ?? 0),
    tariffId: '',
    effectiveFrom: '',
    effectiveTo: '',
    requireQuota: String(source?.data.requireQuota ?? false),
    requireReconciliation: String(source?.data.requireReconciliation ?? false),
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.saveProfile(
              {
                locationId,
                roomId: values.roomId,
                utilityType: Number(values.utilityType),
                tariffId: values.tariffId,
                effectiveFrom: values.effectiveFrom,
                effectiveTo: values.effectiveTo || null,
                requireQuota: values.requireQuota === 'true',
                requireReconciliation: values.requireReconciliation === 'true',
                expectedVersion: source?.version ?? 0,
              },
              source?.id,
            );
            onClose();
          }, 'Máy chủ đã lưu cấu hình biểu giá của phòng.');
        }}
      >
        <Typography variant="h6">Cấu hình biểu giá của phòng</Typography>
        {[
          { name: 'roomId', label: 'Phòng áp dụng biểu giá', options: rooms, disabled: !!source },
          {
            name: 'utilityType',
            label: 'Loại điện nước của phòng',
            options: utilityTypes,
            disabled: !!source,
          },
          {
            name: 'tariffId',
            label: 'Biểu giá áp dụng',
            options: tariffs
              .filter((row) => row.data.utilityType === Number(values.utilityType))
              .map((row) => ({
                id: row.id,
                label: `${row.data.supplier} · ${row.data.classification} · ${row.data.effectiveFrom}`,
              })),
          },
          { name: 'effectiveFrom', label: 'Cấu hình phòng hiệu lực từ', type: 'date' as const },
          {
            name: 'effectiveTo',
            label: 'Cấu hình phòng hiệu lực đến',
            type: 'date' as const,
            optional: true,
          },
          {
            name: 'requireQuota',
            label: 'Yêu cầu định mức miễn phí đã xác minh',
            type: 'check' as const,
            optional: true,
          },
          {
            name: 'requireReconciliation',
            label: 'Yêu cầu đối soát nguồn trước lập hóa đơn',
            type: 'check' as const,
            optional: true,
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupActionFeedback {...action} />
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={action.busy}>
            Lưu cấu hình điện nước phòng
          </Button>
          <Button onClick={onClose}>Đóng cấu hình phòng</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function QuotaEditor({
  locationId,
  source,
  rooms,
  onClose,
}: {
  locationId: string;
  source: SetupDocument<UtilityQuotaInput> | null;
  rooms: { id: string; label: string }[];
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [values, setValues] = useState<UtilityValues>({
    roomId: source?.data.roomId ?? '',
    utilityType: String(source?.data.utilityType ?? 0),
    period: source?.data.period.slice(0, 7) ?? '',
    freeQuantity: String(source?.data.freeQuantity ?? ''),
    sourceReference: source?.data.sourceReference ?? '',
    verified: String(source?.data.verified ?? false),
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.saveQuota({
              locationId,
              roomId: values.roomId,
              utilityType: Number(values.utilityType),
              period: periodStart(values.period),
              freeQuantity: values.freeQuantity,
              sourceReference: values.sourceReference,
              verified: values.verified === 'true',
              expectedVersion: source?.version ?? 0,
            });
            onClose();
          }, 'Máy chủ đã lưu định mức.');
        }}
      >
        <Typography variant="h6">Định mức miễn phí theo phòng và tháng</Typography>
        {[
          { name: 'roomId', label: 'Phòng có định mức', options: rooms, disabled: !!source },
          {
            name: 'utilityType',
            label: 'Loại định mức',
            options: utilityTypes,
            disabled: !!source,
          },
          { name: 'period', label: 'Tháng định mức', type: 'month' as const, disabled: !!source },
          { name: 'freeQuantity', label: 'Sản lượng miễn phí' },
          { name: 'sourceReference', label: 'Căn cứ xác minh định mức' },
          {
            name: 'verified',
            label: 'Đã xác minh định mức',
            type: 'check' as const,
            optional: true,
          },
        ].map((field) => (
          <UtilityField key={field.name} field={field} values={values} setValues={setValues} />
        ))}
        <SetupActionFeedback {...action} />
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={action.busy}>
            Lưu định mức
          </Button>
          <Button onClick={onClose}>Đóng định mức</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
