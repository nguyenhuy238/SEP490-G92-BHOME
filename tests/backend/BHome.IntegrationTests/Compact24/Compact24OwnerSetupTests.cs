using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Application.Jobs;
using BHome.Application.Locations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed partial class Compact24OwnerSetupTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private const string Password = "Synthetic!Setup-9273";
    private sealed class Files : IObjectStorage
    {
        private readonly Dictionary<string, byte[]> data = [];
        public async Task PutAsync(string key, Stream stream, long length, string type, CancellationToken t)
        { using var bytes = new MemoryStream(); await stream.CopyToAsync(bytes, t); data[key] = bytes.ToArray(); }
        public Task CopyToAsync(string key, Stream destination, CancellationToken t) => destination.WriteAsync(data[key], t).AsTask();
        public Task DeleteAsync(string key, CancellationToken t) { data.Remove(key); return Task.CompletedTask; }
    }
    private sealed record Workspace(ApplicationUser Owner, ApplicationUser Staff, ApplicationUser Tenant, Guid Location, Guid Room);
    private static DateOnly Today => BHome.Application.Billing.BillingAutomationDates.BusinessDate(DateTimeOffset.UtcNow);
    private async Task<Workspace> Seed()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        async Task<ApplicationUser> Account(string role)
        {
            if (role == Roles.Owner && await db.Users.FirstOrDefaultAsync(u => EF.Property<string[]>(u, "roles").Contains(Roles.Owner)) is { } prior) return prior;
            return await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = Guid.NewGuid().ToString("N"),
                Email = Guid.NewGuid().ToString("N") + "@example.invalid",
                EmailConfirmed = true
            }, role, Password);
        }
        var owner = await Account(Roles.Owner); var staff = await Account(Roles.Staff); var tenant = await Account(Roles.Tenant);
        var location = new Location("Synthetic setup") { Address = "Synthetic address" }; db.Add(location);
        var room = new Room { LocationId = location.Id, RoomNumber = "S101", Capacity = 3, Status = RoomStatus.Available }; db.Add(room);
        db.Add(new StaffLocationAssignment(location.Id, staff.Id, owner.Id, Today.AddYears(-1), Today.AddYears(1)));
        await db.SaveChangesAsync(); return new(owner, staff, tenant, location.Id, room.Id);
    }
    private WebApplicationFactory<Program> Host() => fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureServices(s => s.AddSingleton<IObjectStorage>(new Files())));
    private async Task<HttpClient> Client(ApplicationUser account, WebApplicationFactory<Program>? host = null)
    {
        var client = (host ?? fixture.Factory!).CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = account.Email, password = Password }); response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new("Bearer", (await response.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken); return client;
    }
    private static async Task<T> Read<T>(HttpResponseMessage response)
    { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<T>())!; }
    private static UtilityTariffWrite Tariff(Guid location, DateOnly period) => new(location, UtilityType.Electricity, period, null,
        "Synthetic supplier", "Owner-selected synthetic category", "Synthetic configuration source", [new(50, 1000), new(100, 1500), new(null, 2000)], VndRounding.AwayFromZero, true);

    [CompactPostgresFact]
    public async Task PolicyHistoryContainsOnlyPersistedRevisionsAndStaffSeesOnlyPublishedRevisions()
    {
        var w = await Seed(); var outside = await Seed();
        using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        using var stranger = await Client(outside.Staff); using var tenant = await Client(w.Tenant);
        var a = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Synthetic history A", "First draft", Today)));
        var b = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Synthetic history B", "Unrelated draft", Today.AddDays(1))));
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/operating-policies/{a.Id}/draft", new OperatingPolicyWrite(w.Location, "Synthetic history A", "Reviewed draft", Today, a.Version)));
        Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/v1/operating-policies/{a.Id}/versions")).StatusCode);
        await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/operating-policies/{a.Id}/publish", new TemplatePublish(2)));
        var revisions = await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/operating-policies/{a.Id}/versions");
        Assert.NotNull(revisions);
        Assert.Equal(new[] { 1, 2, 3 }, revisions.Select(r => r.Version));
        Assert.All(revisions, r => { Assert.Equal(a.Id, r.Id); Assert.Equal(w.Owner.Id, r.RecordedBy); Assert.NotNull(r.RecordedAt); });
        Assert.DoesNotContain(revisions, r => r.Id == b.Id);
        Assert.Equal("First draft", revisions[0].Data.GetProperty("content").GetString());
        Assert.Equal("Reviewed draft", revisions[1].Data.GetProperty("content").GetString());
        var visible = Assert.Single((await staff.GetFromJsonAsync<SetupDocument[]>($"/api/v1/operating-policies/{a.Id}/versions"))!);
        Assert.Equal("Published", visible.Status); Assert.Equal(3, visible.Version);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/operating-policies/{a.Id}/versions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/operating-policies/{Guid.NewGuid()}/versions")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/operating-policies/{a.Id}/versions")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/operating-policies/{a.Id}/draft", new OperatingPolicyWrite(w.Location, "Changed", "Must remain immutable", Today, 3))).StatusCode);
    }

    [CompactPostgresFact]
    public async Task UtilityReadWorkspacesPreserveOwnerAndAssignedStaffPermissions()
    {
        var w = await Seed(); var outside = await Seed(); using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff); using var stranger = await Client(outside.Staff); using var tenant = await Client(w.Tenant);
        foreach (var resource in new[] { "utility-meter-links", "utility-reconciliations", "utility-period-breakdowns", "utility-source-readings" })
        {
            var path = $"/api/v1/{resource}?locationId={w.Location}";
            Assert.Empty((await owner.GetFromJsonAsync<SetupDocument[]>(path))!);
            Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
            Assert.Equal(resource == "utility-source-readings" ? HttpStatusCode.OK : HttpStatusCode.Forbidden, (await staff.GetAsync(path)).StatusCode);
            Assert.Equal(resource == "utility-source-readings" ? HttpStatusCode.NotFound : HttpStatusCode.Forbidden, (await stranger.GetAsync(path)).StatusCode);
        }
    }

    [CompactPostgresFact]
    public async Task UtilitySourceBillKeepsLargeAmountsExactAcrossApiPersistenceAndReload()
    {
        var w = await Seed(); using var host = Host(); using var owner = await Client(w.Owner, host);
        var period = new DateOnly(Today.Year, Today.Month, 1);
        var meter = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-meters", new UtilitySourceMeter(w.Location, UtilityType.Electricity, "Source", "SYN-EXACT", null)));
        string evidence;
        await using (var scope = host.Services.CreateAsyncScope()) evidence = await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().UploadEvidenceAsync(w.Location, [1, 2, 3], "image/png", w.Owner.Id, default);
        owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var saved = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-bills", new
        {
            locationId = w.Location, meterId = meter.Id, utilityType = 0, period, consumption = "123.0001",
            amount = "9007199254740993", reference = "SYN-EXACT", evidenceObjectKey = evidence
        }));
        Assert.Equal("9007199254740993", saved.Data.GetProperty("amount").GetString());
        Assert.Equal("123.0001", saved.Data.GetProperty("consumption").GetString());
        var loaded = await owner.GetFromJsonAsync<SetupDocument>($"/api/v1/utility-source-bills/{saved.Id}");
        Assert.Equal("9007199254740993", loaded!.Data.GetProperty("amount").GetString());
        var listed = await owner.GetFromJsonAsync<SetupDocument[]>($"/api/v1/utility-source-bills?locationId={w.Location}");
        Assert.Equal(saved.Id, Assert.Single(listed!).Id);
    }

    [CompactPostgresFact]
    public async Task ClosureShowsOpenWorkAndEmergencyReadinessAndDoesNotLeakToTenant()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenant);
        var check = await owner.GetFromJsonAsync<LocationClosureCheck>($"/api/v1/locations/{w.Location}/closure-check");
        Assert.Contains(check!.Blockers, b => b.Code == "operational_rooms");
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync($"/api/v1/locations/{w.Location}/closure-check")).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        db.Add(new IncidentReport
        {
            LocationId = w.Location,
            RoomId = w.Room,
            ReporterId = w.Staff.Id,
            ReporterRole = Roles.Staff,
            Description = "Synthetic emergency",
            Severity = IncidentSeverity.Emergency
        }); await db.SaveChangesAsync();
        var readiness = await owner.GetFromJsonAsync<RoomReadinessDto>($"/api/v1/rooms/{w.Room}/readiness?purpose=Holding");
        Assert.Contains(readiness!.Blockers, b => b.Code == "UNRESOLVED_EMERGENCY");
        Assert.Contains((await owner.GetFromJsonAsync<LocationClosureCheck>($"/api/v1/locations/{w.Location}/closure-check"))!.Blockers, b => b.Code == "open_incidents");
    }
    [CompactPostgresFact]
    public async Task TemplatePublishAndRetryCreateOnlyDesiredInventoryAndCannotRewritePublished()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff);
        var input = new AssetTemplateWrite(w.Location, "Synthetic standard equipment", [new(Guid.NewGuid(), "Lamp", "Electrical", "BulkQuantity", 4)]);
        var doc = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates", input));
        var run = await Read<AssetSyncRun>(await owner.PostAsJsonAsync($"/api/v1/asset-templates/{doc.Id}/publish", new TemplatePublish(doc.Version)));
        Assert.Contains(run.Rooms, r => r.RoomId == w.Room && r.Status == "Applied");
        await Read<AssetSyncRun>(await owner.PostAsync($"/api/v1/asset-templates/{doc.Id}/sync", null));
        var inventory = await staff.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory");
        Assert.Empty(inventory!.Physical); Assert.Single(inventory.Desired);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/asset-templates/{doc.Id}/draft", input with { ExpectedVersion = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/v1/asset-templates", input)).StatusCode);
    }
    [CompactPostgresFact]
    public async Task PhysicalVerificationRequiresScopedEvidenceAndReplayDoesNotDuplicateAssets()
    {
        var w = await Seed(); using var host = Host(); using var owner = await Client(w.Owner, host); using var staff = await Client(w.Staff, host);
        var item = new AssetTemplateItem(Guid.NewGuid(), "Synthetic lamp", "Electrical", "BulkQuantity", 4);
        var doc = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates", new AssetTemplateWrite(w.Location, "Synthetic equipment", [item])));
        await Read<AssetSyncRun>(await owner.PostAsJsonAsync($"/api/v1/asset-templates/{doc.Id}/publish", new TemplatePublish(1)));
        string key;
        await using (var scope = host.Services.CreateAsyncScope()) key = await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().UploadEvidenceAsync(w.Location, [1, 2, 3], "image/png", w.Staff.Id, default);
        var input = new AssetVerification(doc.Id, item.Id, "SYN-LAMP", 4, "Good", key, 1);
        var one = await Read<JsonElement>(await staff.PostAsJsonAsync($"/api/v1/rooms/{w.Room}/assets/verify", input));
        var two = await Read<JsonElement>(await staff.PostAsJsonAsync($"/api/v1/rooms/{w.Room}/assets/verify", input));
        Assert.Equal(one.GetProperty("assetId").GetGuid(), two.GetProperty("assetId").GetGuid());
        var inventory = await staff.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory");
        Assert.Single(inventory!.Physical); Assert.Equal("Verified", Assert.Single(inventory.Desired).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync($"/api/v1/rooms/{w.Room}/assets/verify", input with { Code = "OTHER", EvidenceObjectKey = "contracts/private.pdf" })).StatusCode);
        var nextTemplate = await Read<SetupDocument>(await owner.PostAsync($"/api/v1/asset-templates/{doc.Id}/drafts", null));
        await Read<AssetSyncRun>(await owner.PostAsJsonAsync($"/api/v1/asset-templates/{nextTemplate.Id}/publish", new TemplatePublish(nextTemplate.Version)));
        var attached = await Read<JsonElement>(await staff.PostAsJsonAsync($"/api/v1/rooms/{w.Room}/assets/verify", input with { TemplateId = nextTemplate.Id, ExistingAssetId = one.GetProperty("assetId").GetGuid() }));
        Assert.Equal(one.GetProperty("assetId").GetGuid(), attached.GetProperty("assetId").GetGuid());
        Assert.Single((await staff.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory"))!.Physical);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room}/asset-template", new AssetTemplateAssignment(doc.Id)));
        var pinned = await staff.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory");
        Assert.Equal(doc.Id, pinned!.Desired.Single(d => d.Id == pinned.CurrentDesiredId).Data.GetProperty("templateId").GetGuid());
        Assert.Equal(1, pinned.AssignmentVersion); Assert.Equal(doc.Id, pinned.AssignedTemplateId);
        await Read<SetupDocument>(await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room}/asset-template", new AssetTemplateAssignment(null, pinned.AssignmentVersion)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/rooms/{w.Room}/asset-template", new AssetTemplateAssignment(doc.Id, pinned.AssignmentVersion))).StatusCode);
    }
    [CompactPostgresFact]
    public async Task TariffComputesProgressiveChargeQuotaAndScopeIsOwnerOnly()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); var period = new DateOnly(Today.Year, Today.Month, 1);
        var tariff = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-tariffs", Tariff(w.Location, period)));
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-profiles", new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, tariff.Id, period, null, true, false)));
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var billing = scope.ServiceProvider.GetRequiredService<IUtilityBilling>();
        Assert.Contains("utility_quota_verification_required", (await billing.CalculateAsync(w.Room, UtilityType.Electricity, period, 120, default))!.MissingInputs);
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-quotas", new UtilityQuotaWrite(w.Location, w.Room, UtilityType.Electricity, period, 20, "Synthetic quota evidence", true)));
        var calculated = await billing.CalculateAsync(w.Room, UtilityType.Electricity, period, 120, default);
        Assert.Equal(125000, calculated!.Amount); Assert.Empty(calculated.MissingInputs);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/utility-tariffs?locationId={w.Location}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/utility-tariffs", Tariff(w.Location, period))).StatusCode);
    }
    [CompactPostgresFact]
    public async Task MissingSourceReadingsRemainPendingAndSupplierBillIsIdempotent()
    {
        var w = await Seed(); using var host = Host(); using var owner = await Client(w.Owner, host); var period = new DateOnly(Today.Year, Today.Month, 1);
        var meter = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-meters", new UtilitySourceMeter(w.Location, UtilityType.Electricity, "Source", "SYN-TOTAL", null)));
        string evidence; await using (var scope = host.Services.CreateAsyncScope()) evidence = await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().UploadEvidenceAsync(w.Location, [4, 5, 6], "image/png", w.Owner.Id, default);
        var input = new UtilitySourceBill(w.Location, meter.Id, UtilityType.Electricity, period, 1200, 1000000, "SYN-SUPPLIER", evidence);
        owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var bill = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-bills", input));
        Assert.Equal(bill.Id, (await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-bills", input))).Id);
        var preview = await Read<UtilityReconciliation>(await owner.PostAsJsonAsync("/api/v1/utility-reconciliations/preview", new UtilityReconcileInput(w.Location, bill.Id, 0, "Synthetic review")));
        Assert.Equal("MissingConfirmedInputs", preview.Status); Assert.Equal(1200, preview.Variance);
        await using (var readOnlyCheck = host.Services.CreateAsyncScope())
            Assert.Empty(await readOnlyCheck.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().ListAsync(w.Location, "UtilityReconciliation", default));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync("/api/v1/utility-source-bills", input with { Amount = 2000000 })).StatusCode);
        var pending = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-reconciliations", new UtilityReconcileInput(w.Location, bill.Id, 0, "Synthetic review")));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/v1/utility-reconciliations/{pending.Id}/review", new UtilityVarianceReview(true, "Missing inputs cannot be waived", pending.Version))).StatusCode);
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-source-readings", new UtilitySourceReading(meter.Id, period, 0, 1200, evidence, true)));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/v1/utility-reconciliations/{pending.Id}/review", new UtilityVarianceReview(true, "Changed source inputs require a new saved preview", pending.Version))).StatusCode);
        var ready = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-reconciliations", new UtilityReconcileInput(w.Location, bill.Id, 0, "Confirmed source", pending.Version)));
        Assert.Equal("NeedsReview", ready.Status);
        var reviewed = await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/utility-reconciliations/{ready.Id}/review", new UtilityVarianceReview(true, "Owner records unresolved variance without charging Tenant", ready.Version)));
        Assert.Equal("VarianceReviewed", reviewed.Status);
        Assert.Equal(1200, reviewed.Data.GetProperty("variance").GetDecimal());
    }
    [CompactPostgresFact]
    public async Task PolicyPublicationPreservesBoundVersionAndLegacyHasNoInventedAcceptance()
    {
        var w = await Seed(); using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenant);
        var v1 = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Synthetic rules V1", "Rule A", Today.AddDays(-20))));
        await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/operating-policies/{v1.Id}/publish", new TemplatePublish(1)));
        Guid contractId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id, DisplayLabel = "Synthetic occupant" }; db.Add(resident);
            var c = new Contract { RoomId = w.Room, OwnerSignerId = w.Owner.Id, TenantUserId = w.Tenant.Id, RepresentativeResidentId = resident.Id, StartDate = Today.AddDays(-10), EndDate = Today.AddYears(1), Terms = "Synthetic contract" };
            await scope.ServiceProvider.GetRequiredService<IOperatingPolicyWorkflow>().BindDraftAsync(c, default); db.Add(c); await db.SaveChangesAsync(); contractId = c.Id;
        }
        var v2 = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Synthetic rules V2", "Rule B", Today)));
        await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/operating-policies/{v2.Id}/publish", new TemplatePublish(1)));
        var agreed = await tenant.GetFromJsonAsync<AgreedOperatingPolicy>($"/api/v1/contracts/{contractId}/agreed-operating-policy");
        Assert.Equal(v1.Id, agreed!.Policy!.PolicyId); Assert.Equal("PendingSignatures", agreed.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"/api/v1/operating-policies/{v1.Id}/draft", new OperatingPolicyWrite(w.Location, "Changed", "Must not overwrite", Today, 2))).StatusCode);
        var outside = await Seed(); using var stranger = await Client(outside.Tenant);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/v1/contracts/{contractId}/agreed-operating-policy")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task CanonicalDepositReaderAndProjectionSeeLegacyAndBankAllocationsExactlyOnce()
    {
        var w = await Seed(); await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic depositor" }; db.Add(resident);
        var c = new Contract
        {
            RoomId = w.Room,
            OwnerSignerId = w.Owner.Id,
            TenantUserId = w.Tenant.Id,
            RepresentativeResidentId = resident.Id,
            Kind = ContractKind.Holding,
            StartDate = Today,
            EndDate = Today.AddYears(1),
            RequiredDeposit = 1000,
            Terms = "Synthetic deposit"
        }; db.Add(c); await db.SaveChangesAsync();
        db.Add(new DepositVerification { ContractId = c.Id, Amount = 100, BankTransactionReference = Guid.NewGuid().ToString("N"), VerificationReason = "Synthetic verification", VerifiedByUserId = w.Owner.Id, VerifiedAt = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        var payment = Guid.NewGuid(); var allocation = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,verification_method,verified_by_user_id,verified_at)
            VALUES({payment},'SYNTHETIC','synthetic',{payment.ToString()},{payment.ToString()},now(),200,'VND','VERIFIED','MANUAL',{w.Owner.Id},now())
            """);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
            VALUES({allocation},{payment},{c.Id},200,{payment},1,{w.Owner.Id},now(),'Synthetic allocation')
            """);
        Assert.Equal(300, await scope.ServiceProvider.GetRequiredService<IContractRepository>().DepositTotalAsync(c.Id, default));
        Assert.Equal(300, await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().Where(a => a.TargetDepositContractId == c.Id).SumAsync(a => a.Amount));
    }
    [CompactPostgresFact]
    public async Task SignedPolicyAmendmentAppliesWithoutCreatingOccupancyOrChangingOriginalTerms()
    {
        var w = await Seed();
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["ContractWorkflow:SimulatedSigningEnabled"] = "true", ["ContractPdf:TemplateId"] = "main-contract-development-v1" }));
            b.ConfigureServices(s => { s.AddSingleton<IObjectStorage>(new Files()); s.RemoveAll<IContractSigningProvider>(); s.AddScoped(typeof(IContractSigningProvider), typeof(BHome.Infrastructure.Contracts.ViettelMySignContractAdapter).Assembly.GetType("BHome.Infrastructure.Contracts.DevelopmentContractSigningAdapter", true)!); });
        });
        using var owner = await Client(w.Owner, host); using var tenant = await Client(w.Tenant, host); Guid parentId;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id, DisplayLabel = "Synthetic amendment signer" }; db.Add(resident);
            var parent = new Contract
            {
                RoomId = w.Room,
                OwnerSignerId = w.Owner.Id,
                TenantUserId = w.Tenant.Id,
                RepresentativeResidentId = resident.Id,
                StartDate = Today.AddDays(-10),
                EndDate = Today.AddYears(1),
                MonthlyRent = 1000000,
                Terms = "Original immutable synthetic terms",
                Status = ContractStatus.Active,
                Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = Today.AddDays(-10) }],
                ActivatedAt = DateTimeOffset.UtcNow,
                ActivatedByUserId = w.Owner.Id,
                IsDevelopmentDemo = true
            }; db.Add(parent); await db.SaveChangesAsync(); parentId = parent.Id;
        }
        var policy = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/operating-policies", new OperatingPolicyWrite(w.Location, "Synthetic amendment rules", "Synthetic changed obligation", Today)));
        await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/operating-policies/{policy.Id}/publish", new TemplatePublish(1)));
        owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var amendment = (await Read<JsonElement>(await owner.PostAsJsonAsync($"/api/v1/contracts/{parentId}/operating-policy-amendments", new PolicyAmendmentInput(policy.Id, Today, "Synthetic approved change")))).GetProperty("contractId").GetGuid();
        Assert.Equal("NotRecorded", (await tenant.GetFromJsonAsync<AgreedOperatingPolicy>($"/api/v1/contracts/{parentId}/agreed-operating-policy"))!.Status);
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync($"/api/v1/contracts/{amendment}/activate", null)).StatusCode);
        foreach (var client in new[] { owner, tenant })
        {
            client.DefaultRequestHeaders.Remove("Idempotency-Key"); client.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
            await Read<SignatureView>(await client.PostAsJsonAsync($"/api/v1/contracts/{amendment}/signing", new SigningInput(Guid.Empty)));
            await Read<ContractView>(await client.PostAsync($"/api/v1/contracts/{amendment}/signing/sync", null));
        }
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal("Applied", (await Read<ContractView>(await owner.PostAsync($"/api/v1/contracts/{amendment}/activate", null))).Status);
        Assert.Equal(policy.Id, (await tenant.GetFromJsonAsync<AgreedOperatingPolicy>($"/api/v1/contracts/{parentId}/agreed-operating-policy"))!.Policy!.PolicyId);
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync($"/api/v1/contracts/{amendment}/operating-policy-amendment-cancellation", new PolicyAmendmentCancellation("Applied evidence cannot be cancelled"))).StatusCode);
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var nextInput = new PolicyAmendmentInput(policy.Id, Today.AddDays(1), "Synthetic future amendment");
        var next = (await Read<JsonElement>(await owner.PostAsJsonAsync($"/api/v1/contracts/{parentId}/operating-policy-amendments", nextInput))).GetProperty("contractId").GetGuid();
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var cancellation = new PolicyAmendmentCancellation("Owner withdrew the proposed change");
        Assert.Equal("Cancelled", (await Read<ContractView>(await owner.PostAsJsonAsync($"/api/v1/contracts/{next}/operating-policy-amendment-cancellation", cancellation))).Status);
        Assert.Equal("Cancelled", (await Read<ContractView>(await owner.PostAsJsonAsync($"/api/v1/contracts/{next}/operating-policy-amendment-cancellation", cancellation))).Status);
        owner.DefaultRequestHeaders.Remove("Idempotency-Key"); owner.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString());
        var recreated = (await Read<JsonElement>(await owner.PostAsJsonAsync($"/api/v1/contracts/{parentId}/operating-policy-amendments", nextInput))).GetProperty("contractId").GetGuid();
        Assert.NotEqual(next, recreated);
        await using var check = host.Services.CreateAsyncScope(); var context = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal("Original immutable synthetic terms", await context.Set<Contract>().Where(c => c.Id == parentId).Select(c => c.Terms).SingleAsync());
        Assert.Equal(1, await context.Set<Contract>().CountAsync(c => c.RoomId == w.Room && c.Status == ContractStatus.Active));
    }
    [CompactPostgresFact]
    public async Task MidPeriodTariffRequiresEvidenceAndConfirmedConsumptionBeforeBilling()
    {
        var w = await Seed(); using var host = Host(); using var owner = await Client(w.Owner, host); var period = new DateOnly(Today.Year, Today.Month, 1); var middle = period.AddDays(15); var end = period.AddMonths(1).AddDays(-1);
        var oldTariff = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-tariffs", Tariff(w.Location, period) with { EffectiveTo = middle.AddDays(-1), Tiers = [new(null, 1000)] }));
        var newTariff = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-tariffs", Tariff(w.Location, middle) with { Tiers = [new(null, 2000)] }));
        var oldProfile = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-profiles", new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, oldTariff.Id, period, null, false, false)));
        await Read<SetupDocument>(await owner.PostAsJsonAsync($"/api/v1/utility-profiles/{oldProfile.Id}/replacement", new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, newTariff.Id, middle, null, false, false, oldProfile.Version)));
        await using var scope = host.Services.CreateAsyncScope(); var billing = scope.ServiceProvider.GetRequiredService<IUtilityBilling>();
        Assert.Contains("utility_period_split_requires_review", (await billing.CalculateAsync(w.Room, UtilityType.Electricity, period, 100, default))!.MissingInputs);
        var evidence = await scope.ServiceProvider.GetRequiredService<ISetupWorkspaceStore>().UploadEvidenceAsync(w.Location, [7, 8, 9], "image/png", w.Owner.Id, default);
        await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/utility-period-breakdowns", new UtilityPeriodBreakdown(w.Location, w.Room, UtilityType.Electricity, period,
            [new(period, middle.AddDays(-1), oldTariff.Id, 40, 0, evidence), new(middle, end, newTariff.Id, 60, 0, evidence)], true)));
        var result = await billing.CalculateAsync(w.Room, UtilityType.Electricity, period, 100, default); Assert.Equal(160000, result!.Amount); Assert.Empty(result.MissingInputs);
        Assert.Contains("utility_period_consumption_mismatch", (await billing.CalculateAsync(w.Room, UtilityType.Electricity, period, 101, default))!.MissingInputs);
    }
    [CompactPostgresFact]
    public async Task ReplacingStaffMovesMeterAndWorkOrderAndFailedRemovalRollsBackResponsibility()
    {
        var w = await Seed(); await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var next = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true }, Roles.Staff, Password);
        var meter = new Meter { RoomId = w.Room, Code = "SYN-METER", UtilityType = UtilityType.Electricity, InstalledOn = Today }; db.Add(meter);
        var task = new OperationalTask { LocationId = w.Location, MeterId = meter.Id, AssignedStaffUserId = w.Staff.Id, Purpose = ReadingPurpose.Initial, ReadingDate = Today }; db.Add(task);
        var incident = new IncidentReport { LocationId = w.Location, RoomId = w.Room, ReporterId = w.Staff.Id, ReporterRole = Roles.Staff, Description = "Synthetic repair" }; db.Add(incident);
        var order = new MaintenanceWorkOrder { LocationId = w.Location, RoomId = w.Room, IncidentId = incident.Id, AssignedStaffId = w.Staff.Id, ExpectedOutcome = "Synthetic repair", TargetCompletionAt = DateTimeOffset.UtcNow.AddDays(1) }; db.Add(order); await db.SaveChangesAsync();
        var assignments = scope.ServiceProvider.GetRequiredService<ILocationAssignments>(); var version = await db.Locations.Where(l => l.Id == w.Location).Select(l => l.Version).SingleAsync();
        Assert.Equal("staff_specialist_work_unresolved", (await Assert.ThrowsAsync<PropertyException>(() => assignments.RemoveAssignmentAsync(w.Owner.Id, w.Location, Today, version, "Synthetic removal", default))).Code);
        Assert.Single(await assignments.ListAssignedLocationsAsync(w.Staff.Id, Today, default)); db.ChangeTracker.Clear();
        Assert.Equal(ChangeAssignmentStatus.Changed, (await assignments.ReplaceAssignmentAsync(w.Owner.Id, w.Location, next.Id, Today, version, "Synthetic replacement", default)).Status);
        db.ChangeTracker.Clear(); Assert.Equal(next.Id, (await db.Set<OperationalTask>().SingleAsync(x => x.Id == task.Id)).AssignedStaffUserId);
        Assert.Equal(next.Id, (await db.Set<MaintenanceWorkOrder>().SingleAsync(x => x.Id == order.Id)).AssignedStaffId);
        Assert.True(await db.Set<BHome.Domain.StaffOperations.OperationalTaskHistory>().AnyAsync(h => h.TaskId == task.Id && h.Action == "responsibility_changed"));
    }
    [CompactPostgresFact]
    public async Task AssetWorkerSyncsAfterRoomReturnsAvailableWithoutCreatingPhysicalAssets()
    {
        var w = await Seed(); using var owner = await Client(w.Owner);
        await using (var s = fixture.Factory!.Services.CreateAsyncScope())
        { var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); var room = await db.Set<Room>().SingleAsync(r => r.Id == w.Room); room.Status = RoomStatus.Occupied; await db.SaveChangesAsync(); }
        var template = await Read<SetupDocument>(await owner.PostAsJsonAsync("/api/v1/asset-templates", new AssetTemplateWrite(w.Location, "Synthetic returning room", [new(Guid.NewGuid(), "Chair", "Furniture", "Serialized", 1)])));
        var run = await Read<AssetSyncRun>(await owner.PostAsJsonAsync($"/api/v1/asset-templates/{template.Id}/publish", new TemplatePublish(1))); Assert.Equal("SkippedNotEligible", Assert.Single(run.Rooms).Status);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var context = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var vacant = await context.Set<Room>().SingleAsync(r => r.Id == w.Room); vacant.Status = RoomStatus.Available; await context.SaveChangesAsync();
        var worker = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(j => j.Name == "asset-template-sync"); await worker.ExecuteAsync(new(Guid.NewGuid(), "synthetic-sync", "{}"), default); await worker.ExecuteAsync(new(Guid.NewGuid(), "synthetic-retry", "{}"), default);
        var inventory = await owner.GetFromJsonAsync<AssetInventory>($"/api/v1/rooms/{w.Room}/asset-inventory"); Assert.Single(inventory!.Desired); Assert.Empty(inventory.Physical);
    }
    [CompactPostgresFact]
    public async Task ClosedContractHistoryDoesNotPreventClosureAndResidentRecordsArePreserved()
    {
        var w = await Seed(); Guid residentId;
        await using (var s = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = s.ServiceProvider.GetRequiredService<Compact24DbContext>(); var resident = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, DisplayLabel = "Synthetic former occupant" }; db.Add(resident); residentId = resident.Id;
            db.Add(new Contract
            {
                RoomId = w.Room,
                OwnerSignerId = w.Owner.Id,
                TenantUserId = w.Tenant.Id,
                RepresentativeResidentId = resident.Id,
                StartDate = Today.AddYears(-1),
                EndDate = Today.AddDays(-1),
                Status = ContractStatus.Terminated,
                Terms = "Synthetic closed contract",
                Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = Today.AddYears(-1), ResidenceTo = Today.AddDays(-1) }]
            });
            (await db.Set<Room>().SingleAsync(r => r.Id == w.Room)).Status = RoomStatus.Unavailable; await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner); var closure = await owner.GetFromJsonAsync<LocationClosureCheck>($"/api/v1/locations/{w.Location}/closure-check"); Assert.True(closure!.CanClose);
        var location = await owner.GetFromJsonAsync<LocationDto>($"/api/v1/locations/{w.Location}"); await Read<LocationDto>(await owner.PutAsJsonAsync($"/api/v1/locations/{w.Location}", new LocationWrite(location!.Name, location.Address, false, location.Version, "Synthetic closure")));
        await using var check = fixture.Factory!.Services.CreateAsyncScope(); Assert.True(await check.ServiceProvider.GetRequiredService<Compact24DbContext>().Set<Resident>().AnyAsync(r => r.Id == residentId));
    }
    [CompactPostgresFact]
    public async Task HoldingNeedsBothSignaturesAndFullDepositAndProtectsTheWholeRoomBeforeDispatch()
    {
        var w = await Seed(); using var host = Host().WithWebHostBuilder(b => b.ConfigureServices(s => { s.RemoveAll<IContractSigningProvider>(); s.AddSingleton<IContractSigningProvider, BHome.IntegrationTests.Contracts.TestOnlySigningProvider>(); }));
        using var owner = await Client(w.Owner, host); using var tenant = await Client(w.Tenant, host); Guid resident;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>(); var person = new Resident { RoomId = w.Room, OwnerUserId = w.Owner.Id, TenantUserId = w.Tenant.Id, DisplayLabel = "Synthetic Holding Tenant", VerificationStatus = IdentityVerificationStatus.Verified }; db.Add(person); resident = person.Id;
            db.Add(new BillingPolicy { LocationId = w.Location, Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent", Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 3000000, EffectiveFrom = Today }); await db.SaveChangesAsync();
        }
        async Task<HttpResponseMessage> Post(HttpClient client, string path, object? input = null)
        { client.DefaultRequestHeaders.Remove("Idempotency-Key"); client.DefaultRequestHeaders.Add("Idempotency-Key", Guid.NewGuid().ToString()); return input is null ? await client.PostAsync(path, null) : await client.PostAsJsonAsync(path, input); }
        var input = new HoldingDraftInput(w.Room, w.Owner.Id, w.Tenant.Id, resident, [resident], Today, Today.AddYears(1), DateTimeOffset.UtcNow.AddDays(1), 2000000, "Synthetic Holding terms");
        var a = (await Read<ContractId>(await Post(owner, "/api/v1/contracts/holdings", input))).Id;
        var b = (await Read<ContractId>(await Post(owner, "/api/v1/contracts/holdings", input))).Id;
        foreach (var id in new[] { a, b }) await Read<ContractView>(await Post(owner, $"/api/v1/contracts/{id}/holding-approval", new HoldingDecisionInput("Synthetic Owner approval")));
        await Read<SignatureView>(await Post(owner, $"/api/v1/contracts/{a}/signing", new SigningInput(Guid.NewGuid())));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/contracts/{b}/signing", new SigningInput(Guid.NewGuid()))).StatusCode);
        await Read<ContractId>(await Post(owner, $"/api/v1/contracts/{a}/deposit-verifications", new DepositInput("SYN-PART-" + a, 1000000, "Synthetic bank confirmation")));
        await Read<ContractView>(await Post(owner, $"/api/v1/contracts/{a}/signing/sync"));
        await Read<SignatureView>(await Post(tenant, $"/api/v1/contracts/{a}/signing", new SigningInput(Guid.NewGuid())));
        await Read<ContractView>(await Post(tenant, $"/api/v1/contracts/{a}/signing/sync"));
        Assert.Null((await owner.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{a}"))!.PriceLockedAt);
        Assert.Equal(RoomStatus.Available, (await owner.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, $"/api/v1/contracts/{a}/holding-activation")).StatusCode);
        await Read<ContractId>(await Post(owner, $"/api/v1/contracts/{a}/deposit-verifications", new DepositInput("SYN-REST-" + a, 1000000, "Synthetic bank confirmation")));
        Assert.Equal("SigningAndDepositCompleted", (await owner.GetFromJsonAsync<ContractView>($"/api/v1/contracts/{a}"))!.PriceLockTrigger);
        await Read<ContractView>(await Post(owner, $"/api/v1/contracts/{a}/holding-activation"));
        Assert.Equal(RoomStatus.OnHold, (await owner.GetFromJsonAsync<RoomDto>($"/api/v1/rooms/{w.Room}"))!.Status);
        using var future = host.WithWebHostBuilder(builder => builder.ConfigureServices(s => s.AddSingleton<TimeProvider>(new Clock(DateTimeOffset.UtcNow.AddDays(2)))));
        await using (var scope = future.Services.CreateAsyncScope()) await scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Single(j => j.Name == "contract-expiry").ExecuteAsync(new(Guid.NewGuid(), "synthetic-expiry", "{}"), default);
        Assert.Equal("Expired", (await Read<ContractView>(await Post(owner, $"/api/v1/contracts/{a}/signing/sync"))).Status);
        Assert.Equal(2000000, (await owner.GetFromJsonAsync<HoldingDepositStatus>($"/api/v1/contracts/{a}/holding-deposit"))!.Verified);
    }
}
