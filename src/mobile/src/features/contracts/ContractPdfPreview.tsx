import React, { useEffect, useState } from 'react';
import {
  AppState,
  FlatList,
  Image,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, Text } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { PreviewDocument } from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type DraftPreviewInfo,
  type DraftPreviewPage,
  type mainDraftClient,
} from '../../../../../packages/client-core/src/mainDrafts';
import { ToastHost } from '../../components/ToastHost';
import { showError } from '../../lib/toast';
import { colors as c } from '../../theme/theme';
import { previewError, previewPngUri, validPreviewInfo } from './pdfPreview';

type Client = ReturnType<typeof mainDraftClient>;

function PdfPage({
  client,
  contractId,
  fileId,
  page,
  width,
  active,
}: {
  client: Client;
  contractId: string;
  fileId: string;
  page: DraftPreviewPage;
  width: number;
  active: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const key = `${contractId}/${fileId}/${page.number}/${revision}`;
  const [result, setResult] = useState<{
    client: Client;
    key: string;
    uri: string;
    error: string;
  } | null>(null);
  const current = active && result?.client === client && result.key === key ? result : null;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void client.previewPage(contractId, fileId, page.number, controller.signal).then(
      (bytes) => {
        try {
          if (!controller.signal.aborted)
            setResult({ client, key, uri: previewPngUri(bytes), error: '' });
        } catch (error) {
          if (!controller.signal.aborted) {
            const message = previewError(error);
            setResult({ client, key, uri: '', error: message });
            showError(message);
          }
        } finally {
          bytes.fill(0);
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          const message = previewError(error);
          setResult({ client, key, uri: '', error: message });
          showError(message);
        }
      },
    );
    return () => controller.abort();
  }, [client, contractId, fileId, page.number, key, active]);
  const height = (width * page.height) / page.width;
  return (
    <View style={{ width, minHeight: current?.error ? undefined : Math.min(height, 240), gap: 8 }}>
      {!current && (
        <View style={[styles.loadingPage, { height }]}>
          <ActivityIndicator accessibilityLabel={`Đang tải trang ${page.number}`} />
          <Text>Đang tải trang {page.number}…</Text>
        </View>
      )}
      {!!current?.error && (
        <View style={styles.pageError}>
          <Text accessibilityRole="alert">{current.error}</Text>
          <Button icon="reload" onPress={() => setRevision((value) => value + 1)}>
            Tải lại trang {page.number}
          </Button>
        </View>
      )}
      {!!current?.uri && (
        <Image
          source={{ uri: current.uri }}
          accessibilityLabel={`Trang ${page.number} của hợp đồng PDF`}
          resizeMode="contain"
          style={{ width, height, backgroundColor: c.white }}
          onError={() =>
            setResult({
              client,
              key,
              uri: '',
              error: 'Thiết bị chưa hiển thị được trang này. Hãy tải lại hoặc mở PDF bên ngoài.',
            })
          }
        />
      )}
    </View>
  );
}

