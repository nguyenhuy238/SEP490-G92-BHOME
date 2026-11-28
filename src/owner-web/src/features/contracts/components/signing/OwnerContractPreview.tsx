import { useState } from 'react';
import { Alert, Button, LinearProgress, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  contractError,
  type ContractClient,
  type ContractView,
  type PreviewDocument,
} from '../../../../../../../packages/client-core/src/contracts';
import { mainDraftMessages } from '../../../../../../../packages/client-core/src/mainDrafts';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { ContractDocumentViewer } from './ContractDocumentViewer';
import { contractPdfName } from '../../../../../../../packages/client-core/src/contractPdfName';

export function OwnerContractPreview({
  api,
  contract,
  accepted = false,
}: {
  api: ContractClient;
  contract: ContractView;
  accepted?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const signed =
    accepted || contract.signatures.some((s) => ['Signed', 'Simulated'].includes(s.status));
  const query = useQuery({
    queryKey: ['owner-contract-pdf', contract.id, contract.snapshotHash, signed],
    enabled: opened,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      if (signed) return api.document(contract.id, signal);
      const file = await api.mutate<PreviewDocument>(
        contract.id,
        'previews',
        undefined,
        crypto.randomUUID(),
      );
      return api.preview(contract.id, file.id, signal);
    },
  });
  const url = useObjectUrl(
    `owner-pdf:${contract.id}:${contract.snapshotHash}:${query.dataUpdatedAt}`,
    query.data ? async () => query.data! : null,
  );
  const message = query.error
    ? mainDraftMessages[(query.error as { code?: string }).code ?? ''] || contractError(query.error)
    : '';
  return (
    <Stack spacing={1}>
      <Button
        variant="outlined"
        disabled={query.isFetching}
        onClick={() => {
          if (opened) void query.refetch();
          else setOpened(true);
        }}
      >
        Xem PDF hợp đồng
      </Button>
      {query.isFetching && <LinearProgress aria-label="Đang tải PDF hợp đồng" />}
      {!!message && <Alert severity="error">{message}</Alert>}
      {url && (
        <ContractDocumentViewer
          title="PDF hợp đồng Owner xem trước"
          url={url}
          filename={contractPdfName(contract.kind, contract.id)}
        />
      )}
    </Stack>
  );
}
