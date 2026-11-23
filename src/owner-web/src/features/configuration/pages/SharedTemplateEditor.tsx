import { TextField, ValidatedForm } from '../../../components/common/ValidatedForm';
import { Fragment, useId, useState } from 'react';
import { lifecycleCategories } from '../../../../../../packages/client-core/src/assetLifecycle';
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
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ASSET_UNITS } from '../../../../../../packages/client-core/src/assetUnits';
import {
  assetCatalogSupportsScope,
  sharedFeeServiceName,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import type {
  AssetCatalogData,
  FeeTemplateData,
  RoomTemplateData,
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

type EditableSharedResource = Exclude<SharedResource, 'asset-templates'>;

const resourceNames: Record<EditableSharedResource, string> = {
  'room-type-templates': 'loại phòng mẫu',
  'asset-catalog': 'loại tài sản',
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
const suggestedServiceTypes = [
  { name: 'Internet', chargeCode: 'DV_I' },
  { name: 'Wifi', chargeCode: 'DV_W' },
  { name: 'Vệ sinh', chargeCode: 'DV_VS' },
  { name: 'Gửi xe', chargeCode: 'DV_GX' },
  { name: 'Quản lý tòa nhà', chargeCode: 'DV_QLTN' },
];
const serviceNameKey = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const suggestedServiceChargeCode = (name: string) => {
  const ascii = name
    .replace(/[đĐ]/g, (letter) => (letter === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const initials = ascii
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return `DV_${initials || 'CUSTOM'}`;
};
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
  setupCreation = false,
  assetScope = 'Room',
}: {
  resource: EditableSharedResource;
  document: SharedDocument | null;
  busy: boolean;
  error: string;
  close: () => void;
  save: (input: SharedWrite) => void;
  setupCreation?: boolean;
  assetScope?: 'Room' | 'Location';
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
            category: setupCreation ? 'ServiceFee' : 'Rent',
            method: 'FixedPerRoomPerMonth',
            chargeCode: setupCreation ? '' : 'RENT',
            unit: 'VND/month',
          }
        : resource === 'asset-catalog'
          ? { category: 'Khác', unit: 'Cái', scope: document ? 'Both' : assetScope }
          : {};
    if (document)
      for (const [key, value] of Object.entries(document.data))
        result[key] = Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);
    if (resource === 'fee-templates' && result.category === 'ServiceFee' && !result.serviceName)
      result.serviceName = sharedFeeServiceName(
        { chargeCode: result.chargeCode ?? '', serviceName: result.serviceName ?? null },
        document?.name ?? '',
      );
    if (resource === 'asset-catalog' && !result.scope) result.scope = 'Both';
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
    resource === 'room-type-templates'
      ? ((document?.data as RoomTemplateData | undefined)?.assetItems ?? []).map((item) => ({
          ...item,
          required: true,
        }))
      : [],
  );
  const [catalogSearch, setCatalogSearch] = useState('');
  const [serviceTypeChoice, setServiceTypeChoice] = useState(() => {
    if (resource !== 'fee-templates' || !document || !('referenceRate' in document.data)) return '';
    return document.data.category === 'ServiceFee' ? document.data.chargeCode : '';
  });
  const [validationError, setValidationError] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const normalizedName = name.normalize('NFC').trim().replace(/\s+/g, ' ');
  const duplicateName = error.startsWith('Tên mẫu đã tồn tại.') && submittedName === normalizedName;
  const updateFields: typeof setValues = (update) => {
    setValues((old) => {
      const next = typeof update === 'function' ? update(old) : update;
      if (resource === 'fee-templates' && next.category !== old.category) {
        return {
          ...next,
          ...(feeDefaults[next.category] ?? { chargeCode: '', method: '', unit: '' }),
          serviceName: '',
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
  const setEditorFields: typeof setValues = (update) => {
    const next = typeof update === 'function' ? update(values) : update;
    if (next.category !== values.category) setServiceTypeChoice('');
    updateFields(next);
  };
  const catalog = useQuery({
    queryKey: ['property-setup', 'shared-catalog-picker', session?.userId],
    queryFn: ({ signal }) => api.publishedCatalog(signal),
    enabled: resource === 'room-type-templates',
  });
  const savedServiceTypes = useQuery({
    queryKey: ['property-setup', 'saved-service-types', session?.userId],
    queryFn: async ({ signal }) => {
      const documents: SharedDocument[] = [];
      for (let page = 1; ; page++) {
        // Service identity survives Draft/Published/Archived transitions and old editions;
        // load every edition so the preview uses the same existing code as the server.
        const result = await api.list('fee-templates', '', '', page, 100, signal, false);
        documents.push(...result.items);
        if (documents.length >= result.total) return documents;
        if (!result.items.length)
          throw new Error('Danh mục dịch vụ đã thay đổi. Vui lòng tải lại.');
      }
    },
    enabled: resource === 'fee-templates',
  });
  const currentServiceType =
    document && 'referenceRate' in document.data && document.data.category === 'ServiceFee'
      ? [
          {
            name: sharedFeeServiceName(document.data, document.name),
            chargeCode: document.data.chargeCode,
          },
        ]
      : [];
  const existingServiceCode = currentServiceType[0]?.chargeCode;
  const serviceTypeOptions = [
    ...currentServiceType,
    ...(savedServiceTypes.data ?? [])
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .flatMap((item) => {
        if (!('referenceRate' in item.data) || item.data.category !== 'ServiceFee') return [];
        const data = item.data as FeeTemplateData;
        return [
          {
            name: sharedFeeServiceName(data, item.name),
            chargeCode: data.chargeCode,
          },
        ];
      }),
    ...suggestedServiceTypes,
  ].filter(
    (option, index, options) =>
      options.findIndex(
        (candidate) => serviceNameKey(candidate.name) === serviceNameKey(option.name),
      ) === index,
  );
  const roomCatalogItems = (catalog.data ?? []).filter((item) =>
    assetCatalogSupportsScope(item.data as AssetCatalogData, 'Room'),
  );
  const filteredRoomCatalogItems = roomCatalogItems.filter((item) =>
    item.name.toLocaleLowerCase('vi').includes(catalogSearch.trim().toLocaleLowerCase('vi')),
  );
  const toggleRoomAsset = (catalogItemId: string, checked: boolean) => {
    const selected = roomCatalogItems.find((item) => item.id === catalogItemId);
    if (!selected) return;
    if (!checked) {
      setItems((old) =>
        old.filter(
          (item) =>
            item.catalogId !== selected.id && item.catalog?.familyId !== selected.familyId,
        ),
      );
      return;
    }
    setItems((old) => {
      if (
        old.some(
          (item) =>
            item.catalogId === selected.id || item.catalog?.familyId === selected.familyId,
        )
      )
        return old;
      return [
        ...old,
        {
          catalogId: selected.id,
          catalogVersion: selected.version,
          quantity: 1,
          required: true,
          trackingMode: 'BulkQuantity',
          catalog: {
            ...(selected.data as AssetCatalogData),
            familyId: selected.familyId,
            edition: selected.edition,
            name: selected.name,
          },
        },
      ];
    });
  };
  const fields: UtilityFieldDefinition[] =
    resource === 'room-type-templates'
      ? [
          { name: 'capacity', label: 'Sức chứa', type: 'number' },
          { name: 'area', label: 'Diện tích (m²)' },
          { name: 'referenceRent', label: 'Giá thuê tham khảo', optional: true },
        ]
      : resource === 'asset-catalog'
        ? [
            {
              name: 'category',
              label: 'Nhóm tài sản',
              options: [
                ...new Set([
                  ...lifecycleCategories.map((item) => item.value),
                  ...(values.category ? [values.category] : []),
                ]),
              ].map((value) => ({
                id: value,
                label: lifecycleCategories.find((item) => item.value === value)?.label ?? value,
              })),
            },
            {
              name: 'scope',
              label: 'Phạm vi tài sản',
              options: [
                { id: 'Room', label: 'Tài sản theo phòng' },
                { id: 'Location', label: 'Tài sản chung của cơ sở' },
                ...(values.scope === 'Both' ? [{ id: 'Both', label: 'Cả hai (mẫu hiện có)' }] : []),
              ],
            },
            {
              name: 'unit',
              label: 'Đơn vị',
              options: [...new Set([...ASSET_UNITS, ...(values.unit ? [values.unit] : [])])].map(
                (unit) => ({ id: unit, label: unit }),
              ),
            },
            { name: 'referencePrice', label: 'Giá tham khảo' },
          ]
        : resource === 'fee-templates'
          ? [
              {
                name: 'category',
                label: 'Nhóm phí',
                options: [
                  ...(!setupCreation ? [{ id: 'Rent', label: 'Tiền thuê' }] : []),
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
                label: 'Mã khoản thu (tự sinh)',
                disabled: true,
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
    if (!normalizedName) {
      setValidationError('Vui lòng nhập tên mẫu.');
      return;
    }
    if (resource === 'fee-templates') {
      const defaults = feeDefaults[values.category];
      const code = (values.chargeCode ?? '').trim().toUpperCase();
      const serviceName = (values.serviceName ?? '').trim();
      if (
        !defaults ||
        (values.method !== defaults.method &&
          !(values.category === 'ServiceFee' && values.method === personMethod)) ||
        (values.category === 'ServiceFee'
          ? !serviceName ||
            !/^[A-Z0-9_-]{1,80}$/.test(code) ||
            ['RENT', 'ELECTRICITY', 'WATER'].includes(code)
          : code !== defaults.chargeCode)
      ) {
        setValidationError(
          values.category === 'ServiceFee' && !serviceName
            ? 'Vui lòng nhập tên loại dịch vụ.'
            : 'Mã khoản thu hoặc cách tính không phù hợp với nhóm phí.',
        );
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
            assetItems: items.map((item) => ({ ...item, required: true })),
          }
        : resource === 'asset-catalog'
          ? {
              category: values.category || 'Khác',
              unit: values.unit ?? '',
              referencePrice: values.referencePrice ?? '',
              scope: values.scope as AssetCatalogData['scope'],
            }
          : resource === 'fee-templates'
            ? {
                  category: values.category,
                  chargeCode: values.chargeCode.trim().toUpperCase(),
                  ...(values.category === 'ServiceFee' ? { serviceName: values.serviceName.trim() } : {}),
                  method: values.method,
                  referenceRate: values.referenceRate ?? '',
                  unit: feeUnit(values.category, values.method),
                  scope: values.scope as 'Location' | 'Room',
                  effectiveFrom: values.effectiveFrom ?? '',
                  effectiveTo: values.effectiveTo || null,
                }
              : { content: values.content ?? '', effectiveFrom: values.effectiveFrom ?? '' };
    setSubmittedName(normalizedName);
    save({ name: normalizedName, description, data, expectedVersion: document?.version ?? 0 });
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
            <Chip
              size="small"
              label={document?.status === 'Draft' ? 'Bản nháp' : 'Thư viện dùng chung'}
              variant="outlined"
            />
            {document && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {document.name}
              </Typography>
            )}
          </Stack>
        </Stack>
      </DialogTitle>
      <Box
        component={ValidatedForm}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogContent dividers sx={configurationDialogContentSx}>
          <Stack spacing={1.5}>
            {error && !error.startsWith('Tên mẫu đã tồn tại.') && (
              <Alert severity="error">{error}</Alert>
            )}
            {validationError && <Alert severity="error">{validationError}</Alert>}
            {setupCreation && (
              <Typography variant="body2" color="text.secondary">
                Mẫu được lưu vào thư viện dùng chung và có thể áp dụng ngay tại cơ sở đang thiết
                lập.
              </Typography>
            )}
            {document?.status === 'Published' && (
              <Typography variant="body2" color="text.secondary">
                Khi chỉnh sửa mẫu, cấu hình tại các cơ sở đã áp dụng vẫn được giữ nguyên. Bạn có thể
                áp dụng nội dung mới cho cơ sở khi cần.
              </Typography>
            )}
            <TextField
              required
              disabled={busy}
              label="Tên mẫu"
              value={name}
              error={duplicateName}
              helperText={duplicateName ? error : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setValidationError('');
              }}
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
                    <Box
                      sx={{
                        minWidth: 0,
                        gridColumn:
                          ['referenceRent', 'referencePrice', 'referenceRate'].includes(
                            field.name,
                          ) ||
                          field.name === 'chargeCode'
                            ? '1 / -1'
                            : undefined,
                      }}
                    >
                      {resource === 'fee-templates' &&
                      field.name === 'chargeCode' &&
                      values.category === 'ServiceFee' ? (
                        <Stack spacing={1.25}>
                          <TextField
                            select
                            disabled={busy || savedServiceTypes.isFetching}
                            label="Loại dịch vụ gợi ý"
                            value={serviceTypeChoice || values.chargeCode || ''}
                            onChange={(event) => {
                              const choice = event.target.value;
                              if (choice === '__custom__') {
                                setServiceTypeChoice('__custom__');
                                updateFields((old) => ({
                                  ...old,
                                  serviceName: '',
                                  chargeCode: existingServiceCode ?? '',
                                }));
                                return;
                              }
                              const selected = serviceTypeOptions.find(
                                (option) => option.chargeCode === choice,
                              );
                              setServiceTypeChoice(choice);
                              updateFields((old) => ({
                                ...old,
                                serviceName: selected?.name ?? '',
                                chargeCode: existingServiceCode ?? selected?.chargeCode ?? '',
                              }));
                            }}
                          >
                            <MenuItem value="">Chọn loại dịch vụ</MenuItem>
                            {serviceTypeOptions.map((option) => (
                              <MenuItem key={option.chargeCode} value={option.chargeCode}>
                                {option.name}
                              </MenuItem>
                            ))}
                            <MenuItem value="__custom__">Khác – thêm loại dịch vụ mới</MenuItem>
                          </TextField>
                          {serviceTypeChoice === '__custom__' && (
                            <TextField
                              required
                              disabled={busy}
                              label="Tên dịch vụ mới"
                              value={values.serviceName ?? ''}
                              onChange={(event) => {
                                const enteredName = event.target.value;
                                const existing = serviceTypeOptions.find(
                                  (option) => serviceNameKey(option.name) === serviceNameKey(enteredName),
                                );
                                updateFields((old) => ({
                                  ...old,
                                  serviceName: enteredName,
                                  chargeCode:
                                    existingServiceCode ??
                                    existing?.chargeCode ??
                                    suggestedServiceChargeCode(enteredName),
                                }));
                              }}
                              slotProps={{ htmlInput: { maxLength: 80 } }}
                              helperText="Tên này được lưu để dùng lại trong các mẫu biểu phí sau."
                            />
                          )}
                          <TextField
                            disabled={busy}
                            label="Mã khoản thu (tự sinh)"
                            value={values.chargeCode ?? ''}
                            slotProps={{ input: { readOnly: true } }}
                            helperText="Mã được tạo từ chữ cái đầu; máy chủ tự thêm hậu tố nếu bị trùng."
                          />
                          {savedServiceTypes.isError && (
                            <Alert severity="warning">
                              Chưa tải được các loại dịch vụ đã lưu. Bạn vẫn có thể chọn loại gợi ý có sẵn.
                            </Alert>
                          )}
                        </Stack>
                      ) : ['referenceRent', 'referencePrice', 'referenceRate'].includes(field.name) ? (
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
                          setValues={setEditorFields}
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
            {resource === 'room-type-templates' && (
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
                <TextField
                  disabled={busy || catalog.isPending || catalog.isError}
                  label="Tìm tài sản trong danh mục"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  size="small"
                />
                <Box
                  role="group"
                  aria-label="Danh mục tài sản theo phòng"
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {filteredRoomCatalogItems.length ? (
                    <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
                      {filteredRoomCatalogItems.map((item) => {
                        const selected = items.some(
                          (value) =>
                            value.catalogId === item.id || value.catalog?.familyId === item.familyId,
                        );
                        const data = item.data as AssetCatalogData;
                        return (
                          <FormControlLabel
                            key={item.id}
                            disabled={busy}
                            sx={{ m: 0, py: 0.5, alignItems: 'center' }}
                            control={
                              <Checkbox
                                checked={selected}
                                onChange={(event) => toggleRoomAsset(item.id, event.target.checked)}
                              />
                            }
                            label={
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {item.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {data.unit} · {data.referencePrice ? `${data.referencePrice} đ/${data.unit}` : 'Chưa có giá tham khảo'}
                                </Typography>
                              </Box>
                            }
                          />
                        );
                      })}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      {roomCatalogItems.length
                        ? 'Không tìm thấy tài sản phù hợp.'
                        : 'Chưa có tài sản mẫu theo phòng được công bố.'}
                    </Typography>
                  )}
                </Box>
                {!items.length && (
                  <Typography variant="body2" color="text.secondary">
                    Chọn tài sản có thể áp dụng để thêm vào mẫu.
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
                    <Box sx={configurationFormGridSx}>
                      <TextField
                        required
                        disabled={busy}
                        type="number"
                        label={`Số lượng ${item.catalog?.name ?? `mục ${index + 1}`}`}
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
                        label="Đơn vị"
                        value={item.catalog?.unit ?? 'Chưa ghi nhận'}
                        slotProps={{ input: { readOnly: true } }}
                      />
                    </Box>
                    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
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
            disabled={busy}
            type="submit"
            variant="contained"
          >
            Lưu mẫu
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
