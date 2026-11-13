import { useState } from 'react';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type {
  ConfigurationPlan,
  SharedApply,
  SharedDocument,
  SharedResource,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import { SetupActionFeedback } from '../../property/UtilityFormTools';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { useSetupAction } from '../../property/useSetupAction';
import { useSharedConfigurationApi } from '../useSharedConfigurationApi';

export function SharedTemplateDetails({
  resource,
  id,
  close,
}: {
  resource: SharedResource;
  id: string;
  close: () => void;
}) {
  const api = useSharedConfigurationApi();
  const property = usePropertySetupApi();
  const { session } = useAuth();
  const action = useSetupAction();
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [includeOptional, setIncludeOptional] = useState(true);
  const [usagePage, setUsagePage] = useState(0);
  const [plan, setPlan] = useState<{
    response: ConfigurationPlan;
    input: SharedApply;
    key: string;
  } | null>(null);
  const doc = useQuery({
    queryKey: ['property-setup', 'shared-detail', session?.userId, resource, id],
    queryFn: ({ signal }) => api.get(resource, id, signal),
  });
  const versions = useQuery({
    queryKey: ['property-setup', 'shared-versions', session?.userId, resource, id],
    queryFn: ({ signal }) => api.versions(resource, id, signal),
  });
  const history = useQuery({
    queryKey: ['property-setup', 'shared-history', session?.userId, resource, id],
    queryFn: ({ signal }) => api.history(resource, id, signal),
  });
  const usage = useQuery({
    queryKey: ['property-setup', 'shared-usage', session?.userId, resource, id, usagePage],
    queryFn: ({ signal }) => api.applications(resource, id, usagePage + 1, signal),
  });
  const locations = useQuery({
    queryKey: ['property-setup', 'locations-options', session?.userId],
    queryFn: ({ signal }) => property.locationOptions(signal),
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, location],
    queryFn: ({ signal }) => property.roomOptions(location, signal),
    enabled: !!location && resource === 'fee-templates',
  });
  const roomScope = doc.data && 'scope' in doc.data.data && doc.data.data.scope === 'Room';
  return (
    <Dialog open fullWidth maxWidth="md" onClose={action.busy ? undefined : close}>
      <DialogTitle>{doc.data?.name ?? 'Chi tiết mẫu'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <SetupActionFeedback error={action.error} notice={action.notice} />
          {doc.isPending ? (
            <LoadingState />
          ) : doc.isError ? (
            <ErrorState error={doc.error} retry={() => void doc.refetch()} />
          ) : (
            doc.data && (
              <>
                <Typography>{doc.data.description}</Typography>
                <SharedDataSummary document={doc.data} />
              </>
            )
          )}
          <Typography variant="h6">Phiên bản và lịch sử</Typography>
          {versions.isError || history.isError ? (
            <ErrorState
              error={versions.error ?? history.error}
              retry={() => {
                void versions.refetch();
                void history.refetch();
              }}
            />
          ) : (
            <>
              <Typography>
                {versions.data?.map((v) => `Phiên bản ${v.edition} · ${v.status}`).join(' / ')}
              </Typography>
              {history.data?.map((v) => (
                <Typography key={v.version} variant="body2">
                  Lần {v.version} · {v.status} · {new Date(v.updatedAt).toLocaleString('vi-VN')}
                </Typography>
              ))}
            </>
          )}
          {resource !== 'asset-catalog' && doc.data?.status === 'Published' && (
            <>
              <Typography variant="h6">Áp dụng tại cơ sở</Typography>
              <Alert severity="info">
                Xem trước thay đổi và xác nhận. Cấu hình tại cơ sở được lưu độc lập.
              </Alert>
              {locations.isError && (
                <ErrorState error={locations.error} retry={() => void locations.refetch()} />
              )}
              <TextField
                select
                disabled={action.busy}
                label="Cơ sở đích"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setRoom('');
                  setPlan(null);
                }}
              >
                <MenuItem value="">Chọn</MenuItem>
                {locations.data?.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.label}
                  </MenuItem>
                ))}
              </TextField>
              {roomScope && (
                <>
                  <TextField
                    select
                    disabled={action.busy}
                    label="Phòng đích"
                    value={room}
                    onChange={(e) => {
                      setRoom(e.target.value);
                      setPlan(null);
                    }}
                  >
                    <MenuItem value="">Chọn</MenuItem>
                    {rooms.data?.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {rooms.isError && (
                    <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
                  )}
                </>
              )}
              {resource === 'asset-templates' && (
                <FormControlLabel
                  label="Bao gồm các mục tùy chọn"
                  control={
                    <Checkbox
                      disabled={action.busy}
                      checked={includeOptional}
                      onChange={(e) => {
                        setIncludeOptional(e.target.checked);
                        setPlan(null);
                      }}
                    />
                  }
                />
              )}
              <Button
                disabled={action.busy || !location || (!!roomScope && !room)}
                onClick={() =>
                  action.run(async () => {
                    const input: SharedApply = {
                      locationId: location,
                      expectedVersion: doc.data!.version,
                      conflictStrategy: 'Reject',
                      targetState: '',
                      roomId: roomScope ? room : null,
                      includeOptionalItems: includeOptional,
                    };
                    const response = await api.preview(resource, id, input);
                    setPlan({
                      response,
                      input: { ...input, targetState: response.targetState },
                      key: crypto.randomUUID(),
                    });
                  }, 'Đã nhận bản xem trước từ máy chủ.')
                }
              >
                Xem trước áp dụng
              </Button>
              {plan && (
                <>
                  <ConfigurationChanges plan={plan.response} />
                  <Button
                    variant="contained"
                    disabled={action.busy || !plan.response.canProceed}
                    onClick={() =>
                      action.run(async () => {
                        await api.apply(resource, id, plan.input, plan.key);
                        setPlan(null);
                      }, 'Máy chủ đã lưu cấu hình tại cơ sở.')
                    }
                  >
                    Xác nhận áp dụng
                  </Button>
                </>
              )}
            </>
          )}
          <Typography variant="h6">
            Lịch sử áp dụng · {usage.data?.locationsUsing ?? '…'} cơ sở
          </Typography>
          {usage.isPending ? (
            <LoadingState />
          ) : usage.isError ? (
            <ErrorState error={usage.error} retry={() => void usage.refetch()} />
          ) : (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Cơ sở</TableCell>
                    <TableCell>Phiên bản</TableCell>
                    <TableCell>Thời gian</TableCell>
                    <TableCell>Kết quả</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usage.data?.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {locations.data?.find((l) => l.id === item.targetLocationId)?.label ??
                          item.targetLocationId}
                      </TableCell>
                      <TableCell>{item.sourceEdition}</TableCell>
                      <TableCell>{new Date(item.appliedAt).toLocaleString('vi-VN')}</TableCell>
                      <TableCell>{item.status === 'Completed' ? 'Đã lưu' : item.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={usage.data?.total ?? 0}
                page={usagePage}
                rowsPerPage={20}
                rowsPerPageOptions={[20]}
                onPageChange={(_, value) => setUsagePage(value)}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Đóng
        </Button>
      </DialogActions>
    </Dialog>
  );
}
export function ConfigurationChanges({
  plan,
}: {
  plan: Pick<ConfigurationPlan, 'changes' | 'conflicts' | 'unsupportedReferences' | 'canProceed'>;
}) {
  return (
    <Stack spacing={1}>
      {plan.changes.map((change, i) => (
        <Typography key={`change-${i}`}>{change}</Typography>
      ))}
      {[...plan.conflicts, ...plan.unsupportedReferences].map((message, i) => (
        <Alert key={i} severity="warning">
          {message}
        </Alert>
      ))}
      {!plan.canProceed && (
        <Alert severity="error">Cần xử lý các xung đột trước khi tiếp tục.</Alert>
      )}
    </Stack>
  );
}
function SharedDataSummary({ document }: { document: SharedDocument }) {
  const data = document.data;
  if ('items' in data)
    return (
      <Stack>
        {data.items.map((item, i) => (
          <Typography key={i}>
            {item.catalog?.name} · {item.quantity} {item.catalog?.unit} ·{' '}
            {item.required ? 'Bắt buộc' : 'Tùy chọn'}
          </Typography>
        ))}
      </Stack>
    );
  if ('capacity' in data)
    return (
      <Typography>
        Sức chứa: {data.capacity} · Diện tích: {data.area} m² · Giá tham khảo:{' '}
        {data.referenceRent == null ? 'Chưa đặt' : formatBillingDecimal(data.referenceRent)} · Tiện
        ích: {data.amenities.join(', ')}
      </Typography>
    );
  if ('content' in data)
    return (
      <>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{data.content}</Typography>
        <Typography>Hiệu lực từ: {data.effectiveFrom}</Typography>
      </>
    );
  if ('referenceRate' in data)
    return (
      <Typography>
        {data.chargeCode} · {formatBillingDecimal(data.referenceRate)} {data.unit} ·{' '}
        {data.effectiveFrom} – {data.effectiveTo ?? 'Không giới hạn'}
      </Typography>
    );
  return (
    <Typography>
      {data.category} · {data.unit} · Giá tham khảo: {formatBillingDecimal(data.referencePrice)}
    </Typography>
  );
}
