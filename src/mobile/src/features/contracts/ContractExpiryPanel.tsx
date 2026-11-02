import React, { useEffect, useState } from 'react';
import { Text } from 'react-native-paper';
import {
  contractError,
  displayContractDate,
  type ContractClient,
  type ContractExpiryNotice,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
export function ContractExpiryPanel({
  api,
  onOpen,
}: {
  api: ContractClient;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<ContractExpiryNotice[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      setError('');
      setItems([]);
      try {
        const rows = await api.expiryReminders(c.signal);
        if (!c.signal.aborted) setItems(rows);
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      }
    }
    void load();
    return () => c.abort();
  }, [api, revision]);
  return (
    <Box>
      <Heading title="Nhắc gia hạn / trả phòng" />
      <Action secondary onPress={() => setRevision((v) => v + 1)}>
        Tải lại nhắc hết hạn
      </Action>
      {!!error && <Text style={ui.red}>{error}</Text>}
      {!items.length && !error && <Text>Chưa có nhắc hết hạn đã được xử lý.</Text>}
      {items.map((n) => (
        <Box key={n.id}>
          <Text>
            Phòng {n.roomNumber} · {n.locationName} ·{' '}
            {n.stage === 'Expired' ? 'Đã hết hạn' : 'Sắp hết hạn'} {displayContractDate(n.endDate)}
          </Text>
          <Text>Cần gia hạn hoặc xử lý trả phòng.</Text>
          <Action onPress={() => onOpen(n.contractId)}>Mở hợp đồng phòng {n.roomNumber}</Action>
        </Box>
      ))}
    </Box>
  );
}
