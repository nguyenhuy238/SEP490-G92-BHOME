using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.IncidentMaintenance;

public sealed class IncidentService(IIncidentRepository repository, ICurrentUser user, PermissionAccess permissions,
    IIncidentFiles files, IBackgroundJobQueue jobs, TimeProvider clock)
{
    public const int MaximumImageBytes = 5_000_000;
    public const int MaximumImages = 5;
    private static readonly TimeZoneInfo Vietnam = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(Now, Vietnam).DateTime);
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new IncidentException(401, "authentication_required");

    private async Task PermitAsync(string permission, CancellationToken t)
    {
        _ = Actor;
        if (!permissions.HasPermission(permission)) throw new IncidentException(403, "incident_permission_denied");
        foreach (var role in RolePermissions.GetAllowedRoles(permission))
            if (user.IsInRole(role) && await repository.ActiveRoleAsync(Actor, role, t)) return;
        throw new IncidentException(403, "incident_permission_denied");
    }
    private async Task<IncidentScope> ScopeAsync(CancellationToken t) => new(Actor,
        user.IsInRole(Roles.Owner) && await repository.ActiveRoleAsync(Actor, Roles.Owner, t),
        user.IsInRole(Roles.Staff) && await repository.ActiveRoleAsync(Actor, Roles.Staff, t),
        user.IsInRole(Roles.Tenant) && await repository.ActiveRoleAsync(Actor, Roles.Tenant, t), Today);

    private async Task<IncidentScope> AccessAsync(IncidentReport report, CancellationToken t)
    {
        var scope = await ScopeAsync(t);
        if (scope.Owner) return scope;
        var assigned = scope.Staff && await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t);
        if (assigned) return scope;
        if (scope.Tenant && report.ReporterRole == Roles.Tenant && report.ReporterId == Actor) return scope with { Staff = false };
        throw IncidentException.Missing();
    }
    private async Task RequireExecutionAsync(IncidentReport report, MaintenanceWorkOrder work, CancellationToken t)
    {
        await PermitAsync(Permissions.WorkOrders.Execute, t);
        if (work.AssignedStaffId != Actor || !await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t))
            throw IncidentException.Missing();
    }
    private static string Text(string? value, int min = 1, int max = 8000)
    {
        value = value?.Trim();
        if (value is null || value.Length < min || value.Length > max) throw IncidentException.Invalid("invalid_incident_text");
        return value;
    }
    private static void Money(decimal? value, bool required = false)
    {
        if (required && value is null || value is { } v && (v < 0 || v > 999_999_999_999_999_999m || decimal.Truncate(v) != v))
            throw IncidentException.Invalid("invalid_vnd_amount");
    }
    private static void Key(Guid key) { if (key == Guid.Empty) throw IncidentException.Invalid("idempotency_key_required"); }
    private static void Page(int page, int size)
    { if (page is < 1 or > 1000000 || size is < 1 or > 100) throw IncidentException.Invalid("invalid_pagination"); }
    private static void Query(IncidentQuery q)
    {
        Page(q.Page, q.PageSize);
        if (q.LocationId == Guid.Empty || q.IncidentId == Guid.Empty || q.RoomId == Guid.Empty || q.AssetId == Guid.Empty ||
            q.Status is { } status && !Enum.IsDefined(status) || q.Severity is { } severity && !Enum.IsDefined(severity) ||
            q.WorkOrderStatus is { } work && !Enum.IsDefined(work)) throw IncidentException.Invalid("invalid_incident_filter");
    }
    private static void Open(IncidentReport report)
    { if (!report.IsOpen) throw IncidentException.Conflict("incident_closed"); }
    private static void Version(int expected, int actual)
    { if (expected != actual) throw IncidentException.Conflict("stale_version"); }
    private static void Transition(Action action)
    { try { action(); } catch (InvalidOperationException) { throw IncidentException.Conflict("invalid_work_order_transition"); } }

    public async Task<IncidentPage<IncidentView>> ListAsync(IncidentQuery query, CancellationToken t)
    { await PermitAsync(Permissions.Incidents.View, t); Query(query); return await repository.ListAsync(await ScopeAsync(t), query, t); }
    public async Task<IncidentPage<IncidentReportingRoom>> ReportingRoomsAsync(IncidentLookupQuery query, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Report, t); Page(query.Page, query.PageSize);
        if (query.LocationId == Guid.Empty || query.RoomId == Guid.Empty) throw IncidentException.Invalid("invalid_incident_filter");
        return await repository.ReportingRoomsAsync((await ScopeAsync(t)) with { Owner = false }, query, t);
    }
    public async Task<IncidentPage<IncidentReportingAsset>> ReportingAssetsAsync(IncidentLookupQuery query, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Report, t); Page(query.Page, query.PageSize);
        if (query.LocationId == Guid.Empty || query.RoomId == Guid.Empty) throw IncidentException.Invalid("invalid_incident_filter");
        return await repository.ReportingAssetsAsync((await ScopeAsync(t)) with { Owner = false }, query, t);
    }
    public async Task<IncidentView> GetAsync(Guid id, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.View, t);
        var report = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing();
        var scope = await AccessAsync(report, t);
        var available = await repository.StaffAvailableAsync(report.LocationId, Today, t);
        return IncidentProjection.Report(report, scope.Owner || scope.Staff ? available : null);
    }
    public async Task<IncidentPage<IncidentActivityView>> HistoryAsync(Guid id, int page, int size, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.View, t); Page(page, size);
        var scope = await AccessAsync(await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(), t);
        return await repository.HistoryAsync(id, scope, page, size, t);
    }
    public async Task<IncidentPage<WorkOrderView>> WorkOrdersAsync(IncidentQuery query, CancellationToken t)
    { await PermitAsync(Permissions.WorkOrders.View, t); Query(query); return await repository.ListWorkOrdersAsync((await ScopeAsync(t)) with { Tenant = false }, query, Now, t); }
    public async Task<WorkOrderView> WorkOrderAsync(Guid id, CancellationToken t)
    {
        await PermitAsync(Permissions.WorkOrders.View, t);
        var work = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
        var report = await repository.IncidentAsync(work.IncidentId, t) ?? throw IncidentException.Missing();
        var scope = await AccessAsync(report, t);
        if (!scope.Owner && !scope.Staff) throw IncidentException.Missing();
        return IncidentProjection.Work(work, Now, scope.Owner || work.AssignedStaffId == Actor);
    }
    public async Task<IncidentPage<MaintenanceHistoryView>> MaintenanceAsync(IncidentQuery query, CancellationToken t)
    { await PermitAsync(Permissions.WorkOrders.View, t); Query(query); return await repository.MaintenanceAsync((await ScopeAsync(t)) with { Tenant = false }, query, t); }
    public async Task<IReadOnlyList<ExpenseView>> ExpensesAsync(Guid id, CancellationToken t)
    { await PermitAsync(Permissions.Incidents.Manage, t); await GetAsync(id, t); return await repository.ExpensesAsync(id, t); }
    public async Task<IReadOnlyList<EmergencyActionView>> EmergencyActionsAsync(Guid id, CancellationToken t)
    {
        await PermitAsync(Permissions.WorkOrders.View, t);
        var scope = await AccessAsync(await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(), t);
        if (!scope.Owner && !scope.Staff) throw IncidentException.Missing();
        var actions = await repository.EmergencyActionsAsync(id, t);
        // Staff receives only their own operational cost claim, not aggregate Location finances.
        return actions.Select(a => new EmergencyActionView(a.Id, a.ActivityId,
            scope.Owner || a.ActorId == Actor ? a.RequestedCost : null,
            scope.Owner || a.ActorId == Actor ? a.CostApproved : null)).ToArray();
    }

    private async Task<IncidentCommandResult> CommandAsync(Guid location, Guid? room, Guid key, string operation, object input,
        Func<Task> authorize, Func<Task<IncidentCommandResult>> work, CancellationToken t)
    {
        Key(key);
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(operation + "\n" + JsonSerializer.Serialize(input))));
        return await repository.TransactionAsync(location, room, Actor, key, async () =>
        {
            // Recheck authority even for replay; a historical response is not a lasting access grant.
            await authorize();
            var previous = await repository.CommandAsync(Actor, key, t);
            if (previous is not null)
            {
                if (previous.Fingerprint != fingerprint) throw IncidentException.Conflict("idempotency_conflict");
                return JsonSerializer.Deserialize<IncidentCommandResult>(previous.ResponseJson)!;
            }
            var result = await work();
            repository.Add(new IncidentCommand
            {
                ActorId = Actor,
                Key = key,
                IncidentId = result.IncidentId,
                Fingerprint = fingerprint,
                ResponseJson = JsonSerializer.Serialize(result)
            });
            return result;
        }, t);
    }

    public async Task<IncidentCommandResult> SubmitAsync(IncidentSubmit input, IReadOnlyList<IncidentImage> images, Guid key, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.Report, t); Key(key);
        if (input.LocationId == Guid.Empty || input.RoomId == Guid.Empty || input.AssetId == Guid.Empty || !Enum.IsDefined(input.Severity) ||
            (input.RoomId.HasValue == !string.IsNullOrWhiteSpace(input.CommonArea)) || images.Count > MaximumImages)
            throw IncidentException.Invalid("invalid_incident_scope_or_evidence");
        var description = Text(input.Description, 10); var commonArea = input.RoomId.HasValue ? null : Text(input.CommonArea, 1, 200);
        var room = input.RoomId;
        var role = "";
        IncidentTenancy? tenancy = null;
        async Task Authorize()
        {
            await PermitAsync(Permissions.Incidents.Report, t);
            if (!await repository.ActiveLocationAsync(input.LocationId, t)) throw IncidentException.Missing();
            if (role.Length == 0)
                role = user.IsInRole(Roles.Staff) && await repository.StaffAssignedAsync(Actor, input.LocationId, Today, t) ? Roles.Staff : Roles.Tenant;
            if (role == Roles.Staff)
            {
                if (!await repository.ActiveRoleAsync(Actor, Roles.Staff, t) || !await repository.StaffAssignedAsync(Actor, input.LocationId, Today, t))
                    throw IncidentException.Missing();
            }
            else
            {
                if (!user.IsInRole(Roles.Tenant) || !await repository.ActiveRoleAsync(Actor, Roles.Tenant, t)) throw IncidentException.Missing();
                tenancy = await repository.TenancyAsync(Actor, input.LocationId, input.RoomId, Today, t) ?? throw IncidentException.Missing();
                room = tenancy.RoomId;
            }
        }
        await Authorize();
        var types = images.Select(i => files.Validate(i.Content)).ToArray();
        var hashes = images.Select(i => Convert.ToHexString(SHA256.HashData(i.Content))).ToArray();
        var authorizedRoom = room;
        return await CommandAsync(input.LocationId, room, key, "submit", new { input, Hashes = hashes }, Authorize, async () =>
        {
            if (room != authorizedRoom) throw IncidentException.Conflict("tenancy_changed_retry");
            if (input.RoomId is { } roomId && (await repository.RoomAsync(roomId, t))?.LocationId != input.LocationId) throw IncidentException.Missing();
            if (input.AssetId is { } assetId)
            {
                var asset = await repository.AssetAsync(assetId, t) ?? throw IncidentException.Missing();
                if (asset.LocationId != input.LocationId || asset.RoomId != input.RoomId ||
                    input.RoomId is null && !string.Equals(asset.CommonArea, commonArea, StringComparison.Ordinal)) throw IncidentException.Missing();
            }
            var report = new IncidentReport
            {
                LocationId = input.LocationId,
                RoomId = input.RoomId,
                CommonArea = commonArea,
                AssetId = input.AssetId,
                ContractId = tenancy?.ContractId,
                ReporterId = Actor,
                ReporterRole = role,
                Description = description,
                Severity = input.Severity
            };
            if (role == Roles.Staff && report.Severity == IncidentSeverity.Emergency)
            { report.AcknowledgedById = Actor; report.AcknowledgedAt = Now; }
            repository.Add(report);
            var entry = Activity(report, null, "submitted", "", true, new { report.Severity, report.AcknowledgedById });
            for (var i = 0; i < images.Count; i++)
                await StoreAsync(report, null, IncidentEvidenceKind.Report, entry.Id, images[i].Content, types[i], hashes[i], t);
            await NotifyAsync(report, entry, await repository.RecipientsAsync(report.LocationId, Today, report.Severity == IncidentSeverity.Emergency, t), t);
            return new(report.Id);
        }, t);
    }

    private async Task<IncidentCommandResult> MutateAsync(Guid id, int version, Guid key, string operation, object input,
        string permission, Func<IncidentReport, Task<IncidentCommandResult>> work, CancellationToken t)
    {
        await PermitAsync(permission, t);
        var initial = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing();
        await AccessAsync(initial, t);
        // A common-area Tenant report still serializes with its source tenancy's Room transitions.
        var lockRoom = initial.RoomId;
        if (lockRoom is null && initial.ContractId is not null)
            lockRoom = await repository.ContractRoomAsync(initial.ContractId.Value, t);
        return await CommandAsync(initial.LocationId, lockRoom, key, operation + ":" + id, input, async () =>
        {
            await PermitAsync(permission, t);
            await AccessAsync(await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(), t);
        }, async () =>
        {
            var report = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing();
            Version(version, report.Version); Open(report);
            var result = await work(report); report.Version++; return result;
        }, t);
    }

    public Task<IncidentCommandResult> ReviewAsync(Guid id, IncidentReview input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "review", input, Permissions.Incidents.Manage, async report =>
        {
            report.Type = Text(input.Type, 1, 100); report.Category = Text(input.Category, 1, 100); report.OwnerDecisionAt ??= Now;
            var activity = Activity(report, null, "reviewed", "", true, new { report.Type, report.Category });
            await NotifyAsync(report, activity, [report.ReporterId], t); return new(report.Id);
        }, t);

    public Task<IncidentCommandResult> DecideAsync(Guid id, string action, IncidentDecision input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, action, input,
            action == "cancel" ? Permissions.Incidents.View : Permissions.Incidents.Manage, async report =>
        {
            var reason = Text(input.Reason, 1, 2000); var scope = await ScopeAsync(t);
            if (action == "cancel" && !scope.Owner && (report.ReporterId != Actor || report.OwnerDecisionAt is not null))
                throw new IncidentException(403, "reporter_cannot_cancel_after_owner_decision");
            if (action != "cancel" || scope.Owner) await PermitAsync(Permissions.Incidents.Manage, t);
            var orders = await repository.WorkOrdersAsync(id, t);
            if (orders.Any(w => w.IsOpen)) throw IncidentException.Conflict("open_work_orders_require_cancellation");
            if (orders.Any(w => w.Status == WorkOrderStatus.Verified) && action is "reject" or "duplicate")
                throw IncidentException.Conflict("verified_work_cannot_be_rejected");
            await NoPendingCostsAsync(report, t);
            if (action == "duplicate")
            {
                if (input.DuplicateOfId is not { } original || original == id) throw IncidentException.Invalid("invalid_duplicate_reference");
                var target = await repository.IncidentAsync(original, t) ?? throw IncidentException.Missing();
                if (target.LocationId != report.LocationId || target.RoomId != report.RoomId || target.AssetId != report.AssetId || target.CommonArea != report.CommonArea ||
                    target.Status is IncidentStatus.Duplicate or IncidentStatus.Rejected or IncidentStatus.Cancelled)
                    throw IncidentException.Invalid("invalid_duplicate_reference");
                report.DuplicateOfId = original;
            }
            if (action == "resolve" && orders.Any(w => w.Status != WorkOrderStatus.Cancelled))
                throw IncidentException.Conflict("work_order_verification_required");
            report.Status = action switch
            {
                "reject" => IncidentStatus.Rejected,
                "duplicate" => IncidentStatus.Duplicate,
                "cancel" => IncidentStatus.Cancelled,
                "resolve" => IncidentStatus.Resolved,
                _ => throw IncidentException.Invalid("unknown_incident_action")
            };
            if (scope.Owner) report.OwnerDecisionAt ??= Now;
            report.ResolutionNote = reason; report.ResolvedAt = Now;
            var activity = Activity(report, null, action, reason, true, new { report.DuplicateOfId });
            await NotifyAsync(report, activity, [report.ReporterId], t); return new(report.Id);
        }, t);

    public Task<IncidentCommandResult> AssignAsync(Guid id, WorkOrderAssign input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "assign", input, Permissions.Incidents.Manage, async report =>
        {
            if (report.Type is null || report.Category is null) throw IncidentException.Conflict("owner_classification_required");
            if (!await repository.StaffAssignedAsync(input.StaffId, report.LocationId, Today, t)) throw IncidentException.Conflict("staff_unavailable");
            if (input.TargetCompletionAt <= Now)
                throw IncidentException.Invalid("invalid_target_completion");
            var order = new MaintenanceWorkOrder
            {
                IncidentId = id,
                LocationId = report.LocationId,
                RoomId = report.RoomId,
                AssetId = report.AssetId,
                AssignedStaffId = input.StaffId,
                ExpectedOutcome = Text(input.ExpectedOutcome, 1, 4000),
                TargetCompletionAt = input.TargetCompletionAt.ToUniversalTime()
            };
            repository.Add(order); report.Status = IncidentStatus.InProgress; report.OwnerDecisionAt ??= Now;
            if (report.AssetId is { } assetId)
            {
                var asset = await repository.AssetAsync(assetId, t) ?? throw IncidentException.Missing();
                if (asset.Status == AssetStatus.Retired) throw IncidentException.Conflict("asset_retired");
                if (asset.Status != AssetStatus.UnderRepair) { asset.Status = AssetStatus.NeedsRepair; asset.Version++; }
            }
            var activity = Activity(report, order, "assigned", "", true, new { order.AssignedStaffId, order.ExpectedOutcome, order.TargetCompletionAt });
            await NotifyAsync(report, activity, [order.AssignedStaffId, report.ReporterId], t); return new(id, order.Id);
        }, t);

    public Task<IncidentCommandResult> AcknowledgeAsync(Guid id, WorkOrderAction input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "acknowledge", input, Permissions.Incidents.Respond, async report =>
        {
            if (report.Severity != IncidentSeverity.Emergency) throw IncidentException.Conflict("emergency_required");
            if (!await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t)) throw IncidentException.Missing();
            if (report.AcknowledgedAt is not null) throw IncidentException.Conflict("already_acknowledged");
            report.AcknowledgedById = Actor; report.AcknowledgedAt = Now;
            var activity = Activity(report, null, "acknowledged", "", true, new { report.AcknowledgedById });
            await NotifyAsync(report, activity, (await repository.RecipientsAsync(report.LocationId, Today, false, t)).Append(report.ReporterId).ToArray(), t);
            return new(id);
        }, t);

    public Task<IncidentCommandResult> EmergencyEntryAsync(Guid id, EmergencyEntry input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "emergency-action", input, Permissions.Incidents.View, async report =>
        {
            var scope = await ScopeAsync(t);
            if (!scope.Owner && !(scope.Staff && await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t)))
                throw new IncidentException(403, "incident_permission_denied");
            if (report.Severity != IncidentSeverity.Emergency) throw IncidentException.Conflict("emergency_required");
            if (!scope.Owner && report.AcknowledgedAt is null) throw IncidentException.Conflict("acknowledgement_required");
            Money(input.RequestedCost);
            var evidence = await SelectEvidenceAsync(report, null, IncidentEvidenceKind.EmergencyAction, input.EvidenceIds, t);
            if (input.RequestedCost > 0 && evidence.Count == 0) throw IncidentException.Conflict("cost_receipt_required");
            var activity = Activity(report, null, "emergency_action", Text(input.Note), false, new { input.RequestedCost, input.EvidenceIds });
            Link(evidence, activity.Id);
            var entry = new EmergencyAction { IncidentId = id, ActivityId = activity.Id, ActorId = Actor, RequestedCost = input.RequestedCost };
            repository.Add(entry);
            await NotifyAsync(report, activity, await repository.RecipientsAsync(report.LocationId, Today, false, t), t);
            return new(id, ResourceId: entry.Id);
        }, t);

    public Task<IncidentCommandResult> EmergencyCostAsync(Guid id, Guid entryId, EmergencyCostDecision input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "emergency-cost:" + entryId, input, Permissions.Incidents.Manage, async report =>
        {
            var entry = (await repository.EmergencyActionsAsync(id, t)).SingleOrDefault(e => e.Id == entryId) ?? throw IncidentException.Missing();
            if (entry.RequestedCost is null || entry.CostApproved is not null) throw IncidentException.Conflict("cost_not_pending");
            var reason = Text(input.Reason, 1, 2000);
            if (input.Approve is null) throw IncidentException.Invalid("approval_decision_required");
            entry.CostApproved = input.Approve; entry.CostDecidedById = Actor; entry.CostDecidedAt = Now;
            var activity = Activity(report, null, "emergency_cost_decided", reason, false, new { entry.Id, input.Approve, entry.RequestedCost });
            if (input.Approve.Value) Expense(report, null, entry.Id, "EmergencyAction", entry.Id, entry.RequestedCost.Value);
            await TryResolveAsync(report, activity, t); return new(id, ResourceId: entryId);
        }, t);

    private async Task<IncidentCommandResult> WorkMutationAsync(Guid id, int version, Guid key, string operation, object input,
        string permission, bool execute, Func<IncidentReport, MaintenanceWorkOrder, Task<IncidentCommandResult>> work, CancellationToken t)
    {
        await PermitAsync(permission, t);
        var initial = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
        var report = await repository.IncidentAsync(initial.IncidentId, t) ?? throw IncidentException.Missing();
        await AccessAsync(report, t);
        if (execute) await RequireExecutionAsync(report, initial, t);
        return await CommandAsync(report.LocationId, report.RoomId, key, operation + ":" + id, input, async () =>
        {
            await PermitAsync(permission, t);
            var current = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
            var source = await repository.IncidentAsync(current.IncidentId, t) ?? throw IncidentException.Missing();
            await AccessAsync(source, t);
            if (execute) await RequireExecutionAsync(source, current, t);
        }, async () =>
        {
            var current = await repository.WorkOrderAsync(id, t) ?? throw IncidentException.Missing();
            var source = await repository.IncidentAsync(current.IncidentId, t) ?? throw IncidentException.Missing();
            Version(version, current.Version); Open(source);
            var result = await work(source, current); current.Version++; source.Version++; return result;
        }, t);
    }

    public Task<IncidentCommandResult> ReassignAsync(Guid id, WorkOrderReassign input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "reassign", input, Permissions.Incidents.Manage, false, async (report, order) =>
        {
            if (!order.IsOpen) throw IncidentException.Conflict("work_order_closed");
            if (!await repository.StaffAssignedAsync(input.StaffId, report.LocationId, Today, t)) throw IncidentException.Conflict("staff_unavailable");
            var previous = order.AssignedStaffId; order.AssignedStaffId = input.StaffId;
            var activity = Activity(report, order, "reassigned", Text(input.Reason, 1, 2000), false, new { Previous = previous, order.AssignedStaffId });
            await NotifyAsync(report, activity, [order.AssignedStaffId], t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> ProposeAsync(Guid id, RepairProposal input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "propose", input, Permissions.WorkOrders.Execute, true, async (report, order) =>
        {
            Money(input.EstimatedCost);
            if (input.EstimatedMinutes < 1) throw IncidentException.Invalid("invalid_estimated_time");
            var inspection = Text(input.InspectionResult); var solution = Text(input.Solution);
            var evidence = await SelectEvidenceAsync(report, order, IncidentEvidenceKind.Inspection, input.EvidenceIds, t);
            Transition(order.Propose); order.InspectionResult = inspection; order.ProposedSolution = solution;
            order.EstimatedCost = input.EstimatedCost; order.EstimatedMinutes = input.EstimatedMinutes;
            var activity = Activity(report, order, "proposal_submitted", "", false, new { input, order.ProposalVersion }); Link(evidence, activity.Id);
            await NotifyAsync(report, activity, await repository.RecipientsAsync(report.LocationId, Today, false, t), t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> PlanAsync(Guid id, PlanDecision input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "plan-decision", input, Permissions.WorkOrders.ApprovePlan, false, async (report, order) =>
        {
            if (input.Approve is null) throw IncidentException.Invalid("approval_decision_required");
            if (!input.Approve.Value) _ = Text(input.Reason, 1, 2000);
            if (input.Vendor is not null) order.Vendor = Text(input.Vendor, 1, 500);
            Transition(() => order.DecidePlan(input.Approve.Value, Actor, Now));
            var activity = Activity(report, order, input.Approve.Value ? "plan_approved" : "plan_rejected", input.Reason?.Trim() ?? "", false,
                new { order.ProposalVersion, input.Approve, order.Vendor });
            await NotifyAsync(report, activity, [order.AssignedStaffId], t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> ActAsync(Guid id, string action, WorkOrderAction input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, action, input,
            action == "rework" ? Permissions.WorkOrders.Verify : Permissions.WorkOrders.Execute,
            action != "rework", async (report, order) =>
        {
            var note = action == "start" ? "" : Text(input.Note);
            if (action is "start" or "rework" && input.EvidenceIds is { Length: > 0 }) throw IncidentException.Invalid("evidence_not_supported_for_action");
            if (action == "start")
            {
                Transition(order.Start);
                if (order.AssetId is { } assetId)
                {
                    var asset = await repository.AssetAsync(assetId, t) ?? throw IncidentException.Missing();
                    if (asset.Status == AssetStatus.Retired) throw IncidentException.Conflict("asset_retired");
                    asset.Status = AssetStatus.UnderRepair; asset.Version++;
                }
            }
            else if (action == "rework") Transition(order.Rework);
            else if (action is "progress" or "blocker")
            { if (order.Status != WorkOrderStatus.InProgress) throw IncidentException.Conflict("work_order_not_in_progress"); }
            else if (action != "submit") throw IncidentException.Invalid("unknown_work_order_action");
            var evidence = await SelectEvidenceAsync(report, order, IncidentEvidenceKind.Completion, input.EvidenceIds ?? [], t);
            if (action == "submit" && evidence.Count == 0) throw IncidentException.Conflict("completion_evidence_required");
            var activity = Activity(report, order, action, note, false, new { input.EvidenceIds, order.Status });
            if (action == "submit") { order.Result = note; Transition(() => order.Submit(activity.Id)); }
            Link(evidence, activity.Id);
            var recipients = action is "submit" or "blocker" ? await repository.RecipientsAsync(report.LocationId, Today, false, t) : [order.AssignedStaffId];
            await NotifyAsync(report, activity, recipients, t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> VerifyAsync(Guid id, MaintenanceVerification input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "verify", input, Permissions.WorkOrders.Verify, false, async (report, order) =>
        {
            Money(input.ActualCost, true); var result = Text(input.Result);
            if (order.EstimatedCost != input.ActualCost) _ = Text(input.CostVarianceReason, 1, 2000);
            var evidence = (await repository.EvidenceAsync(report.Id, t)).Where(e => e.WorkOrderId == id && e.Kind == IncidentEvidenceKind.Completion &&
                e.ActivityId != null && e.ActivityId == order.CompletionActivityId).ToArray();
            if (evidence.Length == 0) throw IncidentException.Conflict("completion_evidence_required");
            foreach (var image in evidence) await files.CopyAsync(image.ObjectKey, Stream.Null, t);
            Transition(() => order.Verify(Actor, Now)); order.ActualCost = input.ActualCost;
            var activity = Activity(report, order, "verified", result, false, new { input.ActualCost, input.CostVarianceReason, input.AssetStatus });
            await CompleteAssetAsync(report, order, activity, input.AssetCondition, input.AssetStatus, input.ActualCost!.Value, t);
            Expense(report, order, null, "WorkOrder", id, input.ActualCost.Value);
            await TryResolveAsync(report, activity, t);
            await NotifyAsync(report, activity, [order.AssignedStaffId], t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> CancelWorkOrderAsync(Guid id, IncidentDecision input, Guid key, CancellationToken t) =>
        WorkMutationAsync(id, input.Version, key, "cancel-work-order", input, Permissions.Incidents.Manage, false, async (report, order) =>
        {
            var reason = Text(input.Reason, 1, 2000); Transition(order.Cancel);
            var activity = Activity(report, order, "work_order_cancelled", reason, false, new { input.AssetStatus, input.AssetCondition });
            if (order.AssetId is not null)
            {
                if (input.AssetStatus is null) throw IncidentException.Invalid("asset_outcome_required");
                await CompleteAssetAsync(report, order, activity, input.AssetCondition, input.AssetStatus.Value, 0, t);
            }
            await TryResolveAsync(report, activity, t);
            await NotifyAsync(report, activity, [order.AssignedStaffId], t); return new(report.Id, id);
        }, t);

    public Task<IncidentCommandResult> DirectAsync(Guid id, DirectCompletion input, Guid key, CancellationToken t) =>
        MutateAsync(id, input.Version, key, "direct-completion", input, Permissions.Incidents.Manage, async report =>
        {
            var orders = await repository.WorkOrdersAsync(id, t);
            if (orders.Any(w => w.Status != WorkOrderStatus.Cancelled)) throw IncidentException.Conflict("existing_work_requires_verification");
            if (report.Type is null || report.Category is null) throw IncidentException.Conflict("owner_classification_required");
            await NoPendingCostsAsync(report, t); Money(input.ActualCost, true);
            var evidence = await SelectEvidenceAsync(report, null, IncidentEvidenceKind.Direct, input.EvidenceIds, t);
            if (evidence.Count == 0) throw IncidentException.Conflict("completion_evidence_required");
            var result = Text(input.Result);
            var activity = Activity(report, null, "direct_completed", "", true, new { input.ActualCost, input.AssetStatus }); Link(evidence, activity.Id);
            await CompleteAssetAsync(report, null, activity, input.AssetCondition, input.AssetStatus, input.ActualCost!.Value, t);
            Expense(report, null, null, "Direct", activity.Id, input.ActualCost.Value);
            report.Status = IncidentStatus.Resolved; report.OwnerDecisionAt ??= Now; report.ResolvedAt = Now; report.ResolutionNote = result;
            await NotifyAsync(report, activity, [report.ReporterId], t); return new(id);
        }, t);

    private async Task NoPendingCostsAsync(IncidentReport report, CancellationToken t)
    {
        if ((await repository.EmergencyActionsAsync(report.Id, t)).Any(e => e.RequestedCost.HasValue && e.CostApproved is null))
            throw IncidentException.Conflict("emergency_cost_decision_required");
    }
    private async Task TryResolveAsync(IncidentReport report, IncidentActivity cause, CancellationToken t)
    {
        // Queries include current tracked changes; concurrent writes share the Location transaction lock.
        var orders = await repository.WorkOrdersAsync(report.Id, t);
        if (!IncidentReport.CanResolve(orders.Select(w => w.Status).ToArray()) ||
            (await repository.EmergencyActionsAsync(report.Id, t)).Any(e => e.RequestedCost.HasValue && e.CostApproved is null)) return;
        report.Status = IncidentStatus.Resolved; report.ResolvedAt = Now; report.ResolutionNote = "Công việc đã được Owner xác minh hoàn tất.";
        var activity = Activity(report, null, "resolved", report.ResolutionNote, true, new { CauseActivityId = cause.Id });
        await NotifyAsync(report, activity, [report.ReporterId], t);
    }
    private async Task CompleteAssetAsync(IncidentReport report, MaintenanceWorkOrder? order, IncidentActivity activity,
        string? condition, AssetStatus outcome, decimal actualCost, CancellationToken t)
    {
        if (outcome is not (AssetStatus.Active or AssetStatus.NeedsRepair or AssetStatus.Retired)) throw IncidentException.Invalid("invalid_asset_outcome");
        Asset? asset = null; string? beforeCondition = null; string? beforeStatus = null;
        if (report.AssetId is { } id)
        {
            asset = await repository.AssetAsync(id, t) ?? throw IncidentException.Missing();
            beforeCondition = asset.Condition; beforeStatus = asset.Status.ToString(); var after = Text(condition, 1, 1000);
            var otherWork = await repository.OtherAssetWorkAsync(id, order?.Id, t);
            if (outcome == AssetStatus.Retired && otherWork) throw IncidentException.Conflict("asset_has_open_work");
            if (asset.Status == AssetStatus.Retired && outcome != AssetStatus.Retired) throw IncidentException.Conflict("asset_retired");
            asset.Condition = after;
            asset.Status = outcome == AssetStatus.Retired ? outcome :
                await repository.OtherAssetExecutionAsync(id, order?.Id, t) ? AssetStatus.UnderRepair :
                otherWork ? AssetStatus.NeedsRepair : outcome;
            asset.Version++;
        }
        repository.Add(new MaintenanceHistory
        {
            IncidentId = report.Id,
            WorkOrderId = order?.Id,
            ActivityId = activity.Id,
            LocationId = report.LocationId,
            RoomId = report.RoomId,
            AssetId = report.AssetId,
            ConditionBefore = beforeCondition,
            ConditionAfter = asset?.Condition,
            StatusBefore = beforeStatus,
            StatusAfter = asset?.Status.ToString(),
            ActualCost = actualCost,
            VerifiedById = Actor,
            VerifiedAt = Now
        });
    }
    private void Expense(IncidentReport report, MaintenanceWorkOrder? order, Guid? emergency, string sourceType, Guid source, decimal amount)
    {
        if (amount == 0) return;
        repository.Add(new MaintenanceExpense
        {
            IncidentId = report.Id,
            LocationId = report.LocationId,
            RoomId = report.RoomId,
            AssetId = report.AssetId,
            WorkOrderId = order?.Id,
            EmergencyActionId = emergency,
            SourceType = sourceType,
            SourceId = source,
            Amount = amount,
            ExpenseDate = Today,
            ConfirmedById = Actor,
            ConfirmedAt = Now
        });
    }
    private IncidentActivity Activity(IncidentReport report, MaintenanceWorkOrder? work, string action, string note, bool tenantVisible, object data)
    {
        var activity = new IncidentActivity
        {
            IncidentId = report.Id,
            WorkOrderId = work?.Id,
            ActorId = Actor,
            Action = action,
            Note = note,
            TenantVisible = tenantVisible,
            DataJson = JsonSerializer.Serialize(data),
            OccurredAt = Now
        };
        repository.Add(activity);
        if (action is not ("progress" or "blocker" or "emergency_action" or "evidence_uploaded"))
            repository.Audit(Actor, "Incident_" + action, activity.Id, Now);
        return activity;
    }
    private async Task NotifyAsync(IncidentReport report, IncidentActivity activity, IReadOnlyList<Guid> recipients, CancellationToken t)
    {
        var notifications = recipients.Distinct().Select(recipient => new IncidentNotification
        {
            IncidentId = report.Id,
            ActivityId = activity.Id,
            RecipientId = recipient,
            Event = activity.Action,
            HighPriority = report.Severity == IncidentSeverity.Emergency
        }).ToArray();
        foreach (var notification in notifications) repository.Add(notification);
        await repository.FlushAsync(t);
        foreach (var notification in notifications)
            await jobs.EnqueueAsync(new("incident.notification", notification.Id.ToString("N"), JsonSerializer.Serialize(new { NotificationId = notification.Id })), t);
    }

    private async Task<IReadOnlyList<IncidentEvidence>> SelectEvidenceAsync(IncidentReport report, MaintenanceWorkOrder? order,
        IncidentEvidenceKind kind, Guid[]? ids, CancellationToken t)
    {
        if (ids is null || ids.Length > MaximumImages || ids.Distinct().Count() != ids.Length) throw IncidentException.Invalid("invalid_incident_evidence");
        var rows = (await repository.EvidenceAsync(report.Id, t)).Where(e => ids.Contains(e.Id)).ToArray();
        if (rows.Length != ids.Length || rows.Any(e => e.WorkOrderId != order?.Id || e.Kind != kind || e.UploadedById != Actor || e.ActivityId is not null))
            throw IncidentException.Invalid("invalid_incident_evidence");
        foreach (var row in rows) await files.CopyAsync(row.ObjectKey, Stream.Null, t);
        return rows;
    }
    private static void Link(IEnumerable<IncidentEvidence> rows, Guid activity)
    { foreach (var row in rows) row.ActivityId = activity; }
    private async Task<IncidentEvidence> StoreAsync(IncidentReport report, Guid? work, IncidentEvidenceKind kind, Guid? activity,
        byte[] bytes, string type, string hash, CancellationToken t)
    {
        var evidence = new IncidentEvidence
        {
            IncidentId = report.Id,
            WorkOrderId = work,
            Kind = kind,
            ActivityId = activity,
            UploadedById = Actor,
            Length = bytes.Length,
            ContentType = type,
            Sha256 = hash,
            ObjectKey = "incident-evidence/" + report.Id.ToString("N") + "/" + Guid.NewGuid().ToString("N")
        };
        await files.PutAsync(report.LocationId, evidence.ObjectKey, bytes, type, t); repository.Add(evidence); return evidence;
    }
    public async Task<IncidentCommandResult> UploadAsync(Guid id, Guid? workOrderId, IncidentEvidenceKind kind, Guid key, Stream stream, CancellationToken t)
    {
        Key(key); await PermitAsync(Permissions.Incidents.View, t);
        if (!Enum.IsDefined(kind)) throw IncidentException.Invalid("invalid_evidence_kind");
        var initial = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(); await AccessAsync(initial, t);
        var bytes = new byte[MaximumImageBytes + 1];
        try
        {
            var length = 0;
            while (length < bytes.Length) { var read = await stream.ReadAsync(bytes.AsMemory(length), t); if (read == 0) break; length += read; }
            if (length > MaximumImageBytes) throw new IncidentException(413, "incident_image_too_large");
            var content = bytes.AsSpan(0, length).ToArray();
            try
            {
                var type = files.Validate(content); var hash = Convert.ToHexString(SHA256.HashData(content));
                async Task Authorize()
                {
                    var report = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(); var scope = await AccessAsync(report, t);
                    if (kind == IncidentEvidenceKind.Report)
                    {
                        if (report.ReporterId != Actor) throw IncidentException.Missing();
                        if (!await repository.ActiveLocationAsync(report.LocationId, t)) throw IncidentException.Missing();
                        if (report.ReporterRole == Roles.Tenant)
                        {
                            if (!scope.Tenant || !await repository.ActiveRoleAsync(Actor, Roles.Tenant, t) ||
                                (await repository.TenancyAsync(Actor, report.LocationId, report.RoomId, Today, t))?.ContractId != report.ContractId)
                                throw IncidentException.Missing();
                        }
                        else if (!scope.Staff || !await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t)) throw IncidentException.Missing();
                    }
                    else if (kind == IncidentEvidenceKind.Direct)
                    { await PermitAsync(Permissions.Incidents.Manage, t); }
                    else if (kind == IncidentEvidenceKind.EmergencyAction)
                    {
                        if (!scope.Owner && !(scope.Staff && await repository.StaffAssignedAsync(Actor, report.LocationId, Today, t)))
                            throw new IncidentException(403, "incident_permission_denied");
                    }
                    else
                    {
                        var work = await repository.WorkOrderAsync(workOrderId ?? Guid.Empty, t) ?? throw IncidentException.Missing();
                        if (work.IncidentId != id) throw IncidentException.Missing(); await RequireExecutionAsync(report, work, t);
                    }
                }
                await Authorize();
                var lockRoom = initial.RoomId ?? (initial.ContractId is { } contract ? await repository.ContractRoomAsync(contract, t) : null);
                return await CommandAsync(initial.LocationId, lockRoom, key, "upload:" + id,
                    new { workOrderId, kind, Hash = hash }, Authorize, async () =>
                {
                    var report = await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(); Open(report);
                    if (kind is IncidentEvidenceKind.Report or IncidentEvidenceKind.Direct or IncidentEvidenceKind.EmergencyAction && workOrderId is not null)
                        throw IncidentException.Invalid("invalid_evidence_scope");
                    if (kind == IncidentEvidenceKind.Report && (report.Status != IncidentStatus.Submitted || report.OwnerDecisionAt is not null))
                        throw IncidentException.Conflict("report_evidence_locked");
                    if (kind == IncidentEvidenceKind.EmergencyAction && report.Severity != IncidentSeverity.Emergency) throw IncidentException.Conflict("emergency_required");
                    if (workOrderId is { } workId)
                    {
                        var order = await repository.WorkOrderAsync(workId, t) ?? throw IncidentException.Missing();
                        if (kind == IncidentEvidenceKind.Inspection && order.Status is not (WorkOrderStatus.Assigned or WorkOrderStatus.PendingApproval) ||
                            kind == IncidentEvidenceKind.Completion && order.Status != WorkOrderStatus.InProgress)
                            throw IncidentException.Conflict("evidence_not_allowed_in_state");
                    }
                    var evidence = await repository.EvidenceAsync(id, t);
                    var count = evidence.Count(e => e.Kind == kind && e.WorkOrderId == workOrderId &&
                        (kind == IncidentEvidenceKind.Report || e.ActivityId is null && e.UploadedById == Actor));
                    if (count >= MaximumImages) throw IncidentException.Conflict("incident_evidence_limit");
                    var row = await StoreAsync(report, workOrderId, kind, null, content, type, hash, t);
                    var activity = Activity(report, null, "evidence_uploaded", "", false, new { EvidenceId = row.Id });
                    if (kind == IncidentEvidenceKind.Report) row.ActivityId = activity.Id;
                    report.Version++; return new(id, workOrderId, row.Id);
                }, t);
            }
            finally { CryptographicOperations.ZeroMemory(content); }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<IReadOnlyList<IncidentEvidenceView>> EvidenceAsync(Guid id, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.View, t);
        var scope = await AccessAsync(await repository.IncidentAsync(id, t) ?? throw IncidentException.Missing(), t);
        var rows = await repository.EvidenceAsync(id, t);
        return rows.Where(e => scope.Owner || scope.Staff || e.Kind == IncidentEvidenceKind.Report)
            .Select(e => new IncidentEvidenceView(e.Id, e.WorkOrderId, e.ActivityId, e.Kind.ToString(), e.ContentType, e.Length)).ToArray();
    }
    public async Task<string> CopyEvidenceAsync(Guid id, Guid imageId, Stream output, CancellationToken t)
    {
        if (!(await EvidenceAsync(id, t)).Any(e => e.Id == imageId)) throw IncidentException.Missing();
        var evidence = (await repository.EvidenceAsync(id, t)).Single(e => e.Id == imageId);
        await files.CopyAsync(evidence.ObjectKey, output, t); return evidence.ContentType;
    }
    public async Task<IncidentPage<IncidentNotificationView>> NotificationsAsync(int page, int size, CancellationToken t)
    { await PermitAsync(Permissions.Incidents.View, t); Page(page, size); return await repository.NotificationsAsync(await ScopeAsync(t), page, size, t); }
    public async Task MarkReadAsync(Guid id, CancellationToken t)
    {
        await PermitAsync(Permissions.Incidents.View, t);
        var row = await repository.NotificationAsync(id, Actor, t) ?? throw IncidentException.Missing();
        await GetAsync(row.IncidentId, t); row.ReadAt ??= Now; await repository.FlushAsync(t);
    }
}

public static class IncidentProjection
{
    public static IncidentView Report(IncidentReport r, bool? available) => new(r.Id, "INC-" + r.Id.ToString("N"), r.LocationId,
        r.RoomId, r.CommonArea, r.AssetId, r.Description, r.Severity.ToString(), r.Status.ToString(), r.Type, r.Category,
        r.AcknowledgedAt, r.ResolutionNote, r.Version, r.CreatedAt, available);
    public static WorkOrderView Work(MaintenanceWorkOrder w, DateTimeOffset now, bool financial) => new(w.Id, w.IncidentId,
        w.LocationId, w.RoomId, w.AssetId, w.AssignedStaffId, w.ExpectedOutcome, w.TargetCompletionAt, w.IsOpen && w.TargetCompletionAt < now,
        w.Status.ToString(), w.InspectionResult, w.ProposedSolution, w.EstimatedMinutes, financial ? w.EstimatedCost : null,
        financial ? w.Vendor : null, w.ProposalVersion, w.PlanApproved, w.Status == WorkOrderStatus.PendingApproval && w.PlanApproved,
        w.ApprovedById, w.ApprovedAt, w.Result, financial ? w.ActualCost : null, w.VerifiedById, w.VerifiedAt, w.Version);
}
