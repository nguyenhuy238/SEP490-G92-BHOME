import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ChartCard } from '../../components/common/PortalUI';

export function ContractConfigurationPanel({ api }: { api: ContractClient }) {
  const query = useQuery({
    queryKey: ['contract-configuration'],
    queryFn: ({ signal }) => api.configuration(signal),
  });
  return (
    <ChartCard title="Cấu hình hợp đồng" subtitle="Mẫu và chế độ ký đang được máy chủ cho phép">
      {query.isFetching && <LinearProgress />}
      {query.error && (
        <Alert severity="error">
          {contractError(query.error)}
          <Button onClick={() => void query.refetch()}>Thử lại</Button>
        </Alert>
      )}
      {query.data && (
        <Stack spacing={1}>
          <Typography>
            {query.data.template.title} · phiên bản {query.data.template.version}
          </Typography>
          <Alert severity={query.data.template.developmentOnly ? 'warning' : 'info'}>
            {query.data.template.notice}
          </Alert>
          <Typography>Trường tài liệu: {query.data.template.fields.join(', ')}</Typography>
          <Typography>
            Chế độ ký:{' '}
            {query.data.signingMode === 'Simulated'
              ? 'SIMULATED SIGNING — không có giá trị pháp lý'
              : 'Nhà cung cấp điện tử'}
          </Typography>
          {!query.data.template.available && (
            <Alert severity="warning">{text(query.data.template.blocker ?? '')}</Alert>
          )}
          <Alert severity="info">{text(query.data.holdingBlocker)}</Alert>
        </Stack>
      )}
    </ChartCard>
  );
}

export function ContractWorkflowPanel({
  api,
  contract,
}: {
  api: ContractClient;
  contract: ContractView;
}) {
  const id = contract.id;
  const query = useQuery({
    queryKey: [
      'contract-workflow',
      id,
      contract.status,
      contract.signatures.map((s) => s.status).join(','),
    ],
    queryFn: async ({ signal }) => {
      const [previews, deposits, audit] = await Promise.all([
        api.previews(id, signal),
        api.deposits(id, signal),
        api.audit(id, signal),
      ]);
      return { previews, deposits, audit };
    },
  });
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(contractError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      {query.isFetching && <LinearProgress />}
      {query.error && (
        <Alert severity="error">
          {contractError(query.error)}
          <Button onClick={() => void query.refetch()}>Tải lại tài liệu và lịch sử</Button>
        </Alert>
      )}
      {!!error && <Alert severity="error">{error}</Alert>}
      <Button disabled={query.isFetching || busy} onClick={() => void query.refetch()}>
        Tải lại tài liệu và lịch sử
      </Button>
      <ChartCard title="PDF xem trước" subtitle="Tạo từ bản nội dung đã niêm phong trên máy chủ">
        <Stack spacing={1}>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.mutate(id, 'previews', undefined, keys.get('preview', id));
                keys.confirmed('preview', id);
                await query.refetch();
              })
            }
          >
            Tạo / lấy bản PDF xem trước
          </Button>
          {!query.data?.previews.length && <Typography>Chưa tạo bản xem trước.</Typography>}
          {query.data?.previews.map((f) => (
            <Stack key={f.id} spacing={1}>
              <Typography>
                {f.templateId} · v{f.templateVersion} · {formatInstant(f.recordedAt)}
                {f.developmentOnly ? ' · DEVELOPMENT' : ''}
              </Typography>
              <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                SHA-256 snapshot: {f.snapshotHash}
              </Typography>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => setUrl(URL.createObjectURL(await api.preview(id, f.id))))
                }
              >
                Xem PDF
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const source = URL.createObjectURL(await api.preview(id, f.id));
                    const a = document.createElement('a');
                    a.href = source;
                    a.download = `hop-dong-xem-truoc-v${f.templateVersion}.pdf`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(source), 1000);
                  })
                }
              >
                Tải PDF xem trước
              </Button>
            </Stack>
          ))}
          {url && (
            <iframe
              title="Bản PDF hợp đồng từ máy chủ"
              src={url}
              style={{ width: '100%', height: 600, border: 0 }}
            />
          )}
        </Stack>
      </ChartCard>
      <ChartCard
        title="Lịch sử xác minh cọc"
        subtitle="Giao dịch đã được Owner đối chiếu; không dựa vào ảnh chuyển khoản"
      >
        {!query.data?.deposits.length && <Typography>Chưa có khoản cọc được xác minh.</Typography>}
        {query.data?.deposits.map((d) => (
          <Stack key={d.id} sx={{ mb: 2 }}>
            <Typography>
              {formatContractMoney(d.amount)} · {d.bankTransactionReference}
            </Typography>
            <Typography>{d.verificationReason}</Typography>
            <Typography variant="caption">{formatInstant(d.verifiedAt)}</Typography>
          </Stack>
        ))}
      </ChartCard>
      <ChartCard title="Lịch sử hợp đồng" subtitle="Sự kiện do máy chủ ghi nhận">
        {!query.data?.audit.length && <Typography>Chưa có sự kiện.</Typography>}
        {query.data?.audit.map((a, i) => (
          <Typography key={i}>
            {formatInstant(a.occurredAt)} · {text(a.action)}
          </Typography>
        ))}
      </ChartCard>
    </Stack>
  );
}
