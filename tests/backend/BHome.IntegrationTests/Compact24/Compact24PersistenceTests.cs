using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24PersistenceTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task ConcurrentReconciliationHistoryAcrossReceiptsKeepsDistinctIncreasingSequences()
    {
        var isolated = new Compact24Fixture();
        await isolated.InitializeAsync();
        try
        {
            var owner = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = "sequence-owner",
                NormalizedUserName = "SEQUENCE-OWNER",
                PasswordHash = "synthetic-unusable-hash",
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString()
            };
            var now = DateTimeOffset.UtcNow;
            var transfers = Enumerable.Range(1, 16).Select(i => new BHome.Domain.PaymentsDebt.PaymentTransfer
            {
                ProviderIdentity = "SyntheticBank",
                BankReference = "SEQ-" + i,
                NormalizedReference = "SEQ-" + i,
                Amount = 10000,
                OccurredAt = now,
                VerifiedAt = now,
                VerifiedByUserId = owner.Id,
                StatementReference = "synthetic-statement",
                VerificationReason = "Synthetic concurrency fixture"
            }).ToArray();
            await using (var seed = isolated.Factory!.Services.CreateAsyncScope())
            {
                var db = seed.ServiceProvider.GetRequiredService<Compact24DbContext>();
                db.PrepareUserRole(owner, "Owner"); db.Users.Add(owner); await db.SaveChangesAsync();
                db.AddRange(transfers); await db.SaveChangesAsync();
            }
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var writes = transfers.Select(async transfer =>
            {
                await using var scope = isolated.Factory!.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                await release.Task;
                db.Add(new BHome.Domain.PaymentsDebt.PaymentReconciliation
                { TransferId = transfer.Id, ActorId = owner.Id, OccurredAt = now, Decision = "PendingReview", Reason = "Synthetic review" });
                await db.SaveChangesAsync();
            }).ToArray();
            release.SetResult(); await Task.WhenAll(writes);
            await using var verify = isolated.Factory!.Services.CreateAsyncScope();
            var actual = await verify.ServiceProvider.GetRequiredService<Compact24DbContext>()
                .Set<BHome.Domain.PaymentsDebt.PaymentReconciliation>().OrderBy(r => r.Sequence).Select(r => r.Sequence).ToArrayAsync();
            Assert.Equal(Enumerable.Range(1, 16).Select(i => (long)i), actual);
        }
        finally { await isolated.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task EveryDomainProjectionExecutesWithOnlyTwentyFourTables()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.True(await db.IsSchemaReadyAsync());
        Assert.Same(db, scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>());
        Assert.Null(scope.ServiceProvider.GetService<BHomeDbContext>());
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        foreach (var entity in db.Model.GetEntityTypes())
        {
            var sql = entity.GetSqlQuery()?.Replace("{{", "{", StringComparison.Ordinal).Replace("}}", "}", StringComparison.Ordinal); if (sql is null) continue;
            await using var command = new NpgsqlCommand("SELECT * FROM (" + sql + ") projection LIMIT 1", connection);
            try { await using var reader = await command.ExecuteReaderAsync(); }
            catch (PostgresException error) { throw new InvalidOperationException("Compact24 projection failed: " + entity.ClrType.Name + "/" + error.SqlState, error); }
        }
    }

    [CompactPostgresFact]
    public async Task PropertyAndEncryptedResidentRoundTripWithoutLegacyTables()
    {
        var owner = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = "compact-owner",
            NormalizedUserName = "COMPACT-OWNER",
            SecurityStamp = Guid.NewGuid().ToString(),
            ConcurrencyStamp = Guid.NewGuid().ToString(),
            IsActive = true
        };
        owner.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(owner, "Synthetic!Password-493");
        var chain = new Chain { Name = "Synthetic chain" };
        var location = new Location("Synthetic location") { ChainId = chain.Id, Address = "Synthetic address", IsActive = true };
        var type = new RoomType { LocationId = location.Id, Name = "Synthetic catalog", DefaultCapacity = 2, Amenities = ["wifi"] };
        var room = new Room { LocationId = location.Id, RoomTypeId = type.Id, RoomNumber = "C24-1", Capacity = 2, Status = RoomStatus.Available };
        var resident = new Resident
        {
            RoomId = room.Id,
            OwnerUserId = owner.Id,
            DisplayLabel = "Synthetic resident",
            IdentityData = "{\"syntheticEncryptedEnvelope\":\"opaque-test-value\"}"
        };
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            db.Entry(owner).Property<string[]>("roles").CurrentValue = ["Owner"]; db.Add(owner); await db.SaveChangesAsync();
            db.AddRange(chain, location, type, room, resident); await db.SaveChangesAsync();
        }
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            var actual = await db.Set<Resident>().Include(r => r.Room).ThenInclude(r => r.RoomType).SingleAsync(r => r.Id == resident.Id);
            Assert.True(System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.Nodes.JsonNode.Parse(resident.IdentityData), System.Text.Json.Nodes.JsonNode.Parse(actual.IdentityData)));
            Assert.Equal(owner.Id, actual.OwnerUserId); Assert.Equal(type.Id, actual.Room.RoomType!.Id);
            Assert.Equal(new[] { "wifi" }, actual.Room.RoomType.Amenities);
            Assert.Equal(chain.Id, (await db.Locations.SingleAsync(l => l.Id == location.Id)).ChainId);
            Assert.Equal(chain.Id, (await db.Set<Chain>().SingleAsync()).Id);
        }
    }
}
