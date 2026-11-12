using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Jobs;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class SePayIntegrationTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Secret = "synthetic-sepay-integration-secret-at-least-32-bytes";
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
        public ValueTask DisposeAsync() => Host.DisposeAsync();
    }
    private async Task<Scenario> Create()
    {
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
    public async Task AnonymousWebhookAuthenticatesBeforeParsingAndRejectsExpiredRequests()
    {
        await using var scenario = await Create(); using var client = scenario.Anonymous();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Signed(client, "{", valid: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Signed(client, "{", ageSeconds: 301)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Signed(client, "{")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/integrations/sepay/events")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task ExactPartialAndExcessUseCanonicalLedgerAndSharedTenantStatus()
    {
        await using var scenario = await Create();
        (await scenario.Send(20000)).EnsureSuccessStatusCode();
        foreach (var id in scenario.Tenants)
        {
            using var tenant = await scenario.Client(id);
            var state = (await tenant.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
            Assert.Equal(20000, state.PaidAmount); Assert.Equal(80000, state.OutstandingAmount); Assert.Equal("Unpaid", state.PaymentStatus);
            Assert.Null(Assert.Single(state.History).PaidByUserId);
        }
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        using var owner = await scenario.Client(scenario.Owner);
        var paid = (await owner.GetFromJsonAsync<InvoicePaymentView>($"/api/v1/invoices/{scenario.Invoice}/payment"))!;
        Assert.Equal("Paid", paid.PaymentStatus); Assert.Equal(100000, paid.PaidAmount); Assert.True(paid.PendingReview);
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(2, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == scenario.Invoice));
        Assert.True(await db.Database.SqlQuery<bool>($"SELECT bool_and(created_by_user_id IS NULL AND paid_by_user_id IS NULL) AS \"Value\" FROM payment_allocations WHERE target_invoice_id={scenario.Invoice}").SingleAsync());
        Assert.Equal(2, await db.Set<PaymentConfirmedEvent>().CountAsync(e => e.InvoiceId == scenario.Invoice));
        Assert.Equal(20000, await db.Database.SqlQuery<decimal>($"SELECT sum(p.amount-a.amount) AS \"Value\" FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id WHERE a.target_invoice_id={scenario.Invoice}").SingleAsync());
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        Assert.Equal(2, await db.Set<PaymentAllocation>().CountAsync(a => a.InvoiceId == scenario.Invoice));
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
        var allocation = Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == scenario.Contract).ToArrayAsync());
        Assert.Equal(75000, allocation.Amount); Assert.Null(allocation.PaidByUserId);
        Assert.True(await db.IsSchemaReadyAsync());
        var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM operational_tasks WHERE source_key={"payment-code:" + scenario.Code}"));
        Assert.Contains(error.SqlState, new[] { "23514", "P0001" });
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync("/api/v1/integrations/sepay/events")).StatusCode);
    }
    [CompactPostgresFact]
    public async Task FailedAllocationRollsBackMoneyAndDurableInboxCanBeRetried()
    {
        await using var scenario = await Create();
        await using (var scope = scenario.Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION synthetic_sepay_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$;
                CREATE TRIGGER synthetic_sepay_failure BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION synthetic_sepay_failure();
                """);
        }
        Assert.Equal(HttpStatusCode.InternalServerError, (await scenario.Send(100000)).StatusCode);
        await using (var scope = scenario.Host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            Assert.Empty(await db.Set<PaymentTransfer>().Where(p => p.ProposedInvoiceId == scenario.Invoice).ToArrayAsync());
            await db.Database.ExecuteSqlRawAsync("DROP TRIGGER synthetic_sepay_failure ON payment_allocations; DROP FUNCTION synthetic_sepay_failure()");
            var inbox = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM operational_tasks WHERE task_data->>'recordType'='SePayEventV1' AND status='Pending'").SingleAsync();
            await scope.ServiceProvider.GetRequiredService<SePayService>().ReconcileAsync(inbox, default);
            Assert.Single(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        }
    }
}
