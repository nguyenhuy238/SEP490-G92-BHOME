using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Minio;
using Minio.DataModel.Args;
using OpenCvSharp;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.Ocr;

[Trait("Category", "Docker")]
public sealed class CaptureWorkflowTests : IClassFixture<CaptureFixture>
{
    private readonly CaptureFixture fixture;
    public CaptureWorkflowTests(CaptureFixture fixture) => this.fixture = fixture;
    private const string Password = "Synthetic-Test-Password!123";
    private async Task<(HttpClient Client, Guid UserId)> User(string role, Guid? owner = null)
    {
        var name = Guid.NewGuid().ToString(); var id = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var u = new ApplicationUser { Id = id, UserName = name, Email = name + "@example.invalid", ManagingOwnerId = owner, LockoutEnabled = true };
            Assert.True((await users.CreateAsync(u, Password)).Succeeded); Assert.True((await users.AddToRoleAsync(u, role)).Succeeded);
        }
        var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = name + "@example.invalid", password = Password });
        response.EnsureSuccessStatusCode(); var session = await response.Content.ReadFromJsonAsync<LoginResult>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session!.AccessToken);
        return (client, id);
    }
    private static async Task<Guid> Create(HttpClient c, string path, object data)
    {
        var response = await c.PostAsJsonAsync("/api/v1/capture/" + path, data);
        Assert.True(response.IsSuccessStatusCode, $"{path}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<IdResult>())!.Id;
    }
    private async Task<(HttpClient Owner, HttpClient Staff, Guid OwnerId, Guid StaffId, Guid Location, Guid Room, Guid Resident, Guid Meter)> Workspace()
    {
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff, owner.UserId);
        var chain = await Create(owner.Client, "chains", new ChainInput("Synthetic Chain"));
        var location = await Create(owner.Client, "locations", new LocationInput(chain, "Synthetic Location", "Synthetic Address"));
        var room = await Create(owner.Client, "rooms", new RoomInput(location, "TEST-01"));
        await Create(owner.Client, "assignments", new AssignmentInput(location, staff.UserId, Today.AddDays(-20), null));
        var resident = await Create(staff.Client, "residents", new ResidentInput(room, "Hồ sơ kiểm thử", ResidentType.CoOccupant));
        var meter = await Create(owner.Client, "meters", new MeterInput(room, "SYNTHETIC-METER", UtilityType.Water, MeterDisplay.Digital, 2, Today.AddDays(-20)));
        return (owner.Client, staff.Client, owner.UserId, staff.UserId, location, room, resident, meter);
    }
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private static IdentityConfirmation Identity(string number = "000000000000") => new(true, number, "NGƯỜI KIỂM THỬ", new(2000, 1, 1), "ĐỊA CHỈ GIẢ LẬP", null, null, null, null, null);
    [Fact]
    public async Task ParallelDuplicateIdentitiesHaveOneWinnerAndNoAutomaticMerge()
    {
        var w = await Workspace();
        var second = await Create(w.Staff, "residents", new ResidentInput(w.Room, "Hồ sơ độc lập", ResidentType.CoOccupant));
        var replies = await Task.WhenAll(new[] { w.Resident, second }.Select(id => w.Staff.PostAsJsonAsync($"/api/v1/capture/residents/{id}/confirm", Identity())));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(2, await db.Set<Resident>().CountAsync(r => r.RoomId == w.Room));
        Assert.Equal(1, await db.Set<Resident>().CountAsync(r => r.RoomId == w.Room && r.VerificationStatus == IdentityVerificationStatus.Verified));
    }
    [Fact]
    public async Task IdentityRequiresHumanConfirmationEncryptsAndDeduplicatesWithoutLeakingOtherRecords()
    {
        var w = await Workspace();
        var path = $"/api/v1/capture/residents/{w.Resident}/confirm";
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.PostAsJsonAsync(path, Identity() with { HumanConfirmed = false })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.Staff.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.Staff.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync(path, Identity() with { FullName = "KHÁC" })).StatusCode);
        var duplicate = await Create(w.Staff, "residents", new ResidentInput(w.Room, "Hồ sơ thứ hai", ResidentType.CoOccupant));
        var dup = await w.Staff.PostAsJsonAsync($"/api/v1/capture/residents/{duplicate}/confirm", Identity());
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);
        Assert.DoesNotContain(w.Resident.ToString(), await dup.Content.ReadAsStringAsync());
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var saved = await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident);
        Assert.Equal(IdentityVerificationStatus.Verified, saved.VerificationStatus);
        Assert.DoesNotContain("000000000000", saved.IdentityData); Assert.DoesNotContain("2000-01-01", saved.IdentityData);
        Assert.DoesNotContain("ĐỊA CHỈ", saved.IdentityData); Assert.Equal(64, saved.IdentityHmac!.Length);
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.Event == "IdentityConfirmed" && a.TargetId == w.Resident));
        var listing = await w.Staff.GetStringAsync($"/api/v1/capture/locations/{w.Location}/residents");
        Assert.DoesNotContain("IdentityData", listing); Assert.DoesNotContain("000000000000", listing);
    }
    [Fact]
    public async Task CrossOwnerOtherStaffExpiredAssignmentAndTenantCannotConfirmOrDownload()
    {
        var w = await Workspace(); var otherOwner = await User(Roles.Owner); var otherStaff = await User(Roles.Staff, w.OwnerId); var tenant = await User(Roles.Tenant);
        var path = $"/api/v1/capture/residents/{w.Resident}/confirm";
        Assert.Equal(HttpStatusCode.Forbidden, (await otherOwner.Client.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStaff.Client.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.Client.GetAsync("/api/v1/capture/meter-tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherOwner.Client.GetAsync($"/api/v1/capture/locations/{w.Location}/residents")).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var assignment = await db.Set<StaffLocationAssignment>().SingleAsync(a => a.LocationId == w.Location && a.StaffUserId == w.StaffId);
            assignment.EffectiveTo = Today.AddDays(-1); await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await w.Staff.PostAsJsonAsync(path, Identity())).StatusCode);
    }
    private static byte[] Image()
    { using var image = new Mat(120, 300, MatType.CV_8UC3, Scalar.White); Cv2.PutText(image, "123.45", new(15, 70), HersheyFonts.HersheySimplex, 1.2, Scalar.Black, 2); return image.ImEncode(".png"); }
    private static async Task<Guid> Evidence(HttpClient client, Guid task)
    {
        using var content = new ByteArrayContent(Image()); content.Headers.ContentType = new("image/png");
        var response = await client.PutAsync($"/api/v1/capture/meter-tasks/{task}/evidence", content);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<IdResult>())!.Id;
    }
    [Fact]
    public async Task MeterEvidenceStoredPrivatelyConfirmationIsIdempotentAndOnlyConfirmedUsageIsReturned()
    {
        var w = await Workspace();
        var initial = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, w.StaffId, ReadingPurpose.Initial, Today.AddDays(-10), null));
        var initialEvidence = await Evidence(w.Staff, initial);
        var response = await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{initial}/confirm", new MeterConfirmation(true, 100, initialEvidence));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var baseline = await response.Content.ReadFromJsonAsync<ConfirmedReading>(); Assert.Null(baseline!.Consumption);
        var period = new DateOnly(Today.Year, Today.Month, 1);
        var periodic = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, w.StaffId, ReadingPurpose.Periodic, Today, period));
        var evidence = await Evidence(w.Staff, periodic);
        var data = new MeterConfirmation(true, 125.5m, evidence);
        var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{periodic}/confirm", data)));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var reading = await replies[0].Content.ReadFromJsonAsync<ConfirmedReading>(); Assert.Equal(25.5m, reading!.Consumption);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{periodic}/confirm", data with { ConfirmedValue = 126 })).StatusCode);
        var file = await w.Staff.GetAsync($"/api/v1/capture/readings/{reading.Id}/evidence"); Assert.Equal(Image(), await file.Content.ReadAsByteArrayAsync());
        var stranger = await User(Roles.Owner); Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"/api/v1/capture/readings/{reading.Id}/evidence")).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.Equal(1, await db.Set<MeterReading>().CountAsync(r => r.TaskId == periodic));
        Assert.Equal(MeterTaskStatus.Completed, (await db.Set<OperationalTask>().SingleAsync(a => a.Id == periodic)).Status);
        var stored = await db.Set<MeterEvidence>().SingleAsync(a => a.Id == evidence); Assert.True(stored.IsLinked); Assert.DoesNotContain("http", stored.ObjectKey);
        using var unauthenticated = new HttpClient();
        var privateObject = await unauthenticated.GetAsync(fixture.StorageUrl + "/capture-tests/" + stored.ObjectKey); Assert.Equal(HttpStatusCode.Forbidden, privateObject.StatusCode);
    }
    [Fact]
    public async Task MissingBaselineWrongEvidenceAndUnconfirmedOrNegativeReadingCannotCompleteTask()
    {
        var w = await Workspace();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, w.StaffId, ReadingPurpose.Periodic, Today, new(Today.Year, Today.Month, 1)));
        var evidence = await Evidence(w.Staff, task); var route = $"/api/v1/capture/meter-tasks/{task}/confirm";
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(false, 10, evidence))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, -1, evidence))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, 10, Guid.NewGuid()))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, 10, evidence))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
        Assert.Equal(MeterTaskStatus.Assigned, (await db.Set<OperationalTask>().SingleAsync(a => a.Id == task)).Status);
    }
    [Fact]
    public async Task PartialStorageFailureLeavesDurableCleanupIntentAndCannotCreateConfirmedReading()
    {
        var w = await Workspace();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, w.StaffId, ReadingPurpose.Initial, Today, null));
        await using var services = fixture.Factory.Services.CreateAsyncScope();
        var db = services.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var realStorage = services.ServiceProvider.GetRequiredService<IObjectStorage>();
        // Simulate a provider accepting bytes, then losing its response. The intent must still recover it.
        var failing = new FailingPutStorage(realStorage);
        using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IObjectStorage>(failing)));
        using var client = host.CreateClient();
        var email = (await db.Users.SingleAsync(u => u.Id == w.StaffId)).Email;
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
        login.EnsureSuccessStatusCode();
        var session = await login.Content.ReadFromJsonAsync<LoginResult>(); client.DefaultRequestHeaders.Authorization = new("Bearer", session!.AccessToken);
        using var content = new ByteArrayContent(Image()); content.Headers.ContentType = new("image/png");
        Assert.Equal(HttpStatusCode.InternalServerError, (await client.PutAsync($"/api/v1/capture/meter-tasks/{task}/evidence", content)).StatusCode);
        var intent = await db.Set<MeterEvidence>().SingleAsync(e => e.TaskId == task);
        Assert.False(intent.IsUploaded); Assert.False(intent.IsLinked); Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
        var confirm = await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm", new MeterConfirmation(true, 10, intent.Id));
        Assert.Equal(HttpStatusCode.Conflict, confirm.StatusCode);
        intent.CleanupAfter = DateTimeOffset.UtcNow.AddMinutes(-1); await db.SaveChangesAsync();
        await MeterEvidenceCleanup.CleanupAsync(db, realStorage, default);
        Assert.False(await db.Set<MeterEvidence>().AnyAsync(e => e.Id == intent.Id));
        await Assert.ThrowsAnyAsync<Exception>(() => realStorage.CopyToAsync(intent.ObjectKey, Stream.Null, default));
    }
    private sealed class FailingPutStorage(IObjectStorage inner) : IObjectStorage
    {
        public async Task PutAsync(string key, Stream data, long length, string type, CancellationToken token)
        { await inner.PutAsync(key, data, length, type, token); throw new IOException("SYNTHETIC_PROVIDER_FAILURE"); }
        public Task CopyToAsync(string key, Stream output, CancellationToken token) => inner.CopyToAsync(key, output, token);
        public Task DeleteAsync(string key, CancellationToken token) => inner.DeleteAsync(key, token);
    }
}

