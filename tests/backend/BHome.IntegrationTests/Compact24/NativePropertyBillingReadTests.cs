using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Compact24;

public sealed class NativePropertyBillingReadTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private Compact24DbContext Context() => new(new DbContextOptionsBuilder<Compact24DbContext>()
        .UseNpgsql(fixture.Connection).Options);

    [CompactPostgresFact]
    public async Task SetupScopeReadsMatchProjectionsInsideExistingTransaction()
    {
        await using var db = Context();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var location = Guid.NewGuid(); var otherLocation = Guid.NewGuid();
        var room = Guid.NewGuid(); var secondRoom = Guid.NewGuid(); var otherRoom = Guid.NewGuid();
        var meter = Guid.NewGuid(); var inactiveMeter = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO locations(id,name,address,is_active) VALUES
                ({location},'Synthetic A','Synthetic address',true),
                ({otherLocation},'Synthetic B','Synthetic address',false);
            INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES
                ({room},{location},'A01',2,0),({secondRoom},{location},'A02',2,0),
                ({otherRoom},{otherLocation},'B01',1,0);
            INSERT INTO meters(id,room_id,utility_type,meter_code,display_type,decimal_places,installed_on,is_active) VALUES
                ({meter},{room},0,'Synthetic electricity',0,0,'2026-01-01',true),
                ({inactiveMeter},{otherRoom},1,'Synthetic inactive water',0,0,'2026-01-01',false);
            """);
        var store = new SetupWorkspaceStore(db, new CompactNotificationWriter(db, TimeProvider.System),
            new Compact24WorkflowFixture.TestObjectStorage());
        var expectedRooms = await db.Set<Room>().Where(r => r.LocationId == location).OrderBy(r => r.Id).Select(r => r.Id).ToArrayAsync();
        Assert.Equal(expectedRooms, await store.RoomsAsync(location, default));
        Assert.Equal(new[] { otherRoom }, await store.RoomsAsync(otherLocation, default));
        Assert.Empty(await store.RoomsAsync(Guid.NewGuid(), default));
        Assert.Equal(location, await store.RoomLocationAsync(room, default));
        Assert.Equal(otherLocation, await store.RoomLocationAsync(otherRoom, default));
        Assert.Null(await store.RoomLocationAsync(Guid.NewGuid(), default));
        foreach (var id in new[] { meter, inactiveMeter })
        {
            var expectedMeter = await db.Set<Meter>().Where(m => m.Id == id).Select(m => new { m.RoomId, m.UtilityType }).SingleAsync();
            var expectedLocation = await db.Set<Room>().Where(r => r.Id == expectedMeter.RoomId).Select(r => r.LocationId).SingleAsync();
            Assert.Equal<(Guid LocationId, UtilityType Type)?>((expectedLocation, expectedMeter.UtilityType), await store.MeterScopeAsync(id, default));
        }
        Assert.Null(await store.MeterScopeAsync(Guid.NewGuid(), default));
        await transaction.RollbackAsync();
        Assert.Null(await store.RoomLocationAsync(room, default));
    }

    [CompactPostgresFact]
    public async Task TenantBillingLocationsMatchProjectionAndExcludeOtherScopes()
    {
        await using var db = Context();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var owner = Guid.NewGuid(); var tenant = Guid.NewGuid(); var otherTenant = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp) VALUES
                ({owner},'native-owner','NATIVE-OWNER','synthetic',ARRAY['Owner'],'synthetic','synthetic'),
                ({tenant},'native-tenant','NATIVE-TENANT','synthetic',ARRAY['Tenant'],'synthetic','synthetic'),
                ({otherTenant},'native-other','NATIVE-OTHER','synthetic',ARRAY['Tenant'],'synthetic','synthetic');
            """);
        var resident = Guid.NewGuid(); var otherResident = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO residents(id,user_id,identity_owner_scope_id,display_label,verification_status) VALUES
                ({resident},{tenant},{owner},'Synthetic resident',1),
                ({otherResident},{otherTenant},{owner},'Synthetic other resident',1);
            """);
        var active = Guid.NewGuid(); var inactive = Guid.NewGuid(); var excluded = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO locations(id,name,address,is_active) VALUES
                ({active},'Synthetic active','Synthetic',true),({inactive},'Synthetic inactive','Synthetic',false),
                ({excluded},'Synthetic excluded','Synthetic',true);
            """);
        async Task AddContract(Guid location, Guid user, Guid representative, string type, ContractStatus status)
        {
            var room = Guid.NewGuid();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES({room},{location},{room.ToString("N")},2,0);
                INSERT INTO contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,start_date,end_date,deposit_required,terms,status,activated_at,activated_by_user_id)
                VALUES({Guid.NewGuid()},{room},{representative},{user},{owner},{type},'2026-01-01','2027-01-01',0,'Synthetic terms',{(short)status},'2026-01-01T00:00:00Z',{owner});
                """);
        }
        await AddContract(active, tenant, resident, "MAIN", ContractStatus.Active);
        await AddContract(active, tenant, resident, "RENEWAL", ContractStatus.Active);
        await AddContract(inactive, tenant, resident, "MAIN", ContractStatus.Active);
        await AddContract(excluded, tenant, resident, "HOLDING", ContractStatus.Active);
        await AddContract(excluded, tenant, resident, "ADDENDUM", ContractStatus.Active);
        await AddContract(excluded, tenant, resident, "MAIN", ContractStatus.Terminated);
        await AddContract(excluded, otherTenant, otherResident, "MAIN", ContractStatus.Active);
        var repository = new InvoiceRepository(db);
        var expected = await db.Set<Contract>().AsNoTracking().Where(c => c.TenantUserId == tenant && c.Status == ContractStatus.Active &&
            (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && c.ActivatedAt != null && c.Room.Location.IsActive)
            .Select(c => c.Room.LocationId).Distinct().ToArrayAsync();
        Assert.Equal(new[] { active }, expected);
        Assert.Equal(expected, await repository.TenantBillingLocationIdsAsync(tenant, default));
        Assert.Equal(new[] { excluded }, await repository.TenantBillingLocationIdsAsync(otherTenant, default));
        Assert.Empty(await repository.TenantBillingLocationIdsAsync(Guid.NewGuid(), default));
        await transaction.RollbackAsync();
    }
}
