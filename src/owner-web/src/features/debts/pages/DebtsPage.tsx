import { useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useSearchParams } from 'react-router';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { DebtAging } from '../../../components/common/FeaturePanels';
import { OwnerTable } from '../../../components/common/OwnerWorkspace';
import {
  ErrorState,
  LoadingState,
  PageHeader,
  StatusChip,
} from '../../../components/common/PortalUI';
import { usePortal } from '../../../app/PortalProvider';
import { usePortalData } from '../../../hooks/usePortalData';
import { money } from '../../../utils/format';
import { isMockMode } from '../../../services/config';
import { PaymentManagementPage } from '../../payments/PaymentManagementPage';

function DemoDebtsWorkspace() {
  const query = usePortalData();
  const portal = usePortal();
  const [params, setParams] = useSearchParams();
  const [fullMode, setFullMode] = useState(Boolean(params.get('selected')));
  const [showAll, setShowAll] = useState(false);
  const [showAging, setShowAging] = useState(false);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const rows = query.data.records.debts.filter(
    (row) =>
      (portal.locationId === 'all' || row.locationId === portal.locationId) &&
      (showAll || row.amount > row.paid),
  );
  const openRecord = (id: string) => {
    setParams({ selected: id });
    setFullMode(true);
  };

  if (fullMode) {
    return (
      <Stack spacing={1.5}>
        <Button
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setFullMode(false);
            setParams({});
          }}
        >
          Quay lại danh sách công nợ
        </Button>
        <ResourcePage key={params.get('selected') ?? 'all'} kind="debts" variant="table" />
        <Button
          sx={{ alignSelf: 'flex-start' }}
          aria-expanded={showAging}
          aria-controls="demo-debt-aging"
          onClick={() => setShowAging((value) => !value)}
        >
          {showAging ? 'Ẩn phân tích tuổi nợ' : 'Xem phân tích tuổi nợ'}
        </Button>
        {showAging && (
          <Box id="demo-debt-aging">
            <DebtAging />
          </Box>
        )}
      </Stack>
    );
  }

  return (
    <>
      <PageHeader
        title="Công nợ phòng"
        subtitle="Số dư minh họa, không phải công nợ từ API thật."
      />
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
        <Stack
          direction="row"
          useFlexGap
          sx={{
            gap: 1,
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1.5,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {showAll ? 'Danh sách công nợ demo' : 'Khoản còn phải thu'}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant={!showAll ? 'contained' : 'outlined'}
              aria-pressed={!showAll}
              onClick={() => setShowAll(false)}
            >
              Còn phải thu
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
        {rows.length ? (
          <OwnerTable
            rows={rows}
            id={(row) => row.id}
            label="Danh sách công nợ minh họa"
            select={(row) => openRecord(row.id)}
            selectLabel="Xem công nợ"
            columns={[
              {
                label: 'Phòng / Khoản thu',
                render: (row) => (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.code}
                    </Typography>
                  </Box>
                ),
              },
              { label: 'Còn phải thu', render: (row) => money(Math.max(0, row.amount - row.paid)) },
              { label: 'Hạn thanh toán', render: (row) => row.date.split('-').reverse().join('/') },
              { label: 'Trạng thái', render: (row) => <StatusChip label={row.status} /> },
            ]}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Không có khoản công nợ minh họa phù hợp. Chọn Tất cả để xem toàn bộ.
          </Typography>
        )}
      </Paper>
    </>
  );
}

export default function DebtsPage() {
  return isMockMode ? <DemoDebtsWorkspace /> : <PaymentManagementPage debtOnly />;
}
