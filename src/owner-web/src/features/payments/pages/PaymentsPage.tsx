import { useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useSearchParams } from 'react-router';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { OwnerTable } from '../../../components/common/OwnerWorkspace';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  StatusChip,
} from '../../../components/common/PortalUI';
import { usePortal } from '../../../app/PortalProvider';
import { usePortalData } from '../../../hooks/usePortalData';
import { isMockMode } from '../../../services/config';
import { money } from '../../../utils/format';
import { PaymentManagementPage } from '../PaymentManagementPage';

function DemoPaymentsWorkspace() {
  const query = usePortalData();
  const portal = usePortal();
  const [params, setParams] = useSearchParams();
  const [showAll, setShowAll] = useState(false);
  const [fullMode, setFullMode] = useState(Boolean(params.get('selected')));
  const selected = params.get('selected');
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const rows = query.data.records.payments.filter(
    (row) =>
      (portal.locationId === 'all' || row.locationId === portal.locationId) &&
      (showAll || row.status === 'Chờ đối soát'),
  );
  const openRecord = (id: string) => {
    setParams({ selected: id });
    setFullMode(true);
  };

  if (fullMode) {
    return (
      <Stack spacing={1.5}>
        <Button
          variant="text"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setFullMode(false);
            setParams({});
          }}
        >
          Quay lại danh sách đối soát
        </Button>
        <ResourcePage key={selected ?? 'all'} kind="payments" variant="table" />
      </Stack>
    );
  }

  return (
    <>
      <PageHeader
        title="Thanh toán & Đối soát"
        subtitle="Giao dịch minh họa. Không xác nhận tiền thật."
      />
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2, mb: 2 }}>
        <Stack
          direction="row"
          useFlexGap
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            flexWrap: 'wrap',
            mb: 1.5,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {showAll ? 'Các giao dịch demo' : 'Giao dịch chờ đối soát'}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant={showAll ? 'outlined' : 'contained'}
              aria-pressed={!showAll}
              onClick={() => setShowAll(false)}
            >
              Chờ đối soát
            </Button>
            <Button
              size="small"
              variant={showAll ? 'contained' : 'outlined'}
              aria-pressed={showAll}
              onClick={() => setShowAll(true)}
            >
              Tất cả
            </Button>
            <Button size="small" onClick={() => setFullMode(true)}>
              Quản lý dữ liệu demo
            </Button>
          </Stack>
        </Stack>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {showAll
              ? 'Không có giao dịch minh họa trong cơ sở đã chọn.'
              : 'Không có giao dịch demo chờ đối soát. Chọn Tất cả để xem lịch sử minh họa.'}
          </Typography>
        ) : (
          <OwnerTable
            label="Danh sách giao dịch thanh toán minh họa"
            rows={rows}
            id={(row) => row.id}
            select={(row) => openRecord(row.id)}
            selectLabel="Xem giao dịch"
            columns={[
              {
                label: 'Giao dịch',
                render: (row) => (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.code}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.name}
                    </Typography>
                  </Box>
                ),
              },
              { label: 'Số tiền minh họa', render: (row) => money(row.amount) },
              { label: 'Trạng thái', render: (row) => <StatusChip label={row.status} /> },
              { label: 'Ngày', render: (row) => row.date.split('-').reverse().join('/') },
            ]}
          />
        )}
      </Paper>
    </>
  );
}

export default function PaymentsPage() {
  return isMockMode ? <DemoPaymentsWorkspace /> : <PaymentManagementPage />;
}
