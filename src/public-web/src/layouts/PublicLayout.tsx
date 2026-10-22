import { Link, Outlet } from 'react-router-dom';
export function PublicLayout() {
  return (
    <>
      <header>
        <strong>BHOME</strong>
        <nav aria-label="Điều hướng chính">
          <Link to="/">Trang chủ</Link>
        </nav>
      </header>
      <Outlet />
      <footer>BHOME · Thông tin nhà trọ dành cho cộng đồng</footer>
    </>
  );
}
