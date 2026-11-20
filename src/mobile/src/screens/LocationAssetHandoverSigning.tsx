import React, { useCallback, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Box, ui } from '../components/WorkspaceKit';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { errorMessage, MobileApiError, type MobileApi } from '../lib/api';
import { randomUUID } from '../lib/randomUUID';
import { useSession } from '../lib/SessionProvider';
import { showSuccess } from '../lib/toast';
import { locationAssetHandoverClient, type LocationAssetHandoverReport } from '../services/locationAssetHandover';

const loadReport = async (api: MobileApi, path: string, signal: AbortSignal) => {
  try {
    return await api.request<LocationAssetHandoverReport>(path, { signal });
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 404) return null;
    throw error;
  }
};

export function LocationAssetHandoverSigning({
  taskId,
  taskStatus,
  onTaskRefresh,
}: {
  taskId: string;
  taskStatus: string;
  onTaskRefresh: () => void;
}) {
  const { api, session } = useSession();
  const query = useWorkspaceQuery<LocationAssetHandoverReport | null>(
    `/api/v1/operational-tasks/${taskId}/location-asset-handover`,
    { load: loadReport, notifyError: false },
  );
  const data = query.data;
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const reload = query.reload;
  const signingKey = data ? `${data.revision}:${data.snapshotSha256}:${data.status}` : '';
  const confirmed = !!signingKey && confirmedKey === signingKey;

  const sign = useCallback(async () => {
    if (!api || !data || !confirmed || lock.current || data.status !== 'PendingStaffSignature' ||
      data.staffId !== session?.userId) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await locationAssetHandoverClient(api).sign(taskId, data);
      setConfirmedKey(null);
      reload();
      onTaskRefresh();
      showSuccess('Đã ký xác nhận bàn giao tài sản cơ sở.');
    } catch (failure) {
      setError(errorMessage(failure));
      reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [api, data, confirmed, taskId, session?.userId, reload, onTaskRefresh]);

  const download = useCallback(async () => {
    if (!api || !data || downloadBusy) return;
    setDownloadBusy(true);
    setError('');
    try {
      const client = locationAssetHandoverClient(api);
      if (Platform.OS === 'web') {
        const blob = await client.documentBlob(taskId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bien-ban-tai-san-${taskId}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const Sharing = await import('expo-sharing');
        const { Directory, File, Paths } = await import('expo-file-system');
        if (!(await Sharing.isAvailableAsync()))
          throw new Error('Thiết bị không hỗ trợ mở hoặc lưu PDF.');
        const bytes = await client.documentBytes(taskId);
        const folder = new Directory(Paths.cache, 'bhome-location-asset-handover');
        folder.create({ idempotent: true, intermediates: true });
        const temp = new File(folder, `${randomUUID()}.pdf`);
        try {
          temp.create({ overwrite: true });
          temp.write(bytes);
          await Sharing.shareAsync(temp.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Mở hoặc lưu biên bản bàn giao tài sản',
          });
        } finally {
          if (temp.exists) temp.delete();
        }
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message === 'Thiết bị không hỗ trợ mở hoặc lưu PDF.'
        ? failure.message : errorMessage(failure));
    } finally {
      setDownloadBusy(false);
    }
  }, [api, data, taskId, downloadBusy]);

  return (
    <Box>
      <Text variant="titleMedium">Biên bản bàn giao tài sản cơ sở</Text>
      <Button mode="text" icon="refresh" onPress={reload} disabled={query.loading || busy}>
        Tải lại biên bản
      </Button>
      {query.loading && <ActivityIndicator accessibilityLabel="Đang tải biên bản bàn giao" />}
      {!!query.error && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="alert" style={ui.red}>{query.error}</Text>
          <Button onPress={reload}>Tải lại biên bản</Button>
        </View>
      )}
      {!!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
      {!query.loading && !query.error && !data && (
        <Text style={ui.muted}>
          {taskStatus === 'PendingVerification'
            ? 'Đã nộp kết quả kiểm kê. Đang chờ Owner đối soát và lập biên bản.'
            : 'Biên bản xuất hiện sau khi Staff gửi kiểm kê và Owner đối soát.'}
        </Text>
      )}
      {data && (
        <View style={{ gap: 10 }}>
          <Text>Phiên bản: {data.revision} · {data.totalItems} mục tài sản</Text>
          <Text style={ui.muted}>
            Tự kiểm tra: {data.directItems} · Kế thừa bàn giao Tenant: {data.inheritedItems}
          </Text>
          <Text style={ui.muted}>Đã đối soát: {formatInstant(data.approvedAt)}</Text>
          <Text style={ui.muted}>Mã nội dung SHA-256: {data.snapshotSha256}</Text>
          {!!data.exceptionDecision && <Text>Quyết định Owner: {data.exceptionDecision}</Text>}
          <Button mode="outlined" disabled={downloadBusy} loading={downloadBusy}
            onPress={() => void download()}>
            Xem / lưu biên bản PDF
          </Button>
          {data.status === 'Superseded' && (
            <Text style={ui.red}>Biên bản đã bị thay thế do cập nhật dữ liệu. Liên hệ Owner để đối soát lại.</Text>
          )}
          {data.status === 'PendingOwnerSignature' && (
            <Text style={ui.muted}>Owner đang xem và ký xác nhận biên bản.</Text>
          )}
          {data.status === 'PendingStaffSignature' && (
            <>
              <Text style={ui.green}>
                Owner đã ký xác nhận. Staff cần kiểm tra PDF và cùng xác nhận nội dung đúng phiên bản.
              </Text>
              <Checkbox.Item
                label="Tôi đã xem PDF và đồng ý nhận bàn giao tài sản, trách nhiệm quản lý cơ sở"
                status={confirmed ? 'checked' : 'unchecked'}
                onPress={() => setConfirmedKey(confirmed ? null : signingKey)}
                disabled={busy || data.staffId !== session?.userId}
              />
              <Button mode="contained" disabled={!confirmed || busy ||
                data.staffId !== session?.userId} loading={busy}
                onPress={() => void sign()}>
                Staff ký xác nhận
              </Button>
            </>
          )}
          {data.ownerSignature && <Text style={ui.muted}>
            Owner đã ký: {formatInstant(data.ownerSignature.signedAt)}
          </Text>}
          {data.staffSignature && <Text style={ui.muted}>
            Staff đã ký: {formatInstant(data.staffSignature.signedAt)}
          </Text>}
          {data.status === 'Completed' && (
            <Text style={ui.green}>Hai bên đã ký. Biên bản bàn giao hoàn thành, có thể lưu PDF cuối cùng.</Text>
          )}
        </View>
      )}
    </Box>
  );
}
