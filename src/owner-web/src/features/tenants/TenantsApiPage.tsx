import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import { Link } from 'react-router';
import { PageHeader, StatusChip, ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
interface Resident {
  id: string;
  locationId: string;
  roomId: string;
  roomNumber: string;
  displayLabel: string;
  residentType: string;
  verificationStatus: string;
  confirmedAt: string | null;
  tenantUserId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  version: string;
  tenancies: {
    contractId: string;
    status: string;
    role: string;
    residenceFrom: string;
    residenceTo: string | null;
  }[];
}
export function TenantsApiPage() {
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [id, setId] = useState(''),
    [create, setCreate] = useState(false);
  const list = useOwnerQuery<OwnerPage<Resident>>(
    ['residents', location, room, search, status, page],
    '/api/v1/residents?' +
      ownerQuery({
        locationId: location,
        roomId: room,
        search,
        verificationStatus: status,
        page,
        pageSize: 20,
      }),
  );
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Khách thuê và người ở"
        subtitle="Hồ sơ người ở, trạng thái xác minh và tài khoản liên kết."
        actions={
          <Button onClick={() => setCreate(true)} variant="contained">
            Thêm người ở
          </Button>
        }
      />
      <OwnerLocationPicker
        value={location}
        change={(v) => {
          setLocation(v);
          setRoom('');
          setPage(1);
        }}
      />
      <OwnerRoomPicker
        key={location}
        location={location}
        value={room}
        change={(v) => {
          setRoom(v);
          setPage(1);
        }}
      />
      <TextField
        label="Tìm tên hiển thị"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <TextField
        select
        label="Xác minh định danh"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
      >
        <MenuItem value="">Tất cả</MenuItem>
        <MenuItem value="0">Chờ xác minh</MenuItem>
        <MenuItem value="1">Đã xác minh</MenuItem>
        <MenuItem value="2">Đã từ chối</MenuItem>
      </TextField>
      <Button onClick={() => void list.refetch()}>Tải lại</Button>
      <OwnerFeedback busy={list.isFetching} error={list.error} />
      <Paper>
        <OwnerTable
          rows={list.data?.items ?? []}
          id={(x) => x.id}
          select={(x) => setId(x.id)}
          columns={[
            { label: 'Người ở', render: (x) => x.displayLabel },
            { label: 'Phòng', render: (x) => x.roomNumber },
            {
              label: 'Vai trò',
              render: (x) => (x.residentType === 'Representative' ? 'Đại diện' : 'Người ở cùng'),
            },
            {
              label: 'Xác minh',
              render: (x) => (
                <StatusChip
                  label={
                    x.verificationStatus === 'Verified'
                      ? 'Đã xác minh'
                      : x.verificationStatus === 'Rejected'
                        ? 'Đã từ chối'
                        : 'Chờ xác minh'
                  }
                />
              ),
            },
            {
              label: 'Liên hệ tài khoản',
              render: (x) => `${x.contactEmail ?? 'Chưa liên kết'} ${x.contactPhone ?? ''}`,
            },
          ]}
        />
      </Paper>
      <OwnerPagination
        page={page}
        total={list.data?.totalCount ?? 0}
        change={setPage}
        busy={list.isFetching}
      />
      {id && <ResidentDetail key={id} id={id} close={() => setId('')} />}
      {create && (
        <CreateResident
          initialLocation={location}
          initialRoom={room}
          close={() => setCreate(false)}
        />
      )}
    </Stack>
  );
}
function ResidentDetail({ id, close }: { id: string; close: () => void }) {
  const q = useOwnerQuery<Resident>(['resident', id], `/api/v1/residents/${id}`);
  const accounts = useOwnerQuery<{ id: string; label: string }[]>(
    ['tenant-account-options'],
    '/api/v1/contracts/preparation/accounts',
  );
  const [label, setLabel] = useState<string | null>(null),
    [reason, setReason] = useState(''),
    [email, setEmail] = useState(''),
    [account, setAccount] = useState(''),
    [op, setOp] = useState('');
  const action = useOwnerAction();
  const r = q.data;
  const house = useOwnerQuery<OwnerPage<Resident>>(
    ['cooccupants', r?.roomId],
    '/api/v1/residents?' + ownerQuery({ roomId: r?.roomId, pageSize: 20 }),
    !!r,
  );
  async function act() {
    if (!r) return;
    if (op === 'label' && (!reason.trim() || !(label ?? r.displayLabel).trim())) return;
    const path =
      op === 'label'
        ? `/api/v1/residents/${id}/workspace-label`
        : op === 'invite'
          ? `/api/v1/residents/${id}/invitation`
          : `/api/v1/contracts/preparation/residents/${id}/account`;
    const body =
      op === 'label'
        ? { displayLabel: label ?? r.displayLabel, version: r.version, reason }
        : op === 'invite'
          ? { email }
          : { tenantUserId: account };
    if (await action.run(() => action.command(path, op === 'label' ? 'PUT' : 'POST', body))) {
      setOp('');
      setLabel(null);
      setReason('');
    }
  }
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching || action.busy}
          error={action.error || q.error || accounts.error || house.error}
          notice={action.notice}
        />
        {r && (
          <>
            <Typography variant="h6">
              {r.displayLabel} · Phòng {r.roomNumber}
            </Typography>
            <Typography>
              Tài khoản: {r.tenantUserId ?? 'Chưa liên kết'} · {r.contactEmail} · {r.contactPhone}
            </Typography>
            <Typography>
              Xác minh: {r.verificationStatus} {r.confirmedAt && formatInstant(r.confirmedAt)}
            </Typography>
            <Alert severity="info">
              Staff xác minh định danh trên Mobile. Màn hình này không hiển thị CCCD và không lưu
              ảnh CCCD. Sửa dữ liệu định danh đã xác minh cần quy trình được phê duyệt.
            </Alert>
            <TextField
              label="Tên hiển thị hồ sơ"
              value={label ?? r.displayLabel}
              onChange={(e) => setLabel(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              label="Lý do chỉnh sửa"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Button
              disabled={
                action.busy || q.isFetching || !reason.trim() || !(label ?? r.displayLabel).trim()
              }
              onClick={() => setOp('label')}
            >
              Lưu tên hiển thị
            </Button>
            <TextField
              select
              label="Tài khoản Tenant hiện hữu"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <MenuItem value="">Chọn tài khoản</MenuItem>
              {accounts.data?.map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              disabled={action.busy || !account || r.verificationStatus !== 'Verified'}
              onClick={() => setOp('link')}
            >
              Liên kết tài khoản đã chọn
            </Button>
            <TextField
              type="email"
              label="Email nhận lời mời"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              disabled={
                action.busy ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
                !r.tenancies.some((x) => x.status === 'Active')
              }
              onClick={() => setOp('invite')}
            >
              Gửi lời mời Tenant
            </Button>
            <Typography variant="caption">
              Lời mời yêu cầu hợp đồng đang hoạt động và kênh email đã cấu hình. Thông tin liên hệ
              lấy từ tài khoản đã liên kết.
            </Typography>
            <Typography variant="subtitle1">Người ở cùng phòng</Typography>
            {house.data?.items.map((p) => (
              <Typography key={p.id}>
                {p.displayLabel} ·{' '}
                {p.residentType === 'Representative' ? 'Đại diện' : 'Người ở cùng'}
              </Typography>
            ))}
            {house.data && house.data.totalCount > house.data.items.length && (
              <Alert severity="info">
                Phòng có thêm người ở. Dùng bộ lọc phòng và phân trang ở danh sách để xem đầy đủ.
              </Alert>
            )}
            <Typography variant="subtitle1">Hợp đồng / vai trò người ở</Typography>
            {r.tenancies.map((x) => (
              <Button
                key={x.contractId}
                component={Link}
                to={`/contracts?contractId=${x.contractId}`}
              >
                {x.role === 'Representative' ? 'Đại diện' : 'Người ở cùng'} · {x.status} ·{' '}
                {x.residenceFrom} – {x.residenceTo ?? 'Chưa kết thúc'}
              </Button>
            ))}
          </>
        )}
        <Button onClick={close}>Đóng chi tiết</Button>
        <ConfirmDialog
          open={!!op}
          title="Xác nhận cập nhật hồ sơ người ở"
          error={action.error}
          busy={action.busy}
          onClose={() => setOp('')}
          onConfirm={() => void act()}
        >
          Máy chủ sẽ kiểm tra quyền, liên kết và phiên bản hiện tại.
        </ConfirmDialog>
      </Stack>
    </Paper>
  );
}
function CreateResident({
  initialLocation,
  initialRoom,
  close,
}: {
  initialLocation: string;
  initialRoom: string;
  close: () => void;
}) {
  const [location, setLocation] = useState(initialLocation),
    [room, setRoom] = useState(initialRoom),
    [label, setLabel] = useState(''),
    [type, setType] = useState('1');
  const action = useOwnerAction();
  return (
    <Dialog
      open
      fullWidth
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>Thêm người ở</DialogTitle>
      <DialogContent>
        <form
          id="resident-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void action
              .run(() =>
                action.command('/api/v1/capture/residents', 'POST', {
                  roomId: room,
                  displayLabel: label,
                  residentType: Number(type),
                }),
              )
              .then((ok) => {
                if (ok) close();
              });
          }}
        >
          <Stack spacing={2} sx={{ pt: 1 }}>
            <OwnerFeedback {...action} />
            <OwnerLocationPicker
              required
              value={location}
              change={(v) => {
                setLocation(v);
                setRoom('');
              }}
            />
            <OwnerRoomPicker
              key={location}
              required
              location={location}
              value={room}
              change={setRoom}
            />
            <TextField
              required
              label="Tên hiển thị"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              select
              label="Vai trò dự kiến"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <MenuItem value="0">Đại diện</MenuItem>
              <MenuItem value="1">Người ở cùng</MenuItem>
            </TextField>
            <Alert severity="info">
              Vai trò và người ở chính thức theo hợp đồng; thêm hồ sơ không kích hoạt hợp đồng hoặc
              thay đổi trạng thái phòng.
            </Alert>
          </Stack>
        </form>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button disabled={action.busy || !room} type="submit" form="resident-editor">
          Thêm hồ sơ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
