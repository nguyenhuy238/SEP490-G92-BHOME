import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { contractError, mutationKeys } from '../../../../../../packages/client-core/src/contracts';
import { Box, ui } from '../../../components/WorkspaceKit';
import { randomUUID } from '../../../lib/randomUUID';
import { useSession } from '../../../lib/SessionProvider';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { showSuccess } from '../../../lib/toast';

export function StaffAbandonMoveOutButton({
  contractId,
  onChanged,
}: {
  contractId: string;
  onChanged: () => void;
}) {
  const { api } = useSession();
  const root = '/api/v1/contracts/' + encodeURIComponent(contractId) + '/move-out';
  const availability = useWorkspaceQuery<{ canReportAbandoned: boolean }>(
    root + '/abandon-status',
    { notifyError: false },
  );
  const { reload } = availability;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  useEffect(() => {
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  async function submit() {
    if (!api || lock.current || !reason.trim() || !availability.data?.canReportAbandoned) return;
    const body = { reason: reason.trim() };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.request(root + '/abandon', {
        method: 'POST',
        headers: { 'Idempotency-Key': keys.get(root, body) },
        body: JSON.stringify(body),
      });
      keys.confirmed(root, body);
      setOpen(false);
      setReason('');
      showSuccess('Đã ghi nhận khách thuê bỏ đi.');
      reload();
      api.queryCache.invalidate(['tasks', 'contracts']);
      onChanged();
    } catch (cause) {
      setError(contractError(cause));
      reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!availability.data?.canReportAbandoned && !open) return null;
  return (
    <>
      {availability.data?.canReportAbandoned && (
        <Button mode="outlined" onPress={() => { setError(''); setOpen(true); }}>
          Khách thuê đã bỏ đi
        </Button>
      )}
      <Modal visible={open} transparent onRequestClose={() => { if (!busy) setOpen(false); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <Box>
            <Text variant="titleMedium">Khách thuê đã bỏ đi</Text>
            <Text>Ghi nhận lý do xác minh khách thuê đã bỏ đi. Khoản nợ chưa thanh toán vẫn được lưu.</Text>
            <TextInput mode="outlined" multiline label="Lý do" value={reason} onChangeText={setReason} maxLength={2000} disabled={busy} />
            {!!error && <Text style={ui.red}>{error}</Text>}
            <Button mode="contained" disabled={busy || !reason.trim() || !availability.data?.canReportAbandoned} onPress={() => void submit()}>
              Xác nhận
            </Button>
            <Button disabled={busy} onPress={() => setOpen(false)}>Hủy</Button>
          </Box>
        </View>
      </Modal>
    </>
  );
}
