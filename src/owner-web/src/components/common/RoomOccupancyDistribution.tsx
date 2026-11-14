import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { roomStatusColors } from '../../theme/theme';
import { validCount, formatRoomCount } from './roomOccupancy';

export type RoomDistributionCounts = {
  rooms?: number;
  occupied?: number;
  available?: number;
  onHold?: number;
  unavailable?: number;
};

const states = [
  { key: 'occupied', title: 'Đang cho thuê', color: roomStatusColors.occupied.fill, status: 2 },
  { key: 'available', title: 'Phòng trống', color: roomStatusColors.available.fill, status: 0 },
  { key: 'onHold', title: 'Đang giữ chỗ', color: roomStatusColors.onHold.fill, status: 1 },
  {
    key: 'unavailable',
    title: 'Không khai thác',
    color: roomStatusColors.unavailable.fill,
    status: 3,
  },
] as const;

/** Both the chain and Location dashboards use the same denominator and palette.
 * Counts may be fetched at different instants; never draw a misleading ratio.
 */
export function RoomOccupancyDistribution({
  counts,
  roomPath,
  loading,
}: {
  counts?: RoomDistributionCounts;
  roomPath?: string;
  loading?: boolean;
}) {
  const total = counts?.rooms;
  const consistent =
    validCount(total) &&
    states.every(({ key }) => validCount(counts?.[key])) &&
    states.reduce((sum, { key }) => sum + (counts?.[key] ?? 0), 0) === total;
  const occupancy =
    consistent && total > 0 ? Math.round((counts!.occupied! / total) * 1000) / 10 : undefined;
  let offset = 0;
  const segments =
    consistent && total > 0
      ? states
          .map((state) => {
            const length = (counts![state.key]! / total) * 100;
            const segment = { ...state, length, offset };
            offset += length;
            return segment;
          })
          .filter((segment) => segment.length > 0)
      : [];
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.dark', mb: 1.5 }}>
        {occupancy == null
          ? total === 0 && consistent
            ? 'Chưa có phòng'
            : loading
              ? 'Đang tải số liệu phòng…'
              : 'Chưa đủ số liệu'
          : `${occupancy.toLocaleString('vi-VN')}% đang cho thuê`}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0,1fr)',
            sm: 'minmax(128px, 160px) minmax(0,1fr)',
            md: 'minmax(0,1fr)',
            lg: 'minmax(144px, 172px) minmax(0,1fr)',
          },
          gap: { xs: 1.5, lg: 2 },
          alignItems: 'center',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: { xs: 144, lg: 172 },
            maxWidth: '100%',
            aspectRatio: '1',
            mx: 'auto',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Box
            component="svg"
            viewBox="0 0 120 120"
            role={segments.length ? 'img' : undefined}
            aria-hidden={segments.length ? undefined : true}
            aria-label={
              segments.length
                ? states.map((s) => `${s.title}: ${formatRoomCount(counts?.[s.key])}`).join(', ')
                : undefined
            }
            sx={{ width: '100%', height: '100%', display: 'block' }}
          >
            <circle cx="60" cy="60" r="47" fill="none" stroke="#e6ebf2" strokeWidth="16" />
            {segments.map((s) => (
              <circle
                key={s.key}
                cx="60"
                cy="60"
                r="47"
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                pathLength="100"
                strokeDasharray={`${s.length} ${100 - s.length}`}
                strokeDashoffset={-s.offset}
                transform="rotate(-90 60 60)"
              />
            ))}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography
              sx={{
                fontSize: 30,
                lineHeight: 1.2,
                fontWeight: 750,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatRoomCount(total)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              phòng
            </Typography>
          </Box>
        </Box>
        <Stack divider={<Divider />} spacing={0} sx={{ minWidth: 0 }}>
          {states.map((s) => {
            const row = (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Box
                    sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: s.color, flexShrink: 0 }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {s.title}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatRoomCount(counts?.[s.key])}
                  </Typography>
                  {roomPath && <ChevronRight size={14} />}
                </Stack>
              </>
            );
            return roomPath ? (
              <Button
                key={s.key}
                component={Link}
                to={`${roomPath}?roomStatus=${s.status}`}
                color="inherit"
                sx={{
                  justifyContent: 'space-between',
                  gap: 1,
                  px: 0.5,
                  py: 0.25,
                  minHeight: { xs: 44, sm: 32 },
                  '@media (pointer:coarse)': { minHeight: 44 },
                  minWidth: 0,
                  textAlign: 'left',
                }}
              >
                {row}
              </Button>
            ) : (
              <Stack
                key={s.key}
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  gap: 1,
                  px: 0.5,
                  py: 1,
                  minWidth: 0,
                  alignItems: 'center',
                }}
              >
                {row}
              </Stack>
            );
          })}
        </Stack>
      </Box>
      {!consistent && !loading && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Chưa thể tính tỷ lệ từ số liệu hiện có. Hãy tải lại nếu trạng thái vừa thay đổi.
        </Alert>
      )}
    </>
  );
}
