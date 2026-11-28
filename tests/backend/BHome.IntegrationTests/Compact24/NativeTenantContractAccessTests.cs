using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class NativeTenantContractAccessTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task SharedMembershipUsesPhysicalTablesAndPreservesContractKindAndLocationScope()
    {
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>()
            .UseNpgsql(fixture.Connection).Options);
        await using var transaction = await db.Database.BeginTransactionAsync();
        var owner = Guid.NewGuid(); var representativeUser = Guid.NewGuid(); var memberUser = Guid.NewGuid();
        var representative = Guid.NewGuid(); var member = Guid.NewGuid(); var location = Guid.NewGuid();
        var room = Guid.NewGuid(); var contract = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp) VALUES
                ({owner},{owner.ToString("N")},{owner.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Owner'],'synthetic','synthetic'),
                ({representativeUser},{representativeUser.ToString("N")},{representativeUser.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic'),
                ({memberUser},{memberUser.ToString("N")},{memberUser.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic');
            INSERT INTO residents(id,user_id,identity_owner_scope_id,display_label,verification_status) VALUES
                ({representative},{representativeUser},{owner},'Synthetic representative',1),
                ({member},{memberUser},{owner},'Synthetic member',1);
            INSERT INTO locations(id,name,address,is_active) VALUES({location},'Synthetic access','Synthetic address',true);
            INSERT INTO rooms(id,location_id,room_number,capacity,status) VALUES({room},{location},'SYN-01',2,0);
            INSERT INTO contracts(id,room_id,representative_resident_id,tenant_user_id,owner_signer_id,contract_type,start_date,end_date,deposit_required,terms,status)
                VALUES({contract},{room},{representative},{representativeUser},{owner},'HOLDING','2026-01-01','2027-01-01',0,'Synthetic terms',0);
            INSERT INTO contract_residents(contract_id,resident_id,resident_role,residence_from) VALUES
                ({contract},{representative},0,'2026-01-01'),({contract},{member},1,'2026-01-01');
            """);
        var access = new CompactTenantContractAccess(db);
        Assert.False(await access.SharesContractAsync(memberUser, representativeUser, location, default));
        foreach (var type in new[] { "MAIN", "RENEWAL", "ADDENDUM" })
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET contract_type={type} WHERE id={contract}");
            Assert.True(await access.SharesContractAsync(memberUser, representativeUser, location, default));
            Assert.True(await access.SharesContractAsync(representativeUser, memberUser, location, default));
            Assert.False(await access.SharesContractAsync(memberUser, memberUser, location, default));
            Assert.False(await access.SharesContractAsync(memberUser, representativeUser, Guid.NewGuid(), default));
            Assert.False(await access.SharesContractAsync(Guid.NewGuid(), representativeUser, location, default));
        }
        await transaction.RollbackAsync();
        Assert.False(await access.SharesContractAsync(memberUser, representativeUser, location, default));
    }
}
