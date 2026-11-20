using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Locations;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
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
    private static DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    private async Task<ApplicationUser> User(string role)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        // Compact24 enforces a single Owner per tenant database. Both test methods
        // share one disposable class fixture, so reuse its synthetic Owner.
        if (role == "Owner")
        {
            var existing = await db.Users.AsNoTracking()
                .FirstOrDefaultAsync(user => EF.Property<string[]>(user, "roles").Contains("Owner"));
            if (existing is not null) return existing;
        }
        var id = Guid.NewGuid();
        var user = new ApplicationUser
        {
            Id = id, UserName = id.ToString(), NormalizedUserName = id.ToString().ToUpperInvariant(),
            Email = $"{id:N}@example.invalid", NormalizedEmail = $"{id:N}@example.invalid".ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString(), ConcurrencyStamp = Guid.NewGuid().ToString(),
            LockoutEnabled = true
        };
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ApplicationUser>>()
            .HashPassword(user, Password);
        db.Users.Add(user);
        db.Entry(user).Property("roles").CurrentValue = new[] { role };
        await db.SaveChangesAsync();
        return user;
    }

    private async Task<Guid> Location()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address) VALUES ({id},{"Synthetic assets " + id},'Synthetic address')");
        return id;
    }

    private async Task<HttpClient> Client(ApplicationUser account)
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var room = new Room { LocationId = location, RoomNumber = "Synthetic-101", Status = RoomStatus.Occupied };
            db.Add(room);
            await db.SaveChangesAsync();
            roomId = room.Id;
            var asset = new Asset { LocationId = location, RoomId = roomId, Name = "Synthetic bed", Category = "Furniture", Status = AssetStatus.Active };
            db.Add(asset);
            await db.SaveChangesAsync();
            assetId = asset.Id;
            var commonAsset = new Asset { LocationId = location, RoomId = null, CommonArea = "Sảnh",
                Name = "Synthetic common fire extinguisher", Category = "Safety", Status = AssetStatus.Active };
            db.Add(commonAsset);
            await db.SaveChangesAsync();
            commonAssetId = commonAsset.Id;
            var resident = new Resident
            {
                RoomId = roomId, OwnerUserId = owner.Id, TenantUserId = tenant.Id,
                DisplayLabel = "Synthetic Resident", VerificationStatus = IdentityVerificationStatus.Verified
            };
            db.Add(resident);
            await db.SaveChangesAsync();
            var contract = new Contract
            {
                RoomId = roomId, OwnerSignerId = owner.Id, TenantUserId = tenant.Id,
                RepresentativeResidentId = resident.Id,
                Kind = ContractKind.Main, Status = ContractStatus.Active,
                StartDate = Today.AddDays(-3), EndDate = Today.AddMonths(3), Terms = "Synthetic terms",
                ActivatedAt = DateTimeOffset.UtcNow, ActivatedByUserId = owner.Id
            };
            db.Add(contract);
            await db.SaveChangesAsync();
            var readings = new Dictionary<UtilityType, MeterReading>();
            foreach (var utility in new[] { UtilityType.Electricity, UtilityType.Water })
            {
                var meter = new Meter { RoomId = roomId, Code = "SYNT-HANDOVER-" + utility,
                    UtilityType = utility, InstalledOn = Today.AddDays(-10) };
                db.Add(meter);
                await db.SaveChangesAsync();
                var capture = new OperationalTask { LocationId = location, MeterId = meter.Id,
                    Kind = OperationalTaskKind.MeterReading, ReadingDate = Today.AddDays(-3),
                    Purpose = ReadingPurpose.Initial, Status = MeterTaskStatus.Completed,
                    CompletedAt = DateTimeOffset.UtcNow };
                db.Add(capture);
                await db.SaveChangesAsync();
                var image = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0 };
                var evidence = new MeterEvidence { TaskId = capture.Id, UploadedByUserId = staff.Id,
                    ContentType = "image/png", Length = image.Length,
                    ObjectKey = $"synthetic/{Guid.NewGuid():N}.png",
                    ImageHash = Convert.ToHexString(SHA256.HashData(image)),
                    IsUploaded = true, IsLinked = true };
                // The disposable fixture only needs the confirmed reading FK and JSON
                // metadata. No image download or MinIO behavior is part of this test.
                db.Add(evidence);
                await db.SaveChangesAsync();
                var reading = new MeterReading { MeterId = meter.Id, TaskId = capture.Id,
                    EvidenceId = evidence.Id, ConfirmedByUserId = staff.Id,
                    ConfirmedAt = DateTimeOffset.UtcNow, ConfirmedValue = 100 };
                db.Add(reading);
                await db.SaveChangesAsync();
                readings.Add(utility, reading);
            }
            var snapshot = new BHome.Application.Contracts.HandoverSnapshot(Today.AddDays(-3), "Synthetic-101",
                "Tốt", "Đã bàn giao", "", [new(assetId, "Synthetic bed", "Tốt", "Tốt", Checked: true)],
                null!, null!, [], NoAssetsConfirmed: false);
            db.Add(new ContractHandover
            {
                ContractId = contract.Id, Status = ContractHandoverStatus.Confirmed,
                Version = 2, TenantConfirmedVersion = 2,
                ElectricityReadingId = readings[UtilityType.Electricity].Id,
                WaterReadingId = readings[UtilityType.Water].Id,
                TenantConfirmedBy = tenant.Id, StaffConfirmedBy = staff.Id,
                TenantConfirmedAt = DateTimeOffset.UtcNow, StaffConfirmedAt = DateTimeOffset.UtcNow,
                Snapshot = JsonSerializer.Serialize(snapshot)
            });
            await db.SaveChangesAsync();
            var store = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            var roomExpected = new[]
            {
                new AssetTemplateItem(Guid.NewGuid(), "Synthetic bed", "Furniture", "BulkQuantity", 1),
                new AssetTemplateItem(Guid.NewGuid(), "Missing synthetic desk", "Furniture", "BulkQuantity", 1)
            };
            var templateId = Guid.NewGuid();
            var desiredDocument = await store.SaveAsync(Guid.NewGuid(), location, "DesiredAssets", "PendingVerification",
                new DesiredAssets(templateId, 1, roomId, roomExpected, "PendingVerification"), 0, owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), location, "AssetVerification", "Verified",
                new { roomId, templateId, itemId = roomExpected[0].Id, assetId, quantity = 1,
                    source = "OwnerAttestation" }, 0, owner.Id, default);
            await store.SaveAsync(Guid.NewGuid(), location, "RoomInventoryChecklistReview", "PartiallyChecked",
                new { roomId, desiredId = desiredDocument.Id, desiredVersion = desiredDocument.Version,
                    baseline = "synthetic-reviewed", state = "PartiallyChecked", requestId = Guid.NewGuid(),
                    items = new[] { new { itemId = roomExpected[0].Id, @checked = true, evidenceIds = Array.Empty<Guid>() },
                        new { itemId = roomExpected[1].Id, @checked = false, evidenceIds = Array.Empty<Guid>() } },
                    unlinkedAssetIds = Array.Empty<Guid>() }, 0, owner.Id, default);
            var commonRequirement = new SetupCommonAssetRequirement(Guid.NewGuid(), "Synthetic common fire extinguisher",
                "Safety", "BulkQuantity", 1, "Sảnh");
            await store.SaveAsync(Guid.NewGuid(), location, "CommonAssetRequirements", "Configured",
                new CommonAssetRequirementsWrite([commonRequirement]), 0, owner.Id, default);
            var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                commonRequirement.Id, commonRequirement.Name, commonRequirement.Category,
                commonRequirement.CommonArea, commonRequirement.Quantity, commonRequirement.Unit
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web))));
            await store.SaveAsync(Guid.NewGuid(), location, "CommonAssetInventoryVerification", "Verified",
                new { itemId = commonRequirement.Id, assetId = (Guid?)commonAssetId, fingerprint,
                    evidenceIds = Array.Empty<Guid>(), requestId = Guid.NewGuid() }, 0, owner.Id, default);
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var tasks = await db.Set<OperationalTask>().AsNoTracking().Where(t => t.LocationId == location &&
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var empty = new Room { LocationId = location, RoomNumber = "Empty-confirmed" };
            var unreviewed = new Room { LocationId = location, RoomNumber = "Not-owner-reviewed" };
            db.AddRange(empty, unreviewed);
            await db.SaveChangesAsync();
            emptyRoomId = empty.Id;
            var baseline = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                Id = empty.Id, assignment = (object?)null, desired = (object?)null
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
}
