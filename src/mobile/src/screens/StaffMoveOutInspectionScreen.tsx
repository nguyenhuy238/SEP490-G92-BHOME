import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Checkbox, Text } from 'react-native-paper';
import {
  businessToday,
  contractClient,
  contractError,
  displayContractDate,
  mutationKeys,
  type ContractView,
  type HandoverAsset,
  type InspectionPreparation,
  type MoveOut,
} from '../../../../packages/client-core/src/contracts';
import { assetInspectionInput } from '../../../../packages/client-core/src/handoverForm';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { CameraCapture } from '../components/CameraCapture';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { HandoverAssetFields } from '../features/contracts/HandoverAssetFields';
import {
  roomHandoverChecks,
  type MoveInRoomCheckStatus,
} from '../services/moveInHandover';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { randomUUID } from '../lib/randomUUID';
import { showSuccess } from '../lib/toast';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const sections = [
  'Chỉ số điện nước chốt',
  'Hiện trạng phòng · 7 mục',
  'Kiểm kê tài sản',
  'Chìa khóa và quyền truy cập',
] as const;
const statuses = [
  { id: 'Passed', label: 'Đạt' },
  { id: 'Issue', label: 'Có vấn đề' },
  { id: 'NotApplicable', label: 'Không áp dụng' },
];
type Assignment = {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  status: string;
  scheduledAt: string;
};
type InspectionRecord = {
  contract: ContractView;
  moveOut: MoveOut;
  preparation: InspectionPreparation;
};

