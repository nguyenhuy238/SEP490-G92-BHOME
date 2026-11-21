import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, LinearProgress, Stack, Tab, Tabs, Typography } from '@mui/material';
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
  const versions = useQuery({
    queryKey: ['contract-versions', id, contract.status],
    queryFn: ({ signal }) => api.versions(id, signal),
  });
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
  const [tab, setTab] = useState(0);
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
  const deposits = query.data?.deposits ?? [],
    audit = query.data?.audit ?? [],
    previews = query.data?.previews ?? [];
  return (
    <ChartCard
      title="Tài liệu và lịch sử"
      action={
        <Button
          size="small"
          disabled={query.isFetching || busy}
          onClick={() => void query.refetch()}
        >
          Tải lại tài liệu và lịch sử
        </Button>
      }
    >
      <Tabs
        value={tab}
        onChange={(_, next: number) => setTab(next)}
        variant="scrollable"
        sx={{ minHeight: 36, mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab sx={{ minHeight: 36 }} label={`Lịch sử (${audit.length})`} />
        <Tab sx={{ minHeight: 36 }} label={`Phiên bản (${versions.data?.length ?? 0})`} />
        <Tab sx={{ minHeight: 36 }} label={`PDF xem trước (${previews.length})`} />
        <Tab sx={{ minHeight: 36 }} label={`Cọc đã xác minh (${deposits.length})`} />
      </Tabs>
      {query.isFetching && <LinearProgress />}
      {query.error && (
        <Alert severity="error">
          {contractError(query.error)}
          <Button onClick={() => void query.refetch()}>Tải lại tài liệu và lịch sử</Button>
        </Alert>
      )}
      {!!error && <Alert severity="error">{error}</Alert>}
      {tab === 0 && (
        <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
          {!audit.length && <Typography color="text.secondary">Chưa có sự kiện.</Typography>}
          {[...audit].reverse().map((a, i) => (
            <Stack component="li" direction="row" spacing={1.5} key={i}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 130 }}>
                {formatInstant(a.occurredAt)}
              </Typography>
              <Typography variant="body2">{text(a.action)}</Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {tab === 1 && (
        <Stack spacing={1.5}>
          {versions.error && (
            <Alert severity="error">
              {contractError(versions.error)}
              <Button onClick={() => void versions.refetch()}>Tải lại phiên bản</Button>
            </Alert>
          )}
          {versions.data?.map((v) => (
            <Box key={v.id}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {text(v.kind)} · {text(v.status)} · {v.startDate} → {v.endDate}
                {v.monthlyRent === null ? '' : ` · ${formatContractMoney(v.monthlyRent)}`}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {v.terms}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
      {tab === 2 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Bản PDF tạo từ nội dung đã niêm phong trên máy chủ, trước khi ký.
          </Typography>
          <Box>
            <Button
              variant="outlined"
              size="small"
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
          </Box>
          {!previews.length && <Typography>Chưa tạo bản xem trước.</Typography>}
          {previews.map((f) => (
            <Stack
              key={f.id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography variant="body2">
                {f.templateId} · v{f.templateVersion} · {formatInstant(f.recordedAt)}
                {f.developmentOnly ? ' · DEVELOPMENT' : ''}
              </Typography>
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  void run(async () => setUrl(URL.createObjectURL(await api.preview(id, f.id))))
                }
              >
                Xem PDF
              </Button>
              <Button
                size="small"
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
      )}
      {tab === 3 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Giao dịch Owner đã đối chiếu với ngân hàng; không dựa vào ảnh chuyển khoản.
          </Typography>
          {!deposits.length && <Typography>Chưa có khoản cọc được xác minh.</Typography>}
          {deposits.map((d) => (
            <Box key={d.id}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {formatContractMoney(d.amount)} · {d.bankTransactionReference} ·{' '}
                {formatInstant(d.verifiedAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {d.verificationReason}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
    </ChartCard>
  );
}
