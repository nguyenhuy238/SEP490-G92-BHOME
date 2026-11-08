import React, { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { QueryState } from '../components/WorkspaceQueryState';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';

export function TenantProfileScreen() {
  const { logout } = useSession();
  const { go } = useWorkspace();
  const identity = useWorkspaceQuery<{ roles: string[] }>('/api/v1/auth/me');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <>
      <Heading title="Hồ sơ cá nhân" detail="Thông tin tài khoản đang đăng nhập" />
      <QueryState {...identity} />
      {identity.data && (
        <Box>
          <Pill tone="green">Đã xác thực tài khoản</Pill>
          <Text>
            Vai trò khách thuê:{' '}
            {identity.data.roles.includes('Tenant') ? 'Đã xác nhận' : 'Không có quyền'}
          </Text>
        </Box>
      )}
      <Box>
        <Heading title="Thông tin liên hệ" />
        <Text>
          Máy chủ hiện chỉ cung cấp định danh phiên và vai trò, chưa có dữ liệu hồ sơ hoặc chức năng
          cập nhật thông tin được phép. Không thể chỉnh sửa thông tin định danh đã xác minh tại đây.
        </Text>
      </Box>
      <Action onPress={() => go('security')}>Bảo mật và mật khẩu</Action>
      <Action secondary onPress={() => go('notifications')}>
        Thông báo của tôi
      </Action>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Button icon="logout" disabled={busy} loading={busy} onPress={() => setConfirm(true)}>
        Đăng xuất tài khoản
      </Button>
      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>Đăng xuất BHOME?</Dialog.Title>
          <Dialog.Content>
            <Text>Phiên đăng nhập trên thiết bị sẽ được xóa.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>Ở lại</Button>
            <Button
              disabled={busy}
              onPress={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setError('');
                setConfirm(false);
                try {
                  await logout();
                  router.replace('/');
                } catch {
                  setError(
                    'Chưa xác nhận được đăng xuất tại máy chủ. Phiên trên thiết bị được xử lý theo cơ chế đăng xuất hiện có.',
                  );
                  router.replace('/');
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              Đăng xuất
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}
