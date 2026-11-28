using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Development;
using BHome.Application.Storage;
using BHome.IntegrationTests.Ocr;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenCvSharp;
using Npgsql;

namespace BHome.IntegrationTests.Contracts;

[Trait("Category", "Docker")]
public sealed partial class ContractLifecycleApiTests(ContractFixture fixture) : IClassFixture<ContractFixture>
{
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private sealed record Actor(HttpClient Client, Guid Id);
    private sealed record Workspace(Actor Owner, Actor Staff, Actor Tenant, Guid Location, Guid Room, Guid Resident);
    private async Task<Actor> User(string role)
    {
        var id = Guid.NewGuid(); var name = id.ToString("N") + "@example.invalid";
        const string password = BHome.IntegrationTests.Compact24.WorkflowTestUsers.Password;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            // These actors model established accounts that already completed setup.
            // Pending/unconfirmed onboarding is exercised separately by authentication tests.
            var user = new User { Id = id, UserName = name, Email = name, EmailConfirmed = true, LockoutEnabled = true };
            user = await BHome.IntegrationTests.Compact24.WorkflowTestUsers.CreateAsync(scope.ServiceProvider, user, role, password);
            id = user.Id; name = user.Email!;
        }
        var client = fixture.Factory.CreateClient(); var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = name, password });
        response.EnsureSuccessStatusCode(); var login = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken); return new(client, id);
    }
    private async Task<Workspace> Setup()
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff); var tenant = await User(Roles.Tenant);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        var location = new Location("Synthetic Contract Location") { ChainId = db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext ? null : await db.Set<BHome.Domain.PropertyManagement.Chain>().Select(c => c.Id).SingleAsync(), Address = "Synthetic address" };
        var room = new Room { LocationId = location.Id, RoomNumber = "SYNTHETIC", Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = owner.Id, DisplayLabel = "Synthetic Representative", VerificationStatus = IdentityVerificationStatus.Verified };
        db.AddRange(location, room, resident, new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddDays(-30), Today.AddDays(60)));
        db.AddRange(
            new BillingPolicy { LocationId = location.Id, Category = ChargeCategory.Electricity, ChargeCode = "ELECTRICITY", Name = "Synthetic electricity", Method = ChargingMethod.Metered, Rate = 3500, EffectiveFrom = Today.AddMonths(-1) },
            new BillingPolicy { LocationId = location.Id, Category = ChargeCategory.Water, ChargeCode = "WATER", Name = "Synthetic water", Method = ChargingMethod.Metered, Rate = 15000, EffectiveFrom = Today.AddMonths(-1) });
        await db.SaveChangesAsync(); return new(owner, staff, tenant, location.Id, room.Id, resident.Id);
    }
    private static async Task<HoldingSettings?> ReadHoldingPolicyAsync(HttpClient owner)
    {
        using var response = await owner.GetAsync("/api/v1/contracts/holding-settings");
        if (response.StatusCode == HttpStatusCode.NoContent) return null;
        return await Success<HoldingSettings>(response);
    }
    private async Task<HoldingPreparation> ConfigureHoldingPolicyAsync(Workspace workspace, string terms)
    {
        var current = await ReadHoldingPolicyAsync(workspace.Owner.Client);
        var saved = await workspace.Owner.Client.PutAsJsonAsync("/api/v1/contracts/holding-settings", new HoldingSettingsInput(terms, current?.Version ?? 0));
        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);
        return await Success<HoldingPreparation>(await workspace.Staff.Client.GetAsync($"/api/v1/contracts/holdings/preparation?roomId={workspace.Room}"));
    }
    private static string Path(Guid id, string operation = "") => $"/api/v1/contracts/{id}" + (operation.Length == 0 ? "" : "/" + operation);
    private static async Task<Guid> MoveOutPhoto(Actor staff, Guid id)
    {
        using var body = new ByteArrayContent(Image());
        body.Headers.ContentType = new("image/png");
        return (await Success<ContractId>(await staff.Client.PostAsync(Path(id, "move-out/evidence"), body))).Id;
    }
    private static async Task<HandoverRoomCheck[]> PassedMoveOutRoomChecks(Actor staff, Guid id, string? issueCode = null)
    {
        var checks = new List<HandoverRoomCheck>();
        foreach (var code in HandoverRoomChecklist.RequiredCodes)
            checks.Add(new(code, code == issueCode ? "Issue" : "Passed", null, [await MoveOutPhoto(staff, id)]));
        return checks.ToArray();
    }
    private async Task StartMoveOutTaskForInspection(Workspace workspace, Guid contractId)
    {
        if (!await UsesCompact24()) return;
        var tasks = await Success<TaskPage<TaskView>>(await workspace.Staff.Client.GetAsync(
            $"/api/v1/operational-tasks?locationId={workspace.Location}&pageSize=100"));
        var task = Assert.Single(tasks.Items, item => item.Target?.ContractId == contractId &&
            item.Title.StartsWith("Kiểm tra trả phòng", StringComparison.Ordinal));
        if (task.Status == "Assigned")
            task = await Success<TaskView>(await Post(workspace.Staff,
                $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version)));
        Assert.Equal("InProgress", task.Status);
    }
    [Fact]
    public async Task AssignedStaffReadsReadinessButCannotActivateOrReadOtherLocations()
    {
        var a = await Setup(); var b = await Setup(); var id = await Draft(a);
        var readiness = await Success<ActivationReadiness>(await a.Staff.Client.GetAsync(Path(id, "activation-readiness")));
        Assert.False(readiness.Ready);
        Assert.Equal(HttpStatusCode.NotFound, (await b.Staff.Client.GetAsync(Path(id, "activation-readiness"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(a.Staff, Path(id, "activate"))).StatusCode);
    }
    private static async Task<HttpResponseMessage> Post(Actor actor, string path, object? input = null, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(input ?? new { }) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await actor.Client.SendAsync(request);
    }
    private static async Task<T> Success<T>(HttpResponseMessage response)
    { Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()} {string.Join(Environment.NewLine, ApiFactory.Diagnostics.TakeLast(2))}"); return (await response.Content.ReadFromJsonAsync<T>())!; }
    private static ContractDraftInput Input(Workspace w) => new(w.Room, w.Owner.Id, w.Tenant.Id, w.Resident, [w.Resident], Today.AddDays(-10), Today.AddDays(30), 3000000, 3000000, "SYNTHETIC TEST TERMS");
    private async Task<Guid> Draft(Workspace w) => (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts", Input(w)))).Id;
    private static async Task Signed(Workspace w, Guid id)
    {
        foreach (var actor in new[] { w.Owner, w.Tenant })
        {
            await Success<SignatureView>(await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp)));
            await Success<ContractView>(await Post(actor, Path(id, "signing/sync")));
        }
    }
    private static async Task Deposit(Workspace w, Guid id, decimal amount = 3000000) =>
        await Success<ContractId>(await Post(w.Owner, Path(id, "deposit-verifications"), new DepositInput("SYNTHETIC-" + Guid.NewGuid(), amount, "Verified synthetic bank statement")));
    private async Task<Guid> Active(Workspace w)
    { var id = await Draft(w); await Signed(w, id); await Deposit(w, id); await Success<ContractView>(await Post(w.Owner, Path(id, "activate"))); return id; }

    [Theory]
    [InlineData(0)] // Before the lease end date.
    [InlineData(10)]
    [InlineData(20)]
    public async Task OwnerApprovesTenantMoveOutForLocationWithoutStaffAssignmentOrSchedule(int daysFromToday)
    {
        var w = await Setup(); var outsider = await Setup(); var id = await Active(w);
        var date = Today.AddDays(daysFromToday);
        var input = new TerminationInput(date, "Synthetic owner move-out request");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Tenant, Path(id, "expiry-move-out"), input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "expiry-move-out"), input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(outsider.Tenant, Path(id, "termination-requests"), input)).StatusCode);

        var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Owner, Path(id, "expiry-move-out"), input, key)).StatusCode);
        var requested = await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"), input, key));
        Assert.Equal("Requested", requested.Status);
        var approvalKey = Guid.NewGuid();
        var opened = await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve"), key: approvalKey));
        Assert.Equal("Approved", opened.Status);
        Assert.Equal(date, opened.ProposedDate);
        Assert.Null(opened.InspectionScheduledAt);
        Assert.Null(opened.InspectionStaffId);
        Assert.Equal(opened.Id, (await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve"), key: approvalKey))).Id);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, Path(id, "termination-requests"), input, Guid.NewGuid())).StatusCode);
        if (await UsesCompact24())
        {
            var tasksPage = await w.Staff.Client.GetFromJsonAsync<TaskPage<TaskView>>(
                $"/api/v1/operational-tasks?locationId={w.Location}");
            var work = Assert.Single(tasksPage!.Items,
                task => task.Target?.ContractId == id && task.Title.StartsWith("Kiểm tra trả phòng"));
            Assert.Equal("Assigned", work.Status);
            Assert.Null(work.RecordedStaffUserId);
            Assert.Equal(w.Staff.Id, work.CurrentResponsibleStaffUserId);
            Assert.Equal(HttpStatusCode.NotFound,
                (await outsider.Staff.Client.GetAsync($"/api/v1/operational-tasks/{work.Id}")).StatusCode);
        }

        var tasks = (await w.Staff.Client.GetFromJsonAsync<MoveOutAssignment[]>("/api/v1/contracts/move-out-assignments"))!;
        var item = Assert.Single(tasks, task => task.ContractId == id);
        Assert.Equal(w.Room, item.RoomId);
        Assert.Null(item.ScheduledAt);
        Assert.DoesNotContain((await outsider.Staff.Client.GetFromJsonAsync<MoveOutAssignment[]>("/api/v1/contracts/move-out-assignments"))!, task => task.ContractId == id);
        Assert.Equal("Active", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
            Assert.Single(await db.Set<ContractMoveOut>().Where(m => m.ContractId == id).ToArrayAsync());
        }
        Assert.Single((await w.Owner.Client.GetFromJsonAsync<MoveOutHistoryView[]>(Path(id, "move-out/history")))!, h => h.Action == "ConsentReady");
        if (daysFromToday > 0)
        {
            var premature = await Post(w.Staff, Path(id, "move-out/inspection"), new InspectionInput(Guid.NewGuid(), Guid.NewGuid(), "Premature synthetic", [Guid.NewGuid()]));
            Assert.Equal(HttpStatusCode.Conflict, premature.StatusCode);
            Assert.Contains("move_out_not_ready_for_inspection", await premature.Content.ReadAsStringAsync());
        }
    }
    [Fact(Skip = "Executed against Compact24 PostgreSQL by Compact24ContractRegressionTests.MoveOutDraft.")]
    public async Task MoveOutDraftPersistsPartialItemsWithVersionedStaffWritesAndOwnerReadAccess()
    {
        var w = await Setup();
        var outsider = await Setup();
        var id = await Active(w);
        await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"),
            new TerminationInput(Today, "Synthetic draft inspection")));
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve")));
        var draftPath = Path(id, "move-out/inspection-draft");
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.Client.GetAsync(draftPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Tenant.Client.GetAsync(draftPath)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Staff.Client.GetAsync(draftPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.Client.GetAsync(draftPath)).StatusCode);

        var available = (await w.Staff.Client.GetFromJsonAsync<TaskPage<TaskView>>(
            $"/api/v1/operational-tasks?locationId={w.Location}"))!;
        var task = Assert.Single(available.Items, t => t.Target?.ContractId == id &&
            t.Title.StartsWith("Kiểm tra trả phòng"));
        task = await Success<TaskView>(await Post(w.Staff,
            $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version)));
        Assert.Equal("InProgress", task.Status);
        var initial = await Success<MoveOutInspectionDraftView>(await w.Staff.Client.GetAsync(draftPath));
        Assert.Equal(0, initial.Version);
        Assert.Empty(initial.RoomChecks);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.Client.GetAsync(draftPath)).StatusCode);

        static async Task<HttpResponseMessage> Patch(Actor user, string path,
            MoveOutInspectionDraftWrite input, Guid? idempotency = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Patch, path)
            { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", (idempotency ?? Guid.NewGuid()).ToString());
            return await user.Client.SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Patch(w.Staff, draftPath,
            new(initial.Version, RoomCondition: "Synthetic inspected walls"))).StatusCode);
        var summaryPhoto = await MoveOutPhoto(w.Staff, id);
        var firstWrite = new MoveOutInspectionDraftWrite(initial.Version,
            RoomCondition: "Synthetic inspected walls", Notes: "Synthetic working note", EvidenceIds: [summaryPhoto]);
        var key = Guid.NewGuid();
        var first = await Success<MoveOutInspectionDraftView>(
            await Patch(w.Staff, draftPath, firstWrite, key));
        Assert.Equal(1, first.Version);
        Assert.Equal("Synthetic inspected walls", first.RoomCondition);
        var ownerView = await Success<MoveOutInspectionDraftView>(await w.Owner.Client.GetAsync(draftPath));
        Assert.Equal(first.Version, ownerView.Version);
        Assert.Equal(first.RoomCondition, ownerView.RoomCondition);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Patch(w.Owner, draftPath, new(first.Version, Notes: "forged"))).StatusCode);
        var replay = await Success<MoveOutInspectionDraftView>(
            await Patch(w.Staff, draftPath, firstWrite, key));
        Assert.Equal(first.Version, replay.Version);
        Assert.Equal(first.RoomCondition, replay.RoomCondition);
        Assert.Equal(HttpStatusCode.Conflict,
            (await Patch(w.Staff, draftPath, firstWrite)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Patch(outsider.Staff, draftPath, new(first.Version, Notes: "forged"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Patch(w.Tenant, draftPath, new(first.Version, Notes: "forged"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await Patch(w.Staff, draftPath, new(first.Version,
                EvidenceIds: [Guid.NewGuid()]))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await Patch(w.Staff, draftPath, new(first.Version,
                Assets: [new(Guid.NewGuid(), "Good")]))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await Patch(w.Staff, draftPath, new(first.Version,
                ElectricityReadingId: Guid.NewGuid()))).StatusCode);

        using var evidenceBody = new ByteArrayContent(Image());
        evidenceBody.Headers.ContentType = new("image/png");
        var photo = (await Success<ContractId>(
            await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), evidenceBody))).Id;
        var photoPath = Path(id, $"move-out/evidence/{photo}");
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.Client.GetAsync(photoPath)).StatusCode);
        var roomCode = HandoverRoomChecklist.RequiredCodes[0];
        Assert.Equal(HttpStatusCode.BadRequest, (await Patch(w.Staff, draftPath,
            new(first.Version, RoomChecks: [new(roomCode, "Issue", null, [])]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Patch(w.Staff, draftPath,
            new(first.Version, AccessItems: [new("RoomKey", 0, "")]))).StatusCode);
        var second = await Success<MoveOutInspectionDraftView>(
            await Patch(w.Staff, draftPath, new(first.Version,
                RoomChecks: [new(roomCode, "Issue", "Synthetic scratch", [photo])])));
        Assert.Equal(2, second.Version);
        Assert.Equal(first.RoomCondition, second.RoomCondition);
        Assert.Equal(photo, Assert.Single(second.RoomChecks).EvidenceIds.Single());
        Assert.Equal(summaryPhoto, Assert.Single(second.EvidenceIds));
        ownerView = await Success<MoveOutInspectionDraftView>(await w.Owner.Client.GetAsync(draftPath));
        Assert.Equal(photo, Assert.Single(ownerView.RoomChecks).EvidenceIds.Single());
        Assert.Equal(Image(), await w.Owner.Client.GetByteArrayAsync(photoPath));
        Assert.Equal(HttpStatusCode.NotFound, (await w.Tenant.Client.GetAsync(photoPath)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Staff.Client.GetAsync(photoPath)).StatusCode);
        var keyPhoto = await MoveOutPhoto(w.Staff, id);
        var third = await Success<MoveOutInspectionDraftView>(
            await Patch(w.Staff, draftPath, new(second.Version, AccessItems: [new("RoomKey", 0, "")],
                KeyEvidenceIds: [keyPhoto], RoomChecks: [new(HandoverRoomChecklist.RequiredCodes[1], "NotApplicable", "Optional note", [])])));
        Assert.Equal(3, third.Version);
        Assert.Equal(2, third.RoomChecks.Length);
        Assert.Equal("Optional note", third.RoomChecks[1].Notes);
        var resumed = await Success<MoveOutInspectionDraftView>(await w.Staff.Client.GetAsync(draftPath));
        Assert.Equal(third.Version, resumed.Version);
        Assert.Equal(third.RoomCondition, resumed.RoomCondition);
        Assert.Equal(third.KeysAndAccess, resumed.KeysAndAccess);
        Assert.Equal(third.RoomChecks[0].Code, resumed.RoomChecks[0].Code);
        Assert.Equal(photo, resumed.RoomChecks[0].EvidenceIds.Single());
        var competing = await Task.WhenAll(
            Patch(w.Staff, draftPath, new(third.Version, Notes: "Synthetic concurrent A")),
            Patch(w.Staff, draftPath, new(third.Version, Notes: "Synthetic concurrent B")));
        Assert.Single(competing, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(competing, response => response.StatusCode == HttpStatusCode.Conflict);
        var resolved = await Success<MoveOutInspectionDraftView>(await w.Staff.Client.GetAsync(draftPath));
        Assert.Equal(third.Version + 1, resolved.Version);
        Assert.Contains(resolved.Notes, new[] { "Synthetic concurrent A", "Synthetic concurrent B" });
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var persisted = await db.Database.SqlQuery<string>($"""
            SELECT move_out->'inspectionDraft'->>'roomCondition' AS "Value"
            FROM contracts WHERE id={id}
            """).SingleAsync();
        Assert.Equal(third.RoomCondition, persisted);
        Assert.Equal(MoveOutStatus.Approved, (await db.Set<ContractMoveOut>()
            .SingleAsync(move => move.ContractId == id)).Status);
        Assert.Single(await db.Set<ContractInspectionEvidence>()
            .Where(file => file.Id == photo && !file.IsLinked).ToArrayAsync());
    }

    private async Task<Meter[]> InstallHandoverMeters(Workspace w)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var meters = new[] { UtilityType.Electricity, UtilityType.Water }.Select(type => new Meter
        {
            RoomId = w.Room,
            Code = "SYNTHETIC-CONTRACT-" + type,
            UtilityType = type,
            InstalledOn = Today.AddDays(-20)
        }).ToArray();
        db.AddRange(meters);
        await db.SaveChangesAsync();
        return meters;
    }

    private async Task<ConfirmedReading> ConfirmInitialTask(Workspace w, Guid taskId, decimal value)
    {
        using var photo = new ByteArrayContent(Image());
        photo.Headers.ContentType = new("image/png");
        var evidence = await Success<IdResult>(await w.Staff.Client.PutAsync($"/api/v1/capture/meter-tasks/{taskId}/evidence", photo));
        return await Success<ConfirmedReading>(await w.Staff.Client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm",
            new MeterConfirmation(true, value, evidence.Id)));
    }

    private async Task<bool> UsesCompact24()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        return scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>() is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext;
    }

    // These regression scenarios exercise the archived handover endpoints.
    // New Main contracts now start with a Draft, so explicitly model an older
    // persisted contract without that Draft instead of bypassing production guards.
    private async Task PrepareHistoricalHandoverFixture(Guid contractId)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        if (db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET handover=handover-'preparation' WHERE id={contractId}");
    }

    private async Task<HandoverChoices> EmptyRoomHandoverChoices(Workspace w, Guid id)
    {
        var choices = await Success<HandoverChoices>(await w.Staff.Client.GetAsync(Path(id, "handover/choices")));
        if (choices.InventoryToken is not null && !choices.NoAssetsConfirmed)
        {
            await Success<HandoverInventory>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/locations/{w.Location}/room-inventory-review/{w.Room}/no-assets",
                new RoomNoAssetsConfirmation(choices.InventoryToken, "Owner checked synthetic empty room")));
            choices = await Success<HandoverChoices>(await w.Staff.Client.GetAsync(Path(id, "handover/choices")));
        }
        // Staff's operational-task list intentionally hides inventory checkpoints
        // behind the main move-in job. Find both from the Owner's full task list,
        // then exercise the real Staff start/complete APIs rather than bypassing
        // the inventory requirement for these legacy handover regressions.
        var tasks = await Success<BHome.Application.StaffOperations.TaskPage<BHome.Application.StaffOperations.TaskView>>(
            await w.Owner.Client.GetAsync($"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        var main = tasks.Items.SingleOrDefault(task =>
            task.Kind == "AdHoc" && task.Target?.ContractId == id &&
            task.Title.StartsWith("Bàn giao vào phòng", StringComparison.Ordinal));
        var inventory = tasks.Items.SingleOrDefault(task =>
            task.Kind == "MoveInInventory" && task.Target?.ContractId == id);
        if (await UsesCompact24())
        {
            Assert.NotNull(main);
            Assert.NotNull(inventory);
        }
        if (inventory is not null)
        {
            if (main?.Status == "Assigned")
                await Success<BHome.Application.StaffOperations.TaskView>(await Post(w.Staff,
                    $"/api/v1/operational-tasks/{main.Id}/start",
                    new BHome.Application.StaffOperations.TaskAction(main.Version)));
            if (inventory.Status != "Completed")
            {
                var started = inventory.Status == "InProgress" ? inventory :
                    await Success<BHome.Application.StaffOperations.TaskView>(await Post(w.Staff,
                        $"/api/v1/operational-tasks/{inventory.Id}/start",
                        new BHome.Application.StaffOperations.TaskAction(inventory.Version)));
                var completed = await Success<BHome.Application.StaffOperations.MoveInInventoryView>(await Post(w.Staff,
                    $"/api/v1/operational-tasks/{inventory.Id}/move-in-inventory/complete",
                    new BHome.Application.StaffOperations.MoveInInventoryComplete(started.Version,
                        "Synthetic empty room physically checked", ConfirmNoAssets: true)));
                Assert.True(completed.ReadyForHandover);
            }
        }
        return choices;
    }

    internal async Task ActivationCreatesOneMoveInTaskWithoutDependingOnAvailableStaff(bool assigned)
    {
        var w = await Setup();
        var meters = await InstallHandoverMeters(w);
        if (!assigned)
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
            foreach (var assignment in await db.StaffLocationAssignments.Where(a => a.LocationId == w.Location).ToArrayAsync()) assignment.ChangePeriod(Today.AddYears(-1), Today.AddDays(-1));
            await db.SaveChangesAsync();
        }
        // Draft creation now provisions these tasks before activation as well.
        var id = (await Success<ContractId>(await Post(assigned ? w.Staff : w.Owner,
            "/api/v1/contracts", Input(w)))).Id;
        await Signed(w, id); await Deposit(w, id);
        var key = Guid.NewGuid();
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate"), null, key));
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate"), null, key));
        await using var check = fixture.Factory.Services.CreateAsyncScope(); var store = check.ServiceProvider.GetFixturePersistence();
        var task = Assert.Single(await store.Set<OperationalTask>().Where(task => task.ContractId == id && task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.AdHoc).ToArrayAsync());
        Assert.Equal(w.Room, task.TargetRoomId); Assert.Equal(assigned ? w.Staff.Id : (Guid?)null, task.AssignedStaffUserId);
        var initialTasks = await store.Set<OperationalTask>().Where(task => task.ContractId == id && task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading)
            .OrderBy(task => task.MeterId).ToArrayAsync();
        Assert.Equal(2, initialTasks.Length);
        Assert.Equal(meters.Select(meter => meter.Id).Order().ToArray(), initialTasks.Select(meterTask => meterTask.MeterId!.Value).ToArray());
        Assert.All(initialTasks, meterTask =>
        {
            Assert.Equal(ReadingPurpose.Initial, meterTask.Purpose);
            Assert.Equal(w.Location, meterTask.RequiredLocationId);
            Assert.Equal(assigned ? w.Staff.Id : (Guid?)null, meterTask.AssignedStaffUserId);
            Assert.Equal(MeterTaskStatus.Assigned, meterTask.MeterStatus);
        });
        var inventory = Assert.Single(await store.Set<OperationalTask>().Where(task => task.ContractId == id &&
            task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MoveInInventory).ToArrayAsync());
        Assert.Equal(w.Room, inventory.TargetRoomId);
        Assert.Equal(assigned ? w.Staff.Id : (Guid?)null, inventory.AssignedStaffUserId);
        Assert.NotNull(inventory.DueAt);
        Assert.Equal(BHome.Domain.Billing.MeterTaskStatus.Assigned, inventory.MeterStatus);
        var checklist = System.Text.Json.JsonSerializer.Deserialize<BHome.Application.StaffOperations.MoveInInventorySnapshot>(
            inventory.MoveInInventoryJson);
        Assert.NotNull(checklist);
        Assert.NotNull(checklist.Items);
    }

    internal async Task ReusedMetersRequireFreshContractInitialReadingsBeforeMoveInHandover()
    {
        var w = await Setup();
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetFixturePersistence();
            var room = await db.Set<Room>().SingleAsync(room => room.Id == w.Room);
            room.Capacity = 2; // Two individual Tenants can have separate contracts in one Room.
            await db.SaveChangesAsync();
        }
        var meters = await InstallHandoverMeters(w);
        var firstId = await Active(w);
        var firstTasks = (await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync("/api/v1/capture/meter-tasks")))
            .Where(task => task.ContractId == firstId).OrderBy(task => task.UtilityType).ToArray();
        Assert.Equal(2, firstTasks.Length);
        var firstReadings = new[]
        {
            await ConfirmInitialTask(w, firstTasks[0].Id, 100),
            await ConfirmInitialTask(w, firstTasks[1].Id, 50)
        };
        Assert.All(firstReadings, reading => Assert.Null(reading.Consumption));

        var nextTenant = await User(Roles.Tenant);
        Guid nextResident;
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetFixturePersistence();
            var resident = new Resident
            {
                RoomId = w.Room,
                TenantUserId = nextTenant.Id,
                OwnerUserId = w.Owner.Id,
                DisplayLabel = "Synthetic second contract representative",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(resident); await db.SaveChangesAsync(); nextResident = resident.Id;
        }
        var second = w with { Tenant = nextTenant, Resident = nextResident };
        var secondId = await Active(second);
        Assert.NotEqual(firstId, secondId);
        var allTasks = await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync("/api/v1/capture/meter-tasks"));
        var secondTasks = allTasks.Where(task => task.ContractId == secondId).OrderBy(task => task.UtilityType).ToArray();
        // A second contract in the same occupied room cycle must not generate
        // duplicate move-in work or inherit another contract's private capture.
        Assert.Empty(secondTasks);
        Assert.Equal(meters.Select(meter => meter.Id).Order().ToArray(),
            allTasks.Where(task => task.ContractId == firstId).Select(task => task.MeterId).Order().ToArray());
        var choices = await Success<HandoverChoices>(await second.Staff.Client.GetAsync(Path(secondId, "handover/choices")));
        Assert.Empty(choices.Readings);
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Staff.Client.GetAsync(Path(secondId, "handover/draft"))).StatusCode);
        var inbox = await Success<HandoverInboxPage>(await w.Owner.Client.GetAsync(
            $"/api/v1/contracts/handovers?locationId={w.Location}"));
        Assert.Single(inbox.Items, item => item.ContractId == firstId);
        Assert.DoesNotContain(inbox.Items, item => item.ContractId == secondId);
        var stale = new HandoverInput(0, firstTasks[0].ReadingDate, "Synthetic room", "Synthetic keys", "", [],
            firstReadings[0].Id, firstReadings[1].Id, [], choices.InventoryToken);
        var staleResponse = await Post(w.Staff, Path(secondId, "handover"), stale);
        Assert.Equal(HttpStatusCode.NotFound, staleResponse.StatusCode);

        // Staff cannot issue extra tasks, and Owner cannot duplicate the
        // canonical contract's existing checkpoints.
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
            new MeterTaskInput(firstTasks[0].MeterId, ReadingPurpose.Initial, firstTasks[0].ReadingDate, null, secondId))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
            new MeterTaskInput(firstTasks[0].MeterId, ReadingPurpose.Initial, firstTasks[0].ReadingDate, null, firstId))).StatusCode);
        var original = await Success<HandoverChoices>(await w.Staff.Client.GetAsync(Path(firstId, "handover/choices")));
        Assert.Equal(firstReadings.Select(reading => reading.Id).Order().ToArray(), original.Readings.Select(reading => reading.Id).Order().ToArray());

        var recorded = await Success<HandoverDraftView>(await w.Staff.Client.GetAsync(Path(firstId, "handover/draft")));
        Assert.Equal(firstReadings[0].Id, recorded.Electricity!.Id);
        Assert.Equal(firstReadings[1].Id, recorded.Water!.Id);
    }

    internal async Task StartedManualMoveInCanRepairMissingMeterBaselinesWithoutCreatingAnotherStaffJob()
    {
        if (!await UsesCompact24()) return;
        var w = await Setup();
        // A manually created Main can reach the handover before its physical meters
        // have been assigned. Installing existing meters later must not require a
        // new handover or stand-alone Staff work order.
        var contractId = await Active(w);
        var before = await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync(
            $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}"));
        Assert.DoesNotContain(before, task => task.ContractId == contractId && task.Purpose == ReadingPurpose.Initial);

        var jobs = await Success<TaskPage<TaskView>>(await w.Staff.Client.GetAsync(
            $"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        var moveIn = Assert.Single(jobs.Items, job => job.Target?.ContractId == contractId &&
            job.Title.StartsWith("Bàn giao vào phòng", StringComparison.Ordinal));
        var started = await Success<TaskView>(await Post(w.Staff,
            $"/api/v1/operational-tasks/{moveIn.Id}/start", new TaskAction(moveIn.Version)));
        Assert.Equal("InProgress", started.Status);

        var meters = await InstallHandoverMeters(w);
        var key = Guid.NewGuid();
        var endpoint = $"/api/v1/operational-tasks/{moveIn.Id}/initial-meter-baselines/ensure";
        var ids = await Success<Guid[]>(await Post(w.Staff, endpoint, key: key));
        Assert.Equal(2, ids.Length);
        Assert.Equal(ids, await Success<Guid[]>(await Post(w.Staff, endpoint, key: key)));
        Assert.Equal(ids, await Success<Guid[]>(await Post(w.Staff, endpoint)));

        var tasks = (await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync(
            $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}")))
            .Where(task => task.ContractId == contractId && task.Purpose == ReadingPurpose.Initial)
            .OrderBy(task => task.UtilityType).ToArray();
        Assert.Equal(2, tasks.Length);
        Assert.Equal(ids.Order().ToArray(), tasks.Select(task => task.Id).Order().ToArray());
        Assert.Equal(meters.Select(meter => meter.Id).Order().ToArray(), tasks.Select(task => task.MeterId).Order().ToArray());
        Assert.All(tasks, task => Assert.Equal(MeterTaskStatus.Assigned, task.Status));
        var readings = await Task.WhenAll(tasks.Select((task, index) =>
            ConfirmInitialTask(w, task.Id, index == 0 ? 100 : 50)));
        Assert.Equal(2, readings.Length);
        Assert.All(readings, reading => Assert.Null(reading.Consumption));

        var afterJobs = await Success<TaskPage<TaskView>>(await w.Staff.Client.GetAsync(
            $"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        Assert.Single(afterJobs.Items, job => job.Target?.ContractId == contractId &&
            job.Title.StartsWith("Bàn giao vào phòng", StringComparison.Ordinal));
        Assert.DoesNotContain(afterJobs.Items, job => job.Kind == "MeterReading");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Tenant, endpoint)).StatusCode);
    }

    internal async Task StartingManualMoveInCreatesBaselineCheckpointsForExistingPhysicalMeters(bool existingBaselines = false)
    {
        if (!await UsesCompact24()) return;
        var w = await Setup();
        // Manual contract was activated before meters were connected to the
        // room. Staff should not need to create any separate capture work item.
        var contractId = await Active(w);
        var meters = await InstallHandoverMeters(w);
        var existingIds = new List<Guid>();
        ConfirmedReading? confirmed = null;
        if (existingBaselines)
        {
            foreach (var meter in meters)
                existingIds.Add((await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync(
                    "/api/v1/capture/meter-tasks", new MeterTaskInput(meter.Id, ReadingPurpose.Initial, Today, null, contractId)))).Id);
            confirmed = await ConfirmInitialTask(w, existingIds[0], 100);
        }
        var tasks = await Success<TaskPage<TaskView>>(await w.Staff.Client.GetAsync(
            $"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        var moveIn = Assert.Single(tasks.Items, item => item.Target?.ContractId == contractId &&
            item.Title.StartsWith("Bàn giao vào phòng", StringComparison.Ordinal));
        await Success<TaskView>(await Post(w.Staff,
            $"/api/v1/operational-tasks/{moveIn.Id}/start", new TaskAction(moveIn.Version)));
        var baselines = (await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync(
            $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}")))
            .Where(task => task.ContractId == contractId && task.Purpose == ReadingPurpose.Initial)
            .OrderBy(task => task.UtilityType).ToArray();
        Assert.Equal(2, baselines.Length);
        Assert.Equal(meters.Select(meter => meter.Id).Order().ToArray(),
            baselines.Select(task => task.MeterId).Order().ToArray());
        if (existingBaselines)
        {
            Assert.Equal(existingIds.Order().ToArray(), baselines.Select(task => task.Id).Order().ToArray());
            Assert.Equal(MeterTaskStatus.Completed, baselines.Single(task => task.Id == existingIds[0]).Status);
            Assert.Equal(MeterTaskStatus.Assigned, baselines.Single(task => task.Id == existingIds[1]).Status);
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetFixturePersistence();
            var reading = await db.Set<MeterReading>().SingleAsync(r => r.TaskId == existingIds[0]);
            Assert.Equal(confirmed!.Id, reading.Id);
            Assert.Equal(100m, reading.ConfirmedValue);
        }
        else Assert.All(baselines, task => Assert.Equal(MeterTaskStatus.Assigned, task.Status));
        var sameIds = await Success<Guid[]>(await Post(w.Staff,
            $"/api/v1/operational-tasks/{moveIn.Id}/initial-meter-baselines/ensure"));
        Assert.Equal(baselines.Select(task => task.Id).Order().ToArray(), sameIds.Order().ToArray());
        var reread = (await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync(
            $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={w.Room}")))
            .Where(task => task.ContractId == contractId && task.Purpose == ReadingPurpose.Initial);
        Assert.Equal(2, reread.Count());
    }

    internal async Task QuickCreateUsesExistingMetersAndUnifiedMoveIn()
    {
        if (!await UsesCompact24()) return;
        var w = await Setup();
        string ownerEmail;
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetFixturePersistence();
            ownerEmail = (await db.Users.Where(user => user.Id == w.Owner.Id).Select(user => user.Email).SingleAsync())!;
            db.Add(new Asset
            {
                LocationId = w.Location,
                RoomId = w.Room,
                Name = "Synthetic chair",
                Code = Guid.NewGuid().ToString("N"),
                Category = "Furniture",
                Condition = "Tốt",
                Status = AssetStatus.Active
            });
            db.Add(new BillingPolicy { LocationId = w.Location, Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3000000, EffectiveFrom = Today.AddDays(-1) });
            db.AddRange(new[] { UtilityType.Electricity, UtilityType.Water }.Select(type => new Meter
            {
                RoomId = w.Room,
                UtilityType = type,
                Code = $"TEST-{type}-{Guid.NewGuid():N}",
                Display = MeterDisplay.Mechanical,
                InstalledOn = Today.AddDays(-1)
            }));
            await db.SaveChangesAsync();
        }
        using var development = fixture.Factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services => services.AddScoped<DevelopmentOnboardingSeedService>());
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["DevelopmentContractSeed:Enabled"] = "true",
                    ["DevelopmentContractSeed:TenantPassword"] = "Synthetic!DevSeed-493"
                }));
        });
        using var client = development.CreateClient();
        // The Development host has its own session issuer/configuration, so
        // authenticate against it rather than replaying the Testing-host JWT.
        var login = await Success<LoginResult>(await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = w.Staff.Id.ToString("N") + "@example.invalid",
            password = BHome.IntegrationTests.Compact24.WorkflowTestUsers.Password
        }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        var staff = new Actor(client, w.Staff.Id);
        using var ownerClient = development.CreateClient();
        var ownerLogin = await Success<LoginResult>(await ownerClient.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = ownerEmail,
            password = BHome.IntegrationTests.Compact24.WorkflowTestUsers.Password
        }));
        ownerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ownerLogin.AccessToken);
        var owner = new Actor(ownerClient, w.Owner.Id);
        var key = Guid.NewGuid();
        var input = new DevelopmentOnboardingSeedInput(w.Location, w.Room);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, "/test-probe/onboarding-seed", input)).StatusCode);
        var created = await Success<DevelopmentOnboardingSeedResult>(await Post(owner,
            "/test-probe/onboarding-seed", input, key));
        Assert.Equal(w.Room, created.RoomId);
        Assert.Equal(created.ContractId, (await Success<DevelopmentOnboardingSeedResult>(await Post(owner,
            "/test-probe/onboarding-seed", input, key))).ContractId);
        await using (var before = development.Services.CreateAsyncScope())
        {
            var store = before.ServiceProvider.GetFixturePersistence();
            Assert.Equal(2, await store.Set<Meter>().CountAsync(m => m.RoomId == created.RoomId && m.IsActive));
            Assert.Equal(2, await store.Set<OperationalTask>().CountAsync(task =>
                task.ContractId == created.ContractId &&
                task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading));
        }
        var handover = await Success<HandoverDraftView>(await client.GetAsync(
            Path(created.ContractId, "handover/draft")));
        Assert.NotNull(handover.MoveInTask);
        var work = await Success<TaskPage<TaskView>>(await client.GetAsync(
            $"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        Assert.Single(work.Items, task => task.Target?.ContractId == created.ContractId &&
            task.Title.StartsWith("Bàn giao vào phòng", StringComparison.Ordinal));
        Assert.DoesNotContain(work.Items, task =>
            task.Target?.ContractId == created.ContractId && task.Kind == "MeterReading");

        await Success<TaskView>(await Post(staff,
            $"/api/v1/operational-tasks/{handover.MoveInTask!.Id}/start",
            new TaskAction(handover.MoveInTask.Version)));
        var baselines = (await Success<MeterTaskSummary[]>(await client.GetAsync(
            $"/api/v1/capture/meter-tasks?locationId={w.Location}&roomId={created.RoomId}")))
            .Where(task => task.ContractId == created.ContractId && task.Purpose == ReadingPurpose.Initial)
            .OrderBy(task => task.UtilityType).ToArray();
        Assert.Equal(2, baselines.Length);
        Assert.Equal(new[] { UtilityType.Electricity, UtilityType.Water },
            baselines.Select(task => (UtilityType)task.UtilityType).ToArray());
        Assert.All(baselines, task => Assert.Equal(MeterTaskStatus.Assigned, task.Status));
        var after = await Success<TaskPage<TaskView>>(await client.GetAsync(
            $"/api/v1/operational-tasks?locationId={w.Location}&pageSize=100"));
        Assert.Single(after.Items, task => task.Target?.ContractId == created.ContractId);
    }

    [Fact]
    public async Task CaptureRoomsReportsRemainingCapacityFromActiveContracts()
    {
        var w = await Setup();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            var room = await db.Set<Room>().SingleAsync(r => r.Id == w.Room); room.Capacity = 2; await db.SaveChangesAsync();
        }
        var before = await w.Staff.Client.GetFromJsonAsync<BHome.Application.Ocr.NamedResource[]>($"/api/v1/capture/locations/{w.Location}/rooms");
        Assert.Equal(2, before!.Single(r => r.Id == w.Room).RemainingCapacity);
        Assert.Empty(before!.Single(r => r.Id == w.Room).CurrentTenantLabels!);
        await Active(w);
        var after = await w.Staff.Client.GetFromJsonAsync<BHome.Application.Ocr.NamedResource[]>($"/api/v1/capture/locations/{w.Location}/rooms");
        Assert.Equal(1, after!.Single(r => r.Id == w.Room).RemainingCapacity);
        Assert.Single(after!.Single(r => r.Id == w.Room).CurrentTenantLabels!);
    }

    [Fact]
    public async Task CaptureRoomsFlagsPendingOwnerSignatureEvenWhenCapacityRemains()
    {
        var w = await Setup();
        var id = await Draft(w);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Capacity = 2;
            (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status = ContractStatus.PendingSigning;
            await db.SaveChangesAsync();
        }
        var rooms = await w.Staff.Client.GetFromJsonAsync<BHome.Application.Ocr.NamedResource[]>($"/api/v1/capture/locations/{w.Location}/rooms");
        var room = Assert.Single(rooms!, r => r.Id == w.Room);
        Assert.Equal(2, room.RemainingCapacity);
        Assert.True(room.WaitingForOwnerSignature);
    }

    [Fact]
    public async Task DevelopmentWorkflowUsesPrivateRealPdfAndDistinctSimulationEvidenceBeforeActivation()
    {
        var w = await Setup(); var outside = await Setup();
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var setupDb = setup.ServiceProvider.GetFixturePersistence();
        }
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractWorkflow:SimulatedSigningEnabled"] = "true",
                ["ContractPdf:TemplateId"] = "main-contract-development-v1"
            }));
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IContractSigningProvider>();
                s.AddScoped(typeof(IContractSigningProvider), typeof(ContractSigningRouter).Assembly
                    .GetType("BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter", true)!);
            });
        });
        Actor InHost(Actor a) { var client = host.CreateClient(); client.DefaultRequestHeaders.Authorization = a.Client.DefaultRequestHeaders.Authorization; return new(client, a.Id); }
        var owner = InHost(w.Owner); var tenant = InHost(w.Tenant); var staff = InHost(w.Staff);
        var configuration = await Success<ContractWorkflowConfiguration>(await owner.Client.GetAsync("/api/v1/contracts/configuration"));
        Assert.True(configuration.Template.Available); Assert.True(configuration.Template.DevelopmentOnly); Assert.Equal("Simulated", configuration.SigningMode);
        var prepared = await Success<ContractPreparation>(await staff.Client.GetAsync($"/api/v1/contracts/preparation?locationId={w.Location}"));
        Assert.Contains(prepared.Rooms, r => r.Id == w.Room); Assert.DoesNotContain(prepared.Rooms, r => r.Id == outside.Room);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.Client.GetAsync("/api/v1/contracts/preparation")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.Client.GetAsync("/api/v1/contracts/preparation/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Post(owner, $"/api/v1/contracts/preparation/residents/{w.Resident}/account", new TenantAccountLink(w.Tenant.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/contracts/preparation/residents/{w.Resident}/account", new TenantAccountLink(outside.Tenant.Id))).StatusCode);
        var id = (await Success<ContractId>(await Post(staff, "/api/v1/contracts", Input(w)))).Id;
        var wrong = Input(w) with { TenantUserId = outside.Tenant.Id };
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(staff, "/api/v1/contracts", wrong)).StatusCode);
        var preview = await Success<ContractDocumentView>(await Post(owner, Path(id, "previews")));
        var replay = await Success<ContractDocumentView>(await Post(owner, Path(id, "previews")));
        Assert.Equal(preview.Id, replay.Id); Assert.True(preview.DevelopmentOnly);
        var pdf = await tenant.Client.GetByteArrayAsync(Path(id, $"previews/{preview.Id}"));
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(pdf));
        Assert.Equal(preview.Id, Assert.Single(await Success<ContractDocumentView[]>(await staff.Client.GetAsync(Path(id, "previews")))).Id);
        Assert.Equal(pdf, await staff.Client.GetByteArrayAsync(Path(id, $"previews/{preview.Id}")));
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Staff.Client.GetAsync(Path(id, $"previews/{preview.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Tenant.Client.GetAsync(Path(id, $"previews/{preview.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, Path(id, "activate"))).StatusCode);
        foreach (var actor in new[] { owner, tenant })
        {
            await Success<SignatureView>(await Post(actor, Path(id, "signing"), new SigningInput(Guid.Empty)));
            var signed = await Success<ContractView>(await Post(actor, Path(id, "signing/sync")));
            Assert.True(signed.IsDevelopmentDemo); Assert.Contains(signed.Signatures, s => s.SignerUserId == actor.Id && s.Status == "Simulated");
            Assert.DoesNotContain(signed.Signatures, s => s.Status == "Signed");
        }
        Assert.False((await Success<ActivationReadiness>(await owner.Client.GetAsync(Path(id, "activation-readiness")))).Ready);
        await Deposit(w, id);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, Path(id, "activate"))).StatusCode);
        var active = await Success<ContractView>(await Post(owner, Path(id, "activate")));
        Assert.Equal("Active", active.Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.Client.GetAsync(Path(id, "previews"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.Client.GetAsync(Path(id, $"previews/{preview.Id}"))).StatusCode);
        Assert.Single(await Success<DepositVerificationView[]>(await owner.Client.GetAsync(Path(id, "deposit-verifications"))));
        Assert.Contains(await Success<ContractHistoryView[]>(await tenant.Client.GetAsync(Path(id, "history"))), a => a.Action == "ContractSignatureSimulated");
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().FindAsync(w.Room))!.Status);
        Assert.Single(await db.Set<ContractDocumentFile>().Where(f => f.ContractId == id).ToArrayAsync());
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Contracts\" SET \"IsDevelopmentDemo\" = false WHERE \"Id\" = {id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"ContractDocumentFiles\" SET \"FileHash\" = 'tampered' WHERE \"ContractId\" = {id}"));
        var objectStorage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        await ContractFileCleanup.CleanupAsync(scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(), objectStorage, DateTimeOffset.UtcNow.AddDays(2), default);
        Assert.Equal(pdf, await tenant.Client.GetByteArrayAsync(Path(id, $"previews/{preview.Id}")));
        var documentFile = await db.Set<ContractDocumentFile>().SingleAsync(f => f.Id == preview.Id);
        using var tampered = new MemoryStream("SYNTHETIC TAMPERING"u8.ToArray());
        await objectStorage.PutAsync(documentFile.ObjectKey, tampered, tampered.Length, "application/pdf", default);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.GetAsync(Path(id, $"previews/{preview.Id}"))).StatusCode);
    }

    [Fact]
    public async Task ListScopesBeforeCountingAndPagingAndReturnsOnlySafeSummaries()
    {
        var a = await Setup(); var b = await Setup(); var own = await Draft(a); var another = await Draft(b);
        foreach (var actor in new[] { a.Staff, a.Tenant })
        {
            var page = await Success<ContractPage>(await actor.Client.GetAsync("/api/v1/contracts?page=1&pageSize=1"));
            Assert.Equal(1, page.TotalCount); Assert.Equal(own, Assert.Single(page.Items).Id);
            var outside = await Success<ContractPage>(await actor.Client.GetAsync($"/api/v1/contracts?locationId={b.Location}"));
            Assert.Equal(0, outside.TotalCount); Assert.Empty(outside.Items);
            var second = await Success<ContractPage>(await actor.Client.GetAsync("/api/v1/contracts?page=2&pageSize=1"));
            Assert.Equal(1, second.TotalCount); Assert.Empty(second.Items);
        }
        var owner = await Success<ContractPage>(await a.Owner.Client.GetAsync($"/api/v1/contracts?locationId={b.Location}&status=Draft"));
        Assert.Equal(another, Assert.Single(owner.Items).Id);
        var empty = await Success<ContractPage>(await a.Owner.Client.GetAsync($"/api/v1/contracts?locationId={a.Location}&status=Active"));
        Assert.Empty(empty.Items);
        var response = await a.Staff.Client.GetAsync("/api/v1/contracts");
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("tenantUserId", json); Assert.DoesNotContain("residentIds", json);
        Assert.DoesNotContain("terms", json); Assert.DoesNotContain("objectKey", json);
        Assert.Contains("\"monthlyRent\":\"3000000\"", json);
        Assert.Equal(a.Location, (await Success<ContractView>(await a.Owner.Client.GetAsync(Path(own)))).LocationId);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Factory.CreateClient().GetAsync("/api/v1/contracts")).StatusCode);
        foreach (var query in new[] { "page=0", "page=-1", "pageSize=0", "pageSize=101", "page=2147483647&pageSize=100", "status=Invented", "status=99", "locationId=00000000-0000-0000-0000-000000000000" })
            Assert.Equal(HttpStatusCode.BadRequest, (await a.Owner.Client.GetAsync("/api/v1/contracts?" + query)).StatusCode);
    }

    [Fact]
    public async Task MoveInHandoverRequiresScopedStaffRealReadingsEvidenceAndSameVersionConfirmations()
    {
        var w = await Setup(); var outside = await Setup();
        await InstallHandoverMeters(w);
        var id = await Active(w);
        var compact24 = await UsesCompact24();
        var readingIds = new List<Guid>();
        DateOnly? handoverDate = null;
        foreach (var type in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var tasks = await Success<MeterTaskSummary[]>(await w.Staff.Client.GetAsync("/api/v1/capture/meter-tasks"));
            Guid taskId;
            DateOnly taskDate;
            if (compact24)
            {
                var task = Assert.Single(tasks, task => task.ContractId == id && task.Purpose == ReadingPurpose.Initial && task.UtilityType == type);
                taskId = task.Id;
                taskDate = task.ReadingDate;
            }
            else
            {
                await using var scope = fixture.Factory.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetFixturePersistence();
                var meter = await db.Set<Meter>().SingleAsync(m => m.RoomId == w.Room && m.UtilityType == type && m.IsActive);
                taskDate = Today;
                taskId = (await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
                    new MeterTaskInput(meter.Id, ReadingPurpose.Initial, taskDate, null)))).Id;
            }
            handoverDate ??= taskDate;
            Assert.Equal(handoverDate, taskDate);
            var reading = await ConfirmInitialTask(w, taskId, 100);
            readingIds.Add(reading.Id);
        }
        await PrepareHistoricalHandoverFixture(id);
        using var photo = new ByteArrayContent(Image()); photo.Headers.ContentType = new("image/png");
        var picture = await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "handover/evidence"), photo));
        var choices = await EmptyRoomHandoverChoices(w, id);
        var input = new HandoverInput(0, handoverDate!.Value, "SYNTHETIC room condition", "SYNTHETIC keys checklist", "", [], readingIds[0], readingIds[1], [picture.Id], choices.InventoryToken);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Staff, Path(id, "handover"), input with { EvidenceIds = [] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Staff, Path(id, "handover"), input with { ElectricityReadingId = readingIds[1] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Staff, Path(id, "handover"), input with { Date = Today.AddDays(1) })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Owner, Path(id, "handover"), input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(outside.Staff, Path(id, "handover"), input)).StatusCode);
        var first = await Success<HandoverView>(await Post(w.Staff, Path(id, "handover"), input)); Assert.Equal(1, first.Version);
        await using (var direct = fixture.Factory.Services.CreateAsyncScope())
        {
            var store = direct.ServiceProvider.GetFixturePersistence();
            var now = DateTimeOffset.UtcNow;
            if (store is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            {
                var forged = System.Text.Json.JsonSerializer.Serialize(new { status = 2, tenantConfirmedAt = now, staffConfirmedAt = now, tenantConfirmedBy = w.Tenant.Id, staffConfirmedBy = w.Staff.Id });
                var rejected = await Assert.ThrowsAsync<PostgresException>(() => store.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET handover=jsonb_set(handover,'{{current}}',(handover->'current')||CAST({forged} AS jsonb)) WHERE id={id}"));
                Assert.Equal("23514", rejected.SqlState);
            }
            else await Assert.ThrowsAsync<PostgresException>(() => store.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"ContractHandovers\" SET \"Status\"=2, \"TenantConfirmedAt\"={now}, \"StaffConfirmedAt\"={now}, \"TenantConfirmedBy\"={w.Tenant.Id}, \"StaffConfirmedBy\"={w.Staff.Id} WHERE \"ContractId\"={id}"));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Staff, Path(id, "handover/staff-confirmation"), new HandoverDecision(1, ""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(outside.Tenant, Path(id, "handover/tenant-confirmation"), new HandoverDecision(1, ""))).StatusCode);
        await Success<HandoverView>(await Post(w.Tenant, Path(id, "handover/disputes"), new HandoverDecision(1, "SYNTHETIC discrepancy")));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, Path(id, "handover/tenant-confirmation"), new HandoverDecision(1, ""))).StatusCode);
        using var correctedPhoto = new ByteArrayContent(Image()); correctedPhoto.Headers.ContentType = new("image/png");
        var replacement = await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "handover/evidence"), correctedPhoto));
        var second = await Success<HandoverView>(await Post(w.Staff, Path(id, "handover"), input with { Version = 1, RoomCondition = "SYNTHETIC corrected", EvidenceIds = [replacement.Id] })); Assert.Equal(2, second.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, Path(id, "handover/tenant-confirmation"), new HandoverDecision(1, ""))).StatusCode);
        await Success<HandoverView>(await Post(w.Tenant, Path(id, "handover/tenant-confirmation"), new HandoverDecision(2, "")));
        var confirmed = await Success<HandoverView>(await Post(w.Staff, Path(id, "handover/staff-confirmation"), new HandoverDecision(2, ""))); Assert.Equal("Confirmed", confirmed.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Staff, Path(id, "handover"), input with { Version = 2 })).StatusCode);
        Assert.Equal(5, (await Success<HandoverHistoryView[]>(await w.Owner.Client.GetAsync(Path(id, "handover/history")))).Length);
        Assert.Equal(Image(), await w.Tenant.Client.GetByteArrayAsync(Path(id, $"handover/evidence/{picture.Id}")));
        Assert.Equal(Image(), await w.Tenant.Client.GetByteArrayAsync(Path(id, $"handover/meter-evidence/{readingIds[0]}")));
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Tenant.Client.GetAsync(Path(id, $"handover/meter-evidence/{readingIds[0]}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Tenant.Client.GetAsync(Path(id, $"handover/evidence/{picture.Id}"))).StatusCode);
        var json = await w.Tenant.Client.GetStringAsync(Path(id, "handover")); Assert.DoesNotContain("objectKey", json, StringComparison.OrdinalIgnoreCase);
        await using var verify = fixture.Factory.Services.CreateAsyncScope(); var stored = verify.ServiceProvider.GetFixturePersistence();
        if (stored is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
        {
            var moveInTask = await stored.Set<OperationalTask>().SingleAsync(task =>
                task.ContractId == id && task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.AdHoc);
            Assert.Equal(MeterTaskStatus.Completed, moveInTask.MeterStatus);
            var transitions = await stored.Set<BHome.Domain.StaffOperations.OperationalTaskHistory>()
                .Where(entry => entry.TaskId == moveInTask.Id &&
                    (entry.Action == "MoveInSubmitted" || entry.Action == "MoveInCompleted"))
                .OrderBy(entry => entry.TaskVersion).ToArrayAsync();
            Assert.Equal(new[] { "MoveInSubmitted", "MoveInCompleted" }, transitions.Select(entry => entry.Action));
            Assert.All(transitions, entry => Assert.Equal(w.Staff.Id, entry.ActorId));
            Assert.Equal(transitions[0].TaskVersion + 1, transitions[1].TaskVersion);
            Assert.Equal("23514", (await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET handover=jsonb_set(handover,'{{current,version}}','3'::jsonb) WHERE id={id}"))).SqlState);
            Assert.NotEqual("42P01", (await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history='[]'::jsonb WHERE id={id}"))).SqlState);
            Assert.NotEqual("42P01", (await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM meter_readings WHERE id={readingIds[0]}"))).SqlState);
        }
        else
        {
            await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"ContractHandovers\" SET \"Version\"=3 WHERE \"ContractId\"={id}"));
            await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"ContractHandoverHistory\" WHERE \"ContractId\"={id}"));
            await Assert.ThrowsAsync<PostgresException>(() => stored.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM \"MeterReadings\" WHERE \"Id\"={readingIds[0]}"));
        }
        await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"), new TerminationInput(Today, "Synthetic moveout")));
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve")));
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/schedule"), new InspectionScheduleInput(DateTimeOffset.UtcNow.AddMinutes(1), w.Staff.Id)));
        await StartMoveOutTaskForInspection(w, id);
        var electricity = await FinalReading(w, id, UtilityType.Electricity); var water = await FinalReading(w, id, UtilityType.Water);
        using var finalPhoto = new ByteArrayContent(Image()); finalPhoto.Headers.ContentType = new("image/png");
        var finalFile = (await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), finalPhoto))).Id;
        var preparation = await Success<InspectionPreparation>(await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-preparation")));
        var inspected = await Success<MoveOutView>(await Post(w.Staff, Path(id, "move-out/inspection"), new InspectionInput(electricity, water, "Synthetic final inspection", [finalFile], [], "SYNTHETIC final condition", "Keys returned", InventoryToken: preparation.Inventory?.StateToken,
            RoomChecks: await PassedMoveOutRoomChecks(w.Staff, id), AccessItems: [new HandoverAccessItem("RoomKey", 0, "Returned")],
            KeyEvidenceIds: [await MoveOutPhoto(w.Staff, id)])));
        var comparison = Assert.Single((await w.Owner.Client.GetFromJsonAsync<FinalInspectionView[]>(Path(id, "move-out/inspections")))!);
        Assert.Equal("SYNTHETIC corrected", Assert.IsType<HandoverSnapshot>(comparison.Baseline).RoomCondition); Assert.Equal("SYNTHETIC final condition", comparison.Observed.RoomCondition);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "move-out/inspection-review"), new InspectionReviewInput(1, true, "Checked"))).StatusCode);
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/inspection-review"), new InspectionReviewInput(1, true, "Synthetic Owner confirmed", TenantException: true, TenantExceptionReason: "Synthetic Tenant unavailable; record exception explicitly")));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/inspection-review"), new InspectionReviewInput(1, true, "Cannot review twice"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Tenant.Client.GetAsync(Path(id, "move-out/inspections"))).StatusCode);
    }

    [Fact]
    public async Task ListRechecksEffectiveAssignmentsWithSameToken()
    {
        var w = await Setup(); var own = await Draft(w); var other = await Setup(); await Draft(other);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            db.RemoveRange(await db.StaffLocationAssignments.Where(a => a.StaffUserId == w.Staff.Id || a.StaffUserId == other.Staff.Id).ToArrayAsync());
            await db.SaveChangesAsync();
            db.Add(new StaffLocationAssignment(w.Location, w.Staff.Id, w.Owner.Id, Today.AddDays(-10), Today.AddDays(-1)));
            db.Add(new StaffLocationAssignment(other.Location, w.Staff.Id, w.Owner.Id, Today.AddDays(1), Today.AddDays(5)));
            await db.SaveChangesAsync();
        }
        var hidden = await Success<ContractPage>(await w.Staff.Client.GetAsync("/api/v1/contracts"));
        Assert.Empty(hidden.Items); Assert.Equal(0, hidden.TotalCount);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            db.Add(new StaffLocationAssignment(w.Location, w.Staff.Id, w.Owner.Id, Today, Today));
            await db.SaveChangesAsync();
        }
        // The same token immediately sees the newly effective server-side assignment.
        var visible = await Success<ContractPage>(await w.Staff.Client.GetAsync("/api/v1/contracts"));
        Assert.Equal(own, Assert.Single(visible.Items).Id);
    }

    [Fact]
    public async Task T01_T07_RealPersistenceTwoPartySignaturesActivationAndParallelReplay()
    {
        var w = await Setup(); var id = await Draft(w); await Signed(w, id); await Deposit(w, id);
        var key = Guid.NewGuid(); var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Post(w.Owner, Path(id, "activate"), key: key)));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        // Polling again is idempotent, including after activation; it cannot regress the contract.
        await Success<ContractView>(await Post(w.Tenant, Path(id, "signing/sync")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(ContractStatus.Active, (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(c => c.Id == w.Room)).Status);
        Assert.Equal(2, await db.Set<ContractSigning>().CountAsync(s => s.ContractId == id));
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == id && a.Event == "ContractActivated"));
        var file = await w.Tenant.Client.GetAsync(Path(id, "document")); Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Contains("TEST ONLY", Encoding.UTF8.GetString(await file.Content.ReadAsByteArrayAsync()));
        var response = await w.Staff.Client.GetAsync(Path(id)); var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("ObjectKey", json); Assert.DoesNotContain("ProviderUserId", json); Assert.DoesNotContain("CertificateChain", json);
    }
    [Fact]
    public async Task T02_T03_T04_T16_UnsignedUnderpaidAndWrongActorAreRejected()
    {
        var w = await Setup(); var id = await Draft(w); await Deposit(w, id, 100);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        await Signed(w, id); Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "activate"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "deposit-verifications"), new DepositInput("SYNTHETIC", 1, "test"))).StatusCode);
        var otherTenant = await User(Roles.Tenant); var otherStaff = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.Client.GetAsync(Path(id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStaff.Client.GetAsync(Path(id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.Client.GetAsync(Path(id, "document"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Factory.CreateClient().GetAsync(Path(id))).StatusCode);
    }
    [Fact]
    public async Task T05_CompetingActivationsHaveOneWinnerAndNoPartialRoomState()
    {
        var w = await Setup(); var one = await Draft(w); var two = await Draft(w);
        await Signed(w, one); await Signed(w, two); await Deposit(w, one); await Deposit(w, two);
        var replies = await Task.WhenAll(Post(w.Owner, Path(one, "activate")), Post(w.Owner, Path(two, "activate")));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(1, await db.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
    }
    [Fact]
    public async Task BankReferenceCannotBeAllocatedToTwoContractsEvenInParallel()
    {
        var a = await Setup(); var b = await Setup(); var one = await Draft(a); var two = await Draft(b);
        var deposit = new DepositInput("SYNTHETIC-SHARED-" + Guid.NewGuid(), 500, "Synthetic owner statement verification");
        var replies = await Task.WhenAll(Post(a.Owner, Path(one, "deposit-verifications"), deposit), Post(b.Owner, Path(two, "deposit-verifications"), deposit));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(1, await db.Set<DepositVerification>().CountAsync(d => d.BankTransactionReference == deposit.BankTransactionReference));
    }
    [Fact]
    public async Task T08_T09_RenewalPreservesSignedVersionRejectsDuplicateAndWaitsForEffectiveDate()
    {
        var w = await Setup(); var id = await Active(w);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today, 4000000, "TEST"))).StatusCode);
        var next = (await Success<ContractId>(await Post(w.Staff, Path(id, "renewals"), new RenewalInput(Today.AddYears(1), 4000000, "NEW TEST TERMS")))).Id;
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today.AddYears(2), 4000000, "OTHER"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(next, "activate"))).StatusCode);
        await Signed(w, next);
        // Time is a host clock, advanced only in the test host for this request.
        await using var advanced = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddScoped(sp => new ContractService(sp.GetRequiredService<IContractRepository>(), sp.GetRequiredService<ICurrentUser>(),
                sp.GetRequiredService<ResourceAccess>(), sp.GetRequiredService<IContractSigningProvider>(), sp.GetRequiredService<BHome.Application.Storage.IObjectStorage>(),
                sp.GetRequiredService<IContractFileStore>(), sp.GetRequiredService<IContractImageValidator>(), sp.GetRequiredService<IContractSettlementLedger>(),
                sp.GetRequiredService<IContractHoldingLedger>(), new FixedClock(DateTimeOffset.UtcNow.AddDays(31))))));
        var advancedOwner = new Actor(advanced.CreateClient(), w.Owner.Id);
        advancedOwner.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        await Success<ContractView>(await Post(advancedOwner, Path(next, "activate")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        var original = await db.Set<Contract>().SingleAsync(c => c.Id == id); var renewal = await db.Set<Contract>().SingleAsync(c => c.Id == next);
        Assert.Equal(ContractStatus.Superseded, original.Status); Assert.Equal(3000000, original.RentAmount); Assert.Equal(ContractStatus.Active, renewal.Status);
        Assert.Equal(4000000, renewal.RentAmount); Assert.Equal(2, await db.Set<ContractSigning>().CountAsync(s => s.ContractId == id));
        var versions = (await w.Tenant.Client.GetFromJsonAsync<ContractVersionView[]>(Path(next, "versions")))!;
        Assert.Equal(2, versions.Length); Assert.Contains(versions, c => c.Id == id && c.Status == "Superseded" && c.MonthlyRent == 3000000);
        Assert.Contains(versions, c => c.Id == next && c.PreviousContractId == id && c.Terms == "NEW TEST TERMS");
        var outsider = await User(Roles.Tenant); Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync(Path(next, "versions"))).StatusCode);
    }
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static byte[] Image()
    { using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White); return image.ImEncode(".png"); }
    private async Task<Guid> FinalReading(Workspace w, Guid contractId, UtilityType type)
    {
        Guid meter;
        Guid? initialTask = null;
        var compact24 = await UsesCompact24();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence(); var m = await db.Set<Meter>().SingleOrDefaultAsync(m => m.RoomId == w.Room && m.UtilityType == type && m.IsActive);
            if (m is null) { m = new Meter { RoomId = w.Room, Code = "SYNTHETIC-" + type, UtilityType = type, InstalledOn = Today.AddDays(-10) }; db.Add(m); await db.SaveChangesAsync(); }
            meter = m.Id;
            initialTask = await db.Set<OperationalTask>().Where(task => task.MeterId == meter && task.ContractId == (compact24 ? contractId : null) && task.Purpose == ReadingPurpose.Initial)
                .Select(task => (Guid?)task.Id).SingleOrDefaultAsync();
        }
        if (initialTask is null)
        {
            initialTask = (await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
                new MeterTaskInput(meter, ReadingPurpose.Initial, Today.AddDays(-10), null, compact24 ? contractId : null)))).Id;
        }
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            if (!await db.Set<MeterReading>().AnyAsync(reading => reading.TaskId == initialTask.Value))
                await ConfirmInitialTask(w, initialTask.Value, 100);
        }
        var taskId = (await Success<IdResult>(await w.Owner.Client.PostAsJsonAsync("/api/v1/capture/meter-tasks",
            new MeterTaskInput(meter, ReadingPurpose.Final, Today, null, contractId)))).Id;
        using var binary = new ByteArrayContent(Image()); binary.Headers.ContentType = new("image/png");
        var evidence = (await Success<IdResult>(await w.Staff.Client.PutAsync($"/api/v1/capture/meter-tasks/{taskId}/evidence", binary))).Id;
        var readingResult = await Success<ConfirmedReading>(await w.Staff.Client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{taskId}/confirm", new MeterConfirmation(true, 120, evidence)));
        var tasks = (await w.Staff.Client.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!;
        var summary = Assert.Single(tasks, x => x.Id == taskId);
        Assert.Equal(contractId, summary.ContractId); Assert.Equal(readingResult.Id, summary.ConfirmedReadingId);
        var outsider = await User(Roles.Staff);
        Assert.DoesNotContain((await outsider.Client.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks"))!, x => x.Id == taskId);
        return readingResult.Id;
    }
    [Theory]
    [InlineData(ContractStatus.Active, true)]
    [InlineData(ContractStatus.Expired, true)]
    [InlineData(ContractStatus.Terminated, false)]
    public async Task OtherMainContractKeepsRoomOccupiedUntilTermination(ContractStatus status, bool expected)
    {
        var w = await Setup();
        var id = await Active(w);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetFixturePersistence();
        var contract = await db.Set<Contract>().SingleAsync(c => c.Id == id);
        contract.Status = status;
        await db.SaveChangesAsync();

        var repository = scope.ServiceProvider.GetRequiredService<IContractRepository>();
        Assert.Equal(expected, await repository.HasOtherActiveContractsAsync(w.Room, Guid.NewGuid(), default));
        Assert.False(await repository.HasOtherActiveContractsAsync(w.Room, id, default));
    }

    [Fact]
    public async Task T10_T11_T12_T13_T14_InspectionFinalMetersPendingSettlementAndCompletedMoveOut()
    {
        var w = await Setup();
        if (await UsesCompact24()) await ConfigureMoveOutBillingAsync(w);
        var id = await Active(w); var termination = new TerminationInput(Today, "SYNTHETIC EARLY TERMINATION");
        var request = await Success<MoveOutView>(await Post(w.Tenant, Path(id, "termination-requests"), termination)); Assert.Equal("Requested", request.Status);
        Assert.Equal("Active", (await w.Tenant.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(id, "move-out/approve"))).StatusCode);
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/approve")));
        TaskView? moveOutTask = null;
        if (await UsesCompact24())
        {
            var tasks = await w.Staff.Client.GetFromJsonAsync<TaskPage<TaskView>>($"/api/v1/operational-tasks?locationId={w.Location}");
            var task = Assert.Single(tasks!.Items, item => item.Target?.ContractId == id && item.Title.StartsWith("Kiểm tra trả phòng"));
            Assert.Equal("Assigned", task.Status);
            Assert.Equal(w.Staff.Id, task.CurrentResponsibleStaffUserId);
            Assert.Null(task.RecordedStaffUserId);
            var outsiderStaff = await User(Roles.Staff);
            Assert.Equal(HttpStatusCode.NotFound,
                (await Post(outsiderStaff, $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Post(w.Tenant, $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version))).StatusCode);
            using var earlyPhoto = new ByteArrayContent(Image());
            earlyPhoto.Headers.ContentType = new("image/png");
            Assert.Equal(HttpStatusCode.Conflict,
                (await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), earlyPhoto)).StatusCode);
            var startKey = Guid.NewGuid();
            task = await Success<TaskView>(await Post(w.Staff,
                $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version), startKey));
            Assert.Equal("InProgress", task.Status);
            Assert.Equal(w.Staff.Id, task.RecordedStaffUserId);
            var replayed = await Success<TaskView>(await Post(w.Staff,
                $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version - 1), startKey));
            Assert.Equal(task.Version, replayed.Version);
            Assert.Equal(HttpStatusCode.Conflict,
                (await Post(w.Staff, $"/api/v1/operational-tasks/{task.Id}/start", new TaskAction(task.Version - 1))).StatusCode);
            moveOutTask = task;
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today, "Available"))).StatusCode);
        var assignment = (await w.Staff.Client.GetFromJsonAsync<MoveOutAssignment[]>("/api/v1/contracts/move-out-assignments"))!.Single(a => a.ContractId == id);
        Assert.Equal("Approved", assignment.Status); Assert.Equal(w.Room, assignment.RoomId); Assert.Null(assignment.ScheduledAt);
        var history = (await w.Owner.Client.GetFromJsonAsync<MoveOutHistoryView[]>(Path(id, "move-out/history")))!;
        Assert.Equal(2, history.Length); Assert.Equal("Approved", history[0].Action);
        var electricity = await FinalReading(w, id, UtilityType.Electricity); var water = await FinalReading(w, id, UtilityType.Water);
        var choices = await EmptyRoomHandoverChoices(w, id);
        var openingElectricity = choices.Readings.First(r => r.UtilityType == 0);
        var openingWater = choices.Readings.First(r => r.UtilityType == 1);
        await PrepareHistoricalHandoverFixture(id);
        using var openingPhoto = new ByteArrayContent(Image()); openingPhoto.Headers.ContentType = new("image/png");
        var openingFile = (await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "handover/evidence"), openingPhoto))).Id;
        await Success<HandoverView>(await Post(w.Staff, Path(id, "handover"), new HandoverInput(0, openingElectricity.Date,
            "Synthetic original room", "Synthetic original keys", "", [], openingElectricity.Id, openingWater.Id, [openingFile], choices.InventoryToken)));
        await Success<HandoverView>(await Post(w.Tenant, Path(id, "handover/tenant-confirmation"), new HandoverDecision(1, "Synthetic present")));
        await Success<HandoverView>(await Post(w.Staff, Path(id, "handover/staff-confirmation"), new HandoverDecision(1, "Synthetic checked")));
        using var photo = new ByteArrayContent(Image()); photo.Headers.ContentType = new("image/png");
        var evidence = (await Success<ContractId>(await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), photo))).Id;
        var preparation = await Success<InspectionPreparation>(await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-preparation")));
        var electricityPhotoPath = Path(id, $"move-out/meter-evidence/{electricity}");
        var waterPhotoPath = Path(id, $"move-out/meter-evidence/{water}");
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await w.Tenant.Client.GetAsync($"/api/v1/capture/readings/{electricity}/evidence")).StatusCode);
        var inspectedRooms = await PassedMoveOutRoomChecks(w.Staff, id, "cleanliness");
        var inspect = new InspectionInput(electricity, water, "Synthetic room and asset condition", [evidence],
            [], "Synthetic final room", "Synthetic returned keys", InventoryToken: preparation.Inventory?.StateToken,
            RoomChecks: inspectedRooms, AccessItems: [new HandoverAccessItem("RoomKey", 0, "")],
            KeyEvidenceIds: [await MoveOutPhoto(w.Staff, id)]);
        if (moveOutTask is not null)
        {
            var emptyDraft = await Success<MoveOutInspectionDraftView>(
                await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-draft")));
            using var draftRequest = new HttpRequestMessage(HttpMethod.Patch,
                Path(id, "move-out/inspection-draft"))
            {
                Content = JsonContent.Create(new MoveOutInspectionDraftWrite(emptyDraft.Version,
                    RoomCondition: inspect.RoomCondition, EvidenceIds: [evidence],
                    ElectricityReadingId: electricity, WaterReadingId: water))
            };
            draftRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var saved = await Success<MoveOutInspectionDraftView>(
                await w.Staff.Client.SendAsync(draftRequest));
            Assert.Equal(1, saved.Version);
            Assert.Equal(electricity, saved.ElectricityReadingId);
            Assert.Contains(evidence, saved.EvidenceIds);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Staff, Path(id, "move-out/inspection"), inspect with { WaterReadingId = electricity })).StatusCode);
        await Success<MoveOutView>(await Post(w.Staff, Path(id, "move-out/inspection"), inspect));
        foreach (var path in new[] { electricityPhotoPath, waterPhotoPath })
        {
            var tenantPhoto = await w.Tenant.Client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, tenantPhoto.StatusCode);
            Assert.Equal("application/octet-stream", tenantPhoto.Content.Headers.ContentType?.MediaType);
            Assert.Equal(Image(), await tenantPhoto.Content.ReadAsByteArrayAsync());
            Assert.Equal(HttpStatusCode.OK, (await w.Owner.Client.GetAsync(path)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await w.Staff.Client.GetAsync(path)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await fixture.Factory.CreateClient().GetAsync(electricityPhotoPath)).StatusCode);
        var unrelatedTenantForMeter = await User(Roles.Tenant);
        var unassignedStaffForMeter = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.NotFound,
            (await unrelatedTenantForMeter.Client.GetAsync(electricityPhotoPath)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await unassignedStaffForMeter.Client.GetAsync(electricityPhotoPath)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Tenant.Client.GetAsync(Path(id, $"move-out/meter-evidence/{openingElectricity.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Tenant.Client.GetAsync(Path(id, $"move-out/meter-evidence/{Guid.NewGuid()}"))).StatusCode);
        var otherContract = await Setup();
        var otherContractId = await Active(otherContract);
        Assert.Equal(HttpStatusCode.NotFound,
            (await otherContract.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Tenant.Client.GetAsync(Path(otherContractId,
                $"move-out/meter-evidence/{electricity}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await w.Owner.Client.GetAsync(Path(otherContractId,
                $"move-out/meter-evidence/{electricity}"))).StatusCode);
        // A stored evidence object is never trusted on its own: its live
        // metadata and SHA-256 must still match the immutable inspection.
        await using (var meterEvidenceScope = fixture.Factory.Services.CreateAsyncScope())
        {
            var meterEvidenceDb = meterEvidenceScope.ServiceProvider.GetFixturePersistence();
            var reading = await meterEvidenceDb.Set<MeterReading>().SingleAsync(r => r.Id == electricity);
            var proof = await meterEvidenceDb.Set<MeterEvidence>().SingleAsync(e => e.Id == reading.EvidenceId);
            var originalHash = proof.ImageHash;
            proof.ImageHash = new string('0', 64);
            await meterEvidenceDb.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.Conflict,
                (await w.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
            proof.ImageHash = originalHash;
            await meterEvidenceDb.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.OK,
                (await w.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
            var objectStorage = meterEvidenceScope.ServiceProvider.GetRequiredService<IObjectStorage>();
            var originalBytes = Image();
            var corruptedBytes = (byte[])originalBytes.Clone();
            corruptedBytes[^1] ^= 1;
            using (var altered = new MemoryStream(corruptedBytes))
                await objectStorage.PutAsync(proof.ObjectKey, altered, corruptedBytes.Length, "image/png", default);
            Assert.Equal(HttpStatusCode.Conflict,
                (await w.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
            using (var restored = new MemoryStream(originalBytes))
                await objectStorage.PutAsync(proof.ObjectKey, restored, originalBytes.Length, "image/png", default);
            Assert.Equal(HttpStatusCode.OK,
                (await w.Tenant.Client.GetAsync(electricityPhotoPath)).StatusCode);
        }
        var proposalPath = Path(id, "move-out/receivables/proposal");
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(proposalPath)).StatusCode);
        var unrelatedTenant = await User(Roles.Tenant);
        Assert.Equal(HttpStatusCode.NotFound, (await unrelatedTenant.Client.GetAsync(proposalPath)).StatusCode);
        if (await UsesCompact24())
        {
            var unreviewed = await Success<MoveOutChargeProposalPreview>(await w.Owner.Client.GetAsync(proposalPath));
            Assert.Contains(unreviewed.Items, item => item.Kind == "RoomCheck" &&
                item.RoomCheckCode == "cleanliness" && item.Chargeable);
        }
        async Task VerifyOwnerApprovedProposalFlow()
        {
            if (await UsesCompact24())
            {
                var preview = await Success<MoveOutChargeProposalPreview>(await w.Owner.Client.GetAsync(proposalPath));
                Assert.Contains(preview.Items, item => item.Kind == "RoomCheck" &&
                    item.RoomCheckCode == "cleanliness" && item.Chargeable);
                Assert.Contains(preview.Items, item => item.Kind == "Access" && item.AccessType == "RoomKey");
                var proposed = new MoveOutChargeProposalInput(preview.Reference, preview.InspectionId,
                    preview.InspectionVersion,
                    [new MoveOutProposedCharge("RoomCheck", null, "cleanliness", null, 125000, "Synthetic cleaning cost")],
                    "Synthetic proposal only; no ledger action");
                var proposalKey = Guid.NewGuid();
                var sent = await Success<MoveOutChargeProposal>(await Post(w.Owner, proposalPath, proposed, proposalKey));
                Assert.Equal(sent.Id, (await Success<MoveOutChargeProposal>(
                    await Post(w.Owner, proposalPath, proposed, proposalKey))).Id);
                Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, proposalPath,
                    proposed with { Note = "Different payload" }, proposalKey)).StatusCode);
                var tenantPreview = await Success<MoveOutChargeProposalPreview>(await w.Tenant.Client.GetAsync(proposalPath));
                Assert.Equal("PendingTenant", tenantPreview.Status);
                Assert.Equal(sent.Id, tenantPreview.LatestProposal?.Id);
                Assert.Equal(Guid.Empty, tenantPreview.LatestProposal!.OwnerUserId);
                Assert.Equal(Guid.Empty, tenantPreview.LatestProposal.OperationKey);
                var answer = new MoveOutChargeProposalFeedbackInput(sent.Id, preview.Reference,
                    false, "Synthetic disagreement",
                    [new MoveOutChargeProposalDisputedItem("RoomCheck", null, "cleanliness", null,
                    "Synthetic disputed cleaning charge")]);
                var answerKey = Guid.NewGuid();
                Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", answer with
                    {
                        DisputedItems = [new("RoomCheck", null, "nonexistent", null, "Invalid item")]
                    })).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", answer with
                    {
                        DisputedItems = [answer.DisputedItems![0], answer.DisputedItems![0]]
                    })).StatusCode);
                var feedback = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", answer, answerKey));
                Assert.False(feedback.Confirmed);
                Assert.Equal("Synthetic disputed cleaning charge", Assert.Single(feedback.DisputedItems!).Reason);
                Assert.Equal(feedback.Id, (await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", answer, answerKey))).Id);
                Assert.Equal("Disputed", (await Success<MoveOutChargeProposalPreview>(
                    await w.Owner.Client.GetAsync(proposalPath))).Status);
                Assert.Equal("cleanliness", Assert.Single((await Success<MoveOutChargeProposalPreview>(
                    await w.Owner.Client.GetAsync(proposalPath))).LatestProposal!.TenantFeedback!.DisputedItems!).RoomCheckCode);
                var revisedProposal = proposed with
                {
                    Items = [new MoveOutProposedCharge("RoomCheck", null, "cleanliness", null, 90000,
                "Synthetic revised cleaning cost")],
                    Note = "Synthetic revised proposal"
                };
                var revision = await Success<MoveOutChargeProposal>(await Post(w.Owner, proposalPath, revisedProposal));
                Assert.NotEqual(sent.Id, revision.Id);
                var revisedPreview = await Success<MoveOutChargeProposalPreview>(
                    await w.Tenant.Client.GetAsync(proposalPath));
                Assert.Equal(revision.Id, revisedPreview.LatestProposal?.Id);
                Assert.Equal("PendingTenant", revisedPreview.Status);
                Assert.Equal(feedback.Id, (await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", answer, answerKey))).Id);
                Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Tenant, proposalPath + "/tenant-feedback",
                    answer)).StatusCode);
                Assert.Empty((await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(
                    Path(id, "move-out/receivables")))).Receivables);
                // The revised inspection contains item-scoped photos. Acceptance
                // posts verified charges and offsets once, without another Owner
                // financial approval or pretending that a transfer occurred.
                var accepted = await Success<MoveOutChargeProposalFeedback>(await Post(w.Tenant,
                    proposalPath + "/tenant-feedback", new MoveOutChargeProposalFeedbackInput(
                        revision.Id, revisedPreview.Reference, true), Guid.NewGuid()));
                Assert.True(accepted.Confirmed);
                Assert.Equal("RefundEligible", accepted.Settlement?.Status);
                Assert.Equal(revision.SignedBalance, accepted.Settlement!.RefundAmount);
                Assert.Equal(0m, accepted.Settlement.PayableAmount);
                Assert.Null(accepted.Settlement?.PayableReceivableId);
                Assert.Equal("Accepted", (await Success<MoveOutChargeProposalPreview>(
                    await w.Tenant.Client.GetAsync(proposalPath))).Status);
                var posted = await Success<SettlementReceivablesView>(await w.Owner.Client.GetAsync(
                    Path(id, "move-out/receivables")));
                Assert.Equal(revision.TotalCharges, posted.Receivables.Sum(row => row.Charge.Amount));
                var damage = Assert.Single(posted.Receivables, row => row.Charge.Kind == "TenantDamage");
                Assert.Equal(90000m, damage.Charge.Amount);
                Assert.Equal("cleanliness", damage.Charge.RoomCheckCode);
                Assert.NotEmpty(damage.Charge.Evidence);
                Assert.All(posted.Receivables, row => Assert.Equal(0m, row.Outstanding));
            }
            else
            {
                // Receivable proposals are Compact24-only. The legacy persistence
                // scenario still verifies the entire physical move-out lifecycle.
                Assert.Equal(HttpStatusCode.ServiceUnavailable, (await w.Owner.Client.GetAsync(proposalPath)).StatusCode);
            }
        }
        if (moveOutTask is not null)
        {
            var submitted = (await w.Staff.Client.GetFromJsonAsync<TaskView>($"/api/v1/operational-tasks/{moveOutTask.Id}"))!;
            Assert.Equal("PendingVerification", submitted.Status);
        }
        var reviewedInspection = (await w.Owner.Client.GetFromJsonAsync<MoveOutView>(Path(id, "move-out")))!;
        Assert.Equal(inspect.Notes, reviewedInspection.InspectionNotes); Assert.Contains(evidence, reviewedInspection.EvidenceIds!);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today, "Available"))).StatusCode);
        if (moveOutTask is not null)
        {
            Assert.Equal(HttpStatusCode.Conflict,
                (await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-draft"))).StatusCode);
            var firstInspection = (await Success<FinalInspectionView[]>(
                await w.Owner.Client.GetAsync(Path(id, "move-out/inspections")))).First();
            await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/inspection-review"),
                new InspectionReviewInput(firstInspection.Version, false, "Synthetic reinspection required")));
            var reopened = await Success<MoveOutInspectionDraftView>(
                await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-draft")));
            Assert.Equal(2, reopened.Version);
            Assert.Empty(reopened.EvidenceIds);
            Assert.Null(reopened.ElectricityReadingId);
            Assert.Empty(reopened.RoomChecks);
            using (var staleRequest = new HttpRequestMessage(HttpMethod.Patch,
                Path(id, "move-out/inspection-draft"))
            {
                Content = JsonContent.Create(new MoveOutInspectionDraftWrite(reopened.Version, EvidenceIds: [evidence]))
            })
            {
                staleRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
                Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.Client.SendAsync(staleRequest)).StatusCode);
            }
            using var freshPhoto = new ByteArrayContent(Image());
            freshPhoto.Headers.ContentType = new("image/png");
            var freshEvidence = (await Success<ContractId>(
                await w.Staff.Client.PostAsync(Path(id, "move-out/evidence"), freshPhoto))).Id;
            inspect = inspect with
            {
                EvidenceIds = [freshEvidence],
                RoomChecks = await PassedMoveOutRoomChecks(w.Staff, id, "cleanliness"),
                KeyEvidenceIds = [await MoveOutPhoto(w.Staff, id)]
            };
            await Success<MoveOutView>(await Post(w.Staff, Path(id, "move-out/inspection"), inspect));
            var resubmitted = await w.Staff.Client.GetFromJsonAsync<TaskView>(
                $"/api/v1/operational-tasks/{moveOutTask.Id}");
            Assert.Equal("PendingVerification", resubmitted!.Status);
            var immutableInspections = await Success<FinalInspectionView[]>(
                await w.Owner.Client.GetAsync(Path(id, "move-out/inspections")));
            Assert.Equal(2, immutableInspections.Length);
            Assert.Contains(evidence, immutableInspections.Single(row => row.Version == 1).Observed.EvidenceIds);
            Assert.Contains(freshEvidence, immutableInspections.Single(row => row.Version == 2).Observed.EvidenceIds);
        }
        var finalInspection = (await Success<FinalInspectionView[]>(await w.Owner.Client.GetAsync(Path(id, "move-out/inspections")))).First();
        await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/inspection-review"),
            new InspectionReviewInput(finalInspection.Version, true, "Synthetic reviewed physical handover", TenantException: true, TenantExceptionReason: "Synthetic Tenant unavailable; record exception explicitly")));
        await VerifyOwnerApprovedProposalFlow();
        if (moveOutTask is not null)
        {
            var verified = (await w.Owner.Client.GetFromJsonAsync<TaskView>($"/api/v1/operational-tasks/{moveOutTask.Id}"))!;
            Assert.Equal("Completed", verified.Status);
            Assert.Equal(w.Owner.Id, verified.VerifiedByUserId);
            Assert.Equal(HttpStatusCode.Conflict,
                (await w.Staff.Client.GetAsync(Path(id, "move-out/inspection-draft"))).StatusCode);
        }
        var pending = await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Pending approved financial module")));
        Assert.Equal("PendingSettlement", pending.Status);
        Assert.Equal("PendingReview", pending.FinancialReviewStatus);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(Path(id, "move-out/settlement-history"))).StatusCode);
        var key = Guid.NewGuid(); var replies = await Task.WhenAll(Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today, "Available"), key), Post(w.Owner, Path(id, "move-out/complete"), new CompletionInput(Today, "Available"), key));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        fixture.Ledger.Resolved[id] = true; // TEST ONLY: check finance can continue after physical closure.
        var settledLater = await Success<MoveOutView>(await Post(w.Owner, Path(id, "move-out/settlement"), new SettlementInput("Synthetic verified settlement after handover")));
        Assert.Equal("Completed", settledLater.Status);
        Assert.Equal("OwnerReviewed", settledLater.FinancialReviewStatus);
        Assert.Equal(2, (await w.Owner.Client.GetFromJsonAsync<SettlementReviewView[]>(Path(id, "move-out/settlement-history")))!.Length);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(ContractStatus.Terminated, (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(2, await db.Set<MeterReading>().CountAsync(r => r.Id == electricity || r.Id == water));
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.TargetId == id && a.Event == "ContractTerminationCompleted"));
    }
    [Fact]
    public async Task T15_UnconfiguredRealProviderKeepsDurablePendingAndCannotActivate()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var unavailable = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped<IContractSigningProvider, UnavailableSigning>()));
        using var client = unavailable.CreateClient(); client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        var response = await Post(new(client, w.Owner.Id), Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("PendingSigning", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
    }
    private sealed class UnavailableSigning : IContractSigningProvider
    {
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
        public Task<string> RequestAsync(ContractSigning s, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
        public Task<SigningOutcome> PollAsync(ContractSigning s, byte[] p, CancellationToken t) => throw new IntegrationUnavailableException("TEST ONLY unavailable");
    }

    [Fact]
    public async Task SignedEvidenceTamperingRollsBackActivationAndDatabaseRejectsHistoryEdits()
    {
        var w = await Setup(); var id = await Draft(w); await Signed(w, id); await Deposit(w, id);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var signature = await db.Set<ContractSigning>().FirstAsync(s => s.ContractId == id);
        using var altered = new MemoryStream("TEST ONLY altered private object"u8.ToArray());
        await storage.PutAsync(signature.SignedObjectKey!, altered, altered.Length, "application/pdf", default);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Contracts\" SET \"MonthlyRent\" = 1 WHERE \"Id\" = {id}"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"ContractDepositVerifications\" SET \"Amount\" = 1 WHERE \"ContractId\" = {id}"));
    }

    [Fact]
    public async Task ExpiryAndRenewalCancellationPreserveCurrentContractAndOccupancy()
    {
        var w = await Setup(); var id = await Active(w);
        var next = (await Success<ContractId>(await Post(w.Owner, Path(id, "renewals"), new RenewalInput(Today.AddYears(1), 4000000, "SYNTHETIC renewal")))).Id;
        await Success<ContractView>(await Post(w.Owner, Path(next, "renewal-cancellation")));
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Owner, Path(id, "expiry-move-out"), new TerminationInput(Today.AddDays(30), "SYNTHETIC end of term"))).StatusCode);
        Assert.Equal("Active", (await w.Tenant.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.Equal(ContractStatus.Cancelled, (await db.Set<Contract>().SingleAsync(c => c.Id == next)).Status);
    }

    [Fact]
    public async Task InvalidInputAndChangedIdempotencyPayloadReturn400And409()
    {
        var w = await Setup(); var input = Input(w); var key = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.Client.PostAsJsonAsync("/api/v1/contracts", input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Owner, "/api/v1/contracts", input with { Terms = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(w.Owner, "/api/v1/contracts", input with { MonthlyRent = 1.5m })).StatusCode);
        await Success<ContractId>(await Post(w.Owner, "/api/v1/contracts", input, key));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, "/api/v1/contracts", input with { MonthlyRent = 4000000 }, key)).StatusCode);
    }

    // The holding allocation ledger is implemented by Compact24, not the source-schema host.
    internal async Task HoldingAllocationIsPersistedOnceAndCannotFundTwoMainContracts(bool depositFirst = true)
    {
        var w = await Setup();
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var setupDb = setup.ServiceProvider.GetFixturePersistence();
            var type = new RoomType { LocationId = w.Location, Name = "SYNTHETIC HOLDING TYPE", DefaultCapacity = 2 };
            setupDb.Add(type); (await setupDb.Set<Room>().SingleAsync(r => r.Id == w.Room)).RoomTypeId = type.Id;
            setupDb.Add(new BillingPolicy
            {
                LocationId = w.Location,
                RoomTypeId = type.Id,
                Category = ChargeCategory.Rent,
                ChargeCode = "RENT",
                Name = "Synthetic Holding Rent",
                Method = ChargingMethod.FixedPerRoomPerMonth,
                Rate = 3000000,
                EffectiveFrom = Today
            });
            await setupDb.SaveChangesAsync();
        }
        var quote = await ConfigureHoldingPolicyAsync(w, "SYNTHETIC protected Holding terms");
        var holdingInput = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, w.Resident, [w.Resident],
            quote.StartDate, quote.EndDate, quote.ExpiresAt, quote.HoldingDeposit, quote.Terms, 1, quote.SettingsVersion);
        var holding = (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts/holdings", holdingInput))).Id;
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(w.Staff, Path(holding, "holding-approval"), new HoldingDecisionInput("Not allowed"))).StatusCode);
        await Success<ContractView>(await Post(w.Owner, Path(holding, "holding-approval"), new HoldingDecisionInput("Owner reviewed and approved")));
        if (depositFirst)
        {
            await Deposit(w, holding, 3000000);
            Assert.Null((await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(holding)))!.PriceLockedAt);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(holding, "holding-activation"))).StatusCode);
            await Signed(w, holding);
        }
        else
        {
            await Signed(w, holding);
            Assert.Null((await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(holding)))!.PriceLockedAt);
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(holding, "holding-activation"))).StatusCode);
            await Deposit(w, holding, 3000000);
        }
        var activeHolding = await Success<ContractView>(await Post(w.Owner, Path(holding, "holding-activation")));
        Assert.Equal("Active", activeHolding.Status);
        Assert.Equal("SigningAndDepositCompleted", activeHolding.PriceLockTrigger);
        var conversionKey = Guid.NewGuid();
        Assert.True(new HoldingConversionInput(3000000).RequireInitialPayment);
        // This regression isolates legacy deposit-credit allocation. Full initial rent/fee collection
        // and automatic activation are exercised by AnonymousSigningTests' complete Sandbox chain.
        var conversion = new HoldingConversionInput(3000000, RequireInitialPayment: false);
        var main = (await Success<ContractId>(await Post(w.Staff, Path(holding, "holding-conversion"), conversion, conversionKey))).Id;
        Assert.Equal(main, (await Success<ContractId>(await Post(w.Staff, Path(holding, "holding-conversion"), conversion, conversionKey))).Id);
        Assert.Equal("Active", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(holding)))!.Status);
        var inherited = (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(main)))!;
        Assert.Equal(activeHolding.RequiredDeposit, inherited.RequiredDeposit);
        Assert.Equal(inherited.RequiredDeposit, inherited.AppliedHoldingDeposit);
        await Signed(w, main); await Success<ContractView>(await Post(w.Owner, Path(main, "activate")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        Assert.Equal(1, await db.Set<Contract>().CountAsync(c => c.HoldingContractId == holding));
        Assert.Equal(1, await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().CountAsync(a => a.SourceDepositContractId == holding));
        Assert.Equal(ContractStatus.Converted, (await db.Set<Contract>().SingleAsync(c => c.Id == holding)).Status);
        Assert.Equal(RoomStatus.Occupied, (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
    }

    [Fact]
    public async Task AmbiguousSigningRequestIsNotResentAndRecoveryDoesNotMeanSigned()
    {
        var w = await Setup(); var id = await Draft(w); var boundary = new AmbiguousSigning();
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IContractSigningProvider>(boundary)));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        var key = Guid.NewGuid(); var input = new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(actor, Path(id, "signing"), input, key)).StatusCode);
        var replay = await Success<SignatureView>(await Post(actor, Path(id, "signing"), input, key)); Assert.Equal("ManualReview", replay.Status);
        Assert.Equal(1, boundary.Requests);
        var recovery = await Success<ContractView>(await Post(w.Owner, Path(id, "signing/recover"), new SigningRecoveryInput("TEST-ONLY-RECOVERED-" + Guid.NewGuid())));
        Assert.Equal("PendingSigning", recovery.Status); Assert.Equal("Pending", recovery.Signatures.Single().Status);
        await Success<ContractView>(await Post(w.Owner, Path(id, "signing/sync")));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
    }
    private sealed class AmbiguousSigning : IContractSigningProvider
    {
        private readonly TestOnlySigningProvider inner = new(); public int Requests;
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => inner.PrepareAsync(d, c, p, t);
        public Task<string> RequestAsync(ContractSigning s, CancellationToken t) { Interlocked.Increment(ref Requests); throw new IntegrationUnavailableException("TEST ONLY ambiguous response"); }
        public Task<SigningOutcome> PollAsync(ContractSigning s, byte[] p, CancellationToken t) => inner.PollAsync(s, p, t);
    }

    [Fact]
    public async Task FailedSignatureCanBeRetriedWhileRetainingTheFailedAttempt()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IContractSigningProvider, RejectedSigning>()));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        await Success<SignatureView>(await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp)));
        await Success<ContractView>(await Post(actor, Path(id, "signing/sync")));
        await Success<SignatureView>(await Post(w.Owner, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp)));
        await Success<ContractView>(await Post(w.Owner, Path(id, "signing/sync")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        var attempts = await db.Set<ContractSigning>().Where(s => s.ContractId == id).ToArrayAsync();
        Assert.Single(attempts, s => s.Status == SignatureStatus.Failed); Assert.Single(attempts, s => s.Status == SignatureStatus.Signed);
    }
    private sealed class RejectedSigning : IContractSigningProvider
    {
        private readonly TestOnlySigningProvider inner = new();
        public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid c, byte[]? p, CancellationToken t) => inner.PrepareAsync(d, c, p, t);
        public Task<string> RequestAsync(ContractSigning s, CancellationToken t) => inner.RequestAsync(s, t);
        public Task<SigningOutcome> PollAsync(ContractSigning s, byte[] p, CancellationToken t) => Task.FromResult(new SigningOutcome("Failed"));
    }

    [Fact]
    public async Task UploadFailureLeavesDurableCleanupIntentAndNoDanglingSignatureReference()
    {
        var w = await Setup(); var id = await Draft(w);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetFixturePersistence();
        var realStorage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        await using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddScoped<IObjectStorage>(_ => new FailingStorage(realStorage))));
        var actor = new Actor(host.CreateClient(), w.Owner.Id); actor.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
        Assert.Equal(HttpStatusCode.InternalServerError, (await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.Otp))).StatusCode);
        Assert.Empty(await db.Set<ContractSigning>().Where(s => s.ContractId == id).ToArrayAsync());
        var intent = await db.Set<ContractFileUpload>().SingleAsync(f => f.RoomId == w.Room);
        await realStorage.CopyToAsync(intent.ObjectKey, Stream.Null, default);
        // The production cleanup processes 100 intents per pass. Shared test
        // databases can contain older successful uploads ahead of this one.
        var cutoff = DateTimeOffset.UtcNow.AddDays(2);
        var due = await db.Set<ContractFileUpload>().CountAsync(f => f.CleanupAfter <= cutoff);
        var runtime = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        for (var pass = 0; pass < (due + 99) / 100 &&
            await db.Set<ContractFileUpload>().AnyAsync(f => f.ObjectKey == intent.ObjectKey); pass++)
            await ContractFileCleanup.CleanupAsync(runtime, realStorage, cutoff, default);
        Assert.False(await db.Set<ContractFileUpload>().AnyAsync(f => f.RoomId == w.Room));
        await Assert.ThrowsAnyAsync<Exception>(() => realStorage.CopyToAsync(intent.ObjectKey, Stream.Null, default));
    }
    private sealed class FailingStorage(IObjectStorage inner) : IObjectStorage
    {
        public async Task PutAsync(string key, Stream data, long length, string contentType, CancellationToken t)
        { await inner.PutAsync(key, data, length, contentType, t); throw new IOException("TEST ONLY interrupted upload"); }
        public Task CopyToAsync(string key, Stream output, CancellationToken t) => inner.CopyToAsync(key, output, t);
        public Task DeleteAsync(string key, CancellationToken t) => inner.DeleteAsync(key, t);
    }

    [Fact]
    public async Task ProductionAdapterAndPdfSignerCompleteTwoPartyContractThroughApiWithSyntheticRemoteCa()
    {
        var w = await Setup();
        var id = (await Success<ContractId>(await Post(w.Staff, "/api/v1/contracts",
            Input(w) with { Terms = "Dữ liệu kiểm thử: Nguyễn Ánh; điều khoản từ bản chụp đã lưu." }))).Id;
        var email = new CapturedEmail();
        await using var host = fixture.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId,
                ["ContractSigning:Methods:Otp"] = "true"
            }));
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IContractSigningProvider>();
                s.AddScoped(typeof(IContractSigningProvider), fixture.ProductionSigningProviderType);
                s.RemoveAll<INotificationChannelProvider>();
                s.AddSingleton<INotificationChannelProvider>(email);
            });
        });
        foreach (var signer in new[] { w.Owner, w.Tenant })
        {
            var actor = new Actor(host.CreateClient(), signer.Id);
            actor.Client.DefaultRequestHeaders.Authorization = signer.Client.DefaultRequestHeaders.Authorization;
            var retired = await Post(actor, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.ViettelMySign));
            Assert.Equal(HttpStatusCode.BadRequest, retired.StatusCode);
            Assert.Contains("signing_method_invalid", await retired.Content.ReadAsStringAsync());
            var key = Guid.NewGuid();
            // What the signing screen shows first: the pages of the PDF to sign and the signer's own box.
            var layout = (await actor.Client.GetFromJsonAsync<SigningLayout>(Path(id, "signing/layout")))!;
            Assert.Equal(signer.Id == w.Owner.Id ? "Owner" : "Tenant", layout.Party);
            Assert.Equal(layout.PageCount, layout.Pages.Count);
            Assert.NotNull(layout.Suggested);
            var page = await actor.Client.GetAsync(Path(id, $"signing/pages/{layout.Suggested!.Page}?width=400"));
            page.EnsureSuccessStatusCode();
            Assert.Equal("image/png", page.Content.Headers.ContentType!.MediaType);
            Assert.Equal(HttpStatusCode.BadRequest, (await actor.Client.GetAsync(Path(id, $"signing/pages/{layout.PageCount + 1}"))).StatusCode);
            // The Owner signs in the suggested box; the Tenant moves the box and signs with text only.
            var isOwner = signer.Id == w.Owner.Id;
            var input = isOwner ? new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true)
                : new SigningInput(Guid.Empty, layout.Suggested with { Y = layout.Suggested.Y - 0.05 }, false, Method: SigningMethods.Otp);
            Assert.Equal(HttpStatusCode.BadRequest, (await Post(actor, Path(id, "signing"),
                input with { Placement = new SignaturePlacementInput(1, 0.9, 0.1, 0.3) }, Guid.NewGuid())).StatusCode);
            var requested = await Success<SignatureView>(await Post(actor, Path(id, "signing"), input, key));
            Assert.Equal(isOwner ? "Signed" : "Pending", requested.Status);
            var replay = await Success<SignatureView>(await Post(actor, Path(id, "signing"), input, key));
            Assert.Equal(requested.Id, replay.Id);
            ContractView signed;
            if (isOwner)
                signed = (await actor.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
            else
            {
                var otpMail = Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
                var code = otpMail.Title[(otpMail.Title.LastIndexOf(' ') + 1)..];
                signed = await Success<ContractView>(await Post(actor, Path(id, "signing/otp/confirm"), new SigningOtpConfirmation(code)));
            }
            Assert.Equal("Signed", Assert.Single(signed.Signatures, x => x.SignerUserId == signer.Id).Status);
        }
        Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
        await Deposit(w, id);
        await Success<ContractView>(await Post(w.Owner, Path(id, "activate")));
        var response = await w.Tenant.Client.GetAsync(Path(id, "document"));
        response.EnsureSuccessStatusCode();
        Assert.Equal("application/pdf", response.Content.Headers.ContentType!.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        using var document = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(bytes)));
        var signatures = new iText.Signatures.SignatureUtil(document);
        var fields = signatures.GetSignatureNames();
        Assert.Equal(2, fields.Count);
        Assert.All(fields, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(fields[^1]));
        var form = iText.Forms.PdfAcroForm.GetAcroForm(document, false);
        Assert.All(fields, name => Assert.True(form.GetField(name).GetWidgets()[0].GetRectangle().ToRectangle().GetWidth() > 50, "visible signature"));
        Assert.Equal(id.ToString(), document.GetDocumentInfo().GetMoreInfo("BHomeContractId"));
        Assert.Equal(ContractPdfRendererTests.TemplateId, document.GetDocumentInfo().GetMoreInfo("BHomeTemplateId"));
        Assert.Contains("Nguyễn Ánh", ContractPdfRendererTests.Text(document));
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(Path(id, "document"))).StatusCode);
    }

    [Fact]
    public async Task ActualAdapterCanContinueADemoPdfInProductionWithoutActivatingTheContract()
    {
        var w = await Setup(); var id = await Draft(w);
        var email = new CapturedEmail();
        using var key = System.Security.Cryptography.RSA.Create(2048);
        var certificateRequest = new System.Security.Cryptography.X509Certificates.CertificateRequest(
            "CN=BHOME CI Test Seal", key, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pkcs1);
        using var certificate = certificateRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        // Production rejects the Testing process-key fallback; use a disposable key for these test hosts.
        var otpSecret = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var sealPath = System.IO.Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(sealPath, certificate.Export(System.Security.Cryptography.X509Certificates.X509ContentType.Pkcs12));
            WebApplicationFactory<Program> Host(bool production) => fixture.Factory.WithWebHostBuilder(b =>
            {
                if (production) b.UseTestEnvironment("Production");
                b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ContractPdf:TemplateId"] = ContractPdfRendererTests.TemplateId,
                    ["ContractSigning:Methods:Otp"] = "true",
                    ["ContractSigning:Otp:Secret"] = otpSecret,
                    ["ContractSigning:Seal:PfxPath"] = sealPath
                }));
                b.ConfigureTestServices(s =>
                {
                    s.RemoveAll<IContractSigningProvider>();
                    s.AddScoped(typeof(IContractSigningProvider), fixture.ProductionSigningProviderType);
                    s.RemoveAll<INotificationChannelProvider>();
                    s.AddSingleton<INotificationChannelProvider>(email);
                });
            });
            await using var testingHost = Host(false);
            await using var productionHost = Host(true);
            var owner = new Actor(testingHost.CreateClient(), w.Owner.Id);
            owner.Client.DefaultRequestHeaders.Authorization = w.Owner.Client.DefaultRequestHeaders.Authorization;
            Assert.Equal("Signed", (await Success<SignatureView>(await Post(owner, Path(id, "signing"),
                new SigningInput(Guid.Empty, Method: SigningMethods.OwnerSession, Consent: true)))).Status);
            var productionTenant = new Actor(productionHost.CreateClient(), w.Tenant.Id);
            productionTenant.Client.DefaultRequestHeaders.Authorization = w.Tenant.Client.DefaultRequestHeaders.Authorization;
            var retired = await Post(productionTenant, Path(id, "signing"), new SigningInput(Guid.NewGuid(), Method: SigningMethods.ViettelMySign));
            Assert.Equal(HttpStatusCode.BadRequest, retired.StatusCode);
            Assert.Equal("Pending", (await Success<SignatureView>(await Post(productionTenant, Path(id, "signing"),
                new SigningInput(Guid.Empty, Method: SigningMethods.Otp)))).Status);
            Assert.Single(email.Sent, m => m.EventType == "CONTRACT_SIGNING_OTP");
            var contract = (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!;
            Assert.Equal("PendingSigning", contract.Status);
            Assert.Equal(2, contract.Signatures.Count);
            Assert.Contains(contract.Signatures, signature => signature.SignerUserId == w.Owner.Id && signature.Status == "Signed");
            Assert.Contains(contract.Signatures, signature => signature.SignerUserId == w.Tenant.Id && signature.Status == "Pending");
            Assert.Equal(HttpStatusCode.Conflict, (await Post(w.Owner, Path(id, "activate"))).StatusCode);
        }
        finally { File.Delete(sealPath); }
    }

    [Fact]
    public async Task CertificateDirectoryIsPrivateAndActualAdapterRejectsAnotherSignersCertificate()
    {
        var w = await Setup(); var id = await Draft(w); var ownerCert = Guid.NewGuid(); var tenantCert = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetFixturePersistence();
            foreach (var (certId, actorId) in new[] { (ownerCert, w.Owner.Id), (tenantCert, w.Tenant.Id) }) db.Add(new BHome.DigitalSigning.Domain.SigningCertificate
            {
                Id = certId,
                OwnerUserId = actorId,
                Provider = "viettel-mysign",
                ProviderUserId = "SYNTHETIC-SUBSCRIBER-" + certId,
                CredentialId = "SYNTHETIC-CREDENTIAL",
                SerialNumber = certId.ToString(),
                Subject = "CN=Synthetic",
                Issuer = "CN=Synthetic CA",
                ValidFrom = DateTimeOffset.UtcNow.AddDays(-1),
                ValidTo = DateTimeOffset.UtcNow.AddDays(10),
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }
        const string certificates = "/api/v1/digital-signing/certificates";
        // The retired directory is inaccessible even to the historical certificate owner.
        foreach (var actor in new[] { w.Owner, w.Tenant, w.Staff })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await actor.Client.GetAsync(certificates)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Post(actor, certificates + $"/{ownerCert}/lock", new { locked = true })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Post(actor, certificates + $"/{tenantCert}/lock", new { locked = false })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Post(actor, certificates, new { providerUserId = "SYNTHETIC-UNCONFIGURED", serialNumber = (string?)null })).StatusCode);
        }
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(certificates)).StatusCode);
        foreach (var certificate in new[] { ownerCert, tenantCert })
        {
            var retired = await Post(w.Owner, Path(id, "signing"), new SigningInput(certificate, Method: SigningMethods.ViettelMySign));
            Assert.Equal(HttpStatusCode.BadRequest, retired.StatusCode);
            Assert.Contains("signing_method_invalid", await retired.Content.ReadAsStringAsync());
        }
        Assert.Equal("Draft", (await w.Owner.Client.GetFromJsonAsync<ContractView>(Path(id)))!.Status);
        await using var verification = fixture.Factory.Services.CreateAsyncScope();
        var persisted = verification.ServiceProvider.GetFixturePersistence();
        Assert.False(await persisted.Set<ContractSigning>().AnyAsync(s => s.ContractId == id));
        Assert.Equal(2, await persisted.Set<BHome.DigitalSigning.Domain.SigningCertificate>().CountAsync(c => (c.Id == ownerCert || c.Id == tenantCert) && !c.Locked));
        Assert.Equal(0, await persisted.SecurityAudit.CountAsync(a => a.TargetId == ownerCert && (a.Event == "ContractCertificateLocked" || a.Event == "ContractCertificateUnlocked")));
    }
}

