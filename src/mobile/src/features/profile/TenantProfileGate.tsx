import React from 'react';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Page } from '../../components/Controls';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSession } from '../../lib/SessionProvider';
import { ProfileEditScreen } from '../../screens/ProfileEditScreen';
import { ProfileFailure } from './ProfileComponents';
import { useProfile } from './useProfile';
import { profileError } from '../../services/accountProfile';

export function TenantProfileGate({ children }: { children: React.ReactNode }) {
  const { role, preview } = useWorkspace();
  return role === 'Tenant' && !preview ? (
    <RequiredTenantProfile>{children}</RequiredTenantProfile>
  ) : (
    <>{children}</>
  );
}

function RequiredTenantProfile({ children }: { children: React.ReactNode }) {
  const query = useProfile();
  const { logout } = useSession();
  if (!query.data)
    return (
      <Page>
        {query.rawError ? (
          <ProfileFailure
            message={profileError(query.rawError)}
            retry={query.reload}
            busy={query.fetching}
          />
        ) : (
          <ActivityIndicator accessibilityLabel="Đang kiểm tra hồ sơ Tenant" />
        )}
      </Page>
    );
  if (query.data.fullName.trim().length < 2 || !query.data.phone?.trim())
    return (
      <Page>
        <Text variant="titleLarge">Hoàn tất hồ sơ trước khi tiếp tục</Text>
        <Text>
          Vui lòng bổ sung họ tên và số điện thoại liên hệ. Thông tin vai trò và trạng thái tài
          khoản do hệ thống quản lý.
        </Text>
        <ProfileEditScreen completion />
        <Button onPress={() => void logout().catch(() => {})}>Đăng xuất</Button>
      </Page>
    );
  return <>{children}</>;
}
