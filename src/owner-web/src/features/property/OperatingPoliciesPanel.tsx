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
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';

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
  return (
    <LocationSection
      title="Nội quy cơ sở"
      description="Soạn bản nháp, xem trước nội dung, công bố và tra cứu lịch sử. Chỉ nội quy đã công bố mới được dùng cho các thỏa thuận mới."
    >
      <Alert severity="info">
        Công bố nội quy mới không thay thế nội quy đã ký. Hợp đồng cũ chỉ thay đổi qua phụ lục được
        ký và Owner áp dụng.
      </Alert>
      {owner && (
        <Button
          onClick={() => {
            setEditing(null);
            setCopied(undefined);
          }}
        >
          Tạo bản nháp nội quy
        </Button>
      )}
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            fullWidth
            label="Tìm nội quy"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <TextField
            select
            label="Trạng thái"
            sx={{ minWidth: 180 }}
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
      {!policies.data.length && (
        <LocationEmpty
          title="Chưa có nội quy"
          description="Tạo bản nháp để chuẩn bị nội dung áp dụng tại cơ sở."
        />
      )}
      {policies.data
        .filter(
          (policy) =>
            (!status || policy.status === status) &&
            `${policy.data.title} ${policy.data.content}`
              .toLocaleLowerCase('vi')
              .includes(search.toLocaleLowerCase('vi')),
        )
        .map((policy) => (
          <Paper key={policy.id} sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Typography variant="h6">{policy.data.title}</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip
                  size="small"
                  color={policy.status === 'Published' ? 'success' : 'default'}
                  label={policy.status === 'Published' ? 'Đã công bố' : 'Bản nháp'}
                />
                <Typography variant="body2" color="text.secondary">
                  Phiên bản {policy.version} · Hiệu lực{' '}
                  {policy.data.effectiveFrom.split('-').reverse().join('/')}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {policy.data.content}
              </Typography>
              <Stack direction="row" spacing={1}>
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
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          action.run(
                            () => api.publishPolicy(policy.id, policy.version),
                            'Máy chủ đã công bố nội quy. Hợp đồng đã ký được giữ nguyên.',
                          )
                        }
                      >
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
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Hiệu lực từ {preview?.data.effectiveFrom}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>
            {preview?.data.content}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!historyId} onClose={() => setHistoryId('')} fullWidth maxWidth="md">
        <DialogTitle>Lịch sử phiên bản nội quy</DialogTitle>
        <DialogContent>
          {historyId && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6">Lịch sử sửa đổi của nội quy đã chọn</Typography>
              {history.isPending ? (
                <LoadingState />
              ) : history.error ? (
                <ErrorState error={history.error} retry={() => void history.refetch()} />
              ) : (
                history.data?.map((revision) => (
                  <Stack key={revision.version} spacing={1} sx={{ py: 1 }}>
                    <Typography>
                      Phiên bản {revision.version} · {revision.status} ·{' '}
                      {revision.recordedAt
                        ? new Date(revision.recordedAt).toLocaleString('vi-VN')
                        : ''}
                    </Typography>
                    <Typography>{revision.data.title}</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>{revision.data.content}</Typography>
                  </Stack>
                ))
              )}
            </Paper>
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
