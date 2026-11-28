using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Application.Finance;
using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class SePayIntegrationTests
{
    [CompactPostgresFact]
    public async Task AmbiguousLegacyObligationCannotReceiveAutomaticCreditFromEitherMode()
    {
        await using var scenario = await Create(dualMode: true);
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var legacy = JsonSerializer.Serialize(new PaymentCode("BH11223344", "Live", "Invoice", scenario.Invoice, scenario.Location),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        // Reproduce data allowed before the one-obligation guard, in this disposable database only.
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE operational_tasks DISABLE TRIGGER sepay_technical_guard");
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
                VALUES({Guid.NewGuid()},'COMMAND',{scenario.Location},'payment-code:BH11223344','Issued',
                    jsonb_build_object('recordType','PaymentCodeV1','state',CAST({legacy} AS jsonb)))
                """);
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE operational_tasks ENABLE TRIGGER sepay_technical_guard");
            await transaction.CommitAsync();
        }
        var registry = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        Assert.Equal("legacy_payment_mode_ambiguous", (await Assert.ThrowsAsync<PaymentException>(() =>
            registry.ContextAsync("Invoice", scenario.Invoice, default))).Code);
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        Assert.Empty(await db.Set<PaymentTransfer>().Where(p => p.TransferDescription.Contains(scenario.Code)).ToArrayAsync());
    }

    [CompactPostgresFact]
    public async Task LegacyCodeRequiresUniqueDeploymentRoutingAndCanResumeWithoutChangingItsCodeOrMode()
    {
        await using var scenario = await Create(dualMode: true);
        var legacy = await NewModeInvoice(scenario, issueCode: false);
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var codes = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        var original = (await codes.ContextAsync("Invoice", scenario.Invoice, default))!;
        var oldCode = legacy with { Code = "BH76543210", Mode = "Test", AccountSnapshot = original.AccountSnapshot };
        var data = JsonSerializer.Serialize(oldCode, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
            VALUES({Guid.NewGuid()},'COMMAND',{scenario.Location},{"payment-code:" + oldCode.Code},'Issued',
                jsonb_build_object('recordType','PaymentCodeV1','state',CAST({data} AS jsonb)))
            """);
        var tx = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account,
            null, oldCode.Code, oldCode.Code, "in", 100000, "SYN-LEGACY-" + Guid.NewGuid(), null, null);
        var body = JsonSerializer.Serialize(tx, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var anonymous = scenario.Anonymous();
        (await Signed(anonymous, body)).EnsureSuccessStatusCode();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == legacy.ObligationId).ToArrayAsync());
        var blocked = await Assert.ThrowsAsync<PaymentException>(() => codes.IssueAsync("Invoice", legacy.ObligationId, scenario.Location, default));
        Assert.Equal("legacy_payment_code_route_required", blocked.Code);
        using var routed = scenario.Host.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["SePay:Test:LegacyPaymentCodes:0"] = oldCode.Code })));
        using var receiver = routed.CreateClient();
        (await Signed(receiver, body)).EnsureSuccessStatusCode();
        (await Signed(receiver, body)).EnsureSuccessStatusCode();
        Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == legacy.ObligationId).SumAsync(a => a.Amount));
        var unchanged = (await codes.ContextAsync("Invoice", legacy.ObligationId, default))!;
        Assert.Equal(oldCode.Code, unchanged.Code);
        Assert.Equal(oldCode.Mode, unchanged.Mode);
        Assert.Equal(oldCode.AccountSnapshot!.AccountNumber, unchanged.AccountSnapshot!.AccountNumber);
        Assert.Equal(oldCode.AccountSnapshot.BankIdentifier, unchanged.AccountSnapshot.BankIdentifier);
    }
    [CompactPostgresFact]
    public async Task PreUpgradeFinalInvoiceKeepsItsModeAndBankBeforeItsFirstSePayQr()
    {
        await using var scenario = await Create(dualMode: true);
        var legacy = await NewModeInvoice(scenario, issueCode: false);
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        await using var stream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.SePayPaymentModes.sql")!;
        using var reader = new StreamReader(stream);
        await db.Database.OpenConnectionAsync();
        await using (var command = db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = await reader.ReadToEndAsync();
            await command.ExecuteNonQueryAsync();
        }
        using var owner = await scenario.Client(scenario.Owner);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts/owner/mode", new PaymentModeInput("Live", "Test"))).EnsureSuccessStatusCode();
        var codes = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        Assert.NotNull(await codes.IssueAsync("Invoice", legacy.ObligationId, scenario.Location, default));
        var issued = await codes.ContextAsync("Invoice", legacy.ObligationId, default);
        Assert.Equal("Test", issued!.Mode); Assert.Equal(Account, issued.AccountSnapshot!.AccountNumber);
    }
    private sealed class ModePollingClient(string mode, SePayTransaction test, SePayTransaction live) : ISePayTransactionClient
    {
        public Task<SePayPage> GetAsync(SePayPollingCursor cursor, CancellationToken token) =>
            Task.FromResult(new SePayPage([mode == "Test" ? test : live], false));
    }

    [CompactPostgresFact]
    public async Task BothPollingJobsKeepIndependentCheckpointsAndDeduplicateAfterOwnerSwitchesMode()
    {
        await using var scenario = await Create(dualMode: true);
        using var owner = await scenario.Client(scenario.Owner);
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts/owner",
            new OwnerReceivingAccountInput("970416", Account, "SYNTHETIC LIVE", true, false, true, 0))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts/owner/mode", new PaymentModeInput("Live", "Test"))).EnsureSuccessStatusCode();
        var live = await NewModeInvoice(scenario);
        var testTx = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account,
            null, scenario.Code, scenario.Code, "in", 100000, "SYN-POLL-" + Guid.NewGuid(), null, null);
        var liveTx = testTx with { Id = Guid.NewGuid().ToString(), Code = live.Code, Content = live.Code, ReferenceCode = "SYN-POLL-" + Guid.NewGuid() };
        using var host = scenario.Host.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
            services.AddScoped<ISePayTransactionClient>(p => new ModePollingClient(p.GetRequiredService<SePayOptions>().Mode, testTx, liveTx))));
        await using var scope = host.Services.CreateAsyncScope();
        var handlers = scope.ServiceProvider.GetServices<IBackgroundJobHandler>().Where(h => h.Name is "sepay-poll-test" or "sepay-poll-live").ToArray();
        Assert.Equal(2, handlers.Length);
        foreach (var handler in handlers)
        {
            Assert.True(handler.Enabled);
            for (var repeat = 0; repeat < 2; repeat++)
                await handler.ExecuteAsync(new JobExecution(Guid.NewGuid(), "synthetic-mode-poll", "{}"), default);
        }
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Equal(2, await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM operational_tasks WHERE source_key IN ('sepay-sync:Test','sepay-sync:Live')
            """).SingleAsync());
        foreach (var invoice in new[] { scenario.Invoice, live.ObligationId })
            Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == invoice).SumAsync(a => a.Amount));
    }

    [CompactPostgresFact]
    public async Task ModeSwitchPreservesOldQrAndAccountsAndReconcilesBothModes()
    {
        await using var scenario = await Create(dualMode: true);
        using var owner = await scenario.Client(scenario.Owner);
        const string modeRoute = "/api/v1/receiving-bank-accounts/owner/mode";
        Assert.Equal("Test", (await owner.GetFromJsonAsync<PaymentModeView>(modeRoute))!.Mode);
        foreach (var demo in new[] { true, false })
        {
            var accountRoute = "/api/v1/receiving-bank-accounts/owner/" + (demo ? "Test" : "Live");
            var current = await owner.GetFromJsonAsync<ReceivingBankAccount>(accountRoute);
            var result = await owner.PutAsJsonAsync("/api/v1/receiving-bank-accounts/owner",
                new OwnerReceivingAccountInput("970416", Account, demo ? "SYNTHETIC TEST" : "SYNTHETIC LIVE", true, demo, true, current?.Version ?? 0));
            Assert.True(result.IsSuccessStatusCode, await result.Content.ReadAsStringAsync());
        }
        var before = await owner.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{scenario.Invoice}/transfer-instructions");
        Assert.True(before!.IsDevelopmentDemo);
        Assert.Matches("^BHCI01T[A-F0-9]{16}$", before.TransferReference);
        (await owner.PutAsJsonAsync(modeRoute, new PaymentModeInput("Live", "Test"))).EnsureSuccessStatusCode();
        Assert.False((await owner.GetFromJsonAsync<ReceivingBankAccount>("/api/v1/receiving-bank-accounts/owner"))!.IsDevelopmentDemo);
        var after = await owner.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{scenario.Invoice}/transfer-instructions");
        Assert.Equal(before, after);
        var live = await NewModeInvoice(scenario);
        Assert.Equal("Live", live.Mode);
        Assert.Matches("^BHCI01L[A-F0-9]{16}$", live.Code);
        Assert.False(live.AccountSnapshot!.IsDevelopmentDemo);
        // Genuine HTTP webhook authentication, followed by the same polling ingestion path.
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var tx = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account,
            null, live.Code, live.Code, "in", 100000, "SYN-LIVE-" + Guid.NewGuid(), null, null);
        var body = JsonSerializer.Serialize(tx, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret + "-live"), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        using var signed = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/Live/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        signed.Headers.Add("X-SePay-Timestamp", timestamp); signed.Headers.Add("X-SePay-Signature", signature);
        (await owner.SendAsync(signed)).EnsureSuccessStatusCode();
        await using (var polling = scenario.Host.Services.CreateAsyncScope())
        {
            polling.ServiceProvider.GetRequiredService<SePayOptions>().Select("Live");
            await polling.ServiceProvider.GetRequiredService<SePayService>().ReceiveAsync(tx with { Id = Guid.NewGuid().ToString() }, default);
            var store = polling.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
            Assert.Equal(100000m, await store.Set<PaymentAllocation>().Where(a => a.InvoiceId == live.ObligationId).SumAsync(a => a.Amount));
        }
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(modeRoute, new PaymentModeInput("Test", "Test"))).StatusCode);
        // The old Test receipt remains collectible while new obligations use Live.
        (await scenario.Send(40000)).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Equal(40000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).SumAsync(a => a.Amount));
        using var manual = new HttpRequestMessage(HttpMethod.Post, "/api/v1/payment-transactions")
        {
            Content = JsonContent.Create(new PaymentTransferInput("SYNTHETIC-MANUAL", "SYN-CROSS-MODE-" + Guid.NewGuid(), 60000,
                "VND", DateTimeOffset.UtcNow.AddSeconds(-1), scenario.Code, "Synthetic statement", "Synthetic Owner verification", scenario.Invoice, true))
        };
        manual.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var manualResponse = await owner.SendAsync(manual); manualResponse.EnsureSuccessStatusCode();
        var manualReceipt = (await manualResponse.Content.ReadFromJsonAsync<TransferView>())!;
        using var allocate = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/payment-transactions/{manualReceipt.Id}/allocate")
        { Content = JsonContent.Create(new PaymentMatchInput(scenario.Invoice, null, true)) };
        allocate.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        (await owner.SendAsync(allocate)).EnsureSuccessStatusCode();
        var registry = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        var snapshot = await registry.ContextAsync("Invoice", scenario.Invoice, default);
        Assert.Equal("Test", snapshot!.Mode);
        Assert.True(snapshot.AccountSnapshot!.IsDevelopmentDemo);
        Assert.Equal("CI01", snapshot.InstanceCode);
        var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == scenario.Invoice);
        var report = await scope.ServiceProvider.GetRequiredService<IFinancialReportRepository>().ReadAsync(
            new ReportFilter(invoice.BillingPeriod, invoice.BillingPeriod.AddMonths(2), scenario.Location), default);
        Assert.Equal(200000m, report.Locations.Single().Issued);
        Assert.Equal(200000m, report.Locations.Single().Collected);
        (await owner.PutAsJsonAsync(modeRoute, new PaymentModeInput("Test", "Live"))).EnsureSuccessStatusCode();
        Assert.True((await owner.GetFromJsonAsync<ReceivingBankAccount>("/api/v1/receiving-bank-accounts/owner"))!.IsDevelopmentDemo);
        using var tenant = await scenario.Client(scenario.Tenants[0]);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(modeRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PutAsJsonAsync(modeRoute, new PaymentModeInput("Live", "Test"))).StatusCode);
    }

    private static async Task<PaymentCode> NewModeInvoice(Scenario scenario, bool issueCode = true)
    {
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var original = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == scenario.Invoice);
        var invoice = new Invoice
        {
            LocationId = original.LocationId,
            RoomId = original.RoomId,
            RoomNumber = original.RoomNumber,
            LocationName = original.LocationName,
            RepresentativeContractId = original.RepresentativeContractId,
            RepresentativeTenantUserId = original.RepresentativeTenantUserId,
            BillingPeriod = original.BillingPeriod.AddMonths(1),
            Total = 100000,
            CreatedByUserId = scenario.Owner,
            ScheduledFinalDate = original.BillingPeriod.AddMonths(1),
            DueDate = original.DueDate.AddMonths(1),
            ScheduleSnapshot = "{}",
            Recipients = scenario.Tenants.Select(id => new InvoiceRecipient { TenantUserId = id }).ToList(),
            Lines = [new InvoiceLine { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic Live", Rate = 100000, Quantity = 1, Amount = 100000, OccupiedDays = 30, PeriodDays = 30, RateDate = original.BillingPeriod.AddMonths(1) }]
        };
        db.Add(invoice); await db.SaveChangesAsync();
        invoice.Status = InvoiceStatus.Final; invoice.FinalizedByUserId = scenario.Owner; invoice.FinalizedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync();
        if (!issueCode) return new("", "", "Invoice", invoice.Id, invoice.LocationId);
        var codes = scope.ServiceProvider.GetRequiredService<IPaymentCodeRegistry>();
        Assert.NotNull(await codes.IssueAsync("Invoice", invoice.Id, invoice.LocationId, default));
        return (await codes.ContextAsync("Invoice", invoice.Id, default))!;
    }

    [CompactPostgresFact]
    public async Task ModeSpecificWebhookRejectsOtherSecretAndForeignInstanceWithoutFinancialEffect()
    {
        await using var scenario = await Create(dualMode: true);
        using var client = scenario.Anonymous();
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var body = JsonSerializer.Serialize(new
        {
            id = 59123,
            gateway = "ACB",
            transactionDate = scenario.TransactionDate,
            accountNumber = Account,
            code = scenario.Code,
            content = scenario.Code,
            transferType = "in",
            transferAmount = 100000,
            referenceCode = "SYN-MODE-59123"
        });
        var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/Live/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-SePay-Timestamp", timestamp); request.Headers.Add("X-SePay-Signature", signature);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(request)).StatusCode);
        (await scenario.Send(100000, code: "BHPRODL0123456789ABCDEF")).EnsureSuccessStatusCode();
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Empty(await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).ToArrayAsync());
        Assert.Empty(await db.Set<PaymentTransfer>().Where(p => p.TransferDescription.Contains("BHPRODL")).ToArrayAsync());
    }
}
