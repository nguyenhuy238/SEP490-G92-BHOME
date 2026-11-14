import { MoneyField } from '../../../components/common/MoneyField';
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
import { Link } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { todayVietnam } from '../../staff/staffContracts';

type PreviewRoom = {
  roomNumber: string;
  floor: string;
  roomDefaultsId: string;
  expectedVersion: number;
  capacity: number;
  name: string;
  rent: string;
};

export function BulkRoomsDialog({ locationId, close }: { locationId: string; close: () => void }) {
  const api = locationSetupClient(usePropertySetupApi().request);
  const lock = useRef(false);
  const operation = useRef<{ body: string; key: string } | null>(null);
  const cache = useQueryClient();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [floor, setFloor] = useState('1');
  const [prefix, setPrefix] = useState('P.');
  const [start, setStart] = useState('101');
  const [count, setCount] = useState('5');
  const [defaultsId, setDefaultsId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayVietnam);
  const [rows, setRows] = useState<PreviewRoom[]>([]);
  const defaults = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, locationId],
    queryFn: ({ signal }) => api.localRoomDefaults(locationId, signal),
    enabled: owner && !!locationId,
  });
  const available = (defaults.data ?? []).filter((item) => item.status !== 'Archived');
  const selected = available.find((item) => item.id === defaultsId);
  const save = useMutation({
    mutationFn: () => {
      const input = {
        rooms: rows.map((row) => ({
          roomNumber: row.roomNumber.trim(),
          floor: row.floor.trim() || null,
          roomDefaultsId: row.roomDefaultsId,
          expectedVersion: row.expectedVersion,
          rent: row.rent,
        })),
        effectiveFrom,
      };
      const body = JSON.stringify(input);
      if (operation.current?.body !== body) operation.current = { body, key: crypto.randomUUID() };
      return api.createConfiguredRooms(locationId, input, operation.current.key);
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      close();
    },
  });
  const staleRows = rows.some(
    (row) =>
      !available.some(
        (item) => item.id === row.roomDefaultsId && item.version === row.expectedVersion,
      ),
  );
  const invalidRows =
    rows.some(
      (row) =>
        !row.roomNumber.trim() ||
        row.roomNumber.trim().length > 50 ||
        !row.rent.trim() ||
        !Number.isFinite(Number(row.rent)) ||
        Number(row.rent) < 0,
    ) || new Set(rows.map((row) => row.roomNumber.trim().toUpperCase())).size !== rows.length;
  const validGenerator =
    !!selected &&
    Number.isInteger(Number(count)) &&
    Number(count) >= 1 &&
    Number(count) <= 200 &&
    !!start.trim() &&
    Number.isInteger(Number(start)) &&
    Number(start) >= 0 &&
    Number(start) <= 999999 &&
    floor.trim().length <= 30 &&
    (prefix + String(Number(start) + Number(count) - 1)).trim().length <= 50;
  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => !save.isPending && close()}>
      <DialogTitle>Tạo phòng hàng loạt</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Alert severity="info">
            Chọn gợi ý của cơ sở, tạo danh sách xem trước và kiểm tra từng phòng. Hệ thống lưu cấu
            hình và phiên bản nguồn cho các phòng mới, không thay đổi gợi ý hoặc tạo tài sản thực
            tế.
          </Alert>
          {defaults.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void defaults.refetch()}>Thử lại</Button>}
            >
              {invoiceError(defaults.error)}
            </Alert>
          )}
          {owner && defaults.isSuccess && !available.length && (
            <Alert
              severity="info"
              action={
                <Button component={Link} to={`/locations/${locationId}/room-types`} onClick={close}>
                  Tạo gợi ý
                </Button>
              }
            >
              Cơ sở chưa có gợi ý tạo phòng đang sử dụng.
            </Alert>
          )}
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
            Quy tắc đặt số phòng
          </Typography>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!validGenerator || !selected || save.isPending) return;
              setRows(
                Array.from({ length: Number(count) }, (_, i) => ({
                  roomNumber: `${prefix}${Number(start) + i}`,
                  floor,
                  roomDefaultsId: selected.id,
                  expectedVersion: selected.version,
                  capacity: selected.data.defaults.capacity,
                  name: selected.data.name,
                  rent:
                    selected.data.defaults.referenceRent == null
                      ? ''
                      : String(selected.data.defaults.referenceRent),
                })),
              );
              save.reset();
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
                '& > *': { minWidth: 0 },
              }}
            >
              <TextField
                label="Tầng"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 30 } }}
              />
              <TextField
                select
                required
                label="Gợi ý tạo phòng"
                value={selected ? defaultsId : ''}
                onChange={(e) => setDefaultsId(e.target.value)}
              >
                <MenuItem value="">Chọn gợi ý</MenuItem>
                {available.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.data.name} · {item.data.defaults.capacity} người
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
            {selected && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Phiên bản {selected.version} · {selected.data.defaults.area} m² ·{' '}
                {selected.data.defaults.amenities.join(', ') || 'Chưa khai báo tiện nghi'}
              </Typography>
            )}
            {validGenerator && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Sẽ tạo {count} phòng, từ {prefix}
                {Number(start)} đến {prefix}
                {Number(start) + Number(count) - 1}.
              </Typography>
            )}
            <Button
              type="submit"
              variant="outlined"
              sx={{ mt: 2 }}
              disabled={save.isPending || !validGenerator || !owner}
            >
              Tạo danh sách xem trước
            </Button>
          </Box>
          {rows.length > 0 && (
            <>
              <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>
                Xem trước {rows.length} phòng · Chưa lưu
              </Typography>
              <TableContainer
                sx={{
                  maxHeight: 350,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '8px',
                }}
              >
                <Table
                  stickyHeader
                  size="small"
                  aria-label="Danh sách phòng xem trước"
                  sx={{ minWidth: 720 }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>Số phòng</TableCell>
                      <TableCell>Tầng</TableCell>
                      <TableCell>Gợi ý</TableCell>
                      <TableCell>Sức chứa</TableCell>
                      <TableCell>Giá thuê (VND/tháng)</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField
                            size="small"
                            sx={{ minWidth: 110 }}
                            value={row.roomNumber}
                            disabled={save.isPending}
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
                        <TableCell>{row.floor || '—'}</TableCell>
                        <TableCell>
                          {row.name} · bản {row.expectedVersion}
                        </TableCell>
                        <TableCell>{row.capacity} người</TableCell>
                        <TableCell>
                          <MoneyField
                            allowDecimal
                            sx={{ minWidth: 150 }}
                            size="small"
                            value={row.rent}
                            disabled={save.isPending}
                            onValueChange={(raw) =>
                              setRows((old) =>
                                old.map((item, i) => (i === index ? { ...item, rent: raw } : item)),
                              )
                            }
                            slotProps={{
                              htmlInput: {
                                'aria-label': `Giá thuê phòng ${index + 1}`,
                                min: 0,
                                step: 1,
                              },
                            }}
                          />
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
                  Kiểm tra số phòng không trùng, không bỏ trống và giá thuê hợp lệ.
                </Alert>
              )}
              {staleRows && (
                <Alert severity="warning">
                  Gợi ý đã thay đổi hoặc ngừng sử dụng. Tạo lại danh sách xem trước để lấy phiên bản
                  mới.
                </Alert>
              )}
              <TextField
                label="Ngày hiệu lực giá thuê"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                disabled={save.isPending}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayVietnam() } }}
              />
              <Alert severity="info">
                Xác nhận tạo phòng đồng thời lưu giá thuê riêng cho từng phòng từ ngày hiệu lực đã
                chọn.
              </Alert>
            </>
          )}
          {save.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void defaults.refetch()}>Tải lại gợi ý</Button>}
            >
              {invoiceError(save.error)} Danh sách được giữ lại để bạn kiểm tra trước khi thử lại.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={save.isPending} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          disabled={
            save.isPending ||
            !rows.length ||
            invalidRows ||
            staleRows ||
            !owner ||
            !effectiveFrom ||
            effectiveFrom < todayVietnam()
          }
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
