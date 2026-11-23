import { ValidatedInput } from '../../components/common/ValidatedForm';
import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { TextField } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../../packages/client-core/src/contactPhone';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  PageHeader,
  ConfirmDialog,
  StatusChip,
  FilterToolbar,
} from '../../components/common/PortalUI';
import { OwnerLocationPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery } from '../../hooks/useOwnerWorkspace';
import { vnd } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { PublicRoomsWorkspace } from './PublicRoomsWorkspace';
interface Draft {
  description: string;
  amenities: string;
  phone: string;
  email: string;
  price: string;
  photoOrder: number[];
}
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
  publicationStatus?: 'Draft' | 'Published' | 'Hidden';
  publishedAt: string | null;
}
export function PublicContentApiPage() {
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState('');
  const [tab, setTab] = useState(0);
  const [drafts] = useState(() => new Map<string, Draft>());
  const [busy, setBusy] = useState(false);
  return (
    <Stack spacing={2}>
      <PageHeader title="Quản lý nội dung website" />
      <FilterToolbar>
        <OwnerLocationPicker
          value={location}
          change={(id) => {
            if (busy) return;
            setLocation(id);
            setRoom('');
          }}
          required
        />
      </FilterToolbar>
      {!location && (
        <Alert severity="info">
          Chọn một cơ sở để quản lý thông tin công khai và danh sách phòng trên website.
        </Alert>
      )}
      {location && (
        <Tabs
          value={tab}
          onChange={(_, value: number) => {
            setTab(value);
            setRoom('');
          }}
          aria-label="Phạm vi nội dung website"
        >
          <Tab label="Theo cơ sở" />
          <Tab label="Theo phòng" />
        </Tabs>
      )}
      {location && tab === 0 && (
        <ContentRecord
          key={`content-${location}`}
          target="locations"
          id={location}
          drafts={drafts}
          onBusy={setBusy}
        />
      )}
      {location && tab === 1 && (
        <>
          <PublicRoomsWorkspace key={location} location={location} onEdit={setRoom} />
          {!!room && (
            <Stack spacing={1}>
              <Button onClick={() => setRoom('')}>Đóng chỉnh sửa phòng</Button>
              <ContentRecord
                key={`content-${room}`}
                target="rooms"
                id={room}
                drafts={drafts}
                onBusy={setBusy}
              />
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
export function ContentRecord({
  target,
  id,
  drafts,
  onBusy,
}: {
  target: 'locations' | 'rooms';
  id: string;
  drafts?: Map<string, Draft>;
  onBusy?: (busy: boolean) => void;
}) {
  const path = `/api/v1/public-content/${target}/${id}`;
  const q = useOwnerQuery<PublicContent>(['public-content', target, id], path);
  const location = useOwnerQuery<PublicContent>(
    ['public-content', 'locations', q.data?.locationId],
    `/api/v1/public-content/locations/${q.data?.locationId}`,
    target === 'rooms' && !!q.data?.locationId,
  );
  return (
    <>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      {target === 'rooms' && <OwnerFeedback busy={location.isFetching} error={location.error} />}
      {!!location.error && (
        <Button onClick={() => void location.refetch()}>Thử tải lại thông tin cơ sở</Button>
      )}
      {!!q.error && <Button onClick={() => void q.refetch()}>Thử tải lại nội dung</Button>}
      {!q.error && q.data && (
        <ContentEditor
          key={JSON.stringify(q.data)}
          data={q.data}
          path={path}
          room={target === 'rooms'}
          drafts={drafts}
          onBusy={onBusy}
          location={location.data}
          reload={() => void q.refetch()}
        />
      )}
    </>
  );
}
function ContentEditor({
  data,
  path,
  room,
  drafts,
  onBusy,
  location,
  reload,
}: {
  data: PublicContent;
  path: string;
  room: boolean;
  drafts?: Map<string, Draft>;
  onBusy?: (busy: boolean) => void;
  location?: PublicContent;
  reload: () => void;
}) {
  const savedDraft = drafts?.get(path);
  const fileInput = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(
      savedDraft?.description ?? (room ? (data.description ?? '') : (data.summary ?? '')),
    ),
    [amenities, setAmenities] = useState(savedDraft?.amenities ?? data.amenities.join('\n'));
  const [phone, setPhone] = useState(savedDraft?.phone ?? data.contactPhone ?? ''),
    [email, setEmail] = useState(savedDraft?.email ?? data.contactEmail ?? ''),
    [price, setPrice] = useState(
      savedDraft?.price ?? (data.indicativePrice == null ? '' : String(data.indicativePrice)),
    );
  const [file, setFile] = useState<File | null>(null),
    [confirm, setConfirm] = useState(''),
    [photoIndex, setPhotoIndex] = useState(-1),
    [preview, setPreview] = useState(false);
  const [photoOrder, setPhotoOrder] = useState(
    savedDraft
      ? [
          ...savedDraft.photoOrder.filter((i) => data.photos.some((p) => p.index === i)),
          ...data.photos.map((p) => p.index).filter((i) => !savedDraft.photoOrder.includes(i)),
        ]
      : data.photos.map((p) => p.index),
  );
  const action = useOwnerAction();
  useEffect(() => {
    onBusy?.(action.busy);
    return () => onBusy?.(false);
  }, [action.busy, onBusy]);
  useEffect(() => {
    drafts?.set(path, { description, amenities, phone, email, price, photoOrder });
  }, [drafts, path, description, amenities, phone, email, price, photoOrder]);
  const emailError =
    !room && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Nhập email liên hệ hợp lệ.' : '';
  const invalid =
    !!emailError ||
    description.length > 2000 ||
    amenities.split('\n').filter((a) => a.trim()).length > 50 ||
    amenities.split('\n').some((a) => a.trim().length > 100);
  const phoneError = room ? '' : contactPhoneError(phone);
  const dirty =
    description !== (room ? (data.description ?? '') : (data.summary ?? '')) ||
    amenities !== data.amenities.join('\n') ||
    (!room && (phone !== (data.contactPhone ?? '') || email !== (data.contactEmail ?? ''))) ||
    (room && price !== (data.indicativePrice == null ? '' : String(data.indicativePrice))) ||
    photoOrder.join(',') !== data.photos.map((p) => p.index).join(',');
  async function save() {
    if (confirm === 'save' && (phoneError || invalid)) return;
    const ok = await action.run(async () => {
      if (confirm === 'save') {
        const base = {
          ...(photoOrder.join(',') !== data.photos.map((p) => p.index).join(',')
            ? { photoOrder }
            : {}),
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
                contactPhone: normalizeContactPhone(phone) ?? null,
                contactEmail: email.trim() || null,
              },
        );
        drafts?.delete(path);
      } else if (confirm === 'delete')
        await action.command(`${path}/photos/${photoIndex}`, 'DELETE');
      else if (confirm === 'upload') {
        if (
          !file ||
          file.size > 5 * 1024 * 1024 ||
          !['image/png', 'image/jpeg'].includes(file.type)
        )
          throw new UserFeedbackError('Chọn ảnh PNG/JPEG không quá 5 MB.');
        // This upload has no replay contract: after an uncertain response, inspect the photo list before another upload.
        await action.request(`${path}/photos`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
      } else await action.command(`${path}/${confirm}`, 'POST');
      if (confirm === 'upload' || confirm === 'delete' || confirm === 'publish')
        drafts?.delete(path);
    });
    if (ok) setConfirm('');
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={2}>
        <OwnerFeedback busy={action.busy} error={action.error} notice={action.notice} />
        {!!action.error && (
          <Button disabled={action.busy} onClick={reload}>
            Tải lại danh sách ảnh và trạng thái
          </Button>
        )}
        <Typography variant="h6">{room ? `Phòng ${data.roomNumber}` : data.name}</Typography>
        <Typography>
          {data.address ||
            `Tầng ${data.floor ?? '—'} · Sức chứa ${data.capacity} · ${vacancyText(data.vacancy ?? '')}`}
        </Typography>
        <Typography variant="h6">{room ? 'Thông tin phòng' : 'Thông tin cơ sở'}</Typography>
        <StatusChip
          label={
            data.published
              ? 'Đã xuất bản'
              : data.publicationStatus === 'Hidden'
                ? 'Đã ẩn'
                : 'Chưa xuất bản'
          }
        />
        {data.publishedAt && (
          <Typography>Xuất bản lúc: {formatInstant(data.publishedAt)}</Typography>
        )}
        <TextField
          label={room ? 'Mô tả phòng' : 'Mô tả cơ sở'}
          multiline
          minRows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          disabled={action.busy}
        />
        <TextField
          helperText="Tối đa 50 tiện ích, mỗi mục không quá 100 ký tự."
          label="Tiện nghi (mỗi dòng một mục)"
          multiline
          minRows={2}
          value={amenities}
          onChange={(e) => setAmenities(e.target.value)}
          disabled={action.busy}
        />
        {room ? (
          <MoneyField
            label="Giá tham khảo (VND)"
            value={price}
            onValueChange={(raw) => setPrice(raw)}
            disabled={action.busy}
          />
        ) : (
          <>
            <TextField
              label="Số điện thoại liên hệ"
              type="tel"
              value={phone}
              error={!!phoneError}
              helperText={phoneError}
              onChange={(e) => setPhone(e.target.value)}
              disabled={action.busy}
            />
            <TextField
              error={!!emailError}
              helperText={emailError}
              label="Email liên hệ"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={action.busy}
            />
          </>
        )}
        <Typography variant="h6">Xuất bản</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            disabled={action.busy || !dirty || !!phoneError || invalid}
            onClick={() => setConfirm('save')}
          >
            Lưu bản nháp
          </Button>
          <Button disabled={action.busy} onClick={() => setPreview(!preview)}>
            {preview ? 'Đóng xem trước' : 'Xem trước nội dung'}
          </Button>
          <Button
            disabled={
              action.busy ||
              dirty ||
              invalid ||
              !!phoneError ||
              !description.trim() ||
              (!room && !phone.trim() && !email.trim())
            }
            onClick={() => setConfirm('publish')}
          >
            Đăng lên website
          </Button>
          <Button disabled={action.busy || !data.published} onClick={() => setConfirm('unpublish')}>
            Ẩn khỏi website
          </Button>
        </Stack>
        {dirty && (
          <Alert severity="info">
            Lưu nội dung trước khi xuất bản. Bản xem trước bên dưới chỉ hiển thị trường được phép
            công khai.
          </Alert>
        )}
        {preview && (
          <Paper
            component="section"
            aria-label="Bản xem trước"
            variant="outlined"
            sx={{ p: { xs: 1.5, md: 2 } }}
          >
            <Alert severity="info">Bản xem trước — Chưa công khai</Alert>
            <Typography variant="h5" sx={{ mt: 2 }}>
              {room ? `Phòng ${data.roomNumber}` : data.name}
            </Typography>
            <Typography>
              {data.address ??
                `Tầng ${data.floor ?? '—'} · ${data.capacity} người · ${vacancyText(data.vacancy ?? '')}`}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))' },
                gap: 2,
                my: 2,
              }}
            >
              {photoOrder.map((index) => {
                const photo = data.photos.find((p) => p.index === index);
                return photo ? (
                  <PrivatePhoto
                    key={index}
                    path={`${path}/photos/${index}`}
                    revision={photo.url + photo.length}
                  />
                ) : null;
              })}
            </Box>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{description}</Typography>
            {room && location && (
              <Typography>
                {location.name} · {location.address} · {location.contactPhone} ·{' '}
                {location.contactEmail}
              </Typography>
            )}
            <Typography>{amenities.split('\n').filter(Boolean).join(' · ')}</Typography>
            {room ? (
              <Typography>
                Giá tham khảo:{' '}
                {price
                  ? new Intl.NumberFormat('vi-VN').format(Number(price)) + ' ₫ / tháng (tham khảo)'
                  : 'Liên hệ để biết giá'}
              </Typography>
            ) : (
              <Typography>
                Liên hệ: {phone} · {email}
              </Typography>
            )}
          </Paper>
        )}
        <Typography variant="h6">{room ? 'Ảnh phòng' : 'Ảnh cơ sở'}</Typography>
        {photoOrder.map((index, position) => {
          const photo = data.photos.find((p) => p.index === index);
          return photo ? (
            <Stack
              key={photo.index}
              spacing={1}
              sx={{ borderBottom: 1, borderColor: 'divider', pb: 2 }}
            >
              <Typography>{position === 0 ? 'Ảnh đại diện' : `Vị trí ${position + 1}`}</Typography>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  disabled={action.busy || position === 0}
                  onClick={() => setPhotoOrder([index, ...photoOrder.filter((i) => i !== index)])}
                >
                  Đặt làm ảnh đại diện {photo.index + 1}
                </Button>
                <Button
                  disabled={action.busy || position === 0}
                  onClick={() => {
                    const next = [...photoOrder];
                    [next[position - 1], next[position]] = [next[position], next[position - 1]];
                    setPhotoOrder(next);
                  }}
                >
                  Đưa ảnh {photo.index + 1} lên trước
                </Button>
              </Stack>
              <PrivatePhoto
                path={`${path}/photos/${photo.index}`}
                revision={photo.url + photo.length}
              />
              <Typography>
                Ảnh {photo.index + 1} · {photo.contentType} · {photo.length} byte
              </Typography>
              <Button
                disabled={action.busy || dirty}
                onClick={() => {
                  setPhotoIndex(photo.index);
                  setConfirm('delete');
                }}
              >
                Xóa ảnh {photo.index + 1}
              </Button>
            </Stack>
          ) : null;
        })}
        <ValidatedInput
          ref={fileInput}
          aria-label="Ảnh công khai mới"
          type="file"
          hidden
          accept="image/png,image/jpeg"
          disabled={action.busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button disabled={action.busy} onClick={() => fileInput.current?.click()}>
            Chọn ảnh công khai
          </Button>
          <Typography variant="body2">{file?.name || 'Chưa chọn ảnh'}</Typography>
        </Stack>
        <Button
          disabled={!file || action.busy || data.photos.length >= 20 || dirty}
          onClick={() => setConfirm('upload')}
        >
          Tải ảnh được phép công khai
        </Button>
        <Alert severity="info">
          PNG/JPEG, tối đa 5 MB mỗi ảnh và 20 ảnh. Lưu bản nháp trước khi tải/xóa ảnh. Ảnh đầu là
          ảnh đại diện; lưu thứ tự và xuất bản để áp dụng. Kiểm tra danh sách ảnh sau lỗi mạng trước
          khi tải lại. Xuất bản phòng còn phụ thuộc trạng thái xuất bản cơ sở theo kiểm tra máy chủ.
        </Alert>
        <ConfirmDialog
          open={!!confirm}
          title={
            {
              save: 'Lưu bản nháp',
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
            : 'Thay đổi được lưu trên máy chủ. Lưu bản nháp không thay đổi phiên bản khách đang xem. Xóa ảnh sẽ thu hồi ảnh khỏi website ngay; gỡ xuất bản vẫn giữ nội dung đã nhập.'}
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}
function vacancyText(value: string) {
  return (
    {
      Available: 'Còn trống',
      OnHold: 'Đang giữ chỗ',
      Occupied: 'Đã có người ở',
      Unavailable: 'Tạm ngừng cho thuê',
    }[value] ?? 'Chưa xác định'
  );
}
function PrivatePhoto({ path, revision }: { path: string; revision: string }) {
  const action = useOwnerAction();
  const request = action.request;
  const [attempt, setAttempt] = useState(0);
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
  }, [request, path, revision, attempt]);
  return error ? (
    <Alert
      severity="warning"
      action={
        <Button
          onClick={() => {
            setError(false);
            setAttempt((a) => a + 1);
          }}
        >
          Thử lại ảnh
        </Button>
      }
    >
      Không tải được ảnh xem trước có xác thực.
    </Alert>
  ) : image?.path === path && image.revision === revision ? (
    <Box
      component="img"
      src={image.url}
      onError={() => setError(true)}
      alt="Ảnh công khai đã lưu"
      sx={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }}
    />
  ) : (
    <Typography>Đang tải ảnh…</Typography>
  );
}
