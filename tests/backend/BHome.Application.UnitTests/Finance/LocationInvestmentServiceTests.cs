using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using NSubstitute;

namespace BHome.Application.UnitTests.Finance;

public sealed class LocationInvestmentServiceTests
{
    private readonly IExpenseRepository repository = Substitute.For<IExpenseRepository>();
    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly Guid ownerId = Guid.NewGuid();
    private readonly Guid locationId = Guid.NewGuid();

    private ExpenseService Service()
    {
        user.UserId.Returns(ownerId);
        user.IsInRole(Roles.Owner).Returns(true);
        repository.ValidScopeAsync(locationId, null, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(true));
        repository.CreateInvestmentsAsync(
                Arg.Any<IReadOnlyList<ExpenseInput>>(), Arg.Any<Guid>(),
                Arg.Any<Guid>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<ExpenseView>>([]));
        return new ExpenseService(repository, user, TimeProvider.System);
    }

    [Fact]
    public async Task BatchInvestmentPreservesLocationAndAmountsInOneRepositoryCall()
    {
        var service = Service();
        var key = Guid.NewGuid();
        var date = new DateOnly(2026, 11, 1);
        var input = new BulkInvestmentInput(locationId, date,
        [
            new("Sửa chữa ban đầu", 15_000_000m, "Chứng từ A"),
            new("Phí pháp lý", 2_500_000m, "Chứng từ B")
        ]);

        var response = await service.CreateInvestmentsAsync(input, key, CancellationToken.None);

        Assert.Empty(response);
        await repository.Received(1).CreateInvestmentsAsync(
            Arg.Is<IReadOnlyList<ExpenseInput>>(items =>
                items.Count == 2 &&
                items.All(i => i.LocationId == locationId &&
                    i.RoomId == null && i.AssetId == null && i.TaskId == null &&
                    i.OccurredOn == date && i.ExpenseType == "INITIAL_INVESTMENT") &&
                items[0].Amount == 15_000_000m && items[1].Amount == 2_500_000m &&
                items[0].Note == "Chứng từ A" && items[1].Note == "Chứng từ B"),
            ownerId, key, Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-100)]
    [InlineData(100.50)]
    public async Task InvalidLinePreventsAnyBatchWrite(decimal amount)
    {
        var service = Service();
        var input = new BulkInvestmentInput(locationId, new DateOnly(2026, 11, 1),
            [new("Đầu tư hợp lệ", 100_000m, "Chứng từ A"),
             new("Đầu tư sai", amount, "Chứng từ B")]);

        var error = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateInvestmentsAsync(input, Guid.NewGuid(), CancellationToken.None));
        Assert.Equal(400, error.Status);
        await repository.DidNotReceive().CreateInvestmentsAsync(
            Arg.Any<IReadOnlyList<ExpenseInput>>(), Arg.Any<Guid>(), Arg.Any<Guid>(),
            Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MissingIdempotencyKeyAndEmptyBatchAreRejected()
    {
        var service = Service();
        var input = new BulkInvestmentInput(locationId, new DateOnly(2026, 11, 1),
            [new("Vốn", 100_000m, "Chứng từ")]);
        var keyError = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateInvestmentsAsync(input, Guid.Empty, CancellationToken.None));
        Assert.Equal("idempotency_key_required", keyError.Code);

        var batchError = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateInvestmentsAsync(input with { Items = [] }, Guid.NewGuid(), CancellationToken.None));
        Assert.Equal("invalid_investment_batch", batchError.Code);
        await repository.DidNotReceive().CreateInvestmentsAsync(
            Arg.Any<IReadOnlyList<ExpenseInput>>(), Arg.Any<Guid>(), Arg.Any<Guid>(),
            Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task NonOwnerCannotCreateOrListLocationInvestments()
    {
        var service = Service();
        user.IsInRole(Roles.Owner).Returns(false);
        var input = new BulkInvestmentInput(locationId, new DateOnly(2026, 11, 1),
            [new("Vốn", 100_000m, "Chứng từ")]);

        var createError = await Assert.ThrowsAsync<FinanceException>(() =>
            service.CreateInvestmentsAsync(input, Guid.NewGuid(), CancellationToken.None));
        var listError = await Assert.ThrowsAsync<FinanceException>(async () =>
            await service.ListInvestmentsAsync(new ExpenseFilter(LocationId: locationId), CancellationToken.None));
        Assert.Equal(403, createError.Status);
        Assert.Equal(403, listError.Status);
        await repository.DidNotReceive().CreateInvestmentsAsync(
            Arg.Any<IReadOnlyList<ExpenseInput>>(), Arg.Any<Guid>(), Arg.Any<Guid>(),
            Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }
}
