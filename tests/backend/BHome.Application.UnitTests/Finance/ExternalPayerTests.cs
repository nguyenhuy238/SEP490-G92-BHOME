using System.Text.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using NSubstitute;

namespace BHome.Application.UnitTests.Finance;
public sealed class ExternalPayerTests
{
    [Theory]
    [InlineData("Staff")]
    [InlineData("Tenant")]
    public async Task ExternalPayerMetadataIsOwnerOnlyBeforeAnyLookup(string role)
    {
        var repo = Substitute.For<IExternalPaymentPayerRepository>(); var payments = Substitute.For<IPaymentRepository>();
        var user = Substitute.For<ICurrentUser>(); user.UserId.Returns(Guid.NewGuid()); user.IsInRole(role).Returns(true);
        var service = new ExternalPaymentPayerService(repo, payments, user, TimeProvider.System);
        Assert.Equal(403, (await Assert.ThrowsAsync<PaymentException>(() => service.ContextAsync(Guid.NewGuid(), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<PaymentException>(() => service.ConfirmAsync(Guid.NewGuid(), new("fp", "Synthetic", "Synthetic", true, true), Guid.NewGuid(), default))).Status);
        Assert.Empty(repo.ReceivedCalls()); Assert.Empty(payments.ReceivedCalls());
    }
    [Fact]
    public void ExistingResidentRefundInputKeepsItsHistoricalFingerprintWireShape()
    {
        var input = new RefundInput(Guid.NewGuid(), 10000, "Synthetic historical input", true);
        var json = JsonSerializer.SerializeToElement(input);
        Assert.Equal(new[] { "BeneficiaryResidentId", "Amount", "Reason", "HumanConfirmed" }, json.EnumerateObject().Select(p => p.Name));
        Assert.Equal("10000", json.GetProperty("Amount").GetString());
    }
}
