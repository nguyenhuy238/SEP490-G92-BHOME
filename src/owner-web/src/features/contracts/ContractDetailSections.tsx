import { Alert, Box, LinearProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  text,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { householdClient } from '../../../../../packages/client-core/src/households';
import { formatInstant } from '../../../../../packages/client-core/src/localization';

function maskCitizenNumber(value?: string | null) {
  if (!value) return 'Chưa có thông tin';
  if (/[*•xX]/.test(value)) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length > 4 ? `••••••••${digits.slice(-4)}` : '••••';
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ minWidth: 0 }}>
      <Typography component="h3" sx={{ fontSize: 16, fontWeight: 650, mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export function DetailFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(100px, 1fr) minmax(0, 1.5fr)',
        gap: 1.5,
      }}
    >
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{ m: 0, textAlign: 'right', overflowWrap: 'anywhere' }}
          >
            {value || 'Chưa có thông tin'}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function ContractPaymentHistory({ api, id }: { api: ContractClient; id: string }) {
  const query = useQuery({
    queryKey: ['contract-deposit-history', id],
    queryFn: ({ signal }) => api.deposits(id, signal),
  });
  return (
    <DetailSection title="Lịch sử giao dịch đã xác minh">
      {query.isPending && <LinearProgress aria-label="Đang tải giao dịch" />}
      {query.error && <Alert severity="error">{contractError(query.error)}</Alert>}
      {query.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Chưa có khoản cọc được xác minh.
        </Typography>
      )}
      <Stack spacing={2} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {query.data?.map((payment) => (
          <Box
            component="li"
            key={payment.id}
            sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}
          >
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 650 }}>
                {formatContractMoney(payment.amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatInstant(payment.verifiedAt)}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mt: 0.5 }}>
              Mã giao dịch: {payment.bankTransactionReference}
            </Typography>
            {payment.verificationReason && (
              <Typography variant="body2" color="text.secondary">
                {payment.verificationReason}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </DetailSection>
  );
}

