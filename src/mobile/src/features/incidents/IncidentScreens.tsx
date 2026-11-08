import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { QueryState, Pagination } from '../../components/WorkspaceQueryState';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSession } from '../../lib/SessionProvider';
import {
  incidentRoot,
  workOrderRoot,
  incidentQuery,
  incidentText,
  incidentClient,
  type Incident,
  type IncidentPage,
  type WorkOrder,
  type IncidentActivity,
  type IncidentEvidence,
  type EmergencyAction,
  type IncidentExpense,
  type MaintenanceHistory,
  type IncidentNotification,
} from '../../services/incidents';
import { useIncidentQuery, useIncidentMutation } from './useIncidentData';
import {
  Details,
  IncidentPlace,
  EvidenceImage,
  IncidentInfo as Info,
  IncidentTimeline,
  incidentDate,
  incidentMoney,
} from './IncidentUi';
import { IncidentActionPanel } from './IncidentActions';

const idPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function Pager({
  query,
  page,
  setPage,
}: {
  query: { data: { totalCount: number } | null; loading: boolean };
  page: number;
  setPage: (page: number) => void;
}) {
  return query.data ? (
    <Pagination
      page={page}
      total={query.data.totalCount}
      loading={query.loading}
      onChange={setPage}
    />
  ) : null;
}
export function IncidentListScreen({ emergency = false }: { emergency?: boolean }) {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [severity, setSeverity] = useState('');
  const enabled = !preview && !!session && !!role && session.roles.includes(role);
  const query = useIncidentQuery<IncidentPage<Incident>>(
    enabled
      ? `${incidentRoot}?${incidentQuery({ page, status, severity: emergency ? 'Emergency' : severity })}`
      : null,
  );
  return (
    <>
      <Heading
        title={
          emergency ? 'Sự cố khẩn cấp' : role === 'Tenant' ? 'Yêu cầu của tôi' : 'Sự cố tại cơ sở'
        }
        detail="Dữ liệu theo quyền tài khoản và phân công hiện hành"
      />
      {!enabled && <Text>Đăng nhập để xem dữ liệu sự cố thật.</Text>}
      {enabled && (
        <>
          <Button compact mode="text" icon="bell-outline" onPress={() => go('incident-inbox')}>
            Thông báo sự cố và bảo trì
          </Button>
          <ChoiceField
            label="Trạng thái báo cáo"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { id: '', label: 'Tất cả' },
              ...['Submitted', 'InProgress', 'Resolved', 'Rejected', 'Duplicate', 'Cancelled'].map(
                (id) => ({ id, label: incidentText(id) }),
              ),
            ]}
          />
          {!emergency && (
            <ChoiceField
              label="Mức độ sự cố"
              value={severity}
              onChange={(value) => {
                setSeverity(value);
                setPage(1);
              }}
              options={[
                { id: '', label: 'Tất cả' },
                { id: 'Normal', label: 'Thông thường' },
                { id: 'Emergency', label: 'Khẩn cấp' },
              ]}
            />
          )}
          <QueryState {...query} />
          {query.data?.items.length === 0 && (
            <Text>Không có báo cáo trong phạm vi và bộ lọc này.</Text>
          )}
          {query.data?.items.map((report) => (
            <Box key={report.id}>
              <Heading title={report.code} detail={incidentDate(report.createdAt)} />
              <Pill tone={report.severity === 'Emergency' ? 'red' : 'blue'}>
                {incidentText(report.severity)} · {incidentText(report.status)}
              </Pill>
              <Text numberOfLines={3}>{report.description}</Text>
              <Info label="Khu vực chung" value={report.commonArea} />
              <Info label="Loại" value={report.type} />
              <Info label="Nhóm" value={report.category} />
              <Details>
                <Info label="Mã cơ sở" value={report.locationId} />
                <Info label="Mã phòng" value={report.roomId} />
                <Info label="Mã tài sản" value={report.assetId} />
              </Details>
              <Action onPress={() => go('incident-detail', { incidentId: report.id })}>
                Xem chi tiết báo cáo
              </Action>
            </Box>
          ))}
          <Pager query={query} page={page} setPage={setPage} />
        </>
      )}
      {role !== 'Owner' && (
        <Action onPress={() => go(role === 'Staff' ? 'report-incident' : 'incidents')}>
          Báo cáo sự cố mới
        </Action>
      )}
      {role !== 'Tenant' && (
        <Action
          secondary
          onPress={() => go(role === 'Owner' ? 'owner-maintenance' : 'staff-maintenance')}
        >
          Lệnh sửa chữa bảo trì
        </Action>
      )}
      {role === 'Tenant' && (
        <>
          <Action secondary onPress={() => go('invoice', { focus: 'adjustment' })}>
            Yêu cầu điều chỉnh hóa đơn
          </Action>
          <Action secondary onPress={() => go('contract-request')}>
            Yêu cầu hợp đồng / trả phòng
          </Action>
        </>
      )}
    </>
  );
}

