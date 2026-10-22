import { Layout, Typography, Space } from 'antd';
import { Link, Outlet } from 'react-router-dom';

export function OwnerLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: '#fff', height: 'auto', padding: '1rem 2rem' }}>
        <Typography.Title level={2}>BHOME · Cổng chủ nhà</Typography.Title>
        <nav aria-label="Điều hướng chính">
          <Space>
            <Link to="/">Trang chủ</Link>
            <Link to="/dashboard">Bảng điều khiển</Link>
          </Space>
        </nav>
      </Layout.Header>
      <Layout.Content>
        <Outlet />
      </Layout.Content>
      <Layout.Footer>BHOME · Quản lý và vận hành chuỗi nhà trọ</Layout.Footer>
    </Layout>
  );
}
