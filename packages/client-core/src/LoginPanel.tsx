import { useState, type FormEvent } from 'react';
import { useAuth } from './auth';
import { ApiError } from './api';

export function LoginPanel() {
  const { session, client } = useAuth();
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await client.login(userName, password);
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : 'Không thể đăng nhập. Vui lòng kiểm tra thông tin hoặc thử lại sau.',
      );
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  async function logout(allDevices: boolean) {
    setBusy(true);
    try {
      await client.logout(allDevices);
      setMessage('Đã đăng xuất.');
    } catch {
      setMessage(
        'Đã xóa phiên trên thiết bị. Không thể xác nhận thu hồi trên máy chủ; vui lòng thử lại khi có kết nối.',
      );
    } finally {
      setPassword('');
      setCurrentPassword('');
      setNewPassword('');
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await client.changePassword(currentPassword, newPassword);
      setMessage('Đã đổi mật khẩu và đăng xuất mọi thiết bị. Vui lòng đăng nhập lại.');
    } catch {
      setMessage(
        'Không thể đổi mật khẩu. Kiểm tra mật khẩu hiện tại và yêu cầu bảo mật rồi thử lại.',
      );
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setBusy(false);
    }
  }
  return (
    <section aria-label="Tài khoản">
      {session ? (
        <>
          <p>Đã đăng nhập.</p>
          <button disabled={busy} onClick={() => void logout(false)}>
            Đăng xuất
          </button>
          <button disabled={busy} onClick={() => void logout(true)}>
            Đăng xuất mọi thiết bị
          </button>
          <form onSubmit={(event) => void changePassword(event)}>
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              Mật khẩu mới
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={1024}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <p>Mật khẩu mới có ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p>
            <button disabled={busy} type="submit">
              Đổi mật khẩu
            </button>
          </form>
        </>
      ) : (
        <form onSubmit={(event) => void login(event)}>
          <label>
            Tên đăng nhập
            <input
              autoComplete="username"
              value={userName}
              maxLength={256}
              required
              onChange={(event) => setUserName(event.target.value)}
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={1024}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={busy} type="submit">
            Đăng nhập
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
