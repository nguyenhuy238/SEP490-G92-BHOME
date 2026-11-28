import React, { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { errorMessage, MobileApiError, type MobileApi } from '../lib/api';
import { randomUUID } from '../lib/randomUUID';
import { useSession } from '../lib/SessionProvider';
import { colors } from '../theme/theme';
import {
  locationAssetHandoverArchiveClient,
  type LocationAssetHandoverArchiveListItem,
  type LocationAssetHandoverArchiveReport,
} from '../services/locationAssetHandover';

const archivePath = '/api/v1/location-asset-handovers/archive';
type SelectedReport = { taskId: string; revision: number };

async function saveSignedPdf(api: MobileApi, selected: SelectedReport) {
  const client = locationAssetHandoverArchiveClient(api);
  if (Platform.OS === 'web') {
    const blob = await client.documentBlob(selected.taskId, selected.revision);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bien-ban-ban-giao-' + selected.taskId + '-v' + selected.revision + '.pdf';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const Sharing = await import('expo-sharing');
  const { Directory, File, Paths } = await import('expo-file-system');
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Thiết bị không hỗ trợ mở hoặc lưu PDF.');
  const bytes = await client.documentBytes(selected.taskId, selected.revision);
  const folder = new Directory(Paths.cache, 'bhome-signed-handover-archive');
  folder.create({ idempotent: true, intermediates: true });
  const temp = new File(folder, randomUUID() + '.pdf');
  try {
    temp.create({ overwrite: true });
    temp.write(bytes);
    await Sharing.shareAsync(temp.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Mở hoặc lưu biên bản bàn giao đã ký',
    });
  } finally {
    if (temp.exists) temp.delete();
  }
}

function ArchiveCard({
  report,
  onOpen,
}: {
  report: LocationAssetHandoverArchiveListItem;
  onOpen: (value: SelectedReport) => void;
}) {
  return (
    <TouchableRipple
      accessibilityRole="button"
      accessibilityLabel={`Xem biên bản: ${report.locationName}`}
      onPress={() => onOpen({ taskId: report.taskId, revision: report.revision })}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.white,
        overflow: 'hidden',
      }}
    >
      <View style={{ gap: 4, padding: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="titleMedium" style={{ flex: 1 }}>
            {report.locationName}
          </Text>
          <Pill tone="green">Đã ký đầy đủ</Pill>
        </View>
        {!!report.address && (
          <Text variant="bodySmall" style={ui.muted}>
            {report.address}
          </Text>
        )}
        <Text variant="bodySmall" style={ui.muted}>
          {report.totalItems} nhóm tài sản
        </Text>
        <Text variant="bodySmall" style={ui.muted}>
          {formatInstant(report.approvedAt)} · {report.directItems} mục Staff kiểm tra ·{' '}
          {report.inheritedItems} mục kế thừa từ Tenant
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}
        >
          <Text variant="labelMedium" style={{ color: colors.blue }}>
            Xem biên bản
          </Text>
          <Icon source="chevron-right" size={18} color={colors.blue} />
        </View>
      </View>
    </TouchableRipple>
  );
}

