import { MoneyField } from '../../../components/common/MoneyField';
import { useState } from 'react';
import { isMockMode } from '../../../services/config';
import { ApiConfigurationLibraryPage } from './ApiConfigurationLibraryPage';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  Stack,
} from '@mui/material';
import { Copy, Eye, FilePlus2, Library, Pencil, Plus, Search, Send, X } from 'lucide-react';
import { PageHeader } from '../../../components/common/PortalUI';
import { usePortalData } from '../../../hooks/usePortalData';
import {
  useSharedConfiguration,
  type AssetCatalogEntry,
  type AssetTemplate,
  type FeeTemplate,
  type PolicyTemplate,
  type RoomTemplate,
} from '../SharedConfigurationContext';

export type LibraryKind = 'room' | 'asset' | 'fee' | 'policy';
type AssetTemplateItem = AssetTemplate['items'][number];
type LibraryItem = RoomTemplate | AssetCatalogEntry | AssetTemplate | FeeTemplate | PolicyTemplate;

const meta = {
  room: {
    title: 'Mẫu loại phòng',
    subtitle: 'Tạo cấu hình loại phòng dùng chung và tái sử dụng cho nhiều cơ sở.',
    action: 'Tạo mẫu',
  },
  asset: {
    title: 'Danh mục tài sản',
    subtitle:
      'Quản lý định nghĩa tài sản dùng chung và các gói trang thiết bị tiêu chuẩn. Mục danh mục không phải là tài sản thực tế trong phòng.',
    action: 'Thêm loại tài sản',
  },
  fee: {
    title: 'Mẫu giá & biểu phí',
    subtitle:
      'Quản lý mức giá tham khảo dùng chung. Mọi giá trị áp dụng cần được xác nhận tại cơ sở.',
    action: 'Tạo mẫu',
  },
  policy: {
    title: 'Nội quy & chính sách',
    subtitle: 'Tạo mẫu nội quy rõ ràng để áp dụng và tùy chỉnh theo từng cơ sở.',
    action: 'Tạo mẫu chính sách',
  },
} satisfies Record<LibraryKind, { title: string; subtitle: string; action: string }>;

const money = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

const statusLabels: Record<string, string> = {
  Active: 'Đang hoạt động',
  Draft: 'Bản nháp',
  Scheduled: 'Đã lên lịch',
};
const statusLabel = (status: string) => statusLabels[status] ?? status;

