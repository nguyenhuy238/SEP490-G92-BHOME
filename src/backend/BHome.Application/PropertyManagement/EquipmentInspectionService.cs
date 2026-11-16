using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Application.StaffOperations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Billing;

namespace BHome.Application.PropertyManagement;

public sealed class EquipmentInspectionService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access,
    AssetLifecycleService lifecycle, OperationalTaskService tasks, EquipmentInspectionScheduler scheduler, IncidentService incidents,
    IOperationalTaskRepository taskStore, TimeProvider clock) : SetupWorkspaceService(store, user, access)
{
    public async Task<SetupDocument> SaveScheduleAsync(Guid assetId, Guid id, InspectionScheduleWrite input, CancellationToken t)
    {
        var asset = await lifecycle.AssetScope(assetId, true, t);
        if (input.AssetId != assetId || id == Guid.Empty || input.StartsOn == default || input.CompletionWindowDays is < 1 or > 365 || input.IntervalDays is < 1 or > 36500)
            throw new PropertyException(400, "invalid_inspection_schedule");
        return await Store.TransactionAsync(asset.LocationId, async () =>
        {
            var previous = await Store.GetAsync(id, "EquipmentInspectionSchedule", t);
            if (previous is null && input.StartsOn < BHome.Application.Billing.BillingAutomationDates.BusinessDate(clock.GetUtcNow()))
                throw new PropertyException(400, "historical_inspection_schedule_not_allowed");
            if (previous is not null && (Read<InspectionScheduleWrite>(previous).AssetId != assetId || Read<InspectionScheduleWrite>(previous) with { Enabled = input.Enabled, ExpectedVersion = input.ExpectedVersion } != input))
                throw new PropertyException(409, "inspection_schedule_immutable_create_replacement");
            var policy = await Document(input.PolicyId, "AssetLifecyclePolicy", true, t);
            var data = Read<AssetLifecyclePolicyWrite>(policy);
            if (policy.LocationId != asset.LocationId || policy.Status != "Published" || policy.Version != input.PolicyVersion ||
                data.Category != asset.Category || input.StartsOn < data.EffectiveFrom || input.IntervalDays is { } interval && interval != data.InspectionIntervalDays)
                throw new PropertyException(409, "inspection_policy_inapplicable");
            var saved = await Store.SaveAsync(id, asset.LocationId, "EquipmentInspectionSchedule", input.Enabled ? "Enabled" : "Disabled", input, input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(asset.LocationId, id, Actor, "EquipmentInspectionScheduleSaved", t);
            return saved;
        }, t);
    }

    public async Task<int> GenerateAsync(Guid id, CancellationToken t)
    { await Document(id, "EquipmentInspectionSchedule", true, t); return await scheduler.GenerateAsync(id, t); }

    public async Task<SetupPage> SchedulesAsync(Guid assetId, int page, int size, CancellationToken t)
    { var asset = await lifecycle.AssetScope(assetId, true, t); return await Store.PageAsync(asset.LocationId, "EquipmentInspectionSchedule", assetId, page, size, t); }

    public async Task<SetupPage> InspectionsAsync(Guid assetId, int page, int size, CancellationToken t)
    { var asset = await lifecycle.AssetScope(assetId, false, t); return await Store.PageAsync(asset.LocationId, "EquipmentInspection", assetId, page, size, t); }

    public async Task<SetupDocument?> ForTaskAsync(Guid taskId, CancellationToken t)
    {
        await tasks.GetAsync(taskId, t);
        return await Store.GetAsync(EquipmentInspectionScheduler.InspectionId(taskId), "EquipmentInspection", t);
    }

    public async Task<SetupDocument> SaveAnswersAsync(Guid id, InspectionBatch input, CancellationToken t)
    {
        if (!User.IsInRole(Roles.Staff)) throw new PropertyException(403, "staff_required");
        var initial = await Document(id, "EquipmentInspection", false, t);
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, initial.Kind, false, t);
            if (doc.Status != "Draft") throw new PropertyException(409, "inspection_not_editable");
            var data = Read<EquipmentInspection>(doc);
            var task = await tasks.GetAsync(data.TaskId, t);
            var progress = EquipmentInspectionRules.Evaluate(data, input.Answers);
            if (input.Submit && progress.NotInspected > 0) throw new PropertyException(409, "inspection_incomplete");
            var available = (await taskStore.EvidenceAsync(data.TaskId, t)).Select(e => e.Id).ToHashSet();
            if (input.Answers.SelectMany(a => a.EvidenceIds).Any(e => !available.Contains(e))) throw new PropertyException(400, "invalid_inspection_evidence");
            if (input.Submit && data.PolicySnapshot.EvidenceRequired && data.Units.Any(u => !input.Answers.Any(a => a.UnitId == u.Id && a.EvidenceIds.Length > 0)))
                throw new PropertyException(409, "inspection_evidence_required");
            if (task.Status == "Assigned") task = await tasks.ActAsync(data.TaskId, "start", new(task.Version), Key("inspection-start:" + id), t);
            if (task.Status != "InProgress") throw new PropertyException(409, "inspection_task_not_in_progress");
            var snapshots = data.Units.ToDictionary(unit => unit.Id);
            if (data.PolicySnapshot.IndividualTracking)
            {
                foreach (var unitId in input.Answers.Where(a => a.Result == "Failed").Select(a => a.UnitId).Distinct())
                {
                    var unit = await Store.GetAsync(unitId, "AssetEquipmentUnit", t) ?? throw new PropertyException(409, "inspection_equipment_changed");
                    var unitData = Read<EquipmentUnit>(unit);
                    if (unitData.AssetId != data.AssetId || unit.Status == "Retired") throw new PropertyException(409, "inspection_equipment_changed");
                    if (unit.Status != "Unsafe")
                    {
                        unit = await Store.SaveAsync(unit.Id, unit.LocationId, unit.Kind, "Unsafe", unitData with { Details = unitData.Details with { Status = "Unsafe" } }, unit.Version, Actor, t);
                        await Store.AuditAsync(unit.LocationId, unit.Id, Actor, "EquipmentSafetyFailureRecorded", t);
                    }
                    snapshots[unitId] = snapshots[unitId] with { Version = unit.Version };
                }
            }
            var saved = await Store.SaveAsync(id, doc.LocationId, doc.Kind, input.Submit ? "Submitted" : "Draft",
                data with { Units = data.Units.Select(unit => snapshots[unit.Id]).ToArray(), Answers = input.Answers, Outcome = progress.Outcome, Progress = progress, SubmittedBy = input.Submit ? Actor : null, SubmittedAt = input.Submit ? clock.GetUtcNow() : null }, input.ExpectedVersion, Actor, t);
            if (input.Submit) await tasks.ActAsync(data.TaskId, "submit", new(task.Version, "Đã gửi kết quả kiểm tra thiết bị", input.Answers.SelectMany(a => a.EvidenceIds).Distinct().ToArray()), Key($"inspection-submit:{id}:{saved.Version}"), t);
            await Store.AuditAsync(doc.LocationId, id, Actor, input.Submit ? "EquipmentInspectionSubmitted" : "EquipmentInspectionProgressSaved", t);
            return saved;
        }, t);
    }

    public async Task<SetupDocument> ReviewAsync(Guid id, InspectionReview input, CancellationToken t)
    {
        var initial = await Document(id, "EquipmentInspection", true, t); Text(input.Note, 2000);
        if (input.Action is not ("Verify" or "Rework")) throw new PropertyException(400, "invalid_inspection_review");
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, initial.Kind, true, t);
            if (doc.Status != "Submitted") throw new PropertyException(409, "inspection_not_submitted");
            var data = Read<EquipmentInspection>(doc);
            var task = await tasks.GetAsync(data.TaskId, t);
            if (input.Action == "Verify" && data.PolicySnapshot.IndividualTracking)
            {
                var hasOpenWork = await Store.HasOpenAssetWorkAsync(data.AssetId, t);
                foreach (var unit in data.Units)
                {
                    var current = await Document(unit.Id, "AssetEquipmentUnit", true, t);
                    if (current.Version != unit.Version || current.Status == "Retired") throw new PropertyException(409, "inspection_equipment_changed");
                    var details = Read<EquipmentUnit>(current);
                    var failed = data.Answers.Any(a => a.UnitId == unit.Id && a.Result == "Failed");
                    if (!failed && current.Status == "Unsafe" && hasOpenWork) throw new PropertyException(409, "equipment_remediation_pending");
                    var status = failed ? "Unsafe" : "InService";
                    if (current.Status != status) await Store.SaveAsync(current.Id, current.LocationId, current.Kind, status,
                        details with { Details = details.Details with { Status = status } }, current.Version, Actor, t);
                }
            }
            var saved = await Store.SaveAsync(id, doc.LocationId, doc.Kind, input.Action == "Verify" ? "Verified" : "Draft", data with { ReviewNote = input.Note }, input.ExpectedVersion, Actor, t);
            await tasks.ActAsync(data.TaskId, input.Action == "Verify" ? "verify" : "rework", new(task.Version, input.Note), Key($"inspection-review:{id}:{saved.Version}"), t);
            await Store.AuditAsync(doc.LocationId, id, Actor, "EquipmentInspection" + input.Action, t);
            return saved;
        }, t);
    }

    public async Task<SetupDocument> RemediateAsync(Guid id, InspectionRemediation input, CancellationToken t)
    {
        var initial = await Document(id, "EquipmentInspection", true, t);
        return await Store.TransactionAsync(initial.LocationId, async () =>
        {
            var doc = await Document(id, initial.Kind, true, t); var data = Read<EquipmentInspection>(doc);
            var fingerprint = Hash(input with { ExpectedVersion = 0 });
            if (data.RemediationWorkOrderId is not null) return data.RemediationFingerprint == fingerprint ? doc : throw new PropertyException(409, "inspection_remediation_already_linked");
            if (doc.Status != "Verified" || data.Outcome != "Failed") throw new PropertyException(409, "failed_verified_inspection_required");
            var asset = await lifecycle.AssetScope(data.AssetId, true, t);
            var result = await incidents.CreateProactiveAsync(new(asset.LocationId, asset.RoomId, asset.CommonArea, asset.Id, input.Description, input.ExpectedOutcome, input.TargetCompletionAt), Key("inspection-remediation:" + id), t);
            var saved = await Store.SaveAsync(id, doc.LocationId, doc.Kind, doc.Status, data with { RemediationWorkOrderId = result.WorkOrderId, RemediationFingerprint = fingerprint }, input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(doc.LocationId, id, Actor, "EquipmentInspectionRemediationLinked", t);
            return saved;
        }, t);
    }
}
