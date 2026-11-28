using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Operations;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using BHome.Infrastructure.Ocr;
using Native = BHome.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class OperationalWorkRepository(Compact24DbContext db) : IOperationalWorkRepository
{
    private const string Owner = "needsOwner", Active = "active", Closed = "closed";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record State(string Status, string Phase, string Action, bool Verification = false);
    private sealed record Row(OperationalWorkItem Item, string RawStatus, Guid? AssetId,
        MaintenanceWorkOrder[] Children, bool Verification, string? SearchDetails = null,
        Guid? ResponsibleId = null, Guid? RecordedStaffId = null, Guid? ProposedAssetId = null);
    private sealed class MoveInPreparation
    {
        public Guid ContractId { get; set; }
        public string? Status { get; set; }
        public bool OwnerSigned { get; set; }
    }
    private sealed class MoveOutStaff
    {
        public Guid ContractId { get; set; }
        public Guid? InspectionStaffId { get; set; }
    }
    private sealed record HandoverManifest(int TaskVersion, Guid AssignmentId, Guid StaffId, int Revision);
    private sealed record HandoverEvent(string Action, Guid TaskId, int Revision, HandoverManifest? Report,
        string? InkObjectKey);

    private static State WorkState(MaintenanceWorkOrder order)
    {
        if (order.Status == WorkOrderStatus.Verified) return new("Đã xác minh", Closed, "Xem kết quả");
        if (order.Status == WorkOrderStatus.Cancelled) return new("Đã hủy", Closed, "Xem lịch sử");
        if (order.AssetProposalPending) return new("Chờ duyệt tài sản", Owner, "Xác nhận liên kết tài sản");
        return order.Status switch
        {
            WorkOrderStatus.Assigned => new("Chờ khảo sát", Active, "Staff khảo sát và đề xuất phương án"),
            WorkOrderStatus.PendingApproval when order.PlanApproved => new("Đã duyệt phương án", Active, "Staff bắt đầu thực hiện"),
            WorkOrderStatus.PendingApproval => new("Chờ duyệt phương án", Owner, "Duyệt phương án sửa chữa"),
            WorkOrderStatus.InProgress => new("Đang thực hiện", Active, "Staff thực hiện và cập nhật kết quả"),
            WorkOrderStatus.PendingVerification => new("Chờ xác minh", Owner, "Xác minh kết quả", true),
            _ => new("Đang xử lý", Active, "Theo dõi tiến độ")
        };
    }

    private static State TaskState(OperationalTask task, Guid? responsible, ILookup<Guid, HandoverEvent> events,
        MoveInPreparation? moveIn)
    {
        if (task.MeterStatus == MeterTaskStatus.Completed) return new("Đã hoàn thành", Closed, "Xem kết quả");
        if (task.MeterStatus == MeterTaskStatus.Cancelled) return new("Đã hủy", Closed, "Xem lịch sử");
        if (moveIn is not null && task.Kind == OperationalTaskKind.AdHoc && task.TaskTitle.StartsWith("Bàn giao vào phòng"))
        {
            if (moveIn.Status == "PendingOwnerReview") return new("Chờ Owner duyệt và ký", Owner, "Duyệt và ký biên bản", true);
            if (moveIn.Status == "ChangesRequested") return new("Chờ duyệt yêu cầu chỉnh sửa", Owner, "Xem yêu cầu của Tenant");
            if (moveIn.Status == "Ready") return moveIn.OwnerSigned
                ? new("Chờ Tenant ký", Active, "Tenant ký xác nhận bàn giao")
                : new("Chờ Owner ký", Owner, "Ký biên bản bàn giao");
        }
        if (task.Kind == OperationalTaskKind.LocationAssetHandover)
        {
            if (task.MeterStatus == MeterTaskStatus.PendingVerification)
            {
                var approval = events[task.Id].LastOrDefault(x => x.Action == "LocationAssetHandoverApproved")?.Report;
                if (approval is not null && approval.TaskVersion == task.Version &&
                    approval.AssignmentId == task.AssignmentId && approval.StaffId == task.AssignedStaffUserId)
                {
                    var signed = events[task.Id].LastOrDefault(x => x.Revision == approval.Revision &&
                        x.Action == "LocationAssetHandoverOwnerSigned");
                    if (signed?.InkObjectKey is not null)
                        return new("Chờ Staff ký", Active, "Staff ký biên bản bàn giao");
                    return new("Chờ Owner ký", Owner, "Ký biên bản bàn giao");
                }
                return new("Chờ duyệt kiểm kê", Owner, "Duyệt kết quả kiểm kê", true);
            }
            if (!string.IsNullOrWhiteSpace(task.LocationAssetInventoryJson))
            {
                var snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.LocationAssetInventoryJson, Json);
                if (snapshot is not null && ((snapshot.PendingOwnerRooms?.Length ?? 0) > 0 || snapshot.PendingOwnerCommonAssets))
                    return new("Chờ Owner xác nhận tài sản", Owner, "Xác nhận tài sản và đối soát danh sách");
            }
        }
        if (task.MeterStatus == MeterTaskStatus.PendingVerification)
            return new("Chờ xác minh", Owner, "Xác minh kết quả", true);
        if (responsible is null)
            return new("Chưa có Staff phụ trách", Owner, "Phân công Staff");
        if (task.MeterStatus == MeterTaskStatus.Assigned)
            return new("Chờ thực hiện", Active, "Staff bắt đầu công việc");
        return new("Đang thực hiện", Active, "Staff cập nhật tiến độ");
    }

    private static string ReportStatus(IncidentReport report) => report.Status switch
    {
        IncidentStatus.Submitted => report.OwnerDecisionAt is null ? "Chờ tiếp nhận" : "Đã tiếp nhận",
        IncidentStatus.InProgress => "Đang xử lý",
        IncidentStatus.Resolved => "Đã giải quyết",
        IncidentStatus.Rejected => "Đã từ chối",
        IncidentStatus.Duplicate => "Trùng lặp",
        _ => "Đã hủy"
    };

    private static string ReportSource(IncidentReport report) =>
        report.ReporterRole is "Tenant" or "Staff" or "Owner" ? report.ReporterRole : "System";

    private static State IncidentState(IncidentReport report, MaintenanceWorkOrder? active, bool pendingCost)
    {
        if (!report.IsOpen) return new(ReportStatus(report), Closed, "Xem lịch sử");
        if (pendingCost) return new("Chờ duyệt chi phí khẩn cấp", Owner, "Duyệt chi phí ứng phó");
        if (active is not null) return WorkState(active);
        if (report.Status == IncidentStatus.Submitted || report.OwnerDecisionAt is null)
            return new("Chờ tiếp nhận", Owner, "Tiếp nhận và phân loại sự cố");
        return new("Chờ xử lý", Owner, "Phân công sửa chữa hoặc giải quyết sự cố");
    }

    public async Task<OperationalWorkPage> ReadAsync(OperationalWorkQuery query, DateTimeOffset now, CancellationToken token)
    {
        // Owner has the same chain-wide visibility as the existing task and incident queries.
        // Apply the shared location filter before the fixed number of projected reads.
        var tasksQuery = db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(x => x.TaskType == "GENERAL");
        var incidentsQuery = db.Set<IncidentReport>().AsNoTracking();
        var ordersQuery = db.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking().Where(x => x.TaskType == "WORK_ORDER");
        if (query.LocationId is { } location)
        {
            tasksQuery = tasksQuery.Where(x => x.LocationId == location);
            incidentsQuery = incidentsQuery.Where(x => x.LocationId == location);
            ordersQuery = ordersQuery.Where(x => x.LocationId == location);
        }
        var reportsOnly = query.View == "reports";
        var workOnly = query.View == "work";
        var tasks = reportsOnly ? [] : (await tasksQuery.ToArrayAsync(token)).Select(NativeCaptureReads.Task).ToArray();
        var incidents = (await incidentsQuery.ToArrayAsync(token)).Select(NativeIncidentSession.Read).ToArray();
        var incidentById = incidents.ToDictionary(x => x.Id);
        var orders = (await ordersQuery.ToArrayAsync(token)).Select(NativeIncidentSession.Read).ToArray();
        var children = orders.Where(x => x.IncidentId.HasValue).ToLookup(x => x.IncidentId!.Value);
        var childCounts = children.ToDictionary(g => g.Key, g => (Total: g.Count(), Open: g.Count(x => x.IsOpen),
            Verified: g.Count(x => x.Status == WorkOrderStatus.Verified)));
        var incidentIds = incidents.Select(x => x.Id).ToArray();
        var pendingEmergency = (await db.Database.SqlQuery<Guid>($"""
            SELECT DISTINCT r.id AS "Value" FROM incident_reports r
            CROSS JOIN LATERAL (SELECT DISTINCT ON (h->>'recordKey') h FROM jsonb_array_elements(r.history)
                WITH ORDINALITY a(h,n) WHERE h->>'recordType'='EmergencyAction' ORDER BY h->>'recordKey',n DESC) s
            WHERE r.id=ANY({incidentIds}) AND COALESCE(s.h->>'deleted','false')<>'true'
                AND s.h->'state'->>'requestedCost' IS NOT NULL AND s.h->'state'->>'costApproved' IS NULL
            """).ToArrayAsync(token)).ToHashSet();

        var taskIds = tasks.Select(x => x.Id).ToArray();
        var recurring = (await db.Database.SqlQueryRaw<Guid>(
            """
            SELECT id AS "Value" FROM operational_tasks
            WHERE source_key LIKE 'recurring:%'
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(history,'[]'::jsonb)) h
                  WHERE h->>'recordType'='OperationalTaskHistory' AND h->'state'->>'action'='generated')
            """)
            .Where(x => taskIds.Contains(x)).ToArrayAsync(token)).ToHashSet();
        var handoverIds = tasks.Where(x => x.Kind == OperationalTaskKind.LocationAssetHandover &&
            x.MeterStatus == MeterTaskStatus.PendingVerification).Select(x => x.Id).ToHashSet();
        var handoverLocations = tasks.Where(x => handoverIds.Contains(x.Id)).Select(x => x.RequiredLocationId).Distinct().ToArray();
        var history = handoverLocations.Length == 0 ? [] : await db.Database.SqlQuery<string>($"""
            SELECT entry.value::text AS "Value" FROM locations l
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.history,'[]'::jsonb)) WITH ORDINALITY AS entry(value,ordinality)
            WHERE l.id=ANY({handoverLocations}) AND entry.value->>'action' IN
                ('LocationAssetHandoverApproved','LocationAssetHandoverOwnerSigned')
            ORDER BY l.id,entry.ordinality
            """).ToArrayAsync(token);
        var signatures = history.Select(x => JsonSerializer.Deserialize<HandoverEvent>(x, Json))
            .OfType<HandoverEvent>().Where(x => handoverIds.Contains(x.TaskId)).ToLookup(x => x.TaskId);
        var contractIds = tasks.Select(x => x.ContractId).OfType<Guid>().Distinct().ToArray();
        var moveIn = contractIds.Length == 0 ? new Dictionary<Guid, MoveInPreparation>() :
            await db.Database.SqlQuery<MoveInPreparation>($"""
                SELECT id AS "ContractId",handover->'preparation'->>'status' AS "Status",
                    COALESCE(jsonb_typeof(handover->'preparation'->'ownerSignature')='object',false) AS "OwnerSigned"
                FROM contracts WHERE id=ANY({contractIds})
                """).ToDictionaryAsync(x => x.ContractId, token);
        var moveOutStaff = await db.Database.SqlQuery<MoveOutStaff>($"""
            SELECT id AS "ContractId", (move_out->'current'->>'inspectionStaffId')::uuid AS "InspectionStaffId"
            FROM contracts WHERE id=ANY({contractIds}) AND move_out->'current'->>'inspectionStaffId' IS NOT NULL
            """).ToDictionaryAsync(x => x.ContractId, x => x.InspectionStaffId, token);

        var locationsIds = tasks.Select(x => x.RequiredLocationId).Concat(incidents.Select(x => x.LocationId))
            .Concat(orders.Select(x => x.LocationId)).Distinct().ToArray();
        var locations = await db.Set<BHome.Domain.Locations.Location>().AsNoTracking().Where(x => locationsIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Name, x.IsActive }).ToDictionaryAsync(x => x.Id, token);
        var today = BillingAutomationDates.BusinessDate(now);
        var assignments = await NativeOperationalTaskPersistence.Assignments(db, today)
            .Where(x => locationsIds.Contains(x.LocationId))
            .Select(x => new { x.LocationId, x.StaffUserId }).ToArrayAsync(token);
        var responsibleByLocation = assignments.Where(x => locations.GetValueOrDefault(x.LocationId)?.IsActive == true)
            .GroupBy(x => x.LocationId).Where(x => x.Count() == 1).ToDictionary(x => x.Key, x => x.Single().StaffUserId);
        var staffIds = tasks.Select(x => x.AssignedStaffUserId).OfType<Guid>()
            .Concat(incidents.Select(x => x.AcknowledgedById).OfType<Guid>())
            .Concat(moveOutStaff.Values.OfType<Guid>())
            .Concat(orders.Select(x => x.AssignedStaffId)).Concat(assignments.Select(x => x.StaffUserId)).Distinct().ToArray();
        var staff = await db.Users.AsNoTracking().Where(x => staffIds.Contains(x.Id))
            .Select(x => new { x.Id, Name = EF.Property<string>(x, "full_name") ?? x.UserName ?? x.Email })
            .ToDictionaryAsync(x => x.Id, x => x.Name, token);
        var roomIds = tasks.Select(x => x.TargetRoomId).Concat(incidents.Select(x => x.RoomId))
            .Concat(orders.Select(x => x.RoomId)).OfType<Guid>().Distinct().ToArray();
        var rooms = await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(x => roomIds.Contains(x.Id))
            .Select(x => new { x.Id, x.RoomNumber }).ToDictionaryAsync(x => x.Id, x => x.RoomNumber, token);
        var assetIds = tasks.Select(x => x.TargetAssetId).Concat(incidents.Select(x => x.AssetId))
            .Concat(orders.Select(x => x.AssetId)).OfType<Guid>().Distinct().ToArray();
        var assets = await db.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking().Where(x => assetIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Name }).ToDictionaryAsync(x => x.Id, x => x.Name, token);

        string? Name(Dictionary<Guid, string?> names, Guid? id) => id is { } key ? names.GetValueOrDefault(key) : null;
        string? RoomName(Guid? id) => id is { } key ? rooms.GetValueOrDefault(key) : null;
        string? AssetName(Guid? id) => id is { } key ? assets.GetValueOrDefault(key) : null;
        var rows = new List<Row>(tasks.Length + incidents.Length + orders.Length);
        foreach (var task in tasks)
        {
            Guid? responsible = responsibleByLocation.TryGetValue(task.RequiredLocationId, out var id) ? id : null;
            if (task.Kind == OperationalTaskKind.AdHoc && task.ContractId is { } contract && task.TaskTitle.StartsWith("Kiểm tra trả phòng"))
            {
                var worker = task.MeterStatus == MeterTaskStatus.Assigned ? moveOutStaff.GetValueOrDefault(contract) : task.AssignedStaffUserId;
                if (worker is not null && worker != responsible) responsible = null;
            }
            var state = TaskState(task, responsible, signatures, task.ContractId is { } key ? moveIn.GetValueOrDefault(key) : null);
            var assigned = task.MeterStatus is MeterTaskStatus.Completed or MeterTaskStatus.Cancelled
                ? task.AssignedStaffUserId : responsible;
            var source = recurring.Contains(task.Id) ? "Recurring" :
                task.Kind is OperationalTaskKind.LocationAssetHandover or OperationalTaskKind.MoveInInventory ? "Inventory" :
                task.ContractId is not null ? "System" : "Owner";
            rows.Add(new(new(task.Id, "task", task.TaskTitle, source, task.Kind.ToString(), task.RequiredLocationId,
                locations.GetValueOrDefault(task.RequiredLocationId)?.Name, task.TargetRoomId, RoomName(task.TargetRoomId),
                task.TargetCommonArea, AssetName(task.TargetAssetId), task.TaskPriority.ToString(), state.Status, state.Phase,
                state.Action, Name(staff, assigned), task.DueAt, task.CreatedAt, task.IsOverdue(now), null, 0),
                task.MeterStatus.ToString(), task.TargetAssetId, [], state.Verification, task.TargetLabel, responsible, task.AssignedStaffUserId));
        }
        foreach (var report in incidents.Where(_ => !workOnly))
        {
            var related = children[report.Id].ToArray();
            var open = related.Where(x => x.IsOpen).OrderBy(x => WorkState(x).Phase == Owner ? 0 : 1)
                .ThenBy(x => x.TargetCompletionAt).ThenBy(x => x.Id).ToArray();
            var active = report.IsOpen ? open.FirstOrDefault() : null;
            var state = IncidentState(report, active, pendingEmergency.Contains(report.Id));
            if (reportsOnly && report.IsOpen && active is null && report.OwnerDecisionAt is not null &&
                !pendingEmergency.Contains(report.Id))
                state = new("Chờ xử lý", Owner, "Phân công sửa chữa hoặc giải quyết sự cố");
            var representative = active ?? related.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id).FirstOrDefault();
            var due = open.Length == 0 ? (DateTimeOffset?)null : open.Min(x => x.TargetCompletionAt);
            var source = ReportSource(report);
            var reportStatus = ReportStatus(report);
            var targetAsset = report.AssetId ?? active?.AssetId;
            rows.Add(new(new(report.Id, "incident", report.Description, source, "Incident", report.LocationId,
                locations.GetValueOrDefault(report.LocationId)?.Name, report.RoomId, RoomName(report.RoomId), report.CommonArea,
                AssetName(targetAsset), report.Severity.ToString(), reportsOnly ? reportStatus : state.Status, state.Phase, state.Action,
                Name(staff, active?.AssignedStaffId ?? report.AcknowledgedById), due, report.CreatedAt,
                report.IsOpen && due < now, active?.Id, related.Length, report.Id, reportStatus, report.Description,
                representative is null ? null : WorkState(representative).Status, open.Length, related.Count(x => x.Status == WorkOrderStatus.Verified)),
                report.Status.ToString(), targetAsset, related, state.Verification,
                string.Join(" ", related.Select(x => x.Id + " " + x.Description + " " + AssetName(x.AssetId) + " " + RoomName(x.RoomId) + " " + Name(staff, x.AssignedStaffId))),
                responsibleByLocation.TryGetValue(report.LocationId, out var current) ? current : null,
                active?.AssignedStaffId ?? report.AcknowledgedById));
        }
        foreach (var order in orders.Where(x => !reportsOnly && (workOnly || x.IncidentId is null)))
        {
            var state = WorkState(order);
            var report = order.IncidentId is { } incidentId ? incidentById.GetValueOrDefault(incidentId) : null;
            var counts = order.IncidentId is { } parentId
                ? childCounts[parentId] : (Total: 1, Open: order.IsOpen ? 1 : 0, Verified: order.Status == WorkOrderStatus.Verified ? 1 : 0);
            var title = string.IsNullOrWhiteSpace(order.Description) ? report?.Description ?? order.ExpectedOutcome : order.Description;
            rows.Add(new(new(order.Id, "workOrder", title,
                report is null ? (order.IncidentId is null ? "Proactive" : "System") : ReportSource(report),
                order.IncidentId is null ? "Proactive" : "Incident", order.LocationId,
                locations.GetValueOrDefault(order.LocationId)?.Name, order.RoomId, RoomName(order.RoomId), order.CommonArea,
                AssetName(order.AssetId), report?.Severity.ToString() ?? "Normal", state.Status, state.Phase, state.Action, Name(staff, order.AssignedStaffId),
                order.TargetCompletionAt, order.CreatedAt, order.IsOpen && order.TargetCompletionAt < now,
                order.IsOpen ? order.Id : null, counts.Total, order.IncidentId, report is null ? null : ReportStatus(report),
                report?.Description, state.Status, counts.Open, counts.Verified),
                order.Status.ToString(), order.AssetId, [], state.Verification,
                SearchDetails: report is null ? null : report.Id + " " + report.Description,
                ResponsibleId: responsibleByLocation.TryGetValue(order.LocationId, out var current) && current == order.AssignedStaffId ? current : null,
                RecordedStaffId: order.AssignedStaffId, ProposedAssetId: order.ProposedAssetId));
        }
        return Filter(rows, query);
    }

    private static OperationalWorkPage Filter(IEnumerable<Row> rows, OperationalWorkQuery query)
    {
        static bool Match(string? filter, string value) => string.IsNullOrWhiteSpace(filter) ||
            string.Equals(filter.Trim(), value, StringComparison.OrdinalIgnoreCase);
        var search = query.Search?.Trim();
        var filtered = rows.Where(r =>
            Match(query.Kind, r.Item.Kind) && Match(query.Source, r.Item.Source) &&
            Match(query.WorkType, r.Item.WorkType) && Match(query.Priority, r.Item.Priority) &&
            (Match(query.Status, r.Item.Status) || Match(query.Status, r.RawStatus) ||
                (query.View != "reports" && r.Children.Any(x => Match(query.Status, x.Status.ToString())))) &&
            (query.RoomId is null || r.Item.RoomId == query.RoomId || r.Children.Any(x => x.RoomId == query.RoomId)) &&
            (query.AssetId is null || r.AssetId == query.AssetId || r.ProposedAssetId == query.AssetId || r.Children.Any(x => x.AssetId == query.AssetId || x.ProposedAssetId == query.AssetId)) &&
            (query.IncidentId is null || r.Item.IncidentId == query.IncidentId) &&
            (query.WorkOrderId is null || r.Item.Kind == "workOrder" && r.Item.Id == query.WorkOrderId || r.Children.Any(x => x.Id == query.WorkOrderId)) &&
            (query.IsOverdue is null || r.Item.IsOverdue == query.IsOverdue) &&
            (query.StaffUserId is null || r.ResponsibleId == query.StaffUserId) &&
            (query.RecordedStaffUserId is null || r.RecordedStaffId == query.RecordedStaffUserId || r.Children.Any(x => x.AssignedStaffId == query.RecordedStaffUserId)) &&
            (query.HasResponsibility is null || (r.ResponsibleId != null) == query.HasResponsibility) &&
            (query.DueFrom is null || r.Item.DueAt >= query.DueFrom) &&
            (query.DueTo is null || r.Item.DueAt <= query.DueTo) &&
            (query.Maintenance is null || (r.Item.Kind == "workOrder" || r.Children.Length > 0) == query.Maintenance) &&
            (string.IsNullOrWhiteSpace(search) || new[] { r.Item.Title,r.Item.LocationName,r.Item.RoomNumber,r.Item.AssetName,
                r.Item.CommonArea,r.Item.StaffName,r.Item.Id.ToString(),r.SearchDetails }.Any(x => x?.Contains(search, StringComparison.OrdinalIgnoreCase) == true)))
            .ToArray();
        var counts = new OperationalWorkCounts(filtered.Length, filtered.Count(x => x.Item.Phase == Owner),
            filtered.Count(x => x.Item.Phase == Active), filtered.Count(x => x.Item.Phase == Closed),
            filtered.Count(x => x.Item.IsOverdue), filtered.Count(x => x.Verification));
        var selected = filtered.Where(x => Match(query.Phase, x.Item.Phase) &&
            (query.Verification is null || x.Verification == query.Verification)).Select(x => x.Item).ToArray();
        var items = selected.OrderBy(x => x.Phase == Owner ? 0 : x.Phase == Active ? 1 : 2)
            .ThenByDescending(x => x.IsOverdue).ThenBy(x => x.DueAt ?? DateTimeOffset.MaxValue)
            .ThenByDescending(x => x.CreatedAt).ThenBy(x => x.Kind).ThenBy(x => x.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToArray();
        return new(items, query.Page, query.PageSize, selected.Length, counts);
    }
}
