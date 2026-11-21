import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Copy, Save, Settings } from 'lucide-react';
import { usePortal } from '../../../../app/PortalProvider';
import { usePortalAction } from '../../../../hooks/usePortalData';
import type { PortalRecord } from '../../../../types/portal';

interface LocationSettingsTabProps {
  location: PortalRecord;
  onLaunchCopyWizard: () => void;
}

export function LocationSettingsTab({ location, onLaunchCopyWizard }: LocationSettingsTabProps) {
  const portal = usePortal();
  const action = usePortalAction();
  const [name, setName] = useState(location.name);
  const [code, setCode] = useState(location.code);
  const [address, setAddress] = useState(location.attributes.address || '');
  const [floors, setFloors] = useState(location.attributes.floors || '4');
  const [phone, setPhone] = useState(location.attributes.phone || '0908 123 456');
  const [email, setEmail] = useState(location.attributes.email || 'property@bhome.vn');
  const [status, setStatus] = useState(
    location.status.includes('vận hành') ? 'ACTIVE' : 'PREPARING',
  );
  const [saveNotice, setSaveNotice] = useState(false);

  const handleSave = () => {
    const updatedLocation: PortalRecord = {
      ...location,
      name,
      code,
      status: status === 'ACTIVE' ? 'Đang vận hành' : 'Chuẩn bị vận hành',
      attributes: {
        ...location.attributes,
        address,
        floors,
        phone,
        email,
      },
    };

    action.mutate(() => portal.repository.save('locations', updatedLocation), {
      onSuccess: () => {
        setSaveNotice(true);
        setTimeout(() => setSaveNotice(false), 4000);
      },
    });
  };

  return (
    <Box>
      {saveNotice && (
        <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
          Đã lưu cập nhật thông tin thiết lập cơ sở thành công.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Core Settings Form */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, bgcolor: '#ffffff' }}>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Settings size={20} color="#255dde" /> Thông tin thuộc tính cơ sở
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Cập nhật thông tin định danh, địa chỉ và số điện thoại liên hệ quản lý của cơ sở.
            </Typography>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Tên cơ sở"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Mã cơ sở"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Địa chỉ thực tế"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label="Số tầng"
                  value={floors}
                  onChange={(e) => setFloors(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Hotline quản lý"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Email tiếp nhận"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  select
                  size="small"
                  label="Trạng thái vận hành"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <MenuItem value="ACTIVE">Đang vận hành</MenuItem>
                  <MenuItem value="PREPARING">Chuẩn bị vận hành</MenuItem>
                  <MenuItem value="SUSPENDED">Tạm ngừng hoạt động</MenuItem>
                </TextField>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                onClick={handleSave}
                startIcon={<Save size={16} />}
                disabled={action.isPending}
              >
                Lưu thay đổi
              </Button>
            </Stack>
          </Paper>
        </Grid>

        {/* Clone & Export Actions */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Copy size={18} color="#255dde" /> Sao chép cấu hình cơ sở
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Nhân bản loại phòng, biểu phí điện nước, định mức trang bị và nội quy từ cơ sở này
              sang cơ sở khác trong chuỗi BHOME.
            </Typography>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<Copy size={16} />}
              onClick={onLaunchCopyWizard}
              sx={{ bgcolor: '#ffffff' }}
            >
              Mở trình sao chép cấu hình
            </Button>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
