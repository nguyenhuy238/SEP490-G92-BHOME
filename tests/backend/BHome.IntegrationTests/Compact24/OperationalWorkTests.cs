using System.Net;
using System.Net.Http.Json;
using BHome.Application.Operations;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task OperationalWorkOwnerListGroupsIncidentChildrenAndFiltersBeforePaging()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        using var tenant = await Client(w.Tenants[0]);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var now = DateTimeOffset.UtcNow;
        var report = new IncidentReport
        {
            LocationId = w.Location,
            RoomId = w.Room,
            ReporterId = w.Tenants[0].Id,
            ReporterRole = "Tenant",
            Description = "Unified synthetic incident",
            Status = IncidentStatus.InProgress,
            Severity = IncidentSeverity.Emergency
        };
        MaintenanceWorkOrder Order(Guid? incidentId, WorkOrderStatus status, int days) => new()
        {
            IncidentId = incidentId,
            Source = incidentId.HasValue ? "Incident" : "Proactive",
            Description = "Unified synthetic repair",
            LocationId = w.Location,
            RoomId = w.Room,
            AssignedStaffId = w.Staff.Id,
            ExpectedOutcome = "Synthetic repair",
            TargetCompletionAt = now.AddDays(days),
            Status = status
        };
        var approved = Order(report.Id, WorkOrderStatus.PendingApproval, 1);
        approved.ProposalVersion = 1;
        approved.ApprovedProposalVersion = 1;
        approved.ApprovedById = w.Owner.Id;
        approved.ApprovedAt = now;
        var pending = Order(report.Id, WorkOrderStatus.PendingApproval, 2);
        pending.ProposalVersion = 1;
        var proactive = Order(null, WorkOrderStatus.PendingApproval, 3);
        proactive.ProposalVersion = 1;
        proactive.ApprovedProposalVersion = 1;
        proactive.ApprovedById = w.Owner.Id;
        proactive.ApprovedAt = now;
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = w.Location,
            Title = "Unified synthetic task",
            Requirements = "Synthetic work",
            Priority = OperationalTaskPriority.High,
            DueAt = now.AddDays(-1),
            Status = MeterTaskStatus.Assigned,
            AssignedStaffUserId = w.Staff.Id
        };
        db.AddRange(report, approved, pending, proactive, task);
        await db.SaveChangesAsync();
        const string route = "/api/v1/operational-work";
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
        async Task<OperationalWorkPage> List(string filters = "") =>
            (await owner.GetFromJsonAsync<OperationalWorkPage>($"{route}?locationId={w.Location}&search=Unified%20synthetic{filters}"))!;
        var page = await List("&pageSize=1");
        Assert.Equal(3, page.TotalCount);
        Assert.Equal(3, page.Counts.Total);
        Assert.Equal(1, page.Counts.NeedsOwner);
        Assert.Equal(2, page.Counts.Active);
        Assert.Equal(1, page.Counts.Overdue);
        var parent = Assert.Single(page.Items);
        Assert.Equal(report.Id, parent.Id);
        Assert.Equal(2, parent.WorkOrderCount);
        Assert.Equal(pending.Id, parent.ActiveWorkOrderId);
        Assert.Equal("Chờ duyệt phương án", parent.Status);
        Assert.Equal("Emergency", parent.Priority);
        var active = await List("&phase=active");
        Assert.Equal(2, active.TotalCount);
        Assert.Equal(3, active.Counts.Total);
        Assert.Contains(active.Items, x => x.Id == proactive.Id && x.Status == "Đã duyệt phương án");
        Assert.Contains(active.Items, x => x.Id == task.Id && x.IsOverdue);
        Assert.Equal(report.Id, Assert.Single((await List($"&workOrderId={approved.Id}")).Items).Id);
        Assert.Equal(report.Id, Assert.Single((await List("&status=InProgress")).Items).Id);
        Assert.Equal(2, (await List("&status=PendingApproval")).TotalCount);
        Assert.Equal(2, (await List("&maintenance=true")).TotalCount);
        Assert.Equal(proactive.Id, Assert.Single((await List("&workType=Proactive")).Items).Id);
        Assert.Equal(task.Id, Assert.Single((await List("&isOverdue=true")).Items).Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(route + "?pageSize=101")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task OperationalWorkOwnerListReadsSigningAndResponsibilityStates()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var assignment = await db.StaffLocationAssignments.AsNoTracking().SingleAsync(x => x.LocationId == w.Location);
        var now = DateTimeOffset.UtcNow;
        var handover = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            LocationId = w.Location,
            Title = "Unified signing inventory",
            Status = MeterTaskStatus.PendingVerification,
            AssignedStaffUserId = w.Staff.Id,
            AssignmentId = assignment.Id,
            DueAt = now.AddDays(1)
        };
        var moveIn = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = w.Location,
            ContractId = w.Contracts[0],
            TargetRoomId = w.Room,
            Title = "Bàn giao vào phòng Unified signing",
            Status = MeterTaskStatus.PendingVerification,
            AssignedStaffUserId = w.Staff.Id,
            AssignmentId = assignment.Id,
            DueAt = now.AddDays(2)
        };
        var review = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = w.Location,
            Title = "Unified signing review",
            Status = MeterTaskStatus.PendingVerification,
            AssignedStaffUserId = w.Staff.Id,
            AssignmentId = assignment.Id,
            DueAt = now.AddDays(1)
        };
        db.AddRange(handover, moveIn, review);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET handover=jsonb_set(handover,ARRAY['preparation'],
                jsonb_build_object('status','Ready','ownerSignature',jsonb_build_object('id',{Guid.NewGuid()})),true)
            WHERE id={w.Contracts[0]}
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET history=history||jsonb_build_array(
                jsonb_build_object('action','LocationAssetHandoverApproved','taskId',{handover.Id},'revision',1,
                    'report',jsonb_build_object('taskVersion',1,'assignmentId',{assignment.Id},'staffId',{w.Staff.Id},'revision',1)))
            WHERE id={w.Location}
            """);
        const string route = "/api/v1/operational-work";
        async Task<OperationalWorkPage> List(string filters = "") =>
            (await owner.GetFromJsonAsync<OperationalWorkPage>($"{route}?locationId={w.Location}&search=Unified%20signing{filters}"))!;
        var initial = await List();
        Assert.Contains(initial.Items, x => x.Id == handover.Id && x.Status == "Chờ Owner ký" && x.Phase == "needsOwner");
        Assert.Contains(initial.Items, x => x.Id == moveIn.Id && x.Status == "Chờ Tenant ký" && x.Phase == "active");
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET history=history||jsonb_build_array(
                jsonb_build_object('action','LocationAssetHandoverOwnerSigned','taskId',{handover.Id},'revision',1,'inkObjectKey','synthetic'))
            WHERE id={w.Location}
            """);
        var signed = await List($"&staffUserId={w.Staff.Id}&recordedStaffUserId={w.Staff.Id}&hasResponsibility=true");
        Assert.Equal(3, signed.TotalCount);
        Assert.Contains(signed.Items, x => x.Id == handover.Id && x.Status == "Chờ Staff ký" && x.Phase == "active");
        Assert.All(signed.Items, x => Assert.NotNull(x.StaffName));
        Assert.Equal(0, (await List("&hasResponsibility=false")).TotalCount);
        var allAfterSigning = await List();
        var verification = await List("&verification=true");
        Assert.Equal(1, verification.TotalCount);
        Assert.Equal(allAfterSigning.Counts.Total, verification.Counts.Total);
        Assert.Equal(allAfterSigning.Counts.NeedsOwner, verification.Counts.NeedsOwner);
        Assert.Equal(allAfterSigning.Counts.Active, verification.Counts.Active);
        Assert.Equal(allAfterSigning.Counts.Closed, verification.Counts.Closed);
        Assert.Equal(1, verification.Counts.Verification);
        var due = await List($"&dueFrom={Uri.EscapeDataString(now.AddDays(1.5).ToString("O"))}");
        Assert.Equal(moveIn.Id, Assert.Single(due.Items).Id);
    }

    [CompactPostgresFact]
    public async Task OperationalWorkOwnerListSeparatesReportAndActualWorkViewsWithoutChangingDefault()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var now = DateTimeOffset.UtcNow;
        IncidentReport Report(string title, IncidentStatus status, string reporterRole) => new()
        {
            LocationId = w.Location,
            RoomId = w.Room,
            ReporterId = reporterRole == "Staff" ? w.Staff.Id : w.Tenants[0].Id,
            ReporterRole = reporterRole,
            Description = title,
            Severity = IncidentSeverity.Emergency,
            Status = status
        };
        var parent = Report("Split synthetic parent report", IncidentStatus.InProgress, "Tenant");
        var unassigned = Report("Split synthetic unassigned report", IncidentStatus.Submitted, "Staff");
        var closed = Report("Split synthetic closed report", IncidentStatus.Rejected, "Tenant");
        MaintenanceWorkOrder Order(Guid? incidentId, WorkOrderStatus status, int days) => new()
        {
            IncidentId = incidentId,
            Source = incidentId.HasValue ? "Incident" : "Proactive",
            Description = $"Split synthetic work {days}",
            LocationId = w.Location,
            RoomId = w.Room,
            AssignedStaffId = w.Staff.Id,
            ExpectedOutcome = "Synthetic repair",
            TargetCompletionAt = now.AddDays(days),
            Status = status
        };
        var pending = Order(parent.Id, WorkOrderStatus.PendingApproval, 1);
        pending.ProposalVersion = 1;
        var verified = Order(parent.Id, WorkOrderStatus.Verified, -1);
        verified.ProposalVersion = 1;
        verified.ApprovedProposalVersion = 1;
        verified.ApprovedById = w.Owner.Id;
        verified.ApprovedAt = now.AddDays(-2);
        verified.VerifiedById = w.Owner.Id;
        verified.VerifiedAt = now;
        verified.ActualCost = 0;
        verified.CompletionActivityId = Guid.NewGuid();
        var proactive = Order(null, WorkOrderStatus.Assigned, 2);
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.AdHoc,
            LocationId = w.Location,
            Title = "Split synthetic task",
            Status = MeterTaskStatus.Assigned,
            AssignedStaffUserId = w.Staff.Id,
            DueAt = now.AddDays(3)
        };
        db.AddRange(parent, unassigned, closed, pending, verified, proactive, task);
        await db.SaveChangesAsync();
        const string route = "/api/v1/operational-work";
        async Task<OperationalWorkPage> List(string filters = "") =>
            (await owner.GetFromJsonAsync<OperationalWorkPage>($"{route}?locationId={w.Location}&search=Split%20synthetic{filters}"))!;
        var reports = await List("&view=reports");
        Assert.Equal(3, reports.TotalCount);
        Assert.Equal(3, reports.Counts.Total);
        Assert.Equal(2, reports.Counts.NeedsOwner);
        Assert.Equal(1, reports.Counts.Closed);
        Assert.All(reports.Items, x => Assert.Equal("incident", x.Kind));
        var report = Assert.Single(reports.Items, x => x.Id == parent.Id);
        Assert.Equal("Đang xử lý", report.Status);
        Assert.Equal("Chờ duyệt phương án", report.WorkOrderStatus);
        Assert.Equal(parent.Id, report.IncidentId);
        Assert.Equal(pending.Id, report.ActiveWorkOrderId);
        Assert.Equal(2, report.WorkOrderCount);
        Assert.Equal(1, report.OpenWorkOrderCount);
        Assert.Equal(1, report.VerifiedWorkOrderCount);
        Assert.Contains(reports.Items, x => x.Id == unassigned.Id && x.WorkOrderCount == 0 && x.ActiveWorkOrderId == null);
        Assert.Contains(reports.Items, x => x.Id == closed.Id && x.Status == "Đã từ chối");
        Assert.Equal(0, (await List("&view=reports&status=PendingApproval")).TotalCount);
        Assert.Equal(parent.Id, Assert.Single((await List("&view=reports&status=InProgress")).Items).Id);
        var work = await List("&view=work");
        Assert.Equal(4, work.TotalCount);
        Assert.Equal(1, work.Counts.NeedsOwner);
        Assert.Equal(2, work.Counts.Active);
        Assert.Equal(1, work.Counts.Closed);
        Assert.DoesNotContain(work.Items, x => x.Kind == "incident");
        Assert.Contains(work.Items, x => x.Id == task.Id && x.Kind == "task");
        Assert.Contains(work.Items, x => x.Id == proactive.Id && x.IncidentId == null && x.Source == "Proactive");
        var linked = await List($"&view=work&incidentId={parent.Id}&pageSize=1");
        Assert.Equal(2, linked.TotalCount);
        Assert.Equal(2, linked.Counts.Total);
        var first = Assert.Single(linked.Items);
        Assert.Equal(pending.Id, first.Id);
        Assert.Equal("Tenant", first.Source);
        Assert.Equal("Emergency", first.Priority);
        Assert.Equal("Incident", first.WorkType);
        Assert.Equal(parent.Id, first.IncidentId);
        Assert.Equal(parent.Description, first.IncidentTitle);
        Assert.Equal("Đang xử lý", first.IncidentStatus);
        Assert.Equal(2, first.WorkOrderCount);
        var second = Assert.Single((await List($"&view=work&incidentId={parent.Id}&pageSize=1&page=2")).Items);
        Assert.Equal(verified.Id, second.Id);
        Assert.Null(second.ActiveWorkOrderId);
        Assert.Equal("closed", second.Phase);
        Assert.Equal(2, (await List("&view=work&source=Tenant&priority=Emergency")).TotalCount);
        Assert.Equal(3, (await List("&view=work&maintenance=true")).TotalCount);
        Assert.Equal(pending.Id, Assert.Single((await List($"&view=work&workOrderId={pending.Id}")).Items).Id);
        var fromReportTitle = await owner.GetFromJsonAsync<OperationalWorkPage>($"{route}?view=work&locationId={w.Location}&search=parent%20report");
        Assert.Equal(2, fromReportTitle!.TotalCount);
        Assert.Equal(5, (await List()).TotalCount);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(route + "?view=invalid")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route + "?view=reports")).StatusCode);
    }
}
