import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { residentRole, residentStatus } from './residentPresentation';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import {
  contractClient,
  type ContractSummary,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Resident } from '../../lib/api';
import { captureService } from '../../services/captureService';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { IdentityWizard } from './IdentityWizard';
import { conciseMessage, showSuccess } from '../../lib/toast';
import { colors as c, staffColors as s } from '../../theme/theme';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts.length || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Resolve status from the scoped summary API, never from a navigation flag or decrypted identity.
export function ResidentProfile({
  residentId,
  locationId,
}: {
  residentId: string;
  locationId?: string;
}) {
  const { api } = useSession();
  const { go, requestNavigation } = useWorkspace();
  const [data, setData] = useState<{
    resident: Resident;
    location: string;
    room: string;
    locationId: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'capture' | 'verify'>('capture');
  const contractCheck = useRef<AbortController | null>(null);

  useEffect(() => () => contractCheck.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setData(null);
      if (!api) return;
      const service = captureService(api);
      const locations = await service.locations(controller.signal);
      for (const location of locations.filter((item) => !locationId || item.id === locationId)) {
        const residents = await service.residents(location.id, controller.signal);
        const resident = residents.find((item) => item.id === residentId);
        if (!resident) continue;
        const rooms = await service.rooms(location.id, controller.signal);
        if (!controller.signal.aborted)
          setData({
            resident,
            location: location.label,
            locationId: location.id,
            room: rooms.find((room) => room.id === resident.roomId)?.label ?? '—',
          });
        return;
      }
      if (!controller.signal.aborted)
        setError('Hồ sơ không còn khả dụng trong phạm vi được phân công.');
    }
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(conciseMessage(errorMessage(e)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, residentId, locationId, revision]);

  async function continueContract() {
    if (!api || !data || contractCheck.current) return;
    const controller = new AbortController();
    contractCheck.current = controller;
    setChecking(true);
    setError('');
    const client = contractClient((path, init, type) => api.request(path, init, type));
    try {
      // The list omits Resident IDs. Read permitted details before offering a new draft.
      let page = 1;
      let related: ContractSummary | undefined;
      while (true) {
        const list = await client.list(page, '', data.locationId, controller.signal);
        for (const item of list.items.filter(
          (item) =>
            item.roomId === data.resident.roomId &&
            ['Draft', 'PendingSigning', 'PendingActivation', 'Active'].includes(item.status),
        )) {
          const detail = await client.get(item.id, controller.signal);
          if (detail.residentIds.includes(residentId)) {
            related = item;
            break;
          }
        }
        if (related || page * list.pageSize >= list.totalCount) break;
        if (page >= 25) {
          go('signing');
          return;
        }
        page++;
      }
      if (controller.signal.aborted) return;
      if (related) {
        go(
          'signing',
          related.onboardingDraft && related.status === 'Draft'
            ? { mainDraftId: related.id }
            : { contractId: related.id },
        );
      } else if (data.resident.residentType === 0) {
        go('prepare-contract', {
          roomId: data.resident.roomId,
          representativeResidentId: residentId,
          residentIds: JSON.stringify([residentId]),
        });
      } else {
        // Co-occupants cannot become representatives by opening this screen.
        go('prepare-contract');
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(conciseMessage(errorMessage(e)));
    } finally {
      contractCheck.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function startVerification(mode: 'capture' | 'verify') {
    setWizardMode(mode);
    setWizardOpen(true);
  }

  function back() {
    requestNavigation(() => (router.canGoBack() ? router.back() : go('rooms')));
  }
  if (loading) return <ActivityIndicator accessibilityLabel="Đang tải hồ sơ người thuê" />;
  if (!data)
    return (
      <Box>
        <Heading title="Hồ sơ người thuê" />
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        <Button onPress={() => setRevision((v) => v + 1)}>Tải lại hồ sơ</Button>
        <Button onPress={back}>Quay lại</Button>
      </Box>
    );

  const status = residentStatus(data.resident.verificationStatus);
  const pending = data.resident.verificationStatus === 0;
  const verified = data.resident.verificationStatus === 1;
  return (
    <View style={styles.screen}>
      <Heading title="Chi tiết cư dân" />
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: status.background }]}>
          <Text style={[styles.initials, { color: status.color }]}>
            {getInitials(data.resident.displayLabel)}
          </Text>
        </View>
        <View style={styles.person}>
          <Text variant="titleLarge" style={styles.name}>
            {data.resident.displayLabel}
          </Text>
          <Text style={styles.muted}>{residentRole(data.resident.residentType)}</Text>
          <View style={styles.status}>
            <Icon source={status.icon} size={17} color={status.color} />
            <Text style={{ color: status.color }}>{status.label}</Text>
          </View>
        </View>
      </View>
      <View style={styles.details}>
        <View style={styles.row}>
          <Text style={styles.muted}>Phòng</Text>
          <Text style={styles.value}>Phòng: {data.room}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>Cơ sở</Text>
          <Text style={styles.value}>{data.location}</Text>
        </View>
        {verified && !!data.resident.confirmedAt && (
          <View style={styles.row}>
            <Text style={styles.muted}>Xác minh lúc</Text>
            <Text style={styles.value}>{formatInstant(data.resident.confirmedAt)}</Text>
          </View>
        )}
      </View>
      {pending && (
        <>
          <Text style={styles.notice}>Chưa hoàn tất xác minh danh tính</Text>
          <Action icon="camera-outline" onPress={() => startVerification('capture')}>
            Quét CCCD (Camera)
          </Action>
          <Button
            mode="outlined"
            icon="text-box-edit-outline"
            contentStyle={styles.touch}
            onPress={() => startVerification('verify')}
          >
            Nhập thông tin thủ công
          </Button>
          <IdentityWizard
            residentId={residentId}
            personLabel={data.resident.displayLabel}
            mode={wizardMode}
            onModeChange={setWizardMode}
            modal
            visible={wizardOpen}
            onDismiss={() => setWizardOpen(false)}
            onCancel={() => setWizardOpen(false)}
            onComplete={() => setWizardOpen(false)}
            onConfirmed={() => {
              setWizardOpen(false);
              showSuccess('Đã xác nhận danh tính cư dân thành công!');
              setRevision((v) => v + 1);
            }}
          />
        </>
      )}
      {data.resident.verificationStatus === 2 && (
        <Text style={styles.notice}>
          Hồ sơ đã bị từ chối. Liên hệ chủ cơ sở để kiểm tra theo quy trình hồ sơ.
        </Text>
      )}
      <View style={styles.privacy}>
        <Icon source="shield-lock-outline" size={16} color={c.muted} />
        <Text style={styles.privacyText}>
          Chỉ hiển thị thông tin trong phạm vi được phân công. Dữ liệu định danh nhạy cảm được bảo
          vệ.
        </Text>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {verified && (
        <Action disabled={checking} onPress={() => void continueContract()}>
          {checking ? 'Đang kiểm tra hợp đồng…' : 'Xem / chuẩn bị hợp đồng'}
        </Action>
      )}
      <Button disabled={checking} contentStyle={styles.touch} onPress={back}>
        Quay lại
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 17, fontWeight: '700' },
  person: { flex: 1, minWidth: 0, gap: 4 },
  name: { color: c.ink, fontWeight: '700' },
  muted: { color: c.muted, fontSize: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  details: { borderTopWidth: 1, borderColor: c.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  value: { flex: 1, textAlign: 'right', color: c.ink, fontSize: 13 },
  notice: { color: s.orange, fontSize: 13, lineHeight: 20 },
  privacy: { flexDirection: 'row', gap: 8 },
  privacyText: { flex: 1, color: c.muted, fontSize: 12, lineHeight: 18 },
  touch: { minHeight: 44 },
});
