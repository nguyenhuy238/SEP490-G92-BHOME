using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.IncidentMaintenance;
using BHome.Application.Locations;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using OpenCvSharp;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class LocationAssetHandoverSigningTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!Handover-492";
    private static readonly HandoverInkInput Ink = new(320, 160,
        [[[15d, 25d], [45d, 60d], [72d, 40d], [94d, 76d], [125d, 48d]]]);
    private static DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

    private static Guid SetupKey(string value) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));

    private static byte[] EvidenceImage()
    {
        using var image = new Mat(16, 16, MatType.CV_8UC3, Scalar.White);
        return image.ImEncode(".png");
    }

    private static async Task SaveRoomTemplateAsync(ISetupWorkspaceStore workspace, Guid locationId,
        Guid roomId, Guid ownerId, Guid templateId, AssetTemplateItem[] items)
    {
        await workspace.SaveAsync(templateId, locationId, "AssetTemplate", "Published",
            new AssetTemplateWrite(locationId, "Synthetic room asset template", items,
                Scoped: true, ScopeRoomId: roomId), 0, ownerId, default);
        await workspace.SaveAsync(SetupKey($"asset-template-assignment:{roomId}"), locationId,
            "AssetTemplateAssignment", "Assigned", new AssetTemplateAssignment(templateId),
            0, ownerId, default);
    }

    [CompactPostgresFact]
    public async Task OwnerApprovalThenTwoVersionMatchedAcceptancesCompleteTaskAndSealPdf()
    {
        var blobs = new InMemoryHandoverDocuments();
        using var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(blobs);
        }));
        var owner = await Seed(host.Services, "Owner");
        var staff = await Seed(host.Services, "Staff");
        var outsider = await Seed(host.Services, "Staff");
        var locationId = Guid.NewGuid();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO locations(id,name,address) VALUES ({locationId},'Synthetic handover', 'Synthetic address')");
            // Create the same durable Owner attestation used in production.
            // A template-only requirement or a standalone Asset is NOT a valid
            // source for Staff responsibility handover.
            var room = new Room { LocationId = locationId, RoomNumber = "S-101" };
            db.Add(room);
            await db.SaveChangesAsync();
            var physical = new Asset
            {
                LocationId = locationId,
                RoomId = room.Id,
                Name = "Synthetic chair",
                Category = "Furniture",
                Status = AssetStatus.Active
            };
            db.Add(physical);
            await db.SaveChangesAsync();
            var item = new AssetTemplateItem(Guid.NewGuid(), "Synthetic chair",
                "Furniture", "BulkQuantity", 1);
            var templateId = Guid.NewGuid();
            var workspace = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            await SaveRoomTemplateAsync(workspace, locationId, room.Id, owner.Id, templateId, [item]);
            var desired = await workspace.SaveAsync(Guid.NewGuid(), locationId, "DesiredAssets",
                "Verified", new DesiredAssets(templateId, 1, room.Id, [item], "Verified"),
                0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "AssetVerification",
                "Verified", new
                {
                    roomId = room.Id,
                    templateId,
                    itemId = item.Id,
                    assetId = physical.Id,
                    quantity = 1,
                    source = "OwnerAttestation"
                }, 0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "RoomInventoryChecklistReview",
                "Matched", new
                {
                    roomId = room.Id,
                    desiredId = desired.Id,
                    desiredVersion = desired.Version,
                    baseline = "synthetic-owner-baseline",
                    state = "Matched",
                    requestId = Guid.NewGuid(),
                    items = new[] { new
                    {
                        itemId = item.Id, @checked = true, evidenceIds = Array.Empty<Guid>()
                    }},
                    unlinkedAssetIds = Array.Empty<Guid>()
                }, 0, owner.Id, default);
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, locationId, staff.Id, Today, Today.AddDays(14), default)).Status);
        }
        Guid taskId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            taskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(t => t.LocationId == locationId && t.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(t => t.Id).SingleAsync();
        }
        using var ownerClient = await Login(host.CreateClient(), owner);
        using var staffClient = await Login(host.CreateClient(), staff);
        using var outsiderClient = await Login(host.CreateClient(), outsider);
        var route = $"/api/v1/operational-tasks/{taskId}";
        var handover = route + "/location-asset-handover";
        var inventory = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;

        // Before approval there is no report or document, and a foreign Staff cannot read it.
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await outsiderClient.GetAsync(route + "/location-asset-inventory")).StatusCode);

        var started = await Post(staffClient, route + "/start", new { version = inventory.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        foreach (var item in inventory.Items.Where(item => !item.Inherited))
        {
            using var change = new HttpRequestMessage(HttpMethod.Put,
                route + "/location-asset-inventory/items/" + item.Id)
            { Content = JsonContent.Create(new { version = task.Version, @checked = true, note = "Kiểm tra đầy đủ" }) };
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var changed = await staffClient.SendAsync(change);
            Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
            task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        }
        Assert.Equal(HttpStatusCode.OK, (await Post(staffClient, route + "/submit",
            new { version = task.Version, note = "Đã kiểm kê đủ tài sản cơ sở" })).StatusCode);
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal("PendingVerification", task.Status);

        // Owner rejects just one checklist item; Staff's normal task returns to InProgress.
        var checkedItem = Assert.Single(inventory.Items);
        var rework = await ownerClient.PostAsJsonAsync(handover + "/rework",
            new
            {
                taskVersion = task.Version,
                itemIds = new[] { checkedItem.Id },
                note = "Kiểm tra lại tài sản khu vực chung trước khi ký bàn giao."
            });
        Assert.Equal(HttpStatusCode.OK, rework.StatusCode);
        var reopened = (await rework.Content.ReadFromJsonAsync<LocationAssetInventoryView>())!;
        Assert.Equal("InProgress", reopened.Status);
        Assert.Equal(0, reopened.CheckedCount);
        Assert.Equal(HttpStatusCode.Conflict,
            (await Post(staffClient, route + "/submit",
                new { version = reopened.Version, note = "Chưa kiểm tra lại" })).StatusCode);
        using (var change = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + checkedItem.Id)
        { Content = JsonContent.Create(new { version = reopened.Version, @checked = true, note = "Đã đối soát lại trực tiếp" }) })
        {
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await staffClient.SendAsync(change)).StatusCode);
        }
        task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(staffClient, route + "/submit",
            new { version = task.Version, note = "Đã kiểm tra lại đầy đủ" })).StatusCode);
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;

        var approved = await ownerClient.PostAsJsonAsync(handover + "/approve",
            new { taskVersion = task.Version });
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var report = (await approved.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal("PendingOwnerSignature", report.Status);
        Assert.NotEmpty(report.SnapshotSha256);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover + "/document")).StatusCode);

        // A wrong or stale fingerprint cannot be accepted; only Owner signs first.
        Assert.Equal(HttpStatusCode.NotFound, (await outsiderClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = new string('F', 64), confirmed = true, ink = Ink })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = new string('F', 64), confirmed = true, ink = Ink })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true, ink = Ink })).StatusCode);
        var signedOwner = await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true, ink = Ink });
        Assert.Equal(HttpStatusCode.OK, signedOwner.StatusCode);
        Assert.Equal("PendingStaffSignature",
            (await signedOwner.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!.Status);
        Assert.Equal("PendingVerification", (await ownerClient.GetFromJsonAsync<TaskView>(route))!.Status);

        // Owner can challenge a previously acknowledged draft before Staff's
        // final acceptance. The old hash and Owner signature must not carry into
        // a newly reviewed document.
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        var secondRework = await ownerClient.PostAsJsonAsync(handover + "/rework", new
        {
            taskVersion = task.Version,
            itemIds = new[] { checkedItem.Id },
            note = "Biên bản cần bổ sung đối chiếu tài sản trước khi Staff xác nhận."
        });
        Assert.Equal(HttpStatusCode.OK, secondRework.StatusCode);
        var secondReview = (await secondRework.Content.ReadFromJsonAsync<LocationAssetInventoryView>())!;
        Assert.Equal("Superseded",
            (await ownerClient.GetFromJsonAsync<LocationAssetHandoverReportView>(handover))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true, ink = Ink })).StatusCode);
        using (var change = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + checkedItem.Id)
        { Content = JsonContent.Create(new { version = secondReview.Version, @checked = true, note = "Đã đối chiếu lại biên bản" }) })
        {
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await staffClient.SendAsync(change)).StatusCode);
        }
        task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(staffClient, route + "/submit",
            new { version = task.Version, note = "Gửi lại bảng đối chiếu đã sửa" })).StatusCode);
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        var reviewedAgain = await ownerClient.PostAsJsonAsync(handover + "/approve",
            new { taskVersion = task.Version });
        Assert.Equal(HttpStatusCode.OK, reviewedAgain.StatusCode);
        var newReport = (await reviewedAgain.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal(report.Revision + 1, newReport.Revision);
        Assert.Null(newReport.OwnerSignature);
        Assert.NotEqual(report.SnapshotSha256, newReport.SnapshotSha256);
        Assert.Equal(HttpStatusCode.Conflict, (await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true, ink = Ink })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true, ink = Ink })).StatusCode);

        var signedStaff = await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true, ink = Ink });
        Assert.Equal(HttpStatusCode.OK, signedStaff.StatusCode);
        var completed = (await signedStaff.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal("Completed", completed.Status);
        Assert.NotNull(completed.OwnerSignature);
        Assert.NotNull(completed.StaffSignature);
        Assert.True(completed.CanDownloadFinal);
        Assert.Equal("Completed", (await ownerClient.GetFromJsonAsync<TaskView>(route))!.Status);
        var signedPdf = await ownerClient.GetAsync(handover + "/document");
        Assert.Equal(HttpStatusCode.OK, signedPdf.StatusCode);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(
            (await signedPdf.Content.ReadAsByteArrayAsync())[..5]));
        Assert.Equal(HttpStatusCode.OK, (await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true, ink = Ink })).StatusCode);
    }

    [CompactPostgresFact]
    public async Task FormerStaffArchiveContainsOnlyOwnFullySignedRevisionAfterSuccessorCompletesNewTask()
    {
        var blobs = new InMemoryHandoverDocuments();
        using var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(blobs);
        }));
        var owner = await Seed(host.Services, "Owner");
        var formerStaff = await Seed(host.Services, "Staff");
        var successor = await Seed(host.Services, "Staff");
        var outsider = await Seed(host.Services, "Staff");
        var locationId = Guid.NewGuid();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO locations(id,name,address) VALUES ({locationId},'Synthetic archive Location', 'Synthetic archive address')");
            var room = new Room { LocationId = locationId, RoomNumber = "S-301" };
            db.Add(room);
            await db.SaveChangesAsync();
            var asset = new Asset
            {
                LocationId = locationId,
                RoomId = room.Id,
                Name = "Synthetic archive chair",
                Category = "Furniture",
                Status = AssetStatus.Active
            };
            db.Add(asset);
            await db.SaveChangesAsync();
            var item = new AssetTemplateItem(Guid.NewGuid(), "Synthetic archive chair", "Furniture", "BulkQuantity", 1);
            var templateId = Guid.NewGuid();
            var workspace = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            await SaveRoomTemplateAsync(workspace, locationId, room.Id, owner.Id, templateId, [item]);
            var desired = await workspace.SaveAsync(Guid.NewGuid(), locationId, "DesiredAssets", "Verified",
                new DesiredAssets(templateId, 1, room.Id, [item], "Verified"), 0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "AssetVerification", "Verified", new
            {
                roomId = room.Id,
                templateId,
                itemId = item.Id,
                assetId = asset.Id,
                quantity = 1,
                source = "OwnerAttestation"
            }, 0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "RoomInventoryChecklistReview", "Matched", new
            {
                roomId = room.Id,
                desiredId = desired.Id,
                desiredVersion = desired.Version,
                baseline = "synthetic-archive-owner-baseline",
                state = "Matched",
                requestId = Guid.NewGuid(),
                items = new[] { new { itemId = item.Id, @checked = true, evidenceIds = Array.Empty<Guid>() } },
                unlinkedAssetIds = Array.Empty<Guid>()
            }, 0, owner.Id, default);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,status,history)
                VALUES ({Guid.NewGuid()},{formerStaff.Id},{Today},NULL,'Active','[]'::jsonb),
                    ({Guid.NewGuid()},{successor.Id},{Today},NULL,'Active','[]'::jsonb),
                    ({Guid.NewGuid()},{outsider.Id},{Today},NULL,'Active','[]'::jsonb)
                """);
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, locationId, formerStaff.Id, Today, Today.AddDays(14), default)).Status);
        }

        Guid formerTaskId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            formerTaskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.LocationId == locationId && task.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(task => task.Id).SingleAsync();
        }
        using var ownerClient = await Login(host.CreateClient(), owner);
        using var formerClient = await Login(host.CreateClient(), formerStaff);
        using var successorClient = await Login(host.CreateClient(), successor);
        using var outsiderClient = await Login(host.CreateClient(), outsider);
        const string archive = "/api/v1/location-asset-handovers/archive";
        var formerRoute = $"/api/v1/operational-tasks/{formerTaskId}";
        var formerHandover = formerRoute + "/location-asset-handover";
        var inventory = (await formerClient.GetFromJsonAsync<LocationAssetInventoryView>(
            formerRoute + "/location-asset-inventory"))!;
        Assert.Empty((await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive)) ?? []);
        var started = await Post(formerClient, formerRoute + "/start", new { version = inventory.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        foreach (var checklistItem in inventory.Items)
        {
            using var change = new HttpRequestMessage(HttpMethod.Put,
                formerRoute + "/location-asset-inventory/items/" + checklistItem.Id)
            {
                Content = JsonContent.Create(new { version = task.Version, @checked = true, note = "Staff A đã kiểm tra tài sản." })
            };
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await formerClient.SendAsync(change)).StatusCode);
            task = (await formerClient.GetFromJsonAsync<TaskView>(formerRoute))!;
        }
        using var formerEvidenceContent = new ByteArrayContent(EvidenceImage());
        formerEvidenceContent.Headers.ContentType = new("image/png");
        using var formerEvidenceRequest = new HttpRequestMessage(HttpMethod.Put, formerRoute + "/evidence")
        {
            Content = formerEvidenceContent
        };
        formerEvidenceRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var formerEvidenceResponse = await formerClient.SendAsync(formerEvidenceRequest);
        Assert.Equal(HttpStatusCode.OK, formerEvidenceResponse.StatusCode);
        var formerEvidence = (await formerEvidenceResponse.Content.ReadFromJsonAsync<TaskEvidenceView>())!;
        task = (await formerClient.GetFromJsonAsync<TaskView>(formerRoute))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(formerClient, formerRoute + "/submit",
            new { version = task.Version, note = "Staff A hoàn tất kiểm kê." })).StatusCode);
        task = (await ownerClient.GetFromJsonAsync<TaskView>(formerRoute))!;
        var approved = await ownerClient.PostAsJsonAsync(formerHandover + "/approve", new { taskVersion = task.Version });
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var formerReport = (await approved.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal(1, formerReport.Revision);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(formerHandover + "/sign", new
        {
            revision = formerReport.Revision,
            snapshotSha256 = formerReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);

        // Owner acceptance and its preview PDF do not qualify for the former Staff archive.
        Assert.Empty((await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive)) ?? []);
        var unsignedRevision = $"{archive}/{formerTaskId}/revisions/{formerReport.Revision}";
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(unsignedRevision)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(unsignedRevision + "/document")).StatusCode);

        var formerSigned = await formerClient.PostAsJsonAsync(formerHandover + "/sign", new
        {
            revision = formerReport.Revision,
            snapshotSha256 = formerReport.SnapshotSha256,
            confirmed = true, ink = Ink
        });
        Assert.Equal(HttpStatusCode.OK, formerSigned.StatusCode);
        Assert.Equal("Completed", (await formerSigned.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!.Status);
        var signedArchive = await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive);
        var formerEntry = Assert.Single(signedArchive!);
        Assert.Equal(formerTaskId, formerEntry.TaskId);
        Assert.Equal(formerStaff.Id, formerEntry.StaffId);
        Assert.Equal(formerStaff.Id, formerEntry.StaffSignature.ActorId);
        Assert.Equal(owner.Id, formerEntry.OwnerSignature.ActorId);
        Assert.Equal(1, formerEntry.Revision);

        // A completed task is closed. The successor gets a new Location-owned task;
        // immutable archive identity is the (TaskId, Revision) pair.
        Guid successorTaskId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var locationVersion = await db.Locations.Where(location => location.Id == locationId)
                .Select(location => location.Version).SingleAsync();
            var replaced = await scope.ServiceProvider.GetRequiredService<ILocationAssignments>()
                .ReplaceAssignmentAsync(owner.Id, locationId, successor.Id, Today, locationVersion,
                    "Synthetic archive successor", default);
            Assert.Equal(ChangeAssignmentStatus.Changed, replaced.Status);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today.AddDays(-2)},end_date={Today.AddDays(-1)},status='Ended'
                WHERE staff_user_id={formerStaff.Id}
                """);
            successorTaskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.LocationId == locationId && task.Kind == OperationalTaskKind.LocationAssetHandover &&
                    task.AssignedStaffUserId == successor.Id)
                .Select(task => task.Id).SingleAsync();
        }
        Assert.NotEqual(formerTaskId, successorTaskId);
        var successorRoute = $"/api/v1/operational-tasks/{successorTaskId}";
        var successorHandover = successorRoute + "/location-asset-handover";
        var successorInventory = (await successorClient.GetFromJsonAsync<LocationAssetInventoryView>(
            successorRoute + "/location-asset-inventory"))!;
        var successorStarted = await Post(successorClient, successorRoute + "/start",
            new { version = successorInventory.Version });
        Assert.Equal(HttpStatusCode.OK, successorStarted.StatusCode);
        var successorTask = (await successorStarted.Content.ReadFromJsonAsync<TaskView>())!;
        foreach (var checklistItem in successorInventory.Items)
        {
            using var change = new HttpRequestMessage(HttpMethod.Put,
                successorRoute + "/location-asset-inventory/items/" + checklistItem.Id)
            {
                Content = JsonContent.Create(new { version = successorTask.Version, @checked = true, note = "Staff B đã kiểm tra lại tài sản." })
            };
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await successorClient.SendAsync(change)).StatusCode);
            successorTask = (await successorClient.GetFromJsonAsync<TaskView>(successorRoute))!;
        }
        using var successorEvidenceContent = new ByteArrayContent(EvidenceImage());
        successorEvidenceContent.Headers.ContentType = new("image/png");
        using var successorEvidenceRequest = new HttpRequestMessage(HttpMethod.Put, successorRoute + "/evidence")
        {
            Content = successorEvidenceContent
        };
        successorEvidenceRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var successorEvidenceResponse = await successorClient.SendAsync(successorEvidenceRequest);
        Assert.Equal(HttpStatusCode.OK, successorEvidenceResponse.StatusCode);
        var successorEvidence = (await successorEvidenceResponse.Content.ReadFromJsonAsync<TaskEvidenceView>())!;
        successorTask = (await successorClient.GetFromJsonAsync<TaskView>(successorRoute))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(successorClient, successorRoute + "/submit",
            new { version = successorTask.Version, note = "Staff B hoàn tất kiểm kê." })).StatusCode);
        successorTask = (await ownerClient.GetFromJsonAsync<TaskView>(successorRoute))!;
        var successorApproved = await ownerClient.PostAsJsonAsync(successorHandover + "/approve",
            new { taskVersion = successorTask.Version });
        Assert.Equal(HttpStatusCode.OK, successorApproved.StatusCode);
        var successorReport = (await successorApproved.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal(1, successorReport.Revision);
        Assert.NotEqual(formerTaskId, successorReport.TaskId);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(successorHandover + "/sign", new
        {
            revision = successorReport.Revision,
            snapshotSha256 = successorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await successorClient.PostAsJsonAsync(successorHandover + "/sign", new
        {
            revision = successorReport.Revision,
            snapshotSha256 = successorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);

        // Staff A's archive remains pinned to A's signed report after B has completed.
        signedArchive = await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive);
        formerEntry = Assert.Single(signedArchive!);
        Assert.Equal(formerTaskId, formerEntry.TaskId);
        Assert.Equal(formerStaff.Id, formerEntry.StaffId);
        var spoofedArchive = await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(
            archive + "?staffId=" + successor.Id);
        Assert.Equal(formerStaff.Id, Assert.Single(spoofedArchive!).StaffId);
        var revisionRoute = $"{archive}/{formerTaskId}/revisions/{formerReport.Revision}";
        var detail = (await formerClient.GetFromJsonAsync<LocationAssetHandoverArchiveReportView>(revisionRoute))!;
        Assert.Equal(formerTaskId, detail.Report.TaskId);
        Assert.Equal(formerReport.Revision, detail.Report.Revision);
        Assert.Single(detail.Items);
        var document = await formerClient.GetAsync(revisionRoute + "/document");
        Assert.Equal(HttpStatusCode.OK, document.StatusCode);
        var documentBytes = await document.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(documentBytes[..5]));
        Assert.Equal(formerEntry.PdfSha256, Convert.ToHexString(SHA256.HashData(documentBytes)));

        // Former Staff cannot access the successor revision or any current task surface.
        var successorRevision = $"{archive}/{successorTaskId}/revisions/{successorReport.Revision}";
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(successorRevision)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(successorRevision + "/document")).StatusCode);
        foreach (var path in new[]
        {
            formerRoute, formerRoute + "/location-asset-inventory", formerRoute + "/history",
            formerRoute + "/actors", formerRoute + "/evidence", formerRoute + "/evidence/" + formerEvidence.Id,
            successorRoute,
            successorRoute + "/location-asset-inventory", successorRoute + "/history",
            successorRoute + "/actors", successorRoute + "/evidence",
            successorRoute + "/evidence/" + successorEvidence.Id, successorHandover,
            successorHandover + "/document"
        })
            Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.PostAsJsonAsync(successorHandover + "/sign", new
        {
            revision = successorReport.Revision,
            snapshotSha256 = successorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);

        Assert.Empty((await outsiderClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive)) ?? []);
        Assert.Equal(HttpStatusCode.NotFound, (await outsiderClient.GetAsync(revisionRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsiderClient.GetAsync(revisionRoute + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsiderClient.GetAsync(successorRevision)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsiderClient.GetAsync(successorRevision + "/document")).StatusCode);

        // Owner's existing task and report access remains intact for both completed tasks.
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(formerRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(formerHandover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(formerHandover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(successorRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(successorRoute + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(successorHandover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(successorHandover + "/document")).StatusCode);
        var successorArchive = await successorClient.GetFromJsonAsync<LocationAssetHandoverArchiveListItem[]>(archive);
        var successorEntry = Assert.Single(successorArchive!);
        Assert.Equal(successorTaskId, successorEntry.TaskId);
        Assert.Equal(successor.Id, successorEntry.StaffId);
    }

    [CompactPostgresFact]
    public async Task HandoverRequiresCurrentEmploymentForApprovalAndStaffSignatureButKeepsOwnerHistoryAndSameAssignmentResumable()
    {
        var blobs = new InMemoryHandoverDocuments();
        using var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(blobs);
        }));
        var owner = await Seed(host.Services, "Owner");
        var staff = await Seed(host.Services, "Staff");
        var locationId = Guid.NewGuid();
        Guid roomId;
        Guid assetId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO locations(id,name,address) VALUES ({locationId},'Synthetic employment handover', 'Synthetic address')");
            var room = new Room { LocationId = locationId, RoomNumber = "E-101" };
            db.Add(room);
            await db.SaveChangesAsync();
            roomId = room.Id;
            var physical = new Asset
            {
                LocationId = locationId,
                RoomId = room.Id,
                Name = "Synthetic employment chair",
                Category = "Furniture",
                Status = AssetStatus.Active
            };
            db.Add(physical);
            await db.SaveChangesAsync();
            assetId = physical.Id;
            var item = new AssetTemplateItem(Guid.NewGuid(), "Synthetic employment chair", "Furniture", "BulkQuantity", 1);
            var templateId = Guid.NewGuid();
            var workspace = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            await SaveRoomTemplateAsync(workspace, locationId, room.Id, owner.Id, templateId, [item]);
            var desired = await workspace.SaveAsync(Guid.NewGuid(), locationId, "DesiredAssets", "Verified",
                new DesiredAssets(templateId, 1, room.Id, [item], "Verified"), 0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "AssetVerification", "Verified", new
            {
                roomId = room.Id,
                templateId,
                itemId = item.Id,
                assetId = physical.Id,
                quantity = 1,
                source = "OwnerAttestation"
            }, 0, owner.Id, default);
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "RoomInventoryChecklistReview", "Matched", new
            {
                roomId = room.Id,
                desiredId = desired.Id,
                desiredVersion = desired.Version,
                baseline = "synthetic-employment-owner-baseline",
                state = "Matched",
                requestId = Guid.NewGuid(),
                items = new[] { new { itemId = item.Id, @checked = true, evidenceIds = Array.Empty<Guid>() } },
                unlinkedAssetIds = Array.Empty<Guid>()
            }, 0, owner.Id, default);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,status,history)
                VALUES ({Guid.NewGuid()},{staff.Id},{Today},NULL,'Active','[]'::jsonb)
                """);
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, locationId, staff.Id, Today, Today.AddDays(14), default)).Status);
        }

        Guid taskId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            taskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(t => t.LocationId == locationId && t.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(t => t.Id).SingleAsync();
        }
        using var ownerClient = await Login(host.CreateClient(), owner);
        using var staffClient = await Login(host.CreateClient(), staff);
        var route = $"/api/v1/operational-tasks/{taskId}";
        var handover = route + "/location-asset-handover";
        var inventory = (await staffClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;
        var started = await Post(staffClient, route + "/start", new { version = inventory.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        var itemToCheck = Assert.Single(inventory.Items);
        using (var change = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + itemToCheck.Id)
        {
            Content = JsonContent.Create(new
            { version = task.Version, @checked = true, condition = "Damaged", note = "Cánh quạt bị nứt." })
        })
        {
            change.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await staffClient.SendAsync(change)).StatusCode);
        }
        task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.Conflict, (await Post(staffClient, route + "/submit",
            new { version = task.Version, note = "Đã kiểm tra nhưng còn tài sản hỏng" })).StatusCode);

        using (var incidentForm = new MultipartFormDataContent())
        {
            incidentForm.Add(new StringContent(locationId.ToString()), "LocationId");
            incidentForm.Add(new StringContent(roomId.ToString()), "RoomId");
            incidentForm.Add(new StringContent(assetId.ToString()), "AssetId");
            incidentForm.Add(new StringContent("Normal"), "Severity");
            incidentForm.Add(new StringContent("Quạt trần phòng E-101 bị nứt cánh, cần kiểm tra và sửa chữa."), "Description");
            using var incidentRequest = new HttpRequestMessage(HttpMethod.Post, "/api/v1/incidents")
            { Content = incidentForm };
            incidentRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var incidentResponse = await staffClient.SendAsync(incidentRequest);
            Assert.Equal(HttpStatusCode.Created, incidentResponse.StatusCode);
            var incident = (await incidentResponse.Content.ReadFromJsonAsync<IncidentCommandResult>())!;
            Assert.NotNull(incident.IncidentId);
            using var link = new HttpRequestMessage(HttpMethod.Put,
                route + "/location-asset-inventory/items/" + itemToCheck.Id)
            {
                Content = JsonContent.Create(new
                {
                    version = task.Version,
                    @checked = true,
                    condition = "Damaged",
                    note = "Cánh quạt bị nứt.",
                    incidentId = incident.IncidentId
                })
            };
            link.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await staffClient.SendAsync(link)).StatusCode);
            task = (await staffClient.GetFromJsonAsync<TaskView>(route))!;
            Assert.Equal(HttpStatusCode.OK, (await Post(staffClient, route + "/submit",
                new { version = task.Version, note = "Đã kiểm kê và liên kết sự cố tài sản hỏng" })).StatusCode);
            var ownerInventory = (await ownerClient.GetFromJsonAsync<LocationAssetInventoryView>(
                route + "/location-asset-inventory"))!;
            var ownerItem = Assert.Single(ownerInventory.Items);
            Assert.Equal("Damaged", ownerItem.Condition);
            Assert.Equal(incident.IncidentId, ownerItem.IncidentId);
            var ownerIncident = (await ownerClient.GetFromJsonAsync<IncidentView>(
                $"/api/v1/incidents/{incident.IncidentId}"))!;
            Assert.Equal(HttpStatusCode.OK, (await Post(ownerClient,
                $"/api/v1/incidents/{incident.IncidentId}/resolve",
                new { version = ownerIncident.Version, reason = "Owner đã kiểm tra và xác nhận phương án xử lý." })).StatusCode);
        }

        // An ended employment invalidates the current responsibility even while the
        // historical Location assignment row still covers today's date.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today.AddDays(-2)},end_date={Today.AddDays(-1)},status='Ended'
                WHERE staff_user_id={staff.Id}
                """);
        }
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.Conflict, (await ownerClient.PostAsJsonAsync(handover + "/approve",
            new { taskVersion = task.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(route + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.GetAsync(route + "/location-asset-inventory")).StatusCode);

        // Reactivating the same employment restores access to the same task and assignment;
        // it must not generate a duplicate LocationAssetHandover task.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today},end_date=NULL,status='Active'
                WHERE staff_user_id={staff.Id}
                """);
        }
        Assert.Equal(HttpStatusCode.OK, (await staffClient.GetAsync(route)).StatusCode);
        task = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        var approved = await ownerClient.PostAsJsonAsync(handover + "/approve", new { taskVersion = task.Version });
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var report = (await approved.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        var ownerSigned = await ownerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        });
        Assert.Equal(HttpStatusCode.OK, ownerSigned.StatusCode);

        // Once employment ends again, the old Staff cannot read an unsigned report,
        // download its document or add a signature; Owner's historical access remains.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today.AddDays(-2)},end_date={Today.AddDays(-1)},status='Ended'
                WHERE staff_user_id={staff.Id}
                """);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.GetAsync(handover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover + "/document")).StatusCode);

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today},end_date=NULL,status='Active'
                WHERE staff_user_id={staff.Id}
                """);
        }
        var staffSigned = await staffClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        });
        Assert.Equal(HttpStatusCode.OK, staffSigned.StatusCode);
        Assert.Equal("Completed", (await staffSigned.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!.Status);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(t =>
                t.LocationId == locationId && t.Kind == OperationalTaskKind.LocationAssetHandover));
        }

        // A former Staff signer keeps read-only access to their own completed report.
        // The idempotent signing endpoint is still an action and must reject them.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today.AddDays(-2)},end_date={Today.AddDays(-1)},status='Ended'
                WHERE staff_user_id={staff.Id}
                """);
        }
        Assert.Equal(HttpStatusCode.OK, (await staffClient.GetAsync(handover)).StatusCode);
        var historicalReport = (await staffClient.GetFromJsonAsync<LocationAssetHandoverReportView>(handover))!;
        Assert.Equal("Completed", historicalReport.Status);
        Assert.Equal(staff.Id, historicalReport.StaffId);
        Assert.Equal(HttpStatusCode.OK, (await staffClient.GetAsync(handover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staffClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover + "/document")).StatusCode);
    }

    [CompactPostgresFact]
    public async Task SuccessorContinuesSameLocationHandoverTaskAndFormerStaffLosesCurrentAccess()
    {
        var blobs = new InMemoryHandoverDocuments();
        using var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(blobs);
        }));
        var owner = await Seed(host.Services, "Owner");
        var formerStaff = await Seed(host.Services, "Staff");
        var successor = await Seed(host.Services, "Staff");
        var locationId = Guid.NewGuid();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO locations(id,name,address) VALUES ({locationId},'Synthetic successor handover', 'Synthetic address')");
            var room = new Room { LocationId = locationId, RoomNumber = "S-201" };
            db.Add(room);
            await db.SaveChangesAsync();
            var assets = new[]
            {
                new Asset { LocationId = locationId, RoomId = room.Id, Name = "Synthetic desk", Category = "Furniture", Status = AssetStatus.Active },
                new Asset { LocationId = locationId, RoomId = room.Id, Name = "Synthetic chair", Category = "Furniture", Status = AssetStatus.Active }
            };
            db.AddRange(assets);
            await db.SaveChangesAsync();
            var items = new[]
            {
                new AssetTemplateItem(Guid.NewGuid(), "Synthetic desk", "Furniture", "BulkQuantity", 1),
                new AssetTemplateItem(Guid.NewGuid(), "Synthetic chair", "Furniture", "BulkQuantity", 1)
            };
            var templateId = Guid.NewGuid();
            var workspace = scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>();
            await SaveRoomTemplateAsync(workspace, locationId, room.Id, owner.Id, templateId, items);
            var desired = await workspace.SaveAsync(Guid.NewGuid(), locationId, "DesiredAssets", "Verified",
                new DesiredAssets(templateId, 1, room.Id, items, "Verified"), 0, owner.Id, default);
            for (var index = 0; index < items.Length; index++)
            {
                await workspace.SaveAsync(Guid.NewGuid(), locationId, "AssetVerification", "Verified", new
                {
                    roomId = room.Id,
                    templateId,
                    itemId = items[index].Id,
                    assetId = assets[index].Id,
                    quantity = 1,
                    source = "OwnerAttestation"
                }, 0, owner.Id, default);
            }
            await workspace.SaveAsync(Guid.NewGuid(), locationId, "RoomInventoryChecklistReview", "Matched", new
            {
                roomId = room.Id,
                desiredId = desired.Id,
                desiredVersion = desired.Version,
                baseline = "synthetic-successor-owner-baseline",
                state = "Matched",
                requestId = Guid.NewGuid(),
                items = items.Select(item => new
                {
                    itemId = item.Id,
                    @checked = true,
                    evidenceIds = Array.Empty<Guid>()
                }).ToArray(),
                unlinkedAssetIds = Array.Empty<Guid>()
            }, 0, owner.Id, default);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,status,history)
                VALUES ({Guid.NewGuid()},{formerStaff.Id},{Today},NULL,'Active','[]'::jsonb),
                    ({Guid.NewGuid()},{successor.Id},{Today},NULL,'Active','[]'::jsonb)
                """);
            var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>();
            Assert.Equal(CreateAssignmentStatus.Created, (await assignments.CreateAssignmentAsync(
                owner.Id, locationId, formerStaff.Id, Today, Today.AddDays(14), default)).Status);
        }

        Guid taskId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            taskId = await db.Set<OperationalTask>().AsNoTracking()
                .Where(task => task.LocationId == locationId && task.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(task => task.Id).SingleAsync();
        }
        using var ownerClient = await Login(host.CreateClient(), owner);
        using var formerClient = await Login(host.CreateClient(), formerStaff);
        using var successorClient = await Login(host.CreateClient(), successor);
        var route = $"/api/v1/operational-tasks/{taskId}";
        var handover = route + "/location-asset-handover";
        var initial = (await formerClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;
        Assert.Equal(2, initial.TotalCount);
        var started = await Post(formerClient, route + "/start", new { version = initial.Version });
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var task = (await started.Content.ReadFromJsonAsync<TaskView>())!;
        var firstItem = initial.Items.OrderBy(item => item.Name).First();
        var remainingItem = initial.Items.Single(item => item.Id != firstItem.Id);
        using (var check = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + firstItem.Id)
        {
            Content = JsonContent.Create(new
            {
                version = task.Version,
                @checked = true,
                condition = "Intact",
                note = "Staff đầu đã kiểm tra mục này."
            })
        })
        {
            check.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await formerClient.SendAsync(check)).StatusCode);
        }

        task = (await formerClient.GetFromJsonAsync<TaskView>(route))!;
        using (var check = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + remainingItem.Id)
        {
            Content = JsonContent.Create(new
            {
                version = task.Version,
                @checked = true,
                condition = "Intact",
                note = "Staff đầu đã kiểm tra mục còn lại."
            })
        })
        {
            check.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await formerClient.SendAsync(check)).StatusCode);
        }
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var changes = await db.Set<OperationalTaskHistory>().AsNoTracking()
                .Where(history => history.TaskId == taskId && history.Action == "location_asset_inventory_item_checked" &&
                    history.ActorId == formerStaff.Id).ToArrayAsync();
            Guid ChangedItem(OperationalTaskHistory history)
            {
                using var document = System.Text.Json.JsonDocument.Parse(history.ChangesJson);
                return document.RootElement.GetProperty("ItemId").GetGuid();
            }
            var firstChange = Assert.Single(changes, history => ChangedItem(history) == firstItem.Id);
            using var firstChangeJson = System.Text.Json.JsonDocument.Parse(firstChange.ChangesJson);
            var firstAfter = firstChangeJson.RootElement.GetProperty("After");
            Assert.Equal("Intact", firstAfter.GetProperty("Condition").GetString());
            Assert.Equal("Staff đầu đã kiểm tra mục này.", firstAfter.GetProperty("Note").GetString());
        }
        using var evidenceContent = new ByteArrayContent(EvidenceImage());
        evidenceContent.Headers.ContentType = new("image/png");
        using var evidenceRequest = new HttpRequestMessage(HttpMethod.Put, route + "/evidence")
        {
            Content = evidenceContent
        };
        evidenceRequest.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var evidenceResponse = await formerClient.SendAsync(evidenceRequest);
        Assert.Equal(HttpStatusCode.OK, evidenceResponse.StatusCode);
        var predecessorEvidence = (await evidenceResponse.Content.ReadFromJsonAsync<TaskEvidenceView>())!;
        Assert.Equal(formerStaff.Id, predecessorEvidence.UploadedByUserId);
        task = (await formerClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(formerClient, route + "/submit",
            new { version = task.Version, note = "Staff đầu đã gửi đủ checklist chờ Owner xác nhận.", evidenceIds = new[] { predecessorEvidence.Id } })).StatusCode);
        var ownerTask = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        var predecessorApproval = await ownerClient.PostAsJsonAsync(handover + "/approve",
            new { taskVersion = ownerTask.Version });
        Assert.Equal(HttpStatusCode.OK, predecessorApproval.StatusCode);
        var predecessorReport = (await predecessorApproval.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal("PendingOwnerSignature", predecessorReport.Status);
        var predecessorOwnerSign = await ownerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = predecessorReport.Revision,
            snapshotSha256 = predecessorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        });
        Assert.Equal(HttpStatusCode.OK, predecessorOwnerSign.StatusCode);
        Assert.Equal("PendingStaffSignature",
            (await predecessorOwnerSign.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!.Status);

        // An employment gap hides the pending-verification task and unsigned report
        // from the former Staff while Owner can still read the Location-owned work.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today.AddDays(-2)},end_date={Today.AddDays(-1)},status='Ended'
                WHERE staff_user_id={formerStaff.Id}
                """);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route + "/evidence")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = predecessorReport.Revision,
            snapshotSha256 = predecessorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(route + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover + "/document")).StatusCode);

        // Restoring the same current assignment makes the same open task available again.
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE staff_employments SET start_date={Today},end_date=NULL,status='Active'
                WHERE staff_user_id={formerStaff.Id}
                """);
        }
        Assert.Equal(HttpStatusCode.OK, (await formerClient.GetAsync(route)).StatusCode);

        // Replace the now-current Staff assignment while the predecessor's submission
        // is still PendingVerification and Owner-signed. Reconciliation must reopen the
        // same Location task for the successor and preserve the predecessor's checks.
        Guid successorAssignmentId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var locationVersion = await db.Locations.Where(location => location.Id == locationId)
                .Select(location => location.Version).SingleAsync();
            var replaced = await scope.ServiceProvider.GetRequiredService<ILocationAssignments>()
                .ReplaceAssignmentAsync(owner.Id, locationId, successor.Id, Today, locationVersion,
                    "Synthetic Location handover successor", default);
            Assert.Equal(ChangeAssignmentStatus.Changed, replaced.Status);
            successorAssignmentId = replaced.Assignment!.Id;
            var transferred = await db.Set<OperationalTask>().AsNoTracking().SingleAsync(item => item.Id == taskId);
            Assert.Equal(successor.Id, transferred.AssignedStaffUserId);
            Assert.Equal(successorAssignmentId, transferred.AssignmentId);
            Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(item =>
                item.LocationId == locationId && item.Kind == OperationalTaskKind.LocationAssetHandover));
        }

        // The Location keeps one task ID. The successor inherits checked-item provenance
        // and can review/resubmit the checklist; the previous Staff loses all live access.
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route + "/location-asset-inventory")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = predecessorReport.Revision,
            snapshotSha256 = predecessorReport.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        var supersededReport = (await ownerClient.GetFromJsonAsync<LocationAssetHandoverReportView>(handover))!;
        Assert.Equal("Superseded", supersededReport.Status);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover + "/document")).StatusCode);
        var successorTask = (await successorClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(taskId, successorTask.Id);
        Assert.Equal(successor.Id, successorTask.CurrentResponsibleStaffUserId);
        Assert.Equal(successor.Id, successorTask.RecordedStaffUserId);
        var transferredInventory = (await successorClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;
        var successorEvidenceRows = (await successorClient.GetFromJsonAsync<TaskEvidenceView[]>(route + "/evidence"))!;
        var successorEvidence = Assert.Single(successorEvidenceRows);
        Assert.Equal(predecessorEvidence.Id, successorEvidence.Id);
        Assert.Equal(formerStaff.Id, successorEvidence.UploadedByUserId);
        Assert.Equal(predecessorEvidence.Length, successorEvidence.Length);
        Assert.Equal(successorAssignmentId, transferredInventory.AssignmentId);
        Assert.Equal("InProgress", transferredInventory.Status);
        Assert.Equal(2, transferredInventory.CheckedCount);
        Assert.All(transferredInventory.Items, item =>
        {
            Assert.True(item.Checked);
            Assert.Equal(taskId, item.PriorStaffTaskId);
            Assert.Equal(formerStaff.Id, item.PriorStaffUserId);
        });
        var predecessorChecked = Assert.Single(transferredInventory.Items, item => item.Id == firstItem.Id);
        Assert.Equal("Intact", predecessorChecked.Condition);
        Assert.Equal("Staff đầu đã kiểm tra mục này.", predecessorChecked.Note);

        using (var check = new HttpRequestMessage(HttpMethod.Put,
            route + "/location-asset-inventory/items/" + firstItem.Id)
        {
            Content = JsonContent.Create(new
            {
                version = successorTask.Version,
                @checked = true,
                condition = "Intact",
                note = "Staff kế nhiệm đã đối chiếu lại tài sản đã kiểm trước đó."
            })
        })
        {
            check.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.OK, (await successorClient.SendAsync(check)).StatusCode);
        }
        var continuedInventory = (await successorClient.GetFromJsonAsync<LocationAssetInventoryView>(
            route + "/location-asset-inventory"))!;
        Assert.Equal(2, continuedInventory.CheckedCount);
        var successorRechecked = Assert.Single(continuedInventory.Items, item => item.Id == firstItem.Id);
        Assert.Equal("Intact", successorRechecked.Condition);
        Assert.Equal("Staff kế nhiệm đã đối chiếu lại tài sản đã kiểm trước đó.", successorRechecked.Note);
        var retainedProvenance = Assert.Single(continuedInventory.Items,
            item => item.PriorStaffTaskId == taskId);
        Assert.Equal(formerStaff.Id, retainedProvenance.PriorStaffUserId);
        Assert.Equal("Staff đầu đã kiểm tra mục còn lại.", retainedProvenance.Note);
        successorTask = (await successorClient.GetFromJsonAsync<TaskView>(route))!;
        Assert.Equal(HttpStatusCode.OK, (await Post(successorClient, route + "/submit",
            new { version = successorTask.Version, note = "Staff kế nhiệm đã đối chiếu và gửi lại checklist." })).StatusCode);
        var successorOwnerTask = (await ownerClient.GetFromJsonAsync<TaskView>(route))!;
        var approved = await ownerClient.PostAsJsonAsync(handover + "/approve",
            new { taskVersion = successorOwnerTask.Version });
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var report = (await approved.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!;
        Assert.Equal(successor.Id, report.StaffId);
        Assert.Equal(predecessorReport.Revision + 1, report.Revision);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(handover + "/document")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync(handover)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        })).StatusCode);
        var successorSigned = await successorClient.PostAsJsonAsync(handover + "/sign", new
        {
            revision = report.Revision,
            snapshotSha256 = report.SnapshotSha256,
            confirmed = true, ink = Ink
        });
        Assert.Equal(HttpStatusCode.OK, successorSigned.StatusCode);
        Assert.Equal("Completed", (await successorSigned.Content.ReadFromJsonAsync<LocationAssetHandoverReportView>())!.Status);
        Assert.Equal(HttpStatusCode.NotFound, (await formerClient.GetAsync(route)).StatusCode);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Equal(1, await db.Set<OperationalTask>().CountAsync(item =>
                item.LocationId == locationId && item.Kind == OperationalTaskKind.LocationAssetHandover));
            Assert.Equal(taskId, await db.Set<OperationalTask>().AsNoTracking()
                .Where(item => item.LocationId == locationId && item.Kind == OperationalTaskKind.LocationAssetHandover)
                .Select(item => item.Id).SingleAsync());
        }
    }

    private static async Task<ApplicationUser> Seed(IServiceProvider provider, string role)
    {
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        if (role == "Owner" && await db.Users.FirstOrDefaultAsync(user =>
            EF.Property<string[]>(user, "roles").Contains(role)) is { } existingOwner)
            return existingOwner;
        var id = Guid.NewGuid();
        var user = new ApplicationUser
        {
            Id = id,
            UserName = id.ToString(),
            NormalizedUserName = id.ToString().ToUpperInvariant(),
            Email = $"{id:N}@example.invalid",
            NormalizedEmail = $"{id:N}@example.invalid".ToUpperInvariant(),
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
            LockoutEnabled = true,
            IsActive = true
        };
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ApplicationUser>>()
            .HashPassword(user, Password);
        db.Users.Add(user);
        db.Entry(user).Property("roles").CurrentValue = new[] { role };
        await db.SaveChangesAsync();
        return user;
    }

    private static async Task<HttpClient> Login(HttpClient client, ApplicationUser account)
    {
        var login = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email = account.Email, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string route, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        return await client.SendAsync(request);
    }

    private sealed class InMemoryHandoverDocuments : IObjectStorage
    {
        private readonly ConcurrentDictionary<string, byte[]> data = new();
        public async Task PutAsync(string key, Stream content, long length, string contentType, CancellationToken token)
        {
            using var memory = new MemoryStream();
            await content.CopyToAsync(memory, token);
            if (memory.Length != length || !data.TryAdd(key, memory.ToArray()))
                throw new InvalidOperationException("Immutable document collision.");
        }
        public async Task CopyToAsync(string key, Stream destination, CancellationToken token)
        {
            if (!data.TryGetValue(key, out var bytes)) throw new FileNotFoundException(key);
            await destination.WriteAsync(bytes, token);
        }
        public Task DeleteAsync(string key, CancellationToken token)
        {
            data.TryRemove(key, out _);
            return Task.CompletedTask;
        }
    }
}
