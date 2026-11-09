import { useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Grid, InputAdornment, MenuItem, Paper, Stack, Tab,
  TablePagination, Tabs, TextField, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Copy, Eye, Library, Pencil, Plus, Search, Send } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type { SharedDocument, SharedResource } from '../../../../../../packages/client-core/src/sharedConfiguration';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { SetupActionFeedback } from '../../property/UtilityFormTools';
import { useSetupAction } from '../../property/useSetupAction';
import { useSharedConfigurationApi } from '../useSharedConfigurationApi';
import type { LibraryKind } from './ConfigurationLibraryPage';
import { SharedTemplateDetails } from './SharedTemplateDetails';
import { SharedTemplateEditor } from './SharedTemplateEditor';

const libraryMeta: Record<SharedResource, { title: string; subtitle: string; action: string; search: string }> = {
  'room-type-templates': {
    title: 'Mẫu loại phòng', subtitle: 'Tạo cấu hình loại phòng dùng chung và tái sử dụng cho nhiều cơ sở.',
    action: 'Tạo mẫu', search: 'Tìm kiếm mẫu loại phòng...',
  },
  'asset-catalog': {
    title: 'Danh mục tài sản', subtitle: 'Quản lý định nghĩa tài sản dùng chung. Mục danh mục không phải là tài sản thực tế trong phòng.',
    action: 'Thêm loại tài sản', search: 'Tìm kiếm danh mục tài sản...',
  },
  'asset-templates': {
    title: 'Mẫu tài sản', subtitle: 'Quản lý các gói trang thiết bị tiêu chuẩn dùng chung cho nhiều cơ sở.',
    action: 'Tạo mẫu', search: 'Tìm kiếm mẫu tài sản...',
  },
  'fee-templates': {
    title: 'Mẫu giá & biểu phí', subtitle: 'Quản lý mức giá tham khảo dùng chung. Mọi giá trị áp dụng cần được xác nhận tại cơ sở.',
    action: 'Tạo mẫu', search: 'Tìm kiếm mẫu giá & biểu phí...',
  },
  'policy-templates': {
    title: 'Nội quy & chính sách', subtitle: 'Tạo mẫu nội quy rõ ràng để áp dụng và tùy chỉnh theo từng cơ sở.',
    action: 'Tạo mẫu chính sách', search: 'Tìm kiếm nội quy & chính sách...',
  },
};

const statusLabel = (status: SharedDocument['status']) =>
  status === 'Draft' ? 'Bản nháp' : status === 'Published' ? 'Đang hoạt động' : 'Đã lưu trữ';

function documentSummary(document: SharedDocument) {
  if (document.resource === 'room-type-templates') {
    const data = document.data as { area: string; capacity: number; referenceRent: string | null };
    return `${data.area} m² · ${data.capacity} người ở${data.referenceRent ? ` · ${data.referenceRent} VND/tháng` : ''}`;
  }
  if (document.resource === 'asset-catalog') {
    const data = document.data as { category: string; unit: string; referencePrice: string };
    return `${data.category} · ${data.referencePrice} VND/${data.unit}`;
  }
  if (document.resource === 'asset-templates') {
    const data = document.data as { items: unknown[] };
    return `${data.items.length} loại tài sản trong mẫu`;
  }
  if (document.resource === 'fee-templates') {
    const data = document.data as { category: string; referenceRate: string; unit: string };
    return `${data.category} · ${data.referenceRate} VND/${data.unit}`;
  }
  return `Hiệu lực từ ${(document.data as { effectiveFrom: string }).effectiveFrom}`;
}

export function ApiConfigurationLibraryPage({ kind }: { kind: LibraryKind }) {
  const [assetTab, setAssetTab] = useState(0);
  const resource: SharedResource = kind === 'room' ? 'room-type-templates'
    : kind === 'asset' ? (assetTab === 0 ? 'asset-catalog' : 'asset-templates')
      : kind === 'fee' ? 'fee-templates' : 'policy-templates';
  return <SharedLibrary key={resource} resource={resource} assetTabs={kind === 'asset' ? (
    <Tabs value={assetTab} onChange={(_, value: number) => setAssetTab(value)}>
      <Tab label="Danh mục tài sản" /><Tab label="Gói tài sản" />
    </Tabs>
  ) : null} />;
}

