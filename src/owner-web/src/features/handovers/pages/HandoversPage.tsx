import { ResourcePage } from '../../../components/common/ResourcePage';
import { useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import { isMockMode } from '../../../services/config';
import { PageHeader } from '../../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../../components/common/OwnerSelectors';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { ContractHandoverPanel } from '../../contracts/ContractHandoverPanel';
import { useContractsApi } from '../../contracts/useContractsApi';
import {
  guid,
  displayContractDate,
  text,
} from '../../../../../../packages/client-core/src/contracts';
export default function HandoversPage() {
  return isMockMode ? <ResourcePage kind="handovers" variant="handover" /> : <HandoverLookup />;
}
function HandoverLookup() {
  const api = useContractsApi();
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState('');
  const [contract, setContract] = useState(''),
    [lookup, setLookup] = useState(''),
    [error, setError] = useState('');
  const history = useOwnerQuery<{
    periods: { contractId: string; from: string; to: string; contractStatus: string }[];
  }>(['handover-room-contracts', room], `/api/v1/rooms/${room}/occupancy-history`, !!room);
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Bàn giao nhận phòng"
        subtitle="Owner xem biên bản, chỉ số đầu kỳ và xác nhận. Staff và Tenant thực hiện bàn giao trên Mobile."
      />
      <OwnerLocationPicker
        value={location}
        change={(id) => {
          setLocation(id);
          setRoom('');
          setContract('');
        }}
      />
      <OwnerRoomPicker
        key={location}
        location={location}
        value={room}
        change={(id) => {
          setRoom(id);
          setContract('');
        }}
      />
      <OwnerFeedback busy={history.isFetching} error={history.error || error} />
      {room && (
        <TextField
          select
          label="Hợp đồng tại phòng"
          value={contract}
          onChange={(e) => setContract(e.target.value)}
        >
          <MenuItem value="">Chọn kỳ thuê</MenuItem>
          {history.data?.periods.map((p) => (
            <MenuItem key={p.contractId} value={p.contractId}>
              {displayContractDate(p.from)} – {displayContractDate(p.to)} · {text(p.contractStatus)}
            </MenuItem>
          ))}
        </TextField>
      )}
      {room && history.data?.periods.length === 0 && (
        <Alert severity="info">Phòng chưa có lịch sử thuê.</Alert>
      )}
      <TextField
        label="Mã hợp đồng (UUID)"
        value={lookup}
        onChange={(e) => setLookup(e.target.value.trim())}
      />
      <Button
        onClick={() => {
          try {
            guid(lookup);
            setError('');
            setContract(lookup);
          } catch {
            setError('Nhập UUID hợp đồng hợp lệ.');
          }
        }}
      >
        Tra cứu biên bản
      </Button>
      {contract && <ContractHandoverPanel key={contract} api={api} id={contract} />}
    </Stack>
  );
}
