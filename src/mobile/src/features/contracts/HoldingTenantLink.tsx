import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import {
  type ContractClient,
  type NamedOption,
  contractError,
} from '../../../../../packages/client-core/src/contracts';
import { Action, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';

export function HoldingTenantLink({
  api,
  residentId,
  role,
  onLinked,
}: {
  api: ContractClient;
  residentId: string;
  role: string;
  onLinked: () => void;
}) {
  const [accounts, setAccounts] = useState<NamedOption[]>([]);
  const [tenant, setTenant] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (role !== 'Owner') return;
    const controller = new AbortController();
    void api
      .tenantAccounts(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAccounts(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(contractError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, role]);
  if (role !== 'Owner')
    return <Text>Người thuê chưa liên kết tài khoản Tenant. Cần Owner thực hiện liên kết.</Text>;
  async function link() {
    if (role !== 'Owner' || !tenant || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.linkTenant(residentId, tenant);
      onLinked();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Text>Người thuê chưa liên kết tài khoản Tenant.</Text>
      <ChoiceField
        label="Tài khoản Tenant để liên kết"
        value={tenant}
        options={accounts}
        disabled={loading || busy}
        onChange={setTenant}
      />
      {!loading && !accounts.length && !error && (
        <Text>Chưa có tài khoản Tenant phù hợp để liên kết.</Text>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action secondary disabled={loading || busy || !tenant} onPress={() => void link()}>
        {busy ? 'Đang liên kết…' : 'Liên kết tài khoản Tenant'}
      </Action>
    </>
  );
}
