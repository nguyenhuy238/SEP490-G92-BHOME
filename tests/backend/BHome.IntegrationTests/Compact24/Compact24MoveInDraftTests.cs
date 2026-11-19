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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var contract = await db.Set<Contract>().Include(c => c.Room).SingleAsync(c => c.Id == id);
            var task = new OperationalTask
            {
                Kind = OperationalTaskKind.AdHoc,
                LocationId = contract.Room.LocationId,
                ContractId = id,
                TargetRoomId = contract.RoomId,
                TargetLabel = contract.Room.RoomNumber,
                Title = "Kiểm tra bàn giao test",
                Requirements = "Staff kiểm tra hiện trạng và ảnh thật",
                Status = MeterTaskStatus.Assigned,
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
    public async Task CreatingMainContractWithinExistingTransactionAutomaticallyPersistsOneDraftWithoutChangingCreationApi()
    {
        var w = await Seed(); using var host = Host();
        await using (var setup = host.Services.CreateAsyncScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
            MonthlyRent = 2000000,
            RequiredDeposit = 3000000,
            Terms = "Synthetic contract used only for draft handover integration test",
            SnapshotHash = "synthetic-signed-terms-hash"
        };
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
            var json = await db.Database.SqlQuery<string>($"""
                SELECT (handover->'preparation')::text AS "Value"
                FROM contracts WHERE id={contract.Id}
                """).SingleAsync();
            Assert.Contains("synthetic-signed-terms-hash", json);
            Assert.Contains("\"version\": 1", json);
            // Creating the contract must also populate the Staff's move-in and
            // contract-scoped initial electricity/water tasks before activation.
            var tasks = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.ContractId == contract.Id).ToArrayAsync();
            Assert.Equal(3, tasks.Length);
            Assert.Equal(2, tasks.Count(task => task.MeterId is not null && task.Purpose == ReadingPurpose.Initial));
            Assert.Single(tasks, task => task.TargetRoomId == w.Room);
        }
        using var owner = await Client(w.Owner, host);
        var read = await owner.GetFromJsonAsync<HandoverDraftView>($"/api/v1/contracts/{contract.Id}/handover/draft");
        Assert.NotNull(read);
        Assert.Equal(1, read.Version);
        Assert.Equal("Draft", read.Status);
        Assert.Equal(contract.MonthlyRent, read.MonthlyRent);
        Assert.Equal(contract.RequiredDeposit, read.RequiredDeposit);
        Assert.Equal(contract.Terms, read.Terms);
        Assert.Contains("contract_active", read.Missing);
        using var staff = await Client(w.Staff, host);
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
        using (var photo = new ByteArrayContent(ReviewEvidenceImage()))
        {
            photo.Headers.ContentType = new("image/png");
            var uploaded = await Read<ContractId>(await staff.PostAsync(
                $"/api/v1/contracts/{contract.Id}/handover/draft/evidence", photo));
            var prepared = await Read<HandoverDraftView>(await HandoverPost(staff, contract.Id,
                "handover/draft", new HandoverDraftWrite(read.Version,
                    RoomCondition: "Đã kiểm tra mặt sàn", EvidenceIds: [uploaded.Id])));
            Assert.Contains(uploaded.Id, prepared.EvidenceIds);
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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

    [CompactPostgresFact]
    public async Task DraftHandoverRequiresOwnerReadyAndVersionedTenantCorrectionThenStoresFinalPdf()
    {
        var w = await Seed(); using var host = Host();
        var seeded = await SeedAssetHandover(w, host.Services, configured: 1, checkedGroups: 1);
        var contractId = seeded.Contract;
        var route = $"/api/v1/contracts/{contractId}/handover/draft";
        using var staff = await Client(w.Staff, host);
        using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host);
        var initial = (await tenant.GetFromJsonAsync<HandoverDraftView>(route))!;
        Assert.Equal(0, initial.Version); // Older contracts use a lazy first write.
        Assert.Equal("Draft", initial.Status);
        Assert.Contains("room_condition", initial.Missing);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, contractId, "handover/draft/tenant-confirmation",
                new HandoverDraftTenantConfirmation(initial.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await HandoverPost(staff, contractId, "handover/draft/ready",
                new HandoverDraftReady(initial.Version))).StatusCode);

        await StartRealMoveInTask(staff, host.Services, contractId, w.Staff.Id);

        var choices = (await staff.GetFromJsonAsync<HandoverChoices>($"/api/v1/contracts/{contractId}/handover/choices"))!;
        var asset = Assert.Single(choices.Assets);
        var photo = await HandoverPhoto(staff, contractId);
        var input = new HandoverDraftWrite(initial.Version, "Tường và sàn đầy đủ", "Hai chìa khóa",
            "Đã kiểm kê", [new HandoverAssetInput(asset.Id, "Tốt", 4, 4, 4, 0, 0, 0, true, "Đủ tài sản", [])],
            [photo], choices.InventoryToken,
            RoomChecks: HandoverRoomChecklist.RequiredCodes.Select(code =>
                new HandoverRoomCheck(code, "Passed", "", [])).ToArray(),
            AccessItems: [new HandoverAccessItem("RoomKey", 2, "Đã giao 2 chìa khóa")]);
        var saved = await Read<HandoverDraftView>(await HandoverPost(staff, contractId, "handover/draft", input));
        Assert.Equal(1, saved.Version);
        Assert.Empty(saved.Missing);
        Assert.Equal("Tường và sàn đầy đủ", saved.RoomCondition);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, contractId, "handover/draft/ready", new HandoverDraftReady(0))).StatusCode);
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, contractId,
            "handover/draft/ready", new HandoverDraftReady(saved.Version)));
        Assert.Equal("Ready", ready.Status);
        Assert.NotNull(ready.OwnerReadyAt);
        using (var blockedAfterReady = new ByteArrayContent(ReviewEvidenceImage()))
        {
            blockedAfterReady.Headers.ContentType = new("image/png");
            Assert.Equal(HttpStatusCode.Conflict,
                (await staff.PostAsync(route + "/evidence", blockedAfterReady)).StatusCode);
        }
        var pdf = await tenant.GetByteArrayAsync(route + "/pdf");
        Assert.True(pdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        var request = await Read<HandoverDraftView>(await HandoverPost(tenant, contractId,
            "handover/draft/requests", new HandoverDraftCorrection(ready.Version, "Xin ghi chú tình trạng tường")));
        Assert.Equal("ChangesRequested", request.Status);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, contractId, "handover/draft/tenant-confirmation",
                new HandoverDraftTenantConfirmation(request.Version))).StatusCode);
        var correction = Assert.Single(request.Requests);
        var decision = await Read<HandoverDraftView>(await HandoverPost(owner, contractId,
            $"handover/draft/requests/{correction.Id}/decision",
            new HandoverDraftCorrectionDecision(request.Version, false, "Đã kiểm tra lại, ảnh phản ánh đúng")));
        Assert.Equal("Ready", decision.Status);
        Assert.Equal("Rejected", Assert.Single(decision.Requests).Status);
        var confirmed = await Read<HandoverDraftView>(await HandoverPost(tenant, contractId,
            "handover/draft/tenant-confirmation", new HandoverDraftTenantConfirmation(decision.Version, "Đã đối chiếu hiện trạng")));
        Assert.Equal("Confirmed", confirmed.Status);
        Assert.NotNull(confirmed.TenantConfirmedAt);
        using (var blockedAfterConfirmed = new ByteArrayContent(ReviewEvidenceImage()))
        {
            blockedAfterConfirmed.Headers.ContentType = new("image/png");
            Assert.Equal(HttpStatusCode.Conflict,
                (await staff.PostAsync(route + "/evidence", blockedAfterConfirmed)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(tenant, contractId, "handover/draft/tenant-confirmation",
                new HandoverDraftTenantConfirmation(decision.Version))).StatusCode);
        var final = (await tenant.GetFromJsonAsync<HandoverView>($"/api/v1/contracts/{contractId}/handover"))!;
        Assert.Equal("Confirmed", final.Status);
        Assert.True(final.Snapshot.TenantFeedback?.Confirmed);
        Assert.Equal("Đã đối chiếu hiện trạng", final.Snapshot.TenantFeedback?.Reason);
        var documents = (await tenant.GetFromJsonAsync<ContractDocumentView[]>(
            $"/api/v1/contracts/{contractId}/handover/documents"))!;
        Assert.Single(documents);
        var immutablePdf = await tenant.GetByteArrayAsync($"/api/v1/contracts/{contractId}/handover/documents/{documents[0].Id}");
        Assert.True(immutablePdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        using (var rendered = new iText.Kernel.Pdf.PdfDocument(
            new iText.Kernel.Pdf.PdfReader(new MemoryStream(immutablePdf))))
        {
            var captions = string.Join("\n", Enumerable.Range(1, rendered.GetNumberOfPages())
                .Select(page => iText.Kernel.Pdf.Canvas.Parser.PdfTextExtractor.GetTextFromPage(rendered.GetPage(page))));
            Assert.Contains("Yêu cầu chỉnh sửa", captions);
            Assert.Contains("PHỤ LỤC BẰNG CHỨNG", captions);
            Assert.Contains("Chỉ số điện lần đầu", captions);
            Assert.Contains("Chỉ số nước lần đầu", captions);
            Assert.Contains("CHECKLIST HIỆN TRẠNG NHẬN PHÒNG", captions);
            Assert.Contains("CHÌA KHÓA VÀ QUYỀN TRUY CẬP ĐÃ GIAO", captions);
        }
    }

    [CompactPostgresFact]
    public async Task IndividualAssetInspectionAndOwnerExceptionAcceptanceRequireEvidenceAndArePreservedInFinalBaseline()
    {
        var w = await Seed(); var outside = await Seed(); using var host = Host();
        var seeded = await SeedAssetHandover(w, host.Services, configured: 2, checkedGroups: 1);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}/handover/draft";
        using var staff = await Client(w.Staff, host);
        using var owner = await Client(w.Owner, host);
        using var tenant = await Client(w.Tenant, host);
        using var otherTenant = await Client(outside.Tenant, host);
        using var otherStaff = await Client(outside.Staff, host);

        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStaff.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync(route + "/pdf")).StatusCode);
        var draft = (await staff.GetFromJsonAsync<HandoverDraftView>(route))!;
        Assert.Equal(0, draft.Version);
        await StartRealMoveInTask(staff, host.Services, id, w.Staff.Id);
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>($"/api/v1/contracts/{id}/handover/choices"))!;
        Assert.Equal(2, choices.Assets.Count);
        var roomPhoto = await HandoverPhoto(staff, id);
        var issuePhoto = await HandoverPhoto(staff, id);
        Assert.NotEqual(roomPhoto, issuePhoto);
        var first = await Read<HandoverDraftView>(await HandoverPost(staff, id, "handover/draft",
            new HandoverDraftWrite(draft.Version, "Tường tốt", "Hai chìa khóa", "Kiểm tra lần một",
                [new HandoverAssetInput(choices.Assets[0].Id, "Tốt", 4, 4, 4, 0, 0, 0, true,
                    "Đủ", [])], [roomPhoto], choices.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Take(3)
                    .Select(code => new HandoverRoomCheck(code, "Passed", "", [])).ToArray(),
                AccessItems: [new HandoverAccessItem("RoomKey", 2, "Hai chìa khóa")])));
        Assert.Contains("assets", first.Missing);
        Assert.Contains("room_checklist", first.Missing);
        Assert.True(first.Assets[0].Checked);
        Assert.False(first.Assets[1].Checked);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(owner, id, "handover/draft/ready", new HandoverDraftReady(first.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, id, "handover/draft",
                new HandoverDraftWrite(0, "Tình trạng cũ"))).StatusCode);

        var second = await Read<HandoverDraftView>(await HandoverPost(staff, id, "handover/draft",
            new HandoverDraftWrite(first.Version, Assets:
                [new HandoverAssetInput(choices.Assets[1].Id, "Chưa đủ", 0, 0, 0, 0, 0, 4,
                    true, "Sẽ bổ sung ghế sau bàn giao", [issuePhoto])],
                InventoryToken: choices.InventoryToken,
                RoomChecks: HandoverRoomChecklist.RequiredCodes.Skip(3).Select(code =>
                    new HandoverRoomCheck(code, code == "safety_equipment" ? "Issue" : "Passed",
                        code == "safety_equipment" ? "Bình chữa cháy cần bổ sung" : "",
                        code == "safety_equipment" ? [issuePhoto] : [])).ToArray(),
                OutstandingIssues: [])));
        Assert.Empty(second.Missing);
        Assert.Equal(7, second.RoomChecks?.Length);
        Assert.Contains(second.RoomChecks!, check => check.Code == "safety_equipment" && check.Status == "Issue");
        Assert.All(second.Assets, asset => Assert.True(asset.Checked));
        Assert.Equal("Tốt", second.Assets[0].ObservedCondition);
        Assert.Equal("Chưa đủ", second.Assets[1].ObservedCondition);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(owner, id, "handover/draft/ready", new HandoverDraftReady(second.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(owner, id, "handover/draft/ready",
                new HandoverDraftReady(second.Version, "Đồng ý tình trạng thiếu"))).StatusCode);
        var reason = "Owner đồng ý bàn giao với một nhóm tài sản còn thiếu";
        var plan = "Bổ sung tài sản còn thiếu và có biên bản kiểm kê tiếp theo";
        var ready = await Read<HandoverDraftView>(await HandoverPost(owner, id, "handover/draft/ready",
            new HandoverDraftReady(second.Version, reason, plan)));
        Assert.Equal("Ready", ready.Status);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, id, "handover/draft", new HandoverDraftWrite(ready.Version, "Thay đổi trái phép"))).StatusCode);

        var correction = await Read<HandoverDraftView>(await HandoverPost(tenant, id, "handover/draft/requests",
            new HandoverDraftCorrection(ready.Version, "Hãy đổi ghi chú kiểm tra")));
        var change = Assert.Single(correction.Requests);
        Assert.Equal(HttpStatusCode.Conflict,
            (await HandoverPost(staff, id, "handover/draft", new HandoverDraftWrite(correction.Version, "Thay đổi sớm"))).StatusCode);
        var accepted = await Read<HandoverDraftView>(await HandoverPost(owner, id,
            $"handover/draft/requests/{change.Id}/decision",
            new HandoverDraftCorrectionDecision(correction.Version, true, "Đã chấp thuận bổ sung ghi chú")));
        Assert.Equal("Draft", accepted.Status);
        var revised = await Read<HandoverDraftView>(await HandoverPost(staff, id, "handover/draft",
            new HandoverDraftWrite(accepted.Version, Notes: "Đã bổ sung ghi chú theo yêu cầu của Tenant")));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await HandoverPost(owner, id, "handover/draft/ready", new HandoverDraftReady(revised.Version))).StatusCode);
        var reReady = await Read<HandoverDraftView>(await HandoverPost(owner, id, "handover/draft/ready",
            new HandoverDraftReady(revised.Version, reason, plan)));
        var confirmed = await Read<HandoverDraftView>(await HandoverPost(tenant, id,
            "handover/draft/tenant-confirmation", new HandoverDraftTenantConfirmation(reReady.Version)));
        Assert.Equal("Confirmed", confirmed.Status);
        var final = (await tenant.GetFromJsonAsync<HandoverView>($"/api/v1/contracts/{id}/handover"))!;
        Assert.Equal("Confirmed", final.Status);
        Assert.Equal(reason, final.Snapshot.OwnerAcceptance?.Reason);
        Assert.Equal(plan, final.Snapshot.OwnerAcceptance?.HandlingPlan);
        Assert.Equal(4, final.Snapshot.Assets.Single(a => a.Id == choices.Assets[1].Id).MissingQuantity);
        Assert.Equal(7, final.Snapshot.RoomChecks?.Length);
        Assert.Empty(final.Snapshot.OutstandingIssues!);
        Assert.Equal(2, Assert.Single(final.Snapshot.AccessItems!).Quantity);
        Assert.Contains("theo yêu cầu", final.Snapshot.Notes);
    }
}
