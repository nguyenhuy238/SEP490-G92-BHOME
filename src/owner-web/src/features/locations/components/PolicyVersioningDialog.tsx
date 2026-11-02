import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
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
import { AlertTriangle, CheckCircle2, History, Info, Sparkles, X } from 'lucide-react';
import type { HouseRuleItem, PolicyVersionRecord } from '../types/locationConfig';

interface PolicyVersioningDialogProps {
  open: boolean;
  onClose: () => void;
  policy: HouseRuleItem | null;
  onSaveNewVersion: (policyId: string, newVersion: PolicyVersionRecord) => void;
  onUpdateDraft?: (policyId: string, updatedContent: string) => void;
}

export function PolicyVersioningDialog({
  open,
  onClose,
  policy,
  onSaveNewVersion,
  onUpdateDraft,
}: PolicyVersioningDialogProps) {
  const [proposedValue, setProposedValue] = useState(policy?.content ?? '');
  const [effectiveDate, setEffectiveDate] = useState('2026-12-01');
  const [changeNote, setChangeNote] = useState('');
  const [scheduledStatus, setScheduledStatus] = useState<'SCHEDULED' | 'ACTIVE'>('SCHEDULED');

  if (!policy) return null;

  const isApplied = policy.isAppliedToContracts;
  const currentVersion = policy.version || 'V1';
  const nextVersionNumber = `V${parseInt(currentVersion.replace(/\D/g, '') || '1', 10) + 1}`;

  const handleSave = () => {
    if (isApplied) {
      const newVersionRecord: PolicyVersionRecord = {
        version: nextVersionNumber,
        value: proposedValue,
        effectiveDate,
        status: scheduledStatus,
        createdBy: 'Chủ cơ sở (Mô phỏng)',
        note: changeNote || 'Cập nhật tiêu chuẩn quy định và điều khoản mới',
      };
      onSaveNewVersion(policy.id, newVersionRecord);
    } else if (onUpdateDraft) {
      onUpdateDraft(policy.id, proposedValue);
    }
    onClose();
  };

  const sampleHistory: PolicyVersionRecord[] = policy.history || [
    {
      version: currentVersion,
      value: policy.content,
      effectiveDate: policy.effectiveDate || '2026-01-01',
      status: 'ACTIVE',
      createdBy: 'Chủ cơ sở',
      note: 'Quy định ban đầu khi kích hoạt cơ sở',
    },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              bgcolor: isApplied ? '#fff7ed' : '#ebf2ff',
              color: isApplied ? '#ea580c' : '#255dde',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {isApplied ? <AlertTriangle size={20} /> : <History size={20} />}
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {isApplied
                ? 'Quản lý phiên bản quy định & Kiểm soát thay đổi'
                : 'Chỉnh sửa quy định bản nháp'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Mã quy định: {policy.id} · {policy.name}
            </Typography>
          </Box>
        </Stack>
        <Button size="small" onClick={onClose} sx={{ minWidth: 'auto', p: 0.5 }}>
          <X size={18} />
        </Button>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ py: 2.5 }}>
        {/* Case distinction banners */}
        {isApplied ? (
          <Alert
            severity="warning"
            icon={<AlertTriangle size={20} />}
            sx={{
              mb: 3,
              borderRadius: 2,
              bgcolor: '#fffbeb',
              color: '#92400e',
              border: '1px solid #fde68a',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Cảnh báo bảo vệ hợp đồng đang hiệu lực (Trường hợp B)
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Quy định này đã được áp dụng trong các hợp đồng thuê đang có hiệu lực. Để đảm bảo tính
              pháp lý và lưu vết lịch sử kiểm toán, hệ thống khóa chỉnh sửa trực tiếp. Vui lòng tạo
              một phiên bản mới để lên lịch áp dụng với mốc thời gian hiệu lực tương ứng.
            </Typography>
          </Alert>
        ) : (
          <Alert
            severity="info"
            icon={<Info size={20} />}
            sx={{
              mb: 3,
              borderRadius: 2,
              bgcolor: '#eff6ff',
              color: '#1e40af',
              border: '1px solid #bfdbfe',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Quy định bản nháp chưa áp dụng (Trường hợp A)
            </Typography>
            <Typography variant="body2">
              Quy định này đang ở trạng thái Nháp và chưa được liên kết vào bất kỳ hợp đồng thuê
              nào. Mọi chỉnh sửa sẽ có hiệu lực ngay lập tức mà không cần tạo phiên bản mới.
            </Typography>
          </Alert>
        )}

        {/* Current vs Proposed Version Comparison */}
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: '#f8fafc',
                borderColor: '#e2e8f0',
                height: '100%',
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1.5 }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#475569' }}>
                  Phiên bản hiện tại đang áp dụng
                </Typography>
                <Chip
                  size="small"
                  label={`Phiên bản ${currentVersion}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 800 }}
                />
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Hiệu lực từ: {policy.effectiveDate || '2026-01-01'} · Trạng thái: Đang áp dụng
              </Typography>

              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  minHeight: 110,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: '#334155',
                }}
              >
                {policy.content}
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={6}>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: isApplied ? '#fffdf7' : '#f0fdf4',
                borderColor: isApplied ? '#fed7aa' : '#bbf7d0',
                height: '100%',
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1.5 }}
              >
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 800, color: isApplied ? '#c2410c' : '#15803d' }}
                >
                  {isApplied
                    ? `Đề xuất phiên bản mới (${nextVersionNumber})`
                    : 'Cập nhật nội dung bản nháp'}
                </Typography>
                <Chip
                  size="small"
                  label={isApplied ? `${nextVersionNumber} (Chờ hiệu lực)` : 'Sửa trực tiếp'}
                  sx={{
                    bgcolor: isApplied ? '#ffedd5' : '#dcfce7',
                    color: isApplied ? '#9a3412' : '#166534',
                    fontWeight: 800,
                  }}
                />
              </Stack>

              <TextField
                fullWidth
                multiline
                rows={4}
                size="small"
                value={proposedValue}
                onChange={(e) => setProposedValue(e.target.value)}
                placeholder="Nhập nội dung quy định sửa đổi hoặc biểu phí điều chỉnh..."
                sx={{ bgcolor: '#ffffff' }}
              />

              {isApplied && (
                <Grid container spacing={1.5} sx={{ mt: 1 }}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      size="small"
                      type="date"
                      label="Ngày bắt đầu hiệu lực"
                      InputLabelProps={{ shrink: true }}
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      sx={{ bgcolor: '#ffffff' }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      size="small"
                      select
                      SelectProps={{ native: true }}
                      label="Trạng thái kích hoạt"
                      value={scheduledStatus}
                      onChange={(e) => setScheduledStatus(e.target.value as 'SCHEDULED' | 'ACTIVE')}
                      sx={{ bgcolor: '#ffffff' }}
                    >
                      <option value="SCHEDULED">Lên lịch theo ngày hiệu lực</option>
                      <option value="ACTIVE">Áp dụng ngay</option>
                    </TextField>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Lý do tăng phiên bản"
                      placeholder="Ví dụ: Điều chỉnh khung giá theo biểu giá điện mới của EVN"
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      sx={{ bgcolor: '#ffffff' }}
                    />
                  </Grid>
                </Grid>
              )}
            </Paper>
          </Grid>
        </Grid>

        {/* Version History Table */}
        <Box sx={{ mt: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <History size={16} /> Lịch sử thay đổi & Lưu vết phiên bản
            </Typography>
            <Chip size="small" label={`${sampleHistory.length} phiên bản đã ghi nhận`} />
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 750, width: 90 }}>Phiên bản</TableCell>
                  <TableCell sx={{ fontWeight: 750 }}>Nội dung quy định</TableCell>
                  <TableCell sx={{ fontWeight: 750, width: 130 }}>Ngày hiệu lực</TableCell>
                  <TableCell sx={{ fontWeight: 750, width: 120 }}>Trạng thái</TableCell>
                  <TableCell sx={{ fontWeight: 750, width: 160 }}>Người tạo / Ghi chú</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sampleHistory.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Chip
                        size="small"
                        label={`Phiên bản ${item.version}`}
                        sx={{
                          fontWeight: 800,
                          bgcolor: item.status === 'ACTIVE' ? '#dbeafe' : '#f1f5f9',
                          color: item.status === 'ACTIVE' ? '#1e40af' : '#475569',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 13, color: '#334155' }}>{item.value}</TableCell>
                    <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {item.effectiveDate}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={
                          item.status === 'ACTIVE'
                            ? 'Đang áp dụng'
                            : item.status === 'SCHEDULED'
                              ? 'Đã lên lịch'
                              : 'Lịch sử'
                        }
                        color={
                          item.status === 'ACTIVE'
                            ? 'success'
                            : item.status === 'SCHEDULED'
                              ? 'warning'
                              : 'default'
                        }
                        sx={{ fontWeight: 700, fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {item.createdBy || 'Chủ cơ sở'}
                      {item.note && (
                        <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8' }}>
                          {item.note}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {isApplied
            ? `Phiên bản mới ${nextVersionNumber} sẽ được kích hoạt sau khi bấm xác nhận.`
            : 'Thay đổi sẽ được cập nhật trực tiếp vào bản nháp này.'}
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={onClose}>
            Hủy
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveSave}
            startIcon={isApplied ? <Sparkles size={16} /> : <CheckCircle2 size={16} />}
          >
            {isApplied ? `Tạo phiên bản mới (${nextVersionNumber})` : 'Lưu thay đổi'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );

  function handleSaveSave() {
    handleSave();
  }
}
