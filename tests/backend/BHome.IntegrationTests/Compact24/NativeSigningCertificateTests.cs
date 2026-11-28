using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Domain;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class NativeSigningCertificateTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private sealed class Actor(Guid id) : ICurrentUser
    {
        public Guid? UserId => id;
        public bool IsInRole(string role) => role == "Tenant";
    }

    [CompactPostgresFact]
    public async Task DirectoryWritesPreserveScopeAuditAndAmbientRollback()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var owner = Guid.NewGuid(); var other = Guid.NewGuid(); var id = Guid.NewGuid();
        foreach (var user in new[] { owner, other })
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO users(id,username,normalized_username,password_hash,roles,security_stamp,concurrency_stamp,is_active)
                VALUES({user},{user.ToString("N")},{user.ToString("N").ToUpperInvariant()},'synthetic',ARRAY['Tenant'],'synthetic','synthetic',true)
                """);
        var now = DateTimeOffset.Parse("2026-11-28T07:00:00Z");
        var certificate = new SigningCertificate
        {
            Id = id, OwnerUserId = owner, Provider = "Synthetic", ProviderUserId = "subscriber", CredentialId = "handle",
            SerialNumber = id.ToString("N"), Subject = "Subject", Issuer = "Issuer", ValidFrom = now, ValidTo = now.AddYears(1), CreatedAt = now
        };
        var store = new ContractSigningCertificateStore(db, new Actor(owner), TimeProvider.System);
        var outsider = new ContractSigningCertificateStore(db, new Actor(other), TimeProvider.System);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await store.AddCertificateAsync(certificate, default);
            Assert.NotNull(await store.CertificateAsync(id, default));
            await tx.RollbackAsync();
        }
        Assert.Null(await store.CertificateAsync(id, default));
        Assert.False(await db.Set<Native.Notification>().AnyAsync(n => n.RelatedEntityId == id));
        await store.AddCertificateAsync(certificate, default);
        Assert.Equal(id, Assert.Single(await store.CertificatesOfAsync(owner, default)).Id);
        Assert.Empty(await outsider.CertificatesOfAsync(owner, default));
        Assert.Null(await outsider.CertificateAsync(id, default));
        Assert.Equal(owner, (await outsider.CertificateAsync(certificate.Provider, certificate.SerialNumber, default))!.OwnerUserId);
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => outsider.SetLockedAsync(id, true, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => store.AddCertificateAsync(certificate, default))).Status);
        await store.SetLockedAsync(id, true, default);
        Assert.True((await store.CertificateAsync(id, default))!.Locked);
        var previous = await db.Set<SigningCertificate>().AsNoTracking().SingleAsync(c => c.Id == id);
        Assert.Equal(certificate.CredentialId, previous.CredentialId);
        Assert.True(previous.Locked);
        await store.RemoveCertificateAsync(id, default);
        Assert.Null(await store.CertificateAsync(id, default));
        var events = await db.Set<Native.Notification>().AsNoTracking().Where(n => n.RelatedEntityId == id).ToArrayAsync();
        Assert.Equal(3, events.Length);
        Assert.All(events, n => { Assert.Equal(owner, n.ActorUserId); Assert.Equal("AUDIT", n.RecordKind); Assert.Equal("SecurityAuditRecord", n.EventData.GetProperty("recordType").GetString()); });
        Assert.Equal(new[] { "ContractCertificateDeclared", "ContractCertificateLocked", "ContractCertificateRemoved" }, events.Select(n => n.NotificationType).OrderBy(x => x).ToArray());
    }
}
