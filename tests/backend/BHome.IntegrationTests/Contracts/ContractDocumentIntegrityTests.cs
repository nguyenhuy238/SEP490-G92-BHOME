using System.Net;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

public sealed partial class ContractLifecycleApiTests
{
    [Fact]
    public async Task SignedDocumentDownloadRejectsTamperedBytesAndPreservesSignerScope()
    {
        var w = await Setup(); var id = await Draft(w); await Signed(w, id);
        var path = Path(id, "document");
        var original = await w.Owner.Client.GetByteArrayAsync(path);
        Assert.Equal(original, await w.Tenant.Client.GetByteArrayAsync(path));
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Staff.Client.GetAsync(path)).StatusCode);
        var outside = await User("Tenant");
        Assert.Equal(HttpStatusCode.NotFound, (await outside.Client.GetAsync(path)).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var signature = await db.Set<ContractSignature>().Where(s => s.ContractId == id && s.SignerUserId == w.Tenant.Id).SingleAsync();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
        var altered = original.ToArray(); altered[^1] ^= 1;
        using (var content = new MemoryStream(altered)) await storage.PutAsync(signature.SignedObjectKey!, content, altered.Length, "application/pdf", default);
        foreach (var actor in new[] { w.Owner, w.Tenant })
        {
            var rejected = await actor.Client.GetAsync(path);
            Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
            Assert.Contains("signing_evidence_integrity_failed", await rejected.Content.ReadAsStringAsync());
        }
        // A failed read must not modify signing state or replace the stored hash.
        await db.Entry(signature).ReloadAsync();
        Assert.Equal(SignatureStatus.Signed, signature.Status);
        using (var content = new MemoryStream(original)) await storage.PutAsync(signature.SignedObjectKey!, content, original.Length, "application/pdf", default);
        Assert.Equal(original, await w.Tenant.Client.GetByteArrayAsync(path));
    }
}
