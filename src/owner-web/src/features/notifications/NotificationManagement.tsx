import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChartCard, ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
  ownerQuery,
} from '../../hooks/useOwnerWorkspace';
import { guid } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
interface Announcement {
  id: string;
  title: string;
  body: string;
  channels: string[];
  status: string;
  recipientCount: number;
  sentAt: string | null;
  audience?: { type: string; locationIds?: string[]; roomIds?: string[]; userIds?: string[] };
}
interface ReminderPolicy {
  debtEnabled: boolean;
  debtWindowDays: number | null;
  taskEnabled: boolean;
  taskWindowHours: number | null;
  residenceEnabled: boolean;
  residenceFrequency: string | null;
  localSendHour: number | null;
  emergencyEnabled: boolean;
  emergencyFirstEscalationMinutes: number | null;
  emergencyOverdueMinutes: number | null;
  invoiceDueSoonDays: number | null;
}
export function NotificationManagement() {
  const [policyLocation, setPolicyLocation] = useState('');
  const [type, setType] = useState('LOCATION'),
    [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [users, setUsers] = useState('');
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [email, setEmail] = useState(false),
    [priority, setPriority] = useState('P2');
  const [preview, setPreview] = useState<{
    fingerprint: string;
    recipientCount: number;
    missingEmailCount: number;
  } | null>(null);
  const [draft, setDraft] = useState<Announcement | null>(null),
    [confirm, setConfirm] = useState(false),
    [page, setPage] = useState(1);
  const [draftPage, setDraftPage] = useState(1);
  const action = useOwnerAction();
  const channels = useOwnerQuery<{
    enabled: boolean;
    automationEnabled: boolean;
    mode: string;
    deliveries: { channel: string; status: string; count: number }[];
  }>(['notification-channel-status'], '/api/v1/notifications/channel-status');
  const sent = useOwnerQuery<Announcement[]>(
    ['announcements-sent', page],
    `/api/v1/announcements/sent?page=${page}&pageSize=20`,
  );
  const drafts = useOwnerQuery<Announcement[]>(
    ['announcements-drafts', draftPage],
    `/api/v1/announcements/drafts?page=${draftPage}&pageSize=20`,
  );
  const fingerprint = JSON.stringify({ type, location, room, users, title, body, email, priority });
  function audience() {
    if (type === 'LOCATION') return { type, locationIds: [guid(location)] };
    if (type === 'ROOM') return { type, roomIds: [guid(room)] };
    if (type === 'USER' || type === 'SELECTED_USERS') {
      const userIds = [
        ...new Set(
          users
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map(guid),
        ),
      ];
      if (!userIds.length || (type === 'USER' && userIds.length !== 1))
        throw new Error('Chọn đúng tài khoản người nhận.');
      return { type, userIds };
    }
    return { type };
  }
  return (
    <ChartCard title="Soạn và quản lý thông báo">
      <Stack spacing={2}>
        <OwnerFeedback
          busy={action.busy || channels.isFetching || sent.isFetching}
          error={action.error || channels.error || sent.error || drafts.error}
          notice={action.notice}
        />
        {channels.data && (
          <Alert severity="info">
            Kênh ngoài ứng dụng: {channels.data.enabled ? 'Đã bật' : 'Chưa bật'} · Chế độ{' '}
            {channels.data.mode} · Tự động {channels.data.automationEnabled ? 'Đã bật' : 'Chưa bật'}
            . Thông báo trong ứng dụng được lưu độc lập.
          </Alert>
        )}
        <Alert severity="warning">
          Push thực tế chưa có bộ gửi đã cấu hình. Biên nhận gửi thông báo không chứng minh
          email/push đã được phát tới thiết bị.
        </Alert>
        <TextField
          select
          label="Phạm vi người nhận"
          value={type}
          disabled={!!draft || action.busy}
          onChange={(e) => setType(e.target.value)}
        >
          {[
            ['ALL_TENANTS', 'Tất cả Tenant'],
            ['LOCATION', 'Theo cơ sở'],
            ['ROOM', 'Theo phòng'],
            ['USER', 'Một tài khoản'],
            ['SELECTED_USERS', 'Nhiều tài khoản'],
          ].map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        {['LOCATION', 'ROOM'].includes(type) && (
          <OwnerLocationPicker
            value={location}
            change={(id) => {
              setLocation(id);
              setRoom('');
            }}
            required
          />
        )}
        {type === 'ROOM' && (
          <OwnerRoomPicker
            key={location}
            location={location}
            value={room}
            change={setRoom}
            required
          />
        )}
        {['USER', 'SELECTED_USERS'].includes(type) && (
          <TextField
            label="UUID tài khoản Tenant (cách nhau bằng dấu phẩy)"
            value={users}
            disabled={!!draft || action.busy}
            onChange={(e) => setUsers(e.target.value)}
            helperText="Máy chủ chỉ chọn người nhận đủ điều kiện trong phạm vi hiện tại."
          />
        )}
        <TextField
          label="Tiêu đề thông báo"
          value={title}
          disabled={!!draft || action.busy}
          onChange={(e) => setTitle(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 150 } }}
        />
        <TextField
          label="Nội dung thông báo"
          multiline
          minRows={3}
          value={body}
          disabled={!!draft || action.busy}
          onChange={(e) => setBody(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        <TextField
          select
          label="Ưu tiên thông báo"
          value={priority}
          disabled={!!draft || action.busy}
          onChange={(e) => setPriority(e.target.value)}
        >
          <MenuItem value="P2">Thông thường (P2)</MenuItem>
          <MenuItem value="P1">Cao (P1)</MenuItem>
        </TextField>
        <Typography>Kênh bắt buộc: Trong ứng dụng</Typography>
        <FormControlLabel
          label="Gửi thêm email"
          control={
            <Checkbox
              checked={email}
              disabled={!!draft || action.busy}
              onChange={(_, v) => setEmail(v)}
            />
          }
        />
        {!draft && (
          <>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await action.command<{
                    recipientCount: number;
                    missingEmailCount: number;
                  }>('/api/v1/announcements/preview-recipients', 'POST', audience());
                  setPreview({ ...result, fingerprint });
                }, 'Đã kiểm tra phạm vi người nhận.')
              }
            >
              Kiểm tra người nhận
            </Button>
            {preview?.fingerprint === fingerprint && (
              <Typography>
                {preview.recipientCount} người nhận · {preview.missingEmailCount} tài khoản thiếu
                email
              </Typography>
            )}
            <Button
              disabled={
                action.busy ||
                !title.trim() ||
                !body.trim() ||
                preview?.fingerprint !== fingerprint ||
                !preview?.recipientCount
              }
              onClick={() =>
                void action.run(async () => {
                  const result = await action.command<Announcement>(
                    '/api/v1/announcements',
                    'POST',
                    {
                      title: title.trim(),
                      body: body.trim(),
                      audience: audience(),
                      channels: email ? ['IN_APP', 'EMAIL'] : ['IN_APP'],
                      priority,
                    },
                  );
                  setDraft(result);
                }, 'Đã tạo nháp. Kiểm tra nội dung trước khi gửi.')
              }
            >
              Tạo nháp đã kiểm tra
            </Button>
          </>
        )}
        {draft && (
          <>
            <Alert severity="info">
              Nháp {draft.id} · {draft.title} · {draft.body} · {draft.channels.join(', ')} ·{' '}
              {draft.status} · Phạm vi đã lưu:{' '}
              {draft.audience?.type === 'ALL_TENANTS'
                ? 'Tất cả Tenant'
                : draft.audience
                  ? `${({ LOCATION: 'Cơ sở', ROOM: 'Phòng', USER: 'Tài khoản', SELECTED_USERS: 'Tài khoản đã chọn' } as Record<string, string>)[draft.audience.type] ?? 'Phạm vi đã chọn'}: ${(draft.audience.locationIds ?? draft.audience.roomIds ?? draft.audience.userIds ?? []).join(', ')}`
                  : 'Theo dữ liệu nháp máy chủ'}
            </Alert>
            <Button
              disabled={action.busy || draft.status === 'Sent'}
              onClick={() => setConfirm(true)}
            >
              Gửi nháp này
            </Button>
            {draft.status === 'Sent' && (
              <Button
                onClick={() => {
                  setDraft(null);
                  setPreview(null);
                  setTitle('');
                  setBody('');
                }}
              >
                Soạn thông báo tiếp theo
              </Button>
            )}
          </>
        )}
        <ConfirmDialog
          open={confirm}
          title="Gửi thông báo đã duyệt"
          busy={action.busy}
          error={action.error}
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            void action.run(async () => {
              const result = await action.command<Announcement>(
                `/api/v1/announcements/${draft!.id}/send`,
                'POST',
              );
              setDraft(result);
              setConfirm(false);
            }, 'Đã ghi nhận gửi theo kết quả máy chủ.')
          }
        >
          Máy chủ xác định lại người nhận theo phạm vi hiện tại. Gửi lại cùng nháp được máy chủ
          chống trùng.
        </ConfirmDialog>
        <Typography variant="h6">Nháp đã lưu trên máy chủ</Typography>
        <Typography>
          Thử lại cùng nội dung sau lỗi mạng giữ nguyên mã yêu cầu tạo. Có thể mở lại nháp từ danh
          sách này sau khi tải lại trang.
        </Typography>
        <Button disabled={drafts.isFetching} onClick={() => void drafts.refetch()}>
          Tải lại danh sách nháp
        </Button>
        <OwnerTable
          rows={drafts.data ?? []}
          id={(n) => n.id}
          select={(n) => {
            setDraft(n);
            setTitle(n.title);
            setBody(n.body);
            setEmail(n.channels.includes('EMAIL'));
            setConfirm(false);
          }}
          columns={[
            { label: 'Nháp', render: (n) => `${n.title} · ${n.body}` },
            { label: 'Kênh', render: (n) => n.channels.join(', ') },
          ]}
        />
        <Stack direction="row">
          <Button
            disabled={draftPage === 1 || drafts.isFetching}
            onClick={() => setDraftPage(draftPage - 1)}
          >
            Nháp trước
          </Button>
          <Typography>Trang nháp {draftPage}</Typography>
          <Button
            disabled={drafts.isFetching || drafts.data?.length !== 20}
            onClick={() => setDraftPage(draftPage + 1)}
          >
            Nháp sau
          </Button>
        </Stack>
        {draft && draft.status !== 'Sent' && (
          <Button
            disabled={action.busy}
            onClick={() => {
              setDraft(null);
              setPreview(null);
            }}
          >
            Quay lại soạn thông báo
          </Button>
        )}
        <Typography variant="h6">Thông báo đã gửi</Typography>
        <OwnerTable
          rows={sent.data ?? []}
          id={(n) => n.id}
          columns={[
            { label: 'Thông báo', render: (n) => `${n.title} · ${n.body}` },
            {
              label: 'Kênh / người nhận',
              render: (n) => `${n.channels.join(', ')} · ${n.recipientCount}`,
            },
            { label: 'Gửi lúc', render: (n) => (n.sentAt ? formatInstant(n.sentAt) : 'Chưa gửi') },
          ]}
        />
        <Stack direction="row">
          <Button disabled={page === 1 || sent.isFetching} onClick={() => setPage(page - 1)}>
            Thông báo trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={sent.isFetching || sent.data?.length !== 20}
            onClick={() => setPage(page + 1)}
          >
            Thông báo sau
          </Button>
        </Stack>
        {channels.data?.deliveries.map((d) => (
          <Typography key={d.channel + d.status}>
            {d.channel} · {d.status} · {d.count}
          </Typography>
        ))}
        <NotificationDelivery />
        <Typography variant="h6">Chọn cơ sở cấu hình nhắc việc</Typography>
        <OwnerLocationPicker value={policyLocation} change={setPolicyLocation} />
        {policyLocation && <NotificationPolicy key={policyLocation} location={policyLocation} />}
      </Stack>
    </ChartCard>
  );
}
function NotificationDelivery() {
  const [page, setPage] = useState(1),
    [state, setState] = useState('');
  const q = useOwnerQuery<{
    enabled: boolean;
    configured: boolean;
    deliveries: OwnerPage<{
      id: string;
      category: string;
      state: string;
      attempts: number;
      nextAttemptAt: string | null;
      errorCode: string | null;
    }>;
  }>(
    ['notification-delivery', page, state],
    '/api/v1/notifications/delivery-status?' + ownerQuery({ page, pageSize: 20, state }),
  );
  return (
    <Stack spacing={1}>
      <Typography variant="h6">Theo dõi phát thông báo</Typography>
      <TextField
        select
        label="Trạng thái phát"
        value={state}
        onChange={(e) => {
          setState(e.target.value);
          setPage(1);
        }}
      >
        <MenuItem value="">Tất cả</MenuItem>
        {['Pending', 'Delivered', 'Failed'].map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
      </TextField>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      {q.data && (
        <Typography>
          {q.data.enabled ? 'Bật' : 'Tắt'} ·{' '}
          {q.data.configured ? 'Đã cấu hình nhà cung cấp' : 'Chưa cấu hình nhà cung cấp'}
        </Typography>
      )}
      {q.data?.deliveries.items.map((d) => (
        <Typography key={d.id}>
          {d.category} · {d.state} · {d.attempts} lần ·{' '}
          {d.nextAttemptAt ? formatInstant(d.nextAttemptAt) : 'Không có lịch thử lại'} ·{' '}
          {d.errorCode}
        </Typography>
      ))}
      <OwnerPagination page={page} total={q.data?.deliveries.totalCount ?? 0} change={setPage} />
    </Stack>
  );
}
function NotificationPolicy({ location }: { location: string }) {
  const q = useOwnerQuery<ReminderPolicy>(
    ['notification-policy', location],
    `/api/v1/locations/${location}/notification-policy`,
  );
  return (
    <>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      {q.data && <PolicyEditor key={JSON.stringify(q.data)} location={location} current={q.data} />}
    </>
  );
}
function PolicyEditor({ location, current }: { location: string; current: ReminderPolicy }) {
  const [policy, setPolicy] = useState(current),
    [confirm, setConfirm] = useState(false);
  const action = useOwnerAction();
  return (
    <Stack spacing={1}>
      <Typography variant="h6">Chính sách nhắc việc theo cơ sở</Typography>
      {(
        [
          ['debtEnabled', 'Bật nhắc công nợ'],
          ['taskEnabled', 'Bật nhắc công việc'],
          ['emergencyEnabled', 'Bật leo thang khẩn cấp'],
        ] as const
      ).map(([key, label]) => (
        <FormControlLabel
          key={key}
          label={label}
          control={
            <Checkbox
              checked={policy[key]}
              onChange={(_, v) => setPolicy((p) => ({ ...p, [key]: v }))}
            />
          }
        />
      ))}
      {(
        [
          ['debtWindowDays', 'Chu kỳ nhắc nợ (ngày)'],
          ['taskWindowHours', 'Cửa sổ nhắc công việc (giờ)'],
          ['emergencyFirstEscalationMinutes', 'Leo thang lần đầu (phút)'],
          ['emergencyOverdueMinutes', 'Ngưỡng khẩn cấp quá hạn (phút)'],
          ['invoiceDueSoonDays', 'Nhắc hóa đơn sắp đến hạn (ngày)'],
        ] as const
      ).map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          type="number"
          value={policy[key] ?? ''}
          onChange={(e) =>
            setPolicy((p) => ({
              ...p,
              [key]: e.target.value === '' ? null : Number(e.target.value),
            }))
          }
        />
      ))}
      <Alert severity="info">
        Lịch nhắc tạm trú được giữ nguyên: {current.residenceEnabled ? 'Bật' : 'Tắt'} ·{' '}
        {current.residenceFrequency || 'Chưa đặt'}. Phạm vi JOB-08 cần quyết định nghiệp vụ trước
        khi thay đổi.
      </Alert>
      <OwnerFeedback busy={action.busy} error={action.error} notice={action.notice} />
      <Button disabled={action.busy} onClick={() => setConfirm(true)}>
        Lưu chính sách đã chọn
      </Button>
      <ConfirmDialog
        open={confirm}
        title="Lưu chính sách nhắc thông báo"
        busy={action.busy}
        error={action.error}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          void action
            .run(() =>
              action.command(`/api/v1/locations/${location}/notification-policy`, 'PUT', policy),
            )
            .then((ok) => {
              if (ok) setConfirm(false);
            })
        }
      >
        Các giá trị nhắc việc do Owner đặt; hệ thống không tự gán chu kỳ.
      </ConfirmDialog>
    </Stack>
  );
}
