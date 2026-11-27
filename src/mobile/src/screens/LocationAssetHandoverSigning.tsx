import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import type { DrawnSignature } from '../../../../packages/client-core/src/signing';
import { Box, Pill, ui } from '../components/WorkspaceKit';
import { SignaturePad } from '../features/contracts/SignaturePad';
import { previewPngUri } from '../features/contracts/pdfPreview';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { errorMessage, MobileApiError, type MobileApi } from '../lib/api';
import { queryPolicies } from '../lib/queryPolicies';
import { randomUUID } from '../lib/randomUUID';
import { useSession } from '../lib/SessionProvider';
import { showSuccess } from '../lib/toast';
import {
  locationAssetHandoverClient,
  type LocationAssetHandoverDocumentPreview,
  type LocationAssetHandoverReport,
} from '../services/locationAssetHandover';

const loadReport = async (api: MobileApi, path: string, signal: AbortSignal) => {
  try {
    return await api.request<LocationAssetHandoverReport>(path, { signal });
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 404) return null;
    throw error;
  }
};

function HandoverInlinePdfPreview({ api, taskId }: { api: MobileApi; taskId: string }) {
  const { width } = useWindowDimensions();
  const [infoResult, setInfoResult] = useState<{
    request: number;
    info: LocationAssetHandoverDocumentPreview | null;
    error: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageResult, setPageResult] = useState<{ key: string; uri: string; error: string } | null>(
    null,
  );
  const [reload, setReload] = useState(0);
  const [zoom, setZoom] = useState(1);
  const currentInfo = infoResult?.request === reload ? infoResult : null;
  const info = currentInfo?.info ?? null;
  const loadingInfo = !currentInfo;
  const error = currentInfo?.error ?? '';
  const pageKey = info ? `${reload}:${info.documentSha256}:${page}` : '';
  const currentPage = pageResult?.key === pageKey ? pageResult : null;
  const loadingPage = !!info && !currentPage;
  const uri = currentPage?.uri ?? '';
  const pageError = currentPage?.error ?? '';
  const retry = () => {
    setPage(1);
    setReload((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    void locationAssetHandoverClient(api)
      .documentPreview(taskId, controller.signal)
      .then((result) => {
        if (
          !Number.isSafeInteger(result.pageCount) ||
          result.pageCount < 1 ||
          !/^[a-f0-9]{64}$/i.test(result.documentSha256)
        )
          throw new Error('Thông tin bản xem trước PDF không hợp lệ.');
        if (!controller.signal.aborted) setInfoResult({ request: reload, info: result, error: '' });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setInfoResult({ request: reload, info: null, error: errorMessage(failure) });
      });
    return () => controller.abort();
  }, [api, taskId, reload]);

  useEffect(() => {
    if (!info) return;
    const controller = new AbortController();
    void locationAssetHandoverClient(api)
      .documentPage(taskId, page, controller.signal)
      .then((bytes) => {
        try {
          if (controller.signal.aborted) return;
          const imageUri = previewPngUri(bytes);
          if (!controller.signal.aborted) setPageResult({ key: pageKey, uri: imageUri, error: '' });
        } catch (failure) {
          if (!controller.signal.aborted)
            setPageResult({ key: pageKey, uri: '', error: errorMessage(failure) });
        } finally {
          bytes.fill(0);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setPageResult({ key: pageKey, uri: '', error: errorMessage(failure) });
      });
    return () => controller.abort();
  }, [api, taskId, info, page, pageKey]);

  const pageWidth = Math.max(240, Math.min(width - 64, 680)) * zoom;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleSmall">Xem trước biên bản PDF</Text>
      {loadingInfo && <ActivityIndicator accessibilityLabel="Đang tải thông tin bản PDF" />}
      {!!error && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
          <Button onPress={retry}>Tải lại bản xem trước</Button>
        </View>
      )}
      {info && (
        <>
          <Text style={ui.muted}>
            Trang {page}/{info.pageCount}
          </Text>
          {loadingPage && (
            <ActivityIndicator accessibilityLabel={`Đang tải trang ${page} của PDF`} />
          )}
          {!!pageError && (
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="alert" style={ui.red}>
                {pageError}
              </Text>
              <Button onPress={retry}>Tải lại trang PDF</Button>
            </View>
          )}
          {!!uri && (
            <ScrollView
              horizontal
              nestedScrollEnabled
              contentContainerStyle={{ paddingVertical: 4 }}
            >
              <Image
                source={{ uri }}
                accessibilityLabel={`Trang ${page} của biên bản bàn giao tài sản`}
                resizeMode="contain"
                onError={() => {
                  setPageResult({
                    key: pageKey,
                    uri: '',
                    error: 'Thiết bị không hiển thị được trang PDF này. Vui lòng tải lại.',
                  });
                }}
                style={{ width: pageWidth, height: pageWidth * 1.414, backgroundColor: '#fff' }}
              />
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Button disabled={page <= 1} onPress={() => setPage((value) => value - 1)}>
              Trang trước
            </Button>
            <Button disabled={page >= info.pageCount} onPress={() => setPage((value) => value + 1)}>
              Trang tiếp
            </Button>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Button
              disabled={zoom <= 1}
              onPress={() => setZoom((value) => Math.max(1, value - 0.5))}
            >
              Thu nhỏ
            </Button>
            <Text style={ui.muted}>{Math.round(zoom * 100)}%</Text>
            <Button
              disabled={zoom >= 2}
              onPress={() => setZoom((value) => Math.min(2, value + 0.5))}
            >
              Phóng to
            </Button>
          </View>
        </>
      )}
    </View>
  );
}

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
    { load: loadReport, cache: queryPolicies.tasks, notifyError: false },
  );
  const data = query.error ? null : query.data;
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [inkState, setInkState] = useState<{ key: string; value: DrawnSignature | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const reload = query.reload;
  const previousTaskStatus = useRef(taskStatus);
  useEffect(() => {
    if (previousTaskStatus.current !== taskStatus) {
      previousTaskStatus.current = taskStatus;
      reload();
    }
  }, [reload, taskStatus]);
  const signingKey = data
    ? `${taskId}:${data.revision}:${data.snapshotSha256}:${data.pdfSha256}:${data.status}:${data.staffId}`
    : '';
  const confirmed = !!signingKey && confirmedKey === signingKey;
  const ink = inkState?.key === signingKey ? inkState.value : null;

  const sign = useCallback(async () => {
    if (
      !api ||
      !data ||
      !confirmed ||
      !ink ||
      lock.current ||
      query.fetching ||
      taskStatus !== 'PendingVerification' ||
      data.status !== 'PendingStaffSignature' ||
      !session?.roles.includes('Staff') ||
      data.staffId !== session?.userId
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await locationAssetHandoverClient(api).sign(taskId, data, ink);
      setConfirmedKey(null);
      setInkState(null);
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
  }, [
    api,
    data,
    confirmed,
    ink,
    taskId,
    taskStatus,
    query.fetching,
    session?.userId,
    session?.roles,
    reload,
    onTaskRefresh,
  ]);

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
      setError(
        failure instanceof Error && failure.message === 'Thiết bị không hỗ trợ mở hoặc lưu PDF.'
          ? failure.message
          : errorMessage(failure),
      );
    } finally {
      setDownloadBusy(false);
    }
  }, [api, data, taskId, downloadBusy]);

  const canSign =
    !!data &&
    taskStatus === 'PendingVerification' &&
    data.status === 'PendingStaffSignature' &&
    !!session?.roles.includes('Staff') &&
    data.staffId === session.userId;

  // The signing panel is a later workflow step. Do not show an empty card
  // while Staff is still working through the room checklist.
  if (!query.loading && !query.error && !data && taskStatus !== 'PendingVerification') return null;

  return (
    <Box>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="titleMedium" style={{ flex: 1, minWidth: 0 }}>
          Biên bản bàn giao
        </Text>
        {!query.error && (data || taskStatus === 'PendingVerification') && (
          <Button
            compact
            mode="text"
            icon="refresh"
            onPress={reload}
            disabled={query.fetching || busy}
          >
            Tải lại
          </Button>
        )}
      </View>
      {query.loading && taskStatus === 'PendingVerification' && (
        <ActivityIndicator accessibilityLabel="Đang tải biên bản bàn giao" />
      )}
      {!!query.error && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="alert" style={ui.red}>
            {query.error}
          </Text>
          <Button onPress={reload}>Tải lại biên bản</Button>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {!query.loading && !query.error && !data && (
        <Text style={ui.muted}>Đã gửi kiểm kê. Đang chờ Owner đối soát và lập biên bản.</Text>
      )}
      {data && (
        <View style={{ gap: 8 }}>
          <View style={{ gap: 4 }}>
            <Text>{data.totalItems} mục tài sản</Text>
            <Text style={ui.muted}>
              {data.directItems} Staff kiểm tra · {data.inheritedItems} kế thừa Tenant
            </Text>
          </View>
          <Pill
            tone={
              data.status === 'Completed'
                ? 'green'
                : data.status === 'Superseded'
                  ? 'red'
                  : data.status === 'PendingStaffSignature'
                    ? 'amber'
                    : 'blue'
            }
          >
            {data.status === 'PendingOwnerSignature'
              ? 'Chờ Owner ký'
              : data.status === 'PendingStaffSignature'
                ? 'Chờ bạn ký nhận'
                : data.status === 'Completed'
                  ? 'Đã hoàn tất'
                  : 'Đã được thay thế'}
          </Pill>
          <Text style={ui.muted}>Đối soát: {formatInstant(data.approvedAt)}</Text>
          {!!data.exceptionDecision && (
            <Text style={ui.muted}>Quyết định của Owner: {data.exceptionDecision}</Text>
          )}
          {data.status === 'Superseded' && (
            <Text style={ui.red}>
              Biên bản này đã bị thay thế do công việc hoặc phân công thay đổi. Không ký bản cũ;
              tiếp tục checklist hiện tại.
            </Text>
          )}
          {data.status === 'PendingOwnerSignature' && (
            <Text style={ui.muted}>Owner đã đối soát. Đang chờ Owner ký xác nhận.</Text>
          )}
          {api && data.status !== 'Superseded' && (
            <HandoverInlinePdfPreview key={signingKey} api={api} taskId={taskId} />
          )}
          {data.status === 'PendingStaffSignature' && (
            <>
              <Text style={ui.green}>
                Owner đã ký. Kiểm tra bản xem trước PDF và ký nhận bên dưới.
              </Text>
              <Button
                mode="outlined"
                disabled={downloadBusy}
                loading={downloadBusy}
                onPress={() => void download()}
              >
                Mở bản PDF để đối chiếu
              </Button>
              {canSign ? (
                <>
                  <Text variant="titleSmall">Chữ ký của Staff</Text>
                  <SignaturePad
                    key={signingKey}
                    onChange={(drawing) => setInkState({ key: signingKey, value: drawing })}
                    disabled={busy}
                  />
                  <Checkbox.Item
                    label="Tôi đã đọc PDF và đồng ý ký nhận bàn giao."
                    status={confirmed ? 'checked' : 'unchecked'}
                    onPress={() => setConfirmedKey(confirmed ? null : signingKey)}
                    disabled={busy}
                  />
                  <Button
                    mode="contained"
                    disabled={!confirmed || !ink || busy || query.fetching}
                    loading={busy}
                    onPress={() => void sign()}
                  >
                    Ký và xác nhận bàn giao
                  </Button>
                </>
              ) : (
                <Text style={ui.muted}>Chỉ Staff được ghi trên biên bản mới có thể ký nhận.</Text>
              )}
            </>
          )}
          {data.ownerSignature && (
            <Text style={ui.muted}>Owner đã ký: {formatInstant(data.ownerSignature.signedAt)}</Text>
          )}
          {data.staffSignature && (
            <Text style={ui.muted}>Staff đã ký: {formatInstant(data.staffSignature.signedAt)}</Text>
          )}
          {data.status === 'Completed' && (
            <>
              <Text style={ui.green}>Owner và Staff đã ký cùng phiên bản. Bàn giao hoàn tất.</Text>
              {data.canDownloadFinal ? (
                <Button
                  mode="outlined"
                  disabled={downloadBusy}
                  loading={downloadBusy}
                  onPress={() => void download()}
                >
                  Lưu biên bản PDF đã ký
                </Button>
              ) : (
                <Text accessibilityRole="alert" style={ui.red}>
                  Chưa có tệp PDF cuối đã ký. Vui lòng tải lại biên bản hoặc báo Owner kiểm tra.
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </Box>
  );
}
