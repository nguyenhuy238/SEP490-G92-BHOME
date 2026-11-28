using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Text.Json;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractSigningCertificateStore(BHomePersistenceContext db, ICurrentUser user, TimeProvider clock) : ISigningCertificateStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<SigningCertificate>> CertificatesOfAsync(Guid ownerUserId, CancellationToken t) =>
        db is Compact24DbContext ? await ReadAsync($"""
            SELECT e::text AS "Value" FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) e
            WHERE (e->>'ownerUserId')::uuid={ownerUserId} AND (e->>'ownerUserId')::uuid={user.UserId}
            ORDER BY (e->>'createdAt')::timestamptz,(e->>'id')::uuid LIMIT 100
            """, t) :
        await db.Set<SigningCertificate>().AsNoTracking().Where(c => c.OwnerUserId == ownerUserId && c.OwnerUserId == user.UserId)
            .OrderBy(c => c.CreatedAt).ThenBy(c => c.Id).Take(100).ToArrayAsync(t);
    public async Task<SigningCertificate?> CertificateAsync(Guid id, CancellationToken t) =>
        db is Compact24DbContext ? (await ReadAsync($"""
            SELECT e::text AS "Value" FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) e
            WHERE (e->>'id')::uuid={id} AND (e->>'ownerUserId')::uuid={user.UserId}
            """, t)).SingleOrDefault() :
        await db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t);
    public async Task<SigningCertificate?> CertificateAsync(string provider, string serial, CancellationToken t) =>
        db is Compact24DbContext ? (await ReadAsync($"""
            SELECT e::text AS "Value" FROM users u CROSS JOIN LATERAL jsonb_array_elements(u.signing_credentials) e
            WHERE e->>'provider'={provider} AND e->>'serialNumber'={serial}
            """, t)).SingleOrDefault() :
        await db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Provider == provider && c.SerialNumber == serial, t);
    public async Task AddCertificateAsync(SigningCertificate certificate, CancellationToken t)
    {
        if (certificate.OwnerUserId != user.UserId) throw ContractException.Missing();
        if (db is Compact24DbContext)
        {
            await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
            // The directory is embedded in users: serialize declaration of a provider/serial
            // across all holders, then lock the holder row before modifying its array.
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"certificate:" + certificate.Provider + ":" + certificate.SerialNumber},0))", t);
            if (await CertificateAsync(certificate.Provider, certificate.SerialNumber, t) is not null)
                throw ContractException.Conflict("certificate_already_declared");
            await LockOwnerAsync(certificate.OwnerUserId, t);
            await ReplaceAsync(certificate.OwnerUserId, certificate.Id, certificate, t);
            await AuditNativeAsync("ContractCertificateDeclared", certificate.Id, t);
            if (tx is not null) await tx.CommitAsync(t);
            return;
        }
        db.Add(certificate); Audit("ContractCertificateDeclared", certificate.Id);
        try { await db.SaveChangesAsync(t); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        { throw ContractException.Conflict("certificate_already_declared"); }
    }
    public async Task RemoveCertificateAsync(Guid id, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
            var existing = await CertificateAsync(id, t) ?? throw ContractException.Missing();
            await LockOwnerAsync(existing.OwnerUserId, t);
            existing = await CertificateAsync(id, t) ?? throw ContractException.Missing();
            if (await db.Set<BHome.Domain.TenantContracts.ContractSigning>().AsNoTracking().AnyAsync(s => s.CertificateId == id, t))
                throw ContractException.Conflict("certificate_has_contract_history");
            await ReplaceAsync(existing.OwnerUserId, id, null, t);
            await AuditNativeAsync("ContractCertificateRemoved", id, t);
            if (tx is not null) await tx.CommitAsync(t);
            return;
        }
        var certificate = await db.Set<SigningCertificate>().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t) ?? throw ContractException.Missing();
        if (await db.Set<BHome.Domain.TenantContracts.ContractSigning>().AnyAsync(s => s.CertificateId == id, t)) throw ContractException.Conflict("certificate_has_contract_history");
        db.Remove(certificate); Audit("ContractCertificateRemoved", id); await db.SaveChangesAsync(t);
    }
    public async Task SetLockedAsync(Guid id, bool locked, CancellationToken t)
    {
        if (db is Compact24DbContext)
        {
            await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
            var existing = await CertificateAsync(id, t) ?? throw ContractException.Missing();
            await LockOwnerAsync(existing.OwnerUserId, t);
            existing = await CertificateAsync(id, t) ?? throw ContractException.Missing();
            if (existing.Locked != locked)
            {
                existing.Locked = locked;
                await ReplaceAsync(existing.OwnerUserId, id, existing, t);
            }
            await AuditNativeAsync(locked ? "ContractCertificateLocked" : "ContractCertificateUnlocked", id, t);
            if (tx is not null) await tx.CommitAsync(t);
            return;
        }
        var certificate = await db.Set<SigningCertificate>().SingleOrDefaultAsync(c => c.Id == id && c.OwnerUserId == user.UserId, t) ?? throw ContractException.Missing();
        certificate.Locked = locked; Audit(locked ? "ContractCertificateLocked" : "ContractCertificateUnlocked", id); await db.SaveChangesAsync(t);
    }
    private void Audit(string action, Guid id) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = user.UserId, Event = action, TargetId = id, TargetType = "SigningCertificate", Succeeded = true, OccurredAt = clock.GetUtcNow() });

    private async Task<SigningCertificate[]> ReadAsync(FormattableString query, CancellationToken t) =>
        (await db.Database.SqlQuery<string>(query).ToArrayAsync(t))
        .Select(value => JsonSerializer.Deserialize<SigningCertificate>(value, Json)
            ?? throw ContractException.Conflict("certificate_directory_invalid")).ToArray();

    private async Task LockOwnerAsync(Guid owner, CancellationToken t)
    {
        var found = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM users WHERE id={owner} FOR UPDATE").SingleOrDefaultAsync(t);
        if (found == Guid.Empty) throw ContractException.Missing();
    }

    private async Task ReplaceAsync(Guid owner, Guid id, SigningCertificate? next, CancellationToken t)
    {
        var replacement = next is null ? "[]" : JsonSerializer.Serialize(new[] { new
        {
            next.Id, next.OwnerUserId, next.Provider, next.ProviderUserId, next.CredentialId,
            next.SerialNumber, next.Subject, next.Issuer, next.ValidFrom, next.ValidTo,
            next.Locked, next.CreatedAt, recordType = "SigningCertificate"
        } }, Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE users SET signing_credentials=COALESCE((
                SELECT jsonb_agg(e ORDER BY position) FROM jsonb_array_elements(signing_credentials) WITH ORDINALITY a(e,position)
                WHERE e->>'id' IS DISTINCT FROM {id.ToString()}),'[]'::jsonb)||CAST({replacement} AS jsonb)
            WHERE id={owner}
            """, t);
        if (changed != 1) throw ContractException.Missing();
    }

    private Task AuditNativeAsync(string action, Guid id, CancellationToken t) =>
        SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), user.UserId, null, null, action, true,
            clock.GetUtcNow(), "SigningCertificate", id), t);
}
