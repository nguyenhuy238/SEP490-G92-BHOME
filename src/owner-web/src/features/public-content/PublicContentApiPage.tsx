import { useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { PageHeader, ConfirmDialog, StatusChip } from '../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { vnd } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
interface Photo {
  index: number;
  contentType: string;
  length: number;
  url: string;
}
interface PublicContent {
  locationId: string;
  roomId?: string;
  name?: string;
  address?: string;
  summary?: string;
  roomNumber?: string;
  floor?: string;
  capacity?: number;
  vacancy?: string;
  description?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  indicativePrice?: string | number | null;
  amenities: string[];
  photos: Photo[];
  published: boolean;
  publishedAt: string | null;
}
export function PublicContentApiPage() {
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState('');
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Nội dung website công khai"
        subtitle="Chỉ xuất bản thông tin và ảnh Owner đã duyệt. Khách xem thông tin; liên hệ qua số điện thoại/email tĩnh."
      />
      <OwnerLocationPicker
        value={location}
        change={(id) => {
          setLocation(id);
          setRoom('');
        }}
        required
      />
      <OwnerRoomPicker key={location} location={location} value={room} change={setRoom} />
      {location && (
        <ContentRecord
          key={room || location}
          target={room ? 'rooms' : 'locations'}
          id={room || location}
        />
      )}
    </Stack>
  );
}
export function ContentRecord({ target, id }: { target: 'locations' | 'rooms'; id: string }) {
  const path = `/api/v1/public-content/${target}/${id}`;
  const q = useOwnerQuery<PublicContent>(['public-content', target, id], path);
  return (
    <>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      {q.data && (
        <ContentEditor
          key={JSON.stringify(q.data)}
          data={q.data}
          path={path}
          room={target === 'rooms'}
        />
      )}
    </>
  );
}
function ContentEditor({ data, path, room }: { data: PublicContent; path: string; room: boolean }) {
  const [description, setDescription] = useState(
      room ? (data.description ?? '') : (data.summary ?? ''),
    ),
    [amenities, setAmenities] = useState(data.amenities.join('\n'));
  const [phone, setPhone] = useState(data.contactPhone ?? ''),
    [email, setEmail] = useState(data.contactEmail ?? ''),
    [price, setPrice] = useState(data.indicativePrice == null ? '' : String(data.indicativePrice));
  const [file, setFile] = useState<File | null>(null),
    [confirm, setConfirm] = useState(''),
    [photoIndex, setPhotoIndex] = useState(-1),
    [preview, setPreview] = useState(false);
  const action = useOwnerAction();
  const dirty =
    description !== (room ? (data.description ?? '') : (data.summary ?? '')) ||
    amenities !== data.amenities.join('\n') ||
    (!room && (phone !== (data.contactPhone ?? '') || email !== (data.contactEmail ?? ''))) ||
    (room && price !== (data.indicativePrice == null ? '' : String(data.indicativePrice)));
  async function save() {
    const ok = await action.run(async () => {
      if (confirm === 'save') {
        const base = {
          amenities: amenities
            .split('\n')
            .map((a) => a.trim())
            .filter(Boolean),
        };
        await action.command(
          path,
          'PUT',
          room
            ? { ...base, description, indicativePrice: price ? vnd(price) : null }
            : {
                ...base,
                summary: description,
                contactPhone: phone.trim() || null,
                contactEmail: email.trim() || null,
              },
        );
      } else if (confirm === 'delete')
        await action.command(`${path}/photos/${photoIndex}`, 'DELETE');
      else if (confirm === 'upload') {
        if (
          !file ||
          file.size > 5 * 1024 * 1024 ||
          !['image/png', 'image/jpeg'].includes(file.type)
        )
          throw new Error('Chọn ảnh PNG/JPEG không quá 5 MB.');
        // This upload has no replay contract: after an uncertain response, inspect the photo list before another upload.
        await action.request(`${path}/photos`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        setFile(null);
      } else await action.command(`${path}/${confirm}`, 'POST');
    });
    if (ok) setConfirm('');
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <OwnerFeedback busy={action.busy} error={action.error} notice={action.notice} />
        <Typography variant="h6">{room ? `Phòng ${data.roomNumber}` : data.name}</Typography>
        <Typography>
          {data.address ||
            `Tầng ${data.floor ?? '—'} · Sức chứa ${data.capacity} · ${data.vacancy}`}
        </Typography>
        <StatusChip label={data.published ? 'Đã xuất bản' : 'Chưa xuất bản'} />
        {data.publishedAt && (
          <Typography>Xuất bản lúc: {formatInstant(data.publishedAt)}</Typography>
        )}
        <TextField
          label="Giới thiệu công khai"
          multiline
          minRows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          disabled={action.busy}
        />
        <TextField
          label="Tiện ích (mỗi dòng một mục)"
          multiline
          minRows={2}
          value={amenities}
          onChange={(e) => setAmenities(e.target.value)}
          disabled={action.busy}
        />
        {room ? (
          <TextField
            label="Giá tham khảo (VND)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={action.busy}
          />
        ) : (
          <>
            <TextField
              label="Số điện thoại liên hệ tĩnh"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={action.busy}
            />
            <TextField
              label="Email liên hệ tĩnh"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={action.busy}
            />
          </>
        )}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button disabled={action.busy || !dirty} onClick={() => setConfirm('save')}>
            Lưu nội dung công khai
          </Button>
          <Button onClick={() => setPreview(!preview)}>
            {preview ? 'Đóng xem trước' : 'Xem trước nội dung'}
          </Button>
          <Button
            disabled={action.busy || dirty || data.published}
            onClick={() => setConfirm('publish')}
          >
            Xuất bản nội dung đã lưu
          </Button>
          <Button disabled={action.busy || !data.published} onClick={() => setConfirm('unpublish')}>
            Gỡ xuất bản
          </Button>
        </Stack>
        {dirty && (
          <Alert severity="info">
            Lưu nội dung trước khi xuất bản. Bản xem trước bên dưới chỉ hiển thị trường được phép
            công khai.
          </Alert>
        )}
        {preview && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6">{room ? `Phòng ${data.roomNumber}` : data.name}</Typography>
            <Typography>{description}</Typography>
            <Typography>{amenities.split('\n').filter(Boolean).join(' · ')}</Typography>
            {room ? (
              <Typography>Giá tham khảo: {price || 'Liên hệ'}</Typography>
            ) : (
              <Typography>
                Liên hệ: {phone} · {email}
              </Typography>
            )}
          </Paper>
        )}
        <Typography variant="h6">Ảnh công khai được duyệt</Typography>
        {data.photos.map((photo) => (
          <Stack key={photo.index} spacing={1}>
            <PrivatePhoto
              path={`${path}/photos/${photo.index}`}
              revision={photo.url + photo.length}
            />
            <Typography>
              Ảnh {photo.index + 1} · {photo.contentType} · {photo.length} byte
            </Typography>
            <Button
              disabled={action.busy}
              onClick={() => {
                setPhotoIndex(photo.index);
                setConfirm('delete');
              }}
            >
              Xóa ảnh {photo.index + 1}
            </Button>
          </Stack>
        ))}
        <input
          aria-label="Ảnh công khai mới"
          type="file"
          accept="image/png,image/jpeg"
          disabled={action.busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button disabled={!file || action.busy} onClick={() => setConfirm('upload')}>
          Tải ảnh được phép công khai
        </Button>
        <Alert severity="info">
          PNG/JPEG, tối đa 5 MB mỗi ảnh. Kiểm tra danh sách ảnh sau lỗi mạng trước khi tải lại. Xuất
          bản phòng còn phụ thuộc trạng thái xuất bản cơ sở theo kiểm tra máy chủ.
        </Alert>
        <ConfirmDialog
          open={!!confirm}
          title={
            {
              save: 'Lưu nội dung',
              publish: 'Xuất bản thông tin đã duyệt',
              unpublish: 'Gỡ thông tin khỏi website',
              delete: 'Xóa ảnh công khai',
              upload: 'Duyệt và tải ảnh công khai',
            }[confirm] ?? ''
          }
          busy={action.busy}
          error={action.error}
          onClose={() => setConfirm('')}
          onConfirm={() => void save()}
        >
          {confirm === 'publish' || confirm === 'upload'
            ? 'Xác nhận nội dung/ảnh chỉ chứa thông tin được phép cho khách xem, không có giấy tờ định danh hoặc dữ liệu Tenant.'
            : 'Thay đổi được lưu trên máy chủ. Sau khi gỡ, bản sao cache công khai có thể tồn tại trong thời gian cache hiện hành.'}
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}
function PrivatePhoto({ path, revision }: { path: string; revision: string }) {
  const action = useOwnerAction();
  const request = action.request;
  const [image, setImage] = useState<{ url: string; path: string; revision: string } | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    void request<Blob>(path, { signal: controller.signal }, 'blob').then(
      (blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setImage({ url, path, revision });
          setError(false);
        }
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      },
    );
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [request, path, revision]);
  return error ? (
    <Alert severity="warning">Không tải được ảnh xem trước có xác thực.</Alert>
  ) : image?.path === path && image.revision === revision ? (
    <Box
      component="img"
      src={image.url}
      alt="Ảnh công khai đã lưu"
      sx={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }}
    />
  ) : (
    <Typography>Đang tải ảnh…</Typography>
  );
}
