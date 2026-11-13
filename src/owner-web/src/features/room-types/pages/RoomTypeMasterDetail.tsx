import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { BedDouble, Pencil } from 'lucide-react';
import type { LocalRoomDefaultsData } from '../../../../../../packages/client-core/src/locationSetup';
import type { SetupDocument } from '../../../../../../packages/client-core/src/propertySetup';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';

export type LocalRoomDefaults = SetupDocument<LocalRoomDefaultsData>;

function defaultsOrigin(data: LocalRoomDefaultsData) {
  if (data.copiedFromId || data.sourceLocationId)
    return 'Sao chép từ cơ sở' + (data.copiedFromVersion != null ? ` · bản ${data.copiedFromVersion}` : '');
  if (data.sourceId)
    return 'Nạp từ mẫu chung' + (data.sourceVersion != null ? ` · bản ${data.sourceVersion}` : '');
  return 'Tạo tại cơ sở';
}

export function RoomDefaultsDetails({ item }: { item: LocalRoomDefaults }) {
  const data = item.data;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip size="small" label={item.status === 'Archived' ? 'Ngừng sử dụng' : 'Đang sử dụng'} />
        <Chip size="small" variant="outlined" label={defaultsOrigin(data)} />
        <Typography variant="caption" color="text.secondary">Phiên bản {item.version}</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        {[
          ['Sức chứa mặc định', `${data.defaults.capacity} người`],
          ['Diện tích', data.defaults.area == null ? 'Chưa khai báo' : `${data.defaults.area} m²`],
          ['Giá thuê tham khảo', data.defaults.referenceRent == null ? 'Chưa đặt' : `${formatBillingDecimal(data.defaults.referenceRent)} đ/tháng`],
          ['Gói trang bị', data.assetTemplateId ? 'Đã liên kết' : 'Chưa liên kết'],
        ].map(([label, value]) => (
          <Box key={label} sx={{ p: 1.75, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography sx={{ fontWeight: 700, mt: 0.5 }}>{value}</Typography>
          </Box>
        ))}
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Mô tả</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
          {data.description || 'Chưa có mô tả.'}
        </Typography>
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>Tiện nghi</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {data.defaults.amenities.map((amenity, index) => (
            <Chip key={index} size="small" label={amenity} variant="outlined" />
          ))}
          {!data.defaults.amenities.length && <Typography variant="body2" color="text.secondary">Chưa khai báo.</Typography>}
        </Stack>
      </Box>
      <Alert severity="info">
        Các giá trị này là gợi ý cho phòng mới. Giá thuê thực tế và tài sản đã kiểm kê được quản lý riêng; chỉnh sửa gợi ý không thay đổi các phòng đã tạo.
      </Alert>
    </Stack>
  );
}

export function RoomTypeMasterDetail({
  items,
  total,
  canManage,
  edit,
  inspect,
}: {
  items: LocalRoomDefaults[];
  total: number;
  canManage: boolean;
  edit: (item: LocalRoomDefaults) => void;
  inspect: (item: LocalRoomDefaults) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.25fr) minmax(320px, 0.85fr)' }, gap: 2.5, alignItems: 'start' }}>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction="row" spacing={1} sx={{ p: 2.5, alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 750 }}>Danh sách gợi ý tạo phòng</Typography>
          <Chip size="small" label={total} />
        </Stack>
        <TableContainer>
          <Table aria-label="Danh sách gợi ý tạo phòng">
            <TableHead>
              <TableRow>
                {['Gợi ý', 'Sức chứa', 'Diện tích'].map((title) => <TableCell key={title}>{title}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} selected={item.id === selected?.id} hover>
                  <TableCell sx={{ borderLeft: '3px solid', borderLeftColor: item.id === selected?.id ? 'primary.main' : 'transparent' }}>
                    <Button onClick={() => setSelectedId(item.id)} sx={{ p: 0, textAlign: 'left', justifyContent: 'flex-start', color: 'text.primary', fontWeight: 700 }}>
                      {item.data.name}
                    </Button>
                    <Typography variant="caption" sx={{ display: "block" }} color="text.secondary">
                      {defaultsOrigin(item.data)}
                    </Typography>
                  </TableCell>
                  <TableCell>{item.data.defaults.capacity} người</TableCell>
                  <TableCell>{item.data.defaults.area == null ? '—' : `${item.data.defaults.area} m²`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      {selected && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Stack direction="row" spacing={2} sx={{ p: 2.5, bgcolor: 'action.hover', alignItems: 'center' }}>
            <BedDouble size={26} />
            <Box>
              <Typography variant="caption" color="text.secondary">CẤU HÌNH RIÊNG TẠI CƠ SỞ</Typography>
              <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800 }}>{selected.data.name}</Typography>
            </Box>
          </Stack>
          <Stack spacing={2.5} sx={{ p: 2.5 }}>
            <RoomDefaultsDetails item={selected} />
            <Stack direction="row" spacing={1}>
              {canManage && (
                <Button startIcon={<Pencil size={16} />} variant="contained" onClick={() => edit(selected)}>Chỉnh sửa</Button>
              )}
              <Button variant="outlined" onClick={() => inspect(selected)}>Xem chi tiết</Button>
            </Stack>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
