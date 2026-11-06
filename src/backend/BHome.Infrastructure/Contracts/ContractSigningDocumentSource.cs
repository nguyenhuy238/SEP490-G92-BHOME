using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.Contracts;

// Retrieves an immutable, reviewed PDF. The pure template renderer remains independent of persistence.
internal sealed class ContractSigningDocumentSource(BHomePersistenceContext db, IObjectStorage storage, IHostEnvironment environment) : IContractSigningDocumentSource
{
    public async Task<byte[]?> ReadAsync(ContractDocument document, CancellationToken t)
    {
        var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == document.ContractId, t);
        if (contract is null || contract.DraftMetadata == "{}") return null;
        if (contract.Status == ContractStatus.Draft || contract.SnapshotHash != document.SnapshotHash || ContractDocumentSnapshot.Hash(document) != document.SnapshotHash)
            throw ContractException.Conflict("signed_terms_changed");
        var file = await db.Set<ContractDocumentFile>().AsNoTracking().SingleOrDefaultAsync(f => f.ContractId == contract.Id &&
            f.Kind == ContractFileKind.Preview && f.SnapshotHash == document.SnapshotHash && f.TemplateId == "main-tenancy-docx-v1", t)
            ?? throw ContractException.Conflict("signing_source_document_required");
        if (file.DevelopmentOnly && !(environment.IsDevelopment() || environment.IsEnvironment("Testing")))
            throw new ContractException(503, "main_draft_signing_template_not_approved");
        using var buffer = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, buffer, t); var bytes = buffer.ToArray();
        if (bytes.Length != file.Length || bytes.Length < 5 || bytes.Length > 10 * 1024 * 1024 || !bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) || Convert.ToHexString(SHA256.HashData(bytes)) != file.FileHash)
            throw ContractException.Conflict("contract_document_integrity_failed");
        return bytes;
    }
}
