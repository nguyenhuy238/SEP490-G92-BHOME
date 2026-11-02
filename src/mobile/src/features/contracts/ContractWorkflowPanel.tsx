import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import { randomUUID } from 'expo-crypto';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type ContractAudit,
  type DepositVerification,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ContractEvidence } from './ContractEvidence';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';

export function ContractWorkflowPanel({
  api,
  contract,
  role,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
}) {
  const [data, setData] = useState<{
    previews: PreviewDocument[];
    deposits: DepositVerification[];
    audit: ContractAudit[];
  } | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID)),
    lock = useRef(false);
  const privileged = ['Owner', 'Tenant'].includes(role);
  const versions = useWorkspaceQuery<Awaited<ReturnType<ContractClient['versions']>>>(
    `/api/v1/contracts/${contract.id}/versions`,
  );
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [previews, deposits, audit] = await Promise.all([
          privileged ? api.previews(contract.id, c.signal) : Promise.resolve([]),
          privileged ? api.deposits(contract.id, c.signal) : Promise.resolve([]),
          api.audit(contract.id, c.signal),
        ]);
        if (!c.signal.aborted) setData({ previews, deposits, audit });
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, contract, privileged, revision]);
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.mutate(contract.id, 'previews', undefined, keys.get('preview', contract.id));
      keys.confirmed('preview', contract.id);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Box>
        <Heading title="Các phiên bản hợp đồng" />
        {!!versions.error && <Text style={ui.red}>{versions.error}</Text>}
        {versions.data?.map((v) => (
          <Text key={v.id}>
            {text(v.kind)} · {text(v.status)} · {v.startDate} → {v.endDate}
            {v.monthlyRent !== null ? ' · ' + formatContractMoney(v.monthlyRent) : ''}
            {v.terms ? '\n' + v.terms : ''}
          </Text>
        ))}
        <Action secondary onPress={versions.reload}>
          Tải lại phiên bản
        </Action>
      </Box>
      {loading && <Text>Đang tải tài liệu và lịch sử…</Text>}
      {!!error && <Text style={ui.red}>{error}</Text>}
      {privileged && (
        <Box>
          <Heading title="PDF xem trước" detail="Tạo từ bản nội dung đã niêm phong tại máy chủ" />
          <Action disabled={busy} onPress={() => void preview()}>
            {busy ? 'Đang tạo…' : 'Tạo / lấy bản PDF xem trước'}
          </Action>
          {!loading && !data?.previews.length && <Text>Chưa có bản xem trước.</Text>}
          {data?.previews.map((f) => (
            <Box key={f.id}>
              <Text>
                {f.templateId} · v{f.templateVersion} · {formatInstant(f.recordedAt)}
              </Text>
              <Text selectable>SHA-256: {f.snapshotHash}</Text>
              {f.developmentOnly && <Text>DEVELOPMENT — mẫu chưa được duyệt cho Production.</Text>}
              <ContractEvidence api={api} contractId={contract.id} previewId={f.id} pdf />
            </Box>
          ))}
        </Box>
      )}
      {privileged && (
        <Box>
          <Heading title="Cọc đã xác minh" />
          {!data?.deposits.length && <Text>Chưa có khoản cọc được xác minh.</Text>}
          {data?.deposits.map((d) => (
            <Box key={d.id}>
              <Text>
                {formatContractMoney(d.amount)} · {d.bankTransactionReference}
              </Text>
              <Text>{d.verificationReason}</Text>
              <Text>{formatInstant(d.verifiedAt)}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Heading title="Lịch sử hợp đồng" />
        {data?.audit.map((a, i) => (
          <Text key={i}>
            {formatInstant(a.occurredAt)} · {text(a.action)}
          </Text>
        ))}
        <Action secondary disabled={loading || busy} onPress={() => setRevision((v) => v + 1)}>
          Tải lại tài liệu và lịch sử
        </Action>
      </Box>
    </>
  );
}