export function IncidentDetailScreen() {
  const { incidentId } = useLocalSearchParams<{ incidentId?: string }>();
  const { session } = useSession();
  return incidentId && idPattern.test(incidentId) ? (
    <IncidentDetail key={`${session?.userId}:${incidentId}`} id={incidentId} />
  ) : (
    <Text>Không có mã báo cáo hợp lệ.</Text>
  );
}
function IncidentDetail({ id }: { id: string }) {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
  const enabled = !!session && !preview && !!role && session.roles.includes(role);
  const query = useIncidentQuery<Incident>(enabled ? `${incidentRoot}/${id}` : null);
  const [historyPage, setHistoryPage] = useState(1),
    [workPage, setWorkPage] = useState(1);
  const loaded = enabled && !!query.data;
  const history = useIncidentQuery<IncidentPage<IncidentActivity>>(
    loaded ? `${incidentRoot}/${id}/history?page=${historyPage}&pageSize=20` : null,
  );
  const evidence = useIncidentQuery<IncidentEvidence[]>(
    loaded ? `${incidentRoot}/${id}/evidence` : null,
  );
  const visibleEvidence = evidence.data?.filter(
    (image) => role !== 'Tenant' || image.kind === 'Report',
  );
  const work = useIncidentQuery<IncidentPage<WorkOrder>>(
    loaded && role !== 'Tenant'
      ? `${workOrderRoot}?incidentId=${id}&page=${workPage}&pageSize=20`
      : null,
  );
  const emergency = useIncidentQuery<EmergencyAction[]>(
    loaded && role !== 'Tenant' && query.data?.severity === 'Emergency'
      ? `${incidentRoot}/${id}/emergency-actions`
      : null,
  );
  const expenses = useIncidentQuery<IncidentExpense[]>(
    loaded && role === 'Owner' ? `${incidentRoot}/${id}/expenses` : null,
  );
  return (
    <>
      <Action
        secondary
        onPress={() =>
          go(
            role === 'Tenant'
              ? 'tenant-requests'
              : role === 'Owner'
                ? 'owner-incidents'
                : 'staff-emergencies',
          )
        }
      >
        Về danh sách báo cáo
      </Action>
      <QueryState {...query} />
      {query.data && (
        <>
          <Box>
            <Heading title={query.data.code} detail={incidentDate(query.data.createdAt)} />
            <Pill tone={query.data.severity === 'Emergency' ? 'red' : 'blue'}>
              {incidentText(query.data.severity)} · {incidentText(query.data.status)}
            </Pill>
            <Text>{query.data.description}</Text>
            <Info label="Khu vực chung" value={query.data.commonArea} />
            <Info label="Loại sự cố" value={query.data.type} />
            <Info label="Nhóm sự cố" value={query.data.category} />
            <Info
              label="Tiếp nhận khẩn cấp lúc"
              value={query.data.acknowledgedAt ? incidentDate(query.data.acknowledgedAt) : null}
            />
            <Info label="Kết quả xử lý" value={query.data.resolutionNote} />
            {role !== 'Tenant' && query.data.staffAvailable !== null && (
              <Text>
                Nhân viên tại cơ sở:{' '}
                {query.data.staffAvailable
                  ? 'Có người được phân công'
                  : 'Chưa có người được phân công'}
              </Text>
            )}
            <Details>
              <Info label="Mã báo cáo" value={query.data.id} />
              <Info label="Mã cơ sở" value={query.data.locationId} />
              <Info label="Mã phòng" value={query.data.roomId} />
              <Info label="Mã tài sản" value={query.data.assetId} />
              <Info label="Phiên bản" value={query.data.version} />
              <Text>
                Chuyển cấp tự động: {query.data.escalationEnabled ? 'Đang bật' : 'Không bật'}
              </Text>
            </Details>
          </Box>
          <IncidentPlace report={query.data} role={role!} />
          <Heading title="Ảnh minh chứng" />
          <QueryState {...evidence} />
          {visibleEvidence?.length === 0 && (
            <Text>Chưa có ảnh được trả về cho tài khoản của bạn.</Text>
          )}
          {visibleEvidence?.map((image) => (
            <EvidenceImage key={image.id} incidentId={id} evidence={image} />
          ))}
          {role !== 'Tenant' && (
            <>
              <Heading title="Lệnh sửa chữa liên quan" />
              <QueryState {...work} />
              {work.data?.items.map((order) => (
                <WorkCard key={order.id} work={order} />
              ))}
              {work.data?.items.length === 0 && <Text>Chưa có lệnh sửa chữa.</Text>}
              <Pager query={work} page={workPage} setPage={setWorkPage} />
              {query.data.severity === 'Emergency' && (
                <>
                  <Heading title="Hành động và chi phí khẩn cấp" />
                  <QueryState {...emergency} />
                  {emergency.data?.length === 0 && (
                    <Text>Chưa có hành động hoặc chi phí khẩn cấp riêng được trả về.</Text>
                  )}
                  {emergency.data?.map((entry) => (
                    <Box key={entry.id}>
                      <Info
                        label="Chi phí đề nghị"
                        value={
                          entry.requestedCost === null ? null : incidentMoney(entry.requestedCost)
                        }
                      />
                      <Text>
                        {entry.costApproved === null
                          ? 'Chưa có quyết định chi phí được phép xem'
                          : entry.costApproved
                            ? 'Đã duyệt chi phí'
                            : 'Đã từ chối chi phí'}
                      </Text>
                      <Details>
                        <Info label="Mã hành động" value={entry.id} />
                        <Info label="Hoạt động trong lịch sử" value={entry.activityId} />
                      </Details>
                    </Box>
                  ))}
                </>
              )}
            </>
          )}
          {role === 'Owner' && (
            <>
              <Heading title="Chi phí đã ghi nhận" />
              <QueryState {...expenses} />
              {expenses.data?.length === 0 && <Text>Chưa có khoản chi phí được trả về.</Text>}
              {expenses.data?.map((expense) => (
                <Box key={expense.id}>
                  <Text>
                    {incidentMoney(expense.amount)} ·{' '}
                    {expense.expenseDate.split('-').reverse().join('/')}
                  </Text>
                  <Info
                    label="Loại chi phí"
                    value={expense.category === 'Maintenance' ? 'Bảo trì' : expense.category}
                  />
                  <Details>
                    <Info label="Mã chi phí" value={expense.id} />
                    <Info label="Mã sự cố" value={expense.incidentId} />
                    <Info label="Mã lệnh sửa chữa" value={expense.workOrderId} />
                    <Info label="Hành động khẩn cấp" value={expense.emergencyActionId} />
                  </Details>
                </Box>
              ))}
            </>
          )}
          <IncidentActionPanel
            key={query.data.version}
            report={query.data}
            role={role!}
            emergencyActions={emergency.data ?? []}
          />
          <Heading title="Lịch sử xử lý" />
          <QueryState {...history} />
          {history.data && (
            <IncidentTimeline
              items={history.data.items}
              owner={role === 'Owner'}
              tenant={role === 'Tenant'}
            />
          )}
          <Pager query={history} page={historyPage} setPage={setHistoryPage} />
        </>
      )}
    </>
  );
}

