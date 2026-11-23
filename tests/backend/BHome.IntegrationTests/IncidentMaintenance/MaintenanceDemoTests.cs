using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Compact24;
using BHome.LocalDevelopment;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Minio;
using Minio.DataModel.Args;

namespace BHome.IntegrationTests.IncidentMaintenance;

public sealed class MaintenanceStorageFixture : IAsyncLifetime
{
    private readonly Compact24Fixture database = new();
    private IContainer? minio;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string StorageUrl { get; private set; } = "";
    public async Task InitializeAsync()
    {
        await database.InitializeAsync();
        if (database.Factory is null) return;
        var password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        minio = new ContainerBuilder("bhome/minio-local:2025-10-15")
            .WithEnvironment("MINIO_ROOT_USER", "synthetic-bf07").WithEnvironment("MINIO_ROOT_PASSWORD", password)
            .WithCommand("server", "/data").WithPortBinding(9000, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9000).ForPath("/minio/health/live"))).Build();
        await minio.StartAsync();
        var endpoint = $"{minio.Hostname}:{minio.GetMappedPublicPort(9000)}"; StorageUrl = "http://" + endpoint;
        using var storage = new MinioClient().WithEndpoint(endpoint).WithCredentials("synthetic-bf07", password).Build();
        await storage.MakeBucketAsync(new MakeBucketArgs().WithBucket("maintenance-tests"));
        Factory = database.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ObjectStorage:Endpoint"] = endpoint,
            ["ObjectStorage:UseSsl"] = "false",
            ["ObjectStorage:Bucket"] = "maintenance-tests",
            ["ObjectStorage:AccessKey"] = "synthetic-bf07",
            ["ObjectStorage:SecretKey"] = password
        })));
    }
    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        if (minio is not null) await minio.DisposeAsync();
        await database.DisposeAsync();
    }
}

