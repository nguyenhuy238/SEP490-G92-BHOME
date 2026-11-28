import { demoBusinessNow } from '../../../../../../packages/client-core/src/demoClock';
import { ContractNotice } from '../ContractNotice';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Text } from 'react-native-paper';
import { ChoiceField } from '../../../components/WorkflowControls';
import { Box } from '../../../components/WorkspaceKit';
import {
  contractError,
  formatContractMoney,
  type ContractClient,
  type ContractView,
} from '../../../../../../packages/client-core/src/contracts';
import {
  mainDraftClient,
  type MainDraftPreparation,
} from '../../../../../../packages/client-core/src/mainDrafts';
import { randomUUID } from '../../../lib/randomUUID';

// Reuse the existing Holding conversion: residents, verified identities, signed prices
// and deposit allocation remain linked to the original Holding on the server.
export function HoldingMainStart({
  api,
  locationId,
  roomId,
  onConverted,
}: {
  api: ContractClient;
  locationId: string;
  roomId: string;
  onConverted: (id: string) => void;
}) {
  const [listing, setListing] = useState<{
    room: string;
    location: string;
    rows: ContractView[];
    preparations: Record<string, { data: MainDraftPreparation | null; error: string }>;
    error: string;
  } | null>(null);
  const [selected, setSelected] = useState('');
  const [revision, setRevision] = useState(0);
  const currentListing =
    listing?.room === roomId && listing.location === locationId ? listing : null;
  const holdings = currentListing?.rows ?? [];
  const loading = !currentListing;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const key = useRef(randomUUID());
  const keyFor = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const rows: ContractView[] = [];
        for (let page = 1; ; page++) {
          const result = await api.list(page, 'Active', locationId, controller.signal);
          const candidates = result.items.filter(
            (c) =>
              c.kind === 'Holding' &&
              c.roomId === roomId &&
              Date.parse(c.holdingExpiresAt ?? '') > demoBusinessNow(),
          );
          const details = await Promise.all(candidates.map((c) => api.get(c.id)));
          rows.push(...details.filter((c) => !c.convertedMainContractId));
          if (page * result.pageSize >= result.totalCount) break;
        }
        if (controller.signal.aborted) return;
        const preparations = Object.fromEntries(
          await Promise.all(
            rows.map(async (c) => {
              try {
                const data = await mainDraftClient(api.transport).prepare(
                  {
                    roomId,
                    representativeResidentId: c.representativeResidentId,
                    residentIds: c.residentIds,
                    startDate: c.startDate,
                  },
                  controller.signal,
                );
                return [c.id, { data, error: '' }] as const;
              } catch (e) {
                return [c.id, { data: null, error: contractError(e) }] as const;
              }
            }),
          ),
        );
        if (controller.signal.aborted) return;
        setListing({ room: roomId, location: locationId, rows, preparations, error: '' });
      } catch (e) {
        if (!controller.signal.aborted)
          setListing({
            room: roomId,
            location: locationId,
            rows: [],
            preparations: {},
            error: contractError(e),
          });
      }
    })();
    return () => controller.abort();
  }, [api, locationId, roomId, revision]);
  const holding =
    holdings.find((c) => c.id === selected) ?? (holdings.length === 1 ? holdings[0] : undefined);
  const prepared = holding ? currentListing?.preparations[holding.id] : null;
  const preparation = prepared?.data;
  const securityDeposit = holding?.requiredDeposit ?? '';
  const validDeposit = /^\d{1,18}$/.test(securityDeposit);
  const displayedError =
    error ||
    currentListing?.error ||
    prepared?.error ||
    (holding && preparation && !validDeposit
      ? 'Chưa tải được tiền giữ chỗ. Vui lòng tải lại hợp đồng.'
      : '');
  async function convert() {
    if (lock.current || !holding || !preparation || !validDeposit) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const requestKey = holding.id;
      if (keyFor.current !== requestKey) {
        key.current = randomUUID();
        keyFor.current = requestKey;
      }
      const result = await api.mutate<{ id: string }>(
        holding.id,
        'holding-conversion',
        {
          requireInitialPayment: true,
        },
        key.current,
      );
      onConverted(result.id);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box>
      <Text variant="titleMedium">Tạo hợp đồng từ phòng đang giữ chỗ</Text>
      <Text>Hồ sơ CCCD đã xác minh và tiền giữ chỗ được dùng lại từ hợp đồng đã chọn.</Text>
      <ChoiceField
        label="Hợp đồng giữ chỗ đang hiệu lực"
        value={holding?.id ?? selected}
        options={holdings.map((c) => ({
          id: c.id,
          label: `${currentListing?.preparations[c.id]?.data?.residents.find((p) => p.id === c.representativeResidentId)?.fullName || 'Chưa tải được tên người giữ chỗ'} · ${c.roomNumber || 'Phòng đã chọn'}`,
        }))}
        disabled={loading || busy}
        onChange={(id) => {
          setSelected(id);
          key.current = randomUUID();
          setError('');
        }}
      />
      {loading && <Text>Đang tải hợp đồng và hồ sơ người giữ chỗ…</Text>}
      {!loading && !holdings.length && !currentListing?.error && (
        <Text>
          Không có hợp đồng giữ chỗ còn hiệu lực phù hợp. Không tạo hồ sơ mới cho phòng này.
        </Text>
      )}
      {preparation?.residents.map((person) => (
        <Text key={person.id}>
          {person.fullName} · CCCD {person.maskedCitizenNumber} · Đã xác minh
        </Text>
      ))}
      {holding && preparation && (
        <>
          <Text>Tiền cọc đảm bảo: {formatContractMoney(securityDeposit)}</Text>
          <Text>Áp dụng từ tiền giữ chỗ của hợp đồng đã chọn.</Text>
        </>
      )}
      {!!displayedError && <ContractNotice message={displayedError} />}
      {!!displayedError && (
        <Button
          disabled={busy}
          onPress={() => {
            setError('');
            setListing(null);
            setRevision((before) => before + 1);
          }}
        >
          Tải lại hợp đồng
        </Button>
      )}
      <Button
        mode="contained"
        loading={busy}
        disabled={busy || !holding || !preparation || !validDeposit}
        onPress={() => void convert()}
      >
        Tiếp tục tạo hợp đồng chính thức
      </Button>
    </Box>
  );
}
