using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence.Compact24;

// The supported roles are the existing Owner/Staff/Tenant catalog. Their identifiers and
// stamps from import remain in the Owner's business_profile.identityRoles; grants use users.roles.
internal sealed class CompactRoleStore(Compact24DbContext db) : IQueryableRoleStore<IdentityRole<Guid>>
{
    public IQueryable<IdentityRole<Guid>> Roles => db.Database.SqlQueryRaw<IdentityRole<Guid>>("""
        SELECT r.id AS "Id",r.name AS "Name",r."normalizedName" AS "NormalizedName",
            r."concurrencyStamp" AS "ConcurrencyStamp"
        FROM jsonb_to_recordset(COALESCE(
            (SELECT business_profile->'identityRoles' FROM users WHERE 'Owner'=ANY(roles)),
            jsonb_build_array(
                jsonb_build_object('id','00000000-0000-0000-0000-000000000001','name','Owner','normalizedName','OWNER'),
                jsonb_build_object('id','00000000-0000-0000-0000-000000000002','name','Staff','normalizedName','STAFF'),
                jsonb_build_object('id','00000000-0000-0000-0000-000000000003','name','Tenant','normalizedName','TENANT'))))
            r(id uuid,name text,"normalizedName" text,"concurrencyStamp" text)
        """);
    public void Dispose() { }
    public Task<string> GetRoleIdAsync(IdentityRole<Guid> role, CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(role.Id.ToString()); }
    public Task<string?> GetRoleNameAsync(IdentityRole<Guid> role, CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(role.Name); }
    public Task<string?> GetNormalizedRoleNameAsync(IdentityRole<Guid> role, CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(role.NormalizedName); }
    public Task SetRoleNameAsync(IdentityRole<Guid> role, string? name, CancellationToken token) { token.ThrowIfCancellationRequested(); role.Name = name; return Task.CompletedTask; }
    public Task SetNormalizedRoleNameAsync(IdentityRole<Guid> role, string? name, CancellationToken token) { token.ThrowIfCancellationRequested(); role.NormalizedName = name; return Task.CompletedTask; }
    public Task<IdentityRole<Guid>?> FindByIdAsync(string id, CancellationToken token) => Guid.TryParse(id, out var key)
        ? Roles.SingleOrDefaultAsync(r => r.Id == key, token) : Task.FromResult<IdentityRole<Guid>?>(null);
    public Task<IdentityRole<Guid>?> FindByNameAsync(string name, CancellationToken token) => Roles.SingleOrDefaultAsync(r => r.NormalizedName == name, token);
    public Task<IdentityResult> CreateAsync(IdentityRole<Guid> role, CancellationToken token) => FixedCatalog(token);
    public Task<IdentityResult> UpdateAsync(IdentityRole<Guid> role, CancellationToken token) => FixedCatalog(token);
    public Task<IdentityResult> DeleteAsync(IdentityRole<Guid> role, CancellationToken token) => FixedCatalog(token);
    private static Task<IdentityResult> FixedCatalog(CancellationToken token)
    { token.ThrowIfCancellationRequested(); return Task.FromResult(IdentityResult.Failed(new IdentityError { Code = "BusinessRolesAreFixed", Description = "BusinessRolesAreFixed" })); }
}
