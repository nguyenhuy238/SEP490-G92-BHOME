import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { LocationSection, LocationEmpty } from '../locations/components/LocationSection';
import { ConflictReload } from '../locations/components/ConflictReload';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  OperatingPolicyInput,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { ConfirmDialog, ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';

const policyStatusLabel = (status: string) =>
  status === 'Published' ? 'Đã công bố' : status === 'Draft' ? 'Bản nháp' : status;
const policyDateLabel = (date: string) => date.split('-').reverse().join('/');

export function OperatingPoliciesPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const action = useSetupAction();
  const owner = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<SetupDocument<OperatingPolicyInput> | null | undefined>();
  const [copied, setCopied] = useState<OperatingPolicyInput | undefined>();
  const [historyId, setHistoryId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<SetupDocument<OperatingPolicyInput> | null>(null);
  const [publishing, setPublishing] = useState<SetupDocument<OperatingPolicyInput> | null>(null);
  const policies = useQuery({
    queryKey: ['property-setup', 'policies', session?.userId, locationId],
    queryFn: ({ signal }) => api.policies(locationId, signal),
  });
  const history = useQuery({
    queryKey: ['property-setup', 'policy-history', session?.userId, historyId],
    queryFn: ({ signal }) => api.policyRevisions(historyId, signal),
    enabled: !!historyId,
  });
  if (policies.isPending) return <LoadingState />;
  if (policies.error)
    return <ErrorState error={policies.error} retry={() => void policies.refetch()} />;
  const filtered = policies.data.filter(
    (policy) =>
      (!status || policy.status === status) &&
      `${policy.data.title} ${policy.data.content}`
        .toLocaleLowerCase('vi')
        .includes(search.trim().toLocaleLowerCase('vi')),
  );
  return (
    <LocationSection
      title="Nội quy cơ sở"
      actions={
        owner ? (
          <Button
            variant="contained"
            onClick={() => {
              setEditing(null);
              setCopied(undefined);
            }}
          >
            Tạo bản nháp nội quy
          </Button>
        ) : undefined
      }
    >
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' } }}
        >
          <TextField
            fullWidth
            size="small"
            label="Tìm nội quy"
            sx={{ flex: { sm: '1 1 220px' }, minWidth: 0, maxWidth: { sm: 360 } }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Trạng thái"
            fullWidth={false}
            sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <MenuItem value="">Tất cả</MenuItem>
            <MenuItem value="Draft">Bản nháp</MenuItem>
            <MenuItem value="Published">Đã công bố</MenuItem>
          </TextField>
          <Button onClick={() => void policies.refetch()}>Làm mới</Button>
        </Stack>
      </Paper>
      {!filtered.length && (
        <LocationEmpty
          title={policies.data.length ? 'Không tìm thấy nội quy phù hợp' : 'Chưa có nội quy'}
          description={
            policies.data.length
              ? 'Thử đổi từ khóa hoặc trạng thái.'
              : 'Tạo bản nháp để chuẩn bị nội dung áp dụng tại cơ sở.'
          }
        />
      )}
      {filtered.map((policy) => (
        <Paper key={policy.id} variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={1.5}>
            <Typography
              component="h3"
              variant="h6"
              sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}
            >
              {policy.data.title}
            </Typography>
            <Stack
              direction="row"
              useFlexGap
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Chip
                size="small"
                color={policy.status === 'Published' ? 'success' : 'default'}
                label={policyStatusLabel(policy.status)}
              />
              <Typography variant="body2" color="text.secondary">
                Hiệu lực {policyDateLabel(policy.data.effectiveFrom)}
              </Typography>
            </Stack>
            <Typography
              sx={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {policy.data.content}
            </Typography>
            <Stack
              direction="row"
              sx={{
                flexWrap: 'wrap',
                gap: 1,
                pt: 1.5,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Button variant="outlined" onClick={() => setPreview(policy)}>
                Xem nội dung
              </Button>
              <Button onClick={() => setHistoryId(policy.id)}>Lịch sử sửa đổi</Button>
              {owner &&
                (policy.status === 'Draft' ? (
                  <>
                    <Button
                      onClick={() => {
                        setCopied(undefined);
                        setEditing(policy);
                      }}
                    >
                      Sửa nội quy nháp
                    </Button>
                    <Button disabled={action.busy} onClick={() => setPublishing(policy)}>
                      Công bố nội quy
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => {
                      setCopied({ ...policy.data, effectiveFrom: '', expectedVersion: 0 });
                      setEditing(null);
                    }}
                  >
                    Tạo nội quy mới từ bản này
                  </Button>
                ))}
            </Stack>
          </Stack>
        </Paper>
      ))}
      <Dialog open={editing !== undefined} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Sửa bản nháp nội quy' : 'Soạn nội quy mới'}</DialogTitle>
        <DialogContent>
          {editing !== undefined && (
            <PolicyEditor
              key={editing?.id ?? `${copied?.title ?? 'new'}`}
              locationId={locationId}
              document={editing}
              initial={copied}
              onClose={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!preview} onClose={() => setPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>{preview?.data.title}</DialogTitle>
        <DialogContent>
          {preview && (
            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <Chip size="small" variant="outlined" label={policyStatusLabel(preview.status)} />
              <Typography variant="body2" color="text.secondary">
                Phiên bản {preview.version} · Hiệu lực từ{' '}
                {policyDateLabel(preview.data.effectiveFrom)}
              </Typography>
            </Stack>
          )}
          <Divider sx={{ mb: 2 }} />
          <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>
            {preview?.data.content}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={!!publishing}
        title="Công bố nội quy?"
        busy={action.busy}
        onClose={() => setPublishing(null)}
        onConfirm={() => {
          if (!publishing) return;
          action.run(async () => {
            await api.publishPolicy(publishing.id, publishing.version);
            setPublishing(null);
          }, 'Máy chủ đã công bố nội quy. Hợp đồng đã ký được giữ nguyên.');
        }}
      >
        {publishing && (
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>{publishing.data.title}</Typography>
            <Typography variant="body2">
              Phiên bản {publishing.version} · Hiệu lực từ{' '}
              {policyDateLabel(publishing.data.effectiveFrom)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Nội quy mới dùng cho các thỏa thuận mới. Hợp đồng đã ký giữ nguyên nội dung; thay đổi
              chỉ qua phụ lục đã ký và được Owner áp dụng.
            </Typography>
            {action.error && <Alert severity="error">{action.error}</Alert>}
          </Stack>
        )}
      </ConfirmDialog>
      <Dialog open={!!historyId} onClose={() => setHistoryId('')} fullWidth maxWidth="md">
        <DialogTitle>Lịch sử phiên bản nội quy</DialogTitle>
        <DialogContent>
          {historyId && (
            <Stack spacing={2}>
              {history.isPending ? (
                <LoadingState />
              ) : history.error ? (
                <ErrorState error={history.error} retry={() => void history.refetch()} />
              ) : history.data?.length ? (
                history.data.map((revision) => (
                  <Stack
                    key={revision.version}
                    spacing={1}
                    sx={{ py: 2, borderTop: '1px solid', borderColor: 'divider' }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>
                      Phiên bản {revision.version} · {policyStatusLabel(revision.status)} ·{' '}
                      {revision.recordedAt
                        ? new Date(revision.recordedAt).toLocaleString('vi-VN', {
                            timeZone: 'Asia/Ho_Chi_Minh',
                          })
                        : ''}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Hiệu lực từ {policyDateLabel(revision.data.effectiveFrom)}
                    </Typography>
                    <Typography sx={{ fontWeight: 700 }}>{revision.data.title}</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>{revision.data.content}</Typography>
                  </Stack>
                ))
              ) : (
                <Typography color="text.secondary">Chưa có lịch sử phiên bản.</Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryId('')}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </LocationSection>
  );
}

function PolicyEditor({
  locationId,
  document,
  initial,
  onClose,
}: {
  locationId: string;
  document: SetupDocument<OperatingPolicyInput> | null;
  initial?: OperatingPolicyInput;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const source = document?.data ?? initial;
  const [title, setTitle] = useState(source?.title ?? '');
  const [content, setContent] = useState(source?.content ?? '');
  const [date, setDate] = useState(source?.effectiveFrom ?? '');
  const [version, setVersion] = useState(document?.version ?? 0);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.savePolicy(document?.id ?? null, {
              locationId,
              title,
              content,
              effectiveFrom: date,
              expectedVersion: version,
            });
            onClose();
          }, 'Máy chủ đã lưu bản nháp nội quy.');
        }}
      >
        <TextField
          required
          label="Tên nội quy"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextField
          required
          multiline
          minRows={4}
          label="Nội dung nội quy"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <TextField
          required
          type="date"
          label="Ngày hiệu lực nội quy"
          slotProps={{ inputLabel: { shrink: true } }}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        {action.error && <Alert severity="error">{action.error}</Alert>}
        {document && (
          <ConflictReload
            error={action.rawError}
            reload={async () => {
              const latest = await api.request<SetupDocument<OperatingPolicyInput>>(
                `/api/v1/operating-policies/${encodeURIComponent(document.id)}`,
              );
              setTitle(latest.data.title);
              setContent(latest.data.content);
              setDate(latest.data.effectiveFrom);
              setVersion(latest.version);
            }}
          />
        )}
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={action.busy}>
            Lưu nội quy nháp
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng bản sửa
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