public sealed class MaintenanceDemoTests(MaintenanceStorageFixture fixture) : IClassFixture<MaintenanceStorageFixture>
{
    private const string Password = "Synthetic-BF07-Only!123";
    private async Task Seed()
    {
        using var seeder = fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ICurrentUser>(); s.AddSingleton<LifecycleSeedActor>();
            s.AddSingleton<ICurrentUser>(p => p.GetRequiredService<LifecycleSeedActor>());
        }));
        await MaintenanceDemoSeed.RunAsync(seeder.Services, "Development", Password);
    }
    private async Task<HttpClient> Login(string email)
    {
        var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password }); response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new("Bearer", (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        return client;
    }
    [CompactPostgresFact]
    public async Task DemoSeedIsRepeatableAndEvidenceUsesRealPrivateMinio()
    {
        await Seed(); await Seed();
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(6, await db.Set<MaintenanceWorkOrder>().CountAsync(w => w.LocationId == MaintenanceDemoSeed.Id(10) && w.Description.StartsWith("[DEMO BF07")));
        Assert.Equal(5, await db.Set<IncidentReport>().CountAsync(r => r.LocationId == MaintenanceDemoSeed.Id(10)));
        Assert.Equal(2, await db.Set<MaintenanceCompensation>().CountAsync(c => c.LocationId == MaintenanceDemoSeed.Id(10)));
        var originalRoom = await db.Set<Room>().SingleAsync(r => r.Id == MaintenanceDemoSeed.Id(20));
        Assert.Equal("BF07-101", originalRoom.RoomNumber);
        var reportRoom = await db.Set<Room>().SingleAsync(r => r.Id == MaintenanceDemoSeed.Id(22));
        Assert.NotEqual(originalRoom.Id, reportRoom.Id);
        Assert.Equal("P.101", reportRoom.RoomNumber);
        Assert.Equal(RoomStatus.Occupied, reportRoom.Status);
        var p101Contract = await db.Set<Contract>().SingleAsync(c => c.Id == MaintenanceDemoSeed.Id(51));
        Assert.Equal(reportRoom.Id, p101Contract.RoomId);
        Assert.Equal(originalRoom.LocationId, reportRoom.LocationId);
        Assert.Equal(Compact24SampleSeed.Id(3), p101Contract.TenantUserId);
        Assert.Equal(ContractStatus.Active, p101Contract.Status);
        Assert.True(p101Contract.StartDate <= DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7)));
        Assert.True(p101Contract.EndDate >= DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7)));
        var p101Resident = await db.Set<Resident>().SingleAsync(r => r.Id == MaintenanceDemoSeed.Id(41));
        Assert.Equal(reportRoom.Id, p101Resident.RoomId);
        Assert.Equal(Compact24SampleSeed.Id(3), p101Resident.TenantUserId);
        Assert.Equal(p101Resident.Id, p101Contract.RepresentativeResidentId);
        var airConditioner = await db.Set<Asset>().SingleAsync(a => a.Id == MaintenanceDemoSeed.Id(32));
        Assert.Equal(reportRoom.Id, airConditioner.RoomId);
        Assert.Equal("Điều hòa 1.5 HP", airConditioner.Name);
        var tenantIncident = await db.Set<IncidentReport>().SingleAsync(r => r.Description == "Điều hòa phòng P.101 không làm lạnh");
        Assert.Equal(reportRoom.Id, tenantIncident.RoomId);
        Assert.Equal(airConditioner.Id, tenantIncident.AssetId);
        Assert.Equal(p101Contract.Id, tenantIncident.ContractId);
        Assert.Equal(Compact24SampleSeed.Id(3), tenantIncident.ReporterId);
        Assert.Equal(Roles.Tenant, tenantIncident.ReporterRole);
        Assert.Equal(IncidentSeverity.Normal, tenantIncident.Severity);
        Assert.Equal(IncidentStatus.Submitted, tenantIncident.Status);
        foreach (var label in new[]
        {
            "[DEMO BF07 A] Thiết bị trong phòng hỏng, chưa xác định tài sản",
            "[DEMO BF07 B] Vỡ đường nước gây ngập phòng, cần cô lập khu vực",
            "[DEMO BF07 E] Cần kiểm tra thiết bị và đề xuất tài sản liên quan",
            "[DEMO BF07 I] Hỏng thiết bị cần sửa chữa và xác minh lại"
        })
            Assert.Equal(originalRoom.Id, (await db.Set<IncidentReport>().SingleAsync(r => r.Description == label)).RoomId);
        var tenantEvidence = await db.Set<IncidentEvidence>().SingleAsync(e => e.IncidentId == tenantIncident.Id && e.Kind == IncidentEvidenceKind.Report);
        Assert.Equal("image/png", tenantEvidence.ContentType);
        var work = await db.Set<MaintenanceWorkOrder>().SingleAsync(w => w.Description.StartsWith("[DEMO BF07 G]"));
        var evidence = await db.Set<IncidentEvidence>().SingleAsync(e => e.WorkOrderId == work.Id && e.Kind == IncidentEvidenceKind.Completion);
        using var owner = await Login("owner.sample@example.invalid"); using var staff = await Login("staff.sample@example.invalid");
        using var tenant = await Login("tenant.sample@example.invalid");
        var reportBytes = await tenant.GetByteArrayAsync($"/api/v1/incidents/{tenantIncident.Id}/evidence/{tenantEvidence.Id}");
        Assert.Equal(tenantEvidence.Sha256, Convert.ToHexString(SHA256.HashData(reportBytes)));
        Assert.True(reportBytes.Length > 100);
        var path = $"/api/v1/work-orders/{work.Id}/evidence/{evidence.Id}";
        var bytes = await owner.GetByteArrayAsync(path); Assert.Equal(evidence.Sha256, Convert.ToHexString(SHA256.HashData(bytes)));
        Assert.Equal(bytes, await staff.GetByteArrayAsync(path));
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        using var anonymous = new HttpClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await anonymous.GetAsync(fixture.StorageUrl + "/maintenance-tests/" + evidence.ObjectKey)).StatusCode);
        var compensation = await db.Set<MaintenanceCompensation>().SingleAsync(c => c.WorkOrderId == work.Id);
        Assert.Equal(HttpStatusCode.OK, (await tenant.GetAsync($"/api/v1/invoices/{compensation.InvoiceId}/payment")).StatusCode);
    }
    [CompactBrowserFact]
    public async Task OwnerBrowserRunsProactiveRepairThroughRealStaffApiAndMinio()
    {
        await Seed();
        var root = Repository(); var directory = Path.Combine(root, ".tools", "bf07-browser-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var apiPort = LoopbackBrowserApiBridge.AvailablePort(); var webPort = LoopbackBrowserApiBridge.AvailablePort();
        var web = $"http://127.0.0.1:{webPort}"; var api = $"http://127.0.0.1:{apiPort}";
        using var host = fixture.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        { ["Cors:AllowedOrigins:0"] = web, ["AuthWeb:AllowedOrigins:0"] = web })));
        await using var bridge = new LoopbackBrowserApiBridge(host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }), apiPort);
        var config = Path.Combine(directory, "fixture.private.json");
        await File.WriteAllTextAsync(config, JsonSerializer.Serialize(new { api, web, output = directory, password = Password, locationId = MaintenanceDemoSeed.Id(10) }));
        var node = Environment.GetEnvironmentVariable("BHOME_TEST_NODE") ?? Path.Combine(root, ".tools", "node-v22.23.4-win-x64", "node.exe");
        var start = new ProcessStartInfo(node) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(root, "scripts", "Test-IncidentMaintenanceBrowser.mjs")); start.ArgumentList.Add(config);
        using var child = Process.Start(start) ?? throw new InvalidOperationException("browser_runner_not_started");
        var output = child.StandardOutput.ReadToEndAsync(); var errors = child.StandardError.ReadToEndAsync();
        try { using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(4)); await child.WaitForExitAsync(deadline.Token); }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
        await File.WriteAllTextAsync(Path.Combine(directory, "runner.log"), await output + "\n" + await errors);
        Assert.True(child.ExitCode == 0, "BF07 browser failed. Inspect .tools/bf07-browser-* runner.log.");
        Assert.True(File.Exists(Path.Combine(directory, "passed.json")));
    }
    private static string Repository()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "package.json")) && Directory.Exists(Path.Combine(d.FullName, "src/owner-web"))) return d.FullName;
        throw new InvalidOperationException("repository_not_found");
    }
}
