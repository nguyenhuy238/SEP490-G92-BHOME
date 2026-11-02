import { useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  History,
  Package,
  Sparkles,
  UserRound,
  Wrench,
  Zap,
} from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { INITIAL_OPERATIONAL_HISTORY } from '../../mock/locationConfigMock';
import type { OperationalHistoryItem } from '../../types/locationConfig';

interface LocationHistoryTabProps {
  db: DemoDatabase;
  location: PortalRecord;
}

export function LocationHistoryTab({ db, location }: LocationHistoryTabProps) {
  const [filterEvent, setFilterEvent] = useState<string>('ALL');
  const [historyList] = useState<OperationalHistoryItem[]>(INITIAL_OPERATIONAL_HISTORY);

  const filteredHistory = filterEvent === 'ALL'
    ? historyList
    : historyList.filter((item) => item.event === filterEvent);

  const getEventBadge = (event: OperationalHistoryItem['event']) => {
    switch (event) {
      case 'MAINTENANCE_COMPLETED':
        return { label: 'Bảo trì hoàn tất', color: 'success' as const, icon: <CheckCircle2 size={15} /> };
      case 'ASSET_REPLACED':
        return { label: 'Thay thế tài sản', color: 'warning' as const, icon: <Wrench size={15} /> };
      case 'ASSET_INSTALLED':
        return { label: 'Lắp đặt thiết bị', color: 'primary' as const, icon: <Package size={15} /> };
      case 'CONDITION_UPDATED':
        return { label: 'Cập nhật hiện trạng', color: 'info' as const, icon: <Clock size={15} /> };
      case 'POLICY_UPDATED':
        return { label: 'Cập nhật phiên bản quy định', color: 'secondary' as const, icon: <Sparkles size={15} /> };
      case 'ROOM_SETUP_COMPLETED':
        return { label: 'Nghiệm thu setup phòng', color: 'success' as const, icon: <CheckCircle2 size={15} /> };
      default:
        return { label: event, color: 'default' as const, icon: <History size={15} /> };
    }
  };

  return (
    <Box>
      {/* Header and Filter */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
              <History size={20} color="#255dde" /> Lịch sử vận hành & Bảo dưỡng tài sản
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Nhật ký theo dõi các sự kiện sửa chữa, thay thế linh kiện, nghiệm thu bàn giao và nâng cấp hạ tầng cơ sở.
            </Typography>
          </Box>

          <TextField
            select
            size="small"
            label="Lọc theo loại sự kiện"
            value={filterEvent}
            onChange={(e) => setFilterEvent(e.target.value)}
            sx={{ minWidth: 240, bgcolor: '#ffffff' }}
          >
            <MenuItem value="ALL">Tất cả sự kiện ({historyList.length})</MenuItem>
            <MenuItem value="MAINTENANCE_COMPLETED">Bảo trì hoàn tất</MenuItem>
            <MenuItem value="ASSET_REPLACED">Thay thế tài sản</MenuItem>
            <MenuItem value="ASSET_INSTALLED">Lắp đặt thiết bị</MenuItem>
            <MenuItem value="CONDITION_UPDATED">Cập nhật hiện trạng</MenuItem>
            <MenuItem value="POLICY_UPDATED">Cập nhật phiên bản quy định</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {/* Timeline Layout */}
      <Stack spacing={2} sx={{ position: 'relative', pl: 3 }}>
        {/* Vertical line */}
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            bottom: 10,
            left: 7,
            width: 2,
            bgcolor: '#e2e8f0',
          }}
        />

        {filteredHistory.map((item) => {
          const badge = getEventBadge(item.event);

          return (
            <Box key={item.id} sx={{ position: 'relative' }}>
              {/* Dot */}
              <Box
                sx={{
                  position: 'absolute',
                  left: -29,
                  top: 18,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: '#ffffff',
                  border: '3px solid #255dde',
                  zIndex: 1,
                }}
              />

              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 2.5,
                  bgcolor: '#ffffff',
                  transition: 'box-shadow 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
                  },
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Chip
                      size="small"
                      label={badge.label}
                      color={badge.color}
                      icon={badge.icon}
                      sx={{ fontWeight: 800, fontSize: 11 }}
                    />
                    {item.roomCode && (
                      <Chip
                        size="small"
                        label={`Phòng ${item.roomCode}`}
                        sx={{ fontWeight: 750, bgcolor: '#f1f5f9' }}
                      />
                    )}
                  </Stack>

                  <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Calendar size={14} /> {item.date}
                  </Typography>
                </Stack>

                <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 0.5 }}>
                  {item.relatedAsset ? item.relatedAsset : item.description}
                </Typography>

                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
                  {item.description}
                </Typography>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    {item.condition && (
                      <Typography variant="caption" color="text.secondary">
                        Tình trạng sau bảo trì: <strong>{item.condition}</strong>
                      </Typography>
                    )}
                    {item.cost !== undefined && item.cost > 0 && (
                      <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 800 }}>
                        Chi phí phát sinh: {item.cost.toLocaleString()} VND
                      </Typography>
                    )}
                  </Stack>

                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
                    <UserRound size={14} />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {item.actor}
                    </Typography>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
