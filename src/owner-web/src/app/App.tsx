import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { AuthProvider } from '@bhome/client-core/auth.tsx';
import { OwnerRoutes } from '../routes/OwnerRoutes';

export function App() {
  return (
    <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#126b52', borderRadius: 8 } }}>
      <AuthProvider>
        <OwnerRoutes />
      </AuthProvider>
    </ConfigProvider>
  );
}
