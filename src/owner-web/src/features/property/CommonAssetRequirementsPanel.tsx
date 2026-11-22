import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { ASSET_UNITS } from '../../../../../packages/client-core/src/assetUnits';
import {
  locationSetupClient,
  type SetupCommonAssetRequirement,
} from '../../../../../packages/client-core/src/locationSetup';
import {
  assetCatalogSupportsScope,
  sharedConfigurationClient,
  type AssetCatalogData,
} from '../../../../../packages/client-core/src/sharedConfiguration';
import { ConfirmDialog, ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';
import { ConflictReload } from '../locations/components/ConflictReload';

type CommonItem = SetupCommonAssetRequirement;

const newItem = (): CommonItem => ({
  id: crypto.randomUUID(),
  name: '',
  category: 'Khác',
  commonArea: '',
  trackingMode: 'BulkQuantity',
  quantity: 1,
  unit: 'Cái',
});

export function CommonAssetRequirementsPanel({ locationId }: { locationId: string }) {
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const { request } = usePropertySetupApi();
  const api = locationSetupClient(request);
  const library = sharedConfigurationClient(request);
  const query = useQuery({
    queryKey: ['property-setup', 'common-asset-requirements', session?.userId, locationId],
    queryFn: ({ signal }) => api.commonAssetRequirements(locationId, signal),
    enabled: owner,
  });
  const catalog = useQuery({
    queryKey: ['property-setup', 'shared-catalog-picker', session?.userId],
    queryFn: ({ signal }) => library.publishedCatalog(signal),
    enabled: owner,
  });
  const action = useSetupAction();
  const [edit, setEdit] = useState<{
    item: CommonItem;
    version: number;
    items: CommonItem[];
  } | null>(null);
  const [remove, setRemove] = useState<{
    item: CommonItem;
    version: number;
    items: CommonItem[];
  } | null>(null);
  const [catalogId, setCatalogId] = useState('');
  if (!owner) return <Alert severity="info">Chỉ Owner được cấu hình tài sản chung cơ sở.</Alert>;
  if (query.isPending) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const items = query.data?.data.items ?? [];
  const version = query.data?.version ?? 0;
  const catalogItems = (catalog.data ?? []).filter((doc) =>
    assetCatalogSupportsScope(doc.data as AssetCatalogData, 'Location'),
  );
  const change = (changes: Partial<CommonItem>) =>
    setEdit((previous) =>
      previous ? { ...previous, item: { ...previous.item, ...changes } } : previous,
    );
  const open = (item: CommonItem) => {
    setCatalogId('');
    setEdit({ item: { ...item }, version, items });
  };
  const valid =
    edit &&
    edit.item.name.trim() &&
    edit.item.commonArea.trim() &&
    edit.item.category.trim() &&
    edit.item.unit?.trim() &&
    Number.isInteger(edit.item.quantity) &&
    edit.item.quantity >= 1 &&
    edit.item.quantity <= 10000;
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1 }}
      >
        <Box>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
            Tài sản chung cơ sở
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Thiết bị dự kiến dùng chung tại cơ sở, không nhân theo số phòng.
          </Typography>
        </Box>
        <Button
          variant="contained"
          disabled={action.busy || query.isFetching || items.length >= 100}
          onClick={() => open(newItem())}
        >
          Thêm tài sản chung
        </Button>
      </Stack>
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      {action.error && !edit && !remove && <Alert severity="error">{action.error}</Alert>}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Tài sản chung cơ sở" sx={{ minWidth: 580 }}>
          <TableHead>
            <TableRow>
              <TableCell>Tài sản</TableCell>
              <TableCell>Khu vực</TableCell>
              <TableCell align="right">Số lượng</TableCell>
              <TableCell>Đơn vị</TableCell>
              <TableCell align="right">Thao tác</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {item.name}
                </TableCell>
                <TableCell>{item.commonArea}</TableCell>
                <TableCell align="right">{item.quantity}</TableCell>
                <TableCell>{item.unit || 'Chưa ghi nhận'}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 0.5 }}>
                    <Button
                      disabled={action.busy || query.isFetching}
                      onClick={() => open(item)}
                      aria-label={`Sửa ${item.name}`}
                    >
                      Sửa
                    </Button>
                    <Button
                      color="error"
                      disabled={action.busy || query.isFetching}
                      onClick={() => setRemove({ item, version, items })}
                      aria-label={`Bỏ ${item.name}`}
                    >
                      Bỏ
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!items.length && (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                  Chưa cấu hình tài sản chung. Thêm thiết bị theo khu vực sử dụng.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        Cấu hình không tự tạo, thay đổi hoặc xóa tài sản thực tế.
      </Typography>
      {edit && (
        <Dialog
          open
          fullWidth
          maxWidth="sm"
          aria-labelledby="common-asset-title"
          onClose={action.busy ? undefined : () => setEdit(null)}
        >
          <DialogTitle id="common-asset-title">
            {edit.items.some((item) => item.id === edit.item.id)
              ? 'Sửa tài sản chung'
              : 'Thêm tài sản chung'}
          </DialogTitle>
          <Box
            component={ValidatedForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid || action.busy) return;
              const item = {
                ...edit.item,
                name: edit.item.name.trim(),
                commonArea: edit.item.commonArea.trim(),
              };
              const next = edit.items.some((row) => row.id === item.id)
                ? edit.items.map((row) => (row.id === item.id ? item : row))
                : [...edit.items, item];
              action.run(async () => {
                await api.saveCommonAssetRequirements(locationId, {
                  items: next,
                  expectedVersion: edit.version,
                });
                setEdit(null);
              }, 'Đã lưu tài sản chung cơ sở.');
            }}
          >
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 0.5 }}>
                <TextField
                  select
                  label="Chọn từ tài sản mẫu (không bắt buộc)"
                  value={catalogId}
                  disabled={action.busy || catalog.isPending || !!catalog.error}
                  onChange={(event) => {
                    setCatalogId(event.target.value);
                    const selected = catalogItems.find((doc) => doc.id === event.target.value);
                    if (selected) {
                      const data = selected.data as AssetCatalogData;
                      change({ name: selected.name, category: data.category, unit: data.unit });
                    }
                  }}
                >
                  <MenuItem value="">Nhập tài sản riêng</MenuItem>
                  {catalogItems.map((doc) => (
                    <MenuItem key={doc.id} value={doc.id}>
                      {doc.name}
                    </MenuItem>
                  ))}
                </TextField>
                {catalog.error && (
                  <Alert
                    severity="warning"
                    action={<Button onClick={() => void catalog.refetch()}>Thử lại</Button>}
                  >
                    Chưa tải được tài sản mẫu. Có thể nhập thông tin riêng.
                  </Alert>
                )}
                <TextField
                  required
                  label="Tên tài sản"
                  value={edit.item.name}
                  disabled={action.busy}
                  onChange={(event) => change({ name: event.target.value })}
                  slotProps={{ htmlInput: { maxLength: 150 } }}
                />
                <TextField
                  required
                  label="Khu vực sử dụng"
                  value={edit.item.commonArea}
                  disabled={action.busy}
                  onChange={(event) => change({ commonArea: event.target.value })}
                  placeholder="Ví dụ: Hành lang tầng 1"
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                  }}
                >
                  <TextField
                    required
                    type="number"
                    label="Số lượng"
                    value={edit.item.quantity || ''}
                    disabled={action.busy}
                    onChange={(event) => change({ quantity: Number(event.target.value) })}
                    slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                  />
                  <TextField
                    required
                    select
                    label="Đơn vị"
                    value={edit.item.unit ?? ''}
                    disabled={action.busy}
                    onChange={(event) => change({ unit: event.target.value })}
                  >
                    {[
                      ...new Set([...ASSET_UNITS, ...(edit.item.unit ? [edit.item.unit] : [])]),
                    ].map((unit) => (
                      <MenuItem key={unit} value={unit}>
                        {unit}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                {action.error && <Alert severity="error">{action.error}</Alert>}
                <ConflictReload
                  error={action.rawError}
                  reload={async () => {
                    await query.refetch({ throwOnError: true });
                    setEdit(null);
                  }}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={action.busy} onClick={() => setEdit(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="contained" disabled={!valid || action.busy}>
                Lưu tài sản chung
              </Button>
            </DialogActions>
          </Box>
        </Dialog>
      )}
      {remove && (
        <ConfirmDialog
          open
          title={`Bỏ ${remove.item.name} khỏi cấu hình?`}
          busy={action.busy}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            action.run(async () => {
              await api.saveCommonAssetRequirements(locationId, {
                items: remove.items.filter((item) => item.id !== remove.item.id),
                expectedVersion: remove.version,
              });
              setRemove(null);
            }, 'Đã bỏ tài sản khỏi cấu hình chung.')
          }
        >
          Chỉ bỏ mục cấu hình tại {remove.item.commonArea}. Tài sản thực tế và lịch sử không bị xóa.
          {action.error && <Alert severity="error">{action.error}</Alert>}
        </ConfirmDialog>
      )}
    </Stack>
  );
}
