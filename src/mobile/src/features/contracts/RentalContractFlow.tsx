import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import {
  contractActions,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type Readiness,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { colors as c } from '../../theme/theme';
import { randomUUID } from '../../lib/randomUUID';
import { ContractActionForm, SigningCertificates } from './ContractActionForm';
import { ContractEvidence } from './ContractEvidence';
import { ContractWorkflowPanel } from './ContractWorkflowPanel';
import { RentalContractStepper } from './RentalContractStepper';
import { rentalContractState } from './rentalContractState';

export function RentalContractFlow({
  api,
  contract,
  readiness,
  role,
  actorId,
  onChanged,
  onList,
  initialStep,
}: {
  api: ContractClient;
  contract: ContractView;
  readiness: Readiness | null;
  role: string;
  actorId: string;
  onChanged: () => void;
  onList: () => void;
  initialStep?: number;
}) {
  const state = rentalContractState(contract, readiness);
  const [step, setStep] = useState(initialStep ?? state.current);
  const [selected, setSelected] = useState('');
  const [details, setDetails] = useState(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const actions = contractActions(contract, null, role, actorId);
  const action = actions.find((item) => item.operation === selected);
  const signingFinished =
    state.signed ||
    (contract.isDevelopmentDemo &&
      [contract.ownerSignerId, contract.tenantUserId].every(
        (id) =>
          id &&
          contract.signatures.some(
            (signature) => signature.signerUserId === id && signature.status === 'Simulated',
          ),
      ));
  const representative = contract.occupants?.find((person) => person.representative)?.label;
  const signer =
    ['Owner', 'Tenant'].includes(role) &&
    [contract.ownerSignerId, contract.tenantUserId].includes(actorId);
  function navigate(next: number) {
    setSelected('');
    setStep(next);
  }
  const operations =
    step === 1
      ? ['signing', 'signing/sync', 'signing/recover']
      : step === 2
        ? ['deposit-verifications']
        : step === 3
          ? ['activate']
          : [];
  return (
    <View style={styles.flow}>
      <RentalContractStepper current={state.active ? 3 : step} completed={state.completed} />
      <Box>
        <View style={styles.row}>
          <Text style={styles.title}>
            {state.active ? 'Hợp đồng đã được kích hoạt' : `Phòng ${contract.roomNumber ?? '—'}`}
          </Text>
          <Pill tone={state.active ? 'green' : 'amber'}>{text(contract.status)}</Pill>
        </View>
        <Text style={ui.muted}>{contract.locationName}</Text>
        <Value label="Đại diện" value={representative ?? 'Theo hồ sơ hợp đồng'} />
        <Value
          label="Thời hạn"
          value={`${displayContractDate(contract.startDate)} – ${displayContractDate(contract.endDate)}`}
        />
        <Value label="Giá thuê" value={`${formatContractMoney(contract.monthlyRent)} / tháng`} />
        {state.active && (
          <Text style={styles.success}>Máy chủ đã xác nhận kích hoạt hợp đồng.</Text>
        )}
        {contract.isDevelopmentDemo && (
          <Pill tone="amber">Môi trường thử nghiệm · Chữ ký mô phỏng</Pill>
        )}
      </Box>
      {state.active ? (
        <>
          <Box>
            <Heading title="Trạng thái hoàn tất" />
            <Check
              label="Chữ ký hai bên"
              done={state.signed}
              fallback="Xem bằng chứng ký của hợp đồng"
            />
            <Check label="Kích hoạt hợp đồng" done />
            <Text style={ui.muted}>Thông tin cọc và bằng chứng được lưu trong hồ sơ hợp đồng.</Text>
          </Box>
          {details && (
            <Box>
              <Heading title="Chi tiết hợp đồng" />
              <Value label="Cọc yêu cầu" value={formatContractMoney(contract.requiredDeposit)} />
              <Text>{contract.terms}</Text>
            </Box>
          )}
          <Action secondary onPress={() => setDetails((value) => !value)}>
            Xem chi tiết hợp đồng
          </Action>
          <Action onPress={onList}>Quay về danh sách hợp đồng</Action>
        </>
      ) : (
        <>
          {step === 0 && (
            <>
              <Box>
                <Heading title="Nội dung hợp đồng" />
                <Text>{contract.terms}</Text>
              </Box>
              <ContractWorkflowPanel
                api={api}
                contract={contract}
                role={role}
                section="documents"
                showDeposits={false}
              />
            </>
          )}
          {step === 1 && (
            <>
              <Box>
                <Heading
                  title="Ký hợp đồng"
                  detail={
                    contract.isDevelopmentDemo
                      ? 'Mô phỏng Development'
                      : contract.signingMode === 'INTERNAL_OTP_DRAWN'
                        ? 'OTP và chữ ký xác nhận'
                        : 'Ký số qua nhà cung cấp đã cấu hình'
                  }
                />
                {[
                  { key: contract.ownerSignerId, label: 'Chủ cơ sở', value: state.owner },
                  { key: contract.tenantUserId, label: 'Người thuê đại diện', value: state.tenant },
                ].map((person) => (
                  <View key={person.key} style={styles.signer}>
                    <Text style={styles.signerLabel}>{person.label}</Text>
                    <Pill tone={person.value === 'signed' ? 'green' : 'amber'}>
                      {person.value === 'signed'
                        ? 'Đã ký'
                        : person.value === 'waiting'
                          ? 'Đang chờ ký'
                          : contract.isDevelopmentDemo &&
                              contract.signatures.some(
                                (signature) =>
                                  signature.signerUserId === person.key &&
                                  signature.status === 'Simulated',
                              )
                            ? 'Đã mô phỏng'
                            : 'Chờ ký'}
                    </Pill>
                  </View>
                ))}
                <Text style={ui.muted}>
                  {contract.isDevelopmentDemo
                    ? signingFinished
                      ? 'Hai bên đã mô phỏng ký. Tiếp tục kiểm tra điều kiện thử nghiệm.'
                      : 'Ký mô phỏng trong môi trường Development.'
                    : state.signed
                      ? 'Hai bên đã ký. Tiếp tục kiểm tra tiền cọc.'
                      : state.owner === 'signed' || state.tenant === 'signed'
                        ? 'Chờ bên còn lại ký hợp đồng.'
                        : 'Thực hiện ký theo phương thức được cấu hình cho hợp đồng.'}
                </Text>
                {role === 'Staff' && (
                  <Text style={ui.muted}>
                    Staff theo dõi hồ sơ; Chủ cơ sở và Người thuê thực hiện ký.
                  </Text>
                )}
                {signer && !contract.isDevelopmentDemo && <SigningCertificates api={api} />}
                {signer &&
                  contract.signatures.some((signature) =>
                    ['Signed', 'Simulated'].includes(signature.status),
                  ) && <ContractEvidence api={api} contractId={contract.id} pdf />}
              </Box>
            </>
          )}
          {step === 2 && (
            <>
              <Box>
                <Heading title="Tiền cọc hợp đồng" />
                <Value label="Cọc yêu cầu" value={formatContractMoney(contract.requiredDeposit)} />
                <Value
                  label="Cọc giữ chỗ áp dụng"
                  value={formatContractMoney(contract.appliedHoldingDeposit)}
                />
                {readiness && (
                  <>
                    <Value
                      label="Đã xác minh"
                      value={formatContractMoney(readiness.verifiedDeposit)}
                    />
                    <Value
                      label="Còn thiếu"
                      value={formatContractMoney(readiness.remainingDeposit)}
                    />
                  </>
                )}
                <Pill tone={state.depositVerified ? 'green' : 'amber'}>
                  {state.depositVerified ? 'Đã đối chiếu đủ cọc' : 'Chờ xác nhận thanh toán'}
                </Pill>
              </Box>
              <Box style={styles.qr}>
                <Icon source="qrcode" size={48} color={c.muted} />
                <Text style={styles.title}>Chưa có QR tiền cọc</Text>
                <Text style={styles.center}>
                  Hợp đồng chưa có hướng dẫn chuyển cọc và mã tham chiếu từ máy chủ. Liên hệ chủ cơ
                  sở để nhận thông tin thanh toán.
                </Text>
                <Text style={styles.center}>
                  Chủ cơ sở đối chiếu sao kê trước khi xác minh cọc.
                </Text>
              </Box>
            </>
          )}
          {step === 3 && (
            <Box>
              <Heading title="Điều kiện kích hoạt" />
              <Check
                label="Hai bên đã ký"
                done={state.signed}
                fallback="Chưa đủ chữ ký đã xác minh"
              />
              <Check
                label="Đã xác minh tiền cọc"
                done={state.depositVerified}
                fallback={readiness ? 'Chưa đối chiếu đủ cọc' : 'Chưa có thông tin đối chiếu cọc'}
              />
              {readiness?.blockers.map((blocker) => (
                <Check key={blocker} label={text(blocker)} done={false} />
              ))}
              {readiness?.ready && <Pill tone="green">Đủ điều kiện để Chủ cơ sở kích hoạt</Pill>}
              {role !== 'Owner' && (
                <Text style={ui.muted}>Chủ cơ sở kiểm tra và kích hoạt hợp đồng.</Text>
              )}
            </Box>
          )}
          {!action &&
            actions
              .filter((item) => operations.includes(item.operation))
              .map((item) => (
                <Action
                  key={item.operation}
                  disabled={item.operation === 'activate' && !readiness?.ready}
                  onPress={() => setSelected(item.operation)}
                >
                  {item.label}
                </Action>
              ))}
          {action && (
            <ContractActionForm
              key={action.operation}
              api={api}
              action={action}
              contract={contract}
              keys={keys}
              evidenceIds={[]}
              onCancel={() => {
                setSelected('');
              }}
              onSuccess={() => {
                setSelected('');
                onChanged();
              }}
            />
          )}
          <View style={styles.footer}>
            {step > 0 && (
              <Button disabled={!!action} onPress={() => navigate(step - 1)}>
                Quay lại
              </Button>
            )}
            {step < 3 && (
              <Button
                style={ui.grow}
                mode="contained"
                buttonColor={c.blue}
                disabled={!!action || (step === 1 && !signingFinished)}
                contentStyle={{ minHeight: 48 }}
                onPress={() => navigate(step + 1)}
              >
                {step === 0
                  ? 'Tiếp tục ký hợp đồng'
                  : step === 1
                    ? 'Tiếp tục'
                    : 'Kiểm tra kích hoạt'}
              </Button>
            )}
            {step === 3 && <Button onPress={onChanged}>Tải lại điều kiện</Button>}
          </View>
        </>
      )}
    </View>
  );
}
function Value({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.valueRow}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}
function Check({ label, done, fallback }: { label: string; done: boolean; fallback?: string }) {
  return (
    <View style={styles.valueRow}>
      <Icon
        source={done ? 'check-circle-outline' : 'clock-outline'}
        color={done ? c.green : c.amber}
        size={20}
      />
      <Text style={ui.grow}>{done ? label : (fallback ?? label)}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  flow: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { color: c.navy, fontSize: 16, lineHeight: 23, fontWeight: '600', flexShrink: 1 },
  valueRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  value: { flex: 1, minWidth: 0, textAlign: 'right', color: c.ink, fontSize: 14, lineHeight: 20 },
  signer: {
    backgroundColor: c.background,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signerLabel: { flex: 1, minWidth: 0 },
  success: { color: c.green, fontSize: 14 },
  qr: { alignItems: 'center', paddingVertical: 24 },
  center: { color: c.muted, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'center' },
});
