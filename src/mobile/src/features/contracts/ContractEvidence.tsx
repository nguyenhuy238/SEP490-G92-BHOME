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
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';

export function ContractEvidence({
  api,
  contractId,
  evidenceId,
  previewId,
  handover = false,
  readingId,
  pdf = false,
  number,
  label,
  handoverDocumentId,
  draftHandoverPdf = false,
  draftHandoverEvidence = false,
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
  number?: number;
  label?: string;
  handoverDocumentId?: string;
  draftHandoverPdf?: boolean;
  draftHandoverEvidence?: boolean;
  assetChangeId?: string;
  thumbnail?: boolean;
  thumbnailHeight?: number;
  localThumbnailUri?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false),
    [previewUri, setPreviewUri] = useState(''),
    [thumbnailState, setThumbnailState] = useState({ key: '', uri: '', error: '' });
  const thumbnailKey = `${contractId}:${evidenceId ?? ''}:${readingId ?? ''}:${draftHandoverEvidence}`;
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
    if (!thumbnail || localThumbnailUri || !((draftHandoverEvidence && evidenceId) || readingId))
      return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cachedPhoto: File | null = null;
    void (async () => {
      try {
        const path = `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId ?? '')}`;
        if (Platform.OS === 'web') {
          const blob = readingId
            ? await api.handoverMeterEvidence(contractId, readingId, controller.signal)
            : await api.transport<Blob>(path, { signal: controller.signal }, 'blob');
          if (controller.signal.aborted) return;
          if (blob.size > 5 * 1024 * 1024) throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
          const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
          const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte);
          const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
          if (!png && !jpeg) throw new UserFeedbackError('Ảnh không phải PNG/JPEG hợp lệ.');
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: png ? 'image/png' : 'image/jpeg' }),
          );
          setThumbnailState({ key: thumbnailKey, uri: objectUrl, error: '' });
        } else {
          const bytes = readingId
            ? await api.handoverMeterEvidenceBytes(contractId, readingId, controller.signal)
            : await api.transport<Uint8Array>(path, { signal: controller.signal }, 'bytes');
          if (controller.signal.aborted) return;
          if (bytes.length > 5 * 1024 * 1024) throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
          const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
          const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
          if (!png && !jpeg) throw new UserFeedbackError('Ảnh không phải PNG/JPEG hợp lệ.');
          const directory = new Directory(Paths.cache, 'bhome-handover-photo-thumbnails');
          directory.create({ idempotent: true, intermediates: true });
          cachedPhoto = new File(directory, `${randomUUID()}.${png ? 'png' : 'jpg'}`);
          cachedPhoto.create();
          await cachedPhoto.write(bytes);
          if (controller.signal.aborted) {
            if (cachedPhoto.exists) cachedPhoto.delete();
            return;
          }
          setThumbnailState({ key: thumbnailKey, uri: cachedPhoto.uri, error: '' });
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setThumbnailState({
            key: thumbnailKey,
            uri: '',
            error: cause instanceof UserFeedbackError ? cause.message : contractError(cause),
          });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (cachedPhoto?.exists) cachedPhoto.delete();
    };
  }, [
    api,
    contractId,
    evidenceId,
    draftHandoverEvidence,
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
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    let temporary: File | null = null;
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (Platform.OS === 'web') {
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
                  ? await api.handoverMeterEvidence(contractId, readingId, controller.signal)
                  : handover
                    ? await api.handoverEvidence(contractId, evidenceId!, controller.signal)
                    : previewId
                      ? await api.preview(contractId, previewId, controller.signal)
                      : pdf
                        ? await api.document(contractId, controller.signal)
                        : await api.evidence(contractId, evidenceId!, controller.signal);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download =
          draftHandoverPdf || handoverDocumentId
            ? 'bien-ban-ban-giao.pdf'
            : pdf
              ? 'hop-dong.pdf'
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
                  ? await api.handoverMeterEvidenceBytes(contractId, readingId, controller.signal)
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
          `${randomUUID()}.${pdf || handoverDocumentId || draftHandoverPdf ? 'pdf' : bytes[0] === 137 ? 'png' : 'jpg'}`,
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
      if (!controller.signal.aborted) setError(contractError(e));
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
              {thumbnailError ? 'Không xem được ảnh' : 'Đang tải ảnh…'}
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
          ) : (
            <Button disabled={busy} loading={busy} onPress={() => void download()}>
              {label ??
                (readingId
                  ? 'Mở hoặc lưu ảnh chỉ số bàn giao'
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
