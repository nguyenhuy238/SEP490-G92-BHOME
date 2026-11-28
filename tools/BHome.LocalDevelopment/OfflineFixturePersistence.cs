using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

// Explicit offline fixture adapter. Never register it as the runtime DbContext.
internal static class OfflineFixturePersistence
{
    internal static Compact24ArchiveContext Open(IServiceProvider services, Compact24DbContext? identity = null)
    {
        var options = services.GetRequiredService<DbContextOptions<Compact24DbContext>>();
        if (identity is not null)
            options = new DbContextOptionsBuilder<Compact24DbContext>(options)
                .UseNpgsql(identity.Database.GetDbConnection(), contextOwnsConnection: false).Options;
        return new Compact24ArchiveContext(options, services.GetService<Compact24Compatibility>(), services.GetService<TimeProvider>());
    }

    // Identity's UserManager continues to use the strict context. Both contexts
    // enlist in the one physical transaction so a failed fixture rolls back accounts too.
    internal static async Task<IdentityFixtureTransaction> BeginAsync(Compact24ArchiveContext archive,
        Compact24DbContext identity, CancellationToken token = default)
    {
        var transaction = await archive.Database.BeginTransactionAsync(token);
        try
        {
            var enlistment = await identity.Database.UseTransactionAsync(transaction.GetDbTransaction(), token)
                ?? throw new InvalidOperationException("Fixture identity transaction could not be enlisted.");
            return new(transaction, enlistment);
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    internal sealed class IdentityFixtureTransaction(IDbContextTransaction transaction, IDbContextTransaction enlistment) : IAsyncDisposable
    {
        private bool released;
        internal async Task CommitAsync(CancellationToken token = default)
        {
            await transaction.CommitAsync(token);
            // Release Identity's transaction before any subsequent native service calls.
            await enlistment.DisposeAsync();
            released = true;
        }

        public async ValueTask DisposeAsync()
        {
            try { if (!released) await enlistment.DisposeAsync(); }
            finally { await transaction.DisposeAsync(); }
        }
    }
}
