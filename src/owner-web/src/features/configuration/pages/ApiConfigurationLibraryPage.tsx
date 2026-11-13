import { useId, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import type {
  SharedDocument,
  SharedResource,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../../../components/common/PortalUI';
import { SetupActionFeedback } from '../../property/UtilityFormTools';
import { useSetupAction } from '../../property/useSetupAction';
import { useSharedConfigurationApi } from '../useSharedConfigurationApi';
import type { LibraryKind } from './ConfigurationLibraryPage';
import { SharedTemplateDetails } from './SharedTemplateDetails';
import { SharedTemplateEditor } from './SharedTemplateEditor';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';

const libraryMeta: Record<
  SharedResource,
  { title: string; subtitle: string; action: string; search: string }
> = {
  'room-type-templates': {
    title: 'Mẫu loại phòng',
    subtitle: '',
    action: 'Tạo mẫu',
    search: 'Tìm kiếm mẫu loại phòng...',
  },
  'asset-catalog': {
    title: 'Danh mục tài sản',
    subtitle: 'Danh mục dùng chung, không phải tài sản thực tế tại cơ sở.',
    action: 'Thêm loại tài sản',
    search: 'Tìm kiếm danh mục tài sản...',
  },
  'asset-templates': {
    title: 'Mẫu tài sản',
    subtitle: 'Định mức trang bị dùng chung.',
    action: 'Tạo mẫu',
    search: 'Tìm kiếm mẫu tài sản...',
  },
  'fee-templates': {
    title: 'Mẫu giá & biểu phí',
    subtitle: 'Giá tham khảo, xác nhận đơn giá khi áp dụng.',
    action: 'Tạo mẫu',
    search: 'Tìm kiếm mẫu giá & biểu phí...',
  },
  'policy-templates': {
    title: 'Nội quy & chính sách',
    subtitle: '',
    action: 'Tạo mẫu chính sách',
    search: 'Tìm kiếm nội quy & chính sách...',
  },
};

const statusLabel = (status: SharedDocument['status']) =>
  status === 'Draft' ? 'Bản nháp' : status === 'Published' ? 'Đã công bố' : 'Đã lưu trữ';

const resourceColumns: Record<SharedResource, { label: string; numeric?: boolean }[]> = {
  'room-type-templates': [
    { label: 'Diện tích', numeric: true },
    { label: 'Sức chứa', numeric: true },
    { label: 'Giá thuê tham khảo', numeric: true },
  ],
  'asset-catalog': [{ label: 'Danh mục' }, { label: 'Giá tham khảo', numeric: true }],
  'asset-templates': [{ label: 'Loại tài sản', numeric: true }],
  'fee-templates': [
    { label: 'Loại phí' },
    { label: 'Phạm vi' },
    { label: 'Cách tính' },
    { label: 'Mức phí tham khảo', numeric: true },
  ],
  'policy-templates': [{ label: 'Hiệu lực từ' }],
};

const feeCategoryLabels: Record<string, string> = {
  Rent: 'Tiền thuê',
  Electricity: 'Điện',
  Water: 'Nước',
  ServiceFee: 'Dịch vụ',
};

const feeMethodLabels: Record<string, string> = {
  FixedPerRoomPerMonth: 'Phòng/tháng',
  FixedPerPersonPerMonth: 'Người/tháng',
  Metered: 'Theo chỉ số',
};

function documentValues(document: SharedDocument): string[] {
  const data = document.data;
  if ('capacity' in data) {
    return [
      `${formatBillingDecimal(data.area)} m²`,
      `${data.capacity} người`,
      data.referenceRent == null
        ? 'Chưa đặt'
        : `${formatBillingDecimal(data.referenceRent)} đ/tháng`,
    ];
  }
  if ('referencePrice' in data) {
    return [data.category, `${formatBillingDecimal(data.referencePrice)} đ/${data.unit}`];
  }
  if ('items' in data) return [String(data.items.length)];
  if ('referenceRate' in data) {
    const unit =
      data.unit === 'VND/month'
        ? 'tháng'
        : data.unit === 'VND/person/month'
          ? 'người/tháng'
          : data.unit;
    return [
      feeCategoryLabels[data.category] ?? data.category,
      data.scope === 'Room' ? 'Phòng' : 'Cơ sở',
      feeMethodLabels[data.method] ?? data.method,
      `${formatBillingDecimal(data.referenceRate)} đ/${unit}`,
    ];
  }
  return [data.effectiveFrom.split('-').reverse().join('/')];
}

function compactDocumentSummary(resource: SharedResource, values: string[]): string[] {
  switch (resource) {
    case 'room-type-templates':
      return [`${values[0]} · ${values[1]}`, `Giá thuê tham khảo: ${values[2]}`];
    case 'asset-catalog':
      return [values[0], `Giá tham khảo: ${values[1]}`];
    case 'asset-templates':
      return [`${values[0]} loại tài sản`];
    case 'fee-templates':
      return [
        `${values[0]} · Phạm vi: ${values[1]}`,
        `Cách tính: ${values[2]}`,
        `Mức phí tham khảo: ${values[3]}`,
      ];
    case 'policy-templates':
      return [`Hiệu lực từ: ${values[0]}`];
  }
}

export function ApiConfigurationLibraryPage({ kind }: { kind: LibraryKind }) {
  const [assetTab, setAssetTab] = useState(0);
  const resource: SharedResource =
    kind === 'room'
      ? 'room-type-templates'
      : kind === 'asset'
        ? assetTab === 0
          ? 'asset-catalog'
          : 'asset-templates'
        : kind === 'fee'
          ? 'fee-templates'
          : 'policy-templates';
  return (
    <SharedLibrary
      key={resource}
      resource={resource}
      assetTabs={
        kind === 'asset' ? (
          <Tabs
            value={assetTab}
            onChange={(_, value: number) => setAssetTab(value)}
            sx={{
              minHeight: { xs: 44, sm: 36 },
              '& .MuiTab-root': { minHeight: { xs: 44, sm: 36 } },
            }}
          >
            <Tab label="Danh mục tài sản" />
            <Tab label="Gói tài sản" />
          </Tabs>
        ) : null
      }
    />
  );
}

function SharedLibrary({
  resource,
  assetTabs,
}: {
  resource: SharedResource;
  assetTabs: ReactNode;
}) {
  const { session } = useAuth();
  const api = useSharedConfigurationApi();
  const action = useSetupAction();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('lg'));
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
  const menuId = useId();
  const [rowMenu, setRowMenu] = useState<{
    anchor: HTMLElement;
    document: SharedDocument;
  } | null>(null);
  const query = useQuery({
    queryKey: ['property-setup', 'shared', session?.userId, resource, search, status, page],
    queryFn: ({ signal }) => api.list(resource, search, status, page + 1, 20, signal),
    enabled: canManage,
  });
  if (!canManage)
    return <Alert severity="warning">Chỉ Chủ trọ được quản lý thư viện cấu hình.</Alert>;

  const columns = resourceColumns[resource];
  const selected = rowMenu?.document;
  const closeMenu = () => setRowMenu(null);
  const runMenuAction = (callback: (document: SharedDocument) => void) => {
    if (selected) callback(selected);
    closeMenu();
  };

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle || undefined}
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={17} />}
            onClick={() => setEditor({ document: null })}
          >
            {meta.action}
          </Button>
        }
      />
      {assetTabs}
      <SetupActionFeedback error={editor ? '' : action.error} notice={action.notice} />
      <Paper variant="outlined" sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{
            p: 1.5,
            alignItems: { sm: 'center' },
            borderBottom: '1px solid',
            borderColor: 'divider',
            '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 } },
          }}
        >
          <TextField
            size="small"
            fullWidth
            value={search}
            placeholder={meta.search}
            sx={{ maxWidth: { sm: 360 } }}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            slotProps={{
              htmlInput: { 'aria-label': meta.search },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            size="small"
            select
            fullWidth={false}
            label="Trạng thái"
            value={status}
            sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="">Tất cả trạng thái</MenuItem>
            <MenuItem value="Draft">Bản nháp</MenuItem>
            <MenuItem value="Published">Đã công bố</MenuItem>
            <MenuItem value="Archived">Đã lưu trữ</MenuItem>
          </TextField>
          {query.data && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
              {query.data.total.toLocaleString('vi-VN')} kết quả
            </Typography>
          )}
        </Stack>

        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
            <Table
              size="small"
              aria-label={meta.title}
              sx={{
                minWidth: { xs: 0, lg: 640 },
                tableLayout: { xs: 'fixed', lg: 'auto' },
                '& .MuiTableCell-root': {
                  px: { xs: 1, lg: 1.5 },
                  py: { xs: 1, lg: 0.5 },
                },
                '& .MuiTableCell-head': { py: 1, whiteSpace: 'nowrap' },
                '& .MuiTableCell-body': { height: 44 },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: { xs: 0, lg: 170 } }}>
                    Tên {resource === 'asset-catalog' ? 'tài sản' : 'mẫu'}
                  </TableCell>
                  {!compact && (
                    <>
                      {columns.map((column) => (
                        <TableCell key={column.label} align={column.numeric ? 'right' : 'left'}>
                          {column.label}
                        </TableCell>
                      ))}
                      <TableCell>Trạng thái</TableCell>
                    </>
                  )}
                  <TableCell align="right" sx={{ width: { xs: 96, lg: 'auto' } }}>
                    Thao tác
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {query.data.items.map((document) => {
                  const values = documentValues(document);
                  const statusChip = (
                    <Chip
                      size="small"
                      color={document.status === 'Published' ? 'success' : 'default'}
                      variant={document.status === 'Published' ? 'filled' : 'outlined'}
                      label={statusLabel(document.status)}
                    />
                  );
                  return (
                    <TableRow key={document.id} hover>
                      <TableCell component="th" scope="row" sx={{ minWidth: 0 }}>
                        <Box sx={{ maxWidth: { xs: '100%', lg: 280 }, minWidth: 0 }}>
                          <Button
                            size="small"
                            onClick={() => setDetails(document.id)}
                            sx={{
                              p: 0,
                              minWidth: 0,
                              maxWidth: '100%',
                              textAlign: 'left',
                              justifyContent: 'flex-start',
                              fontWeight: 650,
                              minHeight: { xs: 44, sm: 24 },
                            }}
                          >
                            <Typography
                              component="span"
                              variant="body2"
                              sx={{ fontWeight: 'inherit', overflowWrap: 'anywhere', minWidth: 0 }}
                              noWrap={!compact}
                              title={document.name}
                            >
                              {document.name}
                            </Typography>
                          </Button>
                          {document.description && (
                            <Typography
                              component="div"
                              variant="caption"
                              color="text.secondary"
                              noWrap={!compact}
                              title={document.description}
                              sx={{ lineHeight: 1.25, overflowWrap: 'anywhere' }}
                            >
                              {document.description}
                            </Typography>
                          )}
                          {compact && (
                            <Stack
                              spacing={0.5}
                              sx={{ mt: 0.75, alignItems: 'flex-start', minWidth: 0 }}
                            >
                              {statusChip}
                              {compactDocumentSummary(resource, values).map((line, index) => (
                                <Typography
                                  key={index}
                                  component="div"
                                  variant="body2"
                                  sx={{
                                    overflowWrap: 'anywhere',
                                    lineHeight: 1.4,
                                    fontVariantNumeric: 'tabular-nums',
                                    maxWidth: '100%',
                                  }}
                                >
                                  {line}
                                </Typography>
                              ))}
                            </Stack>
                          )}
                        </Box>
                      </TableCell>
                      {!compact && (
                        <>
                          {values.map((value, index) => (
                            <TableCell
                              key={columns[index].label}
                              align={columns[index].numeric ? 'right' : 'left'}
                              sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {value}
                            </TableCell>
                          ))}
                          <TableCell>{statusChip}</TableCell>
                        </>
                      )}
                      <TableCell align="right" sx={{ verticalAlign: { xs: 'top', lg: 'middle' } }}>
                        <Stack
                          direction={{ xs: 'column', lg: 'row' }}
                          spacing={0.5}
                          sx={{
                            justifyContent: 'flex-end',
                            alignItems: { xs: 'flex-end', lg: 'center' },
                          }}
                        >
                          {document.status === 'Published' && resource !== 'asset-catalog' && (
                            <Button
                              size="small"
                              onClick={() => setDetails(document.id)}
                              sx={{ whiteSpace: 'nowrap', minHeight: { xs: 44, lg: 30 } }}
                            >
                              Áp dụng
                            </Button>
                          )}
                          <IconButton
                            size="small"
                            aria-label={`Thao tác cho ${document.name}`}
                            aria-haspopup="menu"
                            aria-controls={selected?.id === document.id ? menuId : undefined}
                            aria-expanded={selected?.id === document.id}
                            onClick={(event) =>
                              setRowMenu({ anchor: event.currentTarget, document })
                            }
                            sx={{ minWidth: { xs: 44, lg: 32 }, minHeight: { xs: 44, lg: 32 } }}
                          >
                            <MoreHorizontal size={20} />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState message="Không tìm thấy mẫu phù hợp" />
        )}
        {query.data && query.data.total > 0 && (
          <TablePagination
            component="div"
            count={query.data.total}
            page={page}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
            onPageChange={(_, next) => setPage(next)}
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
          />
        )}
      </Paper>
      <Menu
        anchorEl={rowMenu?.anchor}
        open={!!rowMenu}
        onClose={closeMenu}
        slotProps={{
          list: {
            id: menuId,
            'aria-label': selected ? `Thao tác cho ${selected.name}` : undefined,
          },
        }}
      >
        <MenuItem onClick={() => runMenuAction((document) => setDetails(document.id))}>
          Xem chi tiết
        </MenuItem>
        {selected?.status === 'Draft' && (
          <MenuItem
            disabled={action.busy}
            onClick={() => runMenuAction((document) => setEditor({ document }))}
          >
            Sửa
          </MenuItem>
        )}
        {selected?.status === 'Draft' && (
          <MenuItem
            disabled={action.busy}
            onClick={() =>
              runMenuAction((document) =>
                action.run(
                  () => api.publish(resource, document.id, document.version),
                  'Đã công bố phiên bản trên máy chủ.',
                ),
              )
            }
          >
            Công bố
          </MenuItem>
        )}
        {selected?.status === 'Published' && (
          <MenuItem
            disabled={action.busy}
            onClick={() =>
              runMenuAction((document) =>
                action.run(
                  () => api.edition(resource, document.id, document.version),
                  'Đã tạo bản nháp phiên bản mới.',
                ),
              )
            }
          >
            Phiên bản mới
          </MenuItem>
        )}
        {selected && selected.status !== 'Archived' && (
          <MenuItem
            disabled={action.busy}
            onClick={() =>
              runMenuAction((document) => {
                setDuplicate(document);
                setDuplicateName(`${document.name} (bản sao)`);
              })
            }
          >
            Nhân bản
          </MenuItem>
        )}
        {selected && selected.status !== 'Archived' && (
          <MenuItem disabled={action.busy} onClick={() => runMenuAction(setArchive)}>
            Lưu trữ
          </MenuItem>
        )}
        {selected?.status === 'Archived' && (
          <MenuItem
            disabled={action.busy}
            onClick={() =>
              runMenuAction((document) =>
                action.run(
                  () => api.restore(resource, document.id, document.version),
                  'Đã khôi phục mẫu thành bản nháp để tiếp tục chỉnh sửa.',
                ),
              )
            }
          >
            Hoàn tác lưu trữ
          </MenuItem>
        )}
      </Menu>

      {editor && (
        <SharedTemplateEditor
          key={editor.document?.id ?? 'new'}
          resource={resource}
          document={editor.document}
          busy={action.busy}
          error={action.error}
          close={() => setEditor(null)}
          save={(input) =>
            action.run(async () => {
              await api.save(resource, editor.document?.id ?? null, input);
              setEditor(null);
            }, 'Đã lưu bản nháp trên máy chủ.')
          }
        />
      )}
      {!!details && (
        <SharedTemplateDetails resource={resource} id={details} close={() => setDetails('')} />
      )}
      <ConfirmDialog
        open={!!archive}
        title="Lưu trữ mẫu?"
        busy={action.busy}
        onClose={() => setArchive(null)}
        onConfirm={() => {
          if (archive)
            action.run(async () => {
              await api.archive(resource, archive.id, archive.version);
              setArchive(null);
            }, 'Đã lưu trữ mẫu.');
        }}
      >
        Phiên bản đã áp dụng tại cơ sở và lịch sử vẫn được giữ lại.
      </ConfirmDialog>
      <Dialog
        open={!!duplicate}
        onClose={() => {
          if (!action.busy) setDuplicate(null);
        }}
      >
        <DialogTitle>Nhân bản thành mẫu độc lập</DialogTitle>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (duplicate)
              action.run(async () => {
                await api.duplicate(resource, duplicate.id, duplicateName, duplicate.version);
                setDuplicate(null);
              }, 'Đã lưu bản sao trên máy chủ.');
          }}
        >
          <DialogContent>
            <Stack spacing={2}>
              {action.error && <Alert severity="error">{action.error}</Alert>}
              <TextField
                required
                label="Tên bản sao"
                value={duplicateName}
                onChange={(event) => setDuplicateName(event.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={action.busy} onClick={() => setDuplicate(null)}>
              Hủy
            </Button>
            <Button disabled={action.busy} type="submit">
              Nhân bản
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Stack>
  );
}
