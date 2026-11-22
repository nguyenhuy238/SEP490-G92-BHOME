import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import { AssetLifecyclePanel } from './AssetLifecyclePanel';
import { ASSET_UNITS } from '../../../../../packages/client-core/src/assetUnits';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import type {
  AssetMetadata,
  PhysicalAsset,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import {
  ConfirmDialog,
  ErrorState,
  LoadingState,
  StatusChip,
} from '../../components/common/PortalUI';
import { OwnerPagination } from '../../components/common/OwnerWorkspace';
import { ownerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import {
  incidentStatuses,
  workStatuses,
  type Incident,
  type WorkOrder,
} from '../incidents/incidentContracts';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';

export function AssetOperationsPanel({
  asset,
  onClose,
}: {
  asset: PhysicalAsset;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const history = useQuery({
    queryKey: ['property-setup', 'asset-history', session?.userId, asset.id],
    queryFn: ({ signal }) => api.assetHistory(asset.id, signal),
  });
  const metadata = useQuery({
    queryKey: ['property-setup', 'asset-metadata', session?.userId, asset.id],
    queryFn: ({ signal }) => api.assetMetadata(asset.id, signal),
    enabled: owner,
  });
  const status =
    ['Đang sử dụng', 'Cần sửa chữa', 'Đang sửa chữa', 'Đã ngừng sử dụng'][asset.status] ??
    'Chưa xác định';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{asset.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label={status}
              size="small"
              color={
                asset.status === 0
                  ? 'success'
                  : asset.status === 1 || asset.status === 2
                    ? 'warning'
                    : 'default'
              }
            />
            {!owner && (
              <Typography variant="body2" color="text.secondary">
                {asset.code || 'Chưa có mã nhận diện'}
              </Typography>
            )}
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {!owner && (
              <Box sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  ID tài sản
                </Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {asset.id}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Tình trạng thực tế
              </Typography>
              <Typography>{asset.condition}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Số lượng đã ghi nhận
              </Typography>
              <Typography>
                {metadata.data?.data.quantity ?? asset.quantity ?? 'Chưa tải được'}
                {(metadata.data?.data.unit ?? asset.unit)
                  ? ` ${metadata.data?.data.unit ?? asset.unit}`
                  : ''}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Vị trí
              </Typography>
              <Typography>
                {asset.roomId ? 'Trong phòng đã gán' : asset.commonArea || 'Chưa ghi nhận khu vực'}
              </Typography>
            </Box>
          </Box>
          {owner && <AssetRepairHistory key={asset.id} asset={asset} />}
          <Divider />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Lịch sử tài sản
          </Typography>
          {history.isPending ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState error={history.error} retry={() => void history.refetch()} />
          ) : (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {history.data.map((item) => (
                <Box key={item.id}>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(item.occurredAt).toLocaleString('vi-VN')}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {item.action}
                  </Typography>
                  <Typography variant="body2">{item.reason}</Typography>
                </Box>
              ))}
              {!history.data.length && (
                <Typography variant="body2" color="text.secondary">
                  Chưa có lịch sử được ghi nhận.
                </Typography>
              )}
            </Stack>
          )}
          {owner &&
            [
              'FireSafetyEquipment',
              'SafetyEquipment',
              'TechnicalEquipment',
              'ElectricalEquipment',
            ].includes(asset.category) && <AssetLifecyclePanel asset={asset} />}
          {owner &&
            (metadata.isPending ? (
              <LoadingState />
            ) : metadata.error ? (
              <ErrorState error={metadata.error} retry={() => void metadata.refetch()} />
            ) : (
              <MetadataEditor key={metadata.data.version} asset={asset} document={metadata.data} />
            ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng thông tin tài sản</Button>
      </DialogActions>
    </Dialog>
  );
}

const repairPageSize = 10;

function AssetRepairHistory({ asset }: { asset: PhysicalAsset }) {
  return (
    <>
      <Divider />
      <Box>
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
          Báo cáo sự cố và sửa chữa
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Báo cáo sự cố đã chọn tài sản này hoặc được liên kết qua lệnh sửa chữa.
        </Typography>
      </Box>
      <AssetRepairList<Incident>
        asset={asset}
        resource="incidents"
        title="Báo cáo sự cố"
        empty="Chưa có báo cáo sự cố liên kết với tài sản."
        renderRow={(report) => (
          <Stack spacing={0.75} sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              useFlexGap
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 650 }}>
                {report.code}
              </Typography>
              <StatusChip label={incidentStatuses[report.status] ?? report.status} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Ngày báo cáo: {formatInstant(report.createdAt)}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {report.description}
            </Typography>
            <Button
              component={Link}
              to={`/incidents?${ownerQuery({ locationId: asset.locationId, incidentId: report.id })}`}
              sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
            >
              Xem chi tiết sự cố
            </Button>
          </Stack>
        )}
      />
      <AssetRepairList<WorkOrder>
        asset={asset}
        resource="work-orders"
        title="Lệnh sửa chữa"
        empty="Chưa có lệnh sửa chữa liên kết với tài sản."
        renderRow={(work) => (
          <Stack spacing={0.75} sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              useFlexGap
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 650 }}>
                {work.source === 'Proactive' ? 'Bảo trì chủ động' : 'Sửa chữa từ sự cố'}
              </Typography>
              <StatusChip label={workStatuses[work.status] ?? work.status} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {work.verifiedAt
                ? `Ngày xác minh: ${formatInstant(work.verifiedAt)}`
                : `Hạn hoàn thành: ${formatInstant(work.targetCompletionAt)}`}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
              {work.description?.trim() || work.expectedOutcome}
            </Typography>
            <Button
              component={Link}
              to={`/maintenance?${ownerQuery({ locationId: asset.locationId, workOrderId: work.id })}`}
              sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
            >
              Xem chi tiết lệnh sửa chữa
            </Button>
          </Stack>
        )}
      />
    </>
  );
}

function AssetRepairList<T extends { id: string }>({
  asset,
  resource,
  title,
  empty,
  renderRow,
}: {
  asset: PhysicalAsset;
  resource: 'incidents' | 'work-orders';
  title: string;
  empty: string;
  renderRow: (row: T) => ReactNode;
}) {
  const { session } = useAuth();
  const api = usePropertySetupApi();
  const [page, setPage] = useState(1);
  const path = `/api/v1/${resource}?${ownerQuery({ locationId: asset.locationId, assetId: asset.id, page, pageSize: repairPageSize })}`;
  const query = useQuery({
    queryKey: ['owner-workspace', session?.userId, resource, path],
    queryFn: ({ signal }) => api.request<OwnerPage<T>>(path, { signal }),
    enabled: session?.roles.includes('Owner') ?? false,
  });
  return (
    <Stack component="section" aria-label={title} spacing={1} sx={{ minWidth: 0 }}>
      <Typography component="h4" variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
        {query.isSuccess ? ` · ${query.data.totalCount}` : ''}
      </Typography>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.items.length ? (
            <Stack
              component="ul"
              spacing={1.25}
              divider={<Divider flexItem />}
              sx={{ listStyle: 'none', m: 0, p: 0 }}
            >
              {query.data.items.map((row) => (
                <Box component="li" key={row.id} sx={{ minWidth: 0 }}>
                  {renderRow(row)}
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {query.data.totalCount === 0
                ? empty
                : 'Trang này không còn bản ghi. Chọn trang trước để xem lịch sử.'}
            </Typography>
          )}
          {(query.data.totalCount > repairPageSize || page > 1) && (
            <OwnerPagination
              page={page}
              total={query.data.totalCount}
              size={repairPageSize}
              change={setPage}
              busy={query.isFetching}
            />
          )}
        </>
      )}
    </Stack>
  );
}

function MetadataEditor({
  asset,
  document,
}: {
  asset: PhysicalAsset;
  document: SetupDocument<AssetMetadata>;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [unit, setUnit] = useState(document.data.unit ?? '');
  const [quantity, setQuantity] = useState(String(document.data.quantity));
  const [cost, setCost] = useState(String(document.data.purchaseCost ?? ''));
  const [date, setDate] = useState(document.data.purchaseDate ?? '');
  const [life, setLife] = useState(String(document.data.usefulLifeMonths ?? ''));
  const [reason, setReason] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [code, setCode] = useState('');
  const [condition, setCondition] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <Stack spacing={2}>
      <Stack
        component={ValidatedForm}
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(
            () =>
              api.saveMetadata(
                asset.id,
                {
                  trackingMode: Number(quantity) > 1 ? 'BulkQuantity' : document.data.trackingMode,
                  quantity: Number(quantity),
                  ...(unit || document.data.unit !== undefined ? { unit: unit || null } : {}),
                  purchaseCost: cost || null,
                  purchaseDate: date || null,
                  usefulLifeMonths: life ? Number(life) : null,
                },
                document.version,
                reason,
              ),
            'Máy chủ đã lưu thông tin tài sản.',
          );
        }}
      >
        <Divider />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Thông tin mua và số lượng
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            select
            label="Đơn vị"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            <MenuItem value="">Chưa ghi nhận</MenuItem>
            {unit && !ASSET_UNITS.some((option) => option === unit) && (
              <MenuItem value={unit}>{unit}</MenuItem>
            )}
            {ASSET_UNITS.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            required
            type="number"
            label="Số lượng thực tế"
            value={quantity}
            disabled={asset.status === 2 || asset.status === 3 || action.busy}
            slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <MoneyField
            allowDecimal
            label="Giá mua VND"
            value={cost}
            onValueChange={(raw) => setCost(raw)}
          />
          <TextField
            type="date"
            label="Ngày mua"
            slotProps={{ inputLabel: { shrink: true } }}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <TextField
            type="number"
            label="Thời gian sử dụng dự kiến (tháng)"
            value={life}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            onChange={(event) => setLife(event.target.value)}
          />
        </Box>
        <TextField
          required
          label="Lý do cập nhật tài sản"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          type="submit"
          variant="contained"
          sx={{ alignSelf: 'flex-start' }}
          disabled={
            action.busy ||
            !Number.isInteger(Number(quantity)) ||
            Number(quantity) < 1 ||
            Number(quantity) > 10000 ||
            !reason.trim()
          }
        >
          Lưu thông tin tài sản
        </Button>
      </Stack>
      {asset.status !== 3 && asset.status !== 2 && (
        <Stack
          component={ValidatedForm}
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            setConfirm(true);
          }}
        >
          <Divider />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Thay tài sản vật lý
          </Typography>
          <Alert severity="info">
            Tài sản cũ được giữ trong lịch sử. Tài sản thay thế cần mã và tình trạng thực tế riêng.
          </Alert>
          <TextField
            required
            label="Mã tài sản thay thế"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextField
            required
            label="Tình trạng tài sản thay thế"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          />
          <TextField
            required
            label="Lý do thay tài sản"
            value={replacementReason}
            onChange={(event) => setReplacementReason(event.target.value)}
          />
          <Button
            type="submit"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
            disabled={action.busy || !replacementReason.trim()}
          >
            Thay tài sản
          </Button>
        </Stack>
      )}
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      <ConfirmDialog
        open={confirm}
        title="Xác nhận thay tài sản?"
        busy={action.busy}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          action.run(async () => {
            await api.replaceAsset(asset.id, {
              code,
              condition,
              reason: replacementReason,
              expectedVersion: asset.version,
            });
            setConfirm(false);
          }, 'Máy chủ đã ghi nhận thay tài sản và giữ lịch sử nguồn.')
        }
      >
        Mã mới: {code}. Máy chủ sẽ kiểm tra trạng thái sửa chữa và phiên bản trước khi thay.
      </ConfirmDialog>
    </Stack>
  );
}
