import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { ContractNotice } from './ContractNotice';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { acquirePrivatePhotoThumbnail } from '../../lib/privatePhotoThumbnails';
import { contractPdfName } from '../../../../../packages/client-core/src/contractPdfName';
import { deliverWebDocument, openPdfWindow } from './webContractDocument';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';

function finalReadingAccessError(cause: unknown): string {
  const status = (cause as { status?: number } | null)?.status;
  if (status === 401) return 'Vui lòng đăng nhập lại để xem ảnh công tơ chốt.';
  if (status === 403) return 'Tài khoản không có quyền xem ảnh công tơ chốt của hợp đồng này.';
  return contractError(cause);
}

export function ContractEvidence({
  api,
  contractId,
  evidenceId,
  previewId,
  handover = false,
  readingId,
  pdf = false,
  contractKind,
  number,
  label,
  handoverDocumentId,
  draftHandoverPdf = false,
  draftHandoverEvidence = false,
  finalMeterReading = false,
  assetChangeId,
  thumbnail = false,
  thumbnailHeight = 110,
  localThumbnailUri,
}: {
  api: ContractClient;
  contractId: string;
  evidenceId?: string;
  previewId?: string;
  handover?: boolean;
  readingId?: string;
  pdf?: boolean;
  contractKind?: string;
  number?: number;
  label?: string;
  handoverDocumentId?: string;
  draftHandoverPdf?: boolean;
  draftHandoverEvidence?: boolean;
  /** Final move-out meter evidence is verified against this contract (Tenant-safe). */
  finalMeterReading?: boolean;
  assetChangeId?: string;
  thumbnail?: boolean;
  thumbnailHeight?: number;
  localThumbnailUri?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false),
    [previewUri, setPreviewUri] = useState(''),
    [thumbnailState, setThumbnailState] = useState({ key: '', uri: '', error: '' });
  const thumbnailKey = `${contractId}:${evidenceId ?? ''}:${readingId ?? ''}:${draftHandoverEvidence}:${finalMeterReading}`;
  const thumbnailUri =
    localThumbnailUri || (thumbnailState.key === thumbnailKey ? thumbnailState.uri : '');
  const thumbnailError = thumbnailState.key === thumbnailKey ? thumbnailState.error : '';
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null),
    previewUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (!thumbnail || localThumbnailUri || !(evidenceId || readingId)) return;
    let active = true;
    const path = `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId ?? '')}`;
    const source = readingId
      ? finalMeterReading
        ? 'final-meter'
        : 'handover-meter'
      : draftHandoverEvidence
        ? 'draft-handover'
        : 'contract-evidence';
    const photo = acquirePrivatePhotoThumbnail(
      api,
      `${source}:${contractId}:${readingId ?? evidenceId}`,
      (signal) => {
        if (Platform.OS === 'web')
          return readingId
            ? finalMeterReading
              ? api.moveOutMeterEvidence(contractId, readingId, signal)
              : api.handoverMeterEvidence(contractId, readingId, signal)
            : draftHandoverEvidence
              ? api.transport<Blob>(path, { signal }, 'blob')
              : api.evidence(contractId, evidenceId!, signal);
        return readingId
          ? finalMeterReading
            ? api.moveOutMeterEvidenceBytes(contractId, readingId, signal)
            : api.handoverMeterEvidenceBytes(contractId, readingId, signal)
          : draftHandoverEvidence
            ? api.transport<Uint8Array<ArrayBuffer>>(path, { signal }, 'bytes')
            : api.evidenceBytes(contractId, evidenceId!, signal);
      },
    );
    void photo.uri.then(
      (uri) => {
        if (active) setThumbnailState({ key: thumbnailKey, uri, error: '' });
      },
      (cause) => {
        if (active)
          setThumbnailState({
            key: thumbnailKey,
            uri: '',
            error:
              finalMeterReading && !(cause instanceof UserFeedbackError)
                ? finalReadingAccessError(cause)
                : cause instanceof UserFeedbackError
                  ? cause.message
                  : contractError(cause),
          });
      },
    );
    return () => {
      active = false;
      photo.release();
    };
  }, [
    api,
    contractId,
    evidenceId,
    draftHandoverEvidence,
    finalMeterReading,
    thumbnail,
    thumbnailKey,
    localThumbnailUri,
    readingId,
  ]);
  function closePreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreviewUri('');
  }
  async function showDraftImage() {
    if (Platform.OS !== 'web' || !draftHandoverEvidence || !evidenceId || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      // Authorize on every preview; never embed or expose an object-storage URL.
      const blob = await api.transport<Blob>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId)}`,
        { signal: controller.signal },
        'blob',
      );
      if (controller.signal.aborted) return;
      const magic = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => magic[i] === byte);
      const jpeg = magic[0] === 255 && magic[1] === 216 && magic[2] === 255;
      if (!png && !jpeg)
        throw new UserFeedbackError('Tệp ảnh bằng chứng không phải PNG hoặc JPEG hợp lệ.');
      const url = URL.createObjectURL(new Blob([blob], { type: png ? 'image/png' : 'image/jpeg' }));
      if (controller.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      closePreview();
      previewUrl.current = url;
      setPreviewUri(url);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof UserFeedbackError ? cause.message : contractError(cause));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function download(view = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    let temporary: File | null = null;
    let tab: Window | null = null;
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (Platform.OS === 'web') {
        if (view && pdf) tab = openPdfWindow();
        const blob = draftHandoverEvidence
          ? await api.transport<Blob>(
              `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId!)}`,
              { signal: controller.signal },
              'blob',
            )
          : draftHandoverPdf
            ? await api.transport<Blob>(
                `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/pdf`,
                { signal: controller.signal },
                'blob',
              )
            : handoverDocumentId
              ? await api.handoverDocument(contractId, handoverDocumentId, controller.signal)
              : assetChangeId
                ? await api.assetChangeEvidence(
                    contractId,
                    assetChangeId,
                    evidenceId!,
                    controller.signal,
                  )
                : readingId
                  ? finalMeterReading
                    ? await api.moveOutMeterEvidence(contractId, readingId, controller.signal)
                    : await api.handoverMeterEvidence(contractId, readingId, controller.signal)
                  : handover
                    ? await api.handoverEvidence(contractId, evidenceId!, controller.signal)
                    : previewId
                      ? await api.preview(contractId, previewId, controller.signal)
                      : pdf
                        ? await api.document(contractId, controller.signal)
                        : await api.evidence(contractId, evidenceId!, controller.signal);
        if (controller.signal.aborted) {
          tab?.close();
          return;
        }
        if (pdf && !draftHandoverPdf && !handoverDocumentId) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          try {
            if (controller.signal.aborted) {
              tab?.close();
              return;
            }
            deliverWebDocument(bytes, true, contractPdfName(contractKind, contractId), tab);
          } finally {
            bytes.fill(0);
          }
          return;
        }
        const url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download =
          draftHandoverPdf || handoverDocumentId
            ? 'bien-ban-ban-giao.pdf'
            : pdf
              ? contractPdfName(contractKind, contractId)
              : 'hien-trang.jpg';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          setError('Thiết bị chưa hỗ trợ mở hoặc lưu tài liệu.');
          return;
        }
        const bytes = draftHandoverEvidence
          ? await api.transport<Uint8Array>(
              `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId!)}`,
              { signal: controller.signal },
              'bytes',
            )
          : draftHandoverPdf
            ? await api.transport<Uint8Array>(
                `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/pdf`,
                { signal: controller.signal },
                'bytes',
              )
            : handoverDocumentId
              ? await api.handoverDocumentBytes(contractId, handoverDocumentId, controller.signal)
              : assetChangeId
                ? await api.assetChangeEvidenceBytes(
                    contractId,
                    assetChangeId,
                    evidenceId!,
                    controller.signal,
                  )
                : readingId
                  ? finalMeterReading
                    ? await api.moveOutMeterEvidenceBytes(contractId, readingId, controller.signal)
                    : await api.handoverMeterEvidenceBytes(contractId, readingId, controller.signal)
                  : handover
                    ? await api.handoverEvidenceBytes(contractId, evidenceId!, controller.signal)
                    : previewId
                      ? await api.previewBytes(contractId, previewId, controller.signal)
                      : pdf
                        ? await api.documentBytes(contractId, controller.signal)
                        : await api.evidenceBytes(contractId, evidenceId!, controller.signal);
        if (controller.signal.aborted) return;
        const directory = new Directory(Paths.cache, 'bhome-contract-downloads');
        directory.create({ idempotent: true, intermediates: true });
        // Unpredictable app-cache name; never a public URL or a file from the photo library.
        temporary = new File(
          directory,
          pdf && !handoverDocumentId && !draftHandoverPdf
            ? contractPdfName(contractKind, `${contractId.slice(0, 8)}-${randomUUID().slice(0, 8)}`)
            : `${randomUUID()}.${pdf || handoverDocumentId || draftHandoverPdf ? 'pdf' : bytes[0] === 137 ? 'png' : 'jpg'}`,
        );
        temporary.create();
        temporary.write(bytes);
        await Sharing.shareAsync(temporary.uri, {
          mimeType:
            pdf || handoverDocumentId || draftHandoverPdf
              ? 'application/pdf'
              : bytes[0] === 137
                ? 'image/png'
                : 'image/jpeg',
          dialogTitle:
            draftHandoverPdf || handoverDocumentId
              ? 'Mở hoặc lưu biên bản bàn giao'
              : pdf
                ? 'Mở hoặc lưu hợp đồng'
                : 'Mở hoặc lưu ảnh hiện trạng',
        });
      }
    } catch (e) {
      tab?.close();
      if (!controller.signal.aborted)
        setError(finalMeterReading ? finalReadingAccessError(e) : contractError(e));
    } finally {
      if (temporary?.exists) temporary.delete();
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      {thumbnail ? (
        <View
          style={{
            width: '100%',
            height: thumbnailHeight,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {thumbnailUri ? (
            <Image
              source={{ uri: thumbnailUri }}
              accessibilityLabel={label ?? 'Ảnh hiện trạng'}
              resizeMode="contain"
              style={{ width: '100%', height: thumbnailHeight, borderRadius: 9 }}
            />
          ) : (
            <Text variant="bodySmall" style={ui.muted}>
              {thumbnailError
                ? finalMeterReading
                  ? thumbnailError
                  : 'Không xem được ảnh'
                : 'Đang tải ảnh…'}
            </Text>
          )}
        </View>
      ) : (
        <>
          {draftHandoverEvidence && Platform.OS === 'web' ? (
            <>
              <Button
                disabled={busy}
                loading={busy}
                onPress={() => (previewUri ? closePreview() : void showDraftImage())}
              >
                {previewUri ? 'Đóng ảnh' : (label ?? 'Xem ảnh hiện trạng')}
              </Button>
              {previewUri && (
                <Image
                  source={{ uri: previewUri }}
                  accessibilityLabel={label ?? 'Ảnh bằng chứng bàn giao'}
                  resizeMode="contain"
                  style={{ width: '100%', height: 260 }}
                />
              )}
              <Button disabled={busy} onPress={() => void download()}>
                Tải ảnh
              </Button>
            </>
          ) : pdf && Platform.OS === 'web' && !draftHandoverPdf && !handoverDocumentId ? (
            <>
              <Button disabled={busy} loading={busy} onPress={() => void download(true)}>
                {label ?? 'Xem PDF hợp đồng'}
              </Button>
              <Button disabled={busy} onPress={() => void download()}>
                Tải PDF
              </Button>
            </>
          ) : (
            <Button disabled={busy} loading={busy} onPress={() => void download()}>
              {label ??
                (readingId
                  ? finalMeterReading
                    ? 'Mở hoặc lưu ảnh công tơ chốt'
                    : 'Mở hoặc lưu ảnh chỉ số bàn giao'
                  : previewId
                    ? 'Mở hoặc lưu PDF xem trước'
                    : pdf
                      ? 'Mở hoặc lưu tài liệu ký'
                      : `Mở hoặc lưu ảnh hiện trạng ${number ?? ''}`)}
            </Button>
          )}
          {!!error && <ContractNotice message={error} />}
        </>
      )}
    </>
  );
}
