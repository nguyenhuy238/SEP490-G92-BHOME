import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import type { LocalRoomDefaultsData } from '../../../../../packages/client-core/src/locationSetup';
import type { SetupDocument } from '../../../../../packages/client-core/src/propertySetup';

interface PublicRoom {
  roomId: string;
  roomNumber: string;
  description: string;
  amenities: string[];
  indicativePrice: number | string | null;
  photos: { index: number }[];
  version: number;
  published: boolean;
  publicationStatus: string;
}
interface PreviewRow {
  roomId: string;
  roomNumber: string;
  currentVersion: number;
  status: 'Ready' | 'Conflict' | 'Skipped' | 'Applied';
  changes: { field: string; oldValue: string; newValue: string; conflict: boolean }[];
  issue: string | null;
}
interface Preview {
  previewHash: string;
  rooms: PreviewRow[];
}
type Field = 'description' | 'amenities' | 'indicativePrice';
type Mode = 'Room' | 'RoomDefaults' | 'Manual' | 'Publish' | 'Unpublish';
const fields: { id: Field; label: string }[] = [
  { id: 'description', label: 'Mô tả phòng' },
  { id: 'amenities', label: 'Tiện nghi' },
  { id: 'indicativePrice', label: 'Giá tham khảo' },
];
const labels: Record<string, string> = {
  description: 'Mô tả phòng',
  amenities: 'Tiện nghi',
  indicativePrice: 'Giá tham khảo',
  published: 'Đăng lên website',
};
const MAX_BULK_ROOMS = 100;
const issues: Record<string, string> = {
  stale_version: 'Phòng vừa được sửa; tải lại dữ liệu',
  stale_source_version: 'Phòng hoặc loại phòng nguồn đã thay đổi',
  source_not_in_location: 'Nguồn không còn thuộc cơ sở',
  source_not_active: 'Loại phòng đã ngừng sử dụng',
  room_defaults_not_assigned: 'Phòng không thuộc loại phòng đã chọn',
  room_not_in_location: 'Phòng không thuộc cơ sở này',
  public_location_not_published: 'Đăng thông tin cơ sở lên website trước',
  public_room_incomplete: 'Phòng cần mô tả trước khi đăng',
};

