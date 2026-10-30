using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractSigningCertificateStore(BHomeDbContext db, ICurrentUser user, TimeProvider clock) : ISigningCertificateStore
{
    public async Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken t) =>
        await db.Set<SigningCertificate>().AsNoTracking().Where(c => c.OwnerUserId == ownerUserId && c.OwnerUserId == user.UserId)
            .OrderBy(c => c.CreatedAt).ThenBy(c => c.Id).Take(100).ToArrayAsync(t);
    public Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken t) =>
        db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t);
    public Task<SigningCertificate?> CertificateAsync(string provider, string serial, CancellationToken t) =>
        db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Provider == provider && c.SerialNumber == serial, t);
    public async Task AddCertificateAsync(SigningCertificate certificate, CancellationToken t)
    {
        if (certificate.OwnerUserId != user.UserId) throw ContractException.Missing();
        db.Add(certificate); Audit("ContractCertificateDeclared", certificate.Id);
        try { await db.SaveChangesAsync(t); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        { throw ContractException.Conflict("certificate_already_declared"); }
    }
    public async Task RemoveCertificateAsync(Guid id, CancellationToken t)
    {
        var certificate = await db.Set<SigningCertificate>().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t) ?? throw ContractException.Missing();
        if (await db.Set<BHome.Domain.TenantContracts.ContractSignature>().AnyAsync(s => s.CertificateId == id, t)) throw ContractException.Conflict("certificate_has_contract_history");
        db.Remove(certificate); Audit("ContractCertificateRemoved", id); await db.SaveChangesAsync(t);
    }
    public async Task SetLockedAsync(Guid id, bool locked, CancellationToken t)
    {
        var certificate = await db.Set<SigningCertificate>().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t) ?? throw ContractException.Missing();
        certificate.Locked = locked; Audit(locked ? "ContractCertificateLocked" : "ContractCertificateUnlocked", id); await db.SaveChangesAsync(t);
    }
    private void Audit(string action, Guid id) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = user.UserId, Event = action, TargetId = id, TargetType = "SigningCertificate", Succeeded = true, OccurredAt = clock.GetUtcNow() });
}
