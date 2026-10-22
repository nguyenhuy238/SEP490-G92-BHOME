import { Typography, Alert } from 'antd';

export function HomePage() {
  return (
    <main>
      <Typography.Title>Chào mừng đến với BHOME</Typography.Title>
      <Typography.Paragraph>Nền tảng quản lý và vận hành chuỗi nhà trọ.</Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        message="Cổng chủ nhà đã sẵn sàng phát triển."
        description="Chức năng đăng nhập và nghiệp vụ sẽ được bổ sung trong các giai đoạn tiếp theo."
      />
    </main>
  );
}