export function StaffMoveOutInspectionScreen() {
  const { contractId } = useLocalSearchParams<{ contractId?: string }>();
  const { api, session } = useSession();
  const { role, preview, staffLocationId, go } = useWorkspace();
  const allowed = role === 'Staff' && !preview && !!session?.roles.includes('Staff');
  const selectedId = typeof contractId === 'string' && guidPattern.test(contractId) ? contractId : '';
  const assignments = useWorkspaceQuery<Assignment[]>(
    allowed && staffLocationId ? '/api/v1/contracts/move-out-assignments' : null,
    { notifyError: false },
  );
  const client = useMemo(
    () => (api ? contractClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    record: InspectionRecord | null;
    error: string;
  } | null>(null);
  const key = `${selectedId}:${staffLocationId}:${revision}`;
  const assigned = assignments.data?.find((item) => item.contractId === selectedId);
  const assignmentReady = !!assigned && allowed && !!staffLocationId;
  const reloadAssignments = assignments.reload;
  useFocusEffect(
    useCallback(() => {
      setRevision((value) => value + 1);
      // The loaded checklist stays mounted when Staff returns from a Final
      // meter capture. A transient assignment refresh would discard every
      // locally entered room, asset and key observation.
      if (!selectedId) reloadAssignments();
    }, [reloadAssignments, selectedId]),
  );
  useEffect(() => {
    if (!assignmentReady || !selectedId || !client) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [contract, moveOut, preparation] = await Promise.all([
          client.get(selectedId, controller.signal),
          client.moveOut(selectedId, controller.signal),
          client.inspectionPreparation(selectedId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (
          contract.id !== selectedId ||
          contract.locationId !== staffLocationId ||
          contract.roomId !== assigned.roomId ||
          moveOut.inspectionScheduledAt === null
        )
          throw new Error('Nhiệm vụ không thuộc cơ sở hoặc lịch kiểm tra được phân công.');
        setResponse({ key, record: { contract, moveOut, preparation }, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted)
          setResponse({ key, record: null, error: contractError(cause) });
      }
    })();
    return () => controller.abort();
  }, [assigned?.roomId, assignmentReady, client, key, selectedId, staffLocationId]);
  if (!allowed) return <Text>Chỉ Staff được phân công mới được kiểm tra trả phòng.</Text>;
  if (!staffLocationId) return <Text>Chọn cơ sở được phân công để xem kiểm tra trả phòng.</Text>;
  if (contractId && !selectedId) return <Text>Mã hợp đồng trả phòng không hợp lệ.</Text>;
  if (assignments.loading) return <Text>Đang tải công việc trả phòng được phân công…</Text>;
  if (assignments.error)
    return (
      <Box>
        <Text style={ui.red}>{assignments.error}</Text>
        <Action secondary onPress={assignments.reload}>Tải lại công việc</Action>
      </Box>
    );
  if (!selectedId)
    return (
      <Box>
        <Heading title="Kiểm tra trả phòng" detail="Hợp đồng đã được phân công trong cơ sở" />
        {!assignments.data?.length && <Text>Chưa có công việc trả phòng được phân công.</Text>}
        {(assignments.data ?? []).map((item) => (
          <Box key={item.contractId}>
            <Text>Phòng {item.roomNumber} · {item.locationName}</Text>
            <Text>{formatInstant(item.scheduledAt)} · {item.status}</Text>
            <Action onPress={() => go('move-out', { contractId: item.contractId })}>
              Mở kiểm tra trả phòng
            </Action>
          </Box>
        ))}
      </Box>
    );
  if (!assigned)
    return (
      <Box>
        <Text style={ui.red}>Hợp đồng này hiện không nằm trong danh sách Staff được giao kiểm tra.</Text>
        <Action secondary onPress={() => go('move-out')}>Về công việc được phân công</Action>
      </Box>
    );
  const current = response?.key.startsWith(`${selectedId}:${staffLocationId}:`) ? response : null;
  if (!current) return <Text>Đang tải hiện trạng và chỉ số chốt trả phòng…</Text>;
  if (current.error || !current.record)
    return (
      <Box>
        <Text style={ui.red}>{current.error || 'Không tải được biên bản trả phòng.'}</Text>
        <Action secondary onPress={() => setRevision((v) => v + 1)}>Tải lại biên bản</Action>
      </Box>
    );
  return (
    <InspectionForm
      key={`${selectedId}:${current.record.moveOut.id}`}
      data={current.record}
      client={client!}
      refresh={() => {
        setRevision((v) => v + 1);
        assignments.reload();
      }}
    />
  );
}

function InspectionForm({
  data,
  client,
  refresh,
}: {
  data: InspectionRecord;
  client: NonNullable<ReturnType<typeof contractClient>>;
  refresh: () => void;
}) {
  const { contract, moveOut, preparation } = data;
  const [step, setStep] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const groups = preparation.inspectionGroups ?? preparation.baseline?.snapshot.assets ?? [];
  const baseline = preparation.baseline?.snapshot;
  const noAssetsConfirmed =
    preparation.inventory?.noAssetsConfirmed ?? baseline?.noAssetsConfirmed ?? false;
  const editable =
    moveOut.status === 'Approved' &&
    !!moveOut.inspectionScheduledAt &&
    businessToday() >= moveOut.proposedDate;
  const canInspect =
    (!!baseline && !preparation.legacyExceptionRequired) ||
    !!preparation.legacyExceptionReason;
  const getPhotos = (bucket: string) => photos[bucket] ?? [];
  const set = (name: string, value: string) => {
    setValues((prior) => ({ ...prior, [name]: value }));
    setAccepted(false);
    setError('');
  };
  const readingId = (type: 0 | 1) =>
    values[type === 0 ? 'electricityReadingId' : 'waterReadingId'] ?? '';
  const roomCompleted = roomHandoverChecks.every(({ code }) => {
    const status = values[`room.${code}.status`];
    return (
      !!status &&
      (status === 'Passed' || !!values[`room.${code}.notes`]?.trim()) &&
      (status !== 'Issue' || getPhotos(`room:${code}`).length > 0)
    );
  });
  const assetIssue = (
    asset: HandoverAsset,
    condition: string,
    actual: number | undefined,
  ) => {
    const expected = asset.configuredQuantity ?? asset.handedOverQuantity ??
      asset.physicalAssets?.reduce((sum, item) => sum + item.quantity, 0);
    return condition !== 'Tốt' ||
      (actual !== undefined && expected != null && actual !== expected);
  };
  const assetCompleted =
    (groups.length > 0 || noAssetsConfirmed) &&
    groups.every((item) => {
      if (values[`${item.id}.checked`] !== 'true') return false;
      try {
        const observed = assetInspectionInput(
          item, values, getPhotos(`asset:${item.id}`),
          !!preparation.inventory, !preparation.legacyExceptionRequired,
        );
        const hasIssue = assetIssue(
          item, observed.condition,
          'observedQuantity' in observed ? observed.observedQuantity : undefined,
        );
        return !hasIssue ||
          (!!values[`${item.id}.notes`]?.trim() && getPhotos(`asset:${item.id}`).length > 0);
      } catch {
        return false;
      }
    });
  const keyCount = values.keyQuantity ?? '';
  const initialKeyCount = baseline?.accessItems?.find((item) => item.type === 'RoomKey')?.quantity;
  const missingKeys = typeof initialKeyCount === 'number' &&
    /^\d+$/.test(keyCount) && Number(keyCount) < initialKeyCount;
  const keysCompleted =
    /^\d+$/.test(keyCount) &&
    Number(keyCount) <= 100 &&
    (values.keyNotes?.length ?? 0) <= 500 &&
    (Number(keyCount) > 0 || !!values.keyNotes?.trim()) &&
    (!missingKeys || (!!values.keyNotes?.trim() && getPhotos('keys').length > 0));
  const completedSteps = [
    !!readingId(0) && !!readingId(1),
    !!values.roomCondition?.trim() && !!values.notes?.trim() &&
      roomCompleted && getPhotos('general').length > 0,
    assetCompleted,
    keysCompleted,
  ];
  const isSubmitted = moveOut.status !== 'Approved';
  async function upload(bytes: Uint8Array<ArrayBuffer>, bucket: string) {
    if (lock.current || isSubmitted) throw new Error('Nhiệm vụ hiện không cho phép tải ảnh.');
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
    if (getPhotos(bucket).length >= (bucket === 'general' ? 10 : 5))
      throw new Error('Đã đạt giới hạn ảnh cho hạng mục này.');
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const file = await client.upload(contract.id, bytes, 'image/jpeg');
      setPhotos((previous) => ({
        ...previous,
        [bucket]: [...(previous[bucket] ?? []), file.id],
      }));
      if (bucket.startsWith('asset:')) set(`${bucket.slice(6)}.evidence.${file.id}`, 'true');
      setNotice('Đã tải ảnh riêng tư. Ảnh sẽ được gắn khi gửi biên bản.');
    } catch (cause) {
      const message = contractError(cause);
      setError(message);
      throw new Error(message, { cause });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function photoSection(bucket: string, label: string) {
    const count = getPhotos(bucket).length;
    return (
      <Box>
        <Text>{label}: {count} ảnh đã tải</Text>
        <CameraCapture
          label="Chụp ảnh"
          presentation="evidence"
          reviewBeforeSubmit
          reviewActionLabel="Dùng ảnh này"
          disabled={busy || !editable || !canInspect || count >= (bucket === 'general' ? 10 : 5)}
          onCapture={(bytes) => upload(bytes, bucket)}
        />
      </Box>
    );
  }
  function buildBody() {
    if (!editable || !canInspect) throw new Error('Chưa đủ điều kiện kiểm tra trả phòng.');
    const electricity = preparation.finalReadings.find(
      (item) => item.id === readingId(0) && item.utilityType === 0,
    );
    const water = preparation.finalReadings.find(
      (item) => item.id === readingId(1) && item.utilityType === 1,
    );
    if (!electricity || !water)
      throw new Error('Cần chọn đủ chỉ số điện và nước chốt đã được Staff xác nhận.');
    const roomCondition = values.roomCondition?.trim();
    if (!roomCondition) throw new Error('Nhập mô tả hiện trạng tổng quan của phòng.');
    const roomChecks = roomHandoverChecks.map(({ code, label }) => {
      const status = values[`room.${code}.status`] as MoveInRoomCheckStatus | undefined;
      const notes = values[`room.${code}.notes`]?.trim() ?? '';
      const evidenceIds = getPhotos(`room:${code}`);
      if (!status) throw new Error(`Chưa kiểm tra: ${label}.`);
      if (status !== 'Passed' && !notes) throw new Error(`Cần ghi lý do: ${label}.`);
      if (status === 'Issue' && !evidenceIds.length)
        throw new Error(`Cần ảnh bằng chứng riêng cho mục có vấn đề: ${label}.`);
      return { code, status, notes, evidenceIds };
    });
    const quantity = Number(keyCount);
    if (!keysCompleted) throw new Error('Nhập số chìa khóa thực nhận và ghi lý do nếu bằng 0.');
    if (missingKeys && !getPhotos('keys').length)
      throw new Error('Thiếu chìa khóa so với lúc nhận: cần ảnh riêng và ghi chú.');
    if (values.keyNotes && values.keyNotes.length > 500)
      throw new Error('Ghi chú chìa khóa không quá 500 ký tự.');
    const evidenceIds = getPhotos('general');
    if (!evidenceIds.length) throw new Error('Cần ít nhất một ảnh toàn cảnh khi trả phòng.');
    const assets = groups.map((item: HandoverAsset) => {
      if (values[`${item.id}.checked`] !== 'true')
        throw new Error(`Chưa xác nhận kiểm kê: ${item.name}.`);
      const result = assetInspectionInput(
        item, values, getPhotos(`asset:${item.id}`),
        !!preparation.inventory, !preparation.legacyExceptionRequired,
      );
      const issue = assetIssue(
        item, result.condition,
        'observedQuantity' in result ? result.observedQuantity : undefined,
      );
      if (issue && !values[`${item.id}.notes`]?.trim())
        throw new Error(`Cần ghi nguyên nhân khi tài sản có vấn đề: ${item.name}.`);
      if (issue && !getPhotos(`asset:${item.id}`).length)
        throw new Error(`Cần ảnh riêng khi tài sản hỏng, hao mòn hoặc thiếu: ${item.name}.`);
      return {
        ...result,
        checked: true,
        notes: values[`${item.id}.notes`]?.trim() ?? '',
        evidenceIds: getPhotos(`asset:${item.id}`),
      };
    });
    if (!groups.length && !noAssetsConfirmed)
      throw new Error('Chưa có dữ liệu kiểm kê tài sản hoặc xác nhận phòng không có tài sản.');
    const notes = values.notes?.trim();
    if (!notes) throw new Error('Ghi tóm tắt buổi kiểm tra trả phòng.');
    const allIds = [
      ...evidenceIds, ...roomChecks.flatMap((item) => item.evidenceIds),
      ...assets.flatMap((item) => ('evidenceIds' in item ? item.evidenceIds : []) ?? []),
      ...getPhotos('keys'),
    ];
    if (new Set(allIds).size !== allIds.length)
      throw new Error('Một ảnh bằng chứng chỉ được gắn vào một hạng mục.');
    const accessItems = [{ type: 'RoomKey', quantity, notes: values.keyNotes?.trim() ?? '' }];
    return {
      electricityReadingId: electricity.id,
      waterReadingId: water.id,
      roomCondition,
      notes,
      keysAndAccess: `Đã nhận lại ${quantity} chìa khóa phòng.${accessItems[0].notes ? ` ${accessItems[0].notes}` : ''}`,
      roomChecks,
      assets,
      accessItems,
      keyEvidenceIds: getPhotos('keys'),
      evidenceIds,
      inventoryToken: preparation.inventory?.stateToken ?? null,
      expectedVersion: moveOut.version,
    };
  }
  async function submit() {
    if (lock.current || isSubmitted || !accepted) return;
    let body: ReturnType<typeof buildBody>;
    try {
      body = buildBody();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dữ liệu kiểm tra chưa đầy đủ.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const scope = 'staff-move-out-inspection';
      const result = await client.mutate<MoveOut>(
        contract.id, 'move-out/inspection', body, keys.get(scope, body),
      );
      if (result.status !== 'Inspected')
        throw new Error('Máy chủ chưa xác nhận đã lưu biên bản trả phòng.');
      keys.confirmed(scope, body);
      setNotice('Đã gửi biên bản kiểm tra trả phòng. Owner có thể xem và duyệt.');
      showSuccess('Đã hoàn tất kiểm tra trả phòng.');
      refresh();
    } catch (cause) {
      setError(contractError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading
        title="Kiểm tra trả phòng"
        detail={`Phòng ${contract.roomNumber} · ${contract.locationName}`}
      />
      <Text>
        Ngày trả dự kiến: {displayContractDate(moveOut.proposedDate)}
        {moveOut.inspectionScheduledAt ? ` · Lịch kiểm tra: ${formatInstant(moveOut.inspectionScheduledAt)}` : ''}
      </Text>
      <Pill tone={isSubmitted ? 'green' : 'blue'}>
        {moveOut.status === 'Inspected' ? 'Đã gửi Owner duyệt' : moveOut.status}
      </Pill>
      {!editable && !isSubmitted && (
        <Text style={ui.red}>Chỉ được gửi biên bản từ ngày trả phòng đã được duyệt.</Text>
      )}
      {!canInspect && (
        <Text style={ui.red}>
          Thiếu biên bản bàn giao đầu vào hợp lệ. Owner cần xác nhận ngoại lệ trước khi kiểm tra.
        </Text>
      )}
      {preparation.otherTenantsRemain && (
        <Text style={ui.muted}>
          Phòng còn người thuê khác. Đối chiếu dữ liệu chung và ghi nhận thực tế; Owner quyết định
          việc giải phóng phòng.
        </Text>
      )}
      {!!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
      {!!notice && <Text accessibilityRole="status" style={ui.green}>{notice}</Text>}
      <Row spread>
        <Text variant="titleMedium">4 phần kiểm tra trả phòng</Text>
        <Pill tone={completedSteps.every(Boolean) ? 'green' : 'blue'}>
          {completedSteps.filter(Boolean).length}/4 đã điền
        </Pill>
      </Row>
      {step !== null && (
        <Action secondary disabled={busy} onPress={() => setStep(null)}>Về 4 mục trả phòng</Action>
      )}
      {step === null && sections.map((label, index) => (
        <Box key={label}>
          <Row spread>
            <Text>{index + 1}. {label}</Text>
            <Pill tone={completedSteps[index] ? 'green' : 'neutral'}>
              {completedSteps[index] ? 'Đã điền' : 'Chưa đủ'}
            </Pill>
          </Row>
          <Action secondary disabled={busy} onPress={() => setStep(index)}>Mở mục kiểm tra</Action>
        </Box>
      ))}
      {step === 0 && (
        <Box>
          <Heading title="1. Chỉ số điện, nước chốt" />
          <Text style={ui.muted}>
            Chỉ chọn chỉ số Final đã xác nhận đúng hợp đồng. Nếu chưa có, Owner tạo nhiệm vụ Final
            và Staff chụp, xác nhận tại màn công tơ.
          </Text>
          {([0, 1] as const).map((type) => (
            <ChoiceField
              key={type}
              label={type === 0 ? 'Chỉ số điện chốt' : 'Chỉ số nước chốt'}
              value={readingId(type)}
              onChange={(id) => set(type === 0 ? 'electricityReadingId' : 'waterReadingId', id)}
              options={preparation.finalReadings.filter((r) => r.utilityType === type).map((r) => ({
                id: r.id, label: `${r.meterCode} · ${r.value} · ${displayContractDate(r.date)}`,
              }))}
              disabled={busy || !editable}
            />
          ))}
          <Action secondary onPress={() => router.push('/capture')}>Mở tác vụ chụp công tơ</Action>
          <Action secondary onPress={refresh}>Tải lại chỉ số đã xác nhận</Action>
        </Box>
      )}
      {step === 1 && (
        <Box>
          <Heading title="2. Hiện trạng phòng · 7 mục" />
          <Text>Hiện trạng khi nhận: {baseline?.roomCondition ?? 'Chưa có baseline được duyệt'}</Text>
          <Input
            label="Hiện trạng tổng quan khi trả"
            multiline
            value={values.roomCondition ?? ''}
            onChange={(v) => set('roomCondition', v)}
            disabled={busy || !editable}
          />
          {roomHandoverChecks.map(({ code, label }) => {
            const status = values[`room.${code}.status`] as MoveInRoomCheckStatus | undefined;
            const earlier = baseline?.roomChecks?.find((item) => item.code === code);
            return (
              <Box key={code}>
                <Text variant="titleSmall">{label}</Text>
                <Text style={ui.muted}>Khi nhận: {earlier?.status ?? 'Chưa có ghi nhận'}</Text>
                <ChoiceField
                  label={`Kết quả · ${label}`}
                  value={status ?? ''}
                  options={statuses}
                  onChange={(value) => set(`room.${code}.status`, value)}
                  disabled={busy || !editable}
                />
                {status && (
                  <Input
                    label={`Ghi chú · ${label}`}
                    value={values[`room.${code}.notes`] ?? ''}
                    onChange={(v) => set(`room.${code}.notes`, v)}
                    disabled={busy || !editable}
                    multiline
                  />
                )}
                {status === 'Issue' && photoSection(`room:${code}`, 'Ảnh hiện trạng có vấn đề')}
              </Box>
            );
          })}
          {photoSection('general', 'Ảnh toàn cảnh phòng (ít nhất 1 ảnh)')}
          <Input
            label="Tóm tắt kiểm tra"
            multiline
            value={values.notes ?? ''}
            onChange={(v) => set('notes', v)}
            disabled={busy || !editable}
          />
        </Box>
      )}
      {step === 2 && (
        <Box>
          <Heading title="3. Kiểm kê tài sản khi trả" />
          {!groups.length && <Text>Không có nhóm tài sản cần kiểm kê.</Text>}
          {groups.map((item) => (
            <Box key={item.id}>
              <HandoverAssetFields
                asset={item}
                values={values}
                set={set}
                evidenceIds={getPhotos(`asset:${item.id}`)}
                disabled={busy || !editable}
                quantities={!!preparation.inventory}
                showCheckWithoutQuantities
                compact
                embedded
              />
              {photoSection(`asset:${item.id}`, `Ảnh riêng cho ${item.name} khi thiếu, hỏng, hao mòn`)}
            </Box>
          ))}
          <Text style={ui.muted}>
            Staff ghi nhận số lượng, hiện trạng và ảnh thực tế. Owner xem biên bản và quyết định
            bồi thường sau khi duyệt.
          </Text>
        </Box>
      )}
      {step === 3 && (
        <Box>
          <Heading title="4. Chìa khóa và quyền truy cập" />
          <Text>
            Khi nhận: {baseline?.accessItems?.find((item) => item.type === 'RoomKey')?.quantity ??
              baseline?.keysAndAccess ?? 'Chưa rõ'}
          </Text>
          <Input
            label="Số chìa khóa phòng thực tế đã nhận lại"
            value={keyCount}
            onChange={(v) => set('keyQuantity', v)}
            numeric
            disabled={busy || !editable}
          />
          <Input
            label="Ghi chú chìa khóa (bắt buộc nếu bằng 0)"
            value={values.keyNotes ?? ''}
            onChange={(v) => set('keyNotes', v)}
            multiline
            disabled={busy || !editable}
          />
          {missingKeys && (
            <Text style={ui.red}>
              Số chìa khóa trả ít hơn khi nhận. Ghi rõ nguyên nhân và chụp ít nhất một ảnh riêng.
            </Text>
          )}
          {photoSection('keys', 'Ảnh chìa khóa thu lại (tùy chọn)')}
        </Box>
      )}
      {!isSubmitted && (
        <Box>
          <Checkbox.Item
            label="Tôi đã đối chiếu thực tế đủ 4 phần và các ảnh đúng hạng mục"
            status={accepted ? 'checked' : 'unchecked'}
            disabled={busy || !editable || !canInspect || !completedSteps.every(Boolean)}
            onPress={() => setAccepted((v) => !v)}
          />
          <Action
            disabled={busy || !editable || !canInspect || !accepted || !completedSteps.every(Boolean)}
            onPress={() => void submit()}
          >
            Gửi biên bản kiểm tra trả phòng cho Owner
          </Action>
        </Box>
      )}
      {isSubmitted && (
        <Text style={ui.green}>
          Biên bản đã được gửi. Chờ Owner xem xét hiện trạng và khoản bồi thường, quyết toán.
        </Text>
      )}
    </Box>
  );
}
