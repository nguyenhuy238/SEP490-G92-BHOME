import { useState } from 'react';
import { Alert, Button, Paper, Stack, TextField, Typography } from '@mui/material';
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
    <Stack spacing={2}>
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
      {!policies.data.length && <Typography>Chưa có nội quy.</Typography>}
      {policies.data.map((policy) => (
        <Paper key={policy.id} sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="h6">{policy.data.title}</Typography>
            <Typography>
              {policy.status} · Phiên bản tài liệu {policy.version} · Hiệu lực{' '}
              {policy.data.effectiveFrom}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{policy.data.content}</Typography>
            <Stack direction="row" spacing={1}>
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
      {editing !== undefined && (
        <PolicyEditor
          key={editing?.id ?? `${copied?.title ?? 'new'}`}
          locationId={locationId}
          document={editing}
          initial={copied}
          onClose={() => setEditing(undefined)}
        />
      )}
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
                  {revision.recordedAt ? new Date(revision.recordedAt).toLocaleString('vi-VN') : ''}
                </Typography>
                <Typography>{revision.data.title}</Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{revision.data.content}</Typography>
              </Stack>
            ))
          )}
        </Paper>
      )}
    </Stack>
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
              expectedVersion: document?.version ?? 0,
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
