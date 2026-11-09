import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
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
import { SharedTemplateEditor } from './SharedTemplateEditor';
import { SharedTemplateDetails } from './SharedTemplateDetails';
import type { LibraryKind } from './ConfigurationLibraryPage';

export function ApiConfigurationLibraryPage({ kind }: { kind: LibraryKind }) {
  const [tab, setTab] = useState(0);
  const resource: SharedResource =
    kind === 'room'
      ? 'room-type-templates'
      : kind === 'asset'
        ? tab === 0
          ? 'asset-catalog'
          : 'asset-templates'
        : kind === 'fee'
          ? 'fee-templates'
          : 'policy-templates';
  return (
    <Stack spacing={2}>
      {kind === 'asset' && (
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
          <Tab label="Danh mục tài sản" />
          <Tab label="Gói tài sản" />
        </Tabs>
      )}
      <SharedLibrary key={resource} resource={resource} />
    </Stack>
  );
}
function SharedLibrary({ resource }: { resource: SharedResource }) {
  const { session } = useAuth();
  const api = useSharedConfigurationApi();
  const action = useSetupAction();
  const canManage = session?.roles.includes('Owner') ?? false;
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
    queryFn: ({ signal }) => api.list(resource, search, status, page + 1, 20, signal),
    enabled: canManage,
  });
  if (!canManage)
    return <Alert severity="warning">Chỉ Chủ trọ được quản lý thư viện cấu hình.</Alert>;
  const title =
    resource === 'room-type-templates'
      ? 'Mẫu cấu hình phòng'
      : resource === 'asset-catalog'
        ? 'Danh mục tài sản dùng chung'
        : resource === 'asset-templates'
          ? 'Gói tài sản dùng chung'
          : resource === 'fee-templates'
            ? 'Mẫu giá và biểu phí'
            : 'Mẫu nội quy';
  return (
    <Stack spacing={2}>
      <PageHeader
        title={title}
        subtitle="Thư viện dùng chung · áp dụng tạo cấu hình độc lập tại cơ sở."
        actions={
          <Button variant="contained" onClick={() => setEditor({ document: null })}>
            Tạo mẫu
          </Button>
        }
      />
      <SetupActionFeedback error={editor ? '' : action.error} notice={action.notice} />
      <Stack direction="row" spacing={2}>
        <TextField
          label="Tìm mẫu"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <TextField
          select
          label="Trạng thái"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Tất cả phiên bản</MenuItem>
          <MenuItem value="Draft">Bản nháp</MenuItem>
          <MenuItem value="Published">Đã công bố</MenuItem>
          <MenuItem value="Archived">Đã lưu trữ</MenuItem>
        </TextField>
      </Stack>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data?.items.length ? (
        <Paper sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Tên</TableCell>
                <TableCell>Phiên bản</TableCell>
                <TableCell>Trạng thái</TableCell>
                <TableCell>Thao tác</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {query.data.items.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{document.name}</Typography>
                    <Typography variant="body2">{document.description}</Typography>
                  </TableCell>
                  <TableCell>
                    {document.edition} · lần cập nhật {document.version}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={
                        document.status === 'Draft'
                          ? 'Bản nháp'
                          : document.status === 'Published'
                            ? 'Đã công bố'
                            : 'Đã lưu trữ'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                      <Button onClick={() => setDetails(document.id)}>Xem và áp dụng</Button>
                      {document.status === 'Draft' && (
                        <>
                          <Button disabled={action.busy} onClick={() => setEditor({ document })}>
                            Sửa
                          </Button>
                          <Button
                            disabled={action.busy}
                            onClick={() =>
                              action.run(
                                () => api.publish(resource, document.id, document.version),
                                'Đã công bố phiên bản trên máy chủ.',
                              )
                            }
                          >
                            Công bố
                          </Button>
                        </>
                      )}
                      {document.status === 'Published' && (
                        <Button
                          disabled={action.busy}
                          onClick={() =>
                            action.run(
                              () => api.edition(resource, document.id, document.version),
                              'Đã tạo bản nháp phiên bản mới.',
                            )
                          }
                        >
                          Phiên bản mới
                        </Button>
                      )}
                      {document.status !== 'Archived' && (
                        <>
                          <Button
                            disabled={action.busy}
                            onClick={() => {
                              setDuplicate(document);
                              setDuplicateName(document.name + ' (bản sao)');
                            }}
                          >
                            Nhân bản
                          </Button>
                          <Button disabled={action.busy} onClick={() => setArchive(document)}>
                            Lưu trữ
                          </Button>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={query.data.total}
            page={page}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
            onPageChange={(_, next) => setPage(next)}
          />
        </Paper>
      ) : (
        <EmptyState message="Chưa có mẫu phù hợp" />
      )}
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
          onSubmit={(e) => {
            e.preventDefault();
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
                onChange={(e) => setDuplicateName(e.target.value)}
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
