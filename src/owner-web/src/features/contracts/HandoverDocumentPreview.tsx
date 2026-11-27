import { Box, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import {
  displayContractDate,
  type HandoverView,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { handoverAssetSummary } from '../../../../../packages/client-core/src/handoverForm';

function field(value: string | null | undefined) {
  return value?.trim() || 'Chờ Staff cập nhật';
}

function date(value: string | null | undefined) {
  return value ? displayContractDate(value) : 'Chờ xác định';
}

/** Read-only rendering of the server-owned handover snapshot while its PDF is still a draft. */
export function HandoverDocumentPreview({ record }: { record: HandoverView }) {
  const snapshot = record.snapshot;
  const assets = snapshot?.assets ?? [];
  const electricity = snapshot?.electricity;
  const water = snapshot?.water;
  const confirmed = record.status === 'Confirmed';

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}>
      <Stack spacing={2}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700, letterSpacing: '0.03em' }}>
            BIÊN BẢN BÀN GIAO PHÒNG
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'center' }}>
            <Chip
              size="small"
              label={confirmed ? 'Đã hoàn tất' : 'Bản nháp · chưa xác nhận cuối'}
              color={confirmed ? 'success' : 'default'}
              variant="outlined"
            />
          </Stack>
        </Box>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="subtitle2">I. Thông tin bàn giao</Typography>
          <Typography variant="body2">Phòng: {field(snapshot?.roomNumber)}</Typography>
          <Typography variant="body2">Ngày bàn giao: {date(snapshot?.date)}</Typography>
          <Typography variant="body2">
            Tình trạng phòng: {field(snapshot?.roomCondition)}
          </Typography>
          <Typography variant="body2">
            Chìa khóa và quyền truy cập: {field(snapshot?.keysAndAccess)}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            Ghi chú: {snapshot?.notes?.trim() || 'Chưa có ghi chú'}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="subtitle2">II. Chỉ số điện, nước ban đầu</Typography>
          <Typography variant="body2">
            Điện: {electricity?.value ?? 'Chờ Staff xác nhận'}
            {electricity?.date ? ` · ${date(electricity.date)}` : ''}
          </Typography>
          <Typography variant="body2">
            Nước: {water?.value ?? 'Chờ Staff xác nhận'}
            {water?.date ? ` · ${date(water.date)}` : ''}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="subtitle2">III. Kiểm kê tài sản</Typography>
          {snapshot?.noAssetsConfirmed ? (
            <Typography variant="body2">
              Owner đã xác nhận phòng không có tài sản bàn giao.
            </Typography>
          ) : assets.length ? (
            assets.map((asset) => (
              <Typography key={asset.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {handoverAssetSummary(asset)}
                {asset.checked ? '' : ' · Chờ Staff kiểm kê'}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              Chờ cập nhật kết quả kiểm kê tài sản.
            </Typography>
          )}
        </Stack>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="subtitle2">IV. Xác nhận bàn giao</Typography>
          <Typography variant="body2">
            Tenant:{' '}
            {record.tenantConfirmedAt ? formatInstant(record.tenantConfirmedAt) : 'Chưa xác nhận'}
          </Typography>
          <Typography variant="body2">
            Staff:{' '}
            {record.staffConfirmedAt ? formatInstant(record.staffConfirmedAt) : 'Chưa hoàn tất'}
          </Typography>
          {!confirmed && (
            <Typography variant="caption" color="text.secondary">
              Nội dung được cập nhật từ dữ liệu máy chủ. Bản chính thức chỉ có hiệu lực sau các bước
              xác nhận theo quy trình.
            </Typography>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
