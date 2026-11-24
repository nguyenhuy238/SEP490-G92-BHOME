using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using NSubstitute;

namespace BHome.Application.UnitTests.PaymentsDebt;

public sealed class ReceivingAccountTests
{
    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, true, false)]
    [InlineData(true, false, true)]
    [InlineData(false, true, true)]
    public async Task SandboxAccountRequiresOwnerScopeAndMatchingProviderBinding(bool owner, bool allowed, bool matches)
    {
        var location = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(actor);
        user.IsInRole(Roles.Owner).Returns(owner);
        var scope = Substitute.For<IHoldingTestScope>();
        scope.Allows(location).Returns(allowed);
        var repository = Substitute.For<IPaymentRepository>();
        repository.ActiveLocationAsync(location, default).Returns(true);
        repository.TransactionAsync(null, null, Arg.Any<Func<Task<ReceivingBankAccount>>>(), default)
            .Returns(call => call.Arg<Func<Task<ReceivingBankAccount>>>()());
        var options = new SePayOptions
        {
            ReceivingAccounts = [new() { LocationId = location, BankIdentifier = "970422", AccountNumber = "0000000001" }]
        };
        var service = new TransferInstructionsService(repository, null!, user, null!, new(false), TimeProvider.System,
            sepay: options, holdingTestScope: scope);
        var input = new ReceivingAccountInput(location, "970422", matches ? "0000000001" : "0000000002", "TEST ACCOUNT",
            true, true, true, 0);

        if (owner && allowed && matches)
        {
            var saved = await service.SaveAccountAsync(input, default);
            Assert.True(saved.IsDevelopmentDemo);
            Assert.Equal(actor, saved.ConfirmedByUserId);
            Assert.Equal(1, saved.Version);
            return;
        }

        var error = await Assert.ThrowsAsync<PaymentException>(async () => await service.SaveAccountAsync(input, default));
        Assert.Equal(owner ? "sandbox_receiving_account_unavailable" : "payment_owner_required", error.Code);
    }
}
