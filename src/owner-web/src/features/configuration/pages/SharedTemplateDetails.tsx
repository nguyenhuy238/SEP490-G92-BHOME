import { useId, useState, type ReactNode } from 'react';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
  TableContainer,
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
  SharedAssetItem,
  SharedDocument,
  SharedResource,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import { SetupActionFeedback } from '../../property/UtilityFormTools';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { useSetupAction } from '../../property/useSetupAction';
import { useSharedConfigurationApi } from '../useSharedConfigurationApi';
import {
  configurationDialogContentSx,
  configurationDialogPaperSx,
  configurationFormGridSx,
  configurationStatusLabel,
  formatConfigurationDate,
} from '../SharedConfigurationLayout';

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
  const titleId = useId();
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [includeOptional, setIncludeOptional] = useState(true);
  const [usagePage, setUsagePage] = useState(0);
  const [plan, setPlan] = useState<{
    response: ConfigurationPlan;
    input: SharedApply;
    key: string;
    sourceName: string;
    locationLabel: string;
    roomLabel: string;
  } | null>(null);
  const doc = useQuery({
    queryKey: ['property-setup', 'shared-detail', session?.userId, resource, id],
    queryFn: ({ signal }) => api.get(resource, id, signal),
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
  const canApply = resource !== 'asset-catalog' && doc.data?.status === 'Published';
  const locationLabel = locations.data?.find((item) => item.id === location)?.label ?? location;
  const roomLabel = rooms.data?.find((item) => item.id === room)?.label ?? room;
  const canPreview =
    canApply &&
    !action.busy &&
    !locations.isPending &&
    !locations.isError &&
    !!location &&
    (!roomScope || (!!room && !rooms.isPending && !rooms.isError));
  function preview() {
    if (!canPreview || !doc.data) return;
    const source = doc.data;
    const input: SharedApply = {
      locationId: location,
      expectedVersion: source.version,
      conflictStrategy: 'Reject',
      targetState: '',
      roomId: roomScope ? room : null,
      includeOptionalItems: includeOptional,
    };
    action.run(async () => {
      const response = await api.preview(resource, id, input);
      setPlan({
        response,
        input: { ...input, targetState: response.targetState },
        key: crypto.randomUUID(),
        sourceName: source.name,
        locationLabel,
        roomLabel,
      });
    }, 'Đã nhận bản xem trước từ máy chủ.');
  }
  function apply() {
    if (!plan?.response.canProceed || action.busy) return;
    action.run(async () => {
      await api.apply(resource, id, plan.input, plan.key);
      setPlan(null);
    }, 'Máy chủ đã lưu cấu hình tại cơ sở.');
  }
  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      slotProps={{ paper: { sx: configurationDialogPaperSx } }}
      onClose={action.busy ? undefined : close}
    >
      <DialogTitle id={`${titleId}-container`} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
        <Stack spacing={0.75} sx={{ alignItems: 'flex-start' }}>
          <Typography id={titleId} component="span" variant="h2" sx={{ overflowWrap: 'anywhere' }}>
            {doc.data?.name ?? 'Chi tiết mẫu'}
          </Typography>
          {doc.data && (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Chip
                size="small"
                variant="outlined"
                color={doc.data.status === 'Published' ? 'success' : 'default'}
                label={configurationStatusLabel(doc.data.status)}
              />
            </Stack>
          )}
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={configurationDialogContentSx}>
        <Stack spacing={2}>
          <SetupActionFeedback
            error={action.error}
            notice={
              !plan && action.notice === 'Đã nhận bản xem trước từ máy chủ.' ? '' : action.notice
            }
          />
          {doc.isPending ? (
            <LoadingState />
          ) : doc.isError ? (
            <ErrorState error={doc.error} retry={() => void doc.refetch()} />
          ) : (
            doc.data && (
              <Stack spacing={1}>
                {doc.data.description && (
                  <Typography color="text.secondary">{doc.data.description}</Typography>
                )}
                <SharedDataSummary document={doc.data} />
              </Stack>
            )
          )}
          {canApply && (
            <Stack spacing={1.5} sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
              <Typography variant="h2" component="h3">
                Áp dụng tại cơ sở
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Bản sao tại cơ sở được lưu độc lập. Xem trước và xác nhận để áp dụng.
              </Typography>
              {locations.isPending && <LoadingState />}
              {locations.isError && (
                <ErrorState error={locations.error} retry={() => void locations.refetch()} />
              )}
              <Box sx={configurationFormGridSx}>
                <TextField
                  select
                  disabled={action.busy || locations.isPending || locations.isError}
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
                  <TextField
                    select
                    disabled={action.busy || !location || rooms.isPending || rooms.isError}
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
                )}
              </Box>
              {roomScope && location && rooms.isPending && <LoadingState />}
              {roomScope && rooms.isError && (
                <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
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
              {plan && (
                <ConfigurationChanges plan={plan.response}>
                  <Typography variant="body2">
                    <strong>Cơ sở đích:</strong> {plan.locationLabel}
                    {plan.input.roomId && (
                      <>
                        {' '}
                        · <strong>Phòng:</strong> {plan.roomLabel}
                      </>
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Nguồn: {plan.sourceName}
                    {resource === 'asset-templates' &&
                      (plan.input.includeOptionalItems
                        ? ' · Có mục tùy chọn'
                        : ' · Chỉ mục bắt buộc')}
                  </Typography>
                  {resource === 'fee-templates' && (
                    <Typography variant="body2" color="text.secondary">
                      Không thay đổi đơn giá trong hợp đồng đã ký.
                    </Typography>
                  )}
                </ConfigurationChanges>
              )}
            </Stack>
          )}
          <Box component="details" sx={historySectionSx}>
            <Typography component="summary" variant="h2" sx={historyHeadingSx}>
              Lịch sử áp dụng · {usage.data?.locationsUsing ?? '…'} cơ sở
            </Typography>
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              {usage.isPending ? (
                <LoadingState />
              ) : usage.isError ? (
                <ErrorState error={usage.error} retry={() => void usage.refetch()} />
              ) : (
                <>
                  {usage.data?.items.length ? (
                    <TableContainer>
                      <Table size="small" aria-label="Lịch sử áp dụng">
                        <TableHead>
                          <TableRow>
                            <TableCell>Cơ sở</TableCell>
                            <TableCell>Ngày áp dụng</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {usage.data.items.map((item) => (
                            <TableRow key={`${item.id}:${item.sourceId}:${item.sourceVersion}`}>
                              <TableCell>
                                {locations.data?.find((l) => l.id === item.targetLocationId)
                                  ?.label ?? item.targetLocationId}
                              </TableCell>
                              <TableCell>{formatEventTime(item.appliedAt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography color="text.secondary">
                      Mẫu chưa được áp dụng tại cơ sở nào.
                    </Typography>
                  )}
                  {!!usage.data?.total && (
                    <TablePagination
                      component="div"
                      count={usage.data.total}
                      page={usagePage}
                      rowsPerPage={20}
                      rowsPerPageOptions={[20]}
                      onPageChange={(_, value) => setUsagePage(value)}
                    />
                  )}
                </>
              )}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button disabled={action.busy} onClick={close}>
          Đóng
        </Button>
        {canApply && !plan && (
          <Button variant="contained" disabled={!canPreview} onClick={preview}>
            Xem trước áp dụng
          </Button>
        )}
        {canApply && plan && (
          <>
            {(!plan.response.canProceed ||
              (action.rawError instanceof ApiError && action.rawError.status === 409)) && (
              <Button disabled={!canPreview} onClick={preview}>
                Xem trước lại
              </Button>
            )}
            <Button
              variant="contained"
              disabled={action.busy || !plan.response.canProceed}
              onClick={apply}
            >
              Xác nhận áp dụng
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

const historySectionSx = { borderTop: '1px solid', borderColor: 'divider', pt: 1.5 } as const;
const historyHeadingSx = {
  cursor: 'pointer',
  py: 0.5,
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
} as const;

function formatEventTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
export function ConfigurationChanges({
  plan,
  children,
}: {
  plan: Pick<ConfigurationPlan, 'changes' | 'conflicts' | 'unsupportedReferences' | 'canProceed'>;
  children?: ReactNode;
}) {
  return (
    <Stack
      spacing={1}
      role="region"
      aria-label="Bản xem trước"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 1.5,
        overflowWrap: 'anywhere',
      }}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="h2" component="h3">
          Bản xem trước
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={plan.canProceed ? 'success' : 'warning'}
          label={plan.canProceed ? 'Có thể xác nhận' : 'Cần xử lý'}
        />
      </Stack>
      {children}
      <Typography variant="body2" sx={{ fontWeight: 650 }}>
        Thay đổi dự kiến
      </Typography>
      {plan.changes.length ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5, '& li + li': { mt: 0.5 } }}>
          {plan.changes.map((change, i) => (
            <Typography component="li" key={`change-${i}`}>
              {change}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography color="text.secondary">Không có thay đổi được đề xuất.</Typography>
      )}
      {plan.conflicts.map((message, i) => (
        <Alert key={`conflict-${i}`} severity="warning">
          {message}
        </Alert>
      ))}
      {plan.unsupportedReferences.map((message, i) => (
        <Alert key={`unsupported-${i}`} severity="warning">
          {message}
        </Alert>
      ))}
      {!plan.canProceed && (
        <Alert severity="error">Cần xử lý các xung đột trước khi tiếp tục.</Alert>
      )}
    </Stack>
  );
}

function SummaryFields({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  return (
    <Box component="dl" sx={{ ...configurationFormGridSx, m: 0 }}>
      {fields.map(({ label, value }) => (
        <Box key={label} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{
              m: 0,
              fontWeight: 650,
              overflowWrap: 'anywhere',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function AssetItemsSummary({ items }: { items: SharedAssetItem[] }) {
  return (
    <Stack spacing={1}>
      <Typography variant="body2" sx={{ fontWeight: 650 }}>
        Tài sản mẫu · {items.length} loại
      </Typography>
      {items.length ? (
        <TableContainer>
          <Table size="small" aria-label="Tài sản trong mẫu">
            <TableHead>
              <TableRow>
                <TableCell>Tài sản mẫu</TableCell>
                <TableCell align="right">Số lượng</TableCell>
                <TableCell>Yêu cầu</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, i) => (
                <TableRow key={`${item.catalogId}-${i}`}>
                  <TableCell>{item.catalog?.name ?? 'Tài sản chưa có thông tin'}</TableCell>
                  <TableCell align="right">
                    {item.quantity} {item.catalog?.unit ?? ''}
                  </TableCell>
                  <TableCell>{item.required ? 'Bắt buộc' : 'Tùy chọn'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography color="text.secondary">Chưa cấu hình tài sản mẫu.</Typography>
      )}
    </Stack>
  );
}

function SharedDataSummary({ document }: { document: SharedDocument }) {
  const data = document.data;
  if ('items' in data)
    return <AssetItemsSummary items={data.items} />;
  if ('capacity' in data)
    return (
      <Stack spacing={2}>
        <SummaryFields
          fields={[
            { label: 'Sức chứa', value: `${data.capacity} người` },
            { label: 'Diện tích', value: `${formatBillingDecimal(data.area)} m²` },
            {
              label: 'Giá thuê tham khảo',
              value:
                data.referenceRent == null
                  ? 'Chưa đặt'
                  : `${formatBillingDecimal(data.referenceRent)} đ/tháng`,
            },
            {
              label: 'Đặc điểm phòng',
              value: data.amenities.length ? data.amenities.join(', ') : 'Chưa đặt',
            },
          ]}
        />
        <AssetItemsSummary items={data.assetItems ?? []} />
      </Stack>
    );
  if ('content' in data)
    return (
      <Stack spacing={1}>
        <SummaryFields
          fields={[{ label: 'Hiệu lực từ', value: formatConfigurationDate(data.effectiveFrom) }]}
        />
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {data.content}
        </Typography>
      </Stack>
    );
  if ('referenceRate' in data) {
    const categories: Record<string, string> = {
      Rent: 'Tiền thuê',
      Electricity: 'Điện',
      Water: 'Nước',
      ServiceFee: 'Dịch vụ',
    };
    const methods: Record<string, string> = {
      FixedPerRoomPerMonth: 'Phòng/tháng',
      FixedPerPersonPerMonth: 'Người/tháng',
      Metered: 'Theo đồng hồ',
    };
    const unit =
      data.unit === 'VND/month'
        ? 'tháng'
        : data.unit === 'VND/person/month'
          ? 'người/tháng'
          : data.unit;
    return (
      <SummaryFields
        fields={[
          { label: 'Loại phí', value: categories[data.category] ?? data.category },
          { label: 'Mã khoản thu', value: data.chargeCode },
          {
            label: 'Mức phí tham khảo',
            value: `${formatBillingDecimal(data.referenceRate)} đ/${unit}`,
          },
          { label: 'Cách tính', value: methods[data.method] ?? data.method },
          { label: 'Phạm vi', value: data.scope === 'Room' ? 'Phòng' : 'Cơ sở' },
          {
            label: 'Hiệu lực',
            value: `${formatConfigurationDate(data.effectiveFrom)} – ${data.effectiveTo ? formatConfigurationDate(data.effectiveTo) : 'Không giới hạn'}`,
          },
        ]}
      />
    );
  }
  return (
    <SummaryFields
      fields={[
        { label: 'Đơn vị', value: data.unit },
        {
          label: 'Phạm vi',
          value:
            data.scope === 'Room'
              ? 'Theo phòng'
              : data.scope === 'Location'
                ? 'Chung cơ sở'
                : 'Cả hai',
        },
        {
          label: 'Giá tham khảo',
          value: `${formatBillingDecimal(data.referencePrice)} đ/${data.unit}`,
        },
      ]}
    />
  );
}
