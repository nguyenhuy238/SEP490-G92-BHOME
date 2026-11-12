import { Button, Chip, Paper, Stack, Typography, Box } from '@mui/material';
import { Link } from 'react-router';
import { DoorOpen, Package, Coins, ScrollText, ArrowUpRight, CheckCircle2 } from 'lucide-react';

export function LocationWorkspaceOverview({
  id,
  summary,
}: {
  id: string;
  summary?: {
    rooms?: number;
    assets?: number;
    pricesAndFees?: number;
    rules?: number;
    assetTemplates?: number;
  };
}) {
  const sections = [
    {
      key: 'rooms',
      title: 'Phòng cho thuê',
      count: summary?.rooms,
      icon: DoorOpen,
      color: '#255dde',
      description: 'Tạo phòng, cập nhật sức chứa và theo dõi trạng thái khai thác.',
      action: 'Quản lý phòng',
    },
    {
      key: 'assets',
      title: 'Tài sản thực tế',
      count: summary?.assets,
      icon: Package,
      color: '#087f72',
      description: 'Quản lý thiết bị tại phòng, khu chung và tình trạng sử dụng.',
      action: 'Quản lý tài sản',
    },
    {
      key: 'pricing',
      title: 'Giá thuê & biểu phí',
      count: summary?.pricesAndFees,
      icon: Coins,
      color: '#b06b10',
      description: 'Thiết lập giá theo cơ sở hoặc từng phòng và thời gian hiệu lực.',
      action: 'Thiết lập giá & phí',
    },
    {
      key: 'rules',
      title: 'Nội quy',
      count: summary?.rules,
      icon: ScrollText,
      color: '#7650b5',
      description: 'Soạn nội quy, quản lý phiên bản và nội dung áp dụng tại cơ sở.',
      action: 'Quản lý nội quy',
    },
  ];
  return (
    <Stack spacing={3}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        {sections.map(({ key, title, count, icon: Icon, color, description, action }) => (
          <Paper
            key={key}
            variant="outlined"
            sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ p: 1.2, borderRadius: 2, color, bgcolor: `${color}10`, display: 'flex' }}>
                <Icon size={23} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                {count ?? '—'}
              </Typography>
            </Stack>
            <Box>
              <Typography sx={{ fontWeight: 750, mb: 0.75 }}>{title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                {description}
              </Typography>
            </Box>
            <Button
              component={Link}
              to={`/locations/${id}/${key}`}
              endIcon={<ArrowUpRight size={16} />}
              sx={{ mt: 'auto', alignSelf: 'flex-start', px: 0 }}
            >
              {action}
            </Button>
          </Paper>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, gap: 3 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 750 }}>
            Thiết lập cơ sở
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            Đi đến từng mục để bổ sung hoặc kiểm tra cấu hình trước khi vận hành.
          </Typography>
          {sections.map(({ key, title, count }, index) => (
            <Stack
              key={key}
              direction="row"
              spacing={2}
              sx={{
                py: 1.75,
                alignItems: 'center',
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: count ? '#eaf7ef' : '#eff3fa',
                  color: count ? '#24834d' : '#63738b',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                {count ? <CheckCircle2 size={18} /> : index + 1}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {count == null
                    ? 'Chưa có số liệu · Có thể mở mục để kiểm tra'
                    : count
                      ? `Đã có ${count} bản ghi · Có thể xem và cập nhật`
                      : 'Chưa có dữ liệu'}
                </Typography>
              </Box>
              <Button
                component={Link}
                to={`/locations/${id}/${key}`}
                variant={count ? 'text' : 'outlined'}
              >
                {count ? 'Xem' : 'Thiết lập'}
              </Button>
            </Stack>
          ))}
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Chip size="small" label="Truy cập nhanh" sx={{ mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 750, mb: 2 }}>
            Công cụ quản lý
          </Typography>
          <Stack spacing={1.5}>
            {[
              ['utilities', 'Điện & nước', 'Cấu hình công tơ và dữ liệu chỉ số.'],
              ['history', 'Lịch sử phòng', 'Tra cứu thay đổi theo từng phòng.'],
              ['investment', 'Vốn & chi phí', 'Xem các khoản đầu tư và chi phí cơ sở.'],
              ['settings', 'Thông tin cơ sở', 'Cập nhật tên, địa chỉ và trạng thái.'],
            ].map(([path, title, description]) => (
              <Button
                key={path}
                component={Link}
                to={`/locations/${id}/${path}`}
                sx={{
                  p: 1.5,
                  justifyContent: 'space-between',
                  border: '1px solid',
                  borderColor: 'divider',
                  textAlign: 'left',
                }}
                endIcon={<ArrowUpRight size={18} />}
              >
                <Box>
                  <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {description}
                  </Typography>
                </Box>
              </Button>
            ))}
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}
