using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.LocalDevelopment;

internal static class LocalSchemaSeed
{
    internal static async Task EnsureChainAsync(BHomePersistenceContext db, CancellationToken token)
    {
        if (await db.Set<Chain>().AnyAsync(token)) return;
        // The explicit synthetic account/demo command replaces the original migration's
        // singleton initialization. API startup never creates accounts or business defaults.
        db.Add(new Chain { Name = "BHOME" }); await db.SaveChangesAsync(token);
    }
}
