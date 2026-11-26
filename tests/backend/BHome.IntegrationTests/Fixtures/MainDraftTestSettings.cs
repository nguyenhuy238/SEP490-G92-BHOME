using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.IntegrationTests.Fixtures;

internal static class MainDraftTestSettings
{
    internal static async Task ResetOwnerPolicyAsync(BHomePersistenceContext db, Guid ownerId)
    {
        // Compact24 fixtures share one synthetic Owner. Each scenario owns its
        // configuration, including scenarios that require it to be absent.
        if (db is Compact24DbContext)
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE public.users SET business_profile=business_profile-'mainContractPolicy' WHERE id={ownerId}");
    }
}
