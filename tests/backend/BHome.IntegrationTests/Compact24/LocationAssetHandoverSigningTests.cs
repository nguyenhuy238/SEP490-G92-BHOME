using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
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

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class LocationAssetHandoverSigningTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Password = "Synthetic!Handover-492";
    private static DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);

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
            new { revision = report.Revision, snapshotSha256 = new string('F', 64), confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = new string('F', 64), confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true })).StatusCode);
        var signedOwner = await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true });
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
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true })).StatusCode);
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
            new { revision = report.Revision, snapshotSha256 = report.SnapshotSha256, confirmed = true })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.PostAsJsonAsync(handover + "/sign",
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true })).StatusCode);

        var signedStaff = await staffClient.PostAsJsonAsync(handover + "/sign",
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true });
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
            new { revision = newReport.Revision, snapshotSha256 = newReport.SnapshotSha256, confirmed = true })).StatusCode);
    }

    private static async Task<ApplicationUser> Seed(IServiceProvider provider, string role)
    {
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
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
