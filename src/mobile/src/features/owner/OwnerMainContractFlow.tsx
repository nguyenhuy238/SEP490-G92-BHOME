import React, { useState } from 'react';
import { Text } from 'react-native-paper';
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
import type { InternalSigningStatus } from '../../../../../packages/client-core/src/internalSigning';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from './ownerQueryPolicy';
import { OwnerHoldingSigning } from './OwnerHoldingSigning';
import { RentalContractStepper } from '../contracts/RentalContractStepper';
import { rentalContractState } from '../contracts/rentalContractState';
import { ContractActionForm, SigningCertificates } from '../contracts/ContractActionForm';
import { ContractWorkflowPanel } from '../contracts/ContractWorkflowPanel';
import { randomUUID } from '../../lib/randomUUID';
import { useSession } from '../../lib/SessionProvider';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';

import { ownerContractSteps } from './ownerContractSteps';
const signingStatusPolicy = { ...ownerQueuePolicy, staleTime: 0 };
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
  const mySign = !internal && ['', 'MYSIGN', 'MYSIGN_SANDBOX'].includes(contract.signingMode ?? '');
  const consent = useWorkspaceQuery<InternalSigningStatus>(
    internal ? `/api/v1/contracts/${contract.id}/internal-signing` : null,
    { cache: signingStatusPolicy },
  );
  const ownerSigned = internal ? !!consent.data?.ownerAcceptedAt : server.owner === 'signed';
  const tenantSigned = internal ? !!consent.data?.tenantAcceptedAt : server.tenant === 'signed';
  const completed = [
    ...server.completed.filter((key) => key !== 'sign'),
    ...(ownerSigned && tenantSigned ? ['sign'] : []),
  ];
  const [selectedStep, setSelectedStep] = useState<number | null>(null),
    [selected, setSelected] = useState('');
  const currentStep =
    ownerSigned && tenantSigned ? (server.depositVerified ? 3 : 2) : server.current;
  const step = server.active ? 3 : (selectedStep ?? currentStep);
  const [keys] = useState(() => mutationKeys(randomUUID));
  if (!session?.roles.includes('Owner')) return null;
  const operations =
    step === 1 && mySign
      ? ['signing', 'signing/sync', 'signing/recover']
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
      <Box>
        <Heading title={`Phòng ${contract.roomNumber ?? '—'}`} detail={contract.locationName} />
        <Text>
          {displayContractDate(contract.startDate)} – {displayContractDate(contract.endDate)}
        </Text>
        <Text>
          Đại diện:{' '}
          {contract.occupants?.find((person) => person.representative)?.label ??
            'Theo hồ sơ hợp đồng'}
        </Text>
        <Text>{formatContractMoney(contract.monthlyRent)} / tháng</Text>
      </Box>
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
                  : !mySign
                    ? 'Phương thức ký chưa được hỗ trợ'
                    : contract.isDevelopmentDemo
                      ? 'Ký mô phỏng Development'
                      : 'Chữ ký số MySign'
              }
            />
            <Text>Hồ sơ đã được chuyển sang chờ ký; chưa đồng nghĩa hai bên đã ký.</Text>
            <Text>Owner: {ownerSigned ? 'Đã xác minh' : 'Chờ xác nhận ký'}</Text>
            <Text>Người đại diện: {tenantSigned ? 'Đã xác minh' : 'Chờ xác nhận ký'}</Text>
            {!!consent.error && <Text style={ui.red}>{consent.error}</Text>}
            {!internal && mySign && (
              <Text>
                Gửi yêu cầu → xác nhận trên MySign → kiểm tra kết quả ký. Chỉ kết quả đã xác minh
                mới được ghi nhận.
              </Text>
            )}
          </Box>
          {internal && (
            <OwnerHoldingSigning
              api={api}
              contract={contract}
              onChanged={() => {
                consent.reload();
                setSelectedStep(null);
                onChanged();
              }}
            />
          )}
          {mySign && actorId === contract.ownerSignerId && !contract.isDevelopmentDemo && (
            <SigningCertificates api={api} />
          )}
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
            Tiền cọc được cập nhật sau khi giao dịch được xác minh. Kiểm tra lại trạng thái trước
            khi kích hoạt.
          </Text>
        </Box>
      )}
      {step === 3 && (
        <Box>
          <Heading title="Điều kiện kích hoạt" />
          <Text>Owner: {ownerSigned ? 'Đã xác minh ký' : 'Chưa xác minh ký'}</Text>
          <Text>Người đại diện: {tenantSigned ? 'Đã xác minh ký' : 'Chưa xác minh ký'}</Text>
          <Text>
            Cọc:{' '}
            {readiness
              ? server.depositVerified
                ? 'Đã đối chiếu đủ'
                : 'Chưa đủ đối chiếu'
              : 'Xem hồ sơ cọc để đối chiếu'}
          </Text>
          {readiness?.blockers.map((blocker) => (
            <Text key={blocker} style={ui.red}>
              {text(blocker)}
            </Text>
          ))}
          {server.active && <Pill tone="green">Máy chủ đã xác nhận hợp đồng đang hiệu lực</Pill>}
        </Box>
      )}
      {step === 2 && !server.depositVerified && (
        <OwnerWebNotice task="Đối soát và xác minh tiền cọc" />
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
            setSelectedStep(null);
            onChanged();
          }}
        />
      )}
      {!action && (
        <>
          {step > 0 && (
            <Action secondary onPress={() => setSelectedStep(step - 1)}>
              Bước trước
            </Action>
          )}
          {step < 3 && (
            <Action onPress={() => setSelectedStep(step + 1)}>
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
