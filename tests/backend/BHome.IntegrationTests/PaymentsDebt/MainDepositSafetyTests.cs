using System.Net;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task DirectMainDepositCannotExceedAgreedFundsUnderConcurrentVerification()
    {
        var w = await Setup();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            (await db.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).RequiredDeposit = 100000;
            await db.SaveChangesAsync();
        }
        using var owner = await Client(w.Owner); using var tenant = await Client(w.Tenants[0]); using var staff = await Client(w.Staff);
        var route = $"/api/v1/contracts/{w.Contract}/deposit-verifications";
        var first = new DepositInput("SYN-MAIN-" + Guid.NewGuid(), 60000, "Synthetic verified receipt");
        var second = first with { BankTransactionReference = "SYN-MAIN-" + Guid.NewGuid() };
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(tenant, route, first)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(staff, route, first)).StatusCode);
        var results = await Task.WhenAll(Post(owner, route, first), Post(owner, route, second));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Contains("main_deposit_excess_requires_manual_review", await Assert.Single(results, r => r.StatusCode == HttpStatusCode.Conflict).Content.ReadAsStringAsync());
        var key = Guid.NewGuid(); var remainder = new DepositInput("SYN-REST-" + Guid.NewGuid(), 40000, "Synthetic verified remainder");
        var saved = await RefundValue<ContractId>(await Post(owner, route, remainder, key));
        Assert.Equal(saved, await RefundValue<ContractId>(await Post(owner, route, remainder, key)));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, remainder with { Amount = 39999 }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, first with { BankTransactionReference = "SYN-EXTRA-" + Guid.NewGuid(), Amount = 1 })).StatusCode);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(100000, await finalDb.Database.SqlQuery<decimal>($"SELECT sum(amount) AS \"Value\" FROM payment_allocations WHERE target_deposit_contract_id={w.Contract}").SingleAsync());
        Assert.Equal(2, await finalDb.Set<DepositVerification>().CountAsync(d => d.ContractId == w.Contract));
        Assert.Equal(2, await finalDb.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id WHERE a.target_deposit_contract_id={w.Contract}").SingleAsync());
        (await finalDb.Set<Contract>().SingleAsync(c => c.Id == w.Contract)).Status = ContractStatus.Cancelled;
        await finalDb.SaveChangesAsync();
        Assert.Equal(saved, await RefundValue<ContractId>(await Post(owner, route, remainder, key)));
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route, first with { BankTransactionReference = "SYN-CLOSED-" + Guid.NewGuid() })).StatusCode);
    }
}
