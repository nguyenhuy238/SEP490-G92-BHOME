import { useState } from 'react';
import { Alert, Button, MenuItem, Paper, Stack, Tab, Tabs, TextField } from '@mui/material';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { displayContractDate, text } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader, FilterToolbar, StatusChip } from '../../../components/common/PortalUI';
import { OwnerTable, OwnerPagination } from '../../../components/common/OwnerWorkspace';
import { useContractsApi, useSigningApi } from '../useContractsApi';
import { SigningCertificates } from '../SigningCertificates';
import { SignatureImagePanel } from '../SignatureImagePanel';
import { ViettelSettingsPanel } from '../ViettelSettingsPanel';
import { ContractDetailPanel } from '../ContractDetailPanel';
import { isMockMode } from '../../../services/config';

export default function DigitalSigningPage() {
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Ký số hợp đồng (Viettel MySign)"
        subtitle="Theo dõi hồ sơ cần ký, kiểm tra chữ ký và tài liệu trước khi kích hoạt hợp đồng."
      />
      {isMockMode ? (
        <Alert severity="info">Ký số chỉ hoạt động ở chế độ API.</Alert>
      ) : (
        <LiveDigitalSigningPage />
      )}
    </Stack>
  );
}

function LiveDigitalSigningPage() {
  const api = useContractsApi();
  const signing = useSigningApi(api);
  const { session } = useAuth();
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState('PendingSigning');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const list = useQuery({
    queryKey: ['contracts', session?.userId, 'signing', page, status],
    enabled: tab === 0 && !!session?.roles.includes('Owner'),
    queryFn: ({ signal }) => api.list(page, status, '', signal),
  });
  return (
    <>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        aria-label="Tác nghiệp và cấu hình ký số"
      >
        <Tab id="signing-work-tab" aria-controls="signing-work-panel" label="Hồ sơ ký hợp đồng" />
        <Tab
          id="signing-settings-tab"
          aria-controls="signing-settings-panel"
          label="Cấu hình tích hợp MySign"
        />
      </Tabs>
      {tab === 0 ? (
        <Stack
          role="tabpanel"
          id="signing-work-panel"
          aria-labelledby="signing-work-tab"
          spacing={2}
        >
          <FilterToolbar>
            <TextField
              select
              label="Trạng thái hồ sơ ký"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
                setSelected('');
              }}
            >
              <MenuItem value="PendingSigning">Chờ ký</MenuItem>
              <MenuItem value="PendingActivation">Chờ kích hoạt</MenuItem>
              <MenuItem value="Active">Đang hiệu lực</MenuItem>
              <MenuItem value="Cancelled">Đã hủy</MenuItem>
            </TextField>
            <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
              Làm mới hồ sơ ký
            </Button>
          </FilterToolbar>
          <Alert severity="info">
            Chọn hồ sơ để xem tiến độ Owner/Tenant, tài liệu và lỗi ký. Xác nhận ký được thực hiện
            qua MySign; trạng thái do máy chủ xác minh.
          </Alert>
          <Paper>
            <OwnerTable
              rows={list.data?.items ?? []}
              loading={list.isFetching}
              error={list.error}
              retry={() => void list.refetch()}
              label="Hồ sơ ký hợp đồng"
              id={(c) => c.id}
              select={(c) => setSelected(c.id)}
              columns={[
                {
                  label: 'Cơ sở / Phòng',
                  render: (c) => `${c.locationName} · Phòng ${c.roomNumber}`,
                },
                { label: 'Loại hợp đồng', render: (c) => text(c.kind) },
                {
                  label: 'Kỳ thuê',
                  render: (c) =>
                    `${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`,
                },
                { label: 'Trạng thái', render: (c) => <StatusChip label={text(c.status)} /> },
              ]}
            />
          </Paper>
          <OwnerPagination
            page={page}
            total={list.data?.totalCount ?? 0}
            change={setPage}
            busy={list.isFetching}
          />
          {selected && (
            <>
              <Button onClick={() => setSelected('')}>Đóng hồ sơ ký</Button>
              <Button component={Link} to={`/contracts?contractId=${selected}`}>
                Mở trong quản lý hợp đồng
              </Button>
              <ContractDetailPanel
                key={selected}
                api={api}
                id={selected}
                actorId={session?.userId ?? ''}
                locationId={list.data?.items.find((c) => c.id === selected)?.locationId ?? ''}
                onChanged={(id) => {
                  if (id) setSelected(id);
                  void list.refetch();
                }}
              />
            </>
          )}
        </Stack>
      ) : (
        <Stack
          role="tabpanel"
          id="signing-settings-panel"
          aria-labelledby="signing-settings-tab"
          spacing={2}
        >
          <Alert severity="info">
            Cấu hình dành cho Owner. Khóa ký nằm ở Viettel; BHOME không lưu khóa ký bí mật.
          </Alert>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <ViettelSettingsPanel signing={signing} />
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <SigningCertificates api={api} />
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <SignatureImagePanel signing={signing} />
          </Paper>
        </Stack>
      )}
    </>
  );
}
