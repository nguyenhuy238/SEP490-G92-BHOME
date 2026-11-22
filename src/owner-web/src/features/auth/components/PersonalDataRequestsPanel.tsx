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
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  dataRequestStatuses,
  dataRequestTypes,
  taxPrivacyClient,
  type PersonalDataRequest,
} from '../../../../../../packages/client-core/src/taxPrivacy';
import { lifecycleError } from '../../../../../../packages/client-core/src/assetLifecycle';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { useMeterApi } from '../../meters/useMeterApi';

export function PersonalDataRequestsPanel() {
  const { request } = useMeterApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner');
  const api = taxPrivacyClient(request);
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PersonalDataRequest | null>(null);
  const query = useQuery({
    queryKey: ['personal-data-requests', session?.userId, page],
    queryFn: ({ signal }) => api.requests(page, signal),
  });
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Yêu cầu dữ liệu cá nhân</Typography>
      {query.isPending && <Typography role="status">Đang tải yêu cầu…</Typography>}
      {query.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        >
          {lifecycleError(query.error)}
        </Alert>
      )}
      {query.data?.totalCount === 0 && <Typography>Chưa có yêu cầu dữ liệu cá nhân.</Typography>}
      {query.data?.items.map((item) => (
        <Stack
          key={`${item.requestedBy}:${item.id}`}
          spacing={1}
          sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}
        >
          <Typography>
            {dataRequestTypes.find((type) => type.id === item.requestType)?.label} ·{' '}
            {dataRequestStatuses[item.status]}
          </Typography>
          {owner && <Typography>{item.requesterLabel || 'Tài khoản đã gửi yêu cầu'}</Typography>}
          <Typography>{item.description}</Typography>
          <Typography variant="caption">{formatInstant(item.requestedAt)}</Typography>
          {item.history
            .filter((entry) => entry.resolution)
            .map((entry, index) => (
              <Typography key={index} variant="body2">
                {dataRequestStatuses[entry.status]} · {entry.resolution} · Căn cứ {entry.basis}
              </Typography>
            ))}
          {owner && ['Pending', 'InReview'].includes(item.status) && (
            <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setSelected(item)}>
              Xem xét yêu cầu
            </Button>
          )}
        </Stack>
      ))}
      {query.data && query.data.totalCount > 20 && (
        <Pagination
          page={page}
          count={Math.ceil(query.data.totalCount / 20)}
          onChange={(_, value) => setPage(value)}
        />
      )}
      {selected && (
        <RequestDecision
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void cache.invalidateQueries({ queryKey: ['personal-data-requests'] });
          }}
        />
      )}
    </Stack>
  );
}

function RequestDecision({
  item,
  onClose,
  onSaved,
}: {
  item: PersonalDataRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      taxPrivacyClient(request).decideRequest(
        item,
        String(form.get('status')),
        String(form.get('resolution')),
        String(form.get('basis')),
      ),
    onSuccess: onSaved,
  });
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <DialogTitle>Xem xét yêu cầu dữ liệu</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {mutation.isError && <Alert severity="error">{lifecycleError(mutation.error)}</Alert>}
            <Typography>{item.description}</Typography>
            <TextField select label="Kết quả xử lý" name="status" defaultValue="InReview">
              {['InReview', 'Resolved', 'Rejected'].map((status) => (
                <MenuItem key={status} value={status}>
                  {dataRequestStatuses[status]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              multiline
              label="Phản hồi / hành động đã thực hiện"
              name="resolution"
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <TextField
              required
              multiline
              label="Căn cứ và phạm vi xử lý, dữ liệu cần giữ lại"
              name="basis"
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Lưu phản hồi
          </Button>
        </DialogActions>
      </ValidatedForm>
    </Dialog>
  );
}
