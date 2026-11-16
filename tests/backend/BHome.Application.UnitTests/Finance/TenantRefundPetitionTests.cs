using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;

namespace BHome.Application.UnitTests.Finance;

public sealed class TenantRefundPetitionTests
{
    private static readonly Guid TenantId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    private static readonly Guid OtherTenantId = Guid.Parse("00000000-0000-0000-0000-000000000102");
    private static readonly Guid OwnerId = Guid.Parse("00000000-0000-0000-0000-000000000103");
    private static readonly DateTimeOffset Today = new(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task TenantMayRequestUnlinkedRefundAndOwnerRejectsWithReason()
    {
        var repository = new InMemoryRepository();
        var tenant = Create(repository, TenantId, "Tenant");
        var owner = Create(repository, OwnerId, "Owner");

        var key = Guid.NewGuid();
        var created = await tenant.CreateAsync(new(125000, "Yêu cầu đối chiếu khoản hoàn"), key, default);
        Assert.Equal("REQUESTED", created.Status);
        Assert.Null(created.SourcePaymentId);
        Assert.Null(created.SourceContractId);
        Assert.Equal("125000", created.Amount.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Null(created.TenantLabel);
        Assert.Single((await tenant.TenantListAsync(1, 10, default)).Items);
        Assert.Single((await owner.OwnerListAsync(1, 10, default)).Items);
        Assert.Equal(created.Id, (await tenant.CreateAsync(new(125000, "Yêu cầu đối chiếu khoản hoàn"), key, default)).Id);

        var bad = await Assert.ThrowsAsync<FinanceException>(() =>
            owner.DecideAsync(created.Id, new(1, false, "", true), Guid.NewGuid(), default));
        Assert.Equal("invalid_refund_reason", bad.Code);
        var rejected = await owner.DecideAsync(created.Id,
            new(1, false, "Không có căn cứ hoàn khoản đã thanh toán", true), Guid.NewGuid(), default);
        Assert.Equal("REJECTED", rejected.Status);
        Assert.Equal(2, rejected.Version);
        var mine = Assert.Single((await tenant.TenantListAsync(1, 10, default)).Items);
        Assert.Contains("Không có căn cứ", mine.DecisionReason);
        Assert.False(mine.HasEvidence);
        var conflict = await Assert.ThrowsAsync<FinanceException>(() =>
            owner.DecideAsync(created.Id, new(1, true, "Xem lại", true), Guid.NewGuid(), default));
        Assert.Equal("refund_changed", conflict.Code);
    }

    [Fact]
    public async Task OnlyTenantOwnedReferencesAcceptedAndDuplicateKeysCannotAlterRequest()
    {
        var repository = new InMemoryRepository();
        var tenant = Create(repository, TenantId, "Tenant");
        var badSource = await Assert.ThrowsAsync<FinanceException>(() =>
            tenant.CreateAsync(new(100, "Sai nguồn", Guid.NewGuid()), Guid.NewGuid(), default));
        Assert.Equal(404, badSource.Status);
        var badAmount = await Assert.ThrowsAsync<FinanceException>(() =>
            tenant.CreateAsync(new(0, "Số tiền không hợp lệ"), Guid.NewGuid(), default));
        Assert.Equal("invalid_refund_request", badAmount.Code);
        var key = Guid.NewGuid();
        var source = repository.Sources.Payments[0];
        var created = await tenant.CreateAsync(new(100, "Hoàn khoản chuyển dư", source.Id), key, default);
        Assert.Equal(source.Id, created.SourcePaymentId);
        var conflicting = await Assert.ThrowsAsync<FinanceException>(() =>
            tenant.CreateAsync(new(200, "Hoàn khoản chuyển dư", source.Id), key, default));
        Assert.Equal("refund_idempotency_conflict", conflicting.Code);
        Assert.Single((await tenant.TenantListAsync(1, 10, default)).Items);
        Assert.Empty((await Create(repository, OtherTenantId, "Tenant").TenantListAsync(1, 10, default)).Items);
        var notTenant = await Assert.ThrowsAsync<FinanceException>(() =>
            Create(repository, OwnerId, "Owner").CreateAsync(new(100, "Other"), Guid.NewGuid(), default));
        Assert.Equal(403, notTenant.Status);
    }

    [Fact]
    public async Task CompletedTransferProofIsVisibleOnlyToBeneficiaryAndRequiresOwnerConfirmation()
    {
        var repository = new InMemoryRepository();
        var storage = new InMemoryStorage();
        var tenant = Create(repository, TenantId, "Tenant", storage);
        var owner = Create(repository, OwnerId, "Owner", storage);
        var created = await tenant.CreateAsync(new(40000, "Hoàn nhầm khoản thu"), Guid.NewGuid(), default);
        var approved = await owner.DecideAsync(created.Id, new(1, true, "", true), Guid.NewGuid(), default);
        Assert.Equal("APPROVED", approved.Status);
        Assert.False(approved.HasEvidence);
        var invalid = await Assert.ThrowsAsync<FinanceException>(() =>
            owner.ExecuteAsync(created.Id, new(2, Today, "TESTREF-1", "", false), Guid.NewGuid(),
                new MemoryStream([1, 2, 3]), default));
        Assert.Equal("invalid_refund_execution", invalid.Code);
        var key = Guid.NewGuid();
        var executed = await owner.ExecuteAsync(created.Id, new(2, Today, "TESTREF-1", "", true), key,
            new MemoryStream([1, 2, 3]), default);
        Assert.Equal("COMPLETED", executed.Status);
        Assert.True(executed.HasEvidence);
        Assert.Equal(3, executed.Version);
        var replay = await owner.ExecuteAsync(created.Id, new(2, Today, "TESTREF-1", "", true), key,
            new MemoryStream([1, 2, 3]), default);
        Assert.Equal(executed.Id, replay.Id);
        Assert.Equal(1, storage.Puts);
        using var bytes = new MemoryStream();
        Assert.Equal("image/png", await tenant.CopyEvidenceAsync(created.Id, bytes, true, default));
        Assert.Equal(new byte[] { 1, 2, 3 }, bytes.ToArray());
        var stranger = await Assert.ThrowsAsync<FinanceException>(() =>
            Create(repository, OtherTenantId, "Tenant", storage).CopyEvidenceAsync(created.Id,
                new MemoryStream(), true, default));
        Assert.Equal(404, stranger.Status);
        var denied = await Assert.ThrowsAsync<FinanceException>(() =>
            tenant.CopyEvidenceAsync(created.Id, new MemoryStream(), false, default));
        Assert.Equal(403, denied.Status);
    }

    [Theory]
    [InlineData(0, 20)]
    [InlineData(1, 101)]
    [InlineData(int.MaxValue, 100)]
    public async Task InvalidPaginationFailsBeforeDatabase(int page, int size)
    {
        var repository = new InMemoryRepository();
        var error = await Assert.ThrowsAsync<FinanceException>(() =>
            Create(repository, TenantId, "Tenant").TenantListAsync(page, size, default));
        Assert.Equal(400, error.Status);
        Assert.Equal(0, repository.ListCalls);
    }

    private static TenantRefundPetitionService Create(InMemoryRepository repository, Guid id, string role,
        InMemoryStorage? storage = null) => new(repository, storage ?? new(), new ImageValidator(),
        new User(id, role), new FrozenClock());
    private sealed class User(Guid id, string role) : ICurrentUser
    {
        public Guid? UserId => id;
        public bool IsInRole(string value) => value == role;
    }
    private sealed class FrozenClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Today;
    }
    private sealed class ImageValidator : IContractImageValidator
    {
        public string Validate(byte[] bytes) => bytes.Length > 0 ? "image/png" :
            throw new FinanceException(400, "refund_evidence_required");
    }
    private sealed class InMemoryStorage : IObjectStorage
    {
        private readonly Dictionary<string, byte[]> data = new();
        public int Puts { get; private set; }
        public async Task PutAsync(string key, Stream stream, long length, string contentType,
            CancellationToken token)
        {
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, token);
            data[key] = buffer.ToArray();
            Puts++;
        }
        public Task CopyToAsync(string key, Stream output, CancellationToken token) =>
            output.WriteAsync(data[key], token).AsTask();
        public Task DeleteAsync(string key, CancellationToken token)
        {
            data.Remove(key);
            return Task.CompletedTask;
        }
    }
    private sealed class InMemoryRepository : ITenantRefundPetitionRepository
    {
        private TenantRefundPetitionRecord? record;
        public int ListCalls { get; private set; }
        public TenantRefundPetitionSources Sources { get; } = new(
            [new(Guid.NewGuid(), "Chuyển khoản của tôi")],
            [new(Guid.NewGuid(), "Hợp đồng của tôi")]);
        public Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token) => work();
        public Task<PagedResult<TenantRefundPetitionRecord>> ListAsync(Guid? tenantId, int page, int size,
            CancellationToken token)
        {
            ListCalls++;
            var results = record is not null && (tenantId is null || record.TenantUserId == tenantId)
                ? new[] { record } : [];
            return Task.FromResult(new PagedResult<TenantRefundPetitionRecord>(results, page, size, results.Length));
        }
        public Task<TenantRefundPetitionRecord> GetAsync(Guid id, CancellationToken token) =>
            record?.Id == id ? Task.FromResult(record) : Task.FromException<TenantRefundPetitionRecord>(
                new FinanceException(404, "refund_not_found"));
        public Task<TenantRefundPetitionRecord?> ByOperationAsync(Guid key, CancellationToken token) =>
            Task.FromResult(record?.OperationKey == key ? record : null);
        public Task<Guid?> ResidentIdAsync(Guid tenantId, CancellationToken token) =>
            Task.FromResult<Guid?>(tenantId == TenantId ? Guid.NewGuid() : null);
        public Task<TenantRefundPetitionSources> SourcesAsync(Guid tenantId, CancellationToken token) =>
            Task.FromResult(Sources);
        public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken token) =>
            Task.FromResult(false);
        public Task SaveAsync(TenantRefundPetitionRecord row, bool create, Guid actor, string action,
            DateTimeOffset now, CancellationToken token)
        {
            record = row;
            return Task.CompletedTask;
        }
    }
}
