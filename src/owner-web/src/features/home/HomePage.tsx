import { Typography } from 'antd';
import { LoginPanel } from '@bhome/client-core/LoginPanel.tsx';

export function HomePage() {
  return (
    <main>
      <Typography.Title>Chào mừng đến với BHOME</Typography.Title>
      <Typography.Paragraph>Nền tảng quản lý và vận hành chuỗi nhà trọ.</Typography.Paragraph>
      <LoginPanel />
    </main>
  );
}