function WorkCard({ work }: { work: WorkOrder }) {
  const { go } = useWorkspace();
  return (
    <Box>
      <Heading title="Lệnh sửa chữa" detail={incidentText(work.status)} />
      <Text>{work.expectedOutcome}</Text>
      <Text>
        Hạn: {incidentDate(work.targetCompletionAt)}
        {work.isOverdue ? ' · Quá hạn' : ''}
      </Text>
      <Action onPress={() => go('maintenance-detail', { workOrderId: work.id })}>
        Xem chi tiết lệnh sửa chữa
      </Action>
    </Box>
  );
}
export function MaintenanceListScreen() {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('');
  const enabled =
    !preview && !!session && (role === 'Staff' || role === 'Owner') && session.roles.includes(role);
  const query = useIncidentQuery<IncidentPage<WorkOrder>>(
    enabled ? `${workOrderRoot}?${incidentQuery({ page, workOrderStatus: status })}` : null,
  );
  return (
    <>
      <Heading
        title="Xử lý sự cố & Bảo trì"
        detail="Lệnh sửa chữa theo phân công và quyền truy cập"
      />
      {!enabled && <Text>Đăng nhập Staff hoặc Owner để xem lệnh sửa chữa.</Text>}
      {enabled && (
        <>
          <ChoiceField
            label="Trạng thái lệnh sửa chữa"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { id: '', label: 'Tất cả' },
              ...[
                'Assigned',
                'PendingApproval',
                'InProgress',
                'PendingVerification',
                'Verified',
                'Cancelled',
              ].map((id) => ({ id, label: incidentText(id) })),
            ]}
          />
          <QueryState {...query} />
          {query.data?.items.map((work) => (
            <WorkCard key={work.id} work={work} />
          ))}
          {query.data?.items.length === 0 && (
            <Text>Không có lệnh sửa chữa trong phạm vi và bộ lọc này.</Text>
          )}
          <Pager query={query} page={page} setPage={setPage} />
        </>
      )}
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-incidents' : 'staff-incidents')}
      >
        Danh sách báo cáo sự cố
      </Action>
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-emergencies' : 'staff-emergencies')}
      >
        Sự cố khẩn cấp
      </Action>
    </>
  );
}
export function MaintenanceDetailScreen() {
  const { workOrderId } = useLocalSearchParams<{ workOrderId?: string }>();
  const { session } = useSession();
  return workOrderId && idPattern.test(workOrderId) ? (
    <WorkDetail key={`${session?.userId}:${workOrderId}`} id={workOrderId} />
  ) : (
    <Text>Không có mã lệnh sửa chữa hợp lệ.</Text>
  );
}
function WorkDetail({ id }: { id: string }) {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
  const enabled =
    !preview && !!session && (role === 'Staff' || role === 'Owner') && session.roles.includes(role);
  const query = useIncidentQuery<WorkOrder>(enabled ? `${workOrderRoot}/${id}` : null);
  const work = query.data;
  const incident = useIncidentQuery<Incident>(work ? `${incidentRoot}/${work.incidentId}` : null);
  const [historyPage, setHistoryPage] = useState(1),
    [maintenancePage, setMaintenancePage] = useState(1);
  const history = useIncidentQuery<IncidentPage<IncidentActivity>>(
    work ? `${incidentRoot}/${work.incidentId}/history?page=${historyPage}&pageSize=20` : null,
  );
  const evidence = useIncidentQuery<IncidentEvidence[]>(
    work ? `${incidentRoot}/${work.incidentId}/evidence` : null,
  );
  const maintenance = useIncidentQuery<IncidentPage<MaintenanceHistory>>(
    work
      ? `${workOrderRoot}/maintenance-history?incidentId=${work.incidentId}&page=${maintenancePage}&pageSize=20`
      : null,
  );
  return (
    <>
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-maintenance' : 'staff-maintenance')}
      >
        Về danh sách lệnh sửa chữa
      </Action>
      <QueryState {...query} />
      {work && (
        <>
          <Box>
            <Heading title="Chi tiết lệnh sửa chữa" detail={incidentText(work.status)} />
            {work.isOverdue && <Pill tone="red">Quá hạn hoàn thành</Pill>}
            <Info label="Kết quả yêu cầu" value={work.expectedOutcome} />
            <Text>
              Người phụ trách:{' '}
              {work.assignedStaffId === session?.userId
                ? 'Bạn'
                : 'Nhân viên được phân công (xem mã tham chiếu)'}
            </Text>
            <Info label="Hạn hoàn thành" value={incidentDate(work.targetCompletionAt)} />
            <Info label="Kết quả kiểm tra" value={work.inspectionResult} />
            <Info label="Phương án" value={work.proposedSolution} />
            <Info label="Thời gian dự kiến (phút)" value={work.estimatedMinutes} />
            {work.estimatedCost !== null && (
              <Info label="Chi phí dự kiến" value={incidentMoney(work.estimatedCost)} />
            )}
            <Info label="Đơn vị sửa chữa" value={work.vendor} />
            <Text>
              Phương án: {work.planApproved ? 'Đã được duyệt' : 'Chưa được duyệt'} ·{' '}
              {work.canStart ? 'Được phép bắt đầu' : 'Chưa ở bước bắt đầu'}
            </Text>
            <Info
              label="Duyệt lúc"
              value={work.approvedAt ? incidentDate(work.approvedAt) : null}
            />
            <Info label="Kết quả sửa chữa" value={work.result} />
            {work.actualCost !== null && (
              <Info label="Chi phí thực tế" value={incidentMoney(work.actualCost)} />
            )}
            <Info
              label="Nghiệm thu lúc"
              value={work.verifiedAt ? incidentDate(work.verifiedAt) : null}
            />
            <Details>
              <Info label="Mã lệnh sửa chữa" value={work.id} />
              <Info label="Mã sự cố" value={work.incidentId} />
              <Info label="Mã cơ sở" value={work.locationId} />
              <Info label="Mã phòng" value={work.roomId} />
              <Info label="Mã tài sản" value={work.assetId} />
              <Info label="Nhân viên phụ trách (mã)" value={work.assignedStaffId} />
              <Info label="Người duyệt (mã)" value={work.approvedById} />
              <Info label="Người nghiệm thu (mã)" value={work.verifiedById} />
              <Info label="Phiên bản phương án" value={work.proposalVersion} />
              <Info label="Phiên bản dữ liệu" value={work.version} />
            </Details>
          </Box>
          <QueryState {...incident} />
          {incident.data && (
            <>
              <Heading title={incident.data.code} detail={incident.data.description} />
              <IncidentPlace report={incident.data} role={role!} />
              <Action
                secondary
                onPress={() => go('incident-detail', { incidentId: work.incidentId })}
              >
                Xem sự cố gốc
              </Action>
              {['Submitted', 'InProgress'].includes(incident.data.status) && (
                <IncidentActionPanel
                  key={`${work.version}:${incident.data.version}`}
                  report={incident.data}
                  work={work}
                  role={role!}
                />
              )}
            </>
          )}
          <Heading title="Ảnh kiểm tra và kết quả" />
          <QueryState {...evidence} />
          {evidence.data?.filter((image) => image.workOrderId === id).length === 0 && (
            <Text>Chưa có ảnh của lệnh sửa chữa này.</Text>
          )}
          {evidence.data
            ?.filter((image) => image.workOrderId === id)
            .map((image) => (
              <EvidenceImage key={image.id} incidentId={work.incidentId} evidence={image} />
            ))}
          <Heading title="Lịch sử hoạt động của sự cố" />
          <QueryState {...history} />
          {history.data && (
            <IncidentTimeline items={history.data.items} owner={role === 'Owner'} tenant={false} />
          )}
          <Pager query={history} page={historyPage} setPage={setHistoryPage} />
          <Heading title="Lịch sử bảo trì và hiện trạng tài sản" />
          <Text style={ui.muted}>
            Phân trang theo sự cố; chỉ hiển thị bản ghi của lệnh sửa chữa đang xem.
          </Text>
          <QueryState {...maintenance} />
          {maintenance.data?.items.filter((item) => item.workOrderId === id).length === 0 && (
            <Text>Chưa có bản ghi của lệnh này trên trang lịch sử sự cố.</Text>
          )}
          {maintenance.data?.items
            .filter((item) => item.workOrderId === id)
            .map((item) => (
              <Box key={item.id}>
                <Heading title={incidentText(item.action)} detail={incidentDate(item.verifiedAt)} />
                <Info label="Hiện trạng trước" value={item.conditionBefore} />
                <Info label="Hiện trạng sau" value={item.conditionAfter} />
                <Info
                  label="Trạng thái trước"
                  value={item.statusBefore ? incidentText(item.statusBefore) : null}
                />
                <Info
                  label="Trạng thái sau"
                  value={item.statusAfter ? incidentText(item.statusAfter) : null}
                />
                <Info label="Chi phí thực tế" value={incidentMoney(item.actualCost)} />
                <Details>
                  <Info label="Mã lịch sử" value={item.id} />
                  <Info label="Mã hoạt động" value={item.activityId} />
                  <Info label="Mã sự cố" value={item.incidentId} />
                  <Info label="Mã lệnh sửa chữa" value={item.workOrderId} />
                  <Info label="Mã phòng" value={item.roomId} />
                  <Info label="Mã tài sản" value={item.assetId} />
                  <Info label="Người xác minh (mã)" value={item.verifiedById} />
                </Details>
              </Box>
            ))}
          <Pager query={maintenance} page={maintenancePage} setPage={setMaintenancePage} />
        </>
      )}
    </>
  );
}

