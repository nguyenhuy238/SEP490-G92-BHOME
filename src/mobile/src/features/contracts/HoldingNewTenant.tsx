import { ContractNotice } from './ContractNotice';
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Heading } from '../../components/WorkspaceKit';
import { Input } from '../../components/WorkflowControls';
import { IdentityWizard } from '../onboarding/IdentityWizard';
import { IdentityPersonCard } from '../onboarding/IdentityPersonCard';
import { type CaptureProgress, type IdentityStatus } from '../onboarding/onboarding';
import { WorkspaceFooter } from '../../components/WorkspaceFooter';
import { staffColors } from '../../theme/theme';

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
  stage,
  onContinue,
  onBack,
  disabled = false,
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
  stage?: 'details' | 'identity';
  onContinue?: () => void;
  onBack?: () => void;
  disabled?: boolean;
}) {
  const applicant = context === 'holding';
  const [name, setName] = useState(
    initialName || (applicant && stage === 'identity' ? 'Người giữ chỗ' : ''),
  );
  const [email] = useState(initialEmail);
  const [residentId, setResidentId] = useState(initialResidentId);
  const [mode, setMode] = useState<'capture' | 'verify'>('verify');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [error, setError] = useState('');
  const [identityStatus, setIdentityStatus] = useState<IdentityStatus>('unscanned');
  const [captureProgress, setCaptureProgress] = useState<CaptureProgress>();
  const lock = useRef(false);
  async function enter(next: 'capture' | 'verify') {
    if (lock.current || uncertain || disabled || !['Owner', 'Staff'].includes(role)) return;
    if (!name.trim() || name.trim().length > 150) {
      setError(
        applicant
          ? 'Nhập họ và tên người giữ chỗ, tối đa 150 ký tự.'
          : 'Nhập tên người thuê, tối đa 150 ký tự.',
      );
      return;
    }
    if (stage === 'details') {
      // Step 2 is local form state. Create the identity record only when opening Step 3.
      onCreated(residentId, name.trim(), email.trim());
      onContinue?.();
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
      const result = await api.createHoldingResident(roomId, name);
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
      {stage !== 'identity' && (
        <>
          <Input
            label={applicant ? 'Họ và tên *' : 'Tên người thuê'}
            value={name}
            onChange={setName}
            disabled={busy || !!residentId || uncertain}
          />
          <Text style={styles.helper}>Email nhận lời mời ký sẽ được nhập ở bước ký hợp đồng.</Text>
        </>
      )}
      {stage === 'details' ? (
        <WorkspaceFooter>
          <View style={styles.footer}>
            <Button
              mode="contained"
              icon="arrow-right"
              buttonColor={staffColors.navy}
              contentStyle={styles.primaryContent}
              style={styles.footerButton}
              disabled={busy || uncertain || disabled}
              loading={busy}
              onPress={() => void enter('verify')}
            >
              {busy ? 'Đang lưu…' : 'Tiếp tục'}
            </Button>
            {!!onBack && (
              <Button
                mode="text"
                contentStyle={styles.secondaryContent}
                disabled={busy}
                onPress={onBack}
              >
                Quay lại
              </Button>
            )}
          </View>
        </WorkspaceFooter>
      ) : stage === 'identity' && role === 'Staff' ? (
        <>
          <IdentityPersonCard
            person={{
              key: residentId,
              residentId,
              label: name,
              email,
              status: confirmed || initialConfirmed ? 'confirmed' : identityStatus,
              captureProgress,
            }}
            label={name}
            role="Người giữ chỗ"
            disabled={busy || uncertain || disabled}
            onScan={() =>
              void enter(
                captureProgress?.front === 'recognized' && captureProgress?.back === 'recognized'
                  ? 'verify'
                  : 'capture',
              )
            }
            onManual={() => void enter('verify')}
          />
          {(confirmed || initialConfirmed) && (
            <Button
              mode="text"
              icon="file-document-outline"
              disabled={disabled}
              contentStyle={styles.secondaryContent}
              onPress={() => void enter('verify')}
            >
              Xem thông tin CCCD
            </Button>
          )}
        </>
      ) : role === 'Staff' ? (
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
      {stage !== 'details' &&
        !(stage === 'identity' && role === 'Staff') &&
        (confirmed || initialConfirmed) && (
          <Text style={styles.success}>
            {applicant
              ? 'Đã xác nhận thông tin người giữ chỗ.'
              : 'Đã xác nhận thông tin người thuê.'}
          </Text>
        )}
      {uncertain && (
        <Text accessibilityRole="alert" style={styles.warning}>
          Chưa xác định hồ sơ đã được lưu hay chưa. Kiểm tra danh sách người ở trước khi tạo lại.
        </Text>
      )}
      {!!error && <ContractNotice message={error} />}
      {(open || (stage === 'identity' && role === 'Staff')) && residentId && (
        <IdentityWizard
          residentId={residentId}
          personLabel={name.trim()}
          modal
          visible={open}
          mode={mode}
          onModeChange={setMode}
          onConfirmed={() => {
            setConfirmed(true);
            if (stage === 'identity') setOpen(false);
            onConfirmed();
          }}
          onStatusChange={setIdentityStatus}
          onCaptureProgress={setCaptureProgress}
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

const styles = StyleSheet.create({
  footer: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  footerButton: { borderRadius: 12 },
  primaryContent: { minHeight: 50, flexDirection: 'row-reverse' },
  secondaryContent: { minHeight: 44 },
  helper: { fontSize: 13, lineHeight: 19, color: '#526581' },
  success: { fontSize: 13, color: staffColors.green },
  warning: { fontSize: 13, lineHeight: 20, color: '#9A5D0A' },
});
