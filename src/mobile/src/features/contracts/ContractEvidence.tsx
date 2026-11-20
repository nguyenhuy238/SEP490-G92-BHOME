import { ContractNotice } from './ContractNotice';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Button } from 'react-native-paper';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
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
  assetChangeId,
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
  assetChangeId?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
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
        const blob = handoverDocumentId
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
        link.download = handoverDocumentId
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
        const bytes = handoverDocumentId
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
          `${randomUUID()}.${pdf || handoverDocumentId ? 'pdf' : bytes[0] === 137 ? 'png' : 'jpg'}`,
        );
        temporary.create();
        temporary.write(bytes);
        await Sharing.shareAsync(temporary.uri, {
          mimeType:
            pdf || handoverDocumentId
              ? 'application/pdf'
              : bytes[0] === 137
                ? 'image/png'
                : 'image/jpeg',
          dialogTitle: handoverDocumentId
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
      {!!error && <ContractNotice message={error} />}
    </>
  );
}
