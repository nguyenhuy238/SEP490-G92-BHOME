using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class SePayIntegrationTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task OwnerReceivingAccountIsVersionedSharedAcrossLocationsAndIsolatedFromOtherOwners()
    {
        await using var scenario = await Create();
        using var owner = await scenario.Client(scenario.Owner);
        var route = "/api/v1/receiving-bank-accounts/owner";
        Assert.Null(await owner.GetFromJsonAsync<ReceivingBankAccount>(route));
        var input = new OwnerReceivingAccountInput("970416", Account, "SYNTHETIC OWNER", true, true, true, 0);
        using var saved = await owner.PutAsJsonAsync(route, input);
        Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());
        Assert.Equal(1, (await owner.GetFromJsonAsync<ReceivingBankAccount>(route))!.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, input)).StatusCode);

        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var otherLocation = new Location("SYNTHETIC SECOND LOCATION") { Address = "SYNTHETIC" };
        var secondRoom = new Room { LocationId = otherLocation.Id, RoomNumber = "A01", Status = RoomStatus.Available };
        var secondResident = new Resident
        {
            RoomId = secondRoom.Id,
            OwnerUserId = scenario.Owner,
            TenantUserId = scenario.Tenants[0],
            DisplayLabel = "SYNTHETIC SECOND",
            VerificationStatus = IdentityVerificationStatus.Verified
        };
        var secondContract = new Contract
        {
            RoomId = secondRoom.Id,
            OwnerSignerId = scenario.Owner,
            RepresentativeResidentId = secondResident.Id,
            TenantUserId = scenario.Tenants[0],
            Kind = ContractKind.Holding,
            StartDate = new DateOnly(2026, 11, 1),
            EndDate = new DateOnly(2027, 11, 1),
            Terms = "SYNTHETIC",
            MonthlyRent = 100000,
            Residents = [new ContractResident { ResidentId = secondResident.Id, Role = ResidentType.Representative, ResidenceFrom = new DateOnly(2026, 11, 1) }]
        };
        db.AddRange(otherLocation, secondRoom, secondResident, secondContract);
        await db.SaveChangesAsync();
        var payments = scope.ServiceProvider.GetRequiredService<IPaymentRepository>();
        var first = await payments.ReceivingAccountAsync(scenario.Location, default);
        var second = await payments.ReceivingAccountAsync(otherLocation.Id, default);
        Assert.NotNull(first); Assert.NotNull(second);
        Assert.Equal(scenario.Owner, first.OwnerUserId); Assert.Equal(scenario.Owner, second.OwnerUserId);
        Assert.Equal(first.AccountNumber, second.AccountNumber);
        // The historical Location-scoped version remains unchanged and reviewable.
        Assert.Equal(1, (await db.Set<ReceivingBankAccount>().Where(a => a.LocationId == scenario.Location).SingleAsync()).Version);
        var options = scope.ServiceProvider.GetRequiredService<SePayOptions>();
        options.ReceivingAccounts.Add(new SePayReceivingAccount
        {
            OwnerUserId = scenario.Owner,
            BankIdentifier = first.BankIdentifier,
            AccountNumber = first.AccountNumber,
            Gateway = "ACB"
        });
        Assert.True(options.Matches(scenario.Location, first));
        Assert.True(options.Matches(otherLocation.Id, second));

        // Compact24's identity fixture deliberately reuses its sole Owner.
        // Owner configuration lookup is by the exact identity, not a globally
        // selected account; an unknown/different owner receives no bank data.
        Assert.Null(await payments.OwnerReceivingAccountAsync(Guid.NewGuid(), default));
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
    }
    private sealed class InitialDiagnostic : Microsoft.AspNetCore.Diagnostics.IExceptionHandler
    {
        internal static string Last = "";
        public ValueTask<bool> TryHandleAsync(Microsoft.AspNetCore.Http.HttpContext context, Exception e, CancellationToken t)
        { Last = e.GetBaseException().Message; return ValueTask.FromResult(false); }
    }
    [CompactPostgresTheory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task MainInitialQrUsesOneReceiptForDepositAndRentFeesAndRejectsPartialOrDuplicateEffects(bool simulatedSigning)
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7));
        var room = new Room { LocationId = scenario.Location, RoomNumber = "INITIAL-QR", Capacity = 2, Status = RoomStatus.Available };
        var person = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, TenantUserId = scenario.Tenants[0], DisplayLabel = "SYNTHETIC INITIAL", ContactEmail = $"initial-{Guid.NewGuid():N}@example.invalid", VerificationStatus = IdentityVerificationStatus.Verified };
        var c = new Contract { RoomId = room.Id, OwnerSignerId = scenario.Owner, TenantUserId = scenario.Tenants[0], RepresentativeResidentId = person.Id, StartDate = today, EndDate = today.AddMonths(6), MonthlyRent = 3000000, RequiredDeposit = 100000, Terms = "SYNTHETIC INITIAL PAYMENT", SigningMode = ContractSigningModes.Internal, Status = ContractStatus.PendingSigning, InitialPaymentRequired = true, IsDevelopmentDemo = simulatedSigning, Residents = [new ContractResident { ResidentId = person.Id, Role = ResidentType.Representative, ResidenceFrom = today }] };
        c.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(c.Id, c.RoomId, c.OwnerSignerId, Guid.Empty, c.RepresentativeResidentId, [person.Id], c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit, null, 0, c.Terms, "") { IsInternalResidentAcceptance = true });
        db.AddRange(room, person, c, new BillingPolicy { LocationId = scenario.Location, ChargeCode = "INTERNET", Name = "Synthetic Internet", Category = ChargeCategory.ServiceFee, Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 50000, EffectiveFrom = today }); await db.SaveChangesAsync();
        using var owner = await scenario.Client(scenario.Owner); var root = $"/api/v1/contracts/{c.Id}/initial-payment";
        using var anonymous = scenario.Anonymous();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(root)).StatusCode);
        using var unrelatedTenant = await scenario.Client(scenario.Tenants[1]);
        Assert.Equal(HttpStatusCode.NotFound, (await unrelatedTenant.GetAsync(root)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await unrelatedTenant.PostAsync(root + "/transfer-instructions", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync(root + "/transfer-instructions", null)).StatusCode);
        var source = new InternalAcceptanceEvidence(Guid.NewGuid(), person.Id, c.SnapshotHash, "synthetic-source", "synthetic-stroke", "synthetic-tenant.pdf", "synthetic-tenant-hash", DateTimeOffset.UtcNow, scenario.Owner, DateTimeOffset.UtcNow, "synthetic-final.pdf", "synthetic-final-hash");
        c.InternalAcceptance = JsonSerializer.Serialize(source); c.Status = ContractStatus.PendingActivation; await db.SaveChangesAsync();
        if (!simulatedSigning)
        {
            // Explicit Live obligations must remain unavailable to Test transfers.
            c.PaymentMode = "Live"; await db.SaveChangesAsync();
            var blocked = await owner.PostAsync(root + "/transfer-instructions", null);
            blocked.EnsureSuccessStatusCode();
            var unavailable = (await blocked.Content.ReadFromJsonAsync<MainInitialPaymentView>())!;
            Assert.Equal("ReceivingAccountUnavailable", unavailable.Availability); Assert.Null(unavailable.QrImageDataUri);
            db.ChangeTracker.Clear();
            c = await db.Set<Contract>().SingleAsync(x => x.Id == c.Id);
            Assert.Equal("Live", c.PaymentMode);
            c.PaymentMode = null; await db.SaveChangesAsync();
            var before = (await owner.GetFromJsonAsync<MainInitialPaymentView>(root))!;
            Assert.Equal("PaymentCodeUnavailable", before.Availability); Assert.True(before.IsDevelopmentDemo);
        }
        var response = await owner.PostAsync(root + "/transfer-instructions", null);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); var quote = (await response.Content.ReadFromJsonAsync<MainInitialPaymentView>())!;
        Assert.Equal(3150000, quote.OutstandingAmount); Assert.False(quote.Paid); Assert.StartsWith("data:image/png;base64,", quote.QrImageDataUri); Assert.Matches("^BH[0-9]{8}$", quote.TransferReference!);
        if (!simulatedSigning)
        {
            db.ChangeTracker.Clear(); c = await db.Set<Contract>().SingleAsync(x => x.Id == c.Id);
            Assert.Equal("Test", c.PaymentMode); Assert.False(c.IsDevelopmentDemo);
            Assert.Equal(ContractStatus.PendingActivation, c.Status);
        }
        var again = (await (await owner.PostAsync(root + "/transfer-instructions", null)).Content.ReadFromJsonAsync<MainInitialPaymentView>())!; Assert.Equal(quote.TransferReference, again.TransferReference);
        var secondResident = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, TenantUserId = scenario.Tenants[1], DisplayLabel = "SYNTHETIC SECOND", ContactEmail = $"second-{Guid.NewGuid():N}@example.invalid", VerificationStatus = IdentityVerificationStatus.Verified };
        var second = new Contract
        {
            RoomId = room.Id,
            OwnerSignerId = scenario.Owner,
            TenantUserId = scenario.Tenants[1],
            RepresentativeResidentId = secondResident.Id,
            StartDate = today,
            EndDate = c.EndDate,
            MonthlyRent = c.MonthlyRent,
            RequiredDeposit = c.RequiredDeposit,
            Terms = c.Terms,
            SigningMode = c.SigningMode,
            Status = ContractStatus.PendingActivation,
            InitialPaymentRequired = true,
            Residents = [new ContractResident { ResidentId = secondResident.Id, Role = ResidentType.Representative, ResidenceFrom = today }]
        };
        second.SnapshotHash = ContractDocumentSnapshot.Hash(new ContractDocument(second.Id, second.RoomId, second.OwnerSignerId,
            Guid.Empty, second.RepresentativeResidentId, [secondResident.Id], second.StartDate, second.EndDate, second.MonthlyRent,
            second.RequiredDeposit, null, 0, second.Terms, "")
        { IsInternalResidentAcceptance = true });
        second.InternalAcceptance = JsonSerializer.Serialize(source with { ResidentId = secondResident.Id, SnapshotHash = second.SnapshotHash });
        db.AddRange(secondResident, second);
        await db.SaveChangesAsync();
        var legacyQuote = JsonSerializer.Serialize(new MainInitialOrder(second.Id, scenario.Location, second.SnapshotHash,
            second.RequiredDeposit, second.MonthlyRent, [], DateTimeOffset.UtcNow), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
            VALUES({Guid.NewGuid()},'COMMAND',{scenario.Location},{"main-initial:" + second.Id},'Issued',
                jsonb_build_object('recordType','MainInitialPaymentV1','state',CAST({legacyQuote} AS jsonb)-'roomScopeResolved'))
            """);
        var previousRoomQuote = JsonSerializer.Serialize(new MainInitialOrder(second.Id, scenario.Location, second.SnapshotHash,
            second.RequiredDeposit, second.MonthlyRent, [], DateTimeOffset.UtcNow, RoomScopeResolved: true), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
            VALUES({Guid.NewGuid()},'COMMAND',{scenario.Location},{"main-initial-room:" + second.Id},'Issued',
                jsonb_build_object('recordType','MainInitialPaymentV1','state',CAST({previousRoomQuote} AS jsonb)))
            """);
        var staleCode = await scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>()
            .IssueAsync("MainInitial", second.Id, scenario.Location, default);
        Assert.NotNull(staleCode);
        (await scenario.Send(3150000, code: staleCode)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.TargetInitialContractId == second.Id || a.TargetDepositContractId == second.Id).ToArrayAsync());
        var secondRoot = $"/api/v1/contracts/{second.Id}/initial-payment";
        var secondResponses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => unrelatedTenant.PostAsync(secondRoot + "/transfer-instructions", null)));
        foreach (var item in secondResponses) Assert.True(item.IsSuccessStatusCode, await item.Content.ReadAsStringAsync());
        var secondQuote = (await secondResponses[0].Content.ReadFromJsonAsync<MainInitialPaymentView>())!;
        var concurrentQuote = (await secondResponses[1].Content.ReadFromJsonAsync<MainInitialPaymentView>())!;
        Assert.Equal(quote.TransferReference, secondQuote.TransferReference);
        Assert.Equal(quote.TransferReference, concurrentQuote.TransferReference);
        Assert.Equal(quote.OutstandingAmount, secondQuote.OutstandingAmount);
        (await scenario.Send(100, code: quote.TransferReference)).EnsureSuccessStatusCode();
        (await scenario.Send(3150001, code: quote.TransferReference)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.TargetInitialContractId == c.Id || a.TargetDepositContractId == c.Id).ToArrayAsync());
        Assert.False(await scope.ServiceProvider.GetRequiredService<IMainInitialPaymentLedger>().SatisfiedAsync(c.Id, default));
        var eventId = Guid.NewGuid().ToString(); var reference = "INITIAL-" + Guid.NewGuid().ToString("N");
        var full = await scenario.Send(3150000, reference, secondQuote.TransferReference, eventId: eventId); Assert.True(full.IsSuccessStatusCode, (await full.Content.ReadAsStringAsync()));
        (await scenario.Send(3150000, reference, quote.TransferReference, eventId: eventId)).EnsureSuccessStatusCode();
        db.ChangeTracker.Clear(); var allocations = await db.Set<PaymentAllocation>().Where(a => a.TargetInitialContractId == c.Id || a.TargetDepositContractId == c.Id).ToArrayAsync();
        Assert.Equal(2, allocations.Length); Assert.Single(allocations.Select(a => a.TransferId).Distinct()); Assert.Equal(100000, allocations.Single(a => a.TargetDepositContractId == c.Id).Amount); Assert.Equal(3050000, allocations.Single(a => a.TargetInitialContractId == c.Id).Amount);
        Assert.Equal(ContractStatus.PendingActivation, (await db.Set<Contract>().SingleAsync(x => x.Id == c.Id)).Status);
        var settled = await owner.GetFromJsonAsync<MainInitialPaymentView>(root); Assert.True(settled!.Paid); Assert.Equal(0, settled.OutstandingAmount);
        Assert.True(await scope.ServiceProvider.GetRequiredService<IMainInitialPaymentLedger>().SatisfiedAsync(c.Id, default));
        var secondSettled = await unrelatedTenant.GetFromJsonAsync<MainInitialPaymentView>(secondRoot);
        Assert.True(secondSettled!.Paid);
        Assert.Equal(0, secondSettled.OutstandingAmount);
        Assert.Null(secondSettled.TransferReference);
        Assert.Equal(legacyQuote, JsonSerializer.Serialize(
            JsonSerializer.Deserialize<MainInitialOrder>(await db.Database.SqlQuery<string>($"""
                SELECT (task_data->'state')::text AS "Value" FROM operational_tasks WHERE source_key={"main-initial:" + second.Id}
                """).SingleAsync(), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.True(await scope.ServiceProvider.GetRequiredService<IMainInitialPaymentLedger>().SatisfiedAsync(second.Id, default));
        var settlement = (IContractSettlementDetails)scope.ServiceProvider.GetRequiredService<IContractSettlementLedger>();
        var first = await db.Set<Contract>().SingleAsync(contract => contract.Id == c.Id);
        var last = await db.Set<Contract>().SingleAsync(contract => contract.Id == second.Id);
        first.Status = ContractStatus.Terminated;
        first.ActualEndDate = today;
        last.Status = ContractStatus.Active;
        last.ActivatedAt = DateTimeOffset.UtcNow;
        last.ActivatedByUserId = scenario.Owner;
        db.Add(new ContractMoveOutHistory { ContractId = first.Id, Action = "Completed", Version = 1, ActorId = scenario.Owner, OccurredAt = DateTimeOffset.UtcNow.AddMinutes(-1) });
        await db.SaveChangesAsync();
        Assert.Equal(0, (await settlement.SummaryAsync(first.Id, default)).VerifiedSecurityDeposit);
        var finalSettlement = await settlement.SummaryAsync(last.Id, default);
        Assert.Equal(first.Id, finalSettlement.DepositContractId);
        Assert.Equal(100000, finalSettlement.VerifiedSecurityDeposit);
        var refundSource = await scope.ServiceProvider.GetRequiredService<BHome.Application.Finance.IRefundRepository>().DepositSourceAsync(last.Id, default);
        Assert.Equal(secondResident.Id, Assert.Single(refundSource.Beneficiaries).Id);
    }
    private const string Secret = "synthetic-sepay-integration-secret-at-least-32-bytes";
    [CompactPostgresFact]
    public async Task SandboxQrPreviewSkipsSigningWithoutManufacturingApprovalOrActivation()
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7));
        var room = new Room { LocationId = scenario.Location, RoomNumber = "PREVIEW-ONLY", Capacity = 1, Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, DisplayLabel = "Synthetic preview", VerificationStatus = IdentityVerificationStatus.Verified };
        var c = new Contract { Kind = ContractKind.Holding, RoomId = room.Id, OwnerSignerId = scenario.Owner, RepresentativeResidentId = resident.Id, StartDate = today, EndDate = today.AddMonths(1), HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(2), RequiredDeposit = 100000, MonthlyRent = 100000, IsDevelopmentDemo = true, Status = ContractStatus.Draft, SigningMode = ContractSigningModes.Internal, SnapshotHash = new string('A', 64) };
        db.AddRange(room, resident, c); await db.SaveChangesAsync();
        using var owner = await scenario.Client(scenario.Owner);
        var root = $"/api/v1/integrations/sepay/testing/holdings/{c.Id}";
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(root + "/simulation/skip-signing-preview", new { previewOnly = false })).StatusCode);
        var skipped = await owner.PostAsJsonAsync(root + "/simulation/skip-signing-preview", new { previewOnly = true });
        skipped.EnsureSuccessStatusCode();
        Assert.True((await skipped.Content.ReadFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>())!.CanShowQr);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync(root + "/simulation/activate", null)).StatusCode);
        db.ChangeTracker.Clear(); var saved = await db.Set<Contract>().SingleAsync(x => x.Id == c.Id);
        Assert.Equal(ContractStatus.Draft, saved.Status); Assert.Null(saved.ApprovedAt); Assert.Null(saved.ActivatedAt);
        Assert.Equal("{}", saved.InternalAcceptance); Assert.Empty(await db.Set<ContractSignature>().Where(s => s.ContractId == c.Id).ToArrayAsync());
    }
    private const string Account = "0000001234";
    private sealed class Scenario : IAsyncDisposable
    {
        internal required WebApplicationFactory<Program> Host { get; init; }
        internal required Guid Invoice { get; init; }
        internal required Guid Contract { get; init; }
        internal required Guid Location { get; init; }
        internal required Guid Owner { get; init; }
        internal required Guid[] Tenants { get; init; }
        internal required string Code { get; init; }
        private readonly string transactionDate = DateTimeOffset.UtcNow.AddSeconds(-5).ToOffset(TimeSpan.FromHours(7)).ToString("yyyy-MM-dd HH:mm:ss");
        internal string TransactionDate => transactionDate;
        internal HttpClient Anonymous() => Host.CreateClient();
        internal async Task<HttpClient> Client(Guid id)
        {
            await using var scope = Host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var email = await db.Users.Where(u => u.Id == id).Select(u => u.Email).SingleAsync();
            var client = Anonymous();
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password });
            login.EnsureSuccessStatusCode(); var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken); return client;
        }
        internal async Task<HttpResponseMessage> Send(decimal amount, string? reference = null, string? code = null, string account = Account, string direction = "in", string? eventId = null)
        {
            using var client = Anonymous();
            var body = JsonSerializer.Serialize(new
            {
                id = eventId ?? Guid.NewGuid().ToString(),
                gateway = "ACB",
                transactionDate,
                accountNumber = account,
                subAccount = "",
                code = code ?? Code,
                content = "Synthetic transfer " + (code ?? Code),
                transferType = direction,
                transferAmount = amount,
                referenceCode = reference ?? "SYN-" + Guid.NewGuid(),
                description = "Synthetic transfer",
                accumulated = amount
            });
            return await Signed(client, body);
        }
        internal Compact24Fixture? OwnedFixture { get; set; }
        public async ValueTask DisposeAsync() { await Host.DisposeAsync(); if (OwnedFixture is not null) await OwnedFixture.DisposeAsync(); }
    }
    private async Task<Scenario> Create(bool dualMode = false, bool isolatedMode = false, bool isolatedDatabase = false)
    {
        if ((dualMode || isolatedDatabase) && !isolatedMode)
        {
            var isolatedFixture = new Compact24Fixture(); await isolatedFixture.InitializeAsync();
            var isolatedScenario = await new SePayIntegrationTests(isolatedFixture).Create(dualMode, true);
            isolatedScenario.OwnedFixture = isolatedFixture;
            return isolatedScenario;
        }
        var location = new Location("Synthetic SePay " + Guid.NewGuid().ToString("N")) { Address = "Synthetic" };
        var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Logging:LogLevel:Default"] = "None",
            ["SePay:Enabled"] = "true",
            ["SePay:WebhookSecret"] = Secret,
            ["SePay:Mode"] = "Test",
            ["SePay:ReceivingAccounts:0:LocationId"] = location.Id.ToString(),
            ["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416",
            ["SePay:ReceivingAccounts:0:Gateway"] = "ACB",
            ["SePay:ReceivingAccounts:0:AccountNumber"] = Account
        })));
        if (dualMode) host = host.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SePay:InstanceCode"] = "CI01",
            ["SePay:Test:Enabled"] = "true",
            ["SePay:Test:WebhookSecret"] = Secret,
            ["SePay:Test:ReceivingAccounts:0:LocationId"] = location.Id.ToString(),
            ["SePay:Test:ReceivingAccounts:0:BankIdentifier"] = "970416",
            ["SePay:Test:ReceivingAccounts:0:Gateway"] = "ACB",
            ["SePay:Test:ReceivingAccounts:0:AccountNumber"] = Account,
            ["SePay:Live:Enabled"] = "true",
            ["SePay:Live:WebhookSecret"] = Secret + "-live",
            ["SePay:Live:ApiBaseUrl"] = "https://userapi.sepay.vn/v2",
            ["SePay:Live:ApiToken"] = "synthetic-live-token",
            ["SePay:Test:ApiToken"] = "synthetic-test-token",
            ["SePay:Live:ReceivingAccounts:0:LocationId"] = location.Id.ToString(),
            ["SePay:Live:ReceivingAccounts:0:BankIdentifier"] = "970416",
            ["SePay:Live:ReceivingAccounts:0:Gateway"] = "ACB",
            ["SePay:Live:ReceivingAccounts:0:AccountNumber"] = Account
        })));
        host = host.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.Insert(0, ServiceDescriptor.Singleton<Microsoft.AspNetCore.Diagnostics.IExceptionHandler, InitialDiagnostic>())));
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        async Task<Guid> User(string role)
        {
            var email = Guid.NewGuid() + "@example.invalid";
            return (await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { UserName = email, Email = email }, role, WorkflowTestUsers.Password)).Id;
        }
        var owner = await User(Roles.Owner); var tenants = new[] { await User(Roles.Tenant), await User(Roles.Tenant) };
        var today = DateOnly.FromDateTime(DateTime.UtcNow); var period = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        var room = new Room { LocationId = location.Id, RoomNumber = "SEPAY", Capacity = 2, Status = RoomStatus.Occupied };
        var resident = new Resident { RoomId = room.Id, TenantUserId = tenants[0], OwnerUserId = owner, DisplayLabel = "Synthetic payer", VerificationStatus = IdentityVerificationStatus.Verified };
        var contract = new Contract
        {
            RoomId = room.Id,
            RepresentativeResidentId = resident.Id,
            OwnerSignerId = owner,
            TenantUserId = tenants[0],
            Kind = ContractKind.Main,
            StartDate = period.AddMonths(-1),
            EndDate = period.AddMonths(12),
            MonthlyRent = 100000,
            RequiredDeposit = 100000,
            IsDevelopmentDemo = true,
            Status = ContractStatus.Active,
            ActivatedAt = DateTimeOffset.UtcNow,
            ActivatedByUserId = owner,
            Terms = "Synthetic",
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = period.AddMonths(-1) }]
        };
        var invoice = new Invoice
        {
            LocationId = location.Id,
            RoomId = room.Id,
            RoomNumber = room.RoomNumber,
            LocationName = location.Name,
            RepresentativeContractId = contract.Id,
            RepresentativeTenantUserId = tenants[0],
            BillingPeriod = period,
            Total = 100000,
            CreatedByUserId = owner,
            ScheduledFinalDate = period,
            DueDate = today,
            ScheduleSnapshot = "{}",
            Recipients = tenants.Select(id => new InvoiceRecipient { TenantUserId = id }).ToList(),
            Lines = [new InvoiceLine { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic", Rate = 100000, Quantity = 1, Amount = 100000, OccupiedDays = 30, PeriodDays = 30, RateDate = period }]
        };
        db.AddRange(location, room, resident, contract, invoice);
        db.Add(new ReceivingBankAccount
        {
            LocationId = location.Id,
            BankIdentifier = "970416",
            AccountNumber = Account,
            AccountHolder = "SYNTHETIC TEST",
            Enabled = true,
            IsDevelopmentDemo = true,
            Version = 1,
            ConfirmedByUserId = owner,
            ConfirmedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(); invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = owner; invoice.FinalizedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync();
        var code = (await scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>().IssueAsync("Invoice", invoice.Id, location.Id, default))!;
        return new Scenario { Host = host, Invoice = invoice.Id, Contract = contract.Id, Location = location.Id, Owner = owner, Tenants = tenants, Code = code };
    }
    private static Task<HttpResponseMessage> Signed(HttpClient client, string body, bool valid = true, int ageSeconds = 0)
    {
        var timestamp = DateTimeOffset.UtcNow.AddSeconds(-ageSeconds).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(valid ? Secret : "wrong"), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        var request = new HttpRequestMessage(HttpMethod.Post, SePayOptions.WebhookRoute) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-SePay-Timestamp", timestamp); request.Headers.Add("X-SePay-Signature", signature);
        return client.SendAsync(request);
    }
    [CompactPostgresFact]
    public async Task TestingContextIsOwnerOnlyAndDoesNotExposeCredentials()
    {
        await using var scenario = await Create();
        using var anonymous = scenario.Anonymous();
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        using var owner = await scenario.Client(scenario.Owner);
        const string path = "/api/v1/integrations/sepay/testing-context";
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        var response = await owner.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var context = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Test", context.RootElement.GetProperty("mode").GetString());
        Assert.Single(context.RootElement.EnumerateObject());
        var options = scenario.Host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<SePayOptions>>().Value;
        options.Enabled = false;
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(path)).StatusCode);
        options.Enabled = true; options.Mode = "Live";
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync(path)).StatusCode);
    }

    [CompactPostgresFact]
    public async Task IssuedPaymentModeSurvivesSigningMetadataChangesWithoutDoubleCredit()
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var contract = await db.Set<Contract>().SingleAsync(c => c.Id == scenario.Contract);
        contract.IsDevelopmentDemo = false; contract.PaymentMode = null;
        await db.SaveChangesAsync();
        var eventId = Guid.NewGuid().ToString();
        (await scenario.Send(100000, reference: "SYN-ENV-RECOVERY", eventId: eventId)).EnsureSuccessStatusCode();
        var receivedId = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1'
              AND task_data->'transaction'->>'id'={eventId}
            """).SingleAsync();
        var pending = await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventAsync(receivedId, default);
        Assert.Equal("Completed", pending.Status);
        var service = scope.ServiceProvider.GetRequiredService<SePayService>();
        await service.ReconcileAsync(pending.Id, default);
        await service.ReconcileAsync(pending.Id, default);
        (await scenario.Send(100000, reference: "SYN-ENV-RECOVERY", eventId: eventId)).EnsureSuccessStatusCode();
        (await scenario.Send(100000, reference: "SYN-ENV-RECOVERY")).EnsureSuccessStatusCode();
        var allocation = Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        Assert.Equal(100000m, allocation.Amount);
        Assert.False((await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == contract.Id)).IsDevelopmentDemo);
        var completed = await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventAsync(pending.Id, default);
        Assert.Equal("Completed", completed.Status); Assert.Equal(pending.TransferId, completed.TransferId);
    }

    [CompactPostgresFact]
    public async Task AnonymousWebhookAuthenticatesBeforeParsingAndRejectsExpiredRequests()
    {
        await using var scenario = await Create(); using var client = scenario.Anonymous();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Signed(client, "{", valid: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Signed(client, "{", ageSeconds: 301)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Signed(client, "{")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/integrations/sepay/events")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task ConfiguredTunnelStillRequiresHmacAndCannotCreatePaymentsWithoutIt()
    {
        await using var scenario = await Create();
        using var host = scenario.Host.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["AllowedHosts"] = "localhost;127.0.0.1;configured.ngrok-free.dev" })));
        using var client = host.CreateClient();
        await using var scope = host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var paymentsBefore = await db.Set<PaymentTransfer>().CountAsync();
        var repository = scope.ServiceProvider.GetRequiredService<ISePayRepository>();
        var eventsBefore = (await repository.EventsAsync(1, 20, default)).TotalCount;
        using var request = new HttpRequestMessage(HttpMethod.Post, SePayOptions.WebhookRoute)
        { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        request.Headers.Host = "configured.ngrok-free.dev";
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(paymentsBefore, await db.Set<PaymentTransfer>().CountAsync());
        Assert.Equal(eventsBefore, (await repository.EventsAsync(1, 20, default)).TotalCount);
    }

    [CompactPostgresTheory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public async Task InvoiceInstructionsUseRegisteredBhMemoAndFailClosedWhenSePayAccountDrifts(bool development, bool sandbox)
    {
        // Receiving accounts are Owner-wide. Isolate each case so changing that
        // shared profile cannot affect another payment scenario in this class.
        var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        try { await new SePayIntegrationTests(isolated).CheckInvoiceReceivingAccount(development, sandbox); }
        finally { await isolated.DisposeAsync(); }
    }

    private async Task CheckInvoiceReceivingAccount(bool development, bool sandbox)
    {
        await using var scenario = await Create();
        using var owner = await scenario.Client(scenario.Owner);
        var priorAccount = await owner.GetFromJsonAsync<ReceivingBankAccount>("/api/v1/receiving-bank-accounts/owner");
        var accountInput = new OwnerReceivingAccountInput("970416", Account, "SYNTHETIC OWNER", true, true, true, priorAccount?.Version ?? 0);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts/owner", accountInput)).EnsureSuccessStatusCode();
        using var host = scenario.Host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddSingleton(new PaymentRuntimeMode(development, sandbox))));
        using var authenticated = await scenario.Client(scenario.Tenants[0]);
        using var tenant = host.CreateClient();
        tenant.DefaultRequestHeaders.Authorization = authenticated.DefaultRequestHeaders.Authorization;
        var path = $"/api/v1/invoices/{scenario.Invoice}/transfer-instructions";
        var before = (await tenant.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
        var instructions = (await tenant.GetFromJsonAsync<TransferInstructions>(path))!;
        if (!development && !sandbox)
        {
            Assert.Equal("ReceivingAccountUnavailable", instructions.Availability);
            Assert.Null(instructions.AccountNumber); Assert.Null(instructions.QrImageDataUri);
            return;
        }
        Assert.Equal("Available", instructions.Availability);
        Assert.Equal(Account, instructions.AccountNumber);
        Assert.Equal(accountInput.ExpectedVersion + 1, instructions.ReceivingAccountVersion);
        Assert.Equal(scenario.Code, instructions.TransferReference);
        Assert.Equal(scenario.Code, instructions.TransferDescription);
        Assert.Contains("0810" + scenario.Code, instructions.QrPayload);
        Assert.NotNull(instructions.QrImageDataUri);
        Assert.Equal(instructions.TransferReference,
            (await tenant.GetFromJsonAsync<TransferInstructions>(path))!.TransferReference);
        var after = (await tenant.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
        Assert.Equal(before.PaidAmount, after.PaidAmount);
        Assert.Equal(before.OutstandingAmount, after.OutstandingAmount);
        Assert.Equal(before.PaymentStatus, after.PaymentStatus);

        await using (var scope = scenario.Host.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<IPaymentRepository>().SaveOwnerReceivingAccountAsync(scenario.Owner,
                new ReceivingBankAccount
                {
                    OwnerUserId = scenario.Owner,
                    BankIdentifier = "970416",
                    AccountNumber = "0000004321",
                    AccountHolder = "SYNTHETIC OWNER",
                    Enabled = true,
                    IsDevelopmentDemo = true,
                    Version = accountInput.ExpectedVersion + 2,
                    ConfirmedByUserId = scenario.Owner,
                    ConfirmedAt = DateTimeOffset.UtcNow
                }, accountInput.ExpectedVersion + 1, default);
        }
        var unavailable = (await tenant.GetFromJsonAsync<TransferInstructions>(path))!;
        // Issued obligations keep the original account even after Owner saves a new account.
        Assert.Equal("Available", unavailable.Availability);
        Assert.Equal(Account, unavailable.AccountNumber);
        Assert.Equal(instructions.QrPayload, unavailable.QrPayload);
        Assert.NotNull(unavailable.QrImageDataUri);
    }

    [CompactPostgresFact]
    public async Task OnlyExactReceiptsSettleTheSharedInvoice()
    {
        await using var scenario = await Create();
        var reference = "SYN-PARTIAL-" + Guid.NewGuid();
        (await scenario.Send(20000, reference)).EnsureSuccessStatusCode();
        (await scenario.Send(20000, reference)).EnsureSuccessStatusCode();
        (await scenario.Send(120000)).EnsureSuccessStatusCode();
        foreach (var id in scenario.Tenants)
        {
            using var tenant = await scenario.Client(id);
            var state = (await tenant.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
            Assert.Equal(20000, state.PaidAmount); Assert.Equal(80000, state.OutstandingAmount); Assert.Equal("Unpaid", state.PaymentStatus);
            Assert.Single(state.History);
            var instructions = (await tenant.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{scenario.Invoice}/transfer-instructions"))!;
            Assert.Equal(80000, instructions.OutstandingAmount);
            Assert.Equal(scenario.Code, instructions.TransferDescription);
            Assert.NotNull(instructions.QrImageDataUri);
        }
        (await scenario.Send(30000)).EnsureSuccessStatusCode();
        (await scenario.Send(50000)).EnsureSuccessStatusCode();
        using var owner = await scenario.Client(scenario.Owner);
        var paid = (await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
        Assert.Equal("Paid", paid.PaymentStatus); Assert.Equal(100000, paid.PaidAmount); Assert.True(paid.PendingReview);
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(3, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == scenario.Invoice));
        Assert.True(await db.Database.SqlQuery<bool>($"SELECT bool_and(created_by_user_id IS NULL AND paid_by_user_id IS NULL) AS \"Value\" FROM payment_allocations WHERE target_invoice_id={scenario.Invoice}").SingleAsync());
        Assert.Equal(3, await db.Set<PaymentConfirmedEvent>().CountAsync(e => e.InvoiceId == scenario.Invoice));
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        Assert.Equal(3, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == scenario.Invoice));
        // The dedicated billing publisher must work even when generic jobs are disabled.
        var publisher = scope.ServiceProvider.GetRequiredService<INotificationEventPublisher>();
        await ((NotificationEventPublisher)publisher).PublishBillingPendingAsync(default);
        await ((NotificationEventPublisher)publisher).PublishBillingPendingAsync(default);
        foreach (var tenantId in scenario.Tenants)
        {
            using var tenant = await scenario.Client(tenantId);
            var inbox = (await tenant.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<NotificationView>>("/api/v1/notifications?category=Payment"))!;
            var partials = inbox.Items.Where(n => n.RelatedObjectId == scenario.Invoice && n.EventType == "PAYMENT_PARTIALLY_CONFIRMED").ToArray();
            Assert.Equal(2, partials.Length);
            var second = Assert.Single(partials, n => n.Summary.Contains(30000m.ToString("N0")));
            Assert.Contains(50000m.ToString("N0"), second.Summary);
            var email = await scope.ServiceProvider.GetRequiredService<NotificationEmailContent>().BuildAsync(second, default);
            Assert.Contains(30000m.ToString("N0"), email.Body);
            Assert.Contains(50000m.ToString("N0"), email.Body);
            Assert.Single(inbox.Items, n => n.RelatedObjectId == scenario.Invoice && n.EventType == "INVOICE_FULLY_PAID");
        }
    }
    [CompactPostgresFact]
    public async Task ConcurrentDuplicateCallbacksAndAlternateProviderIdsCreditOnce()
    {
        await using var scenario = await Create(); var reference = "SYN-DUP-" + Guid.NewGuid(); var eventId = Guid.NewGuid().ToString();
        var results = await Task.WhenAll(scenario.Send(100000, reference, eventId: eventId), scenario.Send(100000, reference, eventId: eventId));
        foreach (var result in results) result.EnsureSuccessStatusCode();
        (await scenario.Send(100000, reference)).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        Assert.Single(await db.Set<PaymentTransfer>().Where(p => p.ProposedInvoiceId == scenario.Invoice).ToArrayAsync());
    }
    [CompactPostgresFact]
    public async Task WrongAccountOutgoingUnknownCodeAndLegacyReferenceDoNotAllocate()
    {
        await using var scenario = await Create();
        (await scenario.Send(100000, account: "0000009999")).EnsureSuccessStatusCode();
        (await scenario.Send(100000, direction: "out")).EnsureSuccessStatusCode();
        (await scenario.Send(100000, code: "BH00000000")).EnsureSuccessStatusCode();
        (await scenario.Send(100000, code: PaymentRules.InvoiceReference(scenario.Invoice))).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        using var owner = await scenario.Client(scenario.Owner);
        var events = await owner.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<SePayEventView>>("/api/v1/integrations/sepay/events");
        Assert.Contains(events!.Items, e => e.Reason == "receiving_account_not_configured"); Assert.Contains(events.Items, e => e.Reason == "outgoing_transaction");
    }
    [CompactPostgresFact]
    public async Task CodesAreStableUniqueScopedAndDepositsKeepUnknownPayer()
    {
        await using var scenario = await Create();
        async Task<string?> Issue(string kind, Guid id)
        { await using var scope = scenario.Host.Services.CreateAsyncScope(); return await scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>().IssueAsync(kind, id, scenario.Location, default); }
        var duplicates = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Issue("Invoice", scenario.Invoice)));
        Assert.All(duplicates, code => Assert.Equal(scenario.Code, code)); Assert.Matches("^BH[0-9]{8}$", scenario.Code);
        var deposit = await Issue("Deposit", scenario.Contract); Assert.NotEqual(scenario.Code, deposit);
        (await scenario.Send(75000, code: deposit)).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == scenario.Contract).ToArrayAsync());
        using var owner = await scenario.Client(scenario.Owner);
        var reviews = (await owner.GetFromJsonAsync<BHome.Application.PropertyManagement.PagedResult<SePayEventView>>("/api/v1/integrations/sepay/events"))!;
        Assert.Contains(reviews.Items, e => e.Reason == "payment_amount_requires_review");
        (await scenario.Send(100000, code: deposit)).EnsureSuccessStatusCode();
        var allocation = Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == scenario.Contract).ToArrayAsync());
        Assert.Equal(100000, allocation.Amount); Assert.Null(allocation.PaidByUserId);
        Assert.True(await db.IsSchemaReadyAsync());
        var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM operational_tasks WHERE source_key={"payment-code:" + scenario.Code}"));
        Assert.Contains(error.SqlState, new[] { "23514", "P0001" });
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync("/api/v1/integrations/sepay/events")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task FailedAllocationRollsBackMoneyAndDurableInboxCanBeRetried()
    {
        // This test drains the durable queue. Other cases must not supply its pending jobs.
        await using var scenario = await Create(isolatedDatabase: true);
        await using (var scope = scenario.Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION synthetic_sepay_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$;
                CREATE TRIGGER synthetic_sepay_failure BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION synthetic_sepay_failure();
                """);
        }
        var eventId = Guid.NewGuid().ToString();
        Assert.Equal(HttpStatusCode.InternalServerError, (await scenario.Send(100000, eventId: eventId)).StatusCode);
        await using (var scope = scenario.Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Empty(await db.Set<PaymentTransfer>().Where(p => p.ProposedInvoiceId == scenario.Invoice).ToArrayAsync());
            await db.Database.ExecuteSqlRawAsync("DROP TRIGGER synthetic_sepay_failure ON payment_allocations; DROP FUNCTION synthetic_sepay_failure()");
            var inbox = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1' AND status='Pending' AND task_data->'transaction'->>'id'={eventId}").SingleAsync();
            var worker = scenario.Host.Services.GetRequiredService<BHome.Infrastructure.Jobs.PostgresJobWorker>();
            for (var attempt = 0; attempt < 30 && await worker.ProcessAllowedAsync(default, ["sepay-reconcile-test"]); attempt++) { }
            Assert.Equal("Completed", (await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventAsync(inbox, default)).Status);
            Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        }
    }

    private sealed class ScriptedProvider(Func<SePayPollingCursor, SePayPage> page) : ISePayTransactionClient
    {
        public Task<SePayPage> GetAsync(SePayPollingCursor cursor, CancellationToken token) => Task.FromResult(page(cursor));
    }

    [CompactPostgresFact]
    public async Task PollingRetainsPageOnFailureAndAdvancesSinceIdOnlyAfterEveryPage()
    {
        await using var scenario = await Create(); var reference = "SYN-BACKFILL-" + Guid.NewGuid();
        (await scenario.Send(40000, reference, eventId: "123456")).EnsureSuccessStatusCode();
        var first = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account, null, scenario.Code,
            "Synthetic transfer " + scenario.Code, "in", 40000, reference, null, 40000);
        var second = first with { Id = Guid.NewGuid().ToString(), ReferenceCode = "SYN-SECOND-" + Guid.NewGuid(), TransferAmount = 60000 };
        var failSecond = true;
        var provider = new ScriptedProvider(cursor =>
        {
            if (cursor.Page == 1) { Assert.Null(cursor.SinceId); return new([first], true); }
            Assert.Equal(2, cursor.Page); Assert.Null(cursor.SinceId);
            if (failSecond) throw new HttpRequestException("Synthetic provider outage");
            return new([second], false);
        });
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var job = new BHome.Infrastructure.PaymentsDebt.SePayPollingJob(db, provider, scope.ServiceProvider.GetRequiredService<SePayService>(),
            scope.ServiceProvider.GetRequiredService<SePayOptions>(), TimeProvider.System);
        async Task<SePayPollingCursor> Cursor() => JsonSerializer.Deserialize<SePayPollingCursor>((await db.Database.SqlQuery<string>(
            $"SELECT task_data->>'cursor' AS \"Value\" FROM operational_tasks WHERE source_key='sepay-sync:Test'").SingleAsync()))!;
        var execution = new JobExecution(Guid.NewGuid(), "synthetic", "{}");
        await job.ExecuteAsync(execution, default); Assert.Equal(2, (await Cursor()).Page); Assert.Null((await Cursor()).SinceId);
        await Assert.ThrowsAsync<HttpRequestException>(() => job.ExecuteAsync(execution, default)); Assert.Equal(2, (await Cursor()).Page);
        failSecond = false; await job.ExecuteAsync(execution, default);
        var completed = await Cursor(); Assert.Equal(second.Id, completed.SinceId); Assert.Equal(1, completed.Page); Assert.NotNull(completed.SynchronizedAt);
        Assert.Equal(2, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == scenario.Invoice));
        Assert.Equal(100000, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).SumAsync(a => a.Amount));
    }

    [CompactPostgresFact]
    public async Task ManualLegacyAndRegisteredReferencesRemainUsableAndTenantAccessIsIsolated()
    {
        await using var scenario = await Create(); using var owner = await scenario.Client(scenario.Owner);
        async Task Manual(string memo, decimal amount)
        {
            using var input = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions")
            {
                Content = JsonContent.Create(new PaymentTransferInput("SYNTHETIC-MANUAL", "SYN-" + Guid.NewGuid(), amount, "VND", DateTimeOffset.UtcNow.AddSeconds(-5), memo,
                    "Synthetic checked statement", "Synthetic Owner confirmation", scenario.Invoice, true, true))
            };
            input.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var response = await owner.SendAsync(input); response.EnsureSuccessStatusCode(); var receipt = (await response.Content.ReadFromJsonAsync<TransferView>())!;
            using var allocate = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/payment-transactions/{receipt.Id}/allocate") { Content = JsonContent.Create(new PaymentMatchInput(scenario.Invoice, null, true)) };
            allocate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            var allocated = await owner.SendAsync(allocate); allocated.EnsureSuccessStatusCode();
            Assert.Equal("Allocated", (await allocated.Content.ReadFromJsonAsync<PaymentReviewResult>())!.Status);
        }
        await Manual(PaymentRules.InvoiceReference(scenario.Invoice), 40000); await Manual(scenario.Code, 60000);
        var state = (await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
        Assert.Equal("Paid", state.PaymentStatus);
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/invoices/{Guid.NewGuid()}/payment")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync("/api/v1/payment-transactions")).StatusCode);
        var transfer = await tenant.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{scenario.Invoice}/transfer-instructions");
        Assert.Null(transfer!.QrPayload); Assert.Null(transfer.AccountNumber);
    }

    [CompactPostgresFact]
    public async Task HoldingQrPreviewRequiresOwnerAndSandboxAndNeverSignsOrActivates()
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var room = new Room { LocationId = scenario.Location, RoomNumber = "QR-TEST", Capacity = 1, Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, DisplayLabel = "Synthetic QR payer", VerificationStatus = IdentityVerificationStatus.Verified };
        var holding = new Contract
        {
            Kind = ContractKind.Holding,
            RoomId = room.Id,
            OwnerSignerId = scenario.Owner,
            RepresentativeResidentId = resident.Id,
            StartDate = today,
            EndDate = today.AddMonths(1),
            HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(2),
            RequiredDeposit = 100000,
            MonthlyRent = 100000,
            Status = ContractStatus.Draft,
            IsDevelopmentDemo = true,
            Terms = "Synthetic QR preview only",
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = today }]
        };
        db.AddRange(room, resident, holding); await db.SaveChangesAsync();
        var path = $"/api/v1/integrations/sepay/testing/holdings/{holding.Id}/transfer-instructions";
        using var anonymous = scenario.Anonymous(); using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(path)).StatusCode);
        using var owner = await scenario.Client(scenario.Owner);
        var result = await owner.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingTestTransferInstructions>(path);
        Assert.Equal("Test", result!.Mode); Assert.Equal("Draft", result.ContractStatus);
        Assert.True(result.SignatureRequiredForActivation); Assert.Equal("100000", result.OutstandingAmount);
        Assert.Matches("^BH[0-9]{8}$", result.TransferReference);
        Assert.StartsWith("data:image/png;base64,", result.QrImageDataUri);
        Assert.Contains(result.TransferReference, result.QrPayload);
        Assert.Equal(Account, result.AccountNumber);
        var again = await owner.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingTestTransferInstructions>(path);
        Assert.Equal(result.TransferReference, again!.TransferReference);
        db.ChangeTracker.Clear();
        var unchanged = await db.Set<Contract>().Include(c => c.Signatures).SingleAsync(c => c.Id == holding.Id);
        Assert.Equal(ContractStatus.Draft, unchanged.Status); Assert.Null(unchanged.ApprovedAt);
        Assert.Null(unchanged.ActivatedAt); Assert.Empty(unchanged.Signatures);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == room.Id)).Status);
        Assert.Empty(await db.Set<PaymentAllocation>().Where(x => x.TargetDepositContractId == holding.Id).ToArrayAsync());
        unchanged.HoldingExpiryAt = DateTimeOffset.UtcNow.AddMinutes(-1); await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync(path)).StatusCode);
        unchanged.HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(1); unchanged.IsDevelopmentDemo = false; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await owner.GetAsync(path)).StatusCode); // Real unsigned contracts cannot show even a sandbox QR.
    }

    [CompactPostgresFact]
    public async Task StaffCanOnlySimulateTenantAndActualOwnerConfirmationIsRequiredBeforeQrAndVerifiedDepositBeforeOnHold()
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        async Task<Guid> Staff()
        {
            var email = Guid.NewGuid() + "@example.invalid";
            return (await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser { UserName = email, Email = email }, Roles.Staff, WorkflowTestUsers.Password)).Id;
        }
        var staffId = await Staff(); var unrelatedId = await Staff();
        db.StaffLocationAssignments.Add(new StaffLocationAssignment(scenario.Location, staffId, scenario.Owner, today.AddDays(-1), today.AddDays(7)));
        var room = new Room { LocationId = scenario.Location, RoomNumber = "SIM-QR-TEST", Capacity = 1, Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, DisplayLabel = "Synthetic signing simulation", VerificationStatus = IdentityVerificationStatus.Verified };
        var c = new Contract
        {
            Kind = ContractKind.Holding,
            RoomId = room.Id,
            OwnerSignerId = scenario.Owner,
            RepresentativeResidentId = resident.Id,
            StartDate = today,
            EndDate = today.AddMonths(1),
            HoldingExpiryAt = DateTimeOffset.UtcNow.AddDays(2),
            RequiredDeposit = 100000,
            MonthlyRent = 100000,
            ApprovedAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            ApprovedByUserId = scenario.Owner,
            ApprovalReason = "Synthetic reviewed fixture",
            SigningMode = "INTERNAL_OTP_DRAWN",
            Status = ContractStatus.Draft,
            IsDevelopmentDemo = true,
            Terms = "Synthetic only",
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = today }]
        };
        c.SnapshotHash = BHome.Application.Contracts.ContractDocumentSnapshot.Hash(new BHome.Application.Contracts.ContractDocument(c.Id, c.RoomId, c.OwnerSignerId, Guid.Empty,
            c.RepresentativeResidentId, [resident.Id], c.StartDate, c.EndDate, c.MonthlyRent, c.RequiredDeposit, null, 0, c.Terms, "")
        { IsInternalResidentAcceptance = true });
        db.AddRange(room, resident, c); await db.SaveChangesAsync();
        using var staff = await scenario.Client(staffId); using var unrelated = await scenario.Client(unrelatedId);
        var root = $"/api/v1/integrations/sepay/testing/holdings/{c.Id}";
        Assert.Equal(HttpStatusCode.NotFound, (await unrelated.GetAsync(root + "/simulation")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.GetAsync(root + "/transfer-instructions")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.PostAsync(root + "/simulation/activate", null)).StatusCode);
        async Task<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState> Sim(string party)
        {
            var response = await staff.PostAsJsonAsync(root + "/simulation/signatures", new { participant = party, simulationOnly = true });
            response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>())!;
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(root + "/simulation/signatures", new { participant = "Owner", simulationOnly = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.GetAsync(root + "/transfer-instructions")).StatusCode);
        var consent = new { documentHash = c.SnapshotHash, consent = true, consentVersion = "internal-acceptance-v1" };
        var confirmation = $"/api/v1/contracts/{c.Id}/internal-signing/owner-confirmation";
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(confirmation, consent)).StatusCode);
        using var owner = await scenario.Client(scenario.Owner);
        var accepted = await owner.PostAsJsonAsync(confirmation, consent);
        Assert.True(accepted.IsSuccessStatusCode, await accepted.Content.ReadAsStringAsync());
        (await owner.PostAsJsonAsync(confirmation, consent)).EnsureSuccessStatusCode();
        var ownerOnly = await staff.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>(root + "/simulation");
        Assert.False(ownerOnly!.CanShowQr); Assert.False(ownerOnly.TenantSimulated);
        Assert.Equal("Draft", ownerOnly.ContractStatus);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.GetAsync(root + "/transfer-instructions")).StatusCode);
        Assert.True((await Sim("Tenant")).CanShowQr);
        Assert.True((await Sim("Tenant")).CanShowQr);
        var reopened = await staff.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>(root + "/simulation");
        Assert.False(reopened!.OwnerSimulated); Assert.True(reopened.TenantSimulated && reopened.CanShowQr); Assert.Equal("PendingActivation", reopened.ContractStatus);
        var qr = await staff.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingTestTransferInstructions>(root + "/transfer-instructions");
        Assert.StartsWith("data:image/png;base64,", qr!.QrImageDataUri);
        Assert.Equal(HttpStatusCode.Conflict, (await staff.PostAsync(root + "/simulation/activate", null)).StatusCode);
        (await scenario.Send(100000, code: qr.TransferReference)).EnsureSuccessStatusCode();
        var verified = await staff.GetFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>(root + "/simulation");
        Assert.True(verified!.DepositVerified); Assert.False(verified.OnHold);
        var activated = await staff.PostAsync(root + "/simulation/activate", null); activated.EnsureSuccessStatusCode();
        Assert.True((await activated.Content.ReadFromJsonAsync<BHome.Api.Controllers.PaymentsDebt.HoldingSandboxState>())!.OnHold);
        (await staff.PostAsync(root + "/simulation/activate", null)).EnsureSuccessStatusCode();
        db.ChangeTracker.Clear();
        var stored = await db.Set<Contract>().Include(x => x.Signatures).SingleAsync(x => x.Id == c.Id);
        Assert.Equal(ContractStatus.Active, stored.Status); Assert.Empty(stored.Signatures); Assert.Equal("{}", stored.InternalAcceptance);
        Assert.Equal(staffId, stored.ActivatedByUserId);
        Assert.Equal("TenantSimulatedOwnerConfirmed", JsonDocument.Parse(stored.DraftMetadata).RootElement.GetProperty("SigningState").GetString());
        Assert.Equal(RoomStatus.OnHold, (await db.Set<Room>().SingleAsync(x => x.Id == room.Id)).Status);
        Assert.Equal(100000, await db.Set<PaymentAllocation>().Where(x => x.TargetDepositContractId == c.Id).SumAsync(x => x.Amount));
    }

    [CompactPostgresFact]
    public async Task HoldingDepositAcceptsOwnerSigningWithoutLegacyApprovalAndPreservesIdempotency()
    {
        await HoldingDepositPreservesApprovalExpiryAndOwnerActivationRules(ownerSigned: true);
    }

    [CompactPostgresFact]
    public async Task HoldingDepositPreservesLegacyApprovalExpiryAndOwnerActivationRules()
    {
        await HoldingDepositPreservesApprovalExpiryAndOwnerActivationRules(ownerSigned: false);
    }

    private async Task HoldingDepositPreservesApprovalExpiryAndOwnerActivationRules(bool ownerSigned)
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var room = new Room { LocationId = scenario.Location, RoomNumber = "HOLD-" + Guid.NewGuid().ToString("N")[..6], Capacity = 1, Status = RoomStatus.Available };
        var resident = new Resident { RoomId = room.Id, OwnerUserId = scenario.Owner, DisplayLabel = "Synthetic pre-account occupant", VerificationStatus = IdentityVerificationStatus.Verified };
        var holding = new Contract
        {
            Kind = ContractKind.Holding,
            RoomId = room.Id,
            OwnerSignerId = scenario.Owner,
            RepresentativeResidentId = resident.Id,
            StartDate = today.AddDays(1),
            EndDate = today.AddMonths(6),
            HoldingExpiryAt = DateTimeOffset.UtcNow.AddHours(1),
            RequiredDeposit = 100000,
            MonthlyRent = 100000,
            Status = ContractStatus.PendingSigning,
            IsDevelopmentDemo = true,
            Terms = "Synthetic approved hold",
            Residents = [new ContractResident { ResidentId = resident.Id, Role = ResidentType.Representative, ResidenceFrom = today.AddDays(1) }]
        };
        db.AddRange(room, resident, holding); await db.SaveChangesAsync();
        var registry = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        var code = await registry.IssueAsync("Deposit", holding.Id, scenario.Location, default);
        (await scenario.Send(40000, code: code)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == holding.Id).ToArrayAsync());
        db.ChangeTracker.Clear(); var approved = await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id);
        if (ownerSigned)
        {
            db.Add(new ContractSignature
            {
                ContractId = holding.Id,
                SignerUserId = scenario.Owner,
                Status = SignatureStatus.Simulated,
                SnapshotHash = approved.SnapshotHash,
                SignedAt = DateTimeOffset.UtcNow,
                ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
                SignedObjectKey = "synthetic-owner.pdf",
                SignedHash = "synthetic-owner-hash",
                ProviderReference = "synthetic-provider"
            });
        }
        else { approved.ApprovedAt = DateTimeOffset.UtcNow; approved.ApprovedByUserId = scenario.Owner; approved.ApprovalReason = "Synthetic approval"; }
        await db.SaveChangesAsync();
        var reference = "HOLD-" + Guid.NewGuid().ToString("N"); var eventId = Guid.NewGuid().ToString();
        (await scenario.Send(100000, reference, code, eventId: eventId)).EnsureSuccessStatusCode();
        (await scenario.Send(100000, reference, code, eventId: eventId)).EnsureSuccessStatusCode();
        Assert.Equal(100000, (await db.Set<PaymentAllocation>().SingleAsync(a => a.TargetDepositContractId == holding.Id)).Amount);
        using var owner = await scenario.Client(scenario.Owner);
        var deposits = await owner.GetFromJsonAsync<DepositVerificationView[]>($"/api/v1/contracts/{holding.Id}/deposit-verifications");
        Assert.Single(deposits!); Assert.Null(deposits![0].VerifiedByUserId); Assert.Equal(100000, deposits[0].Amount);
        db.ChangeTracker.Clear(); Assert.Equal(ContractStatus.PendingSigning, (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
        if (ownerSigned) Assert.Null((await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).ApprovedAt);
        Assert.Equal(RoomStatus.Available, (await db.Set<Room>().SingleAsync(r => r.Id == room.Id)).Status);
    }

    [CompactPostgresFact]
    public async Task CrossLocationTenantCannotReadAnotherExistingInvoiceAndCodeRegistryCannotBeRebound()
    {
        await using var first = await Create(); await using var second = await Create(); using var tenant = await first.Client(first.Tenants[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/invoices/{second.Invoice}/transfer-instructions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await tenant.GetAsync($"/api/v1/invoices/{second.Invoice}/payment")).StatusCode);
        await using var scope = first.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var duplicate = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
            SELECT {Guid.NewGuid()},task_type,location_id,source_key,status,task_data FROM operational_tasks WHERE source_key={"payment-code:" + first.Code}
            """));
        Assert.Equal("23514", duplicate.SqlState);
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['state','obligationId'],to_jsonb({second.Invoice.ToString()}::text))
              WHERE source_key={"payment-code:" + first.Code}
            """));
    }

    [CompactPostgresFact]
    public async Task OwnerCanVerifyBankStatementForOldTestQrAfterContractChangesToLive()
    {
        await using var scenario = await Create();
        (await scenario.Send(40000)).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var contract = await db.Set<Contract>().SingleAsync(c => c.Id == scenario.Contract);
        contract.PaymentMode = "Live"; contract.IsDevelopmentDemo = false; await db.SaveChangesAsync();
        using var owner = await scenario.Client(scenario.Owner);
        using var manual = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions")
        {
            Content = JsonContent.Create(new PaymentTransferInput("SYNTHETIC-MANUAL", "SYN-MANUAL-" + Guid.NewGuid(), 60000,
            "VND", DateTimeOffset.UtcNow.AddSeconds(-1), scenario.Code, "Synthetic checked statement", "Synthetic Owner verification", scenario.Invoice, true))
        };
        manual.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var response = await owner.SendAsync(manual); response.EnsureSuccessStatusCode();
        var receipt = (await response.Content.ReadFromJsonAsync<TransferView>())!;
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/payment-transactions/{receipt.Id}/allocate")
        { Content = JsonContent.Create(new PaymentMatchInput(scenario.Invoice, null, true)) };
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        (await owner.SendAsync(request)).EnsureSuccessStatusCode();
        Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).SumAsync(a => a.Amount));
        Assert.Equal("Test", await scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>().PersistedModeAsync("Invoice", scenario.Invoice, default));
    }

    [CompactPostgresFact]
    public async Task ManualAndProviderPathsCannotDoubleCreditTheSameUnscopedBankReference()
    {
        await using var first = await Create(); using var owner = await first.Client(first.Owner);
        var reference = "SYN-MANUAL-FIRST-" + Guid.NewGuid();
        async Task<HttpResponseMessage> Register(HttpClient actor, Scenario scenario, string bankReference)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions")
            {
                Content = JsonContent.Create(new PaymentTransferInput("SYNTHETIC-MANUAL", bankReference, 100000, "VND", DateTimeOffset.UtcNow.AddSeconds(-5),
                scenario.Code, "Synthetic statement", "Synthetic Owner confirmation", scenario.Invoice, true, true))
            };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString()); return await actor.SendAsync(request);
        }
        var registered = await Register(owner, first, reference); registered.EnsureSuccessStatusCode();
        (await first.Send(100000, reference)).EnsureSuccessStatusCode();
        await using (var scope = first.Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Single(await db.Set<PaymentTransfer>().Where(p => p.ProposedInvoiceId == first.Invoice).ToArrayAsync());
            Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == first.Invoice).ToArrayAsync());
            var events = await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventsAsync(1, 100, default);
            Assert.Contains(events.Items, e => e.Reason == "legacy_bank_reference_requires_manual_review");
        }
        await using var second = await Create(); using var secondOwner = await second.Client(second.Owner);
        var providerFirst = "SYN-PROVIDER-FIRST-" + Guid.NewGuid();
        (await second.Send(100000, providerFirst)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Register(secondOwner, second, providerFirst)).StatusCode);
        await using var check = second.Host.Services.CreateAsyncScope(); var native = check.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var shadow = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
        await native.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payments(id,provider_code,receiving_account_key,transaction_reference,effect_key,received_at,amount,currency,status,
              verification_method,verified_by_user_id,verified_at) VALUES({shadow},'SYNTHETIC','unscoped',{providerFirst},{"synthetic-shadow:" + shadow},
              {now},100000,'VND','VERIFIED','MANUAL',{second.Owner},{now})
            """);
        var blocked = await Assert.ThrowsAsync<PostgresException>(() => native.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO payment_allocations(id,source_payment_id,target_deposit_contract_id,amount,operation_key,line_number,created_by_user_id,allocated_at,reason)
            VALUES({Guid.NewGuid()},{shadow},{second.Contract},100000,{Guid.NewGuid()},1,{second.Owner},{now},'Synthetic duplicate attempt')
            """));
        Assert.Equal("23514", blocked.SqlState);
    }
}
