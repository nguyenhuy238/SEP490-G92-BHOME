import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';

export function BulkRoomsDialog({ locationId, close }: { locationId: string; close: () => void }) {
  const api = usePropertySetupApi();
  const lock = useRef(false);
  const cache = useQueryClient();
  const { session } = useAuth();
  const [floor, setFloor] = useState('1');
  const [prefix, setPrefix] = useState('P.');
  const [start, setStart] = useState('101');
  const [count, setCount] = useState('5');
  const [typeId, setTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<{ roomNumber: string; floor: string; roomTypeId: string }[]>([]);
  const types = useQuery({
    queryKey: ['property-setup', 'bulk-room-types', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomTypes(locationId, 1, '', signal),
  });
  const save = useMutation({
    mutationFn: () => api.bulkCreateRooms(locationId, { rooms: rows, reason }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      close();
    },
  });
  const invalidRows =
    rows.some((row) => !row.roomNumber.trim()) ||
    new Set(rows.map((row) => row.roomNumber.trim().toUpperCase())).size !== rows.length;
  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => !save.isPending && close()}>
      <DialogTitle>Tạo phòng hàng loạt</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Alert severity="info">
            Tạo danh sách xem trước, kiểm tra số phòng rồi xác nhận lưu. Các phòng mới được tạo ở
            trạng thái trống khai thác.
          </Alert>
          {types.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void types.refetch()}>Thử lại</Button>}
            >
              {invoiceError(types.error)}
            </Alert>
          )}
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              setRows(
                Array.from({ length: Number(count) }, (_, i) => ({
                  roomNumber: `${prefix}${Number(start) + i}`,
                  floor,
                  roomTypeId: typeId,
                })),
              );
            }}
          >
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}
            >
              <TextField
                required
                label="Tầng"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              />
              <TextField
                select
                required
                label="Loại phòng"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              >
                <MenuItem value="">Chọn loại phòng</MenuItem>
                {types.data?.items
                  .filter((type) => type.isActive)
                  .map((type) => (
                    <MenuItem key={type.id} value={type.id}>
                      {type.name} · {type.defaultCapacity} người
                    </MenuItem>
                  ))}
              </TextField>
              <TextField
                label="Tiền tố số phòng"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
              <TextField
                required
                type="number"
                label="Số bắt đầu"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 999999, step: 1 } }}
              />
              <TextField
                required
                type="number"
                label="Số phòng cần tạo"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                slotProps={{ htmlInput: { min: 1, max: 200, step: 1 } }}
              />
            </Box>
            <Button
              type="submit"
              variant="outlined"
              sx={{ mt: 2 }}
              disabled={save.isPending || !typeId}
            >
              Tạo danh sách xem trước
            </Button>
          </Box>
          {rows.length > 0 && (
            <>
              <Typography sx={{ fontWeight: 750 }}>
                Xem trước {rows.length} phòng · Chưa lưu
              </Typography>
              <TableContainer sx={{ maxHeight: 350 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Số phòng</TableCell>
                      <TableCell>Tầng</TableCell>
                      <TableCell>Loại phòng</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField
                            size="small"
                            value={row.roomNumber}
                            onChange={(e) =>
                              setRows((old) =>
                                old.map((item, i) =>
                                  i === index ? { ...item, roomNumber: e.target.value } : item,
                                ),
                              )
                            }
                            slotProps={{
                              htmlInput: { 'aria-label': `Số phòng ${index + 1}`, maxLength: 50 },
                            }}
                          />
                        </TableCell>
                        <TableCell>{row.floor}</TableCell>
                        <TableCell>
                          {types.data?.items.find((type) => type.id === row.roomTypeId)?.name}
                        </TableCell>
                        <TableCell>
                          <Button
                            color="error"
                            disabled={save.isPending}
                            onClick={() => setRows((old) => old.filter((_, i) => i !== index))}
                          >
                            Bỏ
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {invalidRows && (
                <Alert severity="warning">
                  Số phòng phải có nội dung và không được trùng nhau.
                </Alert>
              )}
              <TextField
                label="Ghi chú tạo phòng"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          {save.error && (
            <Alert severity="error">
              {invoiceError(save.error)} Danh sách được giữ lại để bạn kiểm tra trước khi thử lại.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={save.isPending} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          disabled={save.isPending || !rows.length || invalidRows}
          onClick={() => {
            if (lock.current) return;
            lock.current = true;
            void save
              .mutateAsync()
              .catch(() => {})
              .finally(() => {
                lock.current = false;
              });
          }}
        >
          {save.isPending ? 'Đang tạo…' : `Xác nhận tạo ${rows.length} phòng`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
