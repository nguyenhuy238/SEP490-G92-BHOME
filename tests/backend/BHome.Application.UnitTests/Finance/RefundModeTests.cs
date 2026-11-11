using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.Storage;

namespace BHome.Application.UnitTests.Finance;

public sealed class RefundModeTests
{
    [Fact]
    public async Task ProductionRefusesMutationOfDevelopmentReceiptEvenForOwner()
    {
        var repo = new Source(); var service = new RefundService(repo, new NoStorage(), new NoImages(), new User("Owner"), TimeProvider.System, new(false));
        var error = await Assert.ThrowsAsync<FinanceException>(() => service.CreateAsync(Guid.NewGuid(), new(repo.Person, 100, "Synthetic", true), Guid.NewGuid(), default));
        Assert.Equal(409, error.Status); Assert.Equal("development_payment_unavailable", error.Code); Assert.Equal(0, repo.Writes);
    }
    [Fact]
    public async Task DepositRequiresExplicitBeneficiaryAndZeroDeductionAttestationAndRejectsProductionDemo()
    {
        var repo = new Source(); var service = new RefundService(repo, new NoStorage(), new NoImages(), new User("Owner"), TimeProvider.System, new(false));
        var input = new DepositRefundInput(new(repo.Person, 100, "Synthetic verified depositor", true), "DEPOSIT-test", true, true);
        var missing = await Assert.ThrowsAsync<FinanceException>(() => service.CreateDepositAsync(Guid.NewGuid(), input with { BeneficiaryVerified = false }, Guid.NewGuid(), default));
        Assert.Equal("deposit_refund_confirmation_required", missing.Code); Assert.Equal(0, repo.Reads);
        var error = await Assert.ThrowsAsync<FinanceException>(() => service.CreateDepositAsync(Guid.NewGuid(), input, Guid.NewGuid(), default));
        Assert.Equal("development_payment_unavailable", error.Code); Assert.Equal(0, repo.Writes);
    }
    [Theory]
    [InlineData("Staff")]
    [InlineData("Tenant")]
    public async Task NonOwnerCannotAccessSourceEvenThroughDirectService(string role)
    {
        var repo = new Source(); var service = new RefundService(repo, new NoStorage(), new NoImages(), new User(role), TimeProvider.System, new(true));
        var error = await Assert.ThrowsAsync<FinanceException>(() => service.SourceAsync(Guid.NewGuid(), default));
        Assert.Equal(403, error.Status); Assert.Equal(0, repo.Reads);
        var deposit = await Assert.ThrowsAsync<FinanceException>(() => service.DepositSourceAsync(Guid.NewGuid(), default));
        Assert.Equal(403, deposit.Status); Assert.Equal(0, repo.Reads);
    }
    private sealed class User(string role) : ICurrentUser
    { public Guid? UserId => Guid.Parse("00000000-0000-0000-0000-000000000123"); public bool IsInRole(string value) => role == value; }
    [Fact]
    public async Task SecurityDepositRecordsOwnerConfirmedContractAgreementWithoutChangingReceiptActualPayerBasis()
    {
        var repo = new Source();
        var service = new RefundService(repo, new NoStorage(), new NoImages(), new User("Owner"), TimeProvider.System, new(true));
        var contract = Guid.NewGuid();
        await service.CreateDepositAsync(contract,
            new(new(repo.Person, 100, "Synthetic recipient agreed in Contract", true), "DEPOSIT-test", true, true), Guid.NewGuid(), default);
        Assert.Equal("CONTRACT_AGREEMENT_OWNER_CONFIRMED", repo.Saved!.State.BeneficiaryBasis);
        Assert.Equal(contract, repo.Saved.State.SettlementContractId);
        Assert.Equal(repo.Person, repo.Saved.BeneficiaryResidentId);
        Assert.True(repo.Saved.State.BeneficiaryVerified);
        await service.CreateAsync(Guid.NewGuid(), new(repo.Person, 100, "Synthetic actual payer excess", true), Guid.NewGuid(), default);
        Assert.Null(repo.Saved!.State.BeneficiaryBasis);
        Assert.Equal("ExcessReceiptRefundV1", repo.Saved.State.Classification);
    }
    [Theory]
    [InlineData("Owner", 1, 20, 403)]
    [InlineData("Staff", 1, 20, 403)]
    [InlineData("Tenant", 0, 20, 400)]
    [InlineData("Tenant", 1, 101, 400)]
    [InlineData("Tenant", int.MaxValue, 100, 400)]
    public async Task TenantRefundReadsEnforceRoleAndPaginationBeforeRepository(string role, int page, int size, int status)
    {
        var service = new RefundService(new Source(), new NoStorage(), new NoImages(), new User(role), TimeProvider.System);
        var error = await Assert.ThrowsAsync<FinanceException>(() => service.TenantListAsync(page, size, default));
        Assert.Equal(status, error.Status);
    }
    // Explicit storage/provider boundaries. None should be called by these rejection cases.
    private sealed class NoStorage : IObjectStorage
    {
        public Task PutAsync(string key, Stream data, long length, string type, CancellationToken t) => throw new InvalidOperationException();
        public Task CopyToAsync(string key, Stream output, CancellationToken t) => throw new InvalidOperationException();
        public Task DeleteAsync(string key, CancellationToken t) => throw new InvalidOperationException();
    }
    private sealed class NoImages : IContractImageValidator
    { public string Validate(byte[] bytes) => throw new InvalidOperationException(); }
    private sealed class Source : IRefundRepository
    {
        public Task<BHome.Application.PropertyManagement.PagedResult<TenantRefundView>> TenantListAsync(Guid tenant, int page, int pageSize, CancellationToken t) => throw new InvalidOperationException();
        public Guid Person { get; } = Guid.NewGuid(); public int Writes; public int Reads;
        public RefundRecord? Saved { get; private set; }
        public Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken t) => work();
        public Task<RefundSourceData> SourceAsync(Guid id, CancellationToken t)
        { Reads++; return Task.FromResult(new RefundSourceData(100, true, [new(Person, "Synthetic")], [])); }
        public async Task<RefundSourceData> DepositSourceAsync(Guid id, CancellationToken t) => (await SourceAsync(id, t)) with
        { DepositContractId = id, FinancialReference = "DEPOSIT-test", AvailableDeposit = 100 };
        public Task<RefundRecord?> OperationAsync(Guid key, CancellationToken t) => Task.FromResult<RefundRecord?>(null);
        public Task<RefundRecord> GetAsync(Guid id, CancellationToken t) => throw new InvalidOperationException();
        public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken t) => throw new InvalidOperationException();
        public Task SaveAsync(RefundRecord record, bool create, Guid actor, string action, DateTimeOffset now, CancellationToken t)
        { Saved = record; Writes++; return Task.CompletedTask; }
    }
}
