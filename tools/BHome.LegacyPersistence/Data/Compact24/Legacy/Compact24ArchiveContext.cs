using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence.Compact24;

/// <summary>
/// Explicit offline source import and historical test fixture adapter. It is
/// never registered in the API runtime service collection. Keeping it as a
/// distinct context type also separates EF's model cache from the native model.
/// </summary>
public sealed partial class Compact24ArchiveContext(DbContextOptions<Compact24DbContext> options,
    Compact24Compatibility? compatibility = null, TimeProvider? clock = null)
    : Compact24DbContext(options, compatibility, clock)
{
    internal override bool UsesArchiveProjection => true;

    protected override void OnModelCreating(ModelBuilder model)
    {
        Compact24DomainModel.Configure(model);
        ConfigurePhysicalModel(model, archive: true);
    }

    public override BHomePersistenceContext CreateIndependentContext() => new Compact24ArchiveContext(ContextOptions, Compatibility, PersistenceClock);
}
