import React, { useEffect, useRef, useState } from 'react';
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

export function MainDraftSigningReview({
  client,
  draft,
  onReleased,
  onOpenPdf,
  onBusyChange,
}: {
  client: ReturnType<typeof mainDraftClient>;
  draft: MainDraftView;
  onReleased: (id: string) => void;
  onOpenPdf: (document: PreviewDocument) => void;
  onBusyChange?: (busy: boolean) => void;
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
  const [reviewed, setReviewed] = useState(false);
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
    if (lock.current || !owner || (release && (!file || !reviewed))) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      if (release) {
        const input = {
          tenantUserId: tenant || null,
          expectedVersion: draft.version,
          reviewedFileId: file!.id,
          humanReviewed: true,
        };
        const result = await client.release(draft.id, input, keys.get('main-draft-release', input));
        keys.confirmed('main-draft-release', input);
        if (alive.current) onReleased(result.id);
      } else {
        setReviewed(false);
        setFile(null);
        const result = await client.signingReview(draft.id);
        if (alive.current) setFile(result);
      }
    } catch (e) {
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
          Chủ cơ sở xem PDF, phê duyệt và chuyển hợp đồng sang ký. Staff tiếp tục theo dõi trong
          danh sách hợp đồng.
        </Text>
      </Box>
    );
  return (
    <>
      <Box>
        <Heading title="Duyệt hợp đồng đưa đi ký" />
        <ChoiceField
          label="Tài khoản Tenant đại diện"
          value={tenant || 'new'}
          options={[
            { id: 'new', label: 'Người ở mới · Ký OTP, cấp tài khoản sau kích hoạt' },
            ...accounts,
          ]}
          disabled={busy || loading}
          onChange={(value) => {
            setTenant(value === 'new' ? '' : value);
            setReviewed(false);
          }}
        />
        {!loading && !accounts.length && (
          <Text>
            Chưa có tài khoản Tenant. Người ở mới ký qua email và OTP; tài khoản chỉ được cấp sau
            khi hợp đồng kích hoạt.
          </Text>
        )}
        {!!feedback && (
          <Text accessibilityRole="alert" style={ui.red}>
            {feedback}
          </Text>
        )}
        <Action secondary disabled={busy || loading} onPress={() => void run(false)}>
          {busy ? 'Đang xử lý…' : 'Tạo PDF đưa đi ký'}
        </Action>
        <Action secondary disabled={busy || loading} onPress={() => setRevision((v) => v + 1)}>
          Tải lại tài khoản
        </Action>
        {file?.developmentOnly && (
          <Pill tone="amber">Tài liệu Development · Chưa duyệt cho production</Pill>
        )}
      </Box>
      {file && (
        <ContractPdfPreview
          client={client}
          contractId={draft.id}
          document={file}
          busy={busy}
          hasDocx={false}
          previewErrorCode={null}
          onRegenerate={() => void run(false)}
          onOpenPdf={() => onOpenPdf(file)}
          onOpenDocx={() => {}}
        />
      )}
      <Box>
        <Checkbox.Item
          label="Tôi đã xem đúng PDF và xác nhận người đại diện"
          status={reviewed ? 'checked' : 'unchecked'}
          disabled={!file || busy}
          onPress={() => setReviewed((v) => !v)}
        />
        <Action disabled={!file || !reviewed || busy || loading} onPress={() => void run(true)}>
          Xác nhận chuyển sang ký
        </Action>
      </Box>
    </>
  );
}
