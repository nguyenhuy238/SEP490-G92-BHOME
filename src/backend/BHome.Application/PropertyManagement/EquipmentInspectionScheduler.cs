using BHome.Application.Billing;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using System.Text.Json;

namespace BHome.Application.PropertyManagement;

public sealed class EquipmentInspectionScheduler(ISetupWorkspaceStore store, IOperationalTaskRepository tasks, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static Guid InspectionId(Guid taskId) => Key("equipment-inspection:" + taskId);
    private static Guid Key(string value) => LocationSetupKeys.Key(value);

    public async Task<int> GenerateAsync(Guid scheduleId, CancellationToken t)
    {
        var initial = await store.GetAsync(scheduleId, "EquipmentInspectionSchedule", t) ?? throw new PropertyException(404, "resource_not_found");
        return await store.TransactionAsync(initial.LocationId, async () =>
        {
            var schedule = (await store.GetAsync(scheduleId, initial.Kind, t))!;
            var input = schedule.Data.Deserialize<InspectionScheduleWrite>(Json)!;
            if (!input.Enabled) return 0;
            var asset = await store.AssetAsync(input.AssetId, t);
            if (asset is null || asset.LocationId != schedule.LocationId || asset.Status == AssetStatus.Retired) return 0;
            var policy = await store.GetAsync(input.PolicyId, "AssetLifecyclePolicy", t) ?? throw new PropertyException(409, "inspection_policy_missing");
            if (policy.LocationId != schedule.LocationId || policy.Version != input.PolicyVersion || policy.Status != "Published")
                throw new PropertyException(409, "inspection_policy_changed");
            var policyData = policy.Data.Deserialize<AssetLifecyclePolicyWrite>(Json)!;
            var quantity = (await store.AssetMetadataAsync([asset.Id], t)).GetValueOrDefault(asset.Id)?.Quantity ?? 1;
            var units = new List<SetupDocument>();
            SetupPage page; var number = 1;
            do
            {
                page = await store.PageAsync(asset.LocationId, "AssetEquipmentUnit", asset.Id, number++, 100, t);
                units.AddRange(page.Items.Where(d => d.Status != "Retired"));
            } while ((number - 1) * 100 < page.TotalCount);
            if (policyData.Category != asset.Category || policyData.IndividualTracking && units.Count != quantity)
            {
                if (schedule.Status != "NeedsConfiguration") await store.SaveAsync(schedule.Id, schedule.LocationId, schedule.Kind, "NeedsConfiguration", input, schedule.Version, schedule.RecordedBy!.Value, t);
                return 0;
            }
            if (schedule.Status == "NeedsConfiguration")
                await store.SaveAsync(schedule.Id, schedule.LocationId, schedule.Kind, "Enabled", input, schedule.Version, schedule.RecordedBy!.Value, t);
            var snapshots = policyData.IndividualTracking
                ? units.Select(d => { var u = d.Data.Deserialize<EquipmentUnit>(Json)!; return new InspectionUnitSnapshot(d.Id, d.Version, u.Details.Label, u.Details.Position); }).ToArray()
                : [new InspectionUnitSnapshot(asset.Id, asset.Version, asset.Name, asset.CommonArea ?? "Room")];
            var today = BillingAutomationDates.BusinessDate(clock.GetUtcNow());
            var created = 0;
            for (var date = input.StartsOn; date <= today && created < 100;)
            {
                var taskId = Key($"equipment-inspection-task:{schedule.Id}:{date:yyyy-MM-dd}");
                var id = InspectionId(taskId);
                if (await store.GetAsync(id, "EquipmentInspection", t) is null)
                {
                    var responsible = await tasks.ResponsibilityAsync(asset.LocationId, today, t);
                    var task = new OperationalTask(taskId)
                    {
                        Kind = OperationalTaskKind.AdHoc,
                        LocationId = asset.LocationId,
                        AssignedStaffUserId = responsible?.StaffUserId,
                        AssignmentId = responsible?.AssignmentId,
                        AssignedAt = clock.GetUtcNow(),
                        Title = "Kiểm tra thiết bị · " + asset.Name,
                        Requirements = policyData.Name,
                        EvidenceRequired = policyData.EvidenceRequired,
                        DueAt = new DateTimeOffset(date.AddDays(input.CompletionWindowDays).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime(),
                        TargetAssetId = asset.Id,
                        TargetRoomId = asset.RoomId,
                        TargetCommonArea = asset.CommonArea,
                        TargetLabel = asset.Name,
                        Status = MeterTaskStatus.Assigned
                    };
                    tasks.Add(task);
                    tasks.Add(new OperationalTaskHistory { TaskId = taskId, ActorId = schedule.RecordedBy!.Value, Action = "created", Note = "Equipment inspection scheduled", OccurredAt = clock.GetUtcNow(), TaskVersion = 1, ResponsibleStaffUserId = responsible?.StaffUserId });
                    var recipients = responsible is null ? await tasks.OwnersAsync(t) : new[] { responsible.StaffUserId };
                    foreach (var recipient in recipients) tasks.Add(new OperationalTaskNotification { TaskId = taskId, RecipientUserId = recipient, EventId = id, Event = responsible is null ? "assignment_unavailable" : "created" });
                    await tasks.FlushAsync(t);
                    var total = policyData.IndividualTracking ? quantity : 1;
                    var cycle = new EquipmentInspection(asset.Id, schedule.Id, date, taskId, policy.Id, policy.Version, policyData, snapshots, quantity, [], Progress: new(total, 0, 0, 0, total, "NotInspected"));
                    await store.SaveAsync(id, asset.LocationId, "EquipmentInspection", "Draft", cycle, 0, schedule.RecordedBy.Value, t);
                    await store.AuditAsync(asset.LocationId, id, schedule.RecordedBy.Value, "EquipmentInspectionScheduled", t);
                    created++;
                }
                if (input.IntervalDays is not { } interval || date.DayNumber > DateOnly.MaxValue.DayNumber - interval) break;
                date = date.AddDays(interval);
            }
            return created;
        }, t);
    }
}
