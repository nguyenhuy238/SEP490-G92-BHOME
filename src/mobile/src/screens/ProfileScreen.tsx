import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Button, Dialog, Portal, Text } from 'react-native-paper';
import { useProfile } from '../features/profile/useProfile';
import {
  ProfileInfoCard,
  ProfileSettingRow,
  ProfileFailure,
  ProfileSkeleton,
  profileStyles as styles,
} from '../features/profile/ProfileComponents';
import { profileError } from '../services/accountProfile';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { roleLabel, sessionRole } from '../features/workspace/navigation';
import { colors, staffColors } from '../theme/theme';
import { showError, showWarning } from '../lib/toast';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import type { Named } from '../lib/api';

export function ProfileScreen() {
  const { session, logout } = useSession();
  const { go, preview, leavePreview } = useWorkspace();
  const profile = useProfile();
  const staff = sessionRole(session?.roles ?? []) === 'Staff';
  const locations = useWorkspaceQuery<Named[]>(staff ? '/api/v1/capture/locations' : null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useWorkspaceHeaderRefresh(profile.reload, profile.fetching);
  async function signOut() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setConfirm(false);
    try {
      await logout();
    } catch {
      showWarning('Đã xóa phiên trên thiết bị; chưa xác nhận được đăng xuất tại máy chủ.');
    } finally {
      router.replace('/');
      lock.current = false;
      setBusy(false);
    }
  }
  if (!session)
    return (
      <ProfileFailure
        message="Đăng nhập để xem và cập nhật hồ sơ cá nhân."
        retry={() => (preview ? leavePreview() : router.replace('/'))}
      />
    );
  const data = profile.data;
  const role = data ? sessionRole(data.roles) : null;
  const initials =
    data?.fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toLocaleUpperCase('vi') || 'BH';
  return (
    <>
      {profile.loading && <ProfileSkeleton />}
      {!!profile.rawError && (
        <ProfileFailure
          message={profileError(profile.rawError)}
          retry={profile.reload}
          busy={profile.fetching}
        />
      )}
      {data && (
        <>
          <View style={[styles.card, styles.row, { paddingVertical: 20 }]}>
            <Avatar.Text
              size={64}
              label={initials}
              color={staffColors.blue}
              style={{ backgroundColor: staffColors.blueSoft }}
            />
            <View style={[styles.grow, { gap: 4 }]}>
              <Text variant="titleLarge" style={{ color: colors.ink }}>
                {data.fullName.trim() || 'Chưa cập nhật'}
              </Text>
              <Text style={styles.label}>{role ? roleLabel[role] : 'Tài khoản'}</Text>
              <View style={[styles.row, { gap: 6, marginTop: 3 }]}>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: data.isActive ? colors.green : colors.muted,
                  }}
                />
                <Text
                  style={[styles.label, { color: data.isActive ? colors.green : colors.muted }]}
                >
                  {data.isActive ? 'Tài khoản đang hoạt động' : 'Tài khoản đã ngừng hoạt động'}
                </Text>
              </View>
            </View>
          </View>
          <ProfileInfoCard profile={data} edit={() => go('profile-edit')} />
          {staff && (
            <View style={styles.card}>
              <Text variant="titleMedium">Cơ sở được phân công</Text>
              {Array.isArray(locations.data) ? (
                locations.data.length ? (
                  locations.data.map((location) => <Text key={location.id}>{location.label}</Text>)
                ) : (
                  <Text>Chưa có cơ sở được phân công hiện tại.</Text>
                )
              ) : (
                <Text>{locations.error || 'Đang tải cơ sở được phân công…'}</Text>
              )}
            </View>
          )}
        </>
      )}
      <View style={[styles.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
        <Text style={[styles.title, { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }]}>
          Tài khoản và cài đặt
        </Text>
        <ProfileSettingRow
          icon="shield-lock-outline"
          label="Bảo mật và mật khẩu"
          onPress={() => go('security')}
        />
        <View style={[styles.divider, { marginHorizontal: 16 }]} />
        <ProfileSettingRow
          icon="bell-outline"
          label="Thông báo của tôi"
          onPress={() => go('notifications')}
        />
      </View>
      <Button
        mode="text"
        icon="logout"
        textColor={colors.red}
        disabled={busy}
        loading={busy}
        onPress={() => setConfirm(true)}
      >
        Đăng xuất
      </Button>
      <Portal>
        <Dialog visible={confirm} onDismiss={() => !busy && setConfirm(false)}>
          <Dialog.Title>Đăng xuất BHOME?</Dialog.Title>
          <Dialog.Content>
            <Text>Phiên đăng nhập trên thiết bị sẽ được xóa.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={busy} onPress={() => setConfirm(false)}>
              Ở lại
            </Button>
            <Button
              disabled={busy}
              onPress={() => {
                void signOut().catch(() => showError('Chưa thể hoàn tất đăng xuất.'));
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
