import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import {
  businessToday,
  type ContractView,
} from '../../../../../../packages/client-core/src/contracts';
import type { MeterTask } from '../../../../../../packages/client-core/src/meter';
import { Action, Box, Heading, Row, Pill, ui } from '../../../components/WorkspaceKit';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useSession } from '../../../lib/SessionProvider';
import { conciseMessage } from '../../../lib/toast';
import { errorMessage } from '../../../lib/api';
import { randomUUID } from '../../../lib/randomUUID';

type TaskResult = { key: string; tasks: MeterTask[]; error: string };

/** Move-in baselines belong to the contract, including when its meters were used before. */
export function ContractInitialMeterTasks({
  contract,
  integrated = false,
  onOpenTask,
  refreshRevision = 0,
  purpose = 0,
  moveInTaskId,
  moveInStarted = false,
}: {
  contract: ContractView;
  integrated?: boolean;
  onOpenTask?: (taskId: string, label: string, utilityType: 0 | 1) => void;
  /** Reload confirmed readings when a nested OCR task returns successfully. */
  refreshRevision?: number;
  /** Use the exact same meter capture UX for today's confirmed move-out Final readings. */
  purpose?: 0 | 2;
  /** Parent handover task, not an independent meter work item. */
  moveInTaskId?: string;
  /** Staff must start the canonical move-in handover before repairing its checkpoints. */
  moveInStarted?: boolean;
}) {
  const { api, session } = useSession();
  const { staffLocationId } = useWorkspace();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [ensuring, setEnsuring] = useState(false);
  const [ensureError, setEnsureError] = useState('');
  // Reuse the same key when the network outcome is ambiguous. A verified
  // success clears it so newly installed meters can be checked on a later tap.
  const pendingKeys = useRef(new Map<string, string>());
  const allowed =
    !!api &&
    session?.roles.includes('Staff') &&
    !!staffLocationId &&
    staffLocationId === contract.locationId &&
    !!contract.roomId;
  const finalDate = purpose === 2 ? businessToday() : '';
  const key = `${contract.id}:${contract.locationId}:${contract.roomId}:${staffLocationId}:${purpose}:${finalDate}:${revision}:${refreshRevision}`;

  useFocusEffect(
    useCallback(() => {
      setRevision((value) => value + 1);
    }, []),
  );

  useEffect(() => {
    if (!allowed || !api || revision === 0) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const tasks: MeterTask[] = [];
        const filter = new URLSearchParams({
          locationId: contract.locationId,
          roomId: contract.roomId,
        });
        for (let page = 1; ; page++) {
          const batch = await api.request<MeterTask[]>(
            `/api/v1/capture/meter-tasks?${filter}&page=${page}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (!Array.isArray(batch)) throw new Error('Danh sách nhiệm vụ không hợp lệ.');
          tasks.push(...batch);
          if (batch.length < 100) break;
        }
        if (!controller.signal.aborted)
          setResult({
            key,
            tasks: tasks.filter(
              (task) =>
                task.purpose === purpose &&
                task.contractId === contract.id &&
                task.roomId === contract.roomId &&
                task.locationId === contract.locationId &&
                (purpose !== 2 || task.readingDate === finalDate),
            ),
            error: '',
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setResult({ key, tasks: [], error: conciseMessage(errorMessage(failure)) });
      }
    })();
    return () => controller.abort();
  }, [
    allowed,
    api,
    contract.id,
    contract.locationId,
    contract.roomId,
    key,
    revision,
    purpose,
    finalDate,
  ]);

  const current = allowed && result?.key === key ? result : null;
  const missingBaseline =
    purpose === 0 &&
    integrated &&
    current &&
    !current.error &&
    ([0, 1] as const).some((type) => !current.tasks.some((task) => task.utilityType === type));
  async function prepareMoveInBaselines() {
    if (!allowed || !api || !moveInTaskId || !moveInStarted || ensuring || !missingBaseline) return;
    const identity = `${contract.id}:${moveInTaskId}`;
    let idempotencyKey = pendingKeys.current.get(identity);
    if (!idempotencyKey) {
      idempotencyKey = randomUUID();
      pendingKeys.current.set(identity, idempotencyKey);
    }
    setEnsuring(true);
    setEnsureError('');
    try {
      const ids = await api.request<string[]>(
        `/api/v1/operational-tasks/${encodeURIComponent(moveInTaskId)}/initial-meter-baselines/ensure`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
      );
      if (!Array.isArray(ids)) throw new Error('Danh sách chỉ số đầu kỳ không hợp lệ.');
      pendingKeys.current.delete(identity);
      if (ids.length < 2)
        setEnsureError(
          'Phòng chưa có đủ công tơ điện và nước đang hoạt động. Cần Owner kiểm tra cấu hình công tơ; không tạo công tơ mới ở bước bàn giao.',
        );
      setRevision((value) => value + 1);
    } catch (failure) {
      setEnsureError(conciseMessage(errorMessage(failure)));
    } finally {
      setEnsuring(false);
    }
  }
  const content = (
    <>
      {!integrated && (
        <Heading
          title={purpose === 2 ? 'Chụp chỉ số chốt trả phòng' : 'Xác nhận chỉ số điện nước đầu kỳ'}
          detail={
            purpose === 2
              ? 'Chụp ảnh và xác nhận chỉ số Final của hôm nay. Số cũ hoặc chỉ số chưa xác nhận không được dùng thay thế.'
              : 'Chụp và xác nhận chỉ số đầu kỳ trên công tơ đang dùng của phòng. Không dùng ảnh hoặc chỉ số của hợp đồng trước.'
          }
        />
      )}
      {!staffLocationId && <Text>Chọn cơ sở được phân công trên trang chủ để xem nhiệm vụ.</Text>}
      {!!staffLocationId && staffLocationId !== contract.locationId && (
        <Text>Hãy chọn đúng cơ sở của hợp đồng trên trang chủ để xem nhiệm vụ.</Text>
      )}
      {allowed && !current && <Text>Đang tải nhiệm vụ điện và nước…</Text>}
      {!!current?.error && <Text style={ui.red}>{current.error}</Text>}
      {current &&
        !current.error &&
        ([0, 1] as const).map((type) => {
          const label = type === 0 ? 'Điện' : 'Nước';
          const matches = current.tasks.filter((task) => task.utilityType === type);
          const task = matches.length === 1 ? matches[0] : null;
          return (
            <React.Fragment key={type}>
              {integrated ? (
                <Row spread>
                  <Text>{label}</Text>
                  <Pill tone={task?.status === 2 ? 'green' : 'amber'}>
                    {task?.status === 2 ? 'Đã xác nhận' : 'Chưa xác nhận'}
                  </Pill>
                </Row>
              ) : (
                <Text>{`Chỉ số ${purpose === 2 ? 'chốt trả phòng' : 'đầu kỳ'} ${label.toLowerCase()}`}</Text>
              )}
              {matches.length > 1 && (
                <Text style={ui.red}>Có nhiều nhiệm vụ cho cùng hợp đồng. Cần Owner kiểm tra.</Text>
              )}
              {matches.length === 0 && (
                <Text>
                  {purpose === 2
                    ? `Chưa có công tơ ${label.toLowerCase()} đang hoạt động hoặc nhiệm vụ Final hôm nay. Owner cần kiểm tra cấu hình công tơ nếu vẫn thiếu sau khi tải lại.`
                    : 'Chưa có bước xác nhận chỉ số đầu kỳ cho hợp đồng này.'}
                </Text>
              )}
              {task && (
                <>
                  {!integrated && (
                    <Text>
                      {task.status === 2
                        ? 'Đã chụp và xác nhận'
                        : task.status === 3
                          ? 'Nhiệm vụ đã hủy'
                          : 'Chờ chụp và xác nhận'}
                    </Text>
                  )}
                  {task.status !== 3 && (
                    <Action
                      secondary={task.status === 2}
                      onPress={() =>
                        onOpenTask
                          ? onOpenTask(task.id, label, type)
                          : router.push({ pathname: '/meter', params: { taskId: task.id } })
                      }
                    >
                      {task.status === 2
                        ? `Xem chỉ số ${label.toLowerCase()}`
                        : `Chụp chỉ số ${label.toLowerCase()}`}
                    </Action>
                  )}
                </>
              )}
            </React.Fragment>
          );
        })}
      {!!missingBaseline && moveInStarted && !!moveInTaskId && (
        <>
          <Action disabled={ensuring} onPress={() => void prepareMoveInBaselines()}>
            {ensuring ? 'Đang kiểm tra công tơ…' : 'Chuẩn bị chỉ số đầu kỳ điện và nước'}
          </Action>
          <Text style={ui.muted}>
            Sử dụng công tơ đang hoạt động trong phòng, không lắp hay tạo công tơ mới.
          </Text>
        </>
      )}
      {!!ensureError && <Text style={ui.red}>{ensureError}</Text>}
    </>
  );
  return integrated ? content : <Box>{content}</Box>;
}
