import { Alert, Paper, Stack, Typography } from '@mui/material';
import {
  contractError,
  formatContractMoney,
  type ContractClient,
  type SettlementSummary,
} from '../../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../../packages/client-core/src/localization';
import { PrivateEvidenceViewer } from '../../../../components/common/PrivateEvidenceViewer';

// Historical plans remain visible for reconciliation/refund; new liabilities use receivables + offsets.
export function DepositDeductionsPanel({
  summary,
  api,
  contractId,
}: {
  summary: SettlementSummary;
  api?: ContractClient;
  contractId?: string;
}) {
  const plan = summary.depositDeductions;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Hồ sơ khấu trừ cọc cũ · chỉ đọc</Typography>
        <Alert severity="info">
          Thiệt hại mới được ghi thành khoản phải thu riêng; sau đó Owner duyệt cấn trừ cọc tại mục
          Khoản phải thu và cấn trừ. Giữ nguyên quyết định cũ để đối chiếu và xử lý phần cọc còn
          lại.
        </Alert>
        {plan ? (
          <>
            <Typography>
              Phiên bản {plan.version} · Đã duyệt: {formatContractMoney(plan.total)} ·{' '}
              {formatInstant(plan.approvedAt)}
            </Typography>
            <Typography>{plan.reason}</Typography>
            {plan.items.map((item, index) => (
              <Stack key={index} spacing={0.75}>
                <Typography>
                  {item.description} · {formatContractMoney(item.amount)} ·{' '}
                  {item.evidenceIds.length} ảnh biên bản
                </Typography>
                {api &&
                  contractId &&
                  item.evidenceIds.map((fileId, evidenceIndex) => (
                    <PrivateEvidenceViewer
                      key={fileId}
                      label={`Ảnh biên bản ${index + 1}.${evidenceIndex + 1}`}
                      filename={`bien-ban-khau-tru-${index + 1}-${evidenceIndex + 1}.jpg`}
                      fetchBlob={(signal) => api.evidence(contractId, fileId, signal)}
                      errorMessage={contractError}
                    />
                  ))}
              </Stack>
            ))}
          </>
        ) : (
          <Typography>Chưa có quyết định khấu trừ theo luồng cũ.</Typography>
        )}
      </Stack>
    </Paper>
  );
}