export function IncidentInbox() {
  const { api, session } = useSession();
  const { preview, go } = useWorkspace();
  const [page, setPage] = useState(1);
  const query = useIncidentQuery<IncidentPage<IncidentNotification>>(
    !preview && session ? `${incidentRoot}/notifications?page=${page}&pageSize=20` : null,
  );
  const mutation = useIncidentMutation();
  return (
    <>
      <Heading title="Thông báo sự cố và bảo trì" />
      <QueryState {...query} />
      {query.data?.items.length === 0 && <Text>Chưa có thông báo sự cố trên trang này.</Text>}
      {query.data?.items.map((item) => (
        <Box key={item.id}>
          <Pill tone={item.highPriority ? 'red' : 'blue'}>
            {item.highPriority ? 'Ưu tiên khẩn cấp' : 'Thông báo sự cố'} ·{' '}
            {item.readAt ? 'Đã đọc' : 'Chưa đọc'}
          </Pill>
          <Text>
            {incidentText(item.event)} · {incidentDate(item.createdAt)}
          </Text>
          <Info label="Đọc lúc" value={item.readAt ? incidentDate(item.readAt) : null} />
          <Details>
            <Info label="Mã thông báo" value={item.id} />
            <Info label="Mã sự cố" value={item.incidentId} />
            <Info label="Trạng thái chuyển thông báo" value={incidentText(item.deliveryState)} />
          </Details>
          <Action
            disabled={mutation.busy}
            onPress={() => {
              void (async () => {
                if (!api) return;
                if (!item.readAt) {
                  const result = await mutation.run(item.id, async () => {
                    await incidentClient(api).readNotification(item.id);
                    return true;
                  });
                  if (!result) return;
                }
                go('incident-detail', { incidentId: item.incidentId });
              })();
            }}
          >
            Mở thông báo sự cố
          </Action>
        </Box>
      ))}
      <Pager query={query} page={page} setPage={setPage} />
      {!!mutation.error && (
        <Text style={ui.red} accessibilityRole="alert">
          {mutation.error}
        </Text>
      )}
    </>
  );
}
