import { useState } from 'react';
import { Box, Divider, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';

import {
  amountLabel,
  calculateSetupPreview,
  type PreviewRoom,
  type PreviewType,
  type PreviewFee,
} from './setupBillingCalculation';

export function SetupBillingPreview({
  rooms,
  roomTypes,
  fees,
  rentDate,
}: {
  rooms: PreviewRoom[];
  roomTypes: PreviewType[];
  fees: PreviewFee[];
  rentDate: string;
}) {
  const [roomKey, setRoomKey] = useState('');
  const [date, setDate] = useState('');
  const [people, setPeople] = useState('1');
  const [kwh, setKwh] = useState('100');
  const [water, setWater] = useState('10');
  const room = rooms.find((item) => item.key === roomKey) ?? rooms[0];
  const roomType = roomTypes.find((item) => item.key === room?.roomTypeKey);
  const previewDate = date || rentDate;
  const result = calculateSetupPreview({
    room,
    roomType,
    fees,
    rentDate,
    date: previewDate,
    people,
    kwh,
    water,
  });
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Mô phỏng chi phí hàng tháng của phòng"
      sx={{ p: 2, minWidth: 0 }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h2" component="h3">
            Mô phỏng chi phí hàng tháng của phòng
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Dự kiến theo giá đang thiết lập và mức sử dụng giả định; không tạo hóa đơn.
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0,1fr)',
              sm: 'repeat(2,minmax(0,1fr))',
              lg: 'minmax(0,1.1fr) minmax(0,1fr)',
            },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <TextField
              select
              fullWidth
              label="Phòng mô phỏng"
              value={room?.key ?? ''}
              onChange={(e) => {
                setRoomKey(e.target.value);
                setPeople('1');
              }}
            >
              {rooms.map((item) => (
                <MenuItem key={item.key} value={item.key}>
                  {item.roomNumber} ·{' '}
                  {roomTypes.find((type) => type.key === item.roomTypeKey)?.name ??
                    'Chưa chọn loại phòng'}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="date"
              label="Ngày tính mô phỏng"
              value={previewDate}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: rentDate } }}
            />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))' },
                gap: 1.5,
              }}
            >
              <TextField
                label="Điện (kWh)"
                type="number"
                value={kwh}
                onChange={(e) => setKwh(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                label="Nước (m³)"
                type="number"
                value={water}
                onChange={(e) => setWater(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                label="Số người ở giả định"
                type="number"
                value={people}
                onChange={(e) => setPeople(e.target.value)}
                helperText={roomType ? `Sức chứa ${roomType.capacity} người` : undefined}
                slotProps={{ htmlInput: { min: 1, max: roomType?.capacity, step: 1 } }}
              />
            </Box>
          </Stack>
          <Box
            sx={{ bgcolor: 'background.default', borderRadius: '12px', p: 1.5, minWidth: 0 }}
            aria-live="polite"
          >
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Chi phí dự kiến một tháng</Typography>
            {result ? (
              <Stack spacing={1}>
                {result.rows.map((row) => (
                  <Box
                    key={row.key}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) minmax(0,auto)',
                      gap: 1,
                      alignItems: 'start',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {row.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ overflowWrap: 'anywhere' }}
                      >
                        {row.detail}
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 650,
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {amountLabel(row.amount)}
                    </Typography>
                  </Box>
                ))}
                <Divider />
                <Typography variant="body2" color="text.secondary">
                  Tổng khoản thu đã cấu hình
                </Typography>
                <Typography
                  sx={{
                    fontSize: 24,
                    fontWeight: 750,
                    color: 'primary.dark',
                    fontVariantNumeric: 'tabular-nums',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {amountLabel(result.total)}
                </Typography>
                {!!result.missingUtilities.length && (
                  <Typography variant="caption" color="text.secondary">
                    Chưa có giá{' '}
                    {result.missingUtilities
                      .map((value) => (value === 1 ? 'điện' : 'nước'))
                      .join(' và ')}{' '}
                    hiệu lực cho phòng này; chưa tính vào tổng.
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Chưa tính tiền cọc, điều chỉnh, phân bổ theo ngày hoặc các khoản chưa cấu hình.
                </Typography>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Chưa thể tính dự kiến. Kiểm tra giá, ngày hiệu lực, phạm vi khoản phí và mức sử dụng
                giả định (số nguyên không âm, số người từ 1 đến sức chứa phòng).
              </Typography>
            )}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
