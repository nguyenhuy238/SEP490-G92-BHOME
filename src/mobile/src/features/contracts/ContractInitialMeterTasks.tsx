import React, { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import type { ContractView } from '../../../../../packages/client-core/src/contracts';
import type { MeterTask } from '../../../../../packages/client-core/src/meter';
import { Action, Box, Heading, Row, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSession } from '../../lib/SessionProvider';
import { conciseMessage } from '../../lib/toast';
import { errorMessage } from '../../lib/api';

type TaskResult = { key: string; tasks: MeterTask[]; error: string };

/** Move-in baselines belong to the contract, including when its meters were used before. */
export function ContractInitialMeterTasks({
  contract,
  integrated = false,
  onOpenTask,
  refreshRevision = 0,
}: {
  contract: ContractView;
  integrated?: boolean;
  onOpenTask?: (taskId: string, label: string) => void;
  /** Reload confirmed readings when a nested OCR task returns successfully. */
  refreshRevision?: number;
}) {
  const { api, session } = useSession();
  const { staffLocationId } = useWorkspace();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<TaskResult | null>(null);
  const allowed =
    !!api &&
    session?.roles.includes('Staff') &&
    !!staffLocationId &&
    staffLocationId === contract.locationId &&
    !!contract.roomId;
  const key = `${contract.id}:${contract.locationId}:${contract.roomId}:${staffLocationId}:${revision}:${refreshRevision}`;

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
                task.purpose === 0 &&
                task.contractId === contract.id &&
                task.roomId === contract.roomId &&
                task.locationId === contract.locationId,
            ),
            error: '',
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setResult({ key, tasks: [], error: conciseMessage(errorMessage(failure)) });
      }
    })();
    return () => controller.abort();
  }, [allowed, api, contract.id, contract.locationId, contract.roomId, key, revision]);

  const current = allowed && result?.key === key ? result : null;
  const content = (
    <>
      {!integrated && <Heading
        title="Chụp chỉ số khởi tạo hợp đồng"
        detail="Chụp ảnh thực tế và xác nhận lại cả công tơ đang dùng tiếp. Ảnh và chỉ số của hợp đồng cũ không được dùng thay thế."
      />}
      {!staffLocationId && <Text>Chọn cơ sở được phân công trên trang chủ để xem nhiệm vụ.</Text>}
      {!!staffLocationId && staffLocationId !== contract.locationId && (
        <Text>Hãy chọn đúng cơ sở của hợp đồng trên trang chủ để xem nhiệm vụ.</Text>
      )}
      {allowed && !current && <Text>Đang tải nhiệm vụ khởi tạo điện và nước…</Text>}
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
              ) : <Text>{`Chỉ số khởi tạo ${label.toLowerCase()}`}</Text>}
              {matches.length > 1 && (
                <Text style={ui.red}>Có nhiều nhiệm vụ cho cùng hợp đồng. Cần Owner kiểm tra.</Text>
              )}
              {matches.length === 0 && (
                <Text>Chưa được giao nhiệm vụ khởi tạo cho hợp đồng này.</Text>
              )}
              {task && (
                <>
                  {!integrated && <Text>
                    {task.status === 2
                      ? 'Đã chụp và xác nhận'
                      : task.status === 3
                        ? 'Nhiệm vụ đã hủy'
                        : 'Chờ chụp và xác nhận'}
                  </Text>}
                  {task.status !== 3 && (
                    <Action
                      secondary={task.status === 2}
                      onPress={() => onOpenTask
                        ? onOpenTask(task.id, label)
                        : router.push({ pathname: '/meter', params: { taskId: task.id } })}
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
    </>
  );
  return integrated ? content : <Box>{content}</Box>;
}
