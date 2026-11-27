using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

internal sealed record DepositAgreementBrowserFixture(Guid ContractId, Guid BeneficiaryResidentId, string OwnerEmail,
    Guid BeneficiaryUserId, Guid RepresentativeUserId);

public sealed partial class PaymentLedgerTests
{
    internal async Task<DepositAgreementBrowserFixture> PrepareDepositAgreementBrowserAsync()
    {
        var w = await Setup(sharedContract: true); await ReadySettlementFixture(w, false, agreedDeposit: 400000);
        using var owner = await Client(w.Owner);
        await RefundValue<ContractId>(await Post(owner, $"/api/v1/contracts/{w.Contract}/deposit-verifications",
            new DepositInput("SYN-BROWSER-" + Guid.NewGuid(), 400000, "Synthetic verified principal; no real bank")));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var person = await db.Set<Resident>().SingleAsync(r => r.TenantUserId == w.Tenants[1]);
        person.DisplayLabel = "SYNTHETIC AGREED RECIPIENT";
        await db.SaveChangesAsync();
        var email = await db.Users.Where(u => u.Id == w.Owner).Select(u => u.Email!).SingleAsync();
        var source = await RefundValue<RefundSource>(await owner.GetAsync($"/api/v1/contracts/{w.Contract}/deposit-refunds"));
        Assert.Empty(source.Blockers!); Assert.Equal(400000, source.AvailableAmount);
        return new(w.Contract, person.Id, email, w.Tenants[1], w.Tenants[0]);
    }
}
