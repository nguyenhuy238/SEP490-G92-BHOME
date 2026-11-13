import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import {
  contractActions,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type Readiness,
} from '../../../../../packages/client-core/src/contracts';
import type { InternalSigningStatus } from '../../../../../packages/client-core/src/internalSigning';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from './ownerQueryPolicy';
import { OwnerHoldingSigning } from './OwnerHoldingSigning';
import { RentalContractStepper } from '../contracts/RentalContractStepper';
import { rentalContractState } from '../contracts/rentalContractState';
import { ContractActionForm } from '../contracts/ContractActionForm';
import { ContractWorkflowPanel } from '../contracts/ContractWorkflowPanel';
import { randomUUID } from '../../lib/randomUUID';
import { useSession } from '../../lib/SessionProvider';

import { ownerContractSteps } from './ownerContractSteps';
export function OwnerMainContractFlow({
  api,
  contract,
  readiness,
  actorId,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  readiness: Readiness | null;
  actorId: string;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const server = rentalContractState(contract, readiness);
  const internal = contract.signingMode === 'INTERNAL_OTP_DRAWN';
  const consent = useWorkspaceQuery<InternalSigningStatus>(
    internal ? `/api/v1/contracts/${contract.id}/internal-signing` : null,
    { cache: ownerQueuePolicy },
  );
  const ownerSigned = internal ? !!consent.data?.ownerAcceptedAt : server.owner === 'signed';
  const tenantSigned = internal ? !!consent.data?.tenantAcceptedAt : server.tenant === 'signed';
  const completed = [
    ...server.completed.filter((key) => key !== 'sign'),
    ...(ownerSigned && tenantSigned ? ['sign'] : []),
  ];
  const [step, setStep] = useState(server.active ? 3 : server.current),
    [selected, setSelected] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  if (!session?.roles.includes('Owner')) return null;
  const operations =
    step === 1
      ? ['signing', 'signing/sync', 'signing/recover']
      : step === 2
        ? ['deposit-verifications']
        : step === 3
          ? ['activate']
          : [];
  const actions = contractActions(contract, null, 'Owner', actorId).filter((action) =>
    operations.includes(action.operation),
  );
  const action = actions.find((item) => item.operation === selected);
  return (
    <>
      <RentalContractStepper
        current={server.active ? 3 : step}
        completed={completed}
        steps={ownerContractSteps}
      />
      <Text style={ui.muted}>
        Duyệt đưa đi ký chưa phải chữ ký. Kích hoạt chỉ sau khi máy chủ xác nhận đủ điều kiện.
      </Text>
      {step === 0 && (
        <ContractWorkflowPanel
          api={api}
          contract={contract}
          role="Owner"
          section="documents"
          showDeposits={false}
        />
      )}
      {step === 1 && (
        <>
          <Box>
            <Heading
              title="Chữ ký các bên"
              detail={
                internal
                  ? 'Chấp thuận nội bộ qua email và OTP'
                  : contract.isDevelopmentDemo
                    ? 'Ký mô phỏng Development'
                    : 'Chữ ký số MySign'
              }
            />
            <Text>Hồ sơ đã được chuyển sang chờ ký; chưa đồng nghĩa hai bên đã ký.</Text>
            <Text>Owner: {ownerSigned ? 'Đã xác minh' : 'Chờ xác nhận ký'}</Text>
            <Text>Người đại diện: {tenantSigned ? 'Đã xác minh' : 'Chờ xác nhận ký'}</Text>
            {consent.error && <Text style={ui.red}>{consent.error}</Text>}
            {!internal && (
              <Text>
                Gửi yêu cầu → xác nhận trên MySign → kiểm tra kết quả ký. Chỉ kết quả đã xác minh
                mới được ghi nhận.
              </Text>
            )}
          </Box>
          {internal && <OwnerHoldingSigning api={api} contract={contract} onChanged={onChanged} />}
        </>
      )}
      {step === 2 && (
        <Box>
          <Heading title="Tiền cọc / Mã QR" />
          <Text>Cọc yêu cầu: {formatContractMoney(contract.requiredDeposit)}</Text>
          <Text>Cọc giữ chỗ áp dụng: {formatContractMoney(contract.appliedHoldingDeposit)}</Text>
          {readiness ? (
            <>
              <Text>Đã xác minh: {formatContractMoney(readiness.verifiedDeposit)}</Text>
              <Text>Còn thiếu: {formatContractMoney(readiness.remainingDeposit)}</Text>
            </>
          ) : (
            <Text>Chưa có đối chiếu cọc hiện tại.</Text>
          )}
          <Pill>{server.depositVerified ? 'Đã đối chiếu đủ cọc' : 'Chờ xác minh cọc'}</Pill>
          <Text>
            API hiện tại chưa cấp QR nộp cọc hợp đồng. Dùng thông tin ngân hàng đã được Owner xác
            nhận; không dùng QR hóa đơn thay cọc.
          </Text>
        </Box>
      )}
      {step === 3 && (
        <Box>
          <Heading title="Điều kiện kích hoạt" />
          <Text>Owner: {ownerSigned ? 'Đã xác minh ký' : 'Chưa xác minh ký'}</Text>
          <Text>Người đại diện: {tenantSigned ? 'Đã xác minh ký' : 'Chưa xác minh ký'}</Text>
          <Text>Cọc: {server.depositVerified ? 'Đã đối chiếu đủ' : 'Chưa đủ đối chiếu'}</Text>
          {readiness?.blockers.map((blocker) => (
            <Text key={blocker} style={ui.red}>
              {text(blocker)}
            </Text>
          ))}
          {server.active && <Pill tone="green">Máy chủ đã xác nhận hợp đồng đang hiệu lực</Pill>}
        </Box>
      )}
      {!action &&
        actions.map((item) => (
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
          api={api}
          action={action}
          contract={contract}
          keys={keys}
          evidenceIds={[]}
          onCancel={() => setSelected('')}
          onSuccess={() => {
            setSelected('');
            onChanged();
          }}
        />
      )}
      {!action && (
        <>
          {step > 0 && (
            <Action secondary onPress={() => setStep((value) => value - 1)}>
              Bước trước
            </Action>
          )}
          {step < 3 && (
            <Action onPress={() => setStep((value) => value + 1)}>
              {step === 0
                ? 'Xem trạng thái ký'
                : step === 1
                  ? 'Xem tiền cọc'
                  : 'Kiểm tra kích hoạt'}
            </Action>
          )}
        </>
      )}
    </>
  );
}
