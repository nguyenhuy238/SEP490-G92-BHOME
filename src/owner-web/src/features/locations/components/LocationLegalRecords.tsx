import { ValidatedInput } from '../../../components/common/ValidatedForm';
import { TextField, ValidatedForm } from '../../../components/common/ValidatedForm';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Pagination,
  Stack,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  assetLifecycleClient,
  lifecycleError,
  type LegalRecord,
} from '../../../../../../packages/client-core/src/assetLifecycle';
import type { SetupDocument } from '../../../../../../packages/client-core/src/propertySetup';
import { displayContractDate } from '../../../../../../packages/client-core/src/contracts';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { downloadBlob } from '../../../utils/downloadBlob';

export function LocationLegalRecords({ locationId }: { locationId: string }) {
  const { request } = usePropertySetupApi();
  const api = assetLifecycleClient(request);
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SetupDocument<LegalRecord> | 'new' | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const records = useQuery({
    queryKey: ['location-legal', locationId, page],
    queryFn: ({ signal }) => api.legalRecords(locationId, page, signal),
  });
  const history = useQuery({
    queryKey: ['location-legal-versions', historyId],
    queryFn: () => api.legalVersions(historyId!),
    enabled: !!historyId,
  });
  const download = useMutation({
    mutationFn: async (record: SetupDocument<LegalRecord>) => {
      const blob = await request<Blob>(
        `/api/v1/location-legal-records/${record.id}/versions/${record.version}/file`,
        {},
        'blob',
      );
      downloadBlob(
        blob,
        `${record.data.details.name}-v${record.version}.${record.data.contentType === 'application/pdf' ? 'pdf' : record.data.contentType === 'image/png' ? 'png' : 'jpg'}`,
      );
    },
  });
  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
      >
        <Typography variant="h6">Hồ sơ pháp lý cơ sở</Typography>
        <Button onClick={() => setEditing('new')}>Thêm hồ sơ</Button>
      </Stack>
      {records.isPending && <Typography role="status">Đang tải hồ sơ…</Typography>}
      {records.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void records.refetch()}>Thử lại</Button>}
        >
          {lifecycleError(records.error)}
        </Alert>
      )}
      {download.isError && <Alert severity="error">{lifecycleError(download.error)}</Alert>}
      {records.data?.items.length === 0 && <Typography>Chưa có hồ sơ pháp lý.</Typography>}
      {!!records.data?.items.length && (
        <TableContainer>
          <Table size="small" aria-label="Hồ sơ pháp lý">
            <TableHead>
              <TableRow>
                <TableCell>Tài liệu</TableCell>
                <TableCell>Ngày cấp / hết hạn</TableCell>
                <TableCell>Trạng thái</TableCell>
                <TableCell>Thao tác</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.data.items.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    {record.data.details.name}
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {record.data.details.documentType} · Phiên bản {record.version}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {displayContractDate(record.data.details.issuedOn)} /{' '}
                    {record.data.details.expiresOn
                      ? displayContractDate(record.data.details.expiresOn)
                      : 'Không có hạn'}
                  </TableCell>
                  <TableCell>{record.status === 'Active' ? 'Đang sử dụng' : 'Lưu trữ'}</TableCell>
                  <TableCell>
                    <Button onClick={() => setEditing(record)}>Cập nhật</Button>
                    <Button onClick={() => setHistoryId(record.id)}>Lịch sử</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {records.data && records.data.totalCount > 20 && (
        <Pagination
          count={Math.ceil(records.data.totalCount / 20)}
          page={page}
          onChange={(_, value) => setPage(value)}
        />
      )}
      {editing && (
        <LegalRecordForm
          key={editing === 'new' ? 'new' : editing.id}
          record={editing === 'new' ? undefined : editing}
          locationId={locationId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void cache.invalidateQueries({ queryKey: ['location-legal'] });
            void cache.invalidateQueries({ queryKey: ['location-legal-versions'] });
          }}
        />
      )}
      <Dialog open={!!historyId} onClose={() => setHistoryId(null)} fullWidth>
        <DialogTitle>Lịch sử hồ sơ</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            {history.isPending && <Typography>Đang tải…</Typography>}
            {history.isError && <Alert severity="error">{lifecycleError(history.error)}</Alert>}
            {history.data?.map((record) => (
              <Stack
                key={record.version}
                direction="row"
                sx={{ justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Typography>
                  Phiên bản {record.version} · {record.data.details.name}
                </Typography>
                <Button disabled={download.isPending} onClick={() => download.mutate(record)}>
                  Tải tệp
                </Button>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryId(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function LegalRecordForm({
  record,
  locationId,
  onClose,
  onSaved,
}: {
  record?: SetupDocument<LegalRecord>;
  locationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = usePropertySetupApi();
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (form: FormData) => assetLifecycleClient(request).saveLegal(locationId, id, form),
    onSuccess: onSaved,
  });
  const details = record?.data.details;
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const file = form.get('file');
          if (file instanceof File && !file.size) form.delete('file');
          form.set('expectedVersion', String(record?.version ?? 0));
          mutation.mutate(form);
        }}
      >
        <DialogTitle>{record ? 'Cập nhật phiên bản hồ sơ' : 'Thêm hồ sơ pháp lý'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {mutation.isError && <Alert severity="error">{lifecycleError(mutation.error)}</Alert>}
            <TextField
              required
              label="Loại tài liệu"
              name="documentType"
              defaultValue={details?.documentType}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              required
              label="Tên tài liệu"
              name="name"
              defaultValue={details?.name}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField label="Số hiệu" name="number" defaultValue={details?.number ?? ''} />
            <TextField label="Cơ quan cấp" name="issuer" defaultValue={details?.issuer ?? ''} />
            <TextField
              required
              type="date"
              label="Ngày cấp"
              name="issuedOn"
              defaultValue={details?.issuedOn}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="Ngày hết hạn"
              name="expiresOn"
              defaultValue={details?.expiresOn ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Trạng thái sử dụng"
              name="status"
              defaultValue={details?.status ?? 'Active'}
            >
              <MenuItem value="Active">Đang sử dụng</MenuItem>
              <MenuItem value="Archived">Lưu trữ</MenuItem>
            </TextField>
            <TextField multiline label="Ghi chú" name="note" defaultValue={details?.note ?? ''} />
            <Typography component="label">
              {record ? 'Tệp thay thế nếu có' : 'Tệp tài liệu'} (PDF, PNG, JPEG, tối đa 5 MB)
              <ValidatedInput
                name="file"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                required={!record}
              />
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {mutation.isPending ? 'Đang lưu…' : 'Lưu phiên bản'}
          </Button>
        </DialogActions>
      </ValidatedForm>
    </Dialog>
  );
}
