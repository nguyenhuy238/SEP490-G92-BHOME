using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    private static Guid HandoverTestKey(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    private static async Task<HttpResponseMessage> HandoverPost(HttpClient client, Guid id, string operation, object body, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contracts/{id}/{operation}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString()); return await client.SendAsync(request);
    }
    private async Task<(Guid Contract, Guid[] Readings)> SeedAssetHandover(Workspace w, IServiceProvider services, int configured = 9, int checkedGroups = 7)
    {
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>(); var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var resident = new Resident { RoomId = w.Room, TenantUserId = w.Tenant.Id, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic handover Tenant", VerificationStatus = IdentityVerificationStatus.Verified };
        db.Add(resident); await db.SaveChangesAsync();
        var room = await db.Set<Room>().SingleAsync(r => r.Id == w.Room);
        var items = Enumerable.Range(1, configured).Select(i => new AssetTemplateItem(Guid.NewGuid(), $"Ghế tổng hợp {i}", "Furniture", "BulkQuantity", 4, "cái")).ToArray();
        if (configured > 0)
        {
            var template = Guid.NewGuid();
            await store.SaveAsync(template, w.Location, "AssetTemplate", "Published", new AssetTemplateWrite(w.Location, "Synthetic template", items, Scoped: true, ScopeRoomId: w.Room), 0, w.Owner.Id, default);
            await store.SaveAsync(HandoverTestKey($"asset-template-assignment:{w.Room}"), w.Location, "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(template), 0, w.Owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), w.Location, "DesiredAssets", "PendingVerification", new DesiredAssets(template, 1, w.Room, items, "PendingVerification"), 0, w.Owner.Id, default);
            foreach (var item in items.Take(checkedGroups))
            {
                var asset = new Asset { RoomId = w.Room, LocationId = w.Location, Name = item.Name, Code = Guid.NewGuid().ToString("N"), Category = item.Category, Condition = "Tốt" };
                db.Add(asset); await db.SaveChangesAsync(); await store.SaveAssetMetadataAsync(asset.Id, new("BulkQuantity", 4, null, null, null, "cái"), default);
                await store.SaveAsync(Guid.NewGuid(), w.Location, "AssetVerification", "Verified", new { roomId = w.Room, templateId = template, itemId = item.Id, assetId = asset.Id, quantity = 4, evidenceIds = Array.Empty<Guid>(), source = "OwnerAttestation" }, 0, w.Owner.Id, default);
            }
        }
        var c = new Contract
        {
            RoomId = w.Room,
            TenantUserId = w.Tenant.Id,
            OwnerSignerId = w.Owner.Id,
            RepresentativeResidentId = resident.Id,
            Kind = ContractKind.Main,
            Status = ContractStatus.Active,
            StartDate = Today.AddDays(-10),
            EndDate = Today.AddMonths(6),
            MonthlyRent = 1000000,
            RequiredDeposit = 0,
            Terms = "Synthetic approved fixture",
            ActivatedByUserId = w.Owner.Id,
            ActivatedAt = DateTimeOffset.UtcNow
        };
        db.Add(c); db.Add(new ContractResident { ContractId = c.Id, ResidentId = resident.Id }); room.Status = RoomStatus.Occupied; room.Version++;
        await db.SaveChangesAsync();
        var readings = new List<Guid>(); var image = ReviewEvidenceImage();
        foreach (var utility in new[] { UtilityType.Electricity, UtilityType.Water })
        {
            var meter = new Meter { RoomId = w.Room, Code = "SYN-" + utility, UtilityType = utility, InstalledOn = Today.AddDays(-20) }; db.Add(meter); await db.SaveChangesAsync();
            var task = new OperationalTask { LocationId = w.Location, ContractId = c.Id, MeterId = meter.Id, Kind = BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading, ReadingDate = Today, Purpose = ReadingPurpose.Initial, Status = MeterTaskStatus.Completed, CompletedAt = DateTimeOffset.UtcNow };
            db.Add(task); await db.SaveChangesAsync();
            var evidence = new MeterEvidence { TaskId = task.Id, UploadedByUserId = w.Staff.Id, ContentType = "image/png", Length = image.Length, ObjectKey = $"synthetic/{Guid.NewGuid():N}.png", ImageHash = Convert.ToHexString(SHA256.HashData(image)), IsUploaded = true, IsLinked = true };
            using var bytes = new MemoryStream(image); await storage.PutAsync(evidence.ObjectKey, bytes, bytes.Length, "image/png", default);
            db.Add(evidence); await db.SaveChangesAsync();
            var reading = new MeterReading { TaskId = task.Id, MeterId = meter.Id, EvidenceId = evidence.Id, ConfirmedValue = 100, ConfirmedByUserId = w.Staff.Id, ConfirmedAt = DateTimeOffset.UtcNow };
            db.Add(reading); await db.SaveChangesAsync(); readings.Add(reading.Id);
        }
        return (c.Id, readings.ToArray());
    }
    private static async Task<Guid[]> SeedAdditionalContractOpeningReadings(Workspace w, IServiceProvider services, Guid contractId)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var readings = new List<Guid>();
        var bytes = ReviewEvidenceImage();
        foreach (var meter in await db.Set<Meter>().Where(m => m.RoomId == w.Room && m.IsActive).OrderBy(m => m.UtilityType).ToArrayAsync())
        {
            var task = new OperationalTask
            {
                LocationId = w.Location,
                ContractId = contractId,
                MeterId = meter.Id,
                Kind = BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading,
                ReadingDate = Today,
                Purpose = ReadingPurpose.Initial,
                Status = MeterTaskStatus.Completed,
                CompletedAt = DateTimeOffset.UtcNow
            };
            db.Add(task); await db.SaveChangesAsync();
            var evidence = new MeterEvidence
            {
                TaskId = task.Id,
                UploadedByUserId = w.Staff.Id,
                ContentType = "image/png",
                Length = bytes.Length,
                ObjectKey = $"synthetic/{Guid.NewGuid():N}.png",
                ImageHash = Convert.ToHexString(SHA256.HashData(bytes)),
                IsUploaded = true,
                IsLinked = true
            };
            using (var image = new MemoryStream(bytes)) await storage.PutAsync(evidence.ObjectKey, image, image.Length, "image/png", default);
            db.Add(evidence); await db.SaveChangesAsync();
            var reading = new MeterReading
            {
                TaskId = task.Id,
                MeterId = meter.Id,
                EvidenceId = evidence.Id,
                PreviousValue = 100,
                ConfirmedValue = 100,
                ConfirmedByUserId = w.Staff.Id,
                ConfirmedAt = DateTimeOffset.UtcNow
            };
            db.Add(reading); await db.SaveChangesAsync(); readings.Add(reading.Id);
        }
        return readings.ToArray();
    }
    private static async Task<Guid> HandoverPhoto(HttpClient client, Guid contract, bool moveOut = false)
    {
        using var body = new ByteArrayContent(ReviewEvidenceImage()); body.Headers.ContentType = new("image/png");
        return (await Read<ContractId>(await client.PostAsync($"/api/v1/contracts/{contract}/{(moveOut ? "move-out" : "handover")}/evidence", body))).Id;
    }

    [CompactPostgresFact]
    public async Task IncompleteInventoryShowsAllNineGroupsRequiresVersionedOwnerAndTenantAcceptanceAndStoresImmutablePdf()
    {
        var w = await Seed(); var outside = await Seed(); using var host = Host();
        var seeded = await SeedAssetHandover(w, host.Services); using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host); using var stranger = await Client(outside.Staff, host); using var otherTenant = await Client(outside.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}/handover";
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(route + "/choices")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync(route)).StatusCode);
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/choices"))!;
        Assert.Equal(9, choices.Assets.Count); Assert.Equal(7, choices.Assets.Count(a => a.OwnerChecked));
        var overall = await HandoverPhoto(staff, id); var issueA = await HandoverPhoto(staff, id);
        var inputs = choices.Assets.Select((a, index) => new HandoverAssetInput(a.Id, index < 7 ? "Tốt" : "Chưa được bổ sung", index < 7 ? 4 : 0,
            index < 7 ? 4 : 0, index < 7 ? 4 : 0, 0, 0, index < 7 ? 0 : 4, true, "Đã kiểm tra thực tế", index < 7 ? [] : [issueA])).ToArray();
        var input = new HandoverInput(0, Today, "Tường, sàn, cửa đã kiểm tra", "Hai chìa khóa", "Synthetic handover", inputs, seeded.Readings[0], seeded.Readings[1], [overall], choices.InventoryToken);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, id, "handover", input with { InventoryToken = "stale" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(staff, id, "handover", input with { Assets = inputs[..7] })).StatusCode);
        var reusedOverview = await HandoverPost(staff, id, "handover", input with { EvidenceIds = [issueA] });
        Assert.Equal(HttpStatusCode.BadRequest, reusedOverview.StatusCode); Assert.Contains("asset_group_evidence_must_be_separate", await reusedOverview.Content.ReadAsStringAsync());
        var h = await Read<HandoverView>(await HandoverPost(staff, id, "handover", input));
        Assert.Equal("NeedsReview", (await owner.GetFromJsonAsync<RoomInventoryReviewView>(ReviewRoute(w.Location)))!.Rooms.Single(r => r.RoomId == w.Room).State);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, id, "handover/staff-confirmation", new HandoverDecision(h.Version, ""))).StatusCode);
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(h.Version, "")));
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, id, "handover/staff-confirmation", new HandoverDecision(h.Version, ""))).StatusCode);
        h = await Read<HandoverView>(await HandoverPost(owner, id, "handover/owner-review", new HandoverOwnerReview(h.Version, true, "Tenant chấp nhận hiện trạng thiếu tài sản", "Bổ sung sau theo bàn giao bổ sung")));
        Assert.Null(h.TenantConfirmedAt); Assert.Equal(2, h.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(1, ""))).StatusCode);
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(h.Version, "Đã xem ngoại lệ")));
        var completionKey = Guid.NewGuid(); var decision = new HandoverDecision(h.Version, "Đã đối chiếu đầy đủ");
        var completed = await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", decision, completionKey));
        Assert.Equal("Confirmed", completed.Status);
        await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", decision, completionKey));
        var document = Assert.Single((await tenant.GetFromJsonAsync<ContractDocumentView[]>(route + "/documents"))!);
        var pdf = await tenant.GetByteArrayAsync(route + "/documents/" + document.Id); Assert.True(pdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        using (var rendered = new iText.Kernel.Pdf.PdfDocument(new iText.Kernel.Pdf.PdfReader(new MemoryStream(pdf))))
        {
            var captions = string.Join("\n", Enumerable.Range(1, rendered.GetNumberOfPages()).Select(p => iText.Kernel.Pdf.Canvas.Parser.PdfTextExtractor.GetTextFromPage(rendered.GetPage(p))));
            Assert.Contains("Ghế tổng hợp 8, Ghế tổng hợp 9", captions);
        }
        Assert.Equal(pdf, await owner.GetByteArrayAsync(route + "/documents/" + document.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await otherTenant.GetAsync(route + "/documents/" + document.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(route + "/documents/" + document.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, id, "handover", input with { Version = h.Version })).StatusCode);
        await using var check = host.Services.CreateAsyncScope(); var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(7, await db.Set<Asset>().CountAsync(a => a.RoomId == w.Room)); Assert.Equal(ContractStatus.Active, (await db.Set<Contract>().SingleAsync(c => c.Id == id)).Status);
        var asset = await db.Set<Asset>().FirstAsync(a => a.RoomId == w.Room); asset.Condition = "Đổi sau bàn giao"; asset.Version++; await db.SaveChangesAsync();
        Assert.Equal(pdf, await tenant.GetByteArrayAsync(route + "/documents/" + document.Id));
    }

    [CompactPostgresFact]
    public async Task EmptyInventoryRequiresExplicitOwnerNoAssetsConfirmationAndTenantDisputeDoesNotDeactivateTenancy()
    {
        var w = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 0, 0);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var route = $"/api/v1/contracts/{seeded.Contract}/handover"; var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/choices"))!; Assert.False(choices.NoAssetsConfirmed);
        var photo = await HandoverPhoto(staff, seeded.Contract); var input = new HandoverInput(0, Today, "Empty synthetic room", "Keys", "No assets", [], seeded.Readings[0], seeded.Readings[1], [photo], choices.InventoryToken);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, seeded.Contract, "handover", input)).StatusCode);
        await Read<HandoverInventory>(await owner.PostAsJsonAsync(ReviewRoute(w.Location) + $"/{w.Room}/no-assets", new RoomNoAssetsConfirmation(choices.InventoryToken!, "Owner physically checked no assets")));
        choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/choices"))!;
        var h = await Read<HandoverView>(await HandoverPost(staff, seeded.Contract, "handover", input with { InventoryToken = choices.InventoryToken }));
        await Read<HandoverView>(await HandoverPost(tenant, seeded.Contract, "handover/disputes", new HandoverDecision(h.Version, "Cần sửa hiện trạng cửa")));
        Assert.Equal(ContractStatus.Active.ToString(), (await tenant.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{seeded.Contract}"))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, seeded.Contract, "handover/staff-confirmation", new HandoverDecision(h.Version, ""))).StatusCode);
    }

    private static async Task<Guid[]> FinalHandoverReadings(IServiceProvider services, HttpClient owner, HttpClient staff, Guid contract, Guid room)
    {
        var result = new List<Guid>();
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        foreach (var meter in await db.Set<Meter>().Where(m => m.RoomId == room).OrderBy(m => m.UtilityType).ToArrayAsync())
        {
            var task = await Read<ContractId>(await owner.PostAsJsonAsync("/api/v1/capture/meter-tasks", new { meterId = meter.Id, purpose = 2, readingDate = Today, contractId = contract }));
            using var image = new ByteArrayContent(ReviewEvidenceImage()); image.Headers.ContentType = new("image/png");
            var evidence = await Read<ContractId>(await staff.PutAsync($"/api/v1/capture/meter-tasks/{task.Id}/evidence", image));
            var reading = await Read<ContractId>(await staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task.Id}/confirm", new { humanConfirmed = true, confirmedValue = "101", evidenceId = evidence.Id }));
            result.Add(reading.Id);
        }
        return result.ToArray();
    }

    [CompactPostgresFact]
    public async Task ExactInventoryRejectsConcurrentSaveAndPdfFailureRollsBackCompletionBeforeSafeRetry()
    {
        var w = await Seed(); var files = new Files(); using var host = Host(files);
        var seeded = await SeedAssetHandover(w, host.Services, 9, 9);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}/handover";
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/choices"))!;
        Assert.All(choices.Assets, a => Assert.True(a.OwnerChecked));
        var photo = await HandoverPhoto(staff, id);
        var input = new HandoverInput(0, Today, "Synthetic exact room", "Keys", "No discrepancy",
            choices.Assets.Select(a => new HandoverAssetInput(a.Id, "Tốt", 4, 4, 4, 0, 0, 0, true)).ToArray(), seeded.Readings[0], seeded.Readings[1], [photo], choices.InventoryToken);
        var saves = await Task.WhenAll(HandoverPost(staff, id, "handover", input), HandoverPost(staff, id, "handover", input));
        Assert.Single(saves, r => r.IsSuccessStatusCode); Assert.Single(saves, r => r.StatusCode == HttpStatusCode.Conflict);
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(1, "")));
        files.FailPdfWrites = true;
        var key = Guid.NewGuid(); var decision = new HandoverDecision(1, "All nine checked");
        Assert.False((await HandoverPost(staff, id, "handover/staff-confirmation", decision, key)).IsSuccessStatusCode);
        Assert.NotEqual("Confirmed", (await tenant.GetFromJsonAsync<HandoverView>(route))!.Status);
        Assert.Empty((await tenant.GetFromJsonAsync<ContractDocumentView[]>(route + "/documents"))!);
        files.FailPdfWrites = false;
        Assert.Equal("Confirmed", (await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", decision, key))).Status);
        await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", decision, key));
        var document = Assert.Single((await tenant.GetFromJsonAsync<ContractDocumentView[]>(route + "/documents"))!);
        var retried = await Read<ContractDocumentView>(await HandoverPost(owner, id, "handover/documents/retry", new { })); Assert.Equal(document.Id, retried.Id);
        await using var check = host.Services.CreateAsyncScope(); var db = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var stored = await db.Set<ContractDocumentFile>().SingleAsync(f => f.Id == document.Id);
        files.Corrupt(stored.ObjectKey);
        Assert.Equal(HttpStatusCode.Conflict, (await tenant.GetAsync(route + "/documents/" + document.Id)).StatusCode);
    }

    [CompactPostgresTheory]
    [InlineData(false, "Active")]
    [InlineData(true, "Active")]
    [InlineData(false, "UnderRepair")]
    [InlineData(false, "OpenWorkOrder")]
    public async Task LegacyBaselineRequiresOwnerExceptionAndDoesNotInventHistoricalQuantities(bool textOnly, string assetState)
    {
        var w = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 1, 1);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}";
        if (textOnly)
        {
            var old = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/handover/choices"))!;
            var snapshot = new HandoverSnapshot(Today, "S101", "Legacy condition only", "Keys", "Historical snapshot without quantities",
                [old.Assets[0] with { HandedOverQuantity = null, ObservedQuantity = null, ConfiguredQuantity = null }], old.Readings.Single(r => r.UtilityType == 0), old.Readings.Single(r => r.UtilityType == 1), []);
            var json = JsonSerializer.Serialize(snapshot); var at = DateTimeOffset.UtcNow;
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            db.Add(new ContractHandover
            {
                ContractId = id,
                Status = ContractHandoverStatus.Confirmed,
                Snapshot = json,
                ElectricityReadingId = seeded.Readings[0],
                WaterReadingId = seeded.Readings[1],
                TenantConfirmedVersion = 1,
                TenantConfirmedBy = w.Tenant.Id,
                TenantConfirmedAt = at,
                StaffConfirmedBy = w.Staff.Id,
                StaffConfirmedAt = at
            });
            db.Add(new ContractHandoverHistory { ContractId = id, Version = 1, Action = "Confirmed", ActorId = w.Staff.Id, OccurredAt = at, Snapshot = json, ElectricityReadingId = seeded.Readings[0], WaterReadingId = seeded.Readings[1] });
            await db.SaveChangesAsync();
        }
        await Read<MoveOutView>(await HandoverPost(tenant, id, "termination-requests", new TerminationInput(Today, "Synthetic legacy leaving")));
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/approve", new { }));
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/schedule", new InspectionScheduleInput(DateTimeOffset.UtcNow.AddMinutes(1), w.Staff.Id)));
        var readings = await FinalHandoverReadings(host.Services, owner, staff, id, w.Room);
        if (assetState != "Active")
        {
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var asset = await db.Set<Asset>().SingleAsync(a => a.RoomId == w.Room);
            if (assetState == "UnderRepair") { asset.Status = AssetStatus.UnderRepair; asset.Version++; }
            else db.Add(new BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder
            {
                Source = "Proactive",
                Description = "Synthetic open maintenance",
                LocationId = w.Location,
                RoomId = w.Room,
                AssetId = asset.Id,
                AssignedStaffId = w.Staff.Id,
                ExpectedOutcome = "Inspect synthetic asset",
                TargetCompletionAt = DateTimeOffset.UtcNow.AddDays(1),
                Status = BHome.Domain.IncidentMaintenance.WorkOrderStatus.Assigned
            });
            await db.SaveChangesAsync();
        }
        var preparation = (await staff.GetFromJsonAsync<InspectionPreparation>(route + "/move-out/inspection-preparation"))!;
        if (textOnly) Assert.Null(preparation.Baseline!.Snapshot.Assets[0].HandedOverQuantity); else Assert.Null(preparation.Baseline);
        Assert.True(preparation.LegacyExceptionRequired);
        var photo = await HandoverPhoto(staff, id, true); var group = Assert.Single(preparation.InspectionGroups!);
        var input = new InspectionInput(readings[0], readings[1], "Legacy observed only", [photo],
            [new(group.Id, "Đã kiểm tra tình trạng mới", 4, 4, 4, 0, 0, 0, true)], "Observed room", "Keys returned", InventoryToken: preparation.Inventory!.StateToken);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(staff, id, "move-out/inspection", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await HandoverPost(staff, id, "move-out/legacy-baseline-exception", new LegacyHandoverException("Not permitted"))).StatusCode);
        await Read<ContractId>(await HandoverPost(owner, id, "move-out/legacy-baseline-exception", new LegacyHandoverException("No historical baseline; inspect current state without inferring liability")));
        await Read<MoveOutView>(await HandoverPost(staff, id, "move-out/inspection", input));
        var inspection = Assert.Single((await tenant.GetFromJsonAsync<FinalInspectionView[]>(route + "/move-out/inspections"))!);
        if (textOnly) Assert.Null(inspection.Baseline!.Assets[0].HandedOverQuantity); else Assert.Null(inspection.Baseline);
        Assert.NotNull(inspection.Observed.MissingBaselineReason); Assert.Equal(0, inspection.Observed.Assets[0].MissingQuantity);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(owner, id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Owner review"))).StatusCode);
        if (assetState != "Active")
        {
            var response = await HandoverPost(owner, id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Do not overwrite maintenance state", false, true, "Tenant absent"));
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Contains("asset_workflow_controlled", await response.Content.ReadAsStringAsync()); return;
        }
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); var asset = await db.Set<Asset>().SingleAsync(a => a.RoomId == w.Room);
            asset.Condition = "Owner edited concurrently"; asset.Version++; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(owner, id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Review stale data", false, true, "Tenant absent"))).StatusCode);
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/inspection-review", new InspectionReviewInput(1, false, "Reinspect after concurrent Asset edit")));
        var fresh = (await staff.GetFromJsonAsync<InspectionPreparation>(route + "/move-out/inspection-preparation"))!;
        var nextPhoto = await HandoverPhoto(staff, id, true);
        await Read<MoveOutView>(await HandoverPost(staff, id, "move-out/inspection", input with { EvidenceIds = [nextPhoto], InventoryToken = fresh.Inventory!.StateToken }));
        var versions = (await tenant.GetFromJsonAsync<FinalInspectionView[]>(route + "/move-out/inspections"))!;
        Assert.Equal(new[] { 2, 1 }, versions.Select(v => v.Version)); Assert.Equal("Reinspection", versions[1].OwnerDecision);
        Assert.Equal(JsonSerializer.Serialize(inspection.Observed), JsonSerializer.Serialize(versions[1].Observed));
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, id, "move-out/tenant-feedback", new InspectionTenantFeedback(1, true, "Stale inspection"))).StatusCode);
    }

    private static async Task<Guid> SeedHandoverRenewal(Workspace w, IServiceProvider services, Guid previous)
    {
        await using var scope = services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var prior = await db.Set<Contract>().SingleAsync(c => c.Id == previous); prior.Status = ContractStatus.Superseded;
        var renewal = new Contract
        {
            RoomId = prior.RoomId,
            TenantUserId = prior.TenantUserId,
            OwnerSignerId = prior.OwnerSignerId,
            RepresentativeResidentId = prior.RepresentativeResidentId,
            Kind = ContractKind.Renewal,
            Status = ContractStatus.Active,
            PreviousContractId = previous,
            StartDate = Today,
            EndDate = Today.AddYears(1),
            MonthlyRent = prior.MonthlyRent,
            ActivatedAt = DateTimeOffset.UtcNow,
            ActivatedByUserId = w.Owner.Id,
            Terms = "Synthetic renewal precondition; signing lifecycle covered by contract regression suite"
        };
        db.Add(renewal); await db.SaveChangesAsync(); return renewal.Id;
    }

    [CompactPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SupplementIsOnePhysicalEventAndOnlyTenantAcknowledgementChangesTheComparisonBaseline(bool renewBeforeAcknowledgement)
    {
        var w = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 1, 1);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}";
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/handover/choices"))!; var group = Assert.Single(choices.Assets);
        var overall = await HandoverPhoto(staff, id); var problem = await HandoverPhoto(staff, id);
        await Read<HandoverView>(await HandoverPost(staff, id, "handover", new HandoverInput(0, Today, "Synthetic", "Keys", "Thiếu một ghế", [new(group.Id, "Tốt", 3, 3, 3, 0, 0, 1, true, "Sẽ bổ sung sau", [problem])], seeded.Readings[0], seeded.Readings[1], [overall], choices.InventoryToken)));
        await Read<HandoverView>(await HandoverPost(owner, id, "handover/owner-review", new HandoverOwnerReview(1, true, "Chấp nhận giao ba ghế", "Bổ sung sau")));
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(2, "Đồng ý ba ghế")));
        await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", new HandoverDecision(2, "")));
        var asset = Assert.Single(group.PhysicalAssets!);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{asset.Id}/metadata", new AssetMetadataWrite(new("BulkQuantity", 4, null, null, null, "cái"), 0, "Owner xác nhận đã bổ sung ghế còn thiếu")));
        var preparation = (await staff.GetFromJsonAsync<AssetChangePreparation>(route + "/asset-changes/preparation"))!;
        var evidence = await HandoverPhoto(staff, id);
        var input = new AssetChangeInput(preparation.Sources.First(s => s.AssetId == asset.Id).Id, "Supplement", Today, "Giao thêm một ghế", preparation.Inventory.StateToken,
            [new(group.Id, null, asset.Id, 1, 0, "Tốt", [evidence])]);
        var eventKey = Guid.NewGuid(); var change = await Read<AssetChangeView>(await HandoverPost(staff, id, "asset-changes", input, eventKey));
        Assert.Equal(change.Id, (await Read<AssetChangeView>(await HandoverPost(staff, id, "asset-changes", input, eventKey))).Id);
        Assert.Equal(3, (await staff.GetFromJsonAsync<InspectionPreparation>(route + "/move-out/inspection-preparation"))!.Baseline!.Snapshot.Assets[0].HandedOverQuantity);
        var confirmationContract = renewBeforeAcknowledgement ? await SeedHandoverRenewal(w, host.Services, id) : id;
        var confirmationRoute = $"/api/v1/contracts/{confirmationContract}";
        var confirmKey = Guid.NewGuid(); var confirmation = new InspectionTenantFeedback(1, true, "Đã nhận thêm một ghế");
        await Read<AssetChangeView>(await HandoverPost(tenant, confirmationContract, $"asset-changes/{change.Id}/confirmation", confirmation, confirmKey));
        await Read<AssetChangeView>(await HandoverPost(tenant, confirmationContract, $"asset-changes/{change.Id}/confirmation", confirmation, confirmKey));
        Assert.Equal(4, (await staff.GetFromJsonAsync<InspectionPreparation>(confirmationRoute + "/move-out/inspection-preparation"))!.Baseline!.Snapshot.Assets[0].HandedOverQuantity);
        Assert.Equal(3, (await tenant.GetFromJsonAsync<HandoverView>(route + "/handover"))!.Snapshot.Assets[0].HandedOverQuantity);
        Assert.Single((await tenant.GetFromJsonAsync<ContractDocumentView[]>(confirmationRoute + "/handover/documents"))!, d => d.Kind == "AssetChangeReport");
        await using var check = host.Services.CreateAsyncScope(); Assert.Equal(1, await check.ServiceProvider.GetRequiredService<Compact24DbContext>().Set<Asset>().CountAsync(a => a.RoomId == w.Room));
        var renewal = await SeedHandoverRenewal(w, host.Services, confirmationContract);
        var inherited = (await tenant.GetFromJsonAsync<HandoverView>($"/api/v1/contracts/{renewal}/handover"))!;
        Assert.Equal(id, inherited.SourceContractId); Assert.Equal(3, inherited.Snapshot.Assets[0].HandedOverQuantity);
        var renewedComparison = (await staff.GetFromJsonAsync<InspectionPreparation>($"/api/v1/contracts/{renewal}/move-out/inspection-preparation"))!;
        Assert.Equal(id, renewedComparison.BaselineContractId); Assert.Equal(4, renewedComparison.Baseline!.Snapshot.Assets[0].HandedOverQuantity);
        var inheritedDocuments = (await tenant.GetFromJsonAsync<ContractDocumentView[]>($"/api/v1/contracts/{renewal}/handover/documents"))!;
        Assert.Single(inheritedDocuments, d => d.Kind == "MoveInReport"); Assert.Single(inheritedDocuments, d => d.Kind == "AssetChangeReport");
        var inheritedChange = Assert.Single((await tenant.GetFromJsonAsync<AssetChangeView[]>($"/api/v1/contracts/{renewal}/asset-changes"))!);
        Assert.Equal(id, inheritedChange.AcknowledgementContractId); Assert.Equal(confirmationContract, Assert.Single(inheritedChange.Data.Acknowledgements).ActingContractId);
        Assert.Equal(ReviewEvidenceImage(), await tenant.GetByteArrayAsync($"/api/v1/contracts/{renewal}/asset-changes/{change.Id}/evidence/{evidence}"));
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(tenant, renewal, $"asset-changes/{change.Id}/confirmation", confirmation)).StatusCode);
    }

    [CompactPostgresFact]
    public async Task SharedAssetHasSeparateAcknowledgementsAndConcurrentDeparturesReleaseOnlyAfterLastTenant()
    {
        var w = await Seed(); var other = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 0, 0);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host);
        using var tenant = await Client(w.Tenant, host); using var secondTenant = await Client(other.Tenant, host);
        Guid secondId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, TenantUserId = other.Tenant.Id, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic shared Tenant", VerificationStatus = IdentityVerificationStatus.Verified };
            db.Add(resident); await db.SaveChangesAsync();
            var c = new Contract
            {
                RoomId = w.Room,
                TenantUserId = other.Tenant.Id,
                OwnerSignerId = w.Owner.Id,
                RepresentativeResidentId = resident.Id,
                Kind = ContractKind.Main,
                Status = ContractStatus.Active,
                StartDate = Today.AddDays(-10),
                EndDate = Today.AddMonths(6),
                MonthlyRent = 1000000,
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = w.Owner.Id,
                Terms = "Synthetic shared contract"
            };
            db.Add(c); db.Add(new ContractResident { ContractId = c.Id, ResidentId = resident.Id }); await db.SaveChangesAsync(); secondId = c.Id;
        }
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>($"/api/v1/contracts/{seeded.Contract}/handover/choices"))!;
        await Read<HandoverInventory>(await owner.PostAsJsonAsync(ReviewRoute(w.Location) + $"/{w.Room}/no-assets", new RoomNoAssetsConfirmation(choices.InventoryToken!, "Owner inspected synthetic empty shared room")));
        var secondOpeningReadings = await SeedAdditionalContractOpeningReadings(w, host.Services, secondId);
        var parties = new[] { (Id: seeded.Contract, Tenant: tenant, Readings: seeded.Readings), (Id: secondId, Tenant: secondTenant, Readings: secondOpeningReadings) };
        foreach (var party in parties)
        {
            var opening = (await staff.GetFromJsonAsync<HandoverChoices>($"/api/v1/contracts/{party.Id}/handover/choices"))!;
            var photo = await HandoverPhoto(staff, party.Id);
            await Read<HandoverView>(await HandoverPost(staff, party.Id, "handover", new HandoverInput(0, Today, "Synthetic shared room", "Private key", "No initial assets", [], party.Readings[0], party.Readings[1], [photo], opening.InventoryToken)));
            await Read<HandoverView>(await HandoverPost(party.Tenant, party.Id, "handover/tenant-confirmation", new HandoverDecision(1, "")));
            await Read<HandoverView>(await HandoverPost(staff, party.Id, "handover/staff-confirmation", new HandoverDecision(1, "")));
        }
        var created = await owner.PostAsJsonAsync("/api/v1/assets", new { locationId = w.Location, roomId = w.Room, code = "SYN-SHARED-" + Guid.NewGuid().ToString("N"), name = "Shared synthetic chair", category = "Furniture", condition = "Tốt" });
        created.EnsureSuccessStatusCode(); var assetId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var preparation = (await staff.GetFromJsonAsync<AssetChangePreparation>($"/api/v1/contracts/{seeded.Contract}/asset-changes/preparation"))!;
        var group = Assert.Single(preparation.Inventory.Groups); var evidence = await HandoverPhoto(staff, seeded.Contract);
        var input = new AssetChangeInput(preparation.Sources.First(s => s.AssetId == assetId).Id, "Supplement", Today, "One physical shared chair", preparation.Inventory.StateToken,
            [new(group.Id, null, assetId, 1, 0, "Tốt", [evidence])]);
        var change = await Read<AssetChangeView>(await HandoverPost(staff, seeded.Contract, "asset-changes", input)); Assert.Equal(2, change.Data.Parties.Length);
        var firstKey = Guid.NewGuid();
        var firstResponse = await Read<AssetChangeView>(await HandoverPost(tenant, seeded.Contract, $"asset-changes/{change.Id}/confirmation", new InspectionTenantFeedback(1, true, "First Tenant received"), firstKey));
        var replayResponse = await Read<AssetChangeView>(await HandoverPost(tenant, seeded.Contract, $"asset-changes/{change.Id}/confirmation", new InspectionTenantFeedback(1, true, "First Tenant received"), firstKey));
        foreach (var response in new[] { firstResponse, replayResponse })
        {
            Assert.Equal(seeded.Contract, Assert.Single(response.Data.Parties).ContractId);
            Assert.Equal(w.Tenant.Id, Assert.Single(response.Data.Acknowledgements).TenantId);
            Assert.Equal(Guid.Empty, response.Data.EvidenceContractId);
        }
        Assert.Empty((await staff.GetFromJsonAsync<InspectionPreparation>($"/api/v1/contracts/{secondId}/move-out/inspection-preparation"))!.Baseline!.Snapshot.Assets);
        var secondView = Assert.Single((await secondTenant.GetFromJsonAsync<AssetChangeView[]>($"/api/v1/contracts/{secondId}/asset-changes"))!);
        Assert.Single(secondView.Data.Parties); Assert.Empty(secondView.Data.Acknowledgements);
        await Read<AssetChangeView>(await HandoverPost(secondTenant, secondId, $"asset-changes/{change.Id}/confirmation", new InspectionTenantFeedback(1, true, "Second Tenant received")));
        Assert.Equal(1, Assert.Single((await staff.GetFromJsonAsync<InspectionPreparation>($"/api/v1/contracts/{secondId}/move-out/inspection-preparation"))!.Baseline!.Snapshot.Assets).HandedOverQuantity);
        foreach (var party in parties)
        {
            await Read<MoveOutView>(await HandoverPost(party.Tenant, party.Id, "termination-requests", new TerminationInput(Today, "Synthetic shared departure")));
            await Read<MoveOutView>(await HandoverPost(owner, party.Id, "move-out/approve", new { }));
            await Read<MoveOutView>(await HandoverPost(owner, party.Id, "move-out/schedule", new InspectionScheduleInput(DateTimeOffset.UtcNow.AddMinutes(1), w.Staff.Id)));
            var readings = await FinalHandoverReadings(host.Services, owner, staff, party.Id, w.Room);
            var comparison = (await staff.GetFromJsonAsync<InspectionPreparation>($"/api/v1/contracts/{party.Id}/move-out/inspection-preparation"))!;
            var photo = await HandoverPhoto(staff, party.Id, true);
            await Read<MoveOutView>(await HandoverPost(staff, party.Id, "move-out/inspection", new InspectionInput(readings[0], readings[1], "Shared chair stays in room", [photo],
                [new(group.Id, "Tốt", 1, 1, 1, 0, 0, 0, true)], "Synthetic", "Tenant private key returned", InventoryToken: comparison.Inventory!.StateToken)));
            await Read<MoveOutView>(await HandoverPost(party.Tenant, party.Id, "move-out/tenant-feedback", new InspectionTenantFeedback(1, true, "Current state confirmed")));
            await Read<MoveOutView>(await HandoverPost(owner, party.Id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Observed state only")));
        }
        var completed = await Task.WhenAll(parties.Select(p => HandoverPost(owner, p.Id, "move-out/complete", new CompletionInput(Today, "Available"))));
        Assert.All(completed, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var secondPdf = (await secondTenant.GetFromJsonAsync<ContractDocumentView[]>($"/api/v1/contracts/{secondId}/handover/documents"))!.Single(d => d.Kind == "MoveOutReport");
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/contracts/{secondId}/handover/documents/{secondPdf.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/contracts/{secondId}/move-out/settlement-summary")).StatusCode);
        await using var verify = host.Services.CreateAsyncScope(); var final = verify.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(1, await final.Set<Asset>().CountAsync(a => a.RoomId == w.Room));
        Assert.Equal(RoomStatus.Available, (await final.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        Assert.False(await final.Set<Contract>().AnyAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
    }

    [CompactPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AuthorizedReplacementOrWithdrawalChangesOnlyAcknowledgedComparisonAssets(bool replacement)
    {
        var w = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 1, 1);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}";
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/handover/choices"))!; var group = Assert.Single(choices.Assets); var old = Assert.Single(group.PhysicalAssets!);
        var photo = await HandoverPhoto(staff, id);
        await Read<HandoverView>(await HandoverPost(staff, id, "handover", new HandoverInput(0, Today, "Synthetic", "Keys", "Original four chairs", [new(group.Id, "Tốt", 4, 4, 4, 0, 0, 0, true)], seeded.Readings[0], seeded.Readings[1], [photo], choices.InventoryToken)));
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(1, "")));
        await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", new HandoverDecision(1, "")));
        Guid? added = null; Guid? workOrder = null;
        if (replacement)
        {
            var response = await owner.PostAsJsonAsync($"/api/v1/assets/{old.Id}/replace", new AssetReplacement("SYN-REPLACED-" + Guid.NewGuid().ToString("N"), "Tốt", "Synthetic verified BF-07 replacement", old.Version));
            response.EnsureSuccessStatusCode(); added = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assetId").GetGuid();
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var source = new BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder
            {
                Source = "Proactive",
                Description = "Synthetic verified replacement precondition",
                LocationId = w.Location,
                RoomId = w.Room,
                AssetId = old.Id,
                AssignedStaffId = w.Staff.Id,
                ExpectedOutcome = "Replacement inspected",
                TargetCompletionAt = DateTimeOffset.UtcNow,
                Status = BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified,
                VerifiedById = w.Owner.Id,
                VerifiedAt = DateTimeOffset.UtcNow,
                ProposalVersion = 1,
                ApprovedProposalVersion = 1,
                ApprovedAt = DateTimeOffset.UtcNow,
                ApprovedById = w.Owner.Id,
                ActualCost = 0
            };
            var completed = new BHome.Domain.IncidentMaintenance.IncidentActivity { WorkOrderId = source.Id, ActorId = w.Staff.Id, Action = "Completed", Note = "Synthetic completed replacement evidence precondition", OccurredAt = DateTimeOffset.UtcNow };
            source.CompletionActivityId = completed.Id;
            db.AddRange(source, completed); await db.SaveChangesAsync(); workOrder = source.Id;
        }
        else await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/assets/{old.Id}/metadata", new AssetMetadataWrite(new("BulkQuantity", 3, null, null, null, "cái"), 0, "Synthetic authorized one-chair withdrawal")));
        var preparation = (await staff.GetFromJsonAsync<AssetChangePreparation>(route + "/asset-changes/preparation"))!;
        var sourceId = replacement ? workOrder!.Value : preparation.Sources.First(s => s.AssetId == old.Id).Id;
        var input = new AssetChangeInput(sourceId, replacement ? "Replacement" : "Withdrawal", Today, "Synthetic physical change", preparation.Inventory.StateToken,
            [new(group.Id, old.Id, added, replacement ? 4 : 0, replacement ? 4 : 1, "Tốt", [photo])]);
        if (replacement)
        {
            var unverified = preparation.Sources.First(s => s.WorkOrderId is null);
            Assert.Equal(HttpStatusCode.BadRequest, (await HandoverPost(staff, id, "asset-changes", input with { SourceId = unverified.Id })).StatusCode);
        }
        var change = await Read<AssetChangeView>(await HandoverPost(staff, id, "asset-changes", input));
        await Read<AssetChangeView>(await HandoverPost(tenant, id, $"asset-changes/{change.Id}/confirmation", new InspectionTenantFeedback(1, true, "Received physical change")));
        var comparison = (await staff.GetFromJsonAsync<InspectionPreparation>(route + "/move-out/inspection-preparation"))!;
        var expected = Assert.Single(comparison.Baseline!.Snapshot.Assets); Assert.Equal(replacement ? 4 : 3, expected.HandedOverQuantity);
        Assert.Equal(added ?? old.Id, Assert.Single(expected.PhysicalAssets!).Id);
        Assert.Equal(4, (await tenant.GetFromJsonAsync<HandoverView>(route + "/handover"))!.Snapshot.Assets[0].HandedOverQuantity);
        if (replacement) Assert.DoesNotContain(comparison.InspectionGroups!, a => (a.PhysicalAssets ?? []).Any(p => p.Id == old.Id));
    }

    [CompactPostgresTheory]
    [InlineData(false, 3, 1, 0)]
    [InlineData(true, 3, 1, 0)]
    [InlineData(false, 4, 0, 1)]
    [InlineData(false, 0, 0, 0)]
    [InlineData(false, 4, 1, 0)]
    public async Task OwnerConfirmedMoveOutSynchronizesPhysicalQuantityPreservesTemplateAndCompletesWithUnresolvedFinance(bool sharedRoom, int observed, int worn, int damaged)
    {
        var w = await Seed(); var second = await Seed(); using var host = Host(); var seeded = await SeedAssetHandover(w, host.Services, 1, 1);
        using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host); using var tenant = await Client(w.Tenant, host);
        var id = seeded.Contract; var route = $"/api/v1/contracts/{id}";
        var choices = (await staff.GetFromJsonAsync<HandoverChoices>(route + "/handover/choices"))!; var source = Assert.Single(choices.Assets);
        var photo = await HandoverPhoto(staff, id);
        var input = new HandoverInput(0, Today, "Phòng đã kiểm tra", "Hai chìa khóa", "Synthetic", [new(source.Id, "Tốt", 4, 4, 4, 0, 0, 0, true)], seeded.Readings[0], seeded.Readings[1], [photo], choices.InventoryToken);
        await Read<HandoverView>(await HandoverPost(staff, id, "handover", input));
        await Read<HandoverView>(await HandoverPost(tenant, id, "handover/tenant-confirmation", new HandoverDecision(1, "")));
        await Read<HandoverView>(await HandoverPost(staff, id, "handover/staff-confirmation", new HandoverDecision(1, "")));
        Guid? secondId = null;
        if (sharedRoom)
        {
            await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, TenantUserId = second.Tenant.Id, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic second tenant", VerificationStatus = IdentityVerificationStatus.Verified }; db.Add(resident); await db.SaveChangesAsync();
            var other = new Contract
            {
                RoomId = w.Room,
                TenantUserId = second.Tenant.Id,
                OwnerSignerId = w.Owner.Id,
                RepresentativeResidentId = resident.Id,
                Kind = ContractKind.Main,
                Status = ContractStatus.Active,
                StartDate = Today.AddDays(-9),
                EndDate = Today.AddMonths(6),
                MonthlyRent = 1000000,
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = w.Owner.Id,
                Terms = "Synthetic shared tenancy"
            };
            db.Add(other); db.Add(new ContractResident { ContractId = other.Id, ResidentId = resident.Id }); await db.SaveChangesAsync(); secondId = other.Id;
        }
        await Read<MoveOutView>(await HandoverPost(tenant, id, "termination-requests", new TerminationInput(Today, "Synthetic leaving")));
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/approve", new { }));
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/schedule", new InspectionScheduleInput(DateTimeOffset.UtcNow.AddMinutes(1), w.Staff.Id)));
        var finalReadings = await FinalHandoverReadings(host.Services, owner, staff, id, w.Room);
        var preparation = (await staff.GetFromJsonAsync<InspectionPreparation>(route + "/move-out/inspection-preparation"))!;
        Assert.Equal(sharedRoom, preparation.OtherTenantsRemain);
        var overall = await HandoverPhoto(staff, id, true); var problem = await HandoverPhoto(staff, id, true);
        var inspection = new InspectionInput(finalReadings[0], finalReadings[1], "Thiếu một ghế; kiểm tra thực tế", [overall],
            [new(source.Id, "Hiện trạng tổng hợp đã kiểm tra", observed, observed, observed - worn - damaged, worn, damaged, 4 - observed, true, "Ghi nhận hiện trạng; chưa kết luận trách nhiệm", [problem])], "Đã kiểm tra tường sàn cửa", "Đã thu chìa khóa riêng của Tenant", InventoryToken: preparation.Inventory!.StateToken,
            ProposedCompensation: "Đề nghị Owner đối chiếu bằng chứng, chưa tạo khoản phải thu");
        await Read<MoveOutView>(await HandoverPost(staff, id, "move-out/inspection", inspection));
        await using (var check = host.Services.CreateAsyncScope())
        {
            var metadata = await check.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().AssetMetadataAsync([source.PhysicalAssets![0].Id], default); Assert.Equal(4, metadata.Values.Single().Quantity);
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await HandoverPost(staff, id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Not permitted"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await HandoverPost(owner, id, "move-out/inspection-review", new InspectionReviewInput(1, true, "Owner review"))).StatusCode);
        await Read<MoveOutView>(await HandoverPost(tenant, id, "move-out/tenant-feedback", new InspectionTenantFeedback(1, false, "Tôi không đồng ý nguyên nhân thiếu ghế")));
        var reviewKey = Guid.NewGuid(); var review = new InspectionReviewInput(1, true, "Chỉ xác nhận hiện trạng, tài chính xử lý riêng", false, true, "Đã ghi nhận ý kiến tranh chấp của Tenant; chưa kết luận trách nhiệm");
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/inspection-review", review, reviewKey));
        await Read<MoveOutView>(await HandoverPost(owner, id, "move-out/inspection-review", review, reviewKey));
        await using (var check = host.Services.CreateAsyncScope())
        {
            var store = check.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            Assert.Equal(observed == 0 ? 4 : observed, (await store.AssetMetadataAsync([source.PhysicalAssets![0].Id], default)).Values.Single().Quantity);
            Assert.Equal(observed == 0 ? AssetStatus.Retired : AssetStatus.Active, (await store.AssetAsync(source.PhysicalAssets![0].Id, default))!.Status);
            var desired = Assert.Single(await store.ListAsync(w.Location, "DesiredAssets", default)); Assert.Equal(4, desired.Data.GetProperty("items")[0].GetProperty("quantity").GetInt32());
        }
        var result = await Read<ContractView>(await HandoverPost(owner, id, "move-out/complete", new CompletionInput(Today, "Unavailable")));
        Assert.Equal("Terminated", result.Status);
        var documents = (await tenant.GetFromJsonAsync<ContractDocumentView[]>(route + "/handover/documents"))!; var finalDocument = Assert.Single(documents, d => d.Kind == "MoveOutReport");
        Assert.True((await staff.GetByteArrayAsync(route + "/handover/documents/" + finalDocument.Id)).AsSpan(0, 5).SequenceEqual("%PDF-"u8));
        await using var verify = host.Services.CreateAsyncScope(); var finalDb = verify.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(sharedRoom ? RoomStatus.Occupied : RoomStatus.Unavailable, (await finalDb.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status);
        if (secondId is { } otherId) Assert.Equal(ContractStatus.Active, (await finalDb.Set<Contract>().SingleAsync(c => c.Id == otherId)).Status);
        Assert.Null((await finalDb.Set<ContractMoveOut>().SingleAsync(m => m.ContractId == id)).SettlementApprovedAt);
        Assert.Empty((await verify.ServiceProvider.GetRequiredService<ISettlementReceivablesRepository>().ContextAsync(id, default)).View.Receivables);
    }
}