export function ConfigurationLibraryPage({ kind }: { kind: LibraryKind }) {
  return isMockMode ? (
    <MockConfigurationLibraryPage kind={kind} />
  ) : (
    <ApiConfigurationLibraryPage kind={kind} />
  );
}
function MockConfigurationLibraryPage({ kind }: { kind: LibraryKind }) {
  const shared = useSharedConfiguration();
  const query = usePortalData();
  const [search, setSearch] = useState('');
  const [assetTab, setAssetTab] = useState(0);
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });
  const [preview, setPreview] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [notice, setNotice] = useState('');

  const configuredList =
    kind === 'room'
      ? shared.roomTemplates
      : kind === 'fee'
        ? shared.feeTemplates
        : kind === 'policy'
          ? shared.policyTemplates
          : assetTab === 0
            ? shared.assetCatalog
            : shared.assetTemplates;
  const list = isMockMode ? configuredList : [];
  const visible = list.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  const activeItem = list.find((item) => item.id === preview || item.id === editor.id);

  const openCreate = () => setEditor({ open: true });
  const openEdit = (itemId: string) => setEditor({ open: true, id: itemId });
  const duplicate = (itemId: string) => {
    if (kind === 'asset') {
      const item = shared.assetTemplates.find((entry) => entry.id === itemId);
      if (item)
        shared.addAssetTemplate({
          name: `${item.name} - Bản sao`,
          roomType: item.roomType,
          description: item.description,
          items: [...item.items],
        });
    } else shared.duplicateTemplate(kind, itemId);
    setNotice('Đã thêm một bản sao nháp vào thư viện.');
  };

  const apply = () => {
    if (!applyId || !destination) return;
    shared.applyTemplate(kind === 'asset' ? 'asset' : kind, applyId, destination);
    setNotice('Đã áp dụng mẫu dùng chung thành một cấu hình độc lập tại cơ sở.');
    setApplyId(null);
    setDestination('');
  };

  return (
    <>
      <PageHeader
        group="Cấu hình cấp chuỗi"
        title={meta[kind].title}
        subtitle={meta[kind].subtitle}
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={17} />}
            onClick={openCreate}
            disabled={!isMockMode}
          >
            {meta[kind].action}
          </Button>
        }
      />
      <Alert severity="info" icon={<Library size={18} />} sx={{ mb: 2.5 }}>
        Mẫu dùng chung là nguồn cấu hình có thể tái sử dụng. Việc chỉnh sửa bản sao tại một cơ sở
        không làm thay đổi thư viện này hoặc cơ sở khác.
      </Alert>
      {!isMockMode && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          Backend hiện chỉ có cấu hình theo từng cơ sở, chưa có API thư viện mẫu dùng chung cấp
          chuỗi. Dữ liệu demo không được hiển thị trong API mode và các thao tác tạo/sửa/áp dụng
          đang bị khóa để tránh lưu sai nghiệp vụ.
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {kind === 'asset' && (
        <Tabs value={assetTab} onChange={(_, value) => setAssetTab(value)} sx={{ mb: 2 }}>
          <Tab label={`Danh mục tài sản (${shared.assetCatalog.length})`} />
          <Tab label={`Mẫu tài sản (${shared.assetTemplates.length})`} />
        </Tabs>
      )}
      <Paper sx={{ p: 2, mb: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <TextField
          size="small"
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Tìm kiếm ${meta[kind].title.toLowerCase()}...`}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
        />
      </Paper>
      {visible.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', border: '1px dashed', borderColor: 'divider' }}>
          <Typography variant="h6">Không tìm thấy mẫu phù hợp</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Hãy thử từ khóa khác hoặc thêm một cấu hình dùng chung.
          </Typography>
          <Button onClick={openCreate} startIcon={<Plus size={16} />} disabled={!isMockMode}>
            {meta[kind].action}
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {visible.map((item) => (
            <Grid key={item.id} size={{ xs: 12, md: 6, xl: 4 }}>
              <TemplateCard
                kind={kind}
                item={item}
                catalog={shared.assetCatalog}
                onPreview={() => setPreview(item.id)}
                onEdit={() => openEdit(item.id)}
                onDuplicate={() => duplicate(item.id)}
                onApply={() => {
                  setApplyId(item.id);
                  setDestination('');
                }}
                onCatalogAdd={() => {
                  const target = shared.assetTemplates[0];
                  if (target && !target.items.some((entry) => entry.assetId === item.id))
                    shared.updateTemplate('assetTemplate', target.id, {
                      items: [...target.items, { assetId: item.id, quantity: 1, required: false }],
                    });
                  setNotice(`Đã thêm ${item.name} vào ${target?.name ?? 'một mẫu tài sản mới'}.`);
                }}
                catalogMode={kind === 'asset' && assetTab === 0}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <TemplateEditor
        key={`${editor.open}-${editor.id ?? 'new'}`}
        kind={kind}
        assetPackageMode={kind === 'asset' && assetTab === 1}
        open={editor.open}
        item={activeItem}
        onClose={() => setEditor({ open: false })}
        onSaved={(message) => {
          setEditor({ open: false });
          setNotice(message);
        }}
      />

      <Drawer
        anchor="right"
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, p: 3 } } }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="overline" color="primary">
              Xem trước mẫu dùng chung
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 850 }}>
              {activeItem?.name}
            </Typography>
          </Box>
          <Button aria-label="Đóng phần xem trước" onClick={() => setPreview(null)}>
            <X size={18} />
          </Button>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <PreviewContent kind={kind} item={activeItem} catalog={shared.assetCatalog} />
        <Alert severity="info" sx={{ mt: 3 }}>
          Áp dụng mẫu sẽ tạo một bản sao độc lập tại cơ sở. Các chỉnh sửa sau này tại cơ sở không
          làm thay đổi mẫu dùng chung.
        </Alert>
        <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            startIcon={<Pencil size={15} />}
            onClick={() => {
              if (activeItem) openEdit(activeItem.id);
              setPreview(null);
            }}
          >
            Chỉnh sửa mẫu
          </Button>
          {!(kind === 'asset' && assetTab === 0) && (
            <Button
              variant="contained"
              startIcon={<Send size={15} />}
              onClick={() => {
                setApplyId(activeItem?.id ?? null);
                setPreview(null);
              }}
            >
              Dùng cho cơ sở
            </Button>
          )}
        </Stack>
      </Drawer>

      <Dialog open={Boolean(applyId)} onClose={() => setApplyId(null)} fullWidth maxWidth="sm">
        <DialogTitle>Áp dụng mẫu dùng chung</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Cơ sở đích sẽ nhận một bản sao của mẫu. Các cấu hình hiện có sẽ không bị tự động ghi đè.
          </Alert>
          <TextField
            select
            fullWidth
            label="Cơ sở đích"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            {(query.data?.records.locations ?? []).map((location) => (
              <MenuItem key={location.id} value={location.id}>
                {location.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyId(null)}>Hủy</Button>
          <Button variant="contained" disabled={!destination} onClick={apply}>
            Xem trước & áp dụng
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function TemplateCard({
  kind,
  item,
  catalog,
  onPreview,
  onEdit,
  onDuplicate,
  onApply,
  onCatalogAdd,
  catalogMode,
}: {
  kind: LibraryKind;
  item: LibraryItem;
  catalog: { id: string; name: string }[];
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onApply: () => void;
  onCatalogAdd: () => void;
  catalogMode: boolean;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%', borderRadius: 2.5 }}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
          <Box>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={catalogMode ? 'Mục danh mục' : 'Mẫu dùng chung'}
              sx={{ mb: 1 }}
            />
            <Typography variant="h6" sx={{ fontWeight: 850 }}>
              {item.name}
            </Typography>
          </Box>
          {'status' in item && (
            <Chip
              size="small"
              label={statusLabel(item.status)}
              color={
                item.status === 'Active'
                  ? 'success'
                  : item.status === 'Scheduled'
                    ? 'warning'
                    : 'default'
              }
            />
          )}
        </Stack>
        <Box sx={{ minHeight: 100, mt: 1.5 }}>
          <PreviewContent kind={kind} item={item} catalog={catalog} compact />
        </Box>
        {!catalogMode && 'locationsUsing' in item && (
          <Typography variant="caption" color="text.secondary">
            Được dùng tại {item.locationsUsing} cơ sở
          </Typography>
        )}
        <Divider sx={{ my: 1.5 }} />
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Button size="small" startIcon={<Eye size={14} />} onClick={onPreview}>
            Xem trước
          </Button>
          <Button size="small" startIcon={<Pencil size={14} />} onClick={onEdit}>
            Chỉnh sửa
          </Button>
          {!catalogMode && kind !== 'asset' && (
            <Button size="small" startIcon={<Copy size={14} />} onClick={onDuplicate}>
              Nhân bản
            </Button>
          )}
          {catalogMode ? (
            <Button size="small" startIcon={<FilePlus2 size={14} />} onClick={onCatalogAdd}>
              Thêm vào mẫu tài sản
            </Button>
          ) : (
            <Button size="small" startIcon={<Send size={14} />} onClick={onApply}>
              {kind === 'room' ? 'Dùng cho cơ sở' : 'Áp dụng cho cơ sở'}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function PreviewContent({
  kind,
  item,
  catalog,
  compact = false,
}: {
  kind: LibraryKind;
  item: LibraryItem | undefined;
  catalog: { id: string; name: string }[];
  compact?: boolean;
}) {
  if (!item) return null;
  if (kind === 'room') {
    const room = item as RoomTemplate;
    return (
      <Stack spacing={0.6}>
        <Typography color="text.secondary">{room.description}</Typography>
        <Typography>
          <b>{room.area} m²</b> · {room.capacity} người ở · {money.format(room.rate)} VND/tháng
        </Typography>
        <Typography variant="body2">{room.facilities.join(' · ')}</Typography>
      </Stack>
    );
  }
  if (kind === 'asset' && 'referencePrice' in item) {
    const asset = item as AssetCatalogEntry;
    return (
      <Stack spacing={0.6}>
        <Typography color="text.secondary">{asset.description}</Typography>
        <Typography>
          <b>{asset.category}</b> · {money.format(asset.referencePrice)} VND/{asset.unit}
        </Typography>
      </Stack>
    );
  }
  if (kind === 'asset') {
    const assetTemplate = item as AssetTemplate;
    return (
      <Stack spacing={0.6}>
        <Typography color="text.secondary">{assetTemplate.description}</Typography>
        <Typography>
          <b>{assetTemplate.roomType}</b> · {assetTemplate.items.length} loại tài sản
        </Typography>
        {!compact &&
          assetTemplate.items.map((entry: AssetTemplateItem) => (
            <Typography key={entry.assetId} variant="body2">
              {catalog.find((asset) => asset.id === entry.assetId)?.name ?? entry.assetId} ×{' '}
              {entry.quantity} · {entry.required ? 'Bắt buộc' : 'Tùy chọn'}
            </Typography>
          ))}
      </Stack>
    );
  }
  if (kind === 'fee') {
    const fee = item as FeeTemplate;
    return (
      <Stack spacing={0.6}>
        <Typography color="text.secondary">{fee.description}</Typography>
        <Typography>
          <b>{fee.category}</b> · {fee.method}
        </Typography>
        <Typography>
          {money.format(fee.price)} {fee.unit} · {fee.scope}
        </Typography>
        {!compact && (
          <Typography variant="caption">
            Phiên bản V{fee.version} · Hiệu lực {fee.effectiveDate}
          </Typography>
        )}
      </Stack>
    );
  }
  const policy = item as PolicyTemplate;
  return (
    <Stack spacing={0.6}>
      <Typography color="text.secondary">{policy.summary}</Typography>
      <Typography>
        <b>{policy.category}</b> · Phiên bản V{policy.version}
      </Typography>
      {!compact && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{policy.content}</Typography>}
    </Stack>
  );
}

function TemplateEditor({
  kind,
  assetPackageMode,
  open,
  item,
  onClose,
  onSaved,
}: {
  kind: LibraryKind;
  assetPackageMode: boolean;
  open: boolean;
  item: LibraryItem | undefined;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const shared = useSharedConfiguration();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Khác');
  const [value, setValue] = useState(() =>
    String(
      kind === 'room'
        ? ((item as RoomTemplate | undefined)?.area ?? '')
        : kind === 'fee'
          ? ((item as FeeTemplate | undefined)?.price ?? '')
          : ((item as AssetCatalogEntry | undefined)?.referencePrice ?? ''),
    ),
  );
  const initialName = item?.name ?? '';
  const initialDescription =
    item && 'description' in item
      ? item.description
      : ((item as PolicyTemplate | undefined)?.summary ?? '');

  const save = () => {
    const finalName = name || initialName || `Mẫu ${meta[kind].title.toLowerCase()} mới`;
    const finalDescription =
      description || initialDescription || 'Cấu hình dùng chung có thể tái sử dụng trong chuỗi.';
    if (item) {
      if (kind === 'room')
        shared.updateTemplate('room', item.id, {
          name: finalName,
          description: finalDescription,
          area: Number(value) || (item as RoomTemplate).area,
        });
      if (kind === 'asset' && assetPackageMode)
        shared.updateTemplate('assetTemplate', item.id, {
          name: finalName,
          description: finalDescription,
        });
      if (kind === 'asset' && !assetPackageMode)
        shared.updateTemplate('asset', item.id, {
          name: finalName,
          category,
          description: finalDescription,
          referencePrice: Number(value) || (item as AssetCatalogEntry).referencePrice,
        });
      if (kind === 'fee')
        shared.updateTemplate('fee', item.id, {
          name: finalName,
          category,
          description: finalDescription,
          price: Number(value) || (item as FeeTemplate).price,
        });
      if (kind === 'policy')
        shared.updateTemplate('policy', item.id, {
          name: finalName,
          category,
          summary: finalDescription,
          content: finalDescription,
        });
      onSaved('Đã cập nhật mẫu dùng chung. Các bản sao đã áp dụng tại cơ sở không thay đổi.');
      return;
    }
    if (kind === 'room')
      shared.addRoomTemplate({
        name: finalName,
        area: Number(value) || 25,
        capacity: 2,
        rate: 5_000_000,
        description: finalDescription,
        facilities: ['Phòng tắm riêng', 'Điều hòa'],
      });
    if (kind === 'asset' && assetPackageMode)
      shared.addAssetTemplate({
        name: finalName,
        roomType: 'Studio tiêu chuẩn',
        description: finalDescription,
        items: shared.assetCatalog
          .slice(0, 4)
          .map((asset) => ({ assetId: asset.id, quantity: 1, required: true })),
      });
    if (kind === 'asset' && !assetPackageMode)
      shared.addAsset({
        name: finalName,
        category,
        description: finalDescription,
        referencePrice: Number(value) || 0,
        unit: 'cái',
        status: 'Active',
      });
    if (kind === 'fee')
      shared.addFeeTemplate({
        name: finalName,
        category,
        method: 'Cố định hàng tháng',
        price: Number(value) || 0,
        unit: 'VND / tháng',
        description: finalDescription,
        scope: 'Cơ sở',
        effectiveDate: '2026-11-04',
      });
    if (kind === 'policy')
      shared.addPolicyTemplate({
        name: finalName,
        category,
        summary: finalDescription,
        content: finalDescription,
        effectiveDate: '2026-11-04',
      });
    onSaved('Mẫu dùng chung mới đã có thể sử dụng trong phiên hiện tại.');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{item ? `Chỉnh sửa ${item.name}` : meta[kind].action}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {item && (
            <Alert severity="info">
              Bạn đang chỉnh sửa nguồn dùng chung. Các bản sao đã áp dụng tại cơ sở vẫn độc lập.
            </Alert>
          )}
          <TextField
            label="Tên mẫu"
            defaultValue={initialName}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <TextField
            label={kind === 'policy' ? 'Nội dung chính sách' : 'Mô tả'}
            defaultValue={initialDescription}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={3}
          />
          {kind !== 'room' && (
            <TextField
              label="Danh mục"
              defaultValue={item && 'category' in item ? item.category : category}
              onChange={(event) => setCategory(event.target.value)}
            />
          )}
          {kind !== 'policy' && !assetPackageMode && kind !== 'room' && (
            <MoneyField
              allowDecimal
              label={kind === 'fee' ? 'Đơn giá tham khảo (VND)' : 'Giá tham khảo (VND)'}
              value={value}
              onValueChange={setValue}
            />
          )}
          {kind === 'room' && !assetPackageMode && (
            <TextField
              type="number"
              label="Diện tích tiêu chuẩn (m²)"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {assetPackageMode && (
            <Alert severity="success">
              Gói khởi tạo gồm bốn mục đang hoạt động đầu tiên trong danh mục. Bạn có thể tùy chỉnh
              gói sau khi tạo.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Hủy</Button>
        <Button variant="contained" onClick={save}>
          {item ? 'Lưu thay đổi' : meta[kind].action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export const RoomTypeTemplatesPage = () => <ConfigurationLibraryPage kind="room" />;
export const AssetCatalogPage = () => <ConfigurationLibraryPage kind="asset" />;
export const PricingFeeTemplatesPage = () => <ConfigurationLibraryPage kind="fee" />;
export const PolicyTemplatesPage = () => <ConfigurationLibraryPage kind="policy" />;