public sealed class ContractFixture : IAsyncLifetime
{
    private readonly CaptureFixture infrastructure = new();
    public ContractFixture() { }
    internal ContractFixture(CaptureFixture supplied) => infrastructure = supplied;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public TestSettlementLedger Ledger { get; } = new();
    public Type ProductionSigningProviderType { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await infrastructure.InitializeAsync();
        var testSigningKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
        Factory = infrastructure.Factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:SigningKey"] = testSigningKey, ["ContractSigning:Methods:Otp"] = "true", ["ContractWorkflow:SimulatedSigningEnabled"] = "false" }));
            b.ConfigureTestServices(s =>
        {
            ProductionSigningProviderType = typeof(ContractSigningRouter);
            s.RemoveAll<IContractSigningProvider>(); s.AddSingleton<IContractSigningProvider, TestOnlySigningProvider>();
            s.RemoveAll<IContractSettlementLedger>(); s.AddSingleton<IContractSettlementLedger>(Ledger);
        });
        });
    }
    public async Task DisposeAsync() { if (Factory is not null) await Factory.DisposeAsync(); await infrastructure.DisposeAsync(); }
}

// Explicitly a test boundary. These byte arrays are NOT valid electronic signatures or legal PDFs.
internal sealed class TestOnlySigningProvider : IContractSigningProvider
{
    public Task<SigningPreparation> PrepareAsync(ContractDocument d, Guid cert, byte[]? previous, CancellationToken t)
    {
        var source = previous ?? Encoding.UTF8.GetBytes("TEST ONLY contract " + d.SnapshotHash);
        return Task.FromResult(new SigningPreparation(source, source.Concat(" TEST ONLY prepared"u8.ToArray()).ToArray(), "test-field", "test-digest", "test-hash", "test-chain", "test-subscriber", "test-credential"));
    }
    public Task<string> RequestAsync(ContractSigning s, CancellationToken t) => Task.FromResult("TEST-ONLY-" + s.Id);
    public Task<SigningOutcome> PollAsync(ContractSigning s, byte[] prepared, CancellationToken t)
        => Task.FromResult(new SigningOutcome("Signed", prepared.Concat(" TEST ONLY verified boundary"u8.ToArray()).ToArray()));
}
public sealed class TestSettlementLedger : IContractSettlementLedger
{
    public ConcurrentDictionary<Guid, bool> Resolved { get; } = new();
    public Task<SettlementLedgerState?> ReadAsync(Guid id, Guid e, Guid w, CancellationToken t) =>
        Task.FromResult<SettlementLedgerState?>(Resolved.GetValueOrDefault(id) ? new(true, true, true, "TEST-ONLY-LEDGER-" + id) : null);
}
