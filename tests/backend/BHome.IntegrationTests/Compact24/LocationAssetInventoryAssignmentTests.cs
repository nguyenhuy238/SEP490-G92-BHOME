using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Application.Operations;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class LocationAssetInventoryAssignmentTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!LocationAssets-493";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    private static Guid SetupKey(string value) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));

    private static async Task SaveRoomTemplateAsync(ISetupWorkspaceStore store, Guid locationId,
        Guid roomId, Guid ownerId, Guid templateId, AssetTemplateItem[] items)
    {
        await store.SaveAsync(templateId, locationId, "AssetTemplate", "Published",
            new AssetTemplateWrite(locationId, "Synthetic room asset template", items,
                Scoped: true, ScopeRoomId: roomId), 0, ownerId, default);
        await store.SaveAsync(SetupKey($"asset-template-assignment:{roomId}"), locationId,
            "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(templateId),
            0, ownerId, default);
    }

    private async Task<User> User(string role)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        // Compact24 enforces a single Owner per tenant database. Both test methods
        // share one disposable class fixture, so reuse its synthetic Owner.
        if (role == "Owner")
        {
            var existing = await db.Users.AsNoTracking()
                .FirstOrDefaultAsync(user => EF.Property<string[]>(user, "roles").Contains("Owner"));
            if (existing is not null) return existing;
        }
        var id = Guid.NewGuid();
        var user = new User
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
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>()
            .HashPassword(user, Password);
        db.Users.Add(user);
        db.Entry(user).Property("roles").CurrentValue = new[] { role };
        await db.SaveChangesAsync();
        return user;
    }

    private async Task<Guid> Location()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address) VALUES ({id},{"Synthetic assets " + id},'Synthetic address')");
        return id;
    }

    private async Task<HttpClient> Client(User account)
    {
        var client = fixture.Factory!.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = account.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }

    private static async Task<HttpResponseMessage> Action(HttpClient client, string route, object body, Guid? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        return await client.SendAsync(request);
    }
    private static async Task<LocationAssetInventoryView> Check(HttpClient client, string route, Guid itemId,
        int version, Guid? key = null)
    {
        using var change = new HttpRequestMessage(HttpMethod.Put, route + "/location-asset-inventory/items/" + itemId)
        { Content = JsonContent.Create(new LocationAssetInventoryItemWrite(version, true, "Đã kiểm tra thực tế")) };
        change.Headers.Add("Idempotency-Key", (key ?? Guid.NewGuid()).ToString());
        using var response = await client.SendAsync(change);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<LocationAssetInventoryView>())!;
    }

    [CompactPostgresFact]
    public async Task EffectiveAssignmentCreatesOneScopedTaskWithInheritedTenantHandoverAndStaffBlockers()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        var otherStaff = await User("Staff");
        var tenant = await User("Tenant");
        var location = await Location();
        var differentLocation = await Location();
        Guid roomId, assetId, commonAssetId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var room = new Room { LocationId = location, RoomNumber = "Synthetic-101", Status = RoomStatus.Occupied };
            db.Add(room);
            await db.SaveChangesAsync();
            roomId = room.Id;
            var asset = new Asset { LocationId = location, RoomId = roomId, Name = "Synthetic bed", Category = "Furniture", Status = AssetStatus.Active };
            db.Add(asset);
            await db.SaveChangesAsync();
            assetId = asset.Id;
            var commonAsset = new Asset
            {
                LocationId = location,
                RoomId = null,
                CommonArea = "Sảnh",
                Name = "Synthetic common fire extinguisher",
                Category = "Safety",
                Status = AssetStatus.Active
            };
            db.Add(commonAsset);
            await db.SaveChangesAsync();
            commonAssetId = commonAsset.Id;
            var resident = new Resident
            {
                RoomId = roomId,
                OwnerUserId = owner.Id,
                TenantUserId = tenant.Id,
                DisplayLabel = "Synthetic Resident",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(resident);
            await db.SaveChangesAsync();
            var contract = new Contract
            {
                RoomId = roomId,
                OwnerSignerId = owner.Id,
                TenantUserId = tenant.Id,
                RepresentativeResidentId = resident.Id,
                Kind = ContractKind.Main,
                Status = ContractStatus.Active,
                StartDate = Today.AddDays(-3),
                EndDate = Today.AddMonths(3),
                Terms = "Synthetic terms",
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = owner.Id
            };
            db.Add(contract);
            await db.SaveChangesAsync();
            var readings = new Dictionary<UtilityType, MeterReading>();
            foreach (var utility in new[] { UtilityType.Electricity, UtilityType.Water })
            {
                var meter = new Meter
                {
                    RoomId = roomId,
                    Code = "SYNT-HANDOVER-" + utility,
                    UtilityType = utility,
                    InstalledOn = Today.AddDays(-10)
                };
                db.Add(meter);
                await db.SaveChangesAsync();
                var capture = new OperationalTask
                {
                    RequiredLocationId = location,
                    MeterId = meter.Id,
                    Kind = OperationalTaskKind.MeterReading,
                    ReadingDate = Today.AddDays(-3),
                    Purpose = ReadingPurpose.Initial,
                    MeterStatus = MeterTaskStatus.Completed,
                    CompletedAt = DateTimeOffset.UtcNow
                };
                db.Add(capture);
                await db.SaveChangesAsync();
                var image = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0 };
                var evidence = new MeterEvidence
                {
                    TaskId = capture.Id,
                    UploadedByUserId = staff.Id,
                    ContentType = "image/png",
                    Length = image.Length,
                    ObjectKey = $"synthetic/{Guid.NewGuid():N}.png",
                    ImageHash = Convert.ToHexString(SHA256.HashData(image)),
                    IsUploaded = true,
                    IsLinked = true
                };
                // The disposable fixture only needs the confirmed reading FK and JSON
                // metadata. No image download or MinIO behavior is part of this test.
                db.Add(evidence);
                await db.SaveChangesAsync();
                var reading = new MeterReading
                {
                    MeterId = meter.Id,
                    TaskId = capture.Id,
                    EvidenceId = evidence.Id,
                    ConfirmedByUserId = staff.Id,
                    ConfirmedAt = DateTimeOffset.UtcNow,
                    ConfirmedValue = 100
                };
                db.Add(reading);
                await db.SaveChangesAsync();
                readings.Add(utility, reading);
            }
            var roomRequirementId = Guid.NewGuid();
            var snapshot = new BHome.Application.Contracts.HandoverSnapshot(Today.AddDays(-3), "Synthetic-101",
                "Tốt", "Đã bàn giao", "", [new BHome.Application.Contracts.HandoverAsset(
                    roomRequirementId, "Synthetic bed", "Tốt", "Tốt",
                    ConfigurationItemId: roomRequirementId, ConfiguredQuantity: 1, TrackingMode: "BulkQuantity",
                    PhysicalAssets: [new BHome.Application.Contracts.HandoverPhysicalAsset(
                        assetId, asset.Version, 1, asset.Condition.ToString(), asset.Status.ToString())],
                    OwnerChecked: true, ObservedQuantity: 1, HandedOverQuantity: 1,
                    GoodQuantity: 1, WornQuantity: 0, DamagedQuantity: 0, MissingQuantity: 0, Checked: true)],
                null!, null!, [], NoAssetsConfirmed: false);
            db.Add(new ContractHandover
            {
                ContractId = contract.Id,
                Status = ContractHandoverStatus.Confirmed,
                Version = 2,
                TenantConfirmedVersion = 2,
                ElectricityReadingId = readings[UtilityType.Electricity].Id,
                WaterReadingId = readings[UtilityType.Water].Id,
                TenantConfirmedBy = tenant.Id,
                StaffConfirmedBy = staff.Id,
                TenantConfirmedAt = DateTimeOffset.UtcNow,
                StaffConfirmedAt = DateTimeOffset.UtcNow,
                Snapshot = JsonSerializer.Serialize(snapshot)
            });
            await db.SaveChangesAsync();
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            var roomExpected = new[]
            {
                new AssetTemplateItem(roomRequirementId, "Synthetic bed", "Furniture", "BulkQuantity", 1),
                new AssetTemplateItem(Guid.NewGuid(), "Missing synthetic desk", "Furniture", "BulkQuantity", 1)
            };
            var templateId = Guid.NewGuid();
            await SaveRoomTemplateAsync(store, location, roomId, owner.Id, templateId, roomExpected);
            var desiredDocument = await store.SaveAsync(Guid.NewGuid(), location, "DesiredAssets", "PendingVerification",
                new DesiredAssets(templateId, 1, roomId, roomExpected, "PendingVerification"), 0, owner.Id, default);
            await store.SaveAsync(SetupKey($"owner-attestation:{roomId:N}:{templateId:N}:{roomExpected[0].Id:N}:{assetId:N}"), location, "AssetVerification", "Verified",
                new
                {
                    roomId,
                    templateId,
                    itemId = roomExpected[0].Id,
                    assetId,
                    quantity = 1,
                    source = "OwnerAttestation"
                }, 0, owner.Id, default);
            await store.SaveAsync(SetupKey($"room-inventory-checklist:{roomId:N}"), location, "RoomInventoryChecklistReview", "PartiallyChecked",
                new
                {
                    roomId,
                    desiredId = desiredDocument.Id,
                    desiredVersion = desiredDocument.Version,
                    baseline = "synthetic-reviewed",
                    state = "PartiallyChecked",
                    requestId = Guid.NewGuid(),
                    items = new[] { new { itemId = roomExpected[0].Id, @checked = true, evidenceIds = Array.Empty<Guid>() },
                        new { itemId = roomExpected[1].Id, @checked = false, evidenceIds = Array.Empty<Guid>() } },
                    unlinkedAssetIds = Array.Empty<Guid>()
                }, 0, owner.Id, default);
            var commonRequirement = new SetupCommonAssetRequirement(Guid.NewGuid(), "Synthetic common fire extinguisher",
                "Safety", "BulkQuantity", 1, "Sảnh");
            await store.SaveAsync(Guid.NewGuid(), location, "CommonAssetRequirements", "Configured",
                new CommonAssetRequirementsWrite([commonRequirement]), 0, owner.Id, default);
            var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                commonRequirement.Id,
                commonRequirement.Name,
                commonRequirement.Category,
                commonRequirement.CommonArea,
                commonRequirement.Quantity,
                commonRequirement.Unit
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))));
            await store.SaveAsync(Guid.NewGuid(), location, "CommonAssetInventoryVerification", "Verified",
                new
                {
                    itemId = commonRequirement.Id,
                    assetId = (Guid?)commonAssetId,
                    fingerprint,
                    evidenceIds = Array.Empty<Guid>(),
                    requestId = Guid.NewGuid()
                }, 0, owner.Id, default);
        }
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, location, staff.Id, Today, Today.AddDays(15), default)).Status);
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, differentLocation, otherStaff.Id, Today, Today.AddDays(15), default)).Status);
        }

        Guid taskId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var tasks = await db.Set<OperationalTask>().AsNoTracking().Where(t => t.RequiredLocationId == location &&
                t.Kind == OperationalTaskKind.LocationAssetHandover).ToArrayAsync();
            taskId = Assert.Single(tasks).Id;
            Assert.Equal(staff.Id, tasks[0].AssignedStaffUserId);
            Assert.Single(await db.Set<OperationalTaskNotification>().Where(n => n.TaskId == taskId && n.RecipientUserId == staff.Id).ToArrayAsync());
        }

        using var ownerClient = await Client(owner);
        using var staffClient = await Client(staff);
        using var stranger = await Client(otherStaff);
        var route = $"/api/v1/operational-tasks/{taskId}";
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(route + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(route + "/location-asset-inventory")).StatusCode);
        var inventory = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(route + "/location-asset-inventory"))!;
        Assert.Equal(2, inventory.TotalCount); // Owner-confirmed bed and common asset; missing configured desk omitted.
        var inherited = Assert.Single(inventory.Items, item => item.AssetId == assetId);
        Assert.True(inherited.Checked && inherited.Inherited && inherited.SourceHandoverContractId.HasValue);
        Assert.Equal(1, inventory.CheckedCount);
        Assert.Contains("Synthetic-101", inventory.PendingOwnerRooms!);
        Assert.False(inventory.PendingOwnerCommonAssets);
        Assert.DoesNotContain(inventory.Items, item => item.Name == "Missing synthetic desk");
        var common = Assert.Single(inventory.Items, item => item.CommonArea == "Sảnh");
        Assert.Equal("Synthetic common fire extinguisher", common.Name);
        Assert.Equal(commonAssetId, common.AssetId);
        var preview = (await ownerClient.GetFromJsonAsync<LocationAssetInventoryReconcilePreview>(
            route + "/location-asset-inventory/reconcile-preview"))!;
        Assert.True(preview.CanApply);
        Assert.Equal(2, preview.OwnerConfirmedCount);
        var started = await Action(staffClient, route + "/start", new { version = inventory.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        // Emulate a pre-fix in-progress assignment with one extra configured-only
        // group. The explicit Owner reconcile must remove only this untouched item.
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var tracked = await db.Set<OperationalTask>().SingleAsync(entry => entry.Id == taskId);
            var previous = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(tracked.LocationAssetInventoryJson)!;
            tracked.LocationAssetInventoryJson = JsonSerializer.Serialize(previous with
            {
                Items = [.. previous.Items, new LocationAssetInventoryItem(Guid.NewGuid(), roomId,
                    "Synthetic-101", null, "Legacy-only configured asset", 1, null)]
            });
            await db.SaveChangesAsync();
        }
        var oldPreview = (await ownerClient.GetFromJsonAsync<LocationAssetInventoryReconcilePreview>(
            route + "/location-asset-inventory/reconcile-preview"))!;
        Assert.True(oldPreview.CanApply);
        Assert.Equal(3, oldPreview.CurrentCount);
        Assert.Equal(2, oldPreview.OwnerConfirmedCount);
        Assert.Equal(1, oldPreview.RemovedCount);
        using (var reconciledResponse = await Action(ownerClient, route + "/location-asset-inventory/reconcile",
            new { version = task.Version, confirmed = true }))
        {
            Assert.Equal(HttpStatusCode.OK, reconciledResponse.StatusCode);
            var reconciled = (await reconciledResponse.Content.ReadFromJsonAsync<LocationAssetInventoryView>())!;
            Assert.Equal(2, reconciled.TotalCount);
            Assert.DoesNotContain(reconciled.Items, item => item.Name == "Legacy-only configured asset");
            Assert.Contains("Synthetic-101", reconciled.PendingOwnerRooms!);
        }
        task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        using (var scope = fixture.Factory!.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            Assert.Contains(await db.Set<OperationalTaskHistory>().AsNoTracking().Where(h => h.TaskId == taskId).ToArrayAsync(),
                h => h.Action == "location_asset_inventory_owner_reconciled");
        }
        Assert.Equal(HttpStatusCode.Conflict, (await Action(staffClient, route + "/submit", new { version = task.Version, note = "Kiểm kê" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Action(staffClient, route + "/blockers", new { version = task.Version, note = "Đang chờ kiểm tra khu vực chung" })).StatusCode);
        task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        var firstCheckKey = Guid.NewGuid();
        var firstView = await Check(staffClient, route, common.Id, task.Version, firstCheckKey);
        var replay = await Check(staffClient, route, common.Id, task.Version, firstCheckKey);
        Assert.Equal(firstView.Version, replay.Version);
        var checkedView = firstView;
        Assert.Equal(checkedView.TotalCount, checkedView.CheckedCount);
        // The second configured room asset has NOT been verified by Owner.
        // Staff cannot submit an apparently complete whole-location handover yet.
        using var blocked = await Action(staffClient, route + "/submit", new { version = checkedView.Version, note = "Đã hoàn thành kiểm kê" });
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Equal("InProgress", (await ownerClient.GetFromJsonAsync<TaskView>(route))!.Status);

        // Owner confirms the remaining configured group after Staff has already checked
        // every available item. The live task must receive it in the same transaction.
        var reviewRoute = $"/api/v1/locations/{location}/room-inventory-review";
        var ownerReview = (await ownerClient.GetFromJsonAsync<RoomInventoryReviewView>(reviewRoute))!;
        var roomReview = Assert.Single(ownerReview.Rooms);
        var confirmation = new RoomInventoryReviewConfirm(Guid.NewGuid(),
            [new RoomInventoryReviewInputRoom(roomId, roomReview.DesiredId, roomReview.DesiredVersion,
                roomReview.StateToken, roomReview.Items.Select(item =>
                    new RoomInventoryReviewInputItem(item.Id, true, [])).ToArray())], true);
        using var confirmedResponse = await ownerClient.PostAsJsonAsync(reviewRoute + "/confirm", confirmation);
        Assert.True(confirmedResponse.IsSuccessStatusCode, await confirmedResponse.Content.ReadAsStringAsync());
        var confirmedRoom = Assert.Single((await confirmedResponse.Content.ReadFromJsonAsync<RoomInventoryReviewView>())!.Rooms);
        Assert.Equal("Matched", confirmedRoom.State);
        Assert.Equal(2, confirmedRoom.CheckedCount);
        var synced = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(route + "/location-asset-inventory"))!;
        Assert.Equal("InProgress", synced.Status);
        Assert.Equal(3, synced.TotalCount);
        Assert.Equal(2, synced.CheckedCount);
        Assert.Empty(synced.PendingOwnerRooms!);
        Assert.True(synced.Version > checkedView.Version);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(reviewRoute + "/confirm", confirmation)).StatusCode);
        Assert.Equal(synced.Version,
            (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(route + "/location-asset-inventory"))!.Version);
        var desk = Assert.Single(synced.Items, item => !item.Checked);
        Assert.Equal("Missing synthetic desk", desk.Name);
        var completed = await Check(staffClient, route, desk.Id, synced.Version);
        Assert.Equal("PendingVerification", completed.Status);
        Assert.Equal(completed.TotalCount, completed.CheckedCount);
    }

    [CompactPostgresFact]
    public async Task ConfirmedTenantHandoverBaselineCannotBeRewrittenAfterReplacementAssetInventoryIsSubmitted()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        var tenant = await User("Tenant");
        var location = await Location();
        Guid roomId, requirementId, previousAssetId, currentAssetId, contractId;
        BHome.Application.Contracts.HandoverSnapshot tenantSnapshot;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var room = new Room { LocationId = location, RoomNumber = "Synthetic-102", Status = RoomStatus.Occupied };
            db.Add(room);
            await db.SaveChangesAsync();
            roomId = room.Id;

            var previousAsset = new Asset
            {
                LocationId = location,
                RoomId = roomId,
                Name = "Synthetic bed",
                Category = "Furniture",
                Status = AssetStatus.Retired
            };
            var currentAsset = new Asset
            {
                LocationId = location,
                RoomId = roomId,
                Name = "Synthetic bed",
                Category = "Furniture",
                Status = AssetStatus.Active
            };
            db.AddRange(previousAsset, currentAsset);
            await db.SaveChangesAsync();
            previousAssetId = previousAsset.Id;
            currentAssetId = currentAsset.Id;

            var resident = new Resident
            {
                RoomId = roomId,
                OwnerUserId = owner.Id,
                TenantUserId = tenant.Id,
                DisplayLabel = "Synthetic Resident",
                VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(resident);
            await db.SaveChangesAsync();
            var contract = new Contract
            {
                RoomId = roomId,
                OwnerSignerId = owner.Id,
                TenantUserId = tenant.Id,
                RepresentativeResidentId = resident.Id,
                Kind = ContractKind.Main,
                Status = ContractStatus.Active,
                StartDate = Today.AddDays(-3),
                EndDate = Today.AddMonths(3),
                Terms = "Synthetic terms",
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = owner.Id
            };
            db.Add(contract);
            await db.SaveChangesAsync();
            contractId = contract.Id;

            var readings = new Dictionary<UtilityType, MeterReading>();
            foreach (var utility in new[] { UtilityType.Electricity, UtilityType.Water })
            {
                var meter = new Meter
                {
                    RoomId = roomId,
                    Code = $"SYNRPL-{Guid.NewGuid():N}-{utility}",
                    UtilityType = utility,
                    InstalledOn = Today.AddDays(-10)
                };
                db.Add(meter);
                await db.SaveChangesAsync();
                var capture = new OperationalTask
                {
                    RequiredLocationId = location,
                    MeterId = meter.Id,
                    Kind = OperationalTaskKind.MeterReading,
                    ReadingDate = Today.AddDays(-3),
                    Purpose = ReadingPurpose.Initial,
                    MeterStatus = MeterTaskStatus.Completed,
                    CompletedAt = DateTimeOffset.UtcNow
                };
                db.Add(capture);
                await db.SaveChangesAsync();
                var image = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0 };
                var evidence = new MeterEvidence
                {
                    TaskId = capture.Id,
                    UploadedByUserId = staff.Id,
                    ContentType = "image/png",
                    Length = image.Length,
                    ObjectKey = $"synthetic/{Guid.NewGuid():N}.png",
                    ImageHash = Convert.ToHexString(SHA256.HashData(image)),
                    IsUploaded = true,
                    IsLinked = true
                };
                db.Add(evidence);
                await db.SaveChangesAsync();
                var reading = new MeterReading
                {
                    MeterId = meter.Id,
                    TaskId = capture.Id,
                    EvidenceId = evidence.Id,
                    ConfirmedByUserId = staff.Id,
                    ConfirmedAt = DateTimeOffset.UtcNow,
                    ConfirmedValue = 100
                };
                db.Add(reading);
                await db.SaveChangesAsync();
                readings.Add(utility, reading);
            }

            requirementId = Guid.NewGuid();
            tenantSnapshot = new BHome.Application.Contracts.HandoverSnapshot(
                Today.AddDays(-3), room.RoomNumber, "Tốt", "Đã bàn giao", "",
                [new BHome.Application.Contracts.HandoverAsset(requirementId, "Synthetic bed", "Tốt", "Tốt",
                    ConfigurationItemId: requirementId, ConfiguredQuantity: 1, TrackingMode: "BulkQuantity",
                    PhysicalAssets: [new BHome.Application.Contracts.HandoverPhysicalAsset(
                        previousAssetId, previousAsset.Version, 1, "Tốt", "Active")],
                    OwnerChecked: true, ObservedQuantity: 1, HandedOverQuantity: 1,
                    GoodQuantity: 1, WornQuantity: 0, DamagedQuantity: 0, MissingQuantity: 0, Checked: true)],
                null!, null!, [], NoAssetsConfirmed: false);
            db.Add(new ContractHandover
            {
                ContractId = contract.Id,
                Status = ContractHandoverStatus.Confirmed,
                Version = 2,
                TenantConfirmedVersion = 2,
                ElectricityReadingId = readings[UtilityType.Electricity].Id,
                WaterReadingId = readings[UtilityType.Water].Id,
                TenantConfirmedBy = tenant.Id,
                StaffConfirmedBy = staff.Id,
                TenantConfirmedAt = DateTimeOffset.UtcNow,
                StaffConfirmedAt = DateTimeOffset.UtcNow,
                Snapshot = JsonSerializer.Serialize(tenantSnapshot)
            });
            await db.SaveChangesAsync();

            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            var roomItems = new[]
            {
                new AssetTemplateItem(requirementId, "Synthetic bed", "Furniture", "BulkQuantity", 1)
            };
            var templateId = Guid.NewGuid();
            await SaveRoomTemplateAsync(store, location, roomId, owner.Id, templateId, roomItems);
            var desired = await store.SaveAsync(Guid.NewGuid(), location, "DesiredAssets", "PendingVerification",
                new DesiredAssets(templateId, 1, roomId, roomItems, "PendingVerification"), 0, owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), location, "AssetVerification", "Verified", new
            {
                roomId,
                templateId,
                itemId = requirementId,
                assetId = currentAssetId,
                quantity = 1,
                source = "OwnerAttestation"
            }, 0, owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), location, "RoomInventoryChecklistReview", "Matched", new
            {
                roomId,
                desiredId = desired.Id,
                desiredVersion = desired.Version,
                baseline = "synthetic-replacement-owner-baseline",
                state = "Matched",
                requestId = Guid.NewGuid(),
                items = new[] { new { itemId = requirementId, @checked = true, evidenceIds = Array.Empty<Guid>() } },
                unlinkedAssetIds = Array.Empty<Guid>()
            }, 0, owner.Id, default);

            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, location, staff.Id, Today, Today.AddDays(15), default)).Status);
        }

        Guid taskId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            taskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.RequiredLocationId == location && task.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(task => task.Id).SingleAsync();
        }
        using var staffClient = await Client(staff);
        var route = $"/api/v1/operational-tasks/{taskId}";
        var inventory = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;
        var replacement = Assert.Single(inventory.Items);
        Assert.Equal(currentAssetId, replacement.AssetId);
        Assert.NotEqual(previousAssetId, replacement.AssetId);
        Assert.False(replacement.Checked);
        Assert.False(replacement.Inherited);
        Assert.Null(replacement.SourceHandoverContractId);

        var started = await Action(staffClient, route + "/start", new { version = inventory.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        var checkedInventory = await Check(staffClient, route, replacement.Id, task.Version);
        Assert.Equal("PendingVerification", checkedInventory.Status);
        var submitted = await Action(staffClient, route + "/submit", new
        {
            version = checkedInventory.Version,
            note = "Staff đã trực tiếp kiểm tra tài sản thay thế."
        });
        Assert.Equal(HttpStatusCode.OK, submitted.StatusCode);
        Assert.Equal("PendingVerification", (await submitted.Content.ReadFromJsonAsync<TaskView>())!.Status);
        Assert.Equal(checkedInventory.Version, (await staffClient.GetFromJsonAsync<TaskView>(route))!.Version);

        // A confirmed Tenant handover is an immutable historical baseline. A later
        // replacement asset must be recorded as a separate asset-change event, not by
        // rewriting the original signed snapshot after the Staff checklist is submitted.
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var handover = await db.Set<ContractHandover>().SingleAsync(item => item.ContractId == contractId);
            var changedSnapshot = tenantSnapshot with
            {
                Assets = tenantSnapshot.Assets.Select(group => group with
                {
                    PhysicalAssets = [new BHome.Application.Contracts.HandoverPhysicalAsset(
                        currentAssetId, 1, 1, "Tốt", "Active")]
                }).ToArray()
            };
            handover.Snapshot = JsonSerializer.Serialize(changedSnapshot);
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            await db.Entry(handover).ReloadAsync();
            var persisted = JsonSerializer.Deserialize<BHome.Application.Contracts.HandoverSnapshot>(handover.Snapshot)!;
            Assert.Equal(previousAssetId, Assert.Single(persisted.Assets).PhysicalAssets!.Single().Id);
        }
    }

    [CompactPostgresFact]
    public async Task OnlyExplicitOwnerConfirmedEmptyRoomsBecomeChecklistItems()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        var location = await Location();
        Guid emptyRoomId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var empty = new Room { LocationId = location, RoomNumber = "Empty-confirmed" };
            var unreviewed = new Room { LocationId = location, RoomNumber = "Not-owner-reviewed" };
            db.AddRange(empty, unreviewed);
            await db.SaveChangesAsync();
            emptyRoomId = empty.Id;
            var baseline = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                Id = empty.Id,
                assignment = (object?)null,
                desired = (object?)null
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))));
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            await store.SaveAsync(Guid.NewGuid(), location, "RoomNoAssets", "Confirmed",
                new { roomId = empty.Id, baseline, reason = "Owner đã xác nhận phòng trống" },
                0, owner.Id, default);
        }
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(owner.Id,
                location, staff.Id, Today, Today.AddDays(7), default)).Status);
        }
        using var staffClient = await Client(staff);
        var task = (await staffClient.GetFromJsonAsync<TaskPage<TaskView>>(
            $"/api/v1/operational-tasks?locationId={location}&page=1&pageSize=20"))!;
        var taskId = Assert.Single(task.Items, item => item.Kind == "LocationAssetHandover").Id;
        var view = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(
            $"/api/v1/operational-tasks/{taskId}/location-asset-inventory"))!;
        var only = Assert.Single(view.Items);
        Assert.Equal(emptyRoomId, only.RoomId);
        Assert.Null(only.AssetId);
        Assert.Equal(0, only.Quantity);
        Assert.Contains("Not-owner-reviewed", view.PendingOwnerRooms!);
        Assert.DoesNotContain("Empty-confirmed", view.PendingOwnerRooms!);
        Assert.False(view.PendingOwnerCommonAssets);
    }

    [CompactPostgresFact]
    public async Task LegacyCompleteInventoryRecoversOnOwnerConfirmationOrAssignmentReconciliationWithoutManualSync()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        using var ownerClient = await Client(owner);
        using var staffClient = await Client(staff);
        foreach (var confirmThroughOwner in new[] { true, false })
        {
            var location = await Location();
            var room = new Room { LocationId = location, RoomNumber = "LEGACY-COMPLETE" };
            var baseline = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                Id = room.Id,
                assignment = (object?)null,
                desired = (object?)null
            }, Json)));
            var emptyKey = SetupKey($"room-no-assets:{room.Id:N}");
            Guid taskId;
            int version;
            await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
                db.Add(room);
                await db.SaveChangesAsync();
                var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
                await store.SaveAsync(emptyKey, location, "RoomNoAssets", "Confirmed",
                    new { roomId = room.Id, baseline, reason = "Owner xác nhận không có tài sản" },
                    0, owner.Id, default);
                var created = await scope.ServiceProvider.GetRequiredService<ILocationAssignments>()
                    .CreateAssignmentAsync(owner.Id, location, staff.Id, Today, Today.AddDays(7), default);
                Assert.Equal(CreateAssignmentStatus.Created, created.Status);
                taskId = LocationAssetInventoryTaskFactory.TaskId(created.Assignment!.Id);
            }
            await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
                var task = await db.Set<OperationalTask>().SingleAsync(x => x.Id == taskId);
                var snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.LocationAssetInventoryJson)!;
                // Persist a synthetic pre-release task that Staff already checked, but
                // whose Owner scope flag was never refreshed and still waits for submit.
                task.MeterStatus = MeterTaskStatus.InProgress;
                task.LocationAssetInventoryJson = JsonSerializer.Serialize(snapshot with
                {
                    Items = snapshot.Items.Select(item => item with { Checked = true, Condition = "Intact" }).ToArray(),
                    PendingOwnerRooms = [room.RoomNumber]
                });
                task.Version++;
                version = task.Version;
                await db.SaveChangesAsync();
                // An invalidated authoritative row must not disappear or auto-submit.
                var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
                await store.SaveAsync(emptyKey, location, "RoomNoAssets", "Confirmed",
                    new { roomId = room.Id, baseline = "invalidated", reason = "Synthetic stale source" },
                    1, owner.Id, default);
            }
            var route = $"/api/v1/operational-tasks/{taskId}";
            await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
                await scope.ServiceProvider.GetRequiredService<AssignmentReconciliationJob>()
                    .ExecuteAsync(new(Guid.NewGuid(), "legacy-conflict", "{}"), default);
            var conflict = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(route + "/location-asset-inventory"))!;
            Assert.Equal("InProgress", conflict.Status);
            Assert.Equal(version, conflict.Version);
            Assert.True(Assert.Single(conflict.Items).Checked);
            if (confirmThroughOwner)
            {
                var preparationRoute = $"/api/v1/locations/{location}/room-inventory-review/{room.Id}";
                var preparation = (await ownerClient.GetFromJsonAsync<BHome.Application.Contracts.HandoverInventory>(
                    preparationRoute + "/handover-preparation"))!;
                using var response = await ownerClient.PostAsJsonAsync(preparationRoute + "/no-assets",
                    new RoomNoAssetsConfirmation(preparation.StateToken, "Owner xác nhận lại phòng không có tài sản"));
                Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            }
            else
            {
                await using var scope = fixture.Factory!.Services.CreateAsyncScope();
                var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
                await store.SaveAsync(emptyKey, location, "RoomNoAssets", "Confirmed",
                    new { roomId = room.Id, baseline, reason = "Synthetic previously persisted Owner confirmation" },
                    2, owner.Id, default);
                await scope.ServiceProvider.GetRequiredService<AssignmentReconciliationJob>()
                    .ExecuteAsync(new(Guid.NewGuid(), "legacy-recovery", "{}"), default);
            }
            var completed = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(route + "/location-asset-inventory"))!;
            Assert.Equal("PendingVerification", completed.Status);
            Assert.Empty(completed.PendingOwnerRooms!);
            Assert.Equal(version + 1, completed.Version);
            Assert.True(Assert.Single(completed.Items).Checked);
            using var legacySubmit = await Action(staffClient, route + "/submit",
                new { version = completed.Version, note = "Legacy submit retry" });
            Assert.Equal(HttpStatusCode.OK, legacySubmit.StatusCode);
            Assert.Equal(completed.Version, (await legacySubmit.Content.ReadFromJsonAsync<TaskView>())!.Version);
            await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
                Assert.Equal(1, await db.Set<OperationalTaskHistory>().CountAsync(h => h.TaskId == taskId && h.Action == "submit"));
            }
        }
    }

    [CompactPostgresFact]
    public async Task ReplacementSupersedes25Of42ChecklistAndSuccessorContinues17WithoutLosingProvenance()
    {
        var owner = await User("Owner");
        var first = await User("Staff");
        var successor = await User("Staff");
        var location = await Location();
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var room = new Room { LocationId = location, RoomNumber = "TRANSFER-42" };
            db.Add(room);
            await db.SaveChangesAsync();
            var expected = Enumerable.Range(1, 42).Select(n =>
                new AssetTemplateItem(Guid.NewGuid(), $"Verified asset {n:00}", "Furniture", "BulkQuantity", 1)).ToArray();
            var assets = expected.Select(x => new Asset
            {
                LocationId = location,
                RoomId = room.Id,
                Name = x.Name,
                Category = x.Category,
                Status = AssetStatus.Active
            }).ToArray();
            db.AddRange(assets);
            await db.SaveChangesAsync();
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            var templateId = Guid.NewGuid();
            await SaveRoomTemplateAsync(store, location, room.Id, owner.Id, templateId, expected);
            var desired = await store.SaveAsync(Guid.NewGuid(), location, "DesiredAssets", "PendingVerification",
                new DesiredAssets(templateId, 1, room.Id, expected, "PendingVerification"), 0, owner.Id, default);
            for (var i = 0; i < expected.Length; i++)
                await store.SaveAsync(Guid.NewGuid(), location, "AssetVerification", "Verified",
                    new
                    {
                        roomId = room.Id,
                        templateId,
                        itemId = expected[i].Id,
                        assetId = assets[i].Id,
                        quantity = 1,
                        source = "OwnerAttestation"
                    }, 0, owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), location, "RoomInventoryChecklistReview", "Matched",
                new
                {
                    roomId = room.Id,
                    desiredId = desired.Id,
                    desiredVersion = desired.Version,
                    items = expected.Select(x => new
                    {
                        itemId = x.Id,
                        @checked = true,
                        evidenceIds = Array.Empty<Guid>()
                    }).ToArray(),
                    unlinkedAssetIds = Array.Empty<Guid>()
                },
                0, owner.Id, default);
        }
        Guid firstAssignment;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var assignment = await scope.ServiceProvider.GetRequiredService<ILocationAssignments>()
                .CreateAssignmentAsync(owner.Id, location, first.Id, Today, Today.AddDays(14), default);
            Assert.Equal(CreateAssignmentStatus.Created, assignment.Status);
            firstAssignment = assignment.Assignment!.Id;
        }
        var oldTaskId = LocationAssetInventoryTaskFactory.TaskId(firstAssignment);
        var oldRoute = $"/api/v1/operational-tasks/{oldTaskId}";
        using var firstClient = await Client(first);
        using var ownerClient = await Client(owner);
        using var successorClient = await Client(successor);
        var initial = (await firstClient.GetFromJsonAsync<LocationAssetInventoryView>(
            oldRoute + "/location-asset-inventory"))!;
        Assert.Equal(42, initial.TotalCount);
        Assert.Equal(0, initial.CheckedCount);
        Assert.Empty(initial.PendingOwnerRooms!);
        var started = await Action(firstClient, oldRoute + "/start", new { version = initial.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var version = (await started.Content.ReadFromJsonAsync<TaskView>())!.Version;
        foreach (var item in initial.Items.Take(25))
            version = (await Check(firstClient, oldRoute, item.Id, version)).Version;
        var partiallyChecked = (await firstClient.GetFromJsonAsync<LocationAssetInventoryView>(
            oldRoute + "/location-asset-inventory"))!;
        Assert.Equal(25, partiallyChecked.CheckedCount);

        Guid successorAssignment;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var versionBefore = await db.Locations.Where(x => x.Id == location).Select(x => x.Version).SingleAsync();
            var change = await scope.ServiceProvider.GetRequiredService<ILocationAssignments>()
                .ReplaceAssignmentAsync(owner.Id, location, successor.Id, Today, versionBefore,
                    "Synthetic handover transfer A to B", default);
            Assert.Equal(ChangeAssignmentStatus.Changed, change.Status);
            successorAssignment = change.Assignment!.Id;
            var transferred = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(task => task.Id == oldTaskId);
            var transferredSnapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(transferred.LocationAssetInventoryJson, Json)!;
            Assert.Equal(successorAssignment, transferred.AssignmentId);
            Assert.Equal(successorAssignment, transferredSnapshot.AssignmentId);
            Assert.NotNull(transferredSnapshot.Items);
            Assert.Equal(transferredSnapshot.Items.Length, transferredSnapshot.Items.Select(item => item.Id).Distinct().Count());
        }
        var successorTaskId = LocationAssetInventoryTaskFactory.TaskId(successorAssignment);
        // The task is Location-owned: a replacement Staff continues the same task ID.
        var successorRoute = oldRoute;
        var ownerInventoryResponse = await ownerClient.GetAsync(oldRoute + "/location-asset-inventory");
        var ownerInventoryBody = await ownerInventoryResponse.Content.ReadAsStringAsync();
        Assert.True(ownerInventoryResponse.IsSuccessStatusCode,
            $"Owner inventory read failed: {(int)ownerInventoryResponse.StatusCode} {ownerInventoryBody}");
        var oldInventory = JsonSerializer.Deserialize<LocationAssetInventoryView>(ownerInventoryBody, Json)!;
        Assert.Equal("InProgress", oldInventory.Status);
        Assert.Equal(25, oldInventory.CheckedCount);
        Assert.All(oldInventory.Items.Take(25), item => Assert.True(item.Checked));
        Assert.Equal(HttpStatusCode.NotFound, (await firstClient.GetAsync(oldRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await firstClient.GetAsync(oldRoute + "/history")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await successorClient.GetAsync(successorRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await successorClient.GetAsync(successorRoute + "/history")).StatusCode);
        var successorTask = (await successorClient.GetFromJsonAsync<TaskView>(successorRoute))!;
        Assert.Equal(successor.Id, successorTask.CurrentResponsibleStaffUserId);
        Assert.Equal(successor.Id, successorTask.RecordedStaffUserId);
        Assert.Equal(HttpStatusCode.NotFound, (await Action(firstClient, oldRoute + "/progress",
            new { version = oldInventory.Version, note = "Staff cũ không còn quyền tiếp tục." })).StatusCode);
        using (var attempt = new HttpRequestMessage(HttpMethod.Put,
            oldRoute + "/location-asset-inventory/items/" + oldInventory.Items[0].Id)
        { Content = JsonContent.Create(new LocationAssetInventoryItemWrite(oldInventory.Version, false)) })
        {
            attempt.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.NotFound, (await firstClient.SendAsync(attempt)).StatusCode);
        }
        var fresh = (await successorClient.GetFromJsonAsync<LocationAssetInventoryView>(
            successorRoute + "/location-asset-inventory"))!;
        Assert.Equal("InProgress", fresh.Status);
        Assert.Equal(42, fresh.TotalCount);
        Assert.Equal(25, fresh.CheckedCount);
        Assert.Equal(17, fresh.TotalCount - fresh.CheckedCount);
        var inherited = fresh.Items.Where(i => i.PriorStaffTaskId == oldTaskId).ToArray();
        Assert.Equal(25, inherited.Length);
        Assert.All(inherited, i =>
        {
            Assert.True(i.Checked);
            Assert.Equal(first.Id, i.PriorStaffUserId);
        });
        var continued = await Check(successorClient, successorRoute, fresh.Items.First(item => !item.Checked).Id,
            fresh.Version);
        Assert.Equal(26, continued.CheckedCount);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            Assert.Equal(1, await db.Set<OperationalTaskHistory>().CountAsync(h =>
                h.TaskId == oldTaskId && h.Action == "responsibility_changed"));
            Assert.Equal(25, await db.Set<OperationalTaskHistory>().CountAsync(h =>
                h.TaskId == oldTaskId && h.Action == "location_asset_inventory_item_checked" && h.ActorId == first.Id));
            Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(t =>
                t.RequiredLocationId == location && t.Kind == OperationalTaskKind.LocationAssetHandover &&
                t.MeterStatus == MeterTaskStatus.InProgress && t.Id == oldTaskId &&
                t.AssignedStaffUserId == successor.Id && t.AssignmentId == successorAssignment));
            Assert.False(await db.Set<OperationalTask>().AnyAsync(t => t.Id == successorTaskId));
        }
        var responsibilities = (await ownerClient.GetFromJsonAsync<StaffResponsibilitiesView>(
            $"/api/v1/staff/{first.Id}/responsibilities"))!;
        Assert.True(responsibilities.CanDeactivate);
        // Re-running the same scheduler reconciliation must neither duplicate history nor reset B.
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var jobs = scope.ServiceProvider.GetRequiredService<AssignmentReconciliationJob>();
            await jobs.ExecuteAsync(new(Guid.NewGuid(), "synthetic-transfer-retry", "{}"), default);
        }
        Assert.Equal(26, (await successorClient.GetFromJsonAsync<LocationAssetInventoryView>(
            successorRoute + "/location-asset-inventory"))!.CheckedCount);
    }

    [CompactPostgresFact]
    public async Task ChecklistUsesOnlyCurrentPublishedTemplateAndRejectsMalformedQuantityMetadata()
    {
        var owner = await User("Owner");
        var staff = await User("Staff");
        var location = await Location();
        var validRoom = new Room { LocationId = location, RoomNumber = "PROVENANCE-VALID" };
        var changedRoom = new Room { LocationId = location, RoomNumber = "PROVENANCE-CHANGED" };
        var removedRoom = new Room { LocationId = location, RoomNumber = "PROVENANCE-REMOVED" };
        var archivedRoom = new Room { LocationId = location, RoomNumber = "PROVENANCE-ARCHIVED" };
        var malformedRoom = new Room { LocationId = location, RoomNumber = "PROVENANCE-MALFORMED" };
        var assets = new[]
        {
            new Asset { LocationId = location, RoomId = validRoom.Id, Name = "Quantity three", Category = "Furniture", Status = AssetStatus.Active },
            new Asset { LocationId = location, RoomId = changedRoom.Id, Name = "Stale after assignment change", Category = "Furniture", Status = AssetStatus.Active },
            new Asset { LocationId = location, RoomId = removedRoom.Id, Name = "Stale after unassignment", Category = "Furniture", Status = AssetStatus.Active },
            new Asset { LocationId = location, RoomId = archivedRoom.Id, Name = "Stale after archive", Category = "Furniture", Status = AssetStatus.Active },
            new Asset { LocationId = location, RoomId = malformedRoom.Id, Name = "Malformed quantity", Category = "Furniture", Status = AssetStatus.Active }
        };
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            db.AddRange(validRoom, changedRoom, removedRoom, archivedRoom, malformedRoom);
            db.AddRange(assets);
            db.Entry(assets[0]).Property<string>("PurchaseInfo").CurrentValue = JsonSerializer.Serialize(
                new AssetMetadata("BulkQuantity", 3, null, null, null, "cái"), Json);
            db.Entry(assets[4]).Property<string>("PurchaseInfo").CurrentValue =
                "{\"trackingMode\":\"BulkQuantity\",\"quantity\":\"three\",\"unit\":\"cái\"}";
            await db.SaveChangesAsync();

            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            async Task SeedOwnerConfirmedRoom(Room room, Asset asset, Guid templateId, AssetTemplateItem item)
            {
                await SaveRoomTemplateAsync(store, location, room.Id, owner.Id, templateId, [item]);
                var desired = await store.SaveAsync(Guid.NewGuid(), location, "DesiredAssets", "PendingVerification",
                    new DesiredAssets(templateId, 1, room.Id, [item], "PendingVerification"), 0, owner.Id, default);
                await store.SaveAsync(Guid.NewGuid(), location, "AssetVerification", "Verified", new
                {
                    roomId = room.Id,
                    templateId,
                    itemId = item.Id,
                    assetId = asset.Id,
                    quantity = item.Quantity,
                    source = "OwnerAttestation"
                }, 0, owner.Id, default);
                await store.SaveAsync(Guid.NewGuid(), location, "RoomInventoryChecklistReview", "Matched", new
                {
                    roomId = room.Id,
                    desiredId = desired.Id,
                    desiredVersion = desired.Version,
                    baseline = "synthetic-current-template-review",
                    state = "Matched",
                    requestId = Guid.NewGuid(),
                    items = new[] { new { itemId = item.Id, @checked = true, evidenceIds = Array.Empty<Guid>() } },
                    unlinkedAssetIds = Array.Empty<Guid>()
                }, 0, owner.Id, default);
            }

            var validTemplate = Guid.NewGuid();
            var validItem = new AssetTemplateItem(Guid.NewGuid(), "Quantity three", "Furniture", "BulkQuantity", 3, "cái");
            await SeedOwnerConfirmedRoom(validRoom, assets[0], validTemplate, validItem);

            var changedTemplate = Guid.NewGuid();
            var changedItem = new AssetTemplateItem(Guid.NewGuid(), "Stale after assignment change", "Furniture", "BulkQuantity", 1);
            await SeedOwnerConfirmedRoom(changedRoom, assets[1], changedTemplate, changedItem);
            var replacementTemplate = Guid.NewGuid();
            await store.SaveAsync(replacementTemplate, location, "AssetTemplate", "Published",
                new AssetTemplateWrite(location, "Replacement without synced DesiredAssets", [
                    new AssetTemplateItem(Guid.NewGuid(), "Replacement asset", "Furniture", "BulkQuantity", 1)
                ], Scoped: true, ScopeRoomId: changedRoom.Id), 0, owner.Id, default);
            await store.SaveAsync(SetupKey($"asset-template-assignment:{changedRoom.Id}"), location,
                "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(replacementTemplate),
                1, owner.Id, default);

            var removedTemplate = Guid.NewGuid();
            var removedItem = new AssetTemplateItem(Guid.NewGuid(), "Stale after unassignment", "Furniture", "BulkQuantity", 1);
            await SeedOwnerConfirmedRoom(removedRoom, assets[2], removedTemplate, removedItem);
            await store.SaveAsync(SetupKey($"asset-template-assignment:{removedRoom.Id}"), location,
                "AssetTemplateAssignment", "None", new AssetTemplateAssignment(null), 1, owner.Id, default);

            var archivedTemplate = Guid.NewGuid();
            var archivedItem = new AssetTemplateItem(Guid.NewGuid(), "Stale after archive", "Furniture", "BulkQuantity", 1);
            await SeedOwnerConfirmedRoom(archivedRoom, assets[3], archivedTemplate, archivedItem);
            await store.SaveAsync(archivedTemplate, location, "AssetTemplate", "Archived",
                new AssetTemplateWrite(location, "Archived template", [archivedItem], Scoped: true,
                    ScopeRoomId: archivedRoom.Id), 1, owner.Id, default);

            var malformedTemplate = Guid.NewGuid();
            var malformedItem = new AssetTemplateItem(Guid.NewGuid(), "Malformed quantity", "Furniture", "BulkQuantity", 1);
            await SeedOwnerConfirmedRoom(malformedRoom, assets[4], malformedTemplate, malformedItem);
        }

        Guid taskId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            var created = await assignments.CreateAssignmentAsync(owner.Id, location, staff.Id,
                Today, Today.AddDays(14), default);
            Assert.Equal(CreateAssignmentStatus.Created, created.Status);
            var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            var task = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(item =>
                item.RequiredLocationId == location && item.Kind == OperationalTaskKind.LocationAssetHandover);
            taskId = task.Id;
            var snapshot = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(task.LocationAssetInventoryJson, Json)!;
            var only = Assert.Single(snapshot.Items);
            Assert.Equal(assets[0].Id, only.AssetId);
            Assert.Equal(3, only.Quantity);
            Assert.DoesNotContain(snapshot.Items, item => item.AssetId == assets[1].Id ||
                item.AssetId == assets[2].Id || item.AssetId == assets[3].Id || item.AssetId == assets[4].Id);
            Assert.Contains(changedRoom.RoomNumber, snapshot.PendingOwnerRooms);
            Assert.Contains(removedRoom.RoomNumber, snapshot.PendingOwnerRooms);
            Assert.Contains(archivedRoom.RoomNumber, snapshot.PendingOwnerRooms);
            Assert.Contains(malformedRoom.RoomNumber, snapshot.PendingOwnerRooms);
            Assert.DoesNotContain(validRoom.RoomNumber, snapshot.PendingOwnerRooms);
        }

        using var staffClient = await Client(staff);
        var view = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(
            $"/api/v1/operational-tasks/{taskId}/location-asset-inventory"))!;
        Assert.Equal(1, view.TotalCount);
        Assert.Equal(3, Assert.Single(view.Items).Quantity);
        Assert.Contains(changedRoom.RoomNumber, view.PendingOwnerRooms!);
        Assert.Contains(removedRoom.RoomNumber, view.PendingOwnerRooms!);
        Assert.Contains(archivedRoom.RoomNumber, view.PendingOwnerRooms!);
        Assert.Contains(malformedRoom.RoomNumber, view.PendingOwnerRooms!);
    }
}
