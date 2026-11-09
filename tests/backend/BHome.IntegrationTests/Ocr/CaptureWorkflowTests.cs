using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
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
using Microsoft.Extensions.Logging.Abstractions;
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
    private readonly string identityNumber = "000" + RandomNumberGenerator.GetInt32(1_000_000_000).ToString("D9");

    [Fact]
    public async Task MeterOcrUsesPersistedProfilesAndRejectsOtherLocationsBeforeInference()
    {
        var w = await Workspace();
        var engine = new ProfileEngine();
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance))));
        using var client = host.CreateClient();
        await using (var loginScope = host.Services.CreateAsyncScope())
        {
            var email = (await loginScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Users.SingleAsync(u => u.Id == w.StaffId)).Email;
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
            login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        }
        var profiles = new[] {
            (UtilityType.Water, MeterDisplay.Mechanical, OcrDocumentKind.MechanicalWater),
            (UtilityType.Water, MeterDisplay.Digital, OcrDocumentKind.DigitalWater),
            (UtilityType.Electricity, MeterDisplay.Mechanical, OcrDocumentKind.MechanicalElectricity),
            (UtilityType.Electricity, MeterDisplay.Digital, OcrDocumentKind.DigitalElectricity) };
        foreach (var (utility, display, expected) in profiles)
        {
            var room = await Create(w.Owner, "rooms", new RoomInput(w.Location, "SYN-" + expected, 2));
            var meter = await Create(w.Owner, "meters", new MeterInput(room, "SYN-" + expected, utility, display, 2, Today.AddDays(-10)));
            var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(meter, ReadingPurpose.Initial, Today, null));
            using var image = new ByteArrayContent(Image()); image.Headers.ContentType = new("image/png");
            var response = await client.PostAsync($"/api/v1/ocr/meter-tasks/{task}?kind=DigitalElectricity&decimalPlaces=0", image);
            response.EnsureSuccessStatusCode();
            var proposal = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
            Assert.Equal(expected, engine.Kinds.Last());
            Assert.Equal("000123.45", proposal.ProposedFields["reading"]);
            Assert.True(proposal.RequiresConfirmation);
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            Assert.Equal(123.45m, (await db.Set<OperationalTask>().SingleAsync(t => t.Id == task)).OcrProposedValue);
            Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
        }
        Assert.Equal(4, engine.Kinds.Count);
        var foreign = await Workspace();
        var foreignTask = await Create(foreign.Owner, "meter-tasks", new MeterTaskInput(foreign.Meter, ReadingPurpose.Initial, Today, null));
        using var rejectedImage = new ByteArrayContent(Image()); rejectedImage.Headers.ContentType = new("image/png");
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/v1/ocr/meter-tasks/{foreignTask}", rejectedImage)).StatusCode);
        Assert.Equal(4, engine.Kinds.Count);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope();
        Assert.Null((await finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Set<OperationalTask>().SingleAsync(t => t.Id == foreignTask)).OcrProposedValue);
        var bad = await w.Owner.PostAsJsonAsync("/api/v1/capture/meters", new MeterInput(w.Room, "SYN-INVALID", UtilityType.Water, (MeterDisplay)99, 2, Today));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    private sealed class ProfileEngine : IOcrEngine
    {
        public List<OcrDocumentKind> Kinds { get; } = [];
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
        { Kinds.Add(kind); return Task.FromResult(new OcrText([new("00012345", .99f)], "synthetic-profile-test", [])); }
    }

    internal async Task AssignedExperimentalModelsUseDatabaseProfileWithoutWritingProposals()
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var w = await Workspace();
        var meter = await Create(w.Owner, "meters", new MeterInput(w.Room, "SYN-EXPERIMENTAL-ELECTRICITY", UtilityType.Electricity, MeterDisplay.Digital, 2, Today.AddDays(-10)));
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(meter, ReadingPurpose.Initial, Today, null));
        using var host = fixture.Factory.WithWebHostBuilder(b => b.UseEnvironment("Development").ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["MobileDevelopment:Enabled"] = "true",
                ["Ocr:Enabled"] = "true",
                ["Ocr:TimeoutMilliseconds"] = "9000",
                ["Ocr:ModelDirectory"] = Path.Combine(directory, ".tools/ocr-models"),
                ["Ocr:ExperimentalMeter:Enabled"] = "true",
                ["Ocr:ExperimentalMeter:ClassifierPath"] = Path.Combine(directory, ".tools/ocr-runtime-focus/classifier-cv2/classifier.onnx"),
                ["Ocr:ExperimentalMeter:ClassifierSha256"] = "f7277b0570a4d6a959cbba52a6492d304029a63c22a372ca37764787df8921f3",
                ["Ocr:ExperimentalMeter:EnglishModelDirectory"] = Path.Combine(directory, ".tools/ocr-recovery-english"),
                ["Ocr:ExperimentalMeter:Categories:0"] = "DigitalElectricity"
            })));
        using var client = host.CreateClient();
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var email = (await db.Users.SingleAsync(u => u.Id == w.StaffId)).Email;
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password }); login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
            var saved = await db.Set<OperationalTask>().SingleAsync(t => t.Id == task);
            saved.OcrProposedValue = 17.25m; saved.OcrImageHash = new string('a', 64); saved.OcrEngineVersion = "prior-proposal"; await db.SaveChangesAsync();
        }
        var observations = new List<object>();
        foreach (var (id, path, expected) in new[] {
            ("105770219",".tools/master-dataset/commons/commons_105770219.jpg",(string?)null),
            ("54903199",".tools/ocr-continued/commons_54903199.jpg","000501"),
            ("136480278",".tools/master-dataset/commons/commons_136480278.jpg","74590"),
            ("151445788",".tools/master-dataset/commons/commons_151445788.jpg",(string?)null),
            ("136480279",".tools/master-dataset/commons/commons_136480279.jpg",(string?)null) })
        {
            using var body = new ByteArrayContent(await File.ReadAllBytesAsync(Path.Combine(directory, path))); body.Headers.ContentType = new("image/jpeg");
            using var response = await client.PostAsync($"/api/v1/ocr/diagnostics/auto?experimental=true&taskId={task}&kind=DigitalWater&decimalPlaces=0", body);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync()); var analysis = json.RootElement.GetProperty("analysis");
            Assert.Equal(expected, analysis.GetProperty("readingCandidate").GetString());
            Assert.False(analysis.GetProperty("businessProposalEnabled").GetBoolean());
            Assert.Contains(analysis.GetProperty("warnings").EnumerateArray(), x => x.GetString() == "trusted_meter_profile");
            if (id == "105770219")
            {
                Assert.Equal("electricity_mechanical", analysis.GetProperty("candidateCategory").GetString());
                Assert.Equal("numeric_text_present_display_unverified", analysis.GetProperty("displayState").GetString());
            }
            observations.Add(new { id, result = json.RootElement.Clone() });
        }
        var foreign = await Workspace(); var foreignTask = await Create(foreign.Owner, "meter-tasks", new MeterTaskInput(foreign.Meter, ReadingPurpose.Initial, Today, null));
        using (var body = new ByteArrayContent([]))
        {
            body.Headers.ContentType = new("image/jpeg");
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/v1/ocr/diagnostics/auto?experimental=true&taskId={foreignTask}", body)).StatusCode);
        }
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var saved = await db.Set<OperationalTask>().SingleAsync(t => t.Id == task);
            Assert.Equal(17.25m, saved.OcrProposedValue); Assert.Equal(new string('a', 64), saved.OcrImageHash); Assert.Equal("prior-proposal", saved.OcrEngineVersion);
            Assert.NotEqual(MeterTaskStatus.Completed, saved.Status); Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
            var assignment = await db.Set<StaffLocationAssignment>().SingleAsync(a => a.LocationId == w.Location && a.StaffUserId == w.StaffId);
            db.Entry(assignment).Property(a => a.EndDate).CurrentValue = Today.AddDays(-1);
            await db.SaveChangesAsync();
        }
        using (var body = new ByteArrayContent([]))
        {
            body.Headers.ContentType = new("image/jpeg");
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/v1/ocr/diagnostics/auto?experimental=true&taskId={task}", body)).StatusCode);
        }
        await File.WriteAllTextAsync(Path.Combine(directory, ".tools/ocr-next-staff/assigned-runtime.json"), System.Text.Json.JsonSerializer.Serialize(observations, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }

    // Invoked only by the explicit local-model + disposable-PostgreSQL test.
    // Public fixture pixels are real; accounts and configured precision are synthetic.
    internal async Task RealMeterModelsPersistProposalThenStaffCorrectionAndEvidence()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var source = await File.ReadAllBytesAsync(Path.Combine(root, ".tools/meter-detection-all-test/wm_clean_000058.jpg"));
        using var manifest = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root,
            "tools/BHome.OcrSmoke/model_tools/evaluation-full-test-manifest.json")));
        Assert.Equal(manifest.RootElement.GetProperty("wm_clean_000058.jpg").GetString(),
            Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant());
        using var frame = Cv2.ImDecode(source, ImreadModes.Color); using var resized = new Mat();
        var ratio = Math.Min(1d, 1600d / Math.Max(frame.Width, frame.Height));
        Cv2.Resize(frame, resized, new((int)(frame.Width * ratio), (int)(frame.Height * ratio)), 0, 0, InterpolationFlags.Area);
        var bytes = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
        var w = await Workspace();
        var room = await Create(w.Owner, "rooms", new RoomInput(w.Location, "SYN-REAL-MODEL", 2));
        var meter = await Create(w.Owner, "meters", new MeterInput(room, "SYN-REAL-WATER", UtilityType.Water, MeterDisplay.Mechanical, 2, Today.AddDays(-10)));
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(meter, ReadingPurpose.Initial, Today, null));
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = Path.Combine(root, ".tools/ocr-models"),
            MeterDetectionMinConfidence = .7f,
            MeterDetector = new()
            {
                Enabled = true,
                WaterDigitsEnabled = true,
                ModelDirectory = Path.Combine(root, ".tools/meter-detection-models")
            }
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, waterDigits: digits);
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance))));
        using var client = host.CreateClient();
        // Each test host has its own signing key; authenticate on this host.
        await using (var loginScope = host.Services.CreateAsyncScope())
        {
            var email = (await loginScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Users.SingleAsync(u => u.Id == w.StaffId)).Email;
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password }); login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        }
        using var image = new ByteArrayContent(bytes); image.Headers.ContentType = new("image/jpeg");
        var response = await client.PostAsync($"/api/v1/ocr/meter-tasks/{task}", image); response.EnsureSuccessStatusCode();
        var proposal = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
        Assert.Equal("004314.69", proposal.ProposedFields["reading"]);
        Assert.Equal(OnnxOcrEngine.Version, proposal.EngineVersion);
        Assert.True(proposal.RequiresConfirmation);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
            Assert.Equal(4314.69m, (await db.Set<OperationalTask>().SingleAsync(t => t.Id == task)).OcrProposedValue);
        }
        using var evidenceBytes = new ByteArrayContent(bytes); evidenceBytes.Headers.ContentType = new("image/jpeg");
        var upload = await client.PutAsync($"/api/v1/capture/meter-tasks/{task}/evidence", evidenceBytes); upload.EnsureSuccessStatusCode();
        var evidence = (await upload.Content.ReadFromJsonAsync<IdResult>())!.Id;
        var confirmation = new MeterConfirmation(true, 4314.70m, evidence);
        var confirmed = await client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm", confirmation); confirmed.EnsureSuccessStatusCode();
        var result = (await confirmed.Content.ReadFromJsonAsync<ConfirmedReading>())!;
        var replay = await client.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm", confirmation); replay.EnsureSuccessStatusCode();
        Assert.Equal(result.Id, (await replay.Content.ReadFromJsonAsync<ConfirmedReading>())!.Id);
        await using var finalScope = host.Services.CreateAsyncScope();
        var storedDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var stored = await storedDb.Set<MeterReading>().SingleAsync(r => r.TaskId == task);
        Assert.Equal(MeterReadingStatus.Corrected, stored.Status);
        Assert.Equal(4314.69m, stored.OcrProposedValue);
        Assert.Equal(4314.70m, stored.ConfirmedValue);
        Assert.Null(stored.Consumption);
        var storedEvidence = await storedDb.Set<MeterEvidence>().SingleAsync(e => e.Id == evidence);
        Assert.True(storedEvidence.IsLinked);
        using var downloaded = new MemoryStream();
        await finalScope.ServiceProvider.GetRequiredService<IObjectStorage>().CopyToAsync(storedEvidence.ObjectKey, downloaded, default);
        Assert.Equal(SHA256.HashData(bytes), SHA256.HashData(downloaded.ToArray()));
    }

    [Fact]
    public async Task OcrPersistsOnlyTheProposalUsingDatabaseDisplayPrecision()
    {
        var w = await Workspace();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Initial, Today, null));
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => new DigitsEngine()), NullLogger<LocalOcrService>.Instance))));
        using var client = host.CreateClient();
        await using var loginScope = host.Services.CreateAsyncScope();
        var loginDb = loginScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var email = (await loginDb.Users.SingleAsync(user => user.Id == w.StaffId)).Email;
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
        login.EnsureSuccessStatusCode();
        var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
        using var image = new ByteArrayContent(Image());
        image.Headers.ContentType = new("image/png");
        var response = await client.PostAsync($"/api/v1/ocr/meter-tasks/{task}?decimalPlaces=0", image);
        response.EnsureSuccessStatusCode();
        var proposal = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
        Assert.Equal("000123.45", proposal.ProposedFields["reading"]);
        Assert.True(proposal.RequiresConfirmation);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var stored = await db.Set<OperationalTask>().SingleAsync(value => value.Id == task);
        Assert.Equal(123.45m, stored.OcrProposedValue);
        Assert.False(await db.Set<MeterReading>().AnyAsync(value => value.TaskId == task));
    }

    private sealed class DigitsEngine : IOcrEngine
    {
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token)
            => Task.FromResult(new OcrText([new("00012345", .99f)], "synthetic", []));
    }

    [Fact]
    public async Task OcrWarnsAgainstTheSameMetersConfirmedBaselineWithoutCompletingTheTask()
    {
        var w = await Workspace();
        var initial = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Initial, Today.AddDays(-10), null));
        var evidence = await Evidence(w.Staff, initial);
        var confirmation = await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{initial}/confirm",
            new MeterConfirmation(true, 200m, evidence));
        confirmation.EnsureSuccessStatusCode();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Periodic,
            Today, new DateOnly(Today.Year, Today.Month, 1)));
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton<IOcrService>(_ => new LocalOcrService(new OcrOptions { Enabled = true },
                new Lazy<IOcrEngine>(() => new DigitsEngine()), NullLogger<LocalOcrService>.Instance))));
        using var client = host.CreateClient();
        await using var loginScope = host.Services.CreateAsyncScope();
        var loginDb = loginScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var email = (await loginDb.Users.SingleAsync(user => user.Id == w.StaffId)).Email;
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = Password });
        login.EnsureSuccessStatusCode();
        var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
        using var image = new ByteArrayContent(Image()); image.Headers.ContentType = new("image/png");
        var response = await client.PostAsync($"/api/v1/ocr/meter-tasks/{task}", image);
        response.EnsureSuccessStatusCode();
        var proposal = (await response.Content.ReadFromJsonAsync<OcrProposal>())!;
        Assert.Equal("000123.45", proposal.ProposedFields["reading"]);
        Assert.Contains("reading_below_previous", proposal.Warnings);
        Assert.True(proposal.RequiresConfirmation);
        var lowerEvidence = await Evidence(w.Staff, task);
        var lowerConfirmation = await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{task}/confirm",
            new MeterConfirmation(true, 123.45m, lowerEvidence));
        Assert.Equal(HttpStatusCode.Conflict, lowerConfirmation.StatusCode);
        Assert.Contains("meter_reset_or_rollover_requires_review", await lowerConfirmation.Content.ReadAsStringAsync());
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.False(await db.Set<MeterReading>().AnyAsync(reading => reading.TaskId == task));
        var stored = await db.Set<OperationalTask>().SingleAsync(value => value.Id == task);
        Assert.Equal(123.45m, stored.OcrProposedValue);
        Assert.Equal(MeterTaskStatus.Assigned, stored.Status);
    }
    private async Task<(HttpClient Client, Guid UserId)> User(string role)
    {
        var name = Guid.NewGuid().ToString(); var id = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var u = new ApplicationUser { Id = id, UserName = name, Email = name + "@example.invalid", LockoutEnabled = true };
            u = await BHome.IntegrationTests.Compact24.WorkflowTestUsers.CreateAsync(scope.ServiceProvider, u, role, Password, reuseOwner: true);
            id = u.Id; name = u.Email!;
        }
        var client = fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = name, password = Password });
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
        var owner = await User(Roles.Owner); var staff = await User(Roles.Staff);
        var location = await Create(owner.Client, "locations", new LocationInput("Synthetic Location", "Synthetic Address"));
        var room = await Create(owner.Client, "rooms", new RoomInput(location, "TEST-01", 2));
        await Create(owner.Client, "assignments", new AssignmentInput(location, staff.UserId, Today.AddDays(-20), Today.AddDays(365)));
        var resident = await Create(staff.Client, "residents", new ResidentInput(room, "Hồ sơ kiểm thử", ResidentType.CoOccupant));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            Assert.Equal(owner.UserId, (await db.Set<Resident>().SingleAsync(r => r.Id == resident)).OwnerUserId);
            Assert.Equal(staff.UserId, (await db.SecurityAudit.SingleAsync(a => a.Event == "ResidentCreated" && a.TargetId == resident)).UserId);
        }
        var meter = await Create(owner.Client, "meters", new MeterInput(room, "SYNTHETIC-METER", UtilityType.Water, MeterDisplay.Digital, 2, Today.AddDays(-20)));
        return (owner.Client, staff.Client, owner.UserId, staff.UserId, location, room, resident, meter);
    }
    private static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
    private IdentityConfirmation Identity() => new(true, identityNumber, "NGƯỜI KIỂM THỬ", new(2000, 1, 1), "ĐỊA CHỈ GIẢ LẬP", null, null, null, null, null);
    [Fact]
    public async Task ParallelDuplicateIdentitiesHaveOneWinnerAndNoAutomaticMerge()
    {
        var w = await Workspace();
        var second = await Create(w.Staff, "residents", new ResidentInput(w.Room, "Hồ sơ độc lập", ResidentType.CoOccupant));
        var replies = await Task.WhenAll(new[] { w.Resident, second }.Select(id => w.Staff.PostAsJsonAsync($"/api/v1/capture/residents/{id}/confirm", Identity())));
        Assert.Single(replies, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(replies, r => r.StatusCode == HttpStatusCode.Conflict);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
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
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var saved = await db.Set<Resident>().SingleAsync(r => r.Id == w.Resident);
        Assert.Equal(IdentityVerificationStatus.Verified, saved.VerificationStatus);
        Assert.DoesNotContain(identityNumber, saved.IdentityData); Assert.DoesNotContain("2000-01-01", saved.IdentityData);
        Assert.DoesNotContain("ĐỊA CHỈ", saved.IdentityData); Assert.Equal(64, saved.IdentityHmac!.Length);
        Assert.Equal(1, await db.SecurityAudit.CountAsync(a => a.Event == "IdentityConfirmed" && a.TargetId == w.Resident));
        var listing = await w.Staff.GetStringAsync($"/api/v1/capture/locations/{w.Location}/residents");
        Assert.DoesNotContain("IdentityData", listing); Assert.DoesNotContain(identityNumber, listing);
    }
    [Fact]
    public async Task GlobalOwnerOtherStaffExpiredAssignmentAndTenantAuthorizationIsEnforced()
    {
        var w = await Workspace(); var otherOwner = await User(Roles.Owner); var otherStaff = await User(Roles.Staff); var tenant = await User(Roles.Tenant);
        var path = $"/api/v1/capture/residents/{w.Resident}/confirm";
        // Owner has chain-wide visibility, but identity confirmation remains a Staff operation.
        Assert.Equal(HttpStatusCode.Forbidden, (await otherOwner.Client.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherStaff.Client.PostAsJsonAsync(path, Identity())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.Client.GetAsync("/api/v1/capture/meter-tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await otherOwner.Client.GetAsync($"/api/v1/capture/locations/{w.Location}/residents")).StatusCode);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            await db.Set<StaffLocationAssignment>().Where(a => a.LocationId == w.Location && a.StaffUserId == w.StaffId)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.EndDate, Today.AddDays(-1)));
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
    public Task MeterEvidenceStoredPrivatelyConfirmationIsIdempotentAndOnlyConfirmedUsageIsReturned()
        => ConfirmMeterWorkflowAsync(verifyMinioObject: true);

    internal async Task ConfirmMeterWorkflowAsync(bool verifyMinioObject)
    {
        var w = await Workspace();
        var initial = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Initial, Today.AddDays(-10), null));
        var initialEvidence = await Evidence(w.Staff, initial);
        var response = await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{initial}/confirm", new MeterConfirmation(true, 100, initialEvidence));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var baseline = await response.Content.ReadFromJsonAsync<ConfirmedReading>(); Assert.Null(baseline!.Consumption);
        var period = new DateOnly(Today.Year, Today.Month, 1);
        var periodic = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Periodic, Today, period));
        var evidence = await Evidence(w.Staff, periodic);
        var data = new MeterConfirmation(true, 125.5m, evidence);
        var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{periodic}/confirm", data)));
        Assert.All(replies, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var reading = await replies[0].Content.ReadFromJsonAsync<ConfirmedReading>(); Assert.Equal(25.5m, reading!.Consumption);
        var saved = await w.Owner.GetFromJsonAsync<ConfirmedReading>($"/api/v1/capture/readings/{reading.Id}");
        Assert.Equal(reading, saved);
        var completed = await w.Staff.GetFromJsonAsync<MeterTaskSummary>($"/api/v1/capture/meter-tasks/{periodic}");
        Assert.Equal(100m, completed!.PreviousValue);
        Assert.Equal(reading.Id, completed.ConfirmedReadingId);
        var allTasks = await w.Owner.GetFromJsonAsync<MeterTaskSummary[]>("/api/v1/capture/meter-tasks");
        Assert.Null(Assert.Single(allTasks!, x => x.Id == initial).PreviousValue);
        Assert.Equal(100m, Assert.Single(allTasks!, x => x.Id == periodic).PreviousValue);
        var outsider = await User(Roles.Staff);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/v1/capture/readings/{reading.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/v1/capture/meter-tasks/{periodic}")).StatusCode);
        var tenant = await User(Roles.Tenant);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.Client.GetAsync($"/api/v1/capture/readings/{reading.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync($"/api/v1/capture/meter-tasks/{periodic}/confirm", data with { ConfirmedValue = 126 })).StatusCode);
        var file = await w.Staff.GetAsync($"/api/v1/capture/readings/{reading.Id}/evidence"); Assert.Equal(Image(), await file.Content.ReadAsByteArrayAsync());
        // Every Owner has chain-wide access, including private evidence through the authorized API.
        var otherOwner = await User(Roles.Owner); Assert.Equal(HttpStatusCode.OK, (await otherOwner.Client.GetAsync($"/api/v1/capture/readings/{reading.Id}/evidence")).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(1, await db.Set<MeterReading>().CountAsync(r => r.TaskId == periodic));
        Assert.Equal(MeterTaskStatus.Completed, (await db.Set<OperationalTask>().SingleAsync(a => a.Id == periodic)).Status);
        var stored = await db.Set<MeterEvidence>().SingleAsync(a => a.Id == evidence); Assert.True(stored.IsLinked); Assert.DoesNotContain("http", stored.ObjectKey);
        if (verifyMinioObject)
        {
            using var unauthenticated = new HttpClient();
            var privateObject = await unauthenticated.GetAsync(fixture.StorageUrl + "/capture-tests/" + stored.ObjectKey); Assert.Equal(HttpStatusCode.Forbidden, privateObject.StatusCode);
        }
    }
    [Fact]
    public async Task MissingBaselineWrongEvidenceAndUnconfirmedOrNegativeReadingCannotCompleteTask()
    {
        var w = await Workspace();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Periodic, Today, new(Today.Year, Today.Month, 1)));
        var evidence = await Evidence(w.Staff, task); var route = $"/api/v1/capture/meter-tasks/{task}/confirm";
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(false, 10, evidence))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, -1, evidence))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, 10, Guid.NewGuid()))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Staff.PostAsJsonAsync(route, new MeterConfirmation(true, 10, evidence))).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.False(await db.Set<MeterReading>().AnyAsync(r => r.TaskId == task));
        Assert.Equal(MeterTaskStatus.Assigned, (await db.Set<OperationalTask>().SingleAsync(a => a.Id == task)).Status);
    }
    [Fact]
    public async Task PartialStorageFailureLeavesDurableCleanupIntentAndCannotCreateConfirmedReading()
    {
        var w = await Workspace();
        var task = await Create(w.Owner, "meter-tasks", new MeterTaskInput(w.Meter, ReadingPurpose.Initial, Today, null));
        await using var services = fixture.Factory.Services.CreateAsyncScope();
        var db = services.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
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
    private PostgreSqlContainer? postgres;
    private readonly bool externallyManaged;
    public CaptureFixture() { }
    internal CaptureFixture(WebApplicationFactory<Program> supplied, string storageUrl)
    { Factory = supplied; StorageUrl = storageUrl; externallyManaged = true; }
    private readonly string storagePassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private IContainer? minio;
    private ApiFactory? root;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string StorageUrl { get; private set; } = "";
    public async Task InitializeAsync()
    {
        if (externallyManaged) return;
        postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
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
        await using var scope = Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>().Database.MigrateAsync();
    }
    public async Task DisposeAsync()
    {
        if (externallyManaged) return;
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
                finally { if (postgres is not null) await postgres.DisposeAsync(); }
            }
        }
    }
}