function SharedLibrary({ resource, assetTabs }: { resource: SharedResource; assetTabs: ReactNode }) {
  const { session } = useAuth();
  const api = useSharedConfigurationApi();
  const action = useSetupAction();
  const canManage = session?.roles.includes('Owner') ?? false;
  const meta = libraryMeta[resource];
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ document: SharedDocument | null } | null>(null);
  const [details, setDetails] = useState('');
  const [archive, setArchive] = useState<SharedDocument | null>(null);
  const [duplicate, setDuplicate] = useState<SharedDocument | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const query = useQuery({
    queryKey: ['property-setup', 'shared', session?.userId, resource, search, status, page],
    queryFn: ({ signal }) => api.list(resource, search, status, page + 1, 20, signal), enabled: canManage,
  });
  if (!canManage) return <Alert severity="warning">Chỉ Chủ trọ được quản lý thư viện cấu hình.</Alert>;

  return <Stack spacing={2}>
    <PageHeader group="Cấu hình cấp chuỗi" title={meta.title} subtitle={meta.subtitle} actions={
      <Button variant="contained" startIcon={<Plus size={17} />} onClick={() => setEditor({ document: null })}>{meta.action}</Button>
    } />
    <Alert severity="info" icon={<Library size={18} />}>
      Mẫu dùng chung là nguồn cấu hình có thể tái sử dụng. Việc chỉnh sửa bản sao tại một cơ sở không làm thay đổi thư viện này hoặc cơ sở khác.
    </Alert>
    {assetTabs}
    <SetupActionFeedback error={editor ? '' : action.error} notice={action.notice} />
    <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <TextField size="small" fullWidth value={search} placeholder={meta.search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> } }} />
        <TextField size="small" select label="Trạng thái" value={status} sx={{ minWidth: 180 }}
          onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
          <MenuItem value="">Tất cả phiên bản</MenuItem><MenuItem value="Draft">Bản nháp</MenuItem>
          <MenuItem value="Published">Đang hoạt động</MenuItem><MenuItem value="Archived">Đã lưu trữ</MenuItem>
        </TextField>
      </Stack>
    </Paper>

    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} />
      : query.data?.items.length ? <>
        <Grid container spacing={2}>{query.data.items.map((document) =>
          <Grid key={document.id} size={{ xs: 12, md: 6, xl: 4 }}>
            <Card variant="outlined" sx={{ height: '100%', borderRadius: 3 }}><CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Chip size="small" variant="outlined" color="primary" label={resource === 'asset-catalog' ? 'Mục danh mục' : 'Mẫu dùng chung'} />
                <Chip size="small" color={document.status === 'Published' ? 'success' : 'default'} label={statusLabel(document.status)} />
              </Stack>
              <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 800 }}>{document.name}</Typography>
              <Typography sx={{ mt: 1 }}>{document.description}</Typography>
              <Typography sx={{ mt: 1, fontWeight: 650 }}>{documentSummary(document)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>Phiên bản {document.edition} · lần cập nhật {document.version}</Typography>
              <Box sx={{ flexGrow: 1 }} /><Divider sx={{ my: 1.5 }} />
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.25 }}>
                <Button size="small" startIcon={<Eye size={15} />} onClick={() => setDetails(document.id)}>Xem và áp dụng</Button>
                {document.status === 'Draft' && <>
                  <Button size="small" startIcon={<Pencil size={15} />} disabled={action.busy} onClick={() => setEditor({ document })}>Sửa</Button>
                  <Button size="small" startIcon={<Send size={15} />} disabled={action.busy}
                    onClick={() => action.run(() => api.publish(resource, document.id, document.version), 'Đã công bố phiên bản trên máy chủ.')}>Công bố</Button>
                </>}
                {document.status === 'Published' && <Button size="small" disabled={action.busy}
                  onClick={() => action.run(() => api.edition(resource, document.id, document.version), 'Đã tạo bản nháp phiên bản mới.')}>Phiên bản mới</Button>}
                {document.status !== 'Archived' && <>
                  <Button size="small" startIcon={<Copy size={15} />} disabled={action.busy} onClick={() => {
                    setDuplicate(document); setDuplicateName(`${document.name} (bản sao)`);
                  }}>Nhân bản</Button>
                  <Button size="small" disabled={action.busy} onClick={() => setArchive(document)}>Lưu trữ</Button>
                </>}
              </Stack>
            </CardContent></Card>
          </Grid>)}</Grid>
        <TablePagination component="div" count={query.data.total} page={page} rowsPerPage={20} rowsPerPageOptions={[20]} onPageChange={(_, next) => setPage(next)} />
      </> : <EmptyState message="Không tìm thấy mẫu phù hợp" />}

    {editor && <SharedTemplateEditor key={editor.document?.id ?? 'new'} resource={resource} document={editor.document}
      busy={action.busy} error={action.error} close={() => setEditor(null)} save={(input) => action.run(async () => {
        await api.save(resource, editor.document?.id ?? null, input); setEditor(null);
      }, 'Đã lưu bản nháp trên máy chủ.')} />}
    {!!details && <SharedTemplateDetails resource={resource} id={details} close={() => setDetails('')} />}
    <ConfirmDialog open={!!archive} title="Lưu trữ mẫu?" busy={action.busy} onClose={() => setArchive(null)} onConfirm={() => {
      if (archive) action.run(async () => { await api.archive(resource, archive.id, archive.version); setArchive(null); }, 'Đã lưu trữ mẫu.');
    }}>Phiên bản đã áp dụng tại cơ sở và lịch sử vẫn được giữ lại.</ConfirmDialog>
    <Dialog open={!!duplicate} onClose={() => { if (!action.busy) setDuplicate(null); }}>
      <DialogTitle>Nhân bản thành mẫu độc lập</DialogTitle>
      <form onSubmit={(event) => { event.preventDefault(); if (duplicate) action.run(async () => {
        await api.duplicate(resource, duplicate.id, duplicateName, duplicate.version); setDuplicate(null);
      }, 'Đã lưu bản sao trên máy chủ.'); }}>
        <DialogContent><Stack spacing={2}>{action.error && <Alert severity="error">{action.error}</Alert>}
          <TextField required label="Tên bản sao" value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} />
        </Stack></DialogContent>
        <DialogActions><Button disabled={action.busy} onClick={() => setDuplicate(null)}>Hủy</Button><Button disabled={action.busy} type="submit">Nhân bản</Button></DialogActions>
      </form>
    </Dialog>
  </Stack>;
}