export function PublicRoomsWorkspace({
  location,
  onEdit,
}: {
  location: string;
  onEdit: (roomId: string) => void;
}) {
  const query = useOwnerQuery<PublicRoom[]>(
    ['public-content', 'rooms', location],
    `/api/v1/public-content/locations/${location}/rooms`,
  );
  const defaults = useOwnerQuery<SetupDocument<LocalRoomDefaultsData>[]>(
    ['public-room-defaults', location],
    `/api/v1/locations/${location}/room-defaults`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('RoomDefaults');
  const [sourceId, setSourceId] = useState('');
  const [chosenFields, setChosenFields] = useState<Field[]>([
    'description',
    'amenities',
    'indicativePrice',
  ]);
  const [fillEmpty, setFillEmpty] = useState(true);
  const [description, setDescription] = useState('');
  const [amenities, setAmenities] = useState('');
  const [price, setPrice] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewRequest, setPreviewRequest] = useState<Record<string, unknown> | null>(null);
  const [results, setResults] = useState<PreviewRow[] | null>(null);
  const action = useOwnerAction();
  const rooms = query.data ?? [];
  const roomDefaults = (defaults.data ?? []).filter((item) => item.status === 'Recorded');
  const suggestedAmenities = [
    ...new Set(roomDefaults.flatMap((item) => item.data.defaults.amenities ?? [])),
  ].sort((a, b) => a.localeCompare(b, 'vi'));
  const selectedRooms = rooms.filter((item) => selected.includes(item.roomId));
  const source =
    mode === 'Room'
      ? rooms.find((item) => item.roomId === sourceId)
      : roomDefaults.find((item) => item.id === sourceId);

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...new Set([...current, id])].slice(0, MAX_BULK_ROOMS)
        : current.filter((item) => item !== id),
    );
    setPreview(null);
    setResults(null);
  };
  function resetPreview() {
    setPreview(null);
    setPreviewRequest(null);
    setResults(null);
  }
  function requestBody() {
    return {
      mode,
      targets: selectedRooms.map((item) => ({
        roomId: item.roomId,
        expectedVersion: item.version,
      })),
      sourceId: mode === 'Room' || mode === 'RoomDefaults' ? sourceId : null,
      sourceVersion: source && 'version' in source ? source.version : null,
      fields: mode === 'Publish' || mode === 'Unpublish' ? [] : chosenFields,
      fillEmptyOnly: fillEmpty,
      description: mode === 'Manual' ? description : null,
      amenities:
        mode === 'Manual'
          ? amenities
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
      indicativePrice: mode === 'Manual' && price ? Number(price) : null,
    };
  }
  const valid =
    selectedRooms.length > 0 &&
    (mode === 'Publish' ||
      mode === 'Unpublish' ||
      (chosenFields.length > 0 && (mode === 'Manual' || !!source))) &&
    (mode !== 'Manual' ||
      (description.length <= 2000 &&
        amenities.split('\n').filter(Boolean).length <= 50 &&
        amenities.split('\n').every((s) => s.trim().length <= 100) &&
        (!price || (/^\d+$/.test(price) && Number.isSafeInteger(Number(price))))));
  async function createPreview() {
    const body = requestBody();
    await action.run(async () => {
      const result = await action.command<Preview>(
        `/api/v1/public-content/locations/${location}/rooms/bulk/preview`,
        'POST',
        body,
      );
      setPreview(result);
      setPreviewRequest(body);
      setResults(null);
    }, 'Đã kiểm tra các thay đổi dự kiến. Chưa lưu hoặc đăng lên website.');
  }
  async function apply() {
    if (!preview || !previewRequest) return;
    await action.run(async () => {
      const result = await action.command<{ rooms: PreviewRow[] }>(
        `/api/v1/public-content/locations/${location}/rooms/bulk/apply`,
        'POST',
        { ...previewRequest, previewHash: preview.previewHash },
      );
      setResults(result.rooms);
      setPreview(null);
      setPreviewRequest(null);
      setSelected([]);
      await query.refetch();
    }, 'Đã xử lý những phòng hợp lệ. Kiểm tra kết quả từng phòng bên dưới.');
  }
  return (
    <Stack spacing={2}>
      <OwnerFeedback
        busy={query.isFetching || action.busy}
        error={query.error || defaults.error}
        notice={action.notice}
      />
      {!!action.error && <Alert severity="error">{action.error}</Alert>}
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
      >
        <Typography variant="h6">Danh sách phòng · {rooms.length} phòng</Typography>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          Tải lại danh sách
        </Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: '100%' }}>
        <Table size="small" aria-label="Danh sách nội dung phòng">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  slotProps={{ input: { 'aria-label': 'Chọn tối đa 100 phòng' } }}
                  checked={rooms.length > 0 && selectedRooms.length === rooms.length}
                  indeterminate={selectedRooms.length > 0 && selectedRooms.length < rooms.length}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? rooms.slice(0, MAX_BULK_ROOMS).map((item) => item.roomId)
                        : [],
                    );
                    resetPreview();
                  }}
                />
              </TableCell>
              <TableCell>Phòng</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell>Ảnh</TableCell>
              <TableCell>Giá tham khảo/tháng</TableCell>
              <TableCell>Thao tác</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rooms.map((item) => (
              <TableRow key={item.roomId}>
                <TableCell padding="checkbox">
                  <Checkbox
                    slotProps={{ input: { 'aria-label': `Chọn phòng ${item.roomNumber}` } }}
                    checked={selected.includes(item.roomId)}
                    disabled={selected.length >= MAX_BULK_ROOMS && !selected.includes(item.roomId)}
                    onChange={(e) => toggle(item.roomId, e.target.checked)}
                  />
                </TableCell>
                <TableCell>Phòng {item.roomNumber}</TableCell>
                <TableCell>
                  {item.published
                    ? 'Đang đăng'
                    : item.publicationStatus === 'Hidden'
                      ? 'Đã ẩn'
                      : 'Bản nháp'}
                </TableCell>
                <TableCell>{item.photos.length} ảnh</TableCell>
                <TableCell>
                  {item.indicativePrice == null
                    ? 'Chưa có'
                    : `${new Intl.NumberFormat('vi-VN').format(Number(item.indicativePrice))} ₫`}
                </TableCell>
                <TableCell>
                  <Button size="small" onClick={() => onEdit(item.roomId)}>
                    Chỉnh sửa
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!rooms.length && (
              <TableRow>
                <TableCell colSpan={6}>Chưa có phòng tại cơ sở.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack spacing={2}>
          <Typography variant="h6">Thao tác với {selectedRooms.length} phòng đã chọn</Typography>
          {rooms.length > MAX_BULK_ROOMS && (
            <Typography variant="body2" color="text.secondary">
              Mỗi lượt xử lý tối đa {MAX_BULK_ROOMS} phòng. Bạn có thể bỏ chọn và chọn tiếp các
              phòng còn lại.
            </Typography>
          )}
          <TextField
            select
            size="small"
            label="Cách áp dụng"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setSourceId('');
              resetPreview();
            }}
          >
            <MenuItem value="RoomDefaults">Áp dụng theo loại phòng</MenuItem>
            <MenuItem value="Room">Sao chép từ phòng khác</MenuItem>
            <MenuItem value="Manual">Chỉnh sửa hàng loạt</MenuItem>
            <MenuItem value="Publish">Đăng lên website</MenuItem>
            <MenuItem value="Unpublish">Ẩn khỏi website</MenuItem>
          </TextField>
          {(mode === 'Room' || mode === 'RoomDefaults') && (
            <TextField
              size="small"
              select
              label={mode === 'Room' ? 'Phòng nguồn' : 'Loại phòng'}
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                resetPreview();
              }}
              helperText={
                mode === 'RoomDefaults'
                  ? 'Chỉ đề xuất cho phòng đã gắn loại này.'
                  : 'Sao chép nội dung và tiện nghi; ảnh vẫn thuộc từng phòng.'
              }
            >
              <MenuItem value="">Chọn nguồn</MenuItem>
              {(mode === 'Room'
                ? rooms.filter((item) => !selected.includes(item.roomId))
                : roomDefaults
              ).map((item) => (
                <MenuItem
                  key={
                    mode === 'Room'
                      ? (item as PublicRoom).roomId
                      : (item as SetupDocument<LocalRoomDefaultsData>).id
                  }
                  value={
                    mode === 'Room'
                      ? (item as PublicRoom).roomId
                      : (item as SetupDocument<LocalRoomDefaultsData>).id
                  }
                >
                  {mode === 'Room'
                    ? `Phòng ${(item as PublicRoom).roomNumber}`
                    : (item as SetupDocument<LocalRoomDefaultsData>).data.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {mode === 'Manual' && (
            <Stack spacing={1}>
              <TextField
                label="Mô tả phòng"
                multiline
                minRows={2}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  resetPreview();
                }}
              />
              <TextField
                label="Tiện nghi (mỗi dòng một mục)"
                multiline
                minRows={2}
                value={amenities}
                onChange={(e) => {
                  setAmenities(e.target.value);
                  resetPreview();
                }}
              />
              {suggestedAmenities.length > 0 && (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Chọn nhanh tiện nghi từ loại phòng
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {suggestedAmenities.map((name) => (
                      <FormControlLabel
                        key={name}
                        control={
                          <Checkbox
                            size="small"
                            checked={amenities
                              .split('\n')
                              .map((value) => value.trim())
                              .includes(name)}
                            onChange={(event) => {
                              const current = amenities
                                .split('\n')
                                .map((value) => value.trim())
                                .filter(Boolean);
                              setAmenities(
                                (event.target.checked
                                  ? [...new Set([...current, name])]
                                  : current.filter((value) => value !== name)
                                ).join('\n'),
                              );
                              resetPreview();
                            }}
                          />
                        }
                        label={name}
                      />
                    ))}
                  </Box>
                </Box>
              )}
              <TextField
                label="Giá tham khảo mỗi phòng/tháng (VND)"
                type="number"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  resetPreview();
                }}
              />
            </Stack>
          )}
          {mode !== 'Publish' && mode !== 'Unpublish' && (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {fields.map((field) => (
                  <FormControlLabel
                    key={field.id}
                    control={
                      <Checkbox
                        checked={chosenFields.includes(field.id)}
                        onChange={(e) => {
                          setChosenFields((current) =>
                            e.target.checked
                              ? [...current, field.id]
                              : current.filter((id) => id !== field.id),
                          );
                          resetPreview();
                        }}
                      />
                    }
                    label={field.label}
                  />
                ))}
              </Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={fillEmpty}
                    onChange={(e) => {
                      setFillEmpty(e.target.checked);
                      resetPreview();
                    }}
                  />
                }
                label="Chỉ điền những trường còn trống"
              />
            </>
          )}
          <Button
            variant="outlined"
            disabled={!valid || action.busy}
            onClick={() => void createPreview()}
          >
            Xem trước thay đổi
          </Button>
          {preview && (
            <>
              <Typography variant="subtitle1">Kiểm tra từng phòng trước khi xác nhận</Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Xem trước thay đổi hàng loạt">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phòng</TableCell>
                      <TableCell>Trạng thái</TableCell>
                      <TableCell>Trường</TableCell>
                      <TableCell>Giá trị cũ</TableCell>
                      <TableCell>Giá trị mới</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.rooms.flatMap((row) =>
                      row.changes.length
                        ? row.changes.map((change) => (
                            <TableRow key={row.roomId + change.field}>
                              <TableCell>{row.roomNumber}</TableCell>
                              <TableCell>
                                {change.conflict ? 'Ghi đè trường riêng' : 'Sẵn sàng'}
                              </TableCell>
                              <TableCell>{labels[change.field]}</TableCell>
                              <TableCell>{change.oldValue || 'Trống'}</TableCell>
                              <TableCell>{change.newValue}</TableCell>
                            </TableRow>
                          ))
                        : [
                            <TableRow key={row.roomId}>
                              <TableCell>{row.roomNumber}</TableCell>
                              <TableCell>
                                {row.issue ? (issues[row.issue] ?? row.issue) : 'Không có thay đổi'}
                              </TableCell>
                              <TableCell colSpan={3}>—</TableCell>
                            </TableRow>,
                          ],
                    )}
                  </TableBody>
                </Table>
              </Box>
              <Button
                variant="contained"
                disabled={action.busy || !preview.rooms.some((row) => row.status === 'Ready')}
                onClick={() => void apply()}
              >
                Xác nhận{' '}
                {mode === 'Publish'
                  ? 'đăng lên website'
                  : mode === 'Unpublish'
                    ? 'ẩn khỏi website'
                    : 'áp dụng thay đổi'}
              </Button>
            </>
          )}
          {results && (
            <>
              <Alert
                severity={results.some((row) => row.status === 'Conflict') ? 'warning' : 'success'}
              >
                Đã áp dụng {results.filter((row) => row.status === 'Applied').length} phòng; bỏ qua{' '}
                {results.filter((row) => row.status === 'Skipped').length} phòng; xung đột{' '}
                {results.filter((row) => row.status === 'Conflict').length} phòng.
              </Alert>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label="Kết quả xử lý từng phòng">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phòng</TableCell>
                      <TableCell>Kết quả</TableCell>
                      <TableCell>Chi tiết</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {results.map((row) => (
                      <TableRow key={row.roomId}>
                        <TableCell>{row.roomNumber}</TableCell>
                        <TableCell>
                          {row.status === 'Applied'
                            ? 'Đã áp dụng'
                            : row.status === 'Skipped'
                              ? 'Không thay đổi'
                              : 'Cần xử lý'}
                        </TableCell>
                        <TableCell>
                          {row.issue
                            ? (issues[row.issue] ?? row.issue)
                            : row.status === 'Applied'
                              ? row.changes.map((change) => labels[change.field]).join(', ')
                              : 'Không có thay đổi'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
