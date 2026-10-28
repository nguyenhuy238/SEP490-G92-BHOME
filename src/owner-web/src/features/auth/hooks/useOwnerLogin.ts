import { useState } from 'react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { isMockMode } from '../../../services/config';
import { demoAuth, useDemoSession } from '../../../services/demoAuth';

// Reuse the confirmed auth contract and cookie/JWT transport from client-core.
// No credentials or token copies are written to localStorage/sessionStorage.
export function useOwnerLogin() {
  const { client, session } = useAuth();
  const demoSession = useDemoSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState(false);

  async function login(userName: string, password: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (isMockMode) {
        await demoAuth.login(userName.trim(), password);
        return;
      }
      await client.login(userName.trim(), password);
      if (!client.session?.roles.includes('Owner')) {
        await client.logout().catch(() => undefined);
        setError('Tài khoản này không có quyền truy cập Owner Portal.');
      }
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : 'Không thể đăng nhập. Vui lòng kiểm tra thông tin hoặc thử lại sau.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestReset(userName: string) {
    setResetBusy(true);
    setResetMessage('');
    setResetError(false);
    try {
      if (isMockMode) {
        setResetMessage(
          'Chế độ demo: dùng tài khoản được hiển thị trên trang đăng nhập. Không gửi email thực tế.',
        );
        return;
      }
      await client.requestPasswordReset(userName.trim());
      setResetMessage('Nếu tài khoản đủ điều kiện, hướng dẫn đặt lại mật khẩu sẽ được gửi.');
    } catch (failure) {
      setResetError(true);
      setResetMessage(
        failure instanceof ApiError && failure.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : 'Chưa thể gửi hướng dẫn đặt lại mật khẩu. Vui lòng thử lại sau.',
      );
    } finally {
      setResetBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      if (isMockMode) {
        await demoAuth.logout();
        return;
      }
      await client.logout();
    } catch {
      setError('Đã xóa phiên trên thiết bị. Chưa xác nhận được thu hồi phiên trên máy chủ.');
    } finally {
      setBusy(false);
    }
  }

  return {
    login,
    logout,
    busy,
    error,
    authenticated: !busy && (isMockMode ? demoSession : !!session?.roles.includes('Owner')),
    requestReset,
    resetBusy,
    resetMessage,
    resetError,
  };
}
