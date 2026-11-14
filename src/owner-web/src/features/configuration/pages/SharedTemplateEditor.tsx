import { Fragment, useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type {
  AssetCatalogData,
  SharedAssetItem,
  SharedDocument,
  SharedResource,
  SharedWrite,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import { UtilityField } from '../../property/UtilityFormTools';
import type { UtilityFieldDefinition } from '../../property/UtilityFormTools';
import { useSharedConfigurationApi } from '../useSharedConfigurationApi';
import { MoneyField } from '../../../components/common/MoneyField';
import {
  configurationDialogContentSx,
  configurationDialogPaperSx,
  configurationFormGridSx,
} from '../SharedConfigurationLayout';

const resourceNames: Record<SharedResource, string> = {
  'room-type-templates': 'mẫu loại phòng',
  'asset-catalog': 'loại tài sản',
  'asset-templates': 'mẫu tài sản',
  'fee-templates': 'mẫu giá & biểu phí',
  'policy-templates': 'mẫu chính sách',
};

const feeDefaults: Record<string, { chargeCode: string; method: string; unit: string }> = {
  Rent: { chargeCode: 'RENT', method: 'FixedPerRoomPerMonth', unit: 'VND/month' },
  Electricity: { chargeCode: 'ELECTRICITY', method: 'Metered', unit: 'kWh' },
  Water: { chargeCode: 'WATER', method: 'Metered', unit: 'm³' },
  ServiceFee: { chargeCode: '', method: 'FixedPerRoomPerMonth', unit: 'VND/month' },
};
const personMethod = 'FixedPerPersonPerMonth';
const feeUnit = (category: string, method: string) =>
  category === 'ServiceFee' && method === personMethod
    ? 'VND/person/month'
    : feeDefaults[category].unit;

export function SharedTemplateEditor({
  resource,
  document,
  busy,
  error,
  close,
  save,
}: {
  resource: SharedResource;
  document: SharedDocument | null;
  busy: boolean;
  error: string;
  close: () => void;
  save: (input: SharedWrite) => void;
}) {
  const api = useSharedConfigurationApi();
  const { session } = useAuth();
  const titleId = useId();
  const [name, setName] = useState(document?.name ?? '');
  const [description, setDescription] = useState(document?.description ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const result: Record<string, string> =
      resource === 'fee-templates'
        ? {
            scope: 'Location',
            category: 'Rent',
            method: 'FixedPerRoomPerMonth',
            chargeCode: 'RENT',
            unit: 'VND/month',
          }
        : {};
    if (document)
      for (const [key, value] of Object.entries(document.data))
        result[key] = Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);
    if (resource === 'fee-templates' && feeDefaults[result.category]) {
      const defaults = feeDefaults[result.category];
      result.method =
        result.category === 'ServiceFee' && result.method === personMethod
          ? personMethod
          : defaults.method;
      result.unit = feeUnit(result.category, result.method);
      if (result.category !== 'ServiceFee') result.chargeCode = defaults.chargeCode;
    }
    return result;
  });
  const [items, setItems] = useState<SharedAssetItem[]>(
    document && 'items' in document.data ? document.data.items : [],
  );
  const [catalogId, setCatalogId] = useState('');
  const [validationError, setValidationError] = useState('');
  const updateFields: typeof setValues = (update) => {
    setValues((old) => {
      const next = typeof update === 'function' ? update(old) : update;
      if (resource === 'fee-templates' && next.category !== old.category) {
        return {
          ...next,
          ...(feeDefaults[next.category] ?? { chargeCode: '', method: '', unit: '' }),
          referenceRate: '',
        };
      }
      if (
        resource === 'fee-templates' &&
        next.method !== old.method &&
        feeDefaults[next.category]
      ) {
        return { ...next, unit: feeUnit(next.category, next.method), referenceRate: '' };
      }
      return next;
    });
    setValidationError('');
  };
  const catalog = useQuery({
    queryKey: ['property-setup', 'shared-catalog-picker', session?.userId],
    queryFn: ({ signal }) => api.publishedCatalog(signal),
    enabled: resource === 'asset-templates',
  });
  const fields: UtilityFieldDefinition[] =
    resource === 'room-type-templates'
      ? [
          { name: 'capacity', label: 'Sức chứa', type: 'number' },
          { name: 'area', label: 'Diện tích (m²)' },
          { name: 'referenceRent', label: 'Giá thuê tham khảo', optional: true },
        ]
      : resource === 'asset-catalog'
        ? [
            { name: 'category', label: 'Nhóm tài sản' },
            { name: 'unit', label: 'Đơn vị' },
            { name: 'referencePrice', label: 'Giá tham khảo' },
          ]
        : resource === 'fee-templates'
          ? [
              {
                name: 'category',
                label: 'Nhóm phí',
                options: [
                  { id: 'Rent', label: 'Tiền thuê' },
                  { id: 'Electricity', label: 'Điện' },
                  { id: 'Water', label: 'Nước' },
                  { id: 'ServiceFee', label: 'Dịch vụ' },
                ],
              },
              {
                name: 'scope',
                label: 'Phạm vi',
                options: [
                  { id: 'Location', label: 'Cơ sở' },
                  { id: 'Room', label: 'Phòng' },
                ],
              },
              {
                name: 'chargeCode',
                label: 'Mã khoản thu',
                disabled: values.category !== 'ServiceFee',
              },
              {
                name: 'method',
                label: 'Cách tính',
                options:
                  values.category === 'Electricity' || values.category === 'Water'
                    ? [{ id: 'Metered', label: 'Theo đồng hồ' }]
                    : [
                        { id: 'FixedPerRoomPerMonth', label: 'Cố định mỗi phòng/tháng' },
                        ...(values.category === 'ServiceFee'
                          ? [{ id: personMethod, label: 'Cố định mỗi người/tháng' }]
                          : []),
                      ],
                disabled: values.category !== 'ServiceFee',
              },
              { name: 'unit', label: 'Đơn vị', disabled: true },
              { name: 'referenceRate', label: 'Đơn giá tham khảo' },
              { name: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
              { name: 'effectiveTo', label: 'Hiệu lực đến', type: 'date', optional: true },
            ]
          : resource === 'policy-templates'
            ? [{ name: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' }]
            : [];
  function submit() {
    if (busy) return;
    if (resource === 'fee-templates') {
      const defaults = feeDefaults[values.category];
      const code = (values.chargeCode ?? '').trim().toUpperCase();
      if (
        !defaults ||
        (values.method !== defaults.method &&
          !(values.category === 'ServiceFee' && values.method === personMethod)) ||
        (values.category === 'ServiceFee'
          ? !/^[A-Z0-9_-]{1,80}$/.test(code) || ['RENT', 'ELECTRICITY', 'WATER'].includes(code)
          : code !== defaults.chargeCode)
      ) {
        setValidationError('Mã khoản thu hoặc cách tính không phù hợp với nhóm phí.');
        return;
      }
      if (
        !/^\d{1,14}(?:\.\d{1,4})?$/.test(values.referenceRate ?? '') ||
        !values.effectiveFrom ||
        (values.effectiveTo && values.effectiveTo < values.effectiveFrom)
      ) {
        setValidationError('Kiểm tra đơn giá và khoảng thời gian hiệu lực.');
        return;
      }
    }
    const data =
      resource === 'room-type-templates'
        ? {
            capacity: Number(values.capacity),
            area: values.area ?? '',
            amenities: (values.amenities ?? '')
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
            referenceRent: values.referenceRent || null,
          }
        : resource === 'asset-catalog'
          ? {
              category: values.category ?? '',
              unit: values.unit ?? '',
              referencePrice: values.referencePrice ?? '',
            }
          : resource === 'asset-templates'
            ? { items }
            : resource === 'fee-templates'
              ? {
                  category: values.category,
                  chargeCode: values.chargeCode.trim().toUpperCase(),
                  method: values.method,
                  referenceRate: values.referenceRate ?? '',
                  unit: feeUnit(values.category, values.method),
                  scope: values.scope as 'Location' | 'Room',
                  effectiveFrom: values.effectiveFrom ?? '',
                  effectiveTo: values.effectiveTo || null,
                }
              : { content: values.content ?? '', effectiveFrom: values.effectiveFrom ?? '' };
    save({ name, description, data, expectedVersion: document?.version ?? 0 });
  }
  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      slotProps={{ paper: { sx: configurationDialogPaperSx } }}
      onClose={busy ? undefined : close}
    >
      <DialogTitle id={`${titleId}-container`} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Typography id={titleId} component="span" variant="h2">
            {document ? `Sửa ${resourceNames[resource]}` : `Tạo ${resourceNames[resource]}`}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Chip size="small" label="Bản nháp" variant="outlined" />
            {document && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {document.name} · Phiên bản {document.edition} · Lần cập nhật {document.version}
              </Typography>
            )}
          </Stack>
        </Stack>
      </DialogTitle>
      <Box
        component="form"
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogContent dividers sx={configurationDialogContentSx}>
          <Stack spacing={1.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {validationError && <Alert severity="error">{validationError}</Alert>}
            <TextField
              required
              disabled={busy}
              label="Tên mẫu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              multiline
              disabled={busy}
              label="Mô tả"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {fields.length > 0 && (
              <Box
                sx={{
                  ...configurationFormGridSx,
                  pt: 1.5,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="h2" component="h3" sx={{ gridColumn: '1 / -1' }}>
                  Cấu hình mẫu
                </Typography>
                {fields.map((field) => (
                  <Fragment key={field.name}>
                    {resource === 'fee-templates' &&
                      field.name === 'chargeCode' &&
                      values.category === 'ServiceFee' && (
                        <TextField
                          select
                          disabled={busy}
                          label="Loại dịch vụ gợi ý"
                          value={
                            ['INTERNET', 'CLEANING', 'PARKING', 'MANAGEMENT'].includes(
                              values.chargeCode,
                            )
                              ? values.chargeCode
                              : ''
                          }
                          onChange={(e) =>
                            updateFields((old) => ({ ...old, chargeCode: e.target.value }))
                          }
                        >
                          <MenuItem value="">Dịch vụ khác / nhập mã riêng</MenuItem>
                          <MenuItem value="INTERNET">Internet</MenuItem>
                          <MenuItem value="CLEANING">Vệ sinh</MenuItem>
                          <MenuItem value="PARKING">Gửi xe</MenuItem>
                          <MenuItem value="MANAGEMENT">Quản lý tòa nhà</MenuItem>
                        </TextField>
                      )}
                    <Box
                      sx={{
                        minWidth: 0,
                        gridColumn:
                          ['referenceRent', 'referencePrice', 'referenceRate'].includes(
                            field.name,
                          ) ||
                          (field.name === 'chargeCode' && values.category !== 'ServiceFee')
                            ? '1 / -1'
                            : undefined,
                      }}
                    >
                      {['referenceRent', 'referencePrice', 'referenceRate'].includes(field.name) ? (
                        <MoneyField
                          label={field.label}
                          disabled={busy}
                          required={!field.optional}
                          value={values[field.name] ?? ''}
                          allowDecimal
                          onValueChange={(raw) =>
                            updateFields((old) => ({ ...old, [field.name]: raw }))
                          }
                        />
                      ) : (
                        <UtilityField
                          field={{ ...field, disabled: busy || field.disabled }}
                          values={values}
                          setValues={updateFields}
                        />
                      )}
                    </Box>
                  </Fragment>
                ))}
              </Box>
            )}
            {resource === 'fee-templates' && values.category === 'ServiceFee' && (
              <Typography variant="caption" color="text.secondary">
                Mỗi dịch vụ cần mã riêng. Đơn giá đã ký được giữ nguyên trong hợp đồng.
              </Typography>
            )}
            {resource === 'room-type-templates' && (
              <>
                <TextField
                  multiline
                  disabled={busy}
                  label="Tiện ích (mỗi dòng một mục)"
                  value={values.amenities ?? ''}
                  onChange={(e) => setValues((old) => ({ ...old, amenities: e.target.value }))}
                />
                <Typography variant="caption" color="text.secondary">
                  Giá trị gợi ý không tự thay đổi phòng hoặc giá hợp đồng hiện có.
                </Typography>
              </>
            )}
            {resource === 'policy-templates' && (
              <TextField
                required
                disabled={busy}
                multiline
                minRows={6}
                label="Nội dung nội quy"
                value={values.content ?? ''}
                onChange={(e) => setValues((old) => ({ ...old, content: e.target.value }))}
              />
            )}
            {resource === 'asset-templates' && (
              <>
                <Typography
                  variant="h2"
                  component="h3"
                  sx={{ pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
                >
                  Tài sản trong mẫu · {items.length} loại
                </Typography>
                {catalog.isPending && <LoadingState />}
                {catalog.isError && (
                  <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />
                )}
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { sm: 'center' } }}
                >
                  <TextField
                    select
                    disabled={busy || catalog.isPending || catalog.isError}
                    label="Tài sản trong danh mục"
                    value={catalogId}
                    onChange={(e) => setCatalogId(e.target.value)}
                  >
                    <MenuItem value="">Chọn</MenuItem>
                    {catalog.data?.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name} · phiên bản {item.edition}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    disabled={!catalogId || busy}
                    onClick={() => {
                      const selected = catalog.data?.find((d) => d.id === catalogId);
                      if (!selected) return;
                      setItems((old) => [
                        ...old,
                        {
                          catalogId: selected.id,
                          catalogVersion: selected.version,
                          quantity: 1,
                          required: true,
                          trackingMode: 'Serialized',
                          catalog: {
                            ...(selected.data as AssetCatalogData),
                            familyId: selected.familyId,
                            edition: selected.edition,
                            name: selected.name,
                          },
                        },
                      ]);
                      setCatalogId('');
                    }}
                  >
                    Thêm vào gói
                  </Button>
                </Stack>
                {!items.length && (
                  <Typography variant="body2" color="text.secondary">
                    Chọn tài sản đã công bố để thêm vào mẫu.
                  </Typography>
                )}
                {items.map((item, index) => (
                  <Stack
                    key={`${item.catalogId}-${index}`}
                    spacing={1}
                    sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                      {item.catalog?.name ??
                        catalog.data?.find((d) => d.id === item.catalogId)?.name ??
                        'Mục danh mục đã chọn'}
                    </Typography>
                    {item.catalog && (
                      <Typography variant="caption" color="text.secondary">
                        Phiên bản {item.catalog.edition} · Lần cập nhật {item.catalogVersion}
                      </Typography>
                    )}
                    <Box sx={configurationFormGridSx}>
                      <TextField
                        required
                        disabled={busy}
                        type="number"
                        label={`Số lượng mục ${index + 1}`}
                        value={item.quantity}
                        slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                        onChange={(e) =>
                          setItems((old) =>
                            old.map((v, i) =>
                              i === index ? { ...v, quantity: Number(e.target.value) } : v,
                            ),
                          )
                        }
                      />
                      <TextField
                        select
                        disabled={busy}
                        label={`Theo dõi mục ${index + 1}`}
                        value={item.trackingMode}
                        onChange={(e) =>
                          setItems((old) =>
                            old.map((v, i) =>
                              i === index
                                ? {
                                    ...v,
                                    trackingMode: e.target.value as SharedAssetItem['trackingMode'],
                                  }
                                : v,
                            ),
                          )
                        }
                      >
                        <MenuItem value="Serialized">Từng tài sản</MenuItem>
                        <MenuItem value="BulkQuantity">Theo số lượng</MenuItem>
                      </TextField>
                    </Box>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                      }}
                    >
                      <FormControlLabel
                        label="Bắt buộc"
                        control={
                          <Checkbox
                            disabled={busy}
                            checked={item.required}
                            onChange={(e) =>
                              setItems((old) =>
                                old.map((v, i) =>
                                  i === index ? { ...v, required: e.target.checked } : v,
                                ),
                              )
                            }
                          />
                        }
                      />
                      <Button
                        disabled={busy}
                        onClick={() => setItems((old) => old.filter((_, i) => i !== index))}
                      >
                        Xóa mục {index + 1}
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          <Button disabled={busy} onClick={close}>
            Hủy
          </Button>
          <Button
            disabled={
              busy || (resource === 'asset-templates' && (catalog.isError || !items.length))
            }
            type="submit"
            variant="contained"
          >
            Lưu bản nháp
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
