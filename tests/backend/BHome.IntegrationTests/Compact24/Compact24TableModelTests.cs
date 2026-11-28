using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

public sealed class Compact24TableModelTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private static Compact24TableContext CreateModel() => new(new DbContextOptionsBuilder<Compact24TableContext>()
        .UseNpgsql("Host=127.0.0.1;Database=offline_native_model;Username=unconfigured").Options);

    [Fact]
    public void NativeEntitiesMatchEveryReviewedPhysicalColumnWithoutOwningMigrations()
    {
        using var db = CreateModel();
        using var stream = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
        using var reader = new StreamReader(stream);
        var schema = reader.ReadToEnd();
        var expected = Compact24Schema.ExpectedColumns(schema);
        var entities = db.GetService<IDesignTimeModel>().Model.GetEntityTypes().ToArray();
        Assert.Equal(24, entities.Length);
        var actual = new List<string>();
        foreach (var entity in entities)
        {
            Assert.Equal("public", entity.GetSchema());
            Assert.Null(entity.GetSqlQuery());
            Assert.True(entity.IsTableExcludedFromMigrations());
            var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
            foreach (var property in entity.GetProperties())
            {
                var type = property.GetColumnType(table)!.Replace("varchar", "character varying", StringComparison.Ordinal)
                    .Replace("timestamptz", "timestamp with time zone", StringComparison.Ordinal);
                actual.Add($"{table.Name}.{property.GetColumnName(table)}:{type}:{!property.IsNullable}");
            }
            var key = entity.FindPrimaryKey()!.Properties.Select(p => p.GetColumnName(table)).ToArray();
            Assert.Equal(table.Name == "contract_residents" ? new[] { "contract_id", "resident_id" } : new[] { "id" }, key);
        }
        Assert.Equal(expected.Order(StringComparer.Ordinal), actual.Order(StringComparer.Ordinal));
        var foreignKeys = entities.SelectMany(e => e.GetForeignKeys()).Select(f =>
        {
            var origin = StoreObjectIdentifier.Table(f.DeclaringEntityType.GetTableName()!, "public");
            var destination = StoreObjectIdentifier.Table(f.PrincipalEntityType.GetTableName()!, "public");
            var from = string.Join(",", f.Properties.Select(p => p.GetColumnName(origin)));
            var to = string.Join(",", f.PrincipalKey.Properties.Select(p => p.GetColumnName(destination)));
            return $"{origin.Name}({from})->{destination.Name}({to})";
        });
        Assert.Equal(Compact24Schema.ExpectedForeignKeys(schema).Order(StringComparer.Ordinal), foreignKeys.Order(StringComparer.Ordinal));
        Assert.Throws<InvalidOperationException>(() => db.SaveChanges());
        Assert.Throws<InvalidOperationException>(() => { _ = db.SaveChangesAsync(); });
    }

    [CompactPostgresFact]
    public async Task NativeReadsShareTheExistingTransactionAndPreserveJson()
    {
        await using var domain = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql(fixture.Connection).Options);
        var id = Guid.NewGuid();
        await using (var transaction = await domain.Database.BeginTransactionAsync())
        {
            await domain.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address,operating_settings) VALUES ({id},'Native model','Synthetic address','{{\"futureField\":{{\"amount\":123}}}}'::jsonb)");
            await using var tables = await Compact24TableContext.OpenAsync(domain, default);
            Assert.Same(domain.Database.GetDbConnection(), tables.Database.GetDbConnection());
            Assert.Same(transaction.GetDbTransaction(), tables.Database.CurrentTransaction!.GetDbTransaction());
            var row = await tables.Set<Native.Location>().SingleAsync(x => x.Id == id);
            Assert.Equal("Native model", row.Name);
            Assert.Equal(123, row.OperatingSettings.GetProperty("futureField").GetProperty("amount").GetInt32());
            Assert.Empty(tables.ChangeTracker.Entries());
            await transaction.RollbackAsync();
        }
        await using var after = await Compact24TableContext.OpenAsync(domain, default);
        Assert.False(await after.Set<Native.Location>().AnyAsync(x => x.Id == id));
    }
}
