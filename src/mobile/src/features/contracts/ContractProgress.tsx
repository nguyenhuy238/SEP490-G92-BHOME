import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import type {
  ContractView,
  Readiness,
  Signature,
} from '../../../../../packages/client-core/src/contracts';
import { OnboardingStepper } from '../../components/OnboardingStepper';
import { Box, Heading, ui } from '../../components/WorkspaceKit';
import { staffColors as s } from '../../theme/theme';

export type SignerState = 'unsigned' | 'waiting' | 'signed';
export function signerState(
  signatures: readonly Signature[],
  signerId: string | null,
): SignerState {
  const mine = signatures.filter((signature) => signature.signerUserId === signerId);
  if (mine.some((signature) => signature.status === 'Signed')) return 'signed';
  return mine.some((signature) => !['Failed', 'Simulated'].includes(signature.status))
    ? 'waiting'
    : 'unsigned';
}
const steps = [
  { key: 'prepare', label: 'Chuẩn bị' },
  { key: 'approve', label: 'Phê duyệt' },
  { key: 'sign', label: 'Hai bên ký' },
  { key: 'deposit', label: 'Tiền cọc' },
  { key: 'activate', label: 'Kích hoạt' },
];
const labels: Record<SignerState, string> = {
  unsigned: 'Chưa ký',
  waiting: 'Đang chờ ký',
  signed: 'Đã ký',
};
export function ContractProgress({
  contract,
  readiness,
}: {
  contract: ContractView;
  readiness: Readiness | null;
}) {
  const owner = signerState(contract.signatures, contract.ownerSignerId);
  const tenant = signerState(contract.signatures, contract.tenantUserId);
  const bothSigned = owner === 'signed' && tenant === 'signed';
  const active = contract.status === 'Active';
  const depositVerified = !!readiness && /^0(?:\.0+)?$/.test(readiness.remainingDeposit);
  const current = active
    ? 4
    : bothSigned
      ? 3
      : ['PendingSigning', 'PendingActivation'].includes(contract.status) ||
          owner !== 'unsigned' ||
          tenant !== 'unsigned'
        ? 2
        : 0;
  // The contract DTO has no separate approval event. Never infer Owner approval from signatures.
  const completed = [
    ...(['PendingSigning', 'PendingActivation', 'Active'].includes(contract.status)
      ? ['prepare']
      : []),
    ...(bothSigned ? ['sign'] : []),
    ...(depositVerified ? ['deposit'] : []),
    ...(active ? ['activate'] : []),
  ];
  const message = active
    ? 'Hợp đồng đã được kích hoạt.'
    : owner === 'signed' && tenant !== 'signed'
      ? 'Đang chờ khách thuê ký'
      : tenant === 'signed' && owner !== 'signed'
        ? 'Đang chờ chủ cơ sở ký'
        : bothSigned
          ? 'Hai bên đã ký. Tiếp tục kiểm tra tiền cọc và điều kiện kích hoạt.'
          : 'Theo dõi chữ ký của hai bên.';
  return (
    <Box style={styles.panel}>
      <Heading title="Tiến trình hợp đồng" />
      {['Cancelled', 'Terminated', 'Superseded'].includes(contract.status) ? (
        <Text>Quy trình hợp đồng này đã kết thúc.</Text>
      ) : (
        <OnboardingStepper steps={steps} current={current} completed={completed} />
      )}
      <Text style={styles.message}>{message}</Text>
      <View style={styles.signers}>
        {[
          { label: 'Owner', detail: 'Chủ cơ sở', status: owner },
          { label: 'Tenant', detail: 'Khách thuê', status: tenant },
        ].map((signer) => (
          <View key={signer.label} style={styles.signer}>
            <Icon
              source={signer.status === 'signed' ? 'check-circle-outline' : 'account-outline'}
              size={26}
              color={signer.status === 'signed' ? s.green : s.blue}
            />
            <Text variant="titleMedium">{signer.label}</Text>
            <Text variant="labelSmall" style={ui.muted}>
              {signer.detail}
            </Text>
            <Text style={{ color: signer.status === 'signed' ? s.green : s.blue }}>
              {labels[signer.status]}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="bodySmall" style={ui.muted}>
        Trạng thái phê duyệt riêng chưa được cung cấp.
      </Text>
      {bothSigned && (
        <Text>
          {readiness
            ? depositVerified
              ? 'Tiền cọc đã được đối chiếu đầy đủ.'
              : 'Đang chờ thanh toán hoặc đối chiếu tiền cọc.'
            : 'Chưa có thông tin đối chiếu tiền cọc.'}
        </Text>
      )}
      {contract.isDevelopmentDemo && (
        <Text style={ui.red}>Bản mô phỏng: chữ ký thử không phải chữ ký đã xác minh.</Text>
      )}
    </Box>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 16, gap: 16 },
  signers: { flexDirection: 'row', gap: 12 },
  signer: { flex: 1, borderRadius: 12, padding: 12, backgroundColor: '#F5F7FB', gap: 6 },
  message: { color: s.navy, fontWeight: '600' },
});
