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
    sourceEdition: number;
    locationLabel: string;
    roomLabel: string;
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
        sourceEdition: source.edition,
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
              <Typography variant="caption" color="text.secondary">
                Phiên bản {doc.data.edition} · Lần cập nhật {doc.data.version}
              </Typography>
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
                    Nguồn: {plan.sourceName} · Phiên bản {plan.sourceEdition} · Lần cập nhật{' '}
                    {plan.input.expectedVersion}
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
              Phiên bản và lịch sử
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {versions.isPending || history.isPending ? (
                <LoadingState />
              ) : versions.isError || history.isError ? (
                <ErrorState
                  error={versions.error ?? history.error}
                  retry={() => {
                    void versions.refetch();
                    void history.refetch();
                  }}
                />
              ) : (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    Các phiên bản
                  </Typography>
                  {versions.data?.length ? (
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {versions.data.map((v) => (
                        <Chip
                          key={v.id}
                          size="small"
                          variant="outlined"
                          label={`Phiên bản ${v.edition} · ${configurationStatusLabel(v.status)}`}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography color="text.secondary">Chưa có phiên bản.</Typography>
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    Lịch sử cập nhật mẫu
                  </Typography>
                  {history.data?.length ? (
                    <TableContainer>
                      <Table size="small" aria-label="Lịch sử cập nhật mẫu" sx={{ minWidth: 360 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Lần cập nhật</TableCell>
                            <TableCell>Trạng thái</TableCell>
                            <TableCell>Thời gian</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {history.data.map((v) => (
                            <TableRow key={v.version}>
                              <TableCell>{v.version}</TableCell>
                              <TableCell>{configurationStatusLabel(v.status)}</TableCell>
                              <TableCell>{formatEventTime(v.updatedAt)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography color="text.secondary">Chưa có lịch sử cập nhật.</Typography>
                  )}
                </>
              )}
            </Stack>
          </Box>
          <Box component="details" sx={historySectionSx}>
            <Typography component="summary" variant="h2" sx={historyHeadingSx}>
              Lịch sử áp dụng · {usage.data?.locationsUsing ?? '…'} cơ sở
            </Typography>
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              <Typography color="text.secondary" variant="caption">
                Các cơ sở từng nhận bản sao của mẫu, gồm cả các phiên bản trước.
              </Typography>
              {usage.isPending ? (
                <LoadingState />
              ) : usage.isError ? (
                <ErrorState error={usage.error} retry={() => void usage.refetch()} />
              ) : (
                <>
                  {usage.data?.items.length ? (
                    <TableContainer>
                      <Table size="small" aria-label="Lịch sử áp dụng" sx={{ minWidth: 460 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Cơ sở</TableCell>
                            <TableCell>Phiên bản nguồn</TableCell>
                            <TableCell>Thời gian</TableCell>
                            <TableCell>Kết quả</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {usage.data.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                {locations.data?.find((l) => l.id === item.targetLocationId)
                                  ?.label ?? item.targetLocationId}
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">v{item.sourceEdition}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Lần cập nhật {item.sourceVersion}
                                </Typography>
                              </TableCell>
                              <TableCell>{formatEventTime(item.appliedAt)}</TableCell>
                              <TableCell>
                                {item.status === 'Completed' ? 'Đã lưu' : item.status}
                              </TableCell>
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

function SharedDataSummary({ document }: { document: SharedDocument }) {
  const data = document.data;
  if ('items' in data)
    return (
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          Tài sản trong mẫu · {data.items.length} loại
        </Typography>
        {data.items.length ? (
          <TableContainer>
            <Table size="small" aria-label="Tài sản trong mẫu" sx={{ minWidth: 380 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Tài sản</TableCell>
                  <TableCell align="right">Số lượng</TableCell>
                  <TableCell>Yêu cầu</TableCell>
                  <TableCell>Theo dõi</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((item, i) => (
                  <TableRow key={`${item.catalogId}-${i}`}>
                    <TableCell>
                      <Typography variant="body2">
                        {item.catalog?.name ?? 'Mục danh mục đã chọn'}
                      </Typography>
                      {item.catalog && (
                        <Typography variant="caption" color="text.secondary">
                          Phiên bản {item.catalog.edition}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {item.quantity} {item.catalog?.unit}
                    </TableCell>
                    <TableCell>{item.required ? 'Bắt buộc' : 'Tùy chọn'}</TableCell>
                    <TableCell>
                      {item.trackingMode === 'Serialized' ? 'Từng tài sản' : 'Theo số lượng'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Typography color="text.secondary">Chưa có tài sản trong mẫu.</Typography>
        )}
      </Stack>
    );
  if ('capacity' in data)
    return (
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
            label: 'Tiện ích',
            value: data.amenities.length ? data.amenities.join(', ') : 'Chưa đặt',
          },
        ]}
      />
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
        { label: 'Nhóm tài sản', value: data.category },
        {
          label: 'Giá tham khảo',
          value: `${formatBillingDecimal(data.referencePrice)} đ/${data.unit}`,
        },
      ]}
    />
  );
}
