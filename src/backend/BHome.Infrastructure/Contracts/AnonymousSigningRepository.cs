using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class AnonymousSigningRepository(BHomePersistenceContext db) : IAnonymousSigningRepository
{
    public Task<ContractSigningInvitation?> FindByTokenHashAsync(string hash, CancellationToken t) =>
        db.Set<ContractSigningInvitation>().SingleOrDefaultAsync(i => i.TokenHash == hash, t);
    public Task<ContractSigningInvitation?> FindAsync(Guid id, CancellationToken t) =>
        db.Set<ContractSigningInvitation>().SingleOrDefaultAsync(i => i.Id == id, t);
    public async Task<IReadOnlyList<ContractSigningInvitation>> ListAsync(Guid contractId, CancellationToken t) =>
        await db.Set<ContractSigningInvitation>().Where(i => i.ContractId == contractId).OrderByDescending(i => i.CreatedAt).Take(100).ToArrayAsync(t);
    public void Add(ContractSigningInvitation invitation) => db.Add(invitation);
}
