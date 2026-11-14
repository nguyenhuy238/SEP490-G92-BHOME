import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import type { ContractView, Readiness } from '../../../../../packages/client-core/src/contracts';
import { OnboardingStepper } from '../../components/OnboardingStepper';
import { Box, Heading, ui } from '../../components/WorkspaceKit';
import { staffColors as s } from '../../theme/theme';

export { signerState } from './rentalContractState';
import {
  rentalContractState,
  rentalContractSteps as steps,
  type SignerState,
} from './rentalContractState';
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
  const {
    owner,
    tenant,
    signed: bothSigned,
    active,
    depositVerified,
    current,
    completed,
  } = rentalContractState(contract, readiness);
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
