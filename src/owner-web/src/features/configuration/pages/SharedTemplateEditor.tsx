import { useState } from 'react';
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

const feeDefaults: Record<string, { chargeCode: string; method: string; unit: string }> = {
  Rent: { chargeCode: 'RENT', method: 'FixedPerRoomPerMonth', unit: 'VND/month' },
  Electricity: { chargeCode: 'ELECTRICITY', method: 'Metered', unit: 'kWh' },
  Water: { chargeCode: 'WATER', method: 'Metered', unit: 'm³' },
  ServiceFee: { chargeCode: '', method: 'FixedPerRoomPerMonth', unit: 'VND/month' },
};

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
      result.method = defaults.method;
      result.unit = defaults.unit;
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
        return { ...next, ...(feeDefaults[next.category] ?? { chargeCode: '', method: '', unit: '' }), referenceRate: '' };
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
              { name: 'chargeCode', label: 'Mã khoản thu', disabled: values.category !== 'ServiceFee' },
              {
                name: 'method',
                label: 'Cách tính',
                options: values.category === 'Electricity' || values.category === 'Water'
                  ? [{ id: 'Metered', label: 'Theo đồng hồ' }]
                  : [{ id: 'FixedPerRoomPerMonth', label: 'Cố định mỗi phòng/tháng' }],
                disabled: true,
              },
              { name: 'referenceRate', label: 'Đơn giá tham khảo' },
              { name: 'unit', label: 'Đơn vị', disabled: true },
              {
                name: 'scope',
                label: 'Phạm vi',
                options: [
                  { id: 'Location', label: 'Cơ sở' },
                  { id: 'Room', label: 'Phòng' },
                ],
              },
              { name: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
              { name: 'effectiveTo', label: 'Hiệu lực đến', type: 'date', optional: true },
            ]
          : resource === 'policy-templates'
            ? [{ name: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' }]
            : [];
  function submit() {
    if (resource === 'fee-templates') {
      const defaults = feeDefaults[values.category];
      const code = (values.chargeCode ?? '').trim().toUpperCase();
      if (!defaults || values.method !== defaults.method ||
          (values.category === 'ServiceFee'
            ? !/^[A-Z0-9_-]{1,80}$/.test(code) || ['RENT', 'ELECTRICITY', 'WATER'].includes(code)
            : code !== defaults.chargeCode)) {
        setValidationError('Mã khoản thu hoặc cách tính không phù hợp với nhóm phí.');
        return;
      }
      if (!values.referenceRate?.trim() || !Number.isFinite(Number(values.referenceRate)) || Number(values.referenceRate) < 0 ||
          !values.effectiveFrom || (values.effectiveTo && values.effectiveTo < values.effectiveFrom)) {
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
                  unit: feeDefaults[values.category].unit,
                  scope: values.scope as 'Location' | 'Room',
                  effectiveFrom: values.effectiveFrom ?? '',
                  effectiveTo: values.effectiveTo || null,
                }
              : { content: values.content ?? '', effectiveFrom: values.effectiveFrom ?? '' };
    save({ name, description, data, expectedVersion: document?.version ?? 0 });
  }
  return (
    <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : close}>
      <DialogTitle>{document ? 'Sửa bản nháp' : 'Tạo mẫu dùng chung'}</DialogTitle>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {validationError && <Alert severity="error">{validationError}</Alert>}
            <TextField
              required
              label="Tên mẫu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              multiline
              label="Mô tả"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {fields.map((field) => (
              <Stack key={field.name} spacing={1}>
                {resource === 'fee-templates' && field.name === 'chargeCode' && values.category === 'ServiceFee' && (
                  <TextField select label="Loại dịch vụ gợi ý" value={['INTERNET', 'CLEANING', 'PARKING', 'MANAGEMENT'].includes(values.chargeCode) ? values.chargeCode : ''}
                    onChange={(e) => updateFields((old) => ({ ...old, chargeCode: e.target.value }))}>
                    <MenuItem value="">Dịch vụ khác / nhập mã riêng</MenuItem>
                    <MenuItem value="INTERNET">Internet</MenuItem>
                    <MenuItem value="CLEANING">Vệ sinh</MenuItem>
                    <MenuItem value="PARKING">Gửi xe</MenuItem>
                    <MenuItem value="MANAGEMENT">Quản lý tòa nhà</MenuItem>
                  </TextField>
                )}
                <UtilityField field={field} values={values} setValues={updateFields} />
              </Stack>
            ))}
            {resource === 'fee-templates' && values.category === 'ServiceFee' && (
              <Alert severity="info">Nhập mã riêng cho từng dịch vụ, ví dụ INTERNET, CLEANING hoặc PARKING. Hiện hỗ trợ phí cố định theo phòng/tháng.</Alert>
            )}
            {resource === 'room-type-templates' && (
              <>
                <TextField
                  multiline
                  label="Tiện ích (mỗi dòng một mục)"
                  value={values.amenities ?? ''}
                  onChange={(e) => setValues((old) => ({ ...old, amenities: e.target.value }))}
                />
                <Alert severity="info">
                  Mẫu lưu các giá trị gợi ý. Tạo phòng và xác nhận giá áp dụng là các bước riêng.
                </Alert>
              </>
            )}
            {resource === 'policy-templates' && (
              <TextField
                required
                multiline
                minRows={6}
                label="Nội dung nội quy"
                value={values.content ?? ''}
                onChange={(e) => setValues((old) => ({ ...old, content: e.target.value }))}
              />
            )}
            {resource === 'asset-templates' && (
              <>
                {catalog.isPending && <LoadingState />}
                {catalog.isError && (
                  <ErrorState error={catalog.error} retry={() => void catalog.refetch()} />
                )}
                <TextField
                  select
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
                {items.map((item, index) => (
                  <Stack key={`${item.catalogId}-${index}`} spacing={1}>
                    <Typography>
                      {item.catalog?.name ??
                        catalog.data?.find((d) => d.id === item.catalogId)?.name ??
                        'Mục danh mục đã chọn'}
                    </Typography>
                    <TextField
                      required
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
                    <FormControlLabel
                      label="Bắt buộc"
                      control={
                        <Checkbox
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
                    <Button onClick={() => setItems((old) => old.filter((_, i) => i !== index))}>
                      Xóa mục {index + 1}
                    </Button>
                  </Stack>
                ))}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
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
      </form>
    </Dialog>
  );
}
