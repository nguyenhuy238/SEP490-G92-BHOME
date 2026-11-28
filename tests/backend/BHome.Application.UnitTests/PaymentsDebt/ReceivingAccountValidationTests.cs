using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.Contracts;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using NSubstitute;

namespace BHome.Application.UnitTests.PaymentsDebt;

public sealed class ReceivingAccountValidationTests
{
    private sealed class Workspace
    {
        public readonly Guid Owner = Guid.NewGuid();
        public readonly IPaymentRepository Repository = Substitute.For<IPaymentRepository>();
        public readonly ICurrentUser User = Substitute.For<ICurrentUser>();
        public TransferInstructionsService Service(bool allowDemo, bool allowSandboxAccounts = false,
            IHoldingTestScope? holdingTestScope = null, SePayOptions? sepay = null)
        {
            User.UserId.Returns(Owner);
            User.IsInRole(Roles.Owner).Returns(true);
            Repository.TransactionAsync<ReceivingBankAccount>(Arg.Any<Guid?>(), Arg.Any<Guid?>(),
                Arg.Any<Func<Task<ReceivingBankAccount>>>(), Arg.Any<CancellationToken>())
                .Returns(call => call.ArgAt<Func<Task<ReceivingBankAccount>>>(2)());
            Repository.ActiveLocationAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
            Repository.ReceivingOwnerAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(Owner);
            return new(Repository, new PaymentService(Repository, User, TimeProvider.System), User,
                Substitute.For<ITransferQrGenerator>(), new PaymentRuntimeMode(allowDemo, allowSandboxAccounts), TimeProvider.System,
                sepay: sepay, holdingTestScope: holdingTestScope);
        }
    }

    private static OwnerReceivingAccountInput Input(bool demo = true) =>
        new("970415", "000000000000", "SYNTHETIC OWNER", true, demo, true, 0);

    [Fact]
    public async Task OwnerCanConfigureTestReceivingAccountBeforeProviderIsEnabledOnAnyHost()
    {
        var w = new Workspace();
        var result = await w.Service(false).SaveOwnerAccountAsync(Input(), default);
        Assert.True(result.IsDevelopmentDemo);
        Assert.Equal(w.Owner, result.OwnerUserId);
        Assert.Equal(1, result.Version);
        await w.Repository.Received(1).SaveOwnerReceivingAccountAsync(w.Owner, result, 0, default);
    }

    [Fact]
    public async Task LocationDemoUsesTheSameEnvironmentErrorWithoutWriting()
    {
        var w = new Workspace();
        var error = await Assert.ThrowsAsync<PaymentException>(() => w.Service(false).SaveAccountAsync(
            new(Guid.NewGuid(), "970415", "000000000000", "SYNTHETIC OWNER", true, true, true, 0), default));
        Assert.Equal("sandbox_receiving_account_unavailable", error.Code);
        Assert.Empty(w.Repository.ReceivedCalls());
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    public async Task PermittedAccountSavesOwnerVersionAndAudit(bool allowDemo, bool demo)
    {
        var w = new Workspace();
        var result = await w.Service(allowDemo).SaveOwnerAccountAsync(Input(demo), default);
        Assert.Equal(w.Owner, result.OwnerUserId);
        Assert.Equal(demo, result.IsDevelopmentDemo);
        Assert.Equal(1, result.Version);
        Assert.Equal(w.Owner, result.ConfirmedByUserId);
        await w.Repository.Received(1).SaveOwnerReceivingAccountAsync(w.Owner, result, 0, default);
        await w.Repository.Received(1).AuditAsync(w.Owner, "OwnerReceivingBankAccountConfigured", result.Id, result.ConfirmedAt, default);
    }

    [Fact]
    public async Task StagingSandboxCanSaveDemoOwnerAccountWithoutRemovingItsDemoMarker()
    {
        var w = new Workspace();
        var result = await w.Service(false, true).SaveOwnerAccountAsync(Input(), default);
        Assert.True(result.IsDevelopmentDemo);
        Assert.Equal(w.Owner, result.OwnerUserId);
        Assert.Equal(1, result.Version);
        await w.Repository.Received(1).SaveOwnerReceivingAccountAsync(w.Owner, result, 0, default);
        await w.Repository.Received(1).AuditAsync(w.Owner, "OwnerReceivingBankAccountConfigured", result.Id, result.ConfirmedAt, default);
    }

    [Fact]
    public async Task StagingSandboxCanSaveDemoLocationAccountWithOwnerScope()
    {
        var w = new Workspace(); var location = Guid.NewGuid();
        var scope = Substitute.For<IHoldingTestScope>();
        scope.Allows(location).Returns(true);
        var result = await w.Service(false, true, scope,
            new SePayOptions { ReceivingAccounts = [new() { LocationId = location, BankIdentifier = "970415", AccountNumber = "000000000000" }] }).SaveAccountAsync(
            new(location, "970415", "000000000000", "SYNTHETIC OWNER", true, true, true, 0), default);
        Assert.True(result.IsDevelopmentDemo);
        Assert.Equal(location, result.LocationId);
        await w.Repository.Received(1).AddAsync(result, default);
        await w.Repository.Received(1).ReceivingOwnerAsync(location, default);
    }

    [Theory]
    [InlineData("123", "000000000000", "SYNTHETIC OWNER", true)]
    [InlineData("970415", "123", "SYNTHETIC OWNER", true)]
    [InlineData("970415", "000000000000", "invalid holder", true)]
    [InlineData("970415", "000000000000", "SYNTHETIC OWNER", false)]
    public async Task InvalidFieldsOrMissingApprovalKeepValidationError(string bank, string number, string holder, bool approved)
    {
        var w = new Workspace();
        var error = await Assert.ThrowsAsync<PaymentException>(() => w.Service(false).SaveOwnerAccountAsync(
            Input(false) with { BankIdentifier = bank, AccountNumber = number, AccountHolder = holder, HumanVerified = approved }, default));
        Assert.Equal("invalid_receiving_bank_account", error.Code);
        Assert.Empty(w.Repository.ReceivedCalls());
    }

    [Fact]
    public async Task NonOwnerCannotReachAccountValidation()
    {
        var w = new Workspace(); var service = w.Service(false);
        w.User.IsInRole(Roles.Owner).Returns(false);
        var error = await Assert.ThrowsAsync<PaymentException>(() => service.SaveOwnerAccountAsync(Input(), default));
        Assert.Equal(403, error.Status);
        Assert.Empty(w.Repository.ReceivedCalls());
    }
}
