using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.PropertyManagement;
using BHome.Application.Notifications;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24AssignmentTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class CapturingMail : INotificationChannelProvider
    {
        public List<ChannelMessage> Messages { get; } = [];
        public bool IsConfigured(string channel) => channel == "EMAIL";
        public bool SupportsIdempotency(string channel) => channel == "EMAIL";
        public Task<string> SendAsync(ChannelMessage message, CancellationToken token)
        {
            Messages.Add(message);
            return Task.FromResult("synthetic-accepted");
        }
    }
    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private const string Password = "Synthetic!Password-493";
    private async Task<User> User(string role)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        if (role == "Owner")
        {
            var owner = await db.Users.SingleOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains("Owner"));
            if (owner is not null) return owner;
        }
        var id = Guid.NewGuid(); var user = new User
        {
            Id = id,
            UserName = id.ToString(),
            NormalizedUserName = id.ToString().ToUpperInvariant(),
            Email = $"{id:N}@example.invalid",
            NormalizedEmail = $"{id:N}@example.invalid".ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
            LockoutEnabled = true
        };
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>().HashPassword(user, Password);
        db.Users.Add(user); db.Entry(user).Property("roles").CurrentValue = new[] { role }; await db.SaveChangesAsync(); return user;
    }
    private async Task<Guid> Location()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = Guid.NewGuid(); await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address) VALUES ({id},{"Synthetic " + id},'Synthetic address')"); return id;
    }
    private static Task<int> EmailNotices(Compact24DbContext db, Guid location, Guid staff, string type) =>
        db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE record_kind='INBOX'
              AND location_id={location} AND recipient_user_id={staff} AND notification_type={type}
              AND event_data->'state'->'channels' ? 'EMAIL'
            """).SingleAsync();
    [CompactPostgresFact]
    public async Task ExistingAssignmentEndpointKeepsOwnerOnlyAccessAndOriginalResponse()
    {
        var owner = await User("Owner"); var staff = await User("Staff"); var location = await Location();
        using var client = fixture.Factory!.CreateClient();
        async Task Login(User user)
        {
            client.DefaultRequestHeaders.Authorization = null;
            var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = Password });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        }
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var request = new { locationId = location, staffUserId = staff.Id, startDate = today, endDate = today.AddDays(1) };
        await Login(staff);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/staff-location-assignments", request)).StatusCode);
        await Login(owner);
        var result = await client.PostAsJsonAsync("/api/v1/staff-location-assignments", request);
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);
        var value = (await result.Content.ReadFromJsonAsync<StaffAssignmentSummary>())!;
        Assert.Equal(staff.Id, value.StaffUserId); Assert.Equal(today, value.StartDate);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/v1/staff-location-assignments", request)).StatusCode);
        var entries = await client.GetFromJsonAsync<StaffAssignmentSummary[]>($"/api/v1/staff-location-assignments?locationId={location}");
        Assert.Single(entries!);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var notification = await db.Database.SqlQuery<string>($"""
            SELECT message AS "Value" FROM notifications WHERE recipient_user_id={staff.Id}
              AND notification_type='STAFF_ASSIGNMENT_CREATED' AND record_kind='INBOX'
            """).SingleAsync();
        Assert.Contains(staff.Email!, notification);
        Assert.Contains("Synthetic address", notification);
        Assert.Contains("Nhân viên phụ trách cơ sở (Staff)", notification);
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE recipient_user_id={staff.Id}
              AND notification_type='STAFF_ASSIGNMENT_CREATED' AND record_kind='INBOX'
              AND event_data->'state'->'channels' ? 'EMAIL'
            """).SingleAsync());
        var fake = new CapturingMail();
        var channel = ActivatorUtilities.CreateInstance<NotificationChannelWorker>(scope.ServiceProvider,
            fake, Options.Create(new NotificationChannelOptions { Enabled = true }));
        await channel.ProcessPendingAsync(default, authenticationOnly: true);
        var email = Assert.Single(fake.Messages, m => m.EventType == "STAFF_ASSIGNMENT_CREATED" && m.Destination == staff.Email);
        Assert.Contains("Synthetic address", email.Body);
        Assert.Contains("Nhân viên phụ trách cơ sở", email.Body);
        await channel.ProcessPendingAsync(default, authenticationOnly: true);
        Assert.Single(fake.Messages, m => m.EventType == "STAFF_ASSIGNMENT_CREATED" && m.Destination == staff.Email);
    }
    [CompactPostgresFact]
    public async Task LocationUpdateRequiresLatestVersionAfterStaffAssignment()
    {
        var owner = await User("Owner"); var staff = await User("Staff");
        using var client = fixture.Factory!.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = owner.Email, password = Password });
        login.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        var createdResponse = await client.PostAsJsonAsync("/api/v1/locations", new { name = "Synthetic version test", address = "Synthetic address", isActive = true });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        var created = (await createdResponse.Content.ReadFromJsonAsync<BHome.Application.PropertyManagement.LocationDto>())!;
        Assert.Equal(1, created.Version);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var assignment = await client.PostAsJsonAsync("/api/v1/staff-location-assignments", new
        { locationId = created.Id, staffUserId = staff.Id, startDate = today, endDate = today.AddDays(1) });
        Assert.Equal(HttpStatusCode.Created, assignment.StatusCode);
        var route = $"/api/v1/locations/{created.Id}";
        var stale = await client.PutAsJsonAsync(route, new
        { name = "Synthetic updated", address = "Synthetic updated address", isActive = true, version = created.Version, reason = "Synthetic version test" });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var problem = await stale.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("stale_version", problem.GetProperty("code").GetString());
        var current = (await client.GetFromJsonAsync<BHome.Application.PropertyManagement.LocationDto>(route))!;
        Assert.Equal(created.Version + 1, current.Version);
        Assert.Equal(created.Name, current.Name);
        var updated = await client.PutAsJsonAsync(route, new
        { name = "Synthetic updated", address = "Synthetic updated address", isActive = true, version = current.Version, reason = "Synthetic version test" });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var result = (await updated.Content.ReadFromJsonAsync<BHome.Application.PropertyManagement.LocationDto>())!;
        Assert.Equal(current.Version + 1, result.Version);
        Assert.Equal("Synthetic updated", result.Name);
    }

    [CompactPostgresFact]
    public async Task JsonAssignmentsRetainInclusiveDatesAndNegativeLocationScope()
    {
        var owner = await User("Owner"); var staff = await User("Staff"); var other = await User("Staff"); var location = await Location(); var second = await Location();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var repository = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
        Assert.Equal(CreateAssignmentStatus.Created, (await repository.CreateAssignmentAsync(owner.Id, location, staff.Id, today, today, default)).Status);
        Assert.Single(await repository.ListAssignedLocationsAsync(staff.Id, today, default));
        Assert.Empty(await repository.ListAssignedLocationsAsync(staff.Id, today.AddDays(1), default));
        var access = scope.ServiceProvider.GetRequiredService<IStaffLocationAccess>();
        Assert.True(await access.IsAssignedAsync(staff.Id, location, default));
        Assert.False(await access.IsAssignedAsync(other.Id, location, default));
        Assert.False(await access.IsAssignedAsync(staff.Id, second, default));
    }
    [CompactPostgresFact]
    public async Task ConcurrentJsonAssignmentWritesSerializeWithoutOverlappingOrLosingHistory()
    {
        var owner = await User("Owner"); var staff = await User("Staff"); var location = await Location();
        var first = new DateOnly(2030, 1, 1);
        async Task<CreateAssignmentResult> Assign()
        {
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<ILocationAssignments>().CreateAssignmentAsync(owner.Id, location, staff.Id, first, first.AddDays(2), default);
        }
        var results = await Task.WhenAll(Assign(), Assign());
        Assert.Single(results, x => x.Status == CreateAssignmentStatus.Created);
        Assert.Single(results, x => x.Status == CreateAssignmentStatus.DateRangeOverlaps);
        await using var check = fixture.Factory!.Services.CreateAsyncScope();
        Assert.Single((await check.ServiceProvider.GetRequiredService<ILocationAssignments>().ListAssignmentsAsync(location, default))!);
        var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE location_id={location}
              AND notification_type='STAFF_ASSIGNMENT_CREATED' AND record_kind='INBOX'
            """).SingleAsync());
    }

    [CompactPostgresFact]
    public async Task ReplacingCurrentAssignmentMovesOpenGeneralTasksAtomically()
    {
        var owner = await User("Owner"); var previous = await User("Staff"); var replacement = await User("Staff");
        var location = await Location(); var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime); var task = Guid.NewGuid();
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var repository = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
        Assert.Equal(CreateAssignmentStatus.Created, (await repository.CreateAssignmentAsync(owner.Id, location,
            previous.Id, today, today.AddDays(30), default)).Status);
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,status,title,task_data)
            VALUES ({task},'GENERAL',{location},{previous.Id},'0','Synthetic open task',
              jsonb_build_object('state',jsonb_build_object('assignedStaffUserId',{previous.Id})))
            """);
        var version = await db.Set<BHome.Domain.Locations.Location>().Where(x => x.Id == location).Select(x => x.Version).SingleAsync();

        Assert.Equal(ChangeAssignmentStatus.Invalid, (await repository.ReplaceAssignmentAsync(owner.Id, location,
            previous.Id, today, version, "Synthetic same staff", default)).Status);
        Assert.Equal(version, await db.Set<BHome.Domain.Locations.Location>().Where(x => x.Id == location).Select(x => x.Version).SingleAsync());
        Assert.Equal(0, await EmailNotices(db, location, previous.Id, "STAFF_ASSIGNMENT_REMOVED"));

        var changed = await repository.ReplaceAssignmentAsync(owner.Id, location, replacement.Id, today, version,
            "Synthetic replacement", default);

        Assert.Equal(ChangeAssignmentStatus.Changed, changed.Status);
        db.ChangeTracker.Clear();
        Assert.Equal(replacement.Id, await db.Database.SqlQuery<Guid>($"SELECT assigned_user_id AS \"Value\" FROM operational_tasks WHERE id={task}").SingleAsync());
        Assert.Single(await repository.ListAssignedLocationsAsync(replacement.Id, today, default));
        Assert.Empty(await repository.ListAssignedLocationsAsync(previous.Id, today, default));
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE location_id={location}
              AND recipient_user_id={previous.Id} AND notification_type='STAFF_ASSIGNMENT_REMOVED'
            """).SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM notifications WHERE location_id={location}
              AND recipient_user_id={replacement.Id} AND notification_type='STAFF_ASSIGNMENT_CREATED'
            """).SingleAsync());
        Assert.Equal(1, await EmailNotices(db, location, previous.Id, "STAFF_ASSIGNMENT_REMOVED"));
        Assert.Equal(1, await EmailNotices(db, location, replacement.Id, "STAFF_ASSIGNMENT_CREATED"));
    }

    [CompactPostgresFact]
    public async Task EffectiveDatesReconcileOpenWorkAcrossGapAndRetryWithoutRewritingCompletedWork()
    {
        var owner = await User("Owner"); var first = await User("Staff"); var next = await User("Staff");
        var tenant = await User("Tenant"); var location = await Location();
        var clock = new Clock(new DateTimeOffset(2035, 1, 1, 16, 59, 0, TimeSpan.Zero));
        var today = new DateOnly(2035, 1, 1);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repository = new CompactLocationAssignments(db, clock,
            scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>());
        var job = new AssignmentReconciliationJob(repository, scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>(), clock);
        var run = new JobExecution(Guid.NewGuid(), "synthetic-reconcile", "{}");
        var initial = await repository.CreateAssignmentAsync(owner.Id, location, first.Id, today, today, default);
        var future = await repository.CreateAssignmentAsync(owner.Id, location, next.Id, today.AddDays(2), today.AddDays(3), default);
        Assert.Equal(CreateAssignmentStatus.Created, initial.Status);
        Assert.Equal(CreateAssignmentStatus.Created, future.Status);
        var room = new Room { LocationId = location, RoomNumber = "S101", Capacity = 1, Status = RoomStatus.Occupied };
        var meter = new Meter { RoomId = room.Id, Code = "SYN-METER", UtilityType = UtilityType.Electricity, InstalledOn = today };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, TenantUserId = tenant.Id, DisplayLabel = "Synthetic resident" };
        var contract = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = owner.Id,
            TenantUserId = tenant.Id,
            RepresentativeResidentId = resident.Id,
            StartDate = today.AddMonths(-1),
            EndDate = today.AddMonths(1),
            Status = ContractStatus.Active,
            ActivatedAt = clock.Now,
            ActivatedByUserId = owner.Id,
            Terms = "Synthetic tenancy"
        };
        var inspection = new ContractMoveOut { ContractId = contract.Id, Status = MoveOutStatus.Approved, ProposedDate = today.AddDays(5), InspectionStaffId = first.Id, RequestedByUserId = tenant.Id };
        var incident = new IncidentReport { LocationId = location, RoomId = room.Id, ReporterId = first.Id, ReporterRole = "Staff", Description = "Synthetic repair" };
        var order = new MaintenanceWorkOrder { LocationId = location, RoomId = room.Id, IncidentId = incident.Id, AssignedStaffId = first.Id, ExpectedOutcome = "Synthetic repair", TargetCompletionAt = clock.Now.AddDays(4) };
        var task = new OperationalTask { RequiredLocationId = location, Kind = OperationalTaskKind.AdHoc, AssignedStaffUserId = first.Id, AssignmentId = initial.Assignment!.Id, TaskTitle = "Synthetic task", MeterStatus = MeterTaskStatus.InProgress };
        var reading = new OperationalTask { RequiredLocationId = location, MeterId = meter.Id, AssignedStaffUserId = first.Id, AssignmentId = initial.Assignment.Id, Purpose = ReadingPurpose.Initial, ReadingDate = today };
        var done = new OperationalTask { RequiredLocationId = location, Kind = OperationalTaskKind.AdHoc, AssignedStaffUserId = first.Id, AssignmentId = initial.Assignment.Id, TaskTitle = "Synthetic completed", MeterStatus = MeterTaskStatus.Completed };
        var archive = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        archive.AddRange(room, meter, resident, contract, inspection, incident, order, task, reading, done);
        await archive.SaveChangesAsync();
        archive.ChangeTracker.Clear();

        await job.ExecuteAsync(run, default);
        Assert.True(await repository.IsAssignedAsync(first.Id, location, default));
        Assert.Equal(1, await EmailNotices(db, location, first.Id, "STAFF_ASSIGNMENT_CREATED"));
        Assert.Equal(1, await EmailNotices(db, location, next.Id, "STAFF_ASSIGNMENT_CREATED"));
        Assert.Equal(0, await EmailNotices(db, location, first.Id, "STAFF_ASSIGNMENT_ACTIVATED"));
        clock.Now = clock.Now.AddMinutes(1);
        await job.ExecuteAsync(run, default);
        await job.ExecuteAsync(run, default);
        Assert.False(await repository.IsAssignedAsync(first.Id, location, default));
        Assert.False(await repository.IsAssignedAsync(next.Id, location, default));
        Assert.Null((await archive.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == task.Id)).AssignedStaffUserId);
        Assert.Null((await archive.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == reading.Id)).AssignedStaffUserId);
        Assert.Equal(first.Id, (await archive.Set<MaintenanceWorkOrder>().AsNoTracking().SingleAsync(t => t.Id == order.Id)).AssignedStaffId);
        Assert.Equal(first.Id, (await archive.Set<ContractMoveOut>().AsNoTracking().SingleAsync(t => t.ContractId == contract.Id)).InspectionStaffId);
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM notifications WHERE location_id={location} AND recipient_user_id={owner.Id} AND notification_type='STAFF_RESPONSIBILITY_UNRESOLVED'").SingleAsync());
        Assert.Equal(1, await archive.Set<OperationalTaskHistory>().CountAsync(h => h.TaskId == task.Id && h.Action == "responsibility_changed"));
        Assert.Equal(1, await EmailNotices(db, location, first.Id, "STAFF_ASSIGNMENT_ENDED"));
        Assert.Equal(0, await EmailNotices(db, location, next.Id, "STAFF_ASSIGNMENT_ACTIVATED"));

        clock.Now = clock.Now.AddDays(1);
        await job.ExecuteAsync(run, default);
        await job.ExecuteAsync(run, default);
        Assert.True(await repository.IsAssignedAsync(next.Id, location, default));
        foreach (var id in new[] { task.Id, reading.Id })
        {
            var current = await archive.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == id);
            Assert.Equal(next.Id, current.AssignedStaffUserId);
            Assert.Equal(future.Assignment!.Id, current.AssignmentId);
            Assert.Equal(3, current.Version);
            Assert.Equal(2, await archive.Set<OperationalTaskHistory>().CountAsync(h => h.TaskId == id && h.Action == "responsibility_changed"));
        }
        Assert.Equal(MeterTaskStatus.InProgress, (await archive.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == task.Id)).MeterStatus);
        Assert.Equal(next.Id, (await archive.Set<MaintenanceWorkOrder>().AsNoTracking().SingleAsync(t => t.Id == order.Id)).AssignedStaffId);
        Assert.Equal(next.Id, (await archive.Set<ContractMoveOut>().AsNoTracking().SingleAsync(t => t.ContractId == contract.Id)).InspectionStaffId);
        Assert.Equal(first.Id, (await archive.Set<OperationalTask>().AsNoTracking().SingleAsync(t => t.Id == done.Id)).AssignedStaffUserId);
        Assert.Equal(1, await archive.Set<IncidentActivity>().CountAsync(h => h.WorkOrderId == order.Id && h.Action == "reassigned"));
        Assert.Equal(1, await archive.Set<ContractMoveOutHistory>().CountAsync(h => h.ContractId == contract.Id && h.Action == "InspectionResponsibilityChanged"));
        // The reconciliation is persisted directly in the physical aggregates:
        // the old assignment, the gap and the successor keep their distinct history.
        Assert.Equal(2, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM operational_tasks t
            CROSS JOIN LATERAL jsonb_array_elements(t.history) h
            WHERE t.id={task.Id} AND h->>'recordType'='OperationalTaskHistory'
              AND h->'state'->>'action'='responsibility_changed'
            """).SingleAsync());
        Assert.Equal(next.Id, await db.Database.SqlQuery<Guid>($"""
            SELECT (move_out->'current'->>'inspectionStaffId')::uuid AS "Value" FROM contracts WHERE id={contract.Id}
            """).SingleAsync());
        Assert.Equal(2, await db.Database.SqlQuery<int>($"""
            SELECT (move_out->'current'->>'version')::int AS "Value" FROM contracts WHERE id={contract.Id}
            """).SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE c.id={contract.Id} AND h->>'recordType'='ContractMoveOutHistory'
              AND h->'state'->>'action'='InspectionResponsibilityChanged'
            """).SingleAsync());
        Assert.Equal(1, await EmailNotices(db, location, first.Id, "STAFF_ASSIGNMENT_ENDED"));
        Assert.Equal(1, await EmailNotices(db, location, next.Id, "STAFF_ASSIGNMENT_ACTIVATED"));
    }

    [CompactPostgresFact]
    public async Task FutureCancellationKeepsAuditAndRequiresLatestVersionAndOwner()
    {
        var owner = await User("Owner"); var staff = await User("Staff"); var location = await Location();
        var clock = new Clock(new DateTimeOffset(2035, 1, 1, 12, 0, 0, TimeSpan.Zero));
        var today = new DateOnly(2035, 1, 1);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repository = new CompactLocationAssignments(db, clock,
            scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>());
        var current = (await repository.CreateAssignmentAsync(owner.Id, location, staff.Id, today, today, default)).Assignment!;
        var future = (await repository.CreateAssignmentAsync(owner.Id, location, staff.Id, today.AddDays(1), today.AddDays(2), default)).Assignment!;
        // Simulate a record written by the existing Compact24 EF adapter.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE locations SET staff_assignments=(SELECT jsonb_agg(CASE WHEN a->>'id'={current.Id.ToString()}
                THEN (a-'actorId'-'recordedAt')||jsonb_build_object('createdByUserId',{owner.Id},'createdAt',{clock.Now})
                ELSE a END) FROM jsonb_array_elements(staff_assignments) a) WHERE id={location}
            """);
        var version = await db.Set<BHome.Domain.Locations.Location>().Where(l => l.Id == location).Select(l => l.Version).SingleAsync();
        Assert.Equal(UpdateAssignmentPeriodStatus.Invalid, (await repository.CancelFutureAssignmentAsync(owner.Id, current.Id, version, "Cannot cancel current", default)).Status);
        Assert.Equal(UpdateAssignmentPeriodStatus.StaleVersion, (await repository.CancelFutureAssignmentAsync(owner.Id, future.Id, version - 1, "Stale request", default)).Status);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => repository.CancelFutureAssignmentAsync(staff.Id, future.Id, version, "Unauthorized", default));
        var changed = await repository.CancelFutureAssignmentAsync(owner.Id, future.Id, version, "Synthetic cancellation", default);
        Assert.Equal(UpdateAssignmentPeriodStatus.Changed, changed.Status);
        Assert.Equal(future.Id, changed.Assignment!.Id);
        Assert.Equal(version + 1, changed.LocationVersion);
        Assert.Equal(current.Id, Assert.Single((await repository.ListAssignmentsAsync(location, default))!).Id);
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a WHERE l.id={location} AND (a->>'createdByUserId')::uuid={owner.Id} AND a->>'createdAt' IS NOT NULL").SingleAsync());
        Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.history) h WHERE l.id={location} AND h->>'action'='StaffAssignmentCancelled' AND (h->'before'->>'id')::uuid={future.Id}").SingleAsync());
        Assert.Equal(1, await EmailNotices(db, location, staff.Id, "STAFF_ASSIGNMENT_CANCELLED"));
        Assert.Equal(CreateAssignmentStatus.Created, (await repository.CreateAssignmentAsync(owner.Id, location, staff.Id, today.AddDays(1), today.AddDays(2), default)).Status);
    }

    [CompactPostgresFact]
    public async Task PeriodChangesAndFutureCancellationEmailAssignedStaffOnlyAfterSuccess()
    {
        var owner = await User("Owner"); var employee = await User("Staff"); var location = await Location();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repo = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
        var current = (await repo.CreateAssignmentAsync(owner.Id, location, employee.Id, today, today.AddDays(1), default)).Assignment!;
        var future = (await repo.CreateAssignmentAsync(owner.Id, location, employee.Id, today.AddDays(3), today.AddDays(5), default)).Assignment!;
        var version = await db.Set<BHome.Domain.Locations.Location>().Where(l => l.Id == location).Select(l => l.Version).SingleAsync();

        Assert.Equal(UpdateAssignmentPeriodStatus.Changed,
            (await repo.UpdateAssignmentPeriodAsync(owner.Id, current.Id, today, today, version, "Current end amended", default)).Status);
        Assert.Equal(1, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_UPDATED"));
        Assert.Equal(UpdateAssignmentPeriodStatus.StaleVersion,
            (await repo.UpdateAssignmentPeriodAsync(owner.Id, future.Id, today.AddDays(3), today.AddDays(6), version, "Stale", default)).Status);
        Assert.Equal(1, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_UPDATED"));
        Assert.Equal(UpdateAssignmentPeriodStatus.Changed,
            (await repo.UpdateAssignmentPeriodAsync(owner.Id, future.Id, today.AddDays(3), today.AddDays(6), version + 1, "Future end amended", default)).Status);
        Assert.Equal(2, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_UPDATED"));

        // Every accepted decision gets a versioned email, including an unchanged valid period.
        Assert.Equal(UpdateAssignmentPeriodStatus.Changed,
            (await repo.UpdateAssignmentPeriodAsync(owner.Id, future.Id, today.AddDays(3), today.AddDays(6), version + 2, "Confirmed unchanged period", default)).Status);
        Assert.Equal(3, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_UPDATED"));
        Assert.Equal(UpdateAssignmentPeriodStatus.Changed,
            (await repo.CancelFutureAssignmentAsync(owner.Id, future.Id, version + 3, "Future cancelled", default)).Status);
        Assert.Equal(1, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_CANCELLED"));
        Assert.Equal(0, await EmailNotices(db, location, owner.Id, "STAFF_ASSIGNMENT_CANCELLED"));
    }

    [CompactPostgresFact]
    public async Task RemovingCurrentAssignmentEmailsPriorStaffAndRejectsDuplicateRequest()
    {
        var owner = await User("Owner"); var employee = await User("Staff"); var location = await Location();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repo = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
        Assert.Equal(CreateAssignmentStatus.Created,
            (await repo.CreateAssignmentAsync(owner.Id, location, employee.Id, today, today.AddDays(4), default)).Status);
        var version = await db.Set<BHome.Domain.Locations.Location>().Where(l => l.Id == location).Select(l => l.Version).SingleAsync();

        Assert.Equal(ChangeAssignmentStatus.Changed,
            (await repo.RemoveAssignmentAsync(owner.Id, location, today, version, "Staff removed", default)).Status);
        Assert.Equal(1, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_REMOVED"));
        Assert.Equal(0, await EmailNotices(db, location, owner.Id, "STAFF_ASSIGNMENT_REMOVED"));
        Assert.Equal(ChangeAssignmentStatus.StaleVersion,
            (await repo.RemoveAssignmentAsync(owner.Id, location, today, version, "Stale removal retry", default)).Status);
        Assert.Equal(1, await EmailNotices(db, location, employee.Id, "STAFF_ASSIGNMENT_REMOVED"));
    }

    [CompactPostgresFact]
    public async Task EmploymentEndedExpiredOrOverlappingRevokesLocationAccessAndReconcilesPendingWork()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        var next = await User("Staff");
        var location = await Location();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
        var initialAssignment = await assignments.CreateAssignmentAsync(
            owner.Id, location, staff.Id, today, today.AddDays(10), default);
        Assert.Equal(CreateAssignmentStatus.Created, initialAssignment.Status);
        var initialHandoverId = LocationAssetInventoryTaskFactory.TaskId(initialAssignment.Assignment!.Id);
        var taskId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,title,status)
            VALUES ({taskId},'GENERAL',{location},{staff.Id},'Employment pending work','1')
            """);
        var access = scope.ServiceProvider.GetRequiredService<IStaffLocationAccess>();
        Assert.True(await access.IsAssignedAsync(staff.Id, location, default)); // No employment row: seeded Staff fallback.

        var firstPeriod = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,status)
            VALUES ({firstPeriod},{staff.Id},{today.AddDays(-5)},{today.AddDays(5)},'Active')
            """);
        Assert.True(await access.IsAssignedAsync(staff.Id, location, default));
        var overlap = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,status)
            VALUES ({overlap},{staff.Id},{today.AddDays(-1)},{today.AddDays(2)},'Active')
            """);
        Assert.False(await access.IsAssignedAsync(staff.Id, location, default)); // Ambiguous periods fail closed.
        // Compact24 preserves employment history: close the synthetic overlap rather than deleting it.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE staff_employments SET end_date={today.AddDays(-1)},status='Ended' WHERE id={overlap}");
        Assert.True(await access.IsAssignedAsync(staff.Id, location, default));
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE staff_employments SET status='Ended' WHERE id={firstPeriod}");
        Assert.False(await access.IsAssignedAsync(staff.Id, location, default));
        Assert.Empty(await assignments.ListAssignedLocationsAsync(staff.Id, today, default));

        await scope.ServiceProvider.GetRequiredService<AssignmentReconciliationJob>()
            .ExecuteAsync(new JobExecution(Guid.NewGuid(), "synthetic-ended-employment", "{}"), default);
        var archive = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Null(await db.Database.SqlQuery<Guid?>($"SELECT assigned_user_id AS \"Value\" FROM operational_tasks WHERE id={taskId}").SingleAsync());
        Assert.Equal(1, await archive.Set<OperationalTaskHistory>().CountAsync(h =>
            h.TaskId == taskId && h.Action == "responsibility_changed"));
        Assert.Equal(MeterTaskStatus.Assigned, (await archive.Set<OperationalTask>().AsNoTracking()
            .SingleAsync(t => t.Id == initialHandoverId)).MeterStatus);
        // Restoring the SAME still-current assignment after a short employment gap must
        // not strand a deterministic, immutable handover task in Cancelled state.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE staff_employments SET status='Active' WHERE id={firstPeriod}");
        Assert.True(await access.IsAssignedAsync(staff.Id, location, default));
        Assert.Equal(MeterTaskStatus.Assigned, (await archive.Set<OperationalTask>().AsNoTracking()
            .SingleAsync(t => t.Id == initialHandoverId)).MeterStatus);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE staff_employments SET status='Ended' WHERE id={firstPeriod}");

        var version = await db.Set<BHome.Domain.Locations.Location>().Where(x => x.Id == location).Select(x => x.Version).SingleAsync();
        var changed = await assignments.ReplaceAssignmentAsync(owner.Id, location, next.Id, today, version,
            "Ended employment successor", default);
        Assert.Equal(ChangeAssignmentStatus.Changed, changed.Status);
        Assert.True(await access.IsAssignedAsync(next.Id, location, default));
        Assert.Equal(next.Id, await db.Database.SqlQuery<Guid>($"SELECT assigned_user_id AS \"Value\" FROM operational_tasks WHERE id={taskId}").SingleAsync());

        // An active-looking contract with its calendar end already passed also fails closed.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE staff_employments SET status='Active',end_date={today.AddDays(-1)} WHERE id={firstPeriod}");
        Assert.False(await access.IsAssignedAsync(staff.Id, location, default));
    }
}
