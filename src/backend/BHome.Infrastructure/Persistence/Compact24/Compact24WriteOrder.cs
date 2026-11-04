using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BHome.Infrastructure.Persistence.Compact24;

public sealed partial class Compact24DbContext
{
    private static IReadOnlyList<EntityEntry> OrderWrites(EntityEntry[] entries)
    {
        var keys = new Dictionary<(IEntityType Entity, IKey Key, string Values), EntityEntry>();
        foreach (var entry in entries.Where(e => e.State == EntityState.Added))
            foreach (var key in entry.Metadata.GetKeys())
                keys.Add((entry.Metadata, key, KeyValues(key.Properties.Select(p => entry.Property(p.Name).CurrentValue))), entry);

        var dependencies = entries.ToDictionary(e => e, _ => new HashSet<EntityEntry>());
        var dependents = entries.ToDictionary(e => e, _ => new List<EntityEntry>());
        var certificates = entries.Where(e => e.State == EntityState.Added && e.Entity is BHome.DigitalSigning.Domain.SigningCertificate)
            .ToDictionary(e => ((BHome.DigitalSigning.Domain.SigningCertificate)e.Entity).Id);
        foreach (var entry in entries.Where(e => e.State != EntityState.Deleted))
        {
            foreach (var fk in entry.Metadata.GetForeignKeys())
            {
                var values = fk.Properties.Select(p => entry.Property(p.Name).CurrentValue).ToArray();
                if (values.Any(v => v is null)) continue;
                if (keys.TryGetValue((fk.PrincipalEntityType, fk.PrincipalKey, KeyValues(values)), out var parent) && parent != entry)
                    dependencies[entry].Add(parent);
            }
            // Certificate declarations were not relational FKs in the source model. Persist
            // their embedded directory entry before capturing its immutable signing snapshot.
            if (entry.Entity is BHome.Domain.TenantContracts.ContractSignature signature && certificates.TryGetValue(signature.CertificateId, out var certificate))
                dependencies[entry].Add(certificate);
            foreach (var parent in dependencies[entry]) dependents[parent].Add(entry);
        }
        var ready = new PriorityQueue<EntityEntry, (int DeletedFirst, int OriginalOrder)>();
        var ordinal = entries.Select((entry, i) => (entry, i)).ToDictionary(p => p.entry, p => p.i);
        foreach (var entry in entries.Where(e => dependencies[e].Count == 0))
            ready.Enqueue(entry, (entry.State == EntityState.Deleted ? 0 : 1, ordinal[entry]));
        var result = new List<EntityEntry>(entries.Length);
        while (ready.TryDequeue(out var entry, out _))
        {
            result.Add(entry);
            foreach (var child in dependents[entry])
                if (dependencies[child].Remove(entry) && dependencies[child].Count == 0)
                    ready.Enqueue(child, (child.State == EntityState.Deleted ? 0 : 1, ordinal[child]));
        }
        if (result.Count != entries.Length) throw new InvalidOperationException("Cyclic Compact24 write dependency.");
        return result;
    }

    private static string KeyValues(IEnumerable<object?> values) => JsonSerializer.Serialize(values.ToArray(), RecordJson);
}