export function StaffHandoverArchiveScreen() {
  const { api } = useSession();
  const [selected, setSelected] = useState<SelectedReport | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const list = useWorkspaceQuery<LocationAssetHandoverArchiveListItem[]>(archivePath, {
    notifyError: false,
  });
  const detailPath = selected
    ? archivePath + '/' + selected.taskId + '/revisions/' + selected.revision
    : null;
  const detail = useWorkspaceQuery<LocationAssetHandoverArchiveReport>(detailPath, {
    notifyError: false,
  });
  const reloadList = list.reload;
  const reloadDetail = detail.reload;
  const refresh = useCallback(() => {
    reloadList();
    if (selected) reloadDetail();
  }, [reloadList, reloadDetail, selected]);
  const inHeader = useWorkspaceHeaderRefresh(refresh, list.loading || detail.loading);
  const report = detail.data?.report;

  const download = useCallback(async () => {
    if (!api || !selected || downloadBusy) return;
    setDownloadBusy(true);
    setActionError('');
    try {
      await saveSignedPdf(api, selected);
    } catch (failure) {
      setActionError(
        failure instanceof MobileApiError
          ? errorMessage(failure)
          : failure instanceof Error
            ? failure.message
            : errorMessage(failure),
      );
    } finally {
      setDownloadBusy(false);
    }
  }, [api, selected, downloadBusy]);

  return (
    <View style={{ gap: 12 }}>
      {!inHeader && (
        <Heading
          title="Biên bản bàn giao đã ký"
          detail="Chỉ hiển thị biên bản bạn đã ký nhận đầy đủ."
          action="Tải lại"
          onPress={refresh}
        />
      )}
      {selected ? (
        <>
          <Button
            icon="arrow-left"
            mode="text"
            onPress={() => {
              setSelected(null);
              setActionError('');
            }}
          >
            Quay lại danh sách
          </Button>
          {detail.loading && <ActivityIndicator accessibilityLabel="Đang tải biên bản đã ký" />}
          {!!detail.error && (
            <Box>
              <Text accessibilityRole="alert" style={ui.red}>
                {detail.error}
              </Text>
              <Button onPress={detail.reload}>Thử tải lại</Button>
            </Box>
          )}
          {report && (
            <>
              <Box>
                <Heading
                  title={report.locationName}
                  detail={report.address || 'Biên bản bàn giao tài sản cơ sở'}
                />
                <Pill tone="green">Đã ký đầy đủ</Pill>
                <Text>{report.totalItems} nhóm tài sản</Text>
                <Text style={ui.muted}>
                  Owner ký: {formatInstant(report.ownerSignature.signedAt)}
                </Text>
                <Text style={ui.muted}>
                  Bạn ký nhận: {formatInstant(report.staffSignature.signedAt)}
                </Text>
                {!!report.exceptionDecision && (
                  <Text>Ghi chú quyết định của Owner: {report.exceptionDecision}</Text>
                )}
                <Button
                  mode="contained"
                  icon="file-pdf-box"
                  loading={downloadBusy}
                  disabled={downloadBusy}
                  onPress={() => void download()}
                >
                  Mở hoặc lưu PDF đã ký
                </Button>
                {!!actionError && (
                  <Text accessibilityRole="alert" style={ui.red}>
                    {actionError}
                  </Text>
                )}
              </Box>
              <Heading
                title="Tài sản trong biên bản"
                detail={detail.data!.items.length + ' nhóm tài sản đã ghi nhận'}
              />
              {detail.data!.items.map((item) => (
                <Box key={item.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text variant="titleSmall" style={{ flex: 1 }}>
                      {item.name}
                    </Text>
                    <Pill tone={item.inherited ? 'neutral' : 'blue'}>
                      {item.inherited ? 'Kế thừa từ Tenant' : 'Staff kiểm tra'}
                    </Pill>
                  </View>
                  <Text style={ui.muted}>
                    {item.scope} · Số lượng: {item.quantity}
                  </Text>
                  <Text>
                    Hiện trạng:{' '}
                    {item.condition === 'Intact'
                      ? 'Đủ, còn tốt'
                      : item.condition === 'Missing'
                        ? 'Thiếu'
                        : item.condition === 'Damaged'
                          ? 'Hư hỏng'
                          : item.condition === 'NotAccessible'
                            ? 'Không thể tiếp cận'
                            : 'Chưa đánh giá'}
                  </Text>
                  {!!item.note && <Text style={ui.muted}>{item.note}</Text>}
                </Box>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          {list.loading && <ActivityIndicator accessibilityLabel="Đang tải danh sách biên bản" />}
          {!!list.error && (
            <Box>
              <Text accessibilityRole="alert" style={ui.red}>
                {list.error}
              </Text>
              <Button onPress={list.reload}>Thử tải lại</Button>
            </Box>
          )}
          {!!list.data?.length &&
            list.data.map((item) => (
              <ArchiveCard
                key={item.taskId + ':' + item.revision}
                report={item}
                onOpen={setSelected}
              />
            ))}
          {!list.loading && !list.error && !list.data?.length && (
            <Box>
              <Text variant="titleMedium">Chưa có biên bản đã ký</Text>
              <Text style={ui.muted}>
                Biên bản sẽ xuất hiện ở đây sau khi Owner và bạn cùng ký một phiên bản.
              </Text>
            </Box>
          )}
        </>
      )}
    </View>
  );
}