export function ContractPeople({
  api,
  contract: c,
}: {
  api: ContractClient;
  contract: ContractView;
}) {
  const query = useQuery({
    queryKey: ['contract-household', c.id],
    queryFn: ({ signal }) => householdClient(api.transport).contract(c.id, signal),
    enabled: c.kind !== 'Holding' && typeof api.transport === 'function',
    retry: false,
  });
  const primary = query.data?.representative;
  const representative =
    primary?.fullName ||
    c.holdingCustomer?.fullName ||
    c.occupants?.find((person) => person.representative)?.label;
  return (
    <Stack spacing={3}>
      <DetailSection title="Người đại diện">
        {query.isFetching && <LinearProgress aria-label="Đang tải người thuê" />}
        {query.error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {contractError(query.error)}
          </Alert>
        )}
        <DetailFacts
          rows={[
            ['Họ và tên', representative || 'Chưa có thông tin'],
            [
              'Số CCCD',
              primary?.maskedCitizenNumber ||
                c.holdingCustomer?.maskedCitizenNumber ||
                'Chưa có thông tin',
            ],
            [
              'Ngày sinh',
              primary?.dateOfBirth ? displayContractDate(primary.dateOfBirth) : 'Chưa có thông tin',
            ],
            ['Số điện thoại', primary?.phone || 'Chưa có thông tin'],
          ]}
        />
      </DetailSection>
      <DetailSection title="Người ở cùng">
        {query.data?.members?.length ? (
          <Stack spacing={2}>
            {query.data.members.map((member) => (
              <Box key={member.residentId} sx={{ pb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <DetailFacts
                  rows={[
                    ['Họ và tên', member.fullName],
                    ['Quan hệ', member.relationship],
                    ['Ngày sinh', displayContractDate(member.dateOfBirth)],
                    ['Số điện thoại', member.phone || 'Chưa có thông tin'],
                    ['Số CCCD', maskCitizenNumber(member.citizenNumber)],
                  ]}
                />
              </Box>
            ))}
          </Stack>
        ) : c.occupants?.some((person) => !person.representative) ? (
          <Stack spacing={1}>
            {c.occupants
              .filter((person) => !person.representative)
              .map((person) => (
                <Typography variant="body2" key={person.id}>
                  {person.label}
                </Typography>
              ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Chưa có người ở cùng được ghi nhận.
          </Typography>
        )}
      </DetailSection>
    </Stack>
  );
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    ContractCreated: 'Tạo hợp đồng',
    HoldingCreated: 'Tạo hợp đồng giữ chỗ',
    ContractActivated: 'Kích hoạt hợp đồng',
    HoldingActivated: 'Kích hoạt giữ chỗ',
    HoldingConverted: 'Chuyển sang hợp đồng thuê',
    ContractConverted: 'Chuyển đổi hợp đồng',
    ContractSigned: 'Ký hợp đồng',
    DepositVerified: 'Xác nhận tiền cọc',
    ContractCancelled: 'Hủy hợp đồng',
    ContractTerminated: 'Kết thúc hợp đồng',
  };
  const translated = text(action);
  return labels[action] || (translated !== action ? translated : 'Cập nhật hợp đồng');
}

export function ContractEventHistory({
  api,
  contract: c,
  actorId,
}: {
  api: ContractClient;
  contract: ContractView;
  actorId: string;
}) {
  const query = useQuery({
    queryKey: ['contract-audit', c.id, c.status],
    queryFn: ({ signal }) => api.audit(c.id, signal),
  });
  return (
    <DetailSection title="Lịch sử hợp đồng">
      {query.isPending && <LinearProgress aria-label="Đang tải lịch sử" />}
      {query.error && <Alert severity="error">{contractError(query.error)}</Alert>}
      {query.data?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Chưa có sự kiện được ghi nhận.
        </Typography>
      )}
      <Stack component="ol" spacing={2.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {query.data &&
          [...query.data]
            .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
            .map((event, index) => (
              <Box
                component="li"
                key={`${event.action}:${event.occurredAt}:${index}`}
                sx={{ pl: 2, borderLeft: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {eventLabel(event.action)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatInstant(event.occurredAt)}
                  {event.actorId
                    ? ` · ${event.actorId === actorId ? 'Bạn' : event.actorId === c.ownerSignerId ? 'Chủ nhà' : event.actorId === c.tenantUserId ? 'Người thuê' : 'Người dùng được phân quyền'}`
                    : ''}
                </Typography>
              </Box>
            ))}
      </Stack>
    </DetailSection>
  );
}

export function ContractRelatedVersions({
  api,
  id,
  onOpen,
}: {
  api: ContractClient;
  id: string;
  onOpen: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ['contract-versions', id],
    queryFn: ({ signal }) => api.versions(id, signal),
  });
  return (
    <DetailSection title="Hợp đồng và phụ lục liên quan">
      {query.isPending && <LinearProgress aria-label="Đang tải phụ lục" />}
      {query.error && <Alert severity="error">{contractError(query.error)}</Alert>}
      {query.data?.filter((version) => version.id !== id).length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Chưa có hợp đồng hoặc phụ lục liên quan.
        </Typography>
      )}
      <Stack spacing={1.5}>
        {query.data
          ?.filter((version) => version.id !== id)
          .map((version) => (
            <Box key={version.id}>
              <Typography
                component="button"
                onClick={() => onOpen(version.id)}
                sx={{
                  border: 0,
                  bgcolor: 'transparent',
                  p: 0,
                  cursor: 'pointer',
                  color: 'primary.main',
                  textAlign: 'left',
                  fontSize: 14,
                }}
              >
                {text(version.kind)} · {text(version.status)}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">
                {displayContractDate(version.startDate)} – {displayContractDate(version.endDate)}
              </Typography>
            </Box>
          ))}
      </Stack>
    </DetailSection>
  );
}
