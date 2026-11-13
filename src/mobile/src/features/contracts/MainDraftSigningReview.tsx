import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import {
  contractError,
  mutationKeys,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type mainDraftClient,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { verifiedDraftSigner, type MainDraftSigner } from '../owner/mainDraftSigner';
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
    draft: MainDraftView;
    signer: MainDraftSigner | null;
    error: string;
  } | null>(null);
  const [file, setFile] = useState<PreviewDocument | null>(null);
  const [documentBlocker, setDocumentBlocker] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [readyFile, setReadyFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const current =
    snapshot?.api === api && snapshot.draft === draft && snapshot.revision === revision
      ? snapshot
      : null;
  const signer = current?.signer;
  const tenant = signer?.tenantUserId;
  const representative = draft.preparation?.residents.find(
    (person) => person.id === draft.input?.representativeResidentId,
  );
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
    void api
      .request<MainDraftSigner>(`/api/v1/residents/${draft.input.representativeResidentId}`, {
        signal: controller.signal,
      })
      .then((result) => {
        const signer = verifiedDraftSigner(draft, result);
        if (!controller.signal.aborted) setSnapshot({ api, draft, revision, signer, error: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setSnapshot({
            api,
            draft,
            revision,
            signer: null,
            error: mainDraftMessages[previewErrorCode(e)] ?? contractError(e),
          });
      });
    return () => controller.abort();
  }, [owner, api, revision, draft]);
  async function run(release: boolean) {
    if (
      lock.current ||
      !owner ||
      !signer ||
      (release && (!file || readyFile !== file.id || !reviewed))
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
      const resolved = verifiedDraftSigner(
        latest,
        await api!.request<MainDraftSigner>(
          `/api/v1/residents/${latest.input.representativeResidentId}`,
        ),
      );
      if (!alive.current) return;
      if (resolved.tenantUserId !== tenant || resolved.contactEmail !== signer.contactEmail) {
        setFile(null);
        setReadyFile('');
        setReviewed(false);
        setRevision((value) => value + 1);
        throw { code: 'verified_contract_signer_required' };
      }
      if (release) {
        const input = {
          tenantUserId: resolved.tenantUserId,
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
        <Heading title="Thông tin bên thuê" />
        <Text>{representative?.fullName ?? 'Chưa tải được hồ sơ bên thuê'}</Text>
        <Text>{representative?.maskedCitizenNumber}</Text>
        {signer && <Pill tone="green">Đã xác minh</Pill>}
        {draft.preparation?.residents
          .filter((person) => !person.representative)
          .map((person) => (
            <Text key={person.id}>Cùng ở: {person.fullName}</Text>
          ))}
        <Text>Email hồ sơ: {signer?.contactEmail ?? 'Chưa tải được'}</Text>
        <Heading title="Phương thức ký" />
        {signer && (
          <Text>
            {tenant ? 'Viettel MySign · Tài khoản đã liên kết' : 'Email OTP · Chấp thuận nội bộ'}
          </Text>
        )}
        {loading && <Text>Đang kiểm tra bên thuê…</Text>}
        {!!feedback && !documentBlocker && (
          <Text accessibilityRole="alert" style={ui.red}>
            {feedback}
          </Text>
        )}
        <Action secondary disabled={busy || loading || !signer} onPress={() => void run(false)}>
          {busy ? 'Đang xử lý…' : 'Tạo bản PDF để duyệt'}
        </Action>
        {!loading && !signer && (
          <Action secondary disabled={busy} onPress={() => setRevision((v) => v + 1)}>
            Tải lại hồ sơ bên thuê
          </Action>
        )}
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
          label="Tôi đã kiểm tra đúng thông tin và nội dung hợp đồng"
          status={reviewed ? 'checked' : 'unchecked'}
          disabled={!file || readyFile !== file.id || !signer || busy}
          onPress={() => setReviewed((v) => !v)}
        />
        <Action
          disabled={!file || readyFile !== file.id || !signer || !reviewed || busy || loading}
          onPress={() => void run(true)}
        >
          Duyệt và chuyển sang chờ ký
        </Action>
      </Box>
    </>
  );
}