export function ContractPdfPreview({
  client,
  contractId,
  document,
  busy,
  previewErrorCode,
  onRegenerate,
  onOpenPdf,
  onOpenDocx,
  hasDocx,
}: {
  client: Client;
  contractId: string;
  document: PreviewDocument | null;
  busy: boolean;
  previewErrorCode: string | null;
  onRegenerate: () => void;
  onOpenPdf: () => void;
  onOpenDocx: () => void;
  hasDocx: boolean;
}) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(240, Math.min(window.width - 56, 664)));
  const [revision, setRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState(true);
  const fileId = document?.id ?? '';
  const key = `${contractId}/${fileId}/${revision}`;
  const [result, setResult] = useState<{
    client: Client;
    key: string;
    info: DraftPreviewInfo | null;
    error: string;
  } | null>(null);
  const current = active && result?.client === client && result.key === key ? result : null;
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const foreground = state === 'active';
      setActive(foreground);
      if (!foreground) {
        setResult(null);
        setFullscreen(false);
      }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!fileId || !active) return;
    const controller = new AbortController();
    void client.previewInfo(contractId, fileId, controller.signal).then(
      (info) => {
        if (controller.signal.aborted) return;
        if (!validPreviewInfo(info, fileId)) {
          setResult({
            client,
            key,
            info: null,
            error: 'Bản xem trước không hợp lệ. Hãy tải lại tài liệu.',
          });
          showError('Bản xem trước không hợp lệ. Hãy tải lại tài liệu.');
          return;
        }
        setResult({ client, key, info, error: '' });
      },
      (error) => {
        if (!controller.signal.aborted) {
          const message = previewError(error);
          setResult({ client, key, info: null, error: message });
          showError(message);
        }
      },
    );
    return () => controller.abort();
  }, [client, contractId, fileId, key, active]);
  const info = current?.info;
  const viewport = Math.max(240, window.width - 24);
  const pageWidth = Math.min(viewport, 760) * zoom;
  const openFullscreen = () => {
    Keyboard.dismiss();
    setZoom(1);
    setFullscreen(true);
  };
  const error = fileId
    ? current?.error
    : busy
      ? ''
      : previewErrorCode
        ? (mainDraftMessages[previewErrorCode] ??
          'Chưa tạo được PDF. Bản nháp và DOCX vẫn được giữ.')
        : 'Bản PDF chưa được tạo. Hãy tạo lại tài liệu để xem trước.';
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Icon source="file-pdf-box" color={c.blue} size={24} />
        <View style={styles.grow}>
          <Text style={styles.title}>Bản hợp đồng PDF</Text>
          <Text style={styles.muted}>
            {info
              ? `${info.pages.length} trang · Mở rộng để đọc`
              : 'Tài liệu được tạo từ thông tin đã lưu'}
          </Text>
        </View>
        <IconButton
          icon="arrow-expand"
          accessibilityLabel="Xem toàn màn hình"
          accessibilityHint="Đọc tất cả các trang và phóng to hợp đồng"
          disabled={!info || busy}
          onPress={openFullscreen}
          style={{ width: 44, height: 44, margin: 0 }}
        />
      </View>
      <View
        onLayout={(event) => {
          if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width);
        }}
      >
        {!fileId && busy && (
          <View style={styles.message}>
            <ActivityIndicator />
            <Text>Đang tạo tài liệu…</Text>
          </View>
        )}
        {!fileId && !busy && !error && <Text style={styles.muted}>Bản PDF chưa được tạo.</Text>}
        {!!fileId && !current && (
          <View style={styles.message}>
            <ActivityIndicator accessibilityLabel="Đang tải bản xem trước PDF" />
            <Text>Đang tải bản xem trước…</Text>
          </View>
        )}
        {!!error && (
          <View style={styles.message}>
            <Text accessibilityRole="alert" style={{ color: c.red }}>
              {error}
            </Text>
            <Button
              mode="outlined"
              icon="reload"
              disabled={busy}
              onPress={() => (fileId ? setRevision((value) => value + 1) : onRegenerate())}
            >
              Thử lại bản xem trước
            </Button>
          </View>
        )}
        {info && !fullscreen && (
          <>
            <PdfPage
              key={`${key}/inline`}
              client={client}
              contractId={contractId}
              fileId={fileId}
              page={info.pages[0]!}
              width={width}
              active={active}
            />
            <Text style={styles.pageNumber}>Trang 1 / {info.pages.length}</Text>
          </>
        )}
      </View>
      <View style={styles.actions}>
        <Button
          compact
          contentStyle={{ minHeight: 44 }}
          icon="download"
          disabled={!fileId || busy}
          onPress={onOpenPdf}
        >
          Tải hoặc mở PDF
        </Button>
        <Button
          compact
          contentStyle={{ minHeight: 44 }}
          icon="file-word-outline"
          disabled={!hasDocx || busy}
          onPress={onOpenDocx}
        >
          Mở hoặc lưu DOCX
        </Button>
      </View>
      {fullscreen && info && (
        <Modal
          visible
          presentationStyle="fullScreen"
          animationType="slide"
          onRequestClose={() => setFullscreen(false)}
        >
          <SafeAreaProvider>
            <SafeAreaView style={styles.fullscreen} edges={['top', 'bottom', 'left', 'right']}>
              <View style={styles.toolbar}>
                <IconButton
                  icon="close"
                  accessibilityLabel="Đóng xem toàn màn hình"
                  onPress={() => setFullscreen(false)}
                />
                <View style={styles.grow}>
                  <Text style={styles.title}>Hợp đồng nháp</Text>
                  <Text style={styles.muted}>
                    {info.pages.length} trang · {Math.round(zoom * 100)}%
                  </Text>
                </View>
                <IconButton
                  icon="minus"
                  accessibilityLabel="Thu nhỏ hợp đồng"
                  disabled={zoom <= 1}
                  onPress={() => setZoom((value) => Math.max(1, value - 0.5))}
                />
                <IconButton
                  icon="plus"
                  accessibilityLabel="Phóng to hợp đồng"
                  disabled={zoom >= 3}
                  onPress={() => setZoom((value) => Math.min(3, value + 0.5))}
                />
              </View>
              <FlatList
                style={styles.grow}
                data={info.pages}
                keyExtractor={(page) => `${fileId}/${page.number}`}
                extraData={zoom}
                initialNumToRender={1}
                maxToRenderPerBatch={1}
                windowSize={3}
                contentContainerStyle={styles.pages}
                renderItem={({ item }) => (
                  <View style={styles.page}>
                    <Text style={styles.pageNumber}>
                      Trang {item.number} / {info.pages.length}
                    </Text>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      contentContainerStyle={{ minWidth: viewport, justifyContent: 'center' }}
                    >
                      <PdfPage
                        client={client}
                        contractId={contractId}
                        fileId={fileId}
                        page={item}
                        width={pageWidth}
                        active={active}
                      />
                    </ScrollView>
                  </View>
                )}
              />
            </SafeAreaView>
            <ToastHost modal />
          </SafeAreaProvider>
        </Modal>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    gap: 16,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  title: { color: c.ink, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  muted: { color: '#475569', fontSize: 12, lineHeight: 18 },
  message: { paddingVertical: 20, gap: 12, alignItems: 'center' },
  actions: { gap: 4, alignItems: 'stretch' },
  loadingPage: {
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  pageError: { padding: 16, gap: 12, backgroundColor: '#FFF1F0' },
  pageNumber: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 8,
  },
  fullscreen: { flex: 1, backgroundColor: c.background },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  pages: { paddingVertical: 16, paddingHorizontal: 12, gap: 16 },
  page: { gap: 4 },
});
