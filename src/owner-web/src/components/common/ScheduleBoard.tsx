import { Avatar, Box, Button, Paper, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import type { PortalRecord } from '../../types/portal';
export function ScheduleBoard({
  rows,
  monthly,
  weekStart,
  onEdit,
}: {
  rows: PortalRecord[];
  monthly: boolean;
  weekStart: string;
  onEdit: (row: PortalRecord) => void;
}) {
  const start = dayjs(monthly ? weekStart.slice(0, 7) + '-01' : weekStart);
  const days = Array.from({ length: monthly ? start.daysInMonth() : 7 }, (_, i) =>
    start.add(i, 'day'),
  );
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const staffRows = Array.from(new Map(rows.map((row) => [row.staffId || row.id, row])).values());
  return (
    <Paper sx={{ p: 2, overflowX: 'auto', border: '1px solid', borderColor: 'divider' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `180px repeat(${days.length},minmax(110px,1fr))`,
          minWidth: 950,
        }}
      >
        <Typography sx={{ p: 1, fontSize: 12, fontWeight: 650 }}>Nhân viên & Chức danh</Typography>
        {days.map((day) => (
          <Typography
            key={day.format('YYYY-MM-DD')}
            sx={{ p: 1, fontSize: 11, fontWeight: 600, bgcolor: '#eaedff' }}
          >
            {day.day() === 0 ? 'CN' : `Thứ ${day.day() + 1}`} • {day.format('DD/MM')}
          </Typography>
        ))}
        {staffRows.map((row) => (
          <Box key={row.staffId || row.id} sx={{ display: 'contents' }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ p: 1, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Avatar sx={{ width: 28, height: 28, fontSize: 10 }}>
                {row.name
                  .split(' ')
                  .map((x) => x[0])
                  .slice(-2)
                  .join('')}
              </Avatar>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{row.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.category}
                </Typography>
              </Box>
            </Stack>
            {days.map((day) => {
              const date = day.format('YYYY-MM-DD'),
                target = rows.find(
                  (item) =>
                    item.staffId === row.staffId && item.date <= date && item.endDate >= date,
                );
              return (
                <Box key={date} sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Button
                    onClick={() =>
                      onEdit(
                        target || {
                          ...row,
                          id: crypto.randomUUID(),
                          code: `CA-${row.staffId}-${date}`,
                          date,
                          endDate: date,
                          status: 'Bản nháp',
                        },
                      )
                    }
                    sx={{
                      width: '100%',
                      height: 75,
                      display: 'block',
                      textAlign: 'left',
                      bgcolor: !target || day.day() === 0 ? '#f2f3f6' : '#e5edff',
                      fontSize: 11,
                      color: 'text.primary',
                    }}
                  >
                    <Typography sx={{ fontSize: 10, fontWeight: 650, color: 'primary.main' }}>
                      {!target ? 'CHƯA PHÂN CA' : day.day() === 0 ? 'NGHỈ TUẦN' : 'CA LÀM VIỆC'}
                    </Typography>
                    {target?.attributes[keys[day.day()]] || 'Thêm ca làm việc'}
                    <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>
                      {target?.status || 'Chọn để tạo lịch'}
                    </Typography>
                  </Button>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
