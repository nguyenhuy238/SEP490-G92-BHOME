import { useState } from 'react';
import {
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
import { BedDouble, Check, Maximize2, Pencil, Users } from 'lucide-react';
import type { RoomTypeConfiguration } from '../../../../../../packages/client-core/src/propertySetup';

export function RoomTypeMasterDetail({
  items,
  total,
  canManage,
  edit,
  inspect,
}: {
  items: RoomTypeConfiguration[];
  total: number;
  canManage: boolean;
  edit: (item: RoomTypeConfiguration) => void;
  inspect: (item: RoomTypeConfiguration) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.25fr) minmax(320px, 0.85fr)' },
        gap: 2.5,
        alignItems: 'start',
      }}
    >
      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: '12px' }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 2.5,
            py: 2,
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography sx={{ fontWeight: 750, fontSize: 16 }}>Danh sách loại phòng</Typography>
          <Chip size="small" label={total} />
          <Typography sx={{ ml: 'auto !important', fontSize: 13, color: 'text.secondary' }}>
            Chọn dòng để xem cấu hình
          </Typography>
        </Stack>
        <TableContainer>
          <Table size="medium" aria-label="Danh sách loại phòng">
            <TableHead>
              <TableRow>
                {['Loại phòng', 'Sức chứa', 'Diện tích'].map((title) => (
                  <TableCell key={title} sx={{ py: 1.5, fontSize: 13 }}>
                    {title}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  selected={item.id === selected?.id}
                  hover
                  sx={{
                    '&.Mui-selected': { bgcolor: '#edf3ff' },
                    '&.Mui-selected:hover': { bgcolor: '#e4edff' },
                  }}
                >
                  <TableCell
                    sx={{
                      borderLeft: '3px solid',
                      borderLeftColor: item.id === selected?.id ? 'primary.main' : 'transparent',
                      py: 2,
                    }}
                  >
                    <Button
                      onClick={() => setSelectedId(item.id)}
                      sx={{
                        p: 0,
                        textAlign: 'left',
                        justifyContent: 'flex-start',
                        color: 'text.primary',
                        fontSize: 14,
                        lineHeight: 1.5,
                        fontWeight: 700,
                        minHeight: 0,
                      }}
                    >
                      {' '}
                      {item.name}
                    </Button>
                    <Typography
                      sx={{
                        fontSize: 12,
                        mt: 0.75,
                        color: item.isActive ? 'success.main' : 'text.secondary',
                      }}
                    >
                      {item.isActive ? '● Đang sử dụng' : '● Ngừng sử dụng'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                    {item.defaultCapacity} người
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                    {item.areaM2 != null ? `${item.areaM2} m²` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ px: 2.5, py: 2, bgcolor: '#fafbfd' }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.7 }}>
            Loại phòng mô tả đặc điểm và tiện nghi. Giá thuê và trang bị thực tế được quản lý tại
            các mục riêng của cơ sở.
          </Typography>
        </Box>
      </Paper>
      {selected && (
        <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: '12px' }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              p: 2.5,
              bgcolor: '#f8faff',
              borderBottom: '1px solid',
              borderColor: 'divider',
              alignItems: 'center',
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                bgcolor: '#e4edff',
                borderRadius: '10px',
                color: 'primary.main',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <BedDouble size={26} />
            </Box>
            <Box>
              <Typography
                sx={{
                  fontSize: 11,
                  letterSpacing: 1.2,
                  fontWeight: 750,
                  color: 'text.secondary',
                  mb: 0.5,
                }}
              >
                CẤU HÌNH LOẠI PHÒNG
              </Typography>
              <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.4 }}>
                {selected.name}
              </Typography>
            </Box>
          </Stack>
          <Stack spacing={3} sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                color={selected.isActive ? 'success' : 'default'}
                label={selected.isActive ? 'Đang sử dụng' : 'Ngừng sử dụng'}
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Phiên bản {selected.version}
              </Typography>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              {[
                {
                  label: 'Sức chứa mặc định',
                  value: `${selected.defaultCapacity} người`,
                  Icon: Users,
                },
                {
                  label: 'Diện tích',
                  value: selected.areaM2 != null ? `${selected.areaM2} m²` : 'Chưa khai báo',
                  Icon: Maximize2,
                },
              ].map(({ label, value, Icon }) => (
                <Box key={label} sx={{ p: 2, bgcolor: '#f5f7fb', borderRadius: '8px' }}>
                  <Icon size={18} color="#6a7a91" />
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1 }}>
                    {label}
                  </Typography>
                  <Typography sx={{ fontSize: 19, fontWeight: 750, mt: 0.5 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 750, mb: 1 }}>Mô tả</Typography>
              <Typography
                sx={{
                  fontSize: 14,
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                }}
              >
                {selected.description ||
                  'Chưa có mô tả. Bổ sung đặc điểm phòng để dễ phân biệt khi tạo phòng.'}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 750, mb: 1 }}>
                Tiện nghi tiêu chuẩn
              </Typography>
              {selected.amenities.length ? (
                <Stack sx={{ gap: 1 }}>
                  {selected.amenities.map((amenity) => (
                    <Stack key={amenity} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Check size={16} color="#159a60" />
                      <Typography sx={{ fontSize: 14 }}>{amenity}</Typography>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
                  Chưa khai báo tiện nghi.
                </Typography>
              )}
            </Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}
            >
              {canManage && (
                <Button
                  startIcon={<Pencil size={16} />}
                  variant="contained"
                  onClick={() => edit(selected)}
                >
                  Chỉnh sửa
                </Button>
              )}
              <Button variant="outlined" onClick={() => inspect(selected)}>
                Xem chi tiết
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
