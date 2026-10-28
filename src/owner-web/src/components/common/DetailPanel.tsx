import { workflowTransitions } from '../../services/workflowTransitions';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ExternalLink, Pencil, Trash2, X } from 'lucide-react';
import { Link } from 'react-router';
import type { DemoDatabase, FeatureDefinition, PortalRecord } from '../../types/portal';
import { recordDisplay } from '../../utils/recordDisplay';
import { dateLabel, money } from '../../utils/format';
import { usePortalAction } from '../../hooks/usePortalData';
import { usePortal } from '../../app/PortalProvider';
import { invoiceBalance } from '../../services/repositories/mockPortalRepository';
import { ConfirmDialog, StatusChip } from './PortalUI';
export function DetailPanel({
  definition,
  row,
  database,
  onClose,
  onEdit,
}: {
  definition: FeatureDefinition;
  row: PortalRecord;
  database: DemoDatabase;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { repository } = usePortal();
  const action = usePortalAction();
  const [deleteOpen, setDeleteOpen] = useState(false),
    [next, setNext] = useState(''),
    [invoiceId, setInvoiceId] = useState(''),
    [adjustment, setAdjustment] = useState('0'),
    [reason, setReason] = useState('');
  const kind = definition.kind;
  const [followupDate, setFollowupDate] = useState(row.attributes.followupDate || '2024-10-20');
  const [followupNote, setFollowupNote] = useState(row.attributes.followupNote || '');
  const nextStatuses =
    workflowTransitions[kind]?.[row.status] ||
    (workflowTransitions[kind]
      ? []
      : definition.statuses.filter((status) => status !== row.status));
  const canDelete = [
    'locations',
    'rooms',
    'room-types',
    'assets',
    'staff',
    'pricing',
    'public-content',
    'notifications',
    'schedules',
  ].includes(kind);
  const updateAttributes = (attributes: Record<string, string>) =>
    action.mutate(() =>
      repository.save(kind, { ...row, attributes: { ...row.attributes, ...attributes } }),
    );
  return (
    <Paper
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        position: { lg: 'sticky' },
        top: 110,
        maxHeight: { lg: 'calc(100vh - 130px)' },
        overflowY: 'auto',
      }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="overline" sx={{ fontSize: 10, color: 'primary.main' }}>
          Hồ sơ chi tiết • DEMO
        </Typography>
        <IconButton aria-label="Đóng chi tiết" size="small" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 650, mb: 1 }}>
        {row.code}
      </Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>{row.name}</Typography>
      <StatusChip label={row.status} />
      {kind === 'incidents' && row.category === 'Khẩn cấp' && (
        <Alert severity="error" sx={{ mt: 2 }}>
          KHẨN CẤP • Ưu tiên tiếp nhận và cô lập nguy cơ.
        </Alert>
      )}
      <Box sx={{ my: 2, p: 1.5, bgcolor: '#f2f3ff', borderRadius: 1 }}>
        {definition.columns
          .filter((column) => !['name', 'code', 'status', 'description'].includes(column.field))
          .map((column) => (
            <Stack
              key={column.field}
              direction="row"
              sx={{ justifyContent: 'space-between', gap: 1, mb: 1 }}
            >
              <Typography variant="caption" color="text.secondary">
                {column.label}
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}
              >
                {recordDisplay(row, column.field, database, kind)}
              </Typography>
            </Stack>
          ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
        {row.description}
      </Typography>
      <Stack direction="row" sx={{ gap: 1, my: 2, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={<Pencil size={13} />}
          onClick={onEdit}
          disabled={
            ['payments', 'debts'].includes(kind) || (kind === 'invoices' && row.status !== 'Nháp')
          }
        >
          Chỉnh sửa
        </Button>
        {row.roomId && (
          <Button
            component={Link}
            to={`/rooms?selected=${row.roomId}`}
            size="small"
            endIcon={<ExternalLink size={12} />}
          >
            Xem phòng
          </Button>
        )}
        {row.invoiceId && (
          <Button component={Link} to="/invoices" size="small">
            Hóa đơn liên quan
          </Button>
        )}
        {row.incidentId && (
          <Button component={Link} to="/incidents" size="small">
            Sự cố liên quan
          </Button>
        )}
      </Stack>
      {kind === 'payments' && row.status === 'Chờ đối soát' && (
        <Stack spacing={1}>
          <Alert severity="info">Khớp dữ liệu mẫu; không kết nối ngân hàng.</Alert>
          <TextField
            select
            size="small"
            label="Hóa đơn cần khớp"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          >
            {database.records.invoices
              .filter((invoice) => invoiceBalance(invoice) > 0)
              .map((invoice) => (
                <MenuItem key={invoice.id} value={invoice.id}>
                  {invoice.code} • {money(invoiceBalance(invoice))}
                </MenuItem>
              ))}
          </TextField>
          <Button
            variant="contained"
            disabled={!invoiceId || action.isPending}
            onClick={() => action.mutate(() => repository.reconcile(row.id, invoiceId))}
          >
            Xác nhận khớp (demo)
          </Button>
        </Stack>
      )}
      {kind === 'debts' && (
        <Stack spacing={1} sx={{ my: 2 }}>
          <Typography variant="subtitle2">Lịch sử đôn đốc & Hẹn thanh toán</Typography>
          <Typography variant="caption">
            {row.attributes.followupNote || 'Chưa ghi nhận hẹn thanh toán.'}
          </Typography>
          <TextField
            size="small"
            type="date"
            label="Ngày hẹn"
            value={followupDate}
            onChange={(event) => setFollowupDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            multiline
            minRows={2}
            label="Ghi chú đôn đốc"
            value={followupNote}
            onChange={(event) => setFollowupNote(event.target.value)}
          />
          <Button
            variant="outlined"
            disabled={action.isPending || !followupNote.trim()}
            onClick={() =>
              action.mutate(() => repository.recordDebtFollowup(row.id, followupDate, followupNote))
            }
          >
            Lưu hẹn thanh toán demo
          </Button>
          <Alert severity="info">
            Không gửi Zalo/SMS, trừ cọc hoặc khóa quyền truy cập của khách thuê.
          </Alert>
        </Stack>
      )}
      {kind === 'invoices' && row.status === 'Yêu cầu điều chỉnh' && (
        <Stack spacing={1} sx={{ my: 2 }}>
          <TextField
            label="Số tiền điều chỉnh (+/- VND)"
            size="small"
            type="number"
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
          />
          <TextField
            label="Lý do điều chỉnh"
            size="small"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={action.isPending || !reason.trim()}
            onClick={() =>
              updateAttributes({ requestedAdjustment: adjustment, adjustmentReason: reason })
            }
          >
            Lưu đề nghị điều chỉnh
          </Button>
        </Stack>
      )}
      {kind === 'handovers' && (
        <Box sx={{ my: 2 }}>
          <Typography variant="subtitle2">Biên bản hiện trạng</Typography>
          {['Cửa & khóa', 'Điều hòa', 'Tủ lạnh', 'Điện nước'].map((item) => (
            <FormControlLabel
              key={item}
              control={
                <Checkbox
                  checked={row.attributes[`check-${item}`] === 'true'}
                  disabled={action.isPending}
                  onChange={(e) =>
                    updateAttributes({ [`check-${item}`]: String(e.target.checked) })
                  }
                />
              }
              label={<Typography variant="caption">{item}: đã kiểm tra</Typography>}
            />
          ))}
          {[
            ['staffConfirmed', 'Nhân viên xác nhận'],
            ['tenantConfirmed', 'Khách thuê xác nhận'],
          ].map(([field, label]) => (
            <FormControlLabel
              key={field}
              control={
                <Checkbox
                  checked={row.attributes[field] === 'true'}
                  disabled={action.isPending}
                  onChange={(e) => updateAttributes({ [field]: String(e.target.checked) })}
                />
              }
              label={<Typography variant="caption">{label} (demo)</Typography>}
            />
          ))}
          <Alert severity="info">
            Chỉ ghi nhận biên bản. Không tự trừ cọc hoặc chuyển hoàn thực tế.
          </Alert>
        </Box>
      )}
      {kind === 'temporary-residence' && (
        <Alert severity="info" sx={{ my: 2 }}>
          Khách thuê đăng ký ngoài BHOME. Xác nhận chỗ ở không phải phê duyệt của cơ quan nhà nước.
        </Alert>
      )}
      {nextStatuses
        .filter(() => kind !== 'payments' && kind !== 'debts')
        .map((status) => (
          <Button
            key={status}
            variant="contained"
            fullWidth
            disabled={action.isPending}
            sx={{ mt: 1, fontSize: 11 }}
            onClick={() => setNext(status)}
          >
            {kind === 'invoices' && row.status === 'Chờ duyệt điều chỉnh'
              ? 'Phê duyệt điều chỉnh (demo)'
              : status}
            {kind === 'contracts' ? ' (mô phỏng)' : ''}
          </Button>
        ))}
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Lịch sử xử lý
      </Typography>
      {database.audit
        .filter((entry) => entry.recordId === row.id)
        .slice(0, 8)
        .map((entry) => (
          <Box
            key={entry.id}
            sx={{ borderLeft: '2px solid', borderColor: 'primary.light', pl: 1, mb: 1 }}
          >
            <Typography variant="caption">{entry.action}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {dateLabel(entry.at)} • {new Date(entry.at).toLocaleTimeString('vi-VN')}
            </Typography>
          </Box>
        ))}
      {!database.audit.some((entry) => entry.recordId === row.id) && (
        <Typography variant="caption" color="text.secondary">
          Bản ghi khởi tạo từ bộ dữ liệu minh họa.
        </Typography>
      )}
      {canDelete && (
        <Button
          color="error"
          startIcon={<Trash2 size={13} />}
          sx={{ mt: 2 }}
          onClick={() => setDeleteOpen(true)}
        >
          Xóa bản ghi demo
        </Button>
      )}
      <ConfirmDialog
        open={deleteOpen}
        title="Xóa bản ghi demo?"
        busy={action.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          action.mutate(() => repository.remove(kind, row.id), { onSuccess: onClose })
        }
      >
        Không xóa được hồ sơ đang được tham chiếu bởi dữ liệu khác.
      </ConfirmDialog>
      <ConfirmDialog
        open={!!next}
        title="Xác nhận chuyển trạng thái demo"
        busy={action.isPending}
        onClose={() => setNext('')}
        onConfirm={() =>
          action.mutate(() => repository.transition(kind, row.id, next), {
            onSuccess: () => setNext(''),
          })
        }
      >
        Chuyển {row.code} sang “{next}”. Thao tác chỉ ảnh hưởng dữ liệu minh họa cục bộ.
      </ConfirmDialog>
    </Paper>
  );
}
