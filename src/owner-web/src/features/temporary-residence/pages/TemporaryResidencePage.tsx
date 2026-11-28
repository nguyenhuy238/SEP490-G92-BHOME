import { TextField } from '../../../components/common/ValidatedForm';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  residenceAction,
  residenceAlert,
  residenceClient,
  residenceError,
  residenceImageUri,
  residenceKey,
  residenceStatus,
  type ResidenceClient,
  type ResidenceTask,
} from '../../../../../../packages/client-core/src/residence';
import { useResidenceList } from '../../../../../../packages/client-core/src/useResidenceList';
import { useResidenceRecord } from '../../../../../../packages/client-core/src/useResidenceRecord';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { displayContractDate } from '../../../../../../packages/client-core/src/contracts';
import { isMockMode } from '../../../services/config';
import { PageHeader, FilterToolbar } from '../../../components/common/PortalUI';
import { useContractsApi } from '../../contracts/hooks/useContractsApi';
import { OwnerLocationPicker } from '../../../components/common/OwnerSelectors';
export default function TemporaryResidencePage() {
  return isMockMode ? (
    <>
      <Alert severity="info">
        Dữ liệu minh họa. Xác nhận kết quả thật chỉ khả dụng trong chế độ API.
      </Alert>
      <ResourcePage kind="temporary-residence" variant="table" />
    </>
  ) : (
    <LiveResidencePage />
  );
}
function LiveResidencePage() {
  const { session } = useAuth();
  const contracts = useContractsApi();
  const api = useMemo(() => residenceClient(contracts.transport), [contracts]);
  if (!session?.roles.includes('Owner'))
    return <Alert severity="error">Chỉ Chủ cơ sở được xem và xác nhận hồ sơ này.</Alert>;
  return <OwnerResidenceList key={session.userId} api={api} />;
}
function OwnerResidenceList({ api }: { api: ResidenceClient }) {
  const [location, setLocation] = useState(''),
    [status, setStatus] = useState('');
  const list = useResidenceList(api, location, status);
  const [selected, setSelected] = useState('');
  const items = list.data?.items ?? [];
  const current = items.find((task) => residenceKey(task) === selected) ?? items[0];
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Theo dõi đăng ký tạm trú"
        subtitle="Kết quả do khách thuê cung cấp; xác nhận trong BHOME tách biệt với thao tác trên VNeID."
        actions={
          <Button disabled={list.loading} onClick={list.reload}>
            Làm mới
          </Button>
        }
      />
      <FilterToolbar>
        <OwnerLocationPicker
          value={location}
          change={(id) => {
            setLocation(id);
            list.setPage(1);
            setSelected('');
          }}
        />
        <TextField
          select
          label="Trạng thái tạm trú"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            list.setPage(1);
            setSelected('');
          }}
        >
          <MenuItem value="">Tất cả trạng thái</MenuItem>
          {Object.entries(residenceStatus).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </FilterToolbar>
      {list.loading && <LinearProgress />}
      {!!list.error && (
        <Alert severity="error" action={<Button onClick={list.reload}>Thử lại</Button>}>
          {list.error}
        </Alert>
      )}
      {!list.loading && !list.error && !items.length && (
        <Alert severity="info">Chưa có hồ sơ theo dõi tạm trú.</Alert>
      )}
      {items.length > 1 && (
        <TextField
          select
          label="Phòng / người ở"
          value={current ? residenceKey(current) : ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          {items.map((task) => (
            <MenuItem key={residenceKey(task)} value={residenceKey(task)}>
              Phòng {task.roomNumber} · {task.residentLabel} ·{' '}
              {residenceStatus[task.status] ?? 'Chưa rõ trạng thái'}
            </MenuItem>
          ))}
        </TextField>
      )}
      {current && !list.error && (
        <OwnerResidenceRecord
          key={residenceKey(current)}
          api={api}
          contractId={current.contractId}
          residentId={current.residentId}
          listRecord={current}
        />
      )}
      {list.data && list.data.totalCount > list.data.pageSize && (
        <Pagination
          page={list.page}
          count={Math.ceil(list.data.totalCount / list.data.pageSize)}
          disabled={list.loading}
          onChange={(_, page) => list.setPage(page)}
        />
      )}
    </Stack>
  );
}
export function OwnerResidenceRecord({
  api,
  contractId,
  residentId,
  listRecord,
}: {
  api: ResidenceClient;
  contractId: string;
  residentId: string;
  listRecord?: ResidenceTask;
}) {
  const record = useResidenceRecord(api, contractId, residentId);
  const reload = record.reload;
  useEffect(() => {
    if (listRecord) void reload();
  }, [listRecord, reload]);
  const { task } = record;
  const [note, setNote] = useState(''),
    [validation, setValidation] = useState('');
  const [image, setImage] = useState<{ task: ResidenceTask; uri: string } | null>(null);
  const uri = image?.task === task ? image.uri : '';
  const [imageError, setImageError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (task?.hasEvidence)
      void api.image(task, controller.signal).then(
        (bytes) => {
          try {
            if (!controller.signal.aborted) {
              setImage({ task, uri: residenceImageUri(bytes) });
              setImageError('');
            }
          } catch {
            if (!controller.signal.aborted) setImageError('Không đọc được ảnh minh chứng.');
          } finally {
            bytes.fill(0);
          }
        },
        (error) => {
          if (!controller.signal.aborted) setImageError(residenceError(error));
        },
      );
    return () => controller.abort();
  }, [api, task, record.revision, retry]);
  async function confirm() {
    if (
      !task ||
      task.status !== 'Completed' ||
      !task.hasEvidence ||
      task.ownerConfirmed ||
      record.busy ||
      record.loading ||
      record.review
    )
      return;
    if (!note.trim() || note.trim().length > 1000) {
      setValidation('Nhập ghi chú xác nhận từ 1 đến 1.000 ký tự.');
      return;
    }
    setValidation('');
    if (await record.mutate(() => api.confirm(task, note), 'Đã xác nhận kết quả trong BHOME.'))
      setNote('');
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        {record.loading && <LinearProgress />}
        {!!record.error && <Alert severity="error">{record.error}</Alert>}
        {!!record.notice && <Alert severity="success">{record.notice}</Alert>}
        <Button
          sx={{ alignSelf: 'flex-start' }}
          disabled={record.loading || record.busy}
          onClick={() => void record.reload()}
        >
          Tải lại hồ sơ
        </Button>
        {record.review && (
          <Alert
            severity="warning"
            action={
              <Button disabled={record.loading || !!record.error} onClick={record.acknowledge}>
                Đã đối chiếu
              </Button>
            }
          >
            Tải lại và đối chiếu dữ liệu trước khi gửi tiếp.
          </Alert>
        )}
        {task && (
          <>
            <Typography variant="h6">
              Phòng {task.roomNumber} · {task.residentLabel}
            </Typography>
            <Typography>
              {task.residentRole === 'Representative' ? 'Người đại diện' : 'Người ở cùng'} ·{' '}
              {residenceStatus[task.status] ?? 'Chưa rõ trạng thái'}
            </Typography>
            <Typography>
              Bắt đầu cư trú: {displayContractDate(task.residenceFrom)}
              {task.actualResidenceFrom
                ? ` · Thực tế: ${displayContractDate(task.actualResidenceFrom)}`
                : ''}
            </Typography>
            {task.resultAt && <Typography>Có kết quả: {formatInstant(task.resultAt)}</Typography>}
            {task.registrationExpiresOn && (
              <Typography>
                Hết hạn tạm trú: {displayContractDate(task.registrationExpiresOn)}
              </Typography>
            )}
            {!!residenceAlert(task) && <Alert severity="warning">{residenceAlert(task)}</Alert>}
            <Typography>
              {task.householdCompleted
                ? 'Tất cả thành viên thuộc diện đăng ký đã được Owner xác nhận.'
                : 'Còn thành viên thuộc diện đăng ký chưa hoàn thành.'}
            </Typography>
            <ResidenceSettings
              key={task.reference}
              task={task}
              api={api}
              disabled={record.busy || record.review || record.loading}
              mutate={record.mutate}
            />
            <Typography>
              {task.ownerConfirmed
                ? 'Owner đã xác nhận'
                : task.status === 'Completed'
                  ? 'Chờ Owner xác nhận'
                  : 'Chưa có kết quả để xác nhận'}
            </Typography>
            {task.ownerConfirmedAt && (
              <Typography>Xác nhận lúc: {formatInstant(task.ownerConfirmedAt)}</Typography>
            )}
            {!task.hasEvidence ? (
              <Typography>Chưa có ảnh minh chứng</Typography>
            ) : uri ? (
              <a href={uri} target="_blank" rel="noreferrer">
                <img
                  src={uri}
                  alt="Ảnh minh chứng tạm trú"
                  style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }}
                />
              </a>
            ) : (
              !imageError && <LinearProgress />
            )}
            {!!imageError && (
              <Alert
                severity="warning"
                action={
                  <Button
                    onClick={() => {
                      setImageError('');
                      setRetry((value) => value + 1);
                    }}
                  >
                    Tải lại ảnh
                  </Button>
                }
              >
                {imageError}
              </Alert>
            )}
            {task.trackingActive && !task.accommodationConfirmed && (
              <AccommodationConfirmation
                task={task}
                api={api}
                disabled={record.busy || record.review || record.loading}
                mutate={record.mutate}
              />
            )}
            {task.accommodationConfirmed && (
              <Typography>Đã ghi nhận xác nhận chỗ ở trên kênh chính thức.</Typography>
            )}
            {task.registrationDeadline && (
              <Typography>
                Hạn đăng ký được ghi nhận {displayContractDate(task.registrationDeadline)}
              </Typography>
            )}
            {task.status === 'Completed' && task.hasEvidence && !task.ownerConfirmed && (
              <>
                <TextField
                  label="Ghi chú xác nhận"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  multiline
                  minRows={2}
                  disabled={record.busy || record.review || record.loading}
                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                />
                {!!validation && <Alert severity="error">{validation}</Alert>}
                <Button
                  variant="contained"
                  disabled={record.busy || record.review || record.loading}
                  onClick={() => void confirm()}
                >
                  Xác nhận kết quả trong BHOME
                </Button>
              </>
            )}
            {!!task.history.length && (
              <>
                <Typography variant="subtitle1">Lịch sử cập nhật</Typography>
                {[...task.history].reverse().map((entry, index) => (
                  <Typography key={index} variant="body2">
                    {residenceAction[entry.action] ?? 'Cập nhật hồ sơ'} ·{' '}
                    {formatInstant(entry.occurredAt)}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </Typography>
                ))}
              </>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}

function ResidenceSettings({
  task,
  api,
  disabled,
  mutate,
}: {
  task: ResidenceTask;
  api: ResidenceClient;
  disabled: boolean;
  mutate: (write: () => Promise<ResidenceTask>, message: string) => Promise<boolean>;
}) {
  const [required, setRequired] = useState(task.registrationRequired !== false);
  const [expires, setExpires] = useState(task.registrationExpiresOn ?? '');
  const [reason, setReason] = useState('');
  return (
    <Stack spacing={1} component="details">
      <Typography component="summary" sx={{ cursor: 'pointer', py: 1 }}>
        Cập nhật diện đăng ký và thời hạn
      </Typography>
      <FormControlLabel
        label="Thành viên thuộc diện phải đăng ký"
        control={
          <Checkbox
            checked={required}
            disabled={disabled}
            onChange={(_, value) => setRequired(value)}
          />
        }
      />
      <TextField
        type="date"
        label="Ngày hết hạn tạm trú"
        value={expires}
        onChange={(e) => setExpires(e.target.value)}
        disabled={disabled}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Typography variant="caption">
        Cảnh báo từ 15 ngày trước ngày hết hạn. Owner ghi nhận diện đăng ký theo hồ sơ thực tế.
      </Typography>
      <TextField
        label="Lý do cập nhật"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      <Button
        disabled={disabled || !reason.trim()}
        onClick={() =>
          void mutate(
            () => api.configure(task, required, expires || null, reason),
            'Đã cập nhật theo dõi tạm trú.',
          )
        }
      >
        Lưu theo dõi
      </Button>
    </Stack>
  );
}

function AccommodationConfirmation({
  task,
  api,
  disabled,
  mutate,
}: {
  task: ResidenceTask;
  api: ResidenceClient;
  disabled: boolean;
  mutate: (write: () => Promise<ResidenceTask>, message: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  return (
    <Stack spacing={1}>
      <TextField
        label="Ghi chú xác nhận chỗ ở trên kênh chính thức"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      <TextField
        type="date"
        label="Hạn đăng ký nếu đã xác định"
        value={deadline}
        onChange={(event) => setDeadline(event.target.value)}
        disabled={disabled}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Button
        disabled={disabled || !note.trim()}
        onClick={() =>
          void mutate(
            () => api.confirmAccommodation(task, note, deadline || null),
            'Đã ghi nhận xác nhận chỗ ở.',
          )
        }
      >
        Ghi nhận xác nhận chỗ ở
      </Button>
    </Stack>
  );
}
