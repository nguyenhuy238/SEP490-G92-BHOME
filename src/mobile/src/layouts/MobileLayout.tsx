import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '@bhome/client-core/auth.tsx';
import { roleLabels } from '@bhome/client-core/roles.ts';
import { mobileNavigation } from '../routes/navigation';

export function MobileLayout() {
  const { session } = useAuth();
  return (
    <>
      <header>
        <strong>BHOME · Ứng dụng di động</strong>
        <nav aria-label="Điều hướng chính">
          <Link to="/">Trang chủ</Link>
          {mobileNavigation
            .filter((item) => session?.roles.includes(item.role))
            .map((item) => (
              <Link key={item.path} to={item.path}>
                {roleLabels[item.role]}
              </Link>
            ))}
        </nav>
      </header>
      <Outlet />
    </>
  );
}
