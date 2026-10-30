import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { ui } from '../../components/WorkspaceKit';

export function ContractEvidence({
  api,
  contractId,
  evidenceId,
  pdf = false,
  number,
}: {
  api: ContractClient;
  contractId: string;
  evidenceId?: string;
  pdf?: boolean;
  number?: number;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
        const blob = pdf
          ? await api.document(contractId, controller.signal)
          : await api.evidence(contractId, evidenceId!, controller.signal);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download = pdf ? 'hop-dong.pdf' : 'hien-trang.jpg';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          setError('Thiết bị chưa hỗ trợ mở hoặc lưu tài liệu.');
          return;
        }
        const bytes = pdf
          ? await api.documentBytes(contractId, controller.signal)
          : await api.evidenceBytes(contractId, evidenceId!, controller.signal);
        if (controller.signal.aborted) return;
        const directory = new Directory(Paths.cache, 'bhome-contract-downloads');
        directory.create({ idempotent: true, intermediates: true });
        // Unpredictable app-cache name; never a public URL or a file from the photo library.
        temporary = new File(
          directory,
          `${randomUUID()}.${pdf ? 'pdf' : bytes[0] === 137 ? 'png' : 'jpg'}`,
        );
        temporary.create();
        temporary.write(bytes);
        await Sharing.shareAsync(temporary.uri, {
          mimeType: pdf ? 'application/pdf' : bytes[0] === 137 ? 'image/png' : 'image/jpeg',
          dialogTitle: pdf ? 'Mở hoặc lưu hợp đồng' : 'Mở hoặc lưu ảnh hiện trạng',
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
        {pdf ? 'Mở hoặc lưu tài liệu ký' : `Mở hoặc lưu ảnh hiện trạng ${number ?? ''}`}
      </Button>
      {!!error && <Text style={ui.red}>{error}</Text>}
    </>
  );
}
