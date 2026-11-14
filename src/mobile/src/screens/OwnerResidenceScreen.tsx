import React, { useEffect, useMemo, useState } from 'react';
import { Image } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import {
  residenceClient,
  residenceError,
  residenceImageUri,
  residenceStatus,
  residenceKey,
  type ResidenceClient,
  type ResidencePage,
} from '../../../../packages/client-core/src/residence';
import { useResidenceRecord } from '../../../../packages/client-core/src/useResidenceRecord';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from '../features/owner/ownerQueryPolicy';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { QueryState, Pagination } from '../components/WorkspaceQueryState';

const validId = (value: string | undefined) =>
  !!value &&
  /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value) &&
  !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
export function OwnerResidenceScreen() {
  const { api, session } = useSession();
  const params = useLocalSearchParams<{ residentId?: string; contractId?: string }>();
  const service = useMemo(
    () => (api ? residenceClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  if (!service || !session?.roles.includes('Owner'))
    return <Text>Chỉ Owner được xem và xác nhận hồ sơ này.</Text>;
  if (
    (params.residentId && !validId(params.residentId)) ||
    (params.contractId && !validId(params.contractId))
  )
    return <Text>Tham chiếu hồ sơ không hợp lệ.</Text>;
  return (
    <OwnerResidenceWorkspace
      key={`${session.userId}:${params.contractId}:${params.residentId}`}
      service={service}
      contractId={params.contractId}
      residentId={params.residentId}
    />
  );
}

function OwnerResidenceWorkspace({
  service,
  contractId,
  residentId,
}: {
  service: ResidenceClient;
  contractId?: string;
  residentId?: string;
}) {
  const { go } = useWorkspace();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('Completed'),
    [selectedContract, setSelectedContract] = useState('');
  // A notification identifies the Resident. Resolve compound tenancy IDs through
  // the existing Owner-scoped workspace metadata endpoint, without scanning pages.
  const resident = useWorkspaceQuery<{
    tenancies: { contractId: string; status: string; residenceFrom: string }[];
  }>(residentId && !contractId ? `/api/v1/residents/${residentId}` : null);
  const tenancies = resident.data?.tenancies ?? [];
  const resolvedContract =
    contractId || selectedContract || (tenancies.length === 1 ? tenancies[0]!.contractId : '');
  const list = useWorkspaceQuery<ResidencePage>(
    residentId
      ? null
      : `/api/v1/residence-tasks?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`,
    { cache: ownerQueuePolicy },
  );
  return (
    <>
      <Heading
        title="Kết quả tạm trú"
        detail="Tenant đăng ký bên ngoài qua VNeID; Owner xác nhận kết quả trong BHOME"
      />
      <Action secondary onPress={() => go('approvals')}>
        Về trung tâm phê duyệt
      </Action>
      {residentId ? (
        <>
          {!contractId && <QueryState {...resident} />}
          {tenancies.length > 1 && (
            <ChoiceField
              label="Kỳ cư trú cần xem"
              value={selectedContract}
              options={[
                { id: '', label: 'Chọn kỳ cư trú' },
                ...tenancies.map((value) => ({
                  id: value.contractId,
                  label: `Từ ${displayContractDate(value.residenceFrom)} · ${value.status === 'Active' ? 'Đang thuê' : 'Theo lịch sử hợp đồng'}`,
                })),
              ]}
              onChange={setSelectedContract}
            />
          )}
          {!contractId && resident.data && !tenancies.length && (
            <Text>Không có kỳ cư trú trong phạm vi tài khoản.</Text>
          )}
          {resolvedContract && (
            <OwnerResidenceRecord
              key={`${resolvedContract}/${residentId}`}
              service={service}
              contractId={resolvedContract}
              residentId={residentId}
            />
          )}
        </>
      ) : (
        <>
          <ChoiceField
            label="Trạng thái tạm trú"
            value={status}
            options={[
              { id: '', label: 'Tất cả' },
              ...Object.entries(residenceStatus).map(([id, label]) => ({ id, label })),
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <QueryState {...list} />
          {list.data?.items.length === 0 && <Text>Không có hồ sơ phù hợp.</Text>}
          {list.data?.items.map((item) => (
            <Box key={residenceKey(item)}>
              <Heading title={`${item.residentLabel} · Phòng ${item.roomNumber}`} />
              <Pill>
                {item.ownerConfirmed ? 'Owner đã xác nhận' : residenceStatus[item.status]}
              </Pill>
              <Text>
                Cư trú từ {displayContractDate(item.actualResidenceFrom ?? item.residenceFrom)}
              </Text>
              <Action
                onPress={() =>
                  go('owner-residence', {
                    contractId: item.contractId,
                    residentId: item.residentId,
                  })
                }
              >
                Xem kết quả và minh chứng
              </Action>
            </Box>
          ))}
          {list.data && (
            <Pagination
              page={page}
              total={list.data.totalCount}
              loading={list.loading}
              onChange={setPage}
            />
          )}
        </>
      )}
    </>
  );
}

function OwnerResidenceRecord({
  service,
  contractId,
  residentId,
}: {
  service: ResidenceClient;
  contractId: string;
  residentId: string;
}) {
  const { api } = useSession();
  const record = useResidenceRecord(service, contractId, residentId),
    task = record.task;
  const [note, setNote] = useState(''),
    [checked, setChecked] = useState(false);
  const [photo, setPhoto] = useState<{ task: typeof task; uri: string } | null>(null),
    [photoError, setPhotoError] = useState('');
  const uri = photo?.task === task ? photo.uri : '';
  useEffect(() => {
    if (!task?.hasEvidence) return;
    const controller = new AbortController();
    void service.image(task, controller.signal).then(
      (bytes) => {
        try {
          if (!controller.signal.aborted) {
            setPhoto({ task, uri: residenceImageUri(bytes) });
            setPhotoError('');
          }
        } catch {
          if (!controller.signal.aborted) setPhotoError('Không đọc được ảnh minh chứng.');
        } finally {
          bytes.fill(0);
        }
      },
      (error) => {
        if (!controller.signal.aborted) setPhotoError(residenceError(error));
      },
    );
    return () => controller.abort();
  }, [service, task, record.revision]);
  async function confirm() {
    if (
      !task ||
      task.status !== 'Completed' ||
      !task.hasEvidence ||
      task.ownerConfirmed ||
      !uri ||
      !checked ||
      !note.trim() ||
      note.trim().length > 1000 ||
      record.review ||
      record.busy ||
      record.loading
    )
      return;
    if (
      await record.mutate(() => service.confirm(task, note), 'Đã xác nhận kết quả trong BHOME.')
    ) {
      setChecked(false);
      setNote('');
      api?.queryCache.invalidate(['contracts', 'notifications']);
    }
  }
  return (
    <Box>
      <QueryState
        loading={record.loading}
        error={record.error}
        reload={() => {
          setChecked(false);
          void record.reload();
        }}
      />
      {!!record.notice && <Text>{record.notice}</Text>}
      {task && (
        <>
          <Heading title={`${task.residentLabel} · Phòng ${task.roomNumber}`} />
          <Pill>{task.ownerConfirmed ? 'Owner đã xác nhận' : residenceStatus[task.status]}</Pill>
          {task.resultAt && <Text>Có kết quả: {formatInstant(task.resultAt)}</Text>}
          {!!photoError && <Text style={ui.red}>{photoError}</Text>}
          {!!uri && (
            <Image
              source={{ uri }}
              accessibilityLabel="Minh chứng kết quả tạm trú"
              resizeMode="contain"
              style={{ width: '100%', height: 280 }}
            />
          )}
          {!task.hasEvidence && <Text>Chưa có minh chứng kết quả.</Text>}
          {record.review && (
            <Action
              secondary
              disabled={record.loading || !!record.error}
              onPress={record.acknowledge}
            >
              Tôi đã đối chiếu hồ sơ tải lại
            </Action>
          )}
          {!task.ownerConfirmed && task.status === 'Completed' && (
            <>
              <Input
                label="Ghi chú xác nhận"
                value={note}
                disabled={record.busy}
                onChange={(value) => {
                  setNote(value);
                  setChecked(false);
                }}
              />
              <Checkbox.Item
                label="Tôi đã kiểm tra kết quả và minh chứng"
                status={checked ? 'checked' : 'unchecked'}
                disabled={record.busy || record.loading || !uri}
                onPress={() => setChecked((value) => !value)}
              />
              <Action
                disabled={
                  record.busy ||
                  record.loading ||
                  record.review ||
                  !uri ||
                  !checked ||
                  !note.trim() ||
                  note.trim().length > 1000
                }
                onPress={() => void confirm()}
              >
                Xác nhận kết quả trong BHOME
              </Action>
            </>
          )}
        </>
      )}
    </Box>
  );
}
