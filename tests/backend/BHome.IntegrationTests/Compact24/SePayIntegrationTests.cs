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
            var worker = scenario.Host.Services.GetRequiredService<BHome.Infrastructure.Jobs.PostgresJobWorker>();
            for (var attempt = 0; attempt < 30 && await worker.ProcessOneAsync(default, ["sepay-reconcile-test"]); attempt++) { }
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
    public async Task HoldingDepositPreservesApprovalExpiryAndOwnerActivationRules()
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
        approved.ApprovedAt = DateTimeOffset.UtcNow; approved.ApprovedByUserId = scenario.Owner; approved.ApprovalReason = "Synthetic approval";
        await db.SaveChangesAsync();
        (await scenario.Send(100000, code: code)).EnsureSuccessStatusCode();
        Assert.Equal(100000, (await db.Set<PaymentAllocation>().SingleAsync(a => a.TargetDepositContractId == holding.Id)).Amount);
        db.ChangeTracker.Clear(); Assert.Equal(ContractStatus.PendingSigning, (await db.Set<Contract>().SingleAsync(c => c.Id == holding.Id)).Status);
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
        Assert.Equal("23505", duplicate.SqlState);
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET task_data=jsonb_set(task_data,ARRAY['state','obligationId'],to_jsonb({second.Invoice.ToString()}::text))
              WHERE source_key={"payment-code:" + first.Code}
            """));
    }

    [CompactPostgresFact]
    public async Task SandboxReceiptCannotBeAppliedToANonDemoObligationThroughAutomaticOrManualPaths()
    {
        await using var scenario = await Create();
        await using var scope = scenario.Host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var contract = await db.Set<Contract>().SingleAsync(c => c.Id == scenario.Contract); contract.IsDevelopmentDemo = false; await db.SaveChangesAsync();
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        var receipt = await db.Set<PaymentTransfer>().SingleAsync(p => p.ProposedInvoiceId == scenario.Invoice);
        using var owner = await scenario.Client(scenario.Owner);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/payment-transactions/{receipt.Id}/allocate")
        { Content = JsonContent.Create(new PaymentMatchInput(scenario.Invoice, null, true)) };
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        Assert.Equal(HttpStatusCode.Conflict, (await owner.SendAsync(request)).StatusCode);
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
