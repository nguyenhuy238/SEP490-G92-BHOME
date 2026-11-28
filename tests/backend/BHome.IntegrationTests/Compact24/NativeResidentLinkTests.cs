using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class NativeResidentLinkTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task LinkPreservesHistoryAndRejectsConflictingAccount()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var actor = Guid.NewGuid(); var tenant = Guid.NewGuid(); var other = Guid.NewGuid();
        foreach (var user in new[] { actor, tenant, other })
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp,is_active)
                VALUES({user},{user.ToString("N")},{user.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic',true)
                """);
        var location = Guid.NewGuid(); var room = Guid.NewGuid(); var resident = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO locations(id,name,address) VALUES({location},'Native link','Synthetic')");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES({room},{location},'A1',2,0)");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO residents(id,current_room_id,identity_owner_scope_id,display_label,verification_status) VALUES({resident},{room},{actor},'Verified',1)");
        var repo = new ContractWorkflowRepository(db);
        var now = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        var prep = await repo.PreparationAsync(new(actor, true, false, false, DateOnly.FromDateTime(now.UtcDateTime)), location, default);
        Assert.Equal(resident, Assert.Single(prep.Residents).Id);
        Assert.True(prep.Residents[0].Verified);
        await repo.LinkTenantAsync(resident, tenant, actor, now, default);
        await repo.LinkTenantAsync(resident, tenant, actor, now, default);
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => repo.LinkTenantAsync(resident, other, actor, now, default))).Status);
        var row = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().SingleAsync(r => r.Id == resident);
        Assert.Equal(tenant, row.TenantUserId);
        Assert.Equal(1, row.History.GetArrayLength());
        var archive = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var projected = await archive.Set<Resident>().AsNoTracking().SingleAsync(r => r.Id == resident);
        Assert.Equal(tenant, projected.TenantUserId);
        Assert.Equal(1, await db.Set<Native.Notification>().CountAsync(n => n.RelatedEntityId == resident && n.NotificationType == "ContractTenantAccountLinked"));
    }
}