public sealed class CaptureFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private readonly string storagePassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private IContainer? minio;
    private ApiFactory? root;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string StorageUrl { get; private set; } = "";
    public async Task InitializeAsync()
    {
        minio = new ContainerBuilder("bhome/minio-local:2025-10-15").WithEnvironment("MINIO_ROOT_USER", "synthetic-test")
            .WithEnvironment("MINIO_ROOT_PASSWORD", storagePassword).WithCommand("server", "/data").WithPortBinding(9000, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9000).ForPath("/minio/health/live"))).Build();
        await Task.WhenAll(postgres.StartAsync(), minio.StartAsync());
        var endpoint = $"{minio.Hostname}:{minio.GetMappedPublicPort(9000)}"; StorageUrl = "http://" + endpoint;
        using var storage = new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-test", storagePassword).Build();
        await storage.MakeBucketAsync(new MakeBucketArgs().WithBucket("capture-tests"));
        root = new ApiFactory { ConnectionString = postgres.GetConnectionString() };
        Factory = root.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["IdentityProtection:ActiveEncryptionVersion"] = "test",
            ["IdentityProtection:ActiveHmacVersion"] = "test",
            ["IdentityProtection:EncryptionKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            ["IdentityProtection:HmacKeys:test"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            ["ObjectStorage:Endpoint"] = endpoint,
            ["ObjectStorage:UseSsl"] = "false",
            ["ObjectStorage:Bucket"] = "capture-tests",
            ["ObjectStorage:AccessKey"] = "synthetic-test",
            ["ObjectStorage:SecretKey"] = storagePassword
        })));
        await using var scope = Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }
    public async Task DisposeAsync()
    {
        try
        {
            if (Factory is not null) await Factory.DisposeAsync();
        }
        finally
        {
            try
            {
                if (root is not null) await root.DisposeAsync();
            }
            finally
            {
                try
                {
                    if (minio is not null) await minio.DisposeAsync();
                }
                finally { await postgres.DisposeAsync(); }
            }
        }
    }
}
