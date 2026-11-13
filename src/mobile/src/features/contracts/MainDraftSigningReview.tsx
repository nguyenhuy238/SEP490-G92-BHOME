import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import {
  contractClient,
  contractError,
  mutationKeys,
  type PreviewDocument,
  type NamedOption,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type mainDraftClient,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { useSession } from '../../lib/SessionProvider';
import { randomUUID } from '../../lib/randomUUID';
import { ContractPdfPreview } from './ContractPdfPreview';
import { previewErrorCode, requiresNewDocument } from './pdfPreview';

export function MainDraftSigningReview({
  client,
  draft,
  onReleased,
  onOpenPdf,
  onBusyChange,
  onDownloadPdf,
  onDraftChanged,
  onEditDraft,
}: {
  client: ReturnType<typeof mainDraftClient>;
  draft: MainDraftView;
  onReleased: (id: string) => void;
  onOpenPdf: (document: PreviewDocument) => void | Promise<boolean | undefined>;
  onBusyChange?: (busy: boolean) => void;
  onDownloadPdf?: (document: PreviewDocument) => void | Promise<boolean | undefined>;
  onDraftChanged?: (draft: MainDraftView) => void;
  onEditDraft?: () => void;
}) {
  const { api, session } = useSession();
  const owner = !!session?.roles.includes('Owner');
  const [snapshot, setSnapshot] = useState<{
    api: typeof api;
    revision: number;
    accounts: NamedOption[];
    error: string;
  } | null>(null);
  const [tenant, setTenant] = useState('');
  const [file, setFile] = useState<PreviewDocument | null>(null);
  const [documentBlocker, setDocumentBlocker] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [readyFile, setReadyFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const current = snapshot?.api === api && snapshot.revision === revision ? snapshot : null;
  const accounts = current?.accounts ?? [];
  const loading = owner && !current;
  const feedback = error || current?.error;
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false),
    alive = useRef(true);
  const invalidateDocument = useCallback((failure: unknown) => {
    setReviewed(false);
    setReadyFile('');
    if (requiresNewDocument(failure)) {
      setDocumentBlocker(previewErrorCode(failure));
      setFile(null);
      setReviewed(false);
      setReadyFile('');
      setError(mainDraftMessages[previewErrorCode(failure)] ?? contractError(failure));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!owner || !api) return;
    const controller = new AbortController();
    const contracts = contractClient((path, init, type) => api.request(path, init, type));
    void contracts
      .tenantAccounts(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot({ api, revision, accounts: result, error: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setSnapshot({ api, revision, accounts: [], error: contractError(e) });
      });
    return () => controller.abort();
  }, [owner, api, revision]);
  async function run(release: boolean) {
    if (
      lock.current ||
      !owner ||
      (release && (!file || readyFile !== file.id || !reviewed || !tenant))
    )
      return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const latest = await client.get(draft.id);
      if (!alive.current) return;
      if (latest.status !== 'Draft') {
        setFile(null);
        setReviewed(false);
        onReleased(latest.id);
        return;
      }
      if (latest.version !== draft.version) {
        setFile(null);
        setReadyFile('');
        setReviewed(false);
        onDraftChanged?.(latest);
        throw { code: 'draft_version_or_status_changed' };
      }
      if (release) {
        const input = {
          tenantUserId: tenant === '__internal__' ? null : tenant,
          expectedVersion: draft.version,
          reviewedFileId: file!.id,
          humanReviewed: true,
        };
        const result = await client.release(draft.id, input, keys.get('main-draft-release', input));
        keys.confirmed('main-draft-release', input);
        if (alive.current) onReleased(result.id);
      } else {
        setReviewed(false);
        setReadyFile('');
        setFile(null);
        const result = await client.signingReview(draft.id);
        if (alive.current) {
          setDocumentBlocker('');
          setFile(result);
        }
      }
    } catch (e) {
      setReviewed(false);
      if (requiresNewDocument(e)) {
        setDocumentBlocker(previewErrorCode(e));
        setFile(null);
        setReadyFile('');
      }
      const code = (e as { code?: string }).code;
      if (alive.current) setError((code && mainDraftMessages[code]) || contractError(e));
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  if (!owner)
    return (
      <Box>
        <Heading title="Chờ Chủ cơ sở duyệt để ký" />
        <Pill tone="amber">Bản nháp đã lưu</Pill>
        <Text>
          Chủ cơ sở xem PDF, chọn tài khoản người thuê và chuyển hợp đồng sang ký. Staff tiếp tục
          theo dõi trong danh sách hợp đồng.
        </Text>
      </Box>
    );
  return (
    <>
      <Box>
        <Heading title="Duyệt hợp đồng đưa đi ký" />
        <ChoiceField
          label="Người đại diện ký hợp đồng"
          value={tenant}
          options={[
            { id: '__internal__', label: 'Khách mới · chấp thuận nội bộ qua email' },
            ...accounts,
          ]}
          disabled={busy || loading}
          onChange={(value) => {
            setTenant(value);
            setReviewed(false);
          }}
        />
        {!loading && !accounts.length && (
          <Text>
            Khách mới chấp thuận nội bộ qua email trước khi có tài khoản. Máy chủ chỉ cấp tài khoản
            sau khi hợp đồng thuê chính được kích hoạt.
          </Text>
        )}
        {!!feedback && !documentBlocker && (
          <Text accessibilityRole="alert" style={ui.red}>
            {feedback}
          </Text>
        )}
        <Action secondary disabled={busy || loading} onPress={() => void run(false)}>
          {busy ? 'Đang xử lý…' : 'Tạo bản PDF để duyệt'}
        </Action>
        <Action secondary disabled={busy || loading} onPress={() => setRevision((v) => v + 1)}>
          Tải lại tài khoản
        </Action>
        {file?.developmentOnly && (
          <Pill tone="amber">Tài liệu Development · Chưa duyệt cho production</Pill>
        )}
      </Box>
      {(file || documentBlocker) && (
        <ContractPdfPreview
          client={client}
          contractId={draft.id}
          document={file}
          hideUnavailableActions
          busy={busy}
          hasDocx={false}
          previewErrorCode={documentBlocker || null}
          onRegenerate={() => {
            if (documentBlocker.includes('save_again') && onEditDraft) onEditDraft();
            else void run(false);
          }}
          onOpenPdf={() => (file ? onOpenPdf(file) : undefined)}
          onDownloadPdf={onDownloadPdf && file ? () => onDownloadPdf(file) : undefined}
          onOpenDocx={() => {}}
          onDocumentError={invalidateDocument}
          onReady={setReadyFile}
        />
      )}
      <Box>
        <Checkbox.Item
          label="Tôi đã xem PDF và xác nhận người đại diện, cách ký"
          status={reviewed ? 'checked' : 'unchecked'}
          disabled={!file || readyFile !== file.id || !tenant || busy}
          onPress={() => setReviewed((v) => !v)}
        />
        <Action
          disabled={!file || readyFile !== file.id || !tenant || !reviewed || busy || loading}
          onPress={() => void run(true)}
        >
          Duyệt và chuyển sang chờ ký
        </Action>
      </Box>
    </>
  );
}
