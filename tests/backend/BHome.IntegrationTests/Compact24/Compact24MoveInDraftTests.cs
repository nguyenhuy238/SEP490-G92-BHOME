using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private async Task<HandoverDraftView> StartRealMoveInTask(HttpClient staff, IServiceProvider services,
        Guid id, Guid assignedStaff)
    {
        var route = $"/api/v1/contracts/{id}/handover/draft";
        var initial = (await staff.GetFromJsonAsync<HandoverDraftView>(route))!;
        if (initial.MoveInTask is null)
        {
            // Legacy synthetic helper seeds an Active contract without a move-in
            // task. Add only its AdHoc task, then start through the REAL API.
            await using var scope = services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var contract = await db.Set<Contract>().Include(c => c.Room).SingleAsync(c => c.Id == id);
            var task = new OperationalTask
            {
                Kind = OperationalTaskKind.AdHoc,
                RequiredLocationId = contract.Room.LocationId,
                ContractId = id,
                TargetRoomId = contract.RoomId,
                TargetLabel = contract.Room.RoomNumber,
                TaskTitle = "Kiểm tra bàn giao test",
                Requirements = "Staff kiểm tra hiện trạng và ảnh thật",
                MeterStatus = MeterTaskStatus.Assigned,
                AssignedStaffUserId = assignedStaff,
                AssignedAt = DateTimeOffset.UtcNow
            };
            db.Entry(task).Property(x => x.Id).CurrentValue =
                new Guid(SHA256.HashData(Encoding.UTF8.GetBytes($"contract-move-in:{id:N}")).AsSpan(0, 16));
            db.Add(task);
            await db.SaveChangesAsync();
            initial = (await staff.GetFromJsonAsync<HandoverDraftView>(route))!;
        }
        Assert.NotNull(initial.MoveInTask);
        Assert.Equal("Assigned", initial.MoveInTask.Status);
        Assert.False(initial.MoveInTask.CanInspect);
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/operational-tasks/{initial.MoveInTask.Id}/start")
        { Content = JsonContent.Create(new TaskAction(initial.MoveInTask.Version)) };
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var started = await Read<TaskView>(await staff.SendAsync(request));
        Assert.Equal("InProgress", started.Status);
        var refreshed = (await staff.GetFromJsonAsync<HandoverDraftView>(route))!;
        Assert.NotNull(refreshed.MoveInTask);
        Assert.Equal("InProgress", refreshed.MoveInTask.Status);
        Assert.True(refreshed.MoveInTask.CanInspect);
        Assert.Equal(initial.Version, refreshed.Version); // Task Start must not mutate Draft.
        return refreshed;
    }

    [CompactPostgresFact]
    public async Task OverlappingMainDraftsCreateOnlyOnePhysicalMoveInTask()
    {
        var w = await Seed(); using var host = Host();
        var residentIds = new[] { Guid.NewGuid(), Guid.NewGuid() };
        await using (var setup = host.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            foreach (var id in residentIds)
            {
                var resident = new Resident
                {
                    RoomId = w.Room,
                    OwnerUserId = w.Owner.Id,
                    DisplayLabel = "Move-in dedup test",
                    VerificationStatus = IdentityVerificationStatus.Verified
                };
                db.Entry(resident).Property(x => x.Id).CurrentValue = id;
                db.Add(resident);
            }
            await db.SaveChangesAsync();
        }
        async Task<Guid> Create(Guid residentId)
        {
            await using var scope = host.Services.CreateAsyncScope();
            var repository = scope.ServiceProvider.GetRequiredService<IContractRepository>();
            var contract = new Contract
            {
                RoomId = w.Room,
                OwnerSignerId = w.Owner.Id,
                RepresentativeResidentId = residentId,
                Kind = ContractKind.Main,
                Status = ContractStatus.Draft,
                StartDate = Today.AddDays(2),
                EndDate = Today.AddYears(1),
                RentAmount = 2000000,
                RequiredDeposit = 3000000,
                Terms = "Synthetic move-in dedup test",
                SnapshotHashOrEmpty = Guid.NewGuid().ToString("N")
            };
            return await repository.InTransactionAsync(w.Room, () =>
            {
                repository.Add(contract);
                repository.Add(new ContractResident
                {
                    ContractId = contract.Id,
                    ResidentId = residentId,
                    Role = ResidentType.Representative,
                    ResidenceFrom = contract.StartDate
                });
                return Task.FromResult(contract.Id);
            }, default);
        }
        var ids = await Task.WhenAll(residentIds.Select(Create));
        await using var check = host.Services.CreateAsyncScope();
        var readDb = check.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var jobs = await readDb.Set<OperationalTask>().AsNoTracking()
            .Where(x => x.ContractId != null && ids.Contains(x.ContractId.Value) && x.MeterStatus != MeterTaskStatus.Cancelled)
            .ToArrayAsync();
        Assert.Empty(jobs);
    }

    [CompactPostgresFact]
    public async Task CreatingMainContractWithinExistingTransactionAutomaticallyPersistsOneDraftWithoutChangingCreationApi()
    {
        var w = await Seed(); using var host = Host();
        await using (var setup = host.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            db.Add(new Meter
            {
                RoomId = w.Room,
                UtilityType = UtilityType.Electricity,
                Code = "DRAFT-TEST-E",
                InstalledOn = Today.AddDays(-1)
            });
            db.Add(new Meter
            {
                RoomId = w.Room,
                UtilityType = UtilityType.Water,
                Code = "DRAFT-TEST-W",
                InstalledOn = Today.AddDays(-1)
            });
            await db.SaveChangesAsync();
        }
        var contract = new Contract
        {
            RoomId = w.Room,
            OwnerSignerId = w.Owner.Id,
            TenantUserId = w.Tenant.Id,
            Kind = ContractKind.Main,
            Status = ContractStatus.Draft,
            StartDate = Today.AddDays(2),
            EndDate = Today.AddYears(1),
            RentAmount = 2000000,
            RequiredDeposit = 3000000,
            Terms = "Synthetic contract used only for draft handover integration test",
            SnapshotHashOrEmpty = "synthetic-signed-terms-hash"
        };
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var resident = new Resident
            {
                RoomId = w.Room,
                OwnerUserId = w.Owner.Id,
                TenantUserId = w.Tenant.Id,
                DisplayLabel = "Contract draft renter",
                VerificationStatus = BHome.Domain.TenantContracts.IdentityVerificationStatus.Verified
            };
            contract.RepresentativeResidentId = resident.Id;
            db.Add(resident); await db.SaveChangesAsync();
            var repository = scope.ServiceProvider.GetRequiredService<IContractRepository>();
            await repository.InTransactionAsync(w.Room, () =>
            {
                repository.Add(contract);
                repository.Add(new ContractResident
                {
                    ContractId = contract.Id,
                    ResidentId = resident.Id,
                    Role = BHome.Domain.TenantContracts.ResidentType.Representative,
                    ResidenceFrom = contract.StartDate
                });
                return Task.FromResult(contract.Id);
            }, default);
            Assert.Empty(await db.Set<OperationalTask>().Where(task => task.ContractId == contract.Id).ToArrayAsync());
            Assert.False(await db.Database.SqlQuery<bool>($"SELECT handover->'preparation' IS NOT NULL AS \"Value\" FROM contracts WHERE id={contract.Id}").SingleAsync());
            // Simulate the persisted state reached by the independently tested activation service.
            await repository.InTransactionAsync(w.Room, async () =>
            {
                // The strict runtime repository tracks its own native mutation;
                // saving the separate archive fixture would not persist this contract.
                var loaded = await repository.FindAsync(contract.Id, default) ?? throw new InvalidOperationException();
                loaded.Status = ContractStatus.Active;
                loaded.StartDate = Today;
                loaded.ActivatedAt = DateTimeOffset.UtcNow;
                loaded.ActivatedByUserId = w.Owner.Id;
                loaded.Room.Status = RoomStatus.Occupied;
                return true;
            }, default);
            var handovers = scope.ServiceProvider.GetRequiredService<IContractHandoverRepository>();
            // Repeated preparation must remain idempotent after activation.
            for (var attempt = 0; attempt < 2; attempt++)
                await repository.InTransactionAsync(w.Room, async () =>
                {
                    var active = await repository.FindAsync(contract.Id, default) ?? throw new InvalidOperationException();
                    await handovers.EnsureMoveInTaskAsync(active, w.Owner.Id, DateTimeOffset.UtcNow, default);
                    return true;
                }, default);
            var json = await db.Database.SqlQuery<string>($"""
                SELECT (handover->'preparation')::text AS "Value"
                FROM contracts WHERE id={contract.Id}
                """).SingleAsync();
            Assert.Contains("synthetic-signed-terms-hash", json);
            Assert.Contains("\"version\": 1", json);
            // Activation populates exactly one handover, inventory and the
            // contract-scoped initial electricity/water tasks.
            var tasks = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.ContractId == contract.Id).ToArrayAsync();
            Assert.Equal(4, tasks.Length);
            Assert.Equal(2, tasks.Count(task => task.MeterId is not null && task.Purpose == ReadingPurpose.Initial));
            Assert.Single(tasks, task => task.TargetRoomId == w.Room && task.Kind == OperationalTaskKind.AdHoc);
            Assert.Single(tasks, task => task.TargetRoomId == w.Room && task.Kind == OperationalTaskKind.MoveInInventory);
        }
        using var owner = await Client(w.Owner, host);
        var read = await owner.GetFromJsonAsync<HandoverDraftView>($"/api/v1/contracts/{contract.Id}/handover/draft");
        Assert.NotNull(read);
        Assert.Equal(1, read.Version);
        Assert.Equal("Draft", read.Status);
        Assert.Equal(contract.RentAmount, read.MonthlyRent);
        Assert.Equal(contract.RequiredDeposit, read.RequiredDeposit);
        Assert.Equal(contract.Terms, read.Terms);
        Assert.DoesNotContain("contract_active", read.Missing);
        // The Owner inbox lists actual persisted handover preparations without
        // forcing a Location -> Room -> Contract drilldown. Filters apply before
        // pagination and a tenant cannot browse the Owner's workspace.
        var inboxByRoom = await owner.GetFromJsonAsync<HandoverInboxPage>(
            $"/api/v1/contracts/handovers?pageSize=1&locationId={w.Location}&room={Uri.EscapeDataString(read.RoomNumber)}&status=Draft");
        Assert.NotNull(inboxByRoom);
        Assert.Equal(1, inboxByRoom.PageSize);
        Assert.Contains(inboxByRoom.Items, row => row.ContractId == contract.Id &&
            row.Status == "Draft" && row.LocationId == w.Location);
        Assert.True(inboxByRoom.TotalCount >= inboxByRoom.Items.Count);
        var inboxFiltered = await owner.GetFromJsonAsync<HandoverInboxPage>(
            $"/api/v1/contracts/handovers?room={Uri.EscapeDataString(read.RoomNumber)}&status=Ready");
        Assert.DoesNotContain(inboxFiltered!.Items, row => row.ContractId == contract.Id);
        var staffStage = await owner.GetFromJsonAsync<HandoverInboxPage>(
            $"/api/v1/contracts/handovers?pageSize=1&locationId={w.Location}&roomId={w.Room}&stage=Staff");
        Assert.Contains(staffStage!.Items, row => row.ContractId == contract.Id);
        var tenantStage = await owner.GetFromJsonAsync<HandoverInboxPage>(
            $"/api/v1/contracts/handovers?locationId={w.Location}&roomId={w.Room}&stage=Tenant");
        Assert.Equal(0, tenantStage!.TotalCount);
        var roomOptions = await owner.GetFromJsonAsync<ContractChoice[]>($"/api/v1/contracts/handovers/rooms?locationId={w.Location}");
        Assert.Contains(roomOptions!, room => room.Id == w.Room && room.Label == read.RoomNumber);
        Assert.Empty((await owner.GetFromJsonAsync<ContractChoice[]>($"/api/v1/contracts/handovers/rooms?locationId={Guid.NewGuid()}"))!);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync($"/api/v1/contracts/handovers?roomId={w.Room}&stage=Staff")).StatusCode);
        using var staff = await Client(w.Staff, host);
        using var tenantForInbox = await Client(w.Tenant, host);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenantForInbox.GetAsync($"/api/v1/contracts/handovers/rooms?locationId={w.Location}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await tenantForInbox.GetAsync("/api/v1/contracts/handovers")).StatusCode);
        var beforeStart = (await staff.GetFromJsonAsync<HandoverDraftView>(
            $"/api/v1/contracts/{contract.Id}/handover/draft"))!;
        Assert.NotNull(beforeStart.MoveInTask);
        Assert.Equal("Assigned", beforeStart.MoveInTask.Status);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, contract.Id, "handover/draft",
                new HandoverDraftWrite(read.Version, RoomCondition: "Chưa bắt đầu"))).StatusCode);
        using (var prematurePhoto = new ByteArrayContent(ReviewEvidenceImage()))
        {
            prematurePhoto.Headers.ContentType = new("image/png");
            Assert.Equal(HttpStatusCode.Conflict,
                (await staff.PostAsync($"/api/v1/contracts/{contract.Id}/handover/draft/evidence",
                    prematurePhoto)).StatusCode);
        }
        var working = await StartRealMoveInTask(staff, host.Services, contract.Id, w.Staff.Id);
        Assert.Equal(read.Version, working.Version);
        // Both contract opening values can be corrected during the working
        // handover, with a fresh photograph and the exact current task version.
        var meterTasks = (await staff.GetFromJsonAsync<BHome.Application.Ocr.MeterTaskSummary[]>(
            "/api/v1/capture/meter-tasks"))!.Where(task => task.ContractId == contract.Id && task.Purpose == ReadingPurpose.Initial).ToArray();
        Assert.Equal(2, meterTasks.Length);
        foreach (var meterTask in meterTasks)
        {
            var path = $"/api/v1/capture/meter-tasks/{meterTask.Id}";
            using var firstPhoto = new ByteArrayContent(ReviewEvidenceImage()); firstPhoto.Headers.ContentType = new("image/png");
            var proof = await Read<BHome.Application.Ocr.IdResult>(await staff.PutAsync(path + "/evidence", firstPhoto));
            var first = await Read<BHome.Application.Ocr.ConfirmedReading>(await staff.PostAsJsonAsync(path + "/confirm",
                new BHome.Application.Ocr.MeterConfirmation(true, 100, proof.Id)));
            var detail = (await staff.GetFromJsonAsync<BHome.Application.Ocr.MeterTaskSummary>(path))!;
            Assert.True(detail.CanCorrect);
            Assert.Null(detail.CorrectionLockReason);
            using var replacementPhoto = new ByteArrayContent(ReviewEvidenceImage()); replacementPhoto.Headers.ContentType = new("image/png");
            var replacement = await Read<BHome.Application.Ocr.IdResult>(await staff.PutAsync(path + "/evidence", replacementPhoto));
            Assert.NotEqual(proof.Id, replacement.Id);
            var corrected = await Read<BHome.Application.Ocr.ConfirmedReading>(await staff.PostAsJsonAsync(path + "/confirm",
                new BHome.Application.Ocr.MeterConfirmation(true, 101, replacement.Id, detail.Version)));
            Assert.Equal(first.Id, corrected.Id);
            Assert.Equal(101, corrected.ConfirmedValue);
            Assert.Null(corrected.Consumption);
            Assert.Equal(MeterReadingStatus.Corrected, corrected.Status);
        }
        foreach (var input in new[]
        {
            new HandoverDraftWrite(read.Version, RoomCondition: "Thiếu ảnh tổng quan"),
            new HandoverDraftWrite(read.Version, RoomCondition: ""),
            new HandoverDraftWrite(read.Version, RoomChecks: [new HandoverRoomCheck(
                HandoverRoomChecklist.RequiredCodes[0], "Passed", null, [])]),
            new HandoverDraftWrite(read.Version, AccessItems: [new HandoverAccessItem("RoomKey", 2, "")])
        })
            Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(staff, contract.Id,
                "handover/draft", input)).StatusCode);
        using (var photo = new ByteArrayContent(ReviewEvidenceImage()))
        {
            photo.Headers.ContentType = new("image/png");
            var uploaded = await Read<ContractId>(await staff.PostAsync(
                $"/api/v1/contracts/{contract.Id}/handover/draft/evidence", photo));
            var prepared = await Read<HandoverDraftView>(await HandoverPost(staff, contract.Id,
                "handover/draft", new HandoverDraftWrite(read.Version,
                    RoomCondition: "", EvidenceIds: [uploaded.Id])));
            Assert.Contains(uploaded.Id, prepared.EvidenceIds);
            Assert.Equal("", prepared.RoomCondition);
            Assert.DoesNotContain("room_summary_evidence", prepared.Missing);
            var notApplicable = await Read<HandoverDraftView>(await HandoverPost(staff, contract.Id,
                "handover/draft", new HandoverDraftWrite(prepared.Version,
                    RoomChecks: [new HandoverRoomCheck(HandoverRoomChecklist.RequiredCodes[0], "NotApplicable", null, [])])));
            Assert.Contains(notApplicable.RoomChecks!, check => check.Status == "NotApplicable" && check.EvidenceIds.Length == 0);
            Assert.DoesNotContain("room_check_evidence", notApplicable.Missing);
            var authorized = await owner.GetByteArrayAsync(
                $"/api/v1/contracts/{contract.Id}/handover/draft/evidence/{uploaded.Id}");
            Assert.Equal(ReviewEvidenceImage(), authorized);
            Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(
                $"/api/v1/contracts/{contract.Id}/handover/draft/evidence/{Guid.NewGuid()}")).StatusCode);
        }
        // Even after an independently validated activation, the original Staff
        // handover POST cannot skip the new Owner Ready and Tenant approval.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var activated = await db.Set<Contract>().SingleAsync(c => c.Id == contract.Id);
            activated.Status = ContractStatus.Active;
            activated.ActivatedByUserId = w.Owner.Id;
            activated.ActivatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        }
        var legacy = await HandoverPost(staff, contract.Id, "handover", new HandoverInput(
            0, Today, "Phòng tốt", "Hai chìa khóa", "", [], Guid.Empty, Guid.Empty, []));
        Assert.Equal(HttpStatusCode.Conflict, legacy.StatusCode);
        Assert.Contains("handover_draft_workflow_required", await legacy.Content.ReadAsStringAsync());
    }

    [CompactPostgresFact]
    public async Task HistoricalLegacyHandoverRemainsReadableWithoutCreatingAnOverlappingDraft()
    {
        var w = await Seed(); using var host = Host();
        var seeded = await SeedAssetHandover(w, host.Services, configured: 0, checkedGroups: 0);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var handover = scope.ServiceProvider.GetRequiredService<IContractHandoverRepository>();
            var contract = await db.Set<Contract>().Include(c => c.Room)
                .SingleAsync(c => c.Id == seeded.Contract);
            var readings = (await handover.ReadingsAsync(contract.Id, contract.RoomId,
                contract.StartDate, default)).OrderBy(r => r.UtilityType).ToArray();
            var snapshot = new HandoverSnapshot(Today, contract.Room.RoomNumber,
                "Phòng bàn giao từ quy trình cũ", "2 chìa khóa", "", [], readings[0], readings[1], []);
            db.Add(new ContractHandover
            {
                ContractId = contract.Id,
                Status = ContractHandoverStatus.Draft,
                Snapshot = JsonSerializer.Serialize(snapshot),
                ElectricityReadingId = readings[0].Id,
                WaterReadingId = readings[1].Id
            });
            await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract;
        Assert.Equal(HttpStatusCode.NotFound,
            (await owner.GetAsync($"/api/v1/contracts/{id}/handover/draft")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await tenant.GetAsync($"/api/v1/contracts/{id}/handover/draft/pdf")).StatusCode);
        var existing = (await tenant.GetFromJsonAsync<HandoverView>($"/api/v1/contracts/{id}/handover"))!;
        Assert.Equal("Draft", existing.Status);
        Assert.Equal("Phòng bàn giao từ quy trình cũ", existing.Snapshot.RoomCondition);
    }

}
