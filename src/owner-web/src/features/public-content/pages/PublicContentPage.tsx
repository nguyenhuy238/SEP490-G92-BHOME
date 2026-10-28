import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CardMedia,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Eye, Pencil, X } from 'lucide-react';
import { usePortalData, usePortalAction } from '../../../hooks/usePortalData';
import { usePortal } from '../../../app/PortalProvider';
import { featureDefinitions } from '../../../app/featureDefinitions';
import {
  ChartCard,
  EmptyState,
  ErrorState,
  KPIGrid,
  LoadingState,
  PageHeader,
  StatusChip,
} from '../../../components/common/PortalUI';
import { RecordEditor } from '../../../components/dialogs/RecordEditor';
import type { PortalRecord } from '../../../types/portal';
import { money } from '../../../utils/format';
export default function PublicContentPage() {
  const query = usePortalData(),
    portal = usePortal(),
    action = usePortalAction();
  const [tab, setTab] = useState(0),
    [preview, setPreview] = useState(false),
    [editor, setEditor] = useState<PortalRecord | null>(null);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const db = query.data,
    def = featureDefinitions.find((def) => def.kind === 'public-content')!,
    rows = db.records['public-content'].filter(
      (row) =>
        (portal.locationId === 'all' || row.locationId === portal.locationId) &&
        `${row.name} ${row.description}`.toLowerCase().includes(portal.search.toLowerCase()),
    );
  const publicCard = (row: PortalRecord, i: number) => (
    <Paper key={row.id} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box
          sx={{
            width: { sm: 170 },
            height: 160,
            flexShrink: 0,
            bgcolor: '#dbe1ff',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {(row.attributes.imageUrl || def.images[i % Math.max(1, def.images.length)]) && (
            <CardMedia
              component="img"
              image={row.attributes.imageUrl || def.images[i % def.images.length]}
              alt={row.name}
              sx={{ height: '100%', objectFit: 'cover' }}
            />
          )}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
            <Typography component="h2" sx={{ fontSize: 15, fontWeight: 650 }}>
              {row.name}
            </Typography>
            <StatusChip label={row.status} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {row.attributes.address}
          </Typography>
          <Typography variant="body2" sx={{ my: 1.5, color: 'primary.main' }}>
            {row.description}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Giá tham khảo: từ {money(row.amount)}/tháng
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', my: 1 }}>
            {row.attributes.amenities}
          </Typography>
          <Button startIcon={<Pencil size={13} />} onClick={() => setEditor(row)}>
            Sửa danh mục
          </Button>
          <Switch
            size="small"
            checked={row.published}
            disabled={action.isPending}
            slotProps={{ input: { 'aria-label': `Công khai ${row.name}` } }}
            onChange={(_, checked) =>
              action.mutate(() =>
                portal.repository.transition(
                  'public-content',
                  row.id,
                  checked ? 'Đã xuất bản' : 'Bản nháp',
                ),
              )
            }
          />
          <Typography component="span" variant="caption">
            Công khai
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
  return (
    <>
      <PageHeader
        title={def.title}
        group="Hệ thống • Nội dung công khai"
        subtitle={def.subtitle}
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<Eye size={14} />}
              onClick={() => setPreview(true)}
            >
              Xem trước (Live Preview)
            </Button>
            <Button
              variant="contained"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(async () => {
                  for (const row of rows)
                    await portal.repository.transition('public-content', row.id, 'Đã xuất bản');
                })
              }
            >
              Xuất bản dữ liệu demo
            </Button>
          </>
        }
      />
      <KPIGrid
        items={[
          {
            label: 'Trạng thái nội dung',
            value: rows.some((row) => row.published) ? 'Đang công khai' : 'Bản nháp',
          },
          {
            label: 'Cơ sở niêm yết',
            value: `${rows.filter((row) => row.published).length}/${db.records.locations.length}`,
          },
          {
            label: 'Phòng trống tìm khách',
            value: db.records.rooms.filter((row) => row.status === 'Trống khai thác').length,
          },
          { label: 'Phạm vi xuất bản', value: 'Cục bộ', hint: 'Không đăng lên website thực' },
        ]}
      />
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
        sx={{ mb: 2, bgcolor: 'white', '& .MuiTab-root': { fontSize: 11, textTransform: 'none' } }}
      >
        {['Cơ sở niêm yết', 'Phòng & Giá tham khảo', 'Thư viện hình ảnh', 'Thông tin liên hệ'].map(
          (label) => (
            <Tab key={label} label={label} />
          ),
        )}
      </Tabs>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,2fr) minmax(280px,1fr)' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Stack spacing={2}>
          {!rows.length && <EmptyState />}
          {tab === 0 && rows.map(publicCard)}
          {tab === 1 &&
            db.records.rooms
              .filter(
                (row) =>
                  row.status === 'Trống khai thác' &&
                  (portal.locationId === 'all' || row.locationId === portal.locationId),
              )
              .map((row) => (
                <ChartCard key={row.id} title={row.code}>
                  <Typography>
                    {money(row.amount)}/tháng • {row.attributes.capacity}
                  </Typography>
                  <Typography variant="caption">
                    Thông tin tham khảo, không đặt phòng trực tuyến.
                  </Typography>
                </ChartCard>
              ))}
          {tab === 2 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 2 }}>
              {def.images.slice(0, 8).map((image, i) => (
                <Paper key={image} sx={{ p: 1 }}>
                  <CardMedia
                    component="img"
                    image={image}
                    alt={`Ảnh tham khảo cơ sở ${i + 1}`}
                    height={180}
                  />
                  <Button
                    size="small"
                    onClick={() => setEditor(rows[i % Math.max(1, rows.length)] || null)}
                  >
                    Chỉnh sửa thông tin ảnh
                  </Button>
                </Paper>
              ))}
            </Box>
          )}
          {tab === 3 &&
            rows.map((row) => (
              <ChartCard key={row.id} title={row.name}>
                <Typography variant="body2">Địa chỉ: {row.attributes.address}</Typography>
                <Typography variant="body2" sx={{ my: 1 }}>
                  Quản lý: {row.attributes.manager}
                </Typography>
                <Typography variant="caption">
                  Thông tin liên hệ minh họa. Chỉ công khai số điện thoại/kênh liên hệ đã được phê
                  duyệt.
                </Typography>
                <Button size="small" onClick={() => setEditor(row)}>
                  Cập nhật thông tin
                </Button>
              </ChartCard>
            ))}
        </Stack>
        <ChartCard
          title="Mô phỏng hiển thị Live Card"
          subtitle="Chế độ khách xem • Bản xem trước cục bộ"
        >
          {rows[0] && (
            <>
              <Box
                sx={{ height: 220, bgcolor: '#dbe1ff', mb: 2, borderRadius: 1, overflow: 'hidden' }}
              >
                <CardMedia
                  component="img"
                  image={rows[0].attributes.imageUrl || def.images[def.images.length - 1] || def.images[0]}
                  alt="Phòng minh họa"
                  sx={{ height: '100%', objectFit: 'cover' }}
                />
              </Box>
              <Chip label="Thông tin phòng tham khảo" size="small" sx={{ mb: 1 }} />
              <Typography sx={{ fontSize: 18, fontWeight: 650, mb: 1 }}>
                Studio Ban Công Thoáng Mát
              </Typography>
              <Typography color="primary" sx={{ fontSize: 22, fontWeight: 650 }}>
                {money(rows[0].amount)}/tháng
              </Typography>
              <Typography variant="body2" sx={{ my: 2 }}>
                {rows[0].description}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                28 m² • Studio riêng • Thang máy
              </Typography>
              <Alert severity="info" sx={{ mt: 2 }}>
                Trang thông tin không tiếp nhận đặt cọc, đặt phòng, thanh toán hay dữ liệu khách
                truy cập.
              </Alert>
            </>
          )}
        </ChartCard>
      </Box>
      <Dialog open={preview} onClose={() => setPreview(false)} fullWidth maxWidth="md">
        <DialogTitle>
          Xem trước nội dung công khai{' '}
          <IconButton
            aria-label="Đóng xem trước"
            onClick={() => setPreview(false)}
            sx={{ float: 'right' }}
          >
            <X size={18} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {rows.filter((row) => row.published).length ? (
              rows.filter((row) => row.published).map(publicCard)
            ) : (
              <EmptyState message="Chưa có nội dung được xuất bản trong dữ liệu demo." />
            )}
          </Stack>
        </DialogContent>
      </Dialog>
      {editor && (
        <RecordEditor
          definition={def}
          database={db}
          record={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
