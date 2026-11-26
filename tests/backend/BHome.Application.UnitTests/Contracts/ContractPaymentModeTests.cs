using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class ContractPaymentModeTests
{
    [Theory]
    [InlineData(true, "Live")]
    [InlineData(false, "Test")]
    [InlineData(true, "Test")]
    [InlineData(false, "Live")]
    public async Task NewSettlementUsesSelectedReceivingModeAndReplayPreservesItsIssuedMode(bool oldContractTest, string selected)
    {
        var id = Guid.NewGuid(); var actor = Guid.NewGuid(); var location = Guid.NewGuid();
        var inspection = Guid.NewGuid(); var photo = Guid.NewGuid(); var key = Guid.NewGuid();
        var repository = Substitute.For<ISettlementReceivablesRepository>();
        var payments = Substitute.For<IPaymentRepository>(); var evidence = Substitute.For<IDepositDeductionEvidence>();
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(actor); user.IsInRole("Owner").Returns(true);
        repository.CanReadAsync(id, actor, true, default).Returns(true);
        repository.LocationAsync(id, default).Returns(location);
        repository.ContextAsync(id, default).Returns(new SettlementChargeContext(new(id, Guid.NewGuid(), "SYN", 0, [], []),
            id, inspection, 1, true, false, [], [photo], [actor], false, oldContractTest));
        repository.TransactionAsync(id, Arg.Any<Func<Task<SettlementReceivable>>>(), default)
            .Returns(call => call.Arg<Func<Task<SettlementReceivable>>>()());
        evidence.CaptureAsync(id, Arg.Any<Guid[]>(), default).Returns([new DeductionEvidence(photo, 100, "synthetic-sha")]);
        payments.ReceivingOwnerAsync(location, default).Returns(actor);
        payments.OwnerPaymentModeAsync(actor, default).Returns(selected);
        var service = new SettlementReceivablesService(repository, evidence, user, TimeProvider.System,
            new PaymentRuntimeMode(false, true), payments, sepay: new SePayOptions());
        var input = new DamageChargeInput("SYN", inspection, 1, null, 100, "Synthetic observed damage", [photo], true);
        var charge = await service.ApproveDamageAsync(id, input, key, default);
        Assert.Equal(selected, charge.PaymentMode); Assert.Equal(selected == "Test", charge.IsDevelopmentDemo);
        repository.ChargeOperationAsync(actor, key, default).Returns(charge);
        payments.OwnerPaymentModeAsync(actor, default).Returns(selected == "Test" ? "Live" : "Test");
        Assert.Equal(charge, await service.ApproveDamageAsync(id, input, key, default));
        await repository.Received(1).SaveChargeAsync(charge, default);
    }
    [Theory]
    [InlineData(true, "Live")]
    [InlineData(false, "Test")]
    [InlineData(true, "Test")]
    [InlineData(false, "Live")]
    public async Task DepositOffsetUsesSameBusinessRulesAcrossReceivingModes(bool testDeposit, string invoiceMode)
    {
        var id = Guid.NewGuid(); var invoice = Guid.NewGuid(); var actor = Guid.NewGuid();
        var repository = Substitute.For<ISettlementReceivablesRepository>();
        var codes = Substitute.For<IPaymentCodeRegistry>(); var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(actor); user.IsInRole("Owner").Returns(true);
        repository.CanReadAsync(id, actor, true, default).Returns(true);
        repository.ContextAsync(id, default).Returns(new SettlementChargeContext(new(id, Guid.NewGuid(), "SYN", 100, [], []),
            id, Guid.NewGuid(), 1, true, false, [], [], [], false, testDeposit));
        repository.InvoiceOutstandingAsync(id, invoice, default).Returns(100m);
        repository.TransactionAsync(id, Arg.Any<Func<Task<DepositOffsetApproval>>>(), default)
            .Returns(call => call.Arg<Func<Task<DepositOffsetApproval>>>()());
        codes.PersistedModeAsync("Invoice", invoice, default).Returns(invoiceMode);
        var service = new SettlementReceivablesService(repository, Substitute.For<IDepositDeductionEvidence>(), user,
            TimeProvider.System, new PaymentRuntimeMode(true, true), paymentCodes: codes);
        var input = new DepositOffsetInput("SYN", null, invoice, 100, "Synthetic offset", true);
        Assert.Equal(testDeposit, (await service.ApproveOffsetAsync(id, input, Guid.NewGuid(), default)).IsDevelopmentDemo);
        await repository.Received(1).SaveOffsetAsync(Arg.Is<DepositOffsetApproval>(a => a.Amount == 100), default);
    }

    [Theory]
    [InlineData("Test", "Live")]
    [InlineData("Live", "Test")]
    public async Task SelectedOwnerModeIsFrozenBeforeLocationReceivingBindingExists(string selected, string initial)
    {
        var owner = Guid.NewGuid();
        var accounts = Substitute.For<IPaymentRepository>();
        accounts.OwnerPaymentModeAsync(owner, default).Returns(selected);
        var options = new SePayOptions { Enabled = true, Mode = initial, Test = new() { Enabled = true }, Live = new() { Enabled = true } };
        Assert.Equal(selected, await ContractPaymentModes.ConfiguredAsync(options, accounts, Guid.NewGuid(), owner, default));
    }

    [Fact]
    public async Task FlatUnboundConfigurationRetainsLegacyNullMode()
    {
        Assert.Null(await ContractPaymentModes.ConfiguredAsync(new SePayOptions { Enabled = true }, null, Guid.NewGuid(), Guid.NewGuid(), default));
    }
}
