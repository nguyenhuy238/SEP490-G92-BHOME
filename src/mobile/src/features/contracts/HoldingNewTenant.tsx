import React, { useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Heading, ui } from '../../components/WorkspaceKit';
import { Input } from '../../components/WorkflowControls';
import { IdentityWizard } from '../onboarding/IdentityWizard';

export function HoldingNewTenant({
  api,
  roomId,
  role,
  onCreated,
  onConfirmed,
  onBusyChange,
  initialResidentId = '',
  initialName = '',
  initialEmail = '',
  initialConfirmed = false,
  context = 'tenant',
  onVerifiedSummary,
}: {
  api: ContractClient;
  roomId: string;
  role: string;
  onCreated: (id: string, name: string, email: string) => void;
  onConfirmed: () => void;
  onBusyChange?: (busy: boolean) => void;
  initialResidentId?: string;
  initialName?: string;
  initialEmail?: string;
  initialConfirmed?: boolean;
  context?: 'tenant' | 'holding';
  onVerifiedSummary?: (summary: { fullName: string; dateOfBirth: string | null }) => void;
}) {
  const applicant = context === 'holding';
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [residentId, setResidentId] = useState(initialResidentId);
  const [mode, setMode] = useState<'capture' | 'verify'>('verify');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function enter(next: 'capture' | 'verify') {
    if (lock.current || uncertain || !['Owner', 'Staff'].includes(role)) return;
    if (!name.trim() || name.trim().length > 150) {
      setError(
        applicant
          ? 'Nhập họ và tên người giữ chỗ, tối đa 150 ký tự.'
          : 'Nhập tên người thuê, tối đa 150 ký tự.',
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 256) {
      setError(
        applicant ? 'Nhập email hợp lệ của người giữ chỗ.' : 'Nhập email hợp lệ của người thuê.',
      );
      return;
    }
    if (residentId) {
      setMode(next);
      setOpen(role === 'Staff');
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const result = await api.createHoldingResident(roomId, name, email);
      setResidentId(result.id);
      onCreated(result.id, name.trim(), email.trim());
      setMode(next);
      setOpen(role === 'Staff');
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === undefined || status === 0 || status >= 500) setUncertain(true);
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  if (!['Owner', 'Staff'].includes(role)) return null;
  return (
    <>
      {!applicant && <Heading title="Thông tin người thuê mới" />}
      <Input
        label={applicant ? 'Họ và tên *' : 'Tên người thuê'}
        value={name}
        onChange={setName}
        disabled={busy || !!residentId || uncertain}
      />
      <Input
        label={applicant ? 'Email *' : 'Email người thuê'}
        email
        value={email}
        onChange={setEmail}
        disabled={busy || !!residentId || uncertain}
      />
      {role === 'Staff' ? (
        <>
          <Action secondary disabled={busy || uncertain} onPress={() => void enter('verify')}>
            {residentId ? 'Mở thông tin CCCD' : 'Nhập thông tin CCCD'}
          </Action>
          <Action
            secondary
            disabled={busy || uncertain || confirmed || initialConfirmed}
            onPress={() => void enter('capture')}
          >
            Quét CCCD
          </Action>
        </>
      ) : (
        <>
          {!residentId && (
            <Action secondary disabled={busy || uncertain} onPress={() => void enter('verify')}>
              {busy
                ? 'Đang tạo hồ sơ…'
                : applicant
                  ? 'Lưu thông tin người giữ chỗ'
                  : 'Lưu thông tin người thuê'}
            </Action>
          )}
          {!!residentId && !confirmed && !initialConfirmed && (
            <Text>
              {applicant
                ? 'Hồ sơ người giữ chỗ đã tạo. Cần Staff xác minh thông tin CCCD trước khi lập hợp đồng.'
                : 'Hồ sơ đã tạo. Cần Staff xác minh thông tin CCCD trước khi lập hợp đồng.'}
            </Text>
          )}
        </>
      )}
      {(confirmed || initialConfirmed) && (
        <Text>
          {applicant ? 'Đã xác nhận thông tin người giữ chỗ.' : 'Đã xác nhận thông tin người thuê.'}
        </Text>
      )}
      {uncertain && (
        <Text>
          Chưa xác định hồ sơ đã được lưu hay chưa. Kiểm tra danh sách người ở trước khi tạo lại.
        </Text>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      {open && residentId && (
        <IdentityWizard
          residentId={residentId}
          personLabel={name.trim()}
          modal
          mode={mode}
          onModeChange={setMode}
          onConfirmed={() => {
            setConfirmed(true);
            onConfirmed();
          }}
          onVerifiedSummary={(summary) => {
            setName(summary.fullName);
            onVerifiedSummary?.(summary);
          }}
          onComplete={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}
