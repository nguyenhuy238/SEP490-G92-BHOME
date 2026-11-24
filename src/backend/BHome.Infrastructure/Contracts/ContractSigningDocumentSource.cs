using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;

namespace BHome.Infrastructure.Contracts;

// Retrieves an immutable, reviewed PDF. The pure template renderer remains independent of persistence.
internal sealed class ContractSigningDocumentSource(BHomePersistenceContext db, IObjectStorage storage,
    IMainDraftData? mainData = null, IMainDraftRenderer? mainRenderer = null, ICurrentUser? user = null, TimeProvider? clock = null,
    IContractFileStore? fileStore = null, HoldingDepositRenderer? holdingRenderer = null) : IContractSigningDocumentSource
{
    public async Task<byte[]?> ReadAsync(ContractDocument document, CancellationToken t)
    {
        var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).ThenInclude(r => r.Location).Include(c => c.Signatures)
            .SingleOrDefaultAsync(c => c.Id == document.ContractId, t);
        if (contract is null) return null;
        if (contract.Kind == ContractKind.Holding)
            return await ReadHoldingAsync(contract, document, t);
        if (contract.DraftMetadata == "{}")
        {
            if (contract.Kind != ContractKind.Main) return null;
            var existing = await db.Set<ContractDocumentFile>().AsNoTracking().AnyAsync(f => f.ContractId == contract.Id &&
                f.Kind == ContractFileKind.Preview && f.SnapshotHash == contract.SnapshotHash && f.TemplateId == "main-tenancy-docx-v1", t);
            if (!existing)
            {
                // Reviewed Main drafts already persist their source; only Holding conversions need it generated here.
                if (contract.HoldingContractId is null) return null;
                // Never replace a document already handed to a signer or covered by signing evidence.
                if (contract.Signatures.Any(s => s.Status != SignatureStatus.Failed) || contract.InternalAcceptance != "{}" ||
                    await db.Set<ContractSigningInvitation>().AnyAsync(i => i.ContractId == contract.Id && i.SnapshotHash == contract.SnapshotHash &&
                        i.RevokedAt == null && (i.AcceptedAt != null || i.ExpiresAt > (clock == null ? DateTimeOffset.UtcNow : clock.GetUtcNow())), t)) return null;
                await CreateMainSourceAsync(contract, document, t);
            }
        }
        if (contract.DraftMetadata != "{}" && contract.Status == ContractStatus.Draft || contract.SnapshotHash != document.SnapshotHash || ContractDocumentSnapshot.Hash(document) != document.SnapshotHash)
            throw ContractException.Conflict("signed_terms_changed");
        var file = await db.Set<ContractDocumentFile>().AsNoTracking().SingleOrDefaultAsync(f => f.ContractId == contract.Id &&
            f.Kind == ContractFileKind.Preview && f.SnapshotHash == document.SnapshotHash && f.TemplateId == "main-tenancy-docx-v1", t)
            ?? throw ContractException.Conflict("signing_source_document_required");
        return await ReadFileAsync(file, t);
    }

    private async Task<byte[]?> ReadHoldingAsync(Contract contract, ContractDocument document, CancellationToken t)
    {
        if (contract.SnapshotHash != document.SnapshotHash || ContractDocumentSnapshot.Hash(document) != document.SnapshotHash)
            throw ContractException.Conflict("signed_terms_changed");
        var files = db.Set<ContractDocumentFile>();
        var candidates = files.AsNoTracking().Where(f => f.ContractId == contract.Id && f.Kind == ContractFileKind.Preview &&
            f.SnapshotHash == document.SnapshotHash && f.TemplateId == HoldingDepositRenderer.TemplateId);
        var existing = await candidates.SingleOrDefaultAsync(t);
        if (existing is not null) return await ReadFileAsync(existing, t);

        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"holding-docx-source:" + contract.Id},0))", t);
        existing = await candidates.SingleOrDefaultAsync(t);
        if (existing is not null)
        {
            if (transaction is not null) await transaction.CommitAsync(t);
            return await ReadFileAsync(existing, t);
        }

        // Keep previously reviewed bytes and the existing signing evidence across a template rollout.
        var invitation = await db.Set<ContractSigningInvitation>().AsNoTracking()
            .Where(i => i.ContractId == contract.Id && i.SnapshotHash == document.SnapshotHash && i.RevokedAt == null)
            .OrderByDescending(i => i.Id).FirstOrDefaultAsync(t);
        if (invitation is not null)
        {
            using var buffer = new MemoryStream();
            await storage.CopyToAsync(invitation.DocumentObjectKey, buffer, t);
            var bytes = buffer.ToArray();
            if (!ValidPdf(bytes, bytes.Length, invitation.DocumentHash))
                throw ContractException.Conflict("contract_document_integrity_failed");
            if (transaction is not null) await transaction.CommitAsync(t);
            return bytes;
        }
        if (contract.Signatures.Any(s => s.Status != SignatureStatus.Failed) || contract.InternalAcceptance != "{}")
            return null;
        if (mainData is null || fileStore is null || holdingRenderer is null || clock is null)
            throw new ContractException(503, "holding_contract_document_source_unavailable");
        if (user?.UserId is not { } actor) throw new ContractException(403, "contract_role_forbidden");
        var settings = await mainData.SettingsAsync(contract.Room.LocationId, contract.StartDate, t);
        if (settings is null || settings.OwnerSignerId != contract.OwnerSignerId)
            throw ContractException.Conflict("owner_contract_settings_required");
        var tenant = await mainData.IdentityAsync(contract.RoomId, contract.RepresentativeResidentId, t);
        var phone = await mainData.PhoneAsync(contract.RoomId, contract.RepresentativeResidentId, t);
        var pdf = await holdingRenderer.PdfAsync(contract, settings.Owner, tenant, phone, t);
        var file = new ContractDocumentFile
        {
            ContractId = contract.Id,
            Kind = ContractFileKind.Preview,
            SnapshotHash = document.SnapshotHash,
            TemplateId = HoldingDepositRenderer.TemplateId,
            TemplateVersion = HoldingDepositRenderer.DocumentVersion,
            ContentType = "application/pdf",
            FileHash = Convert.ToHexString(SHA256.HashData(pdf)),
            Length = pdf.Length,
            RecordedAt = clock.GetUtcNow(),
            RecordedByUserId = actor
        };
        file.ObjectKey = $"contracts/{contract.Id:N}/preview/{file.Id:N}.pdf";
        await fileStore.PutAsync(contract.RoomId, file.ObjectKey, pdf, file.ContentType, t);
        files.Add(file);
        await db.SaveChangesAsync(t);
        if (transaction is not null) await transaction.CommitAsync(t);
        return pdf;
    }

    private async Task<byte[]> ReadFileAsync(ContractDocumentFile file, CancellationToken t)
    {
        byte[] bytes;
        try
        {
            using var buffer = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, buffer, t); bytes = buffer.ToArray();
        }
        catch (FileNotFoundException)
        {
            // Invitations preserve copies of the reviewed bytes. Never render a replacement
            // or accept a different document under the original consent hash.
            var copies = await db.Set<ContractSigningInvitation>().AsNoTracking()
                .Where(i => i.ContractId == file.ContractId && i.SnapshotHash == file.SnapshotHash && i.DocumentHash == file.FileHash)
                .Select(i => i.DocumentObjectKey).Distinct().ToArrayAsync(t);
            byte[]? recovered = null;
            foreach (var key in copies)
            {
                try
                {
                    using var copy = new MemoryStream(); await storage.CopyToAsync(key, copy, t);
                    var candidate = copy.ToArray();
                    if (candidate.Length == file.Length && Convert.ToHexString(SHA256.HashData(candidate)) == file.FileHash)
                    { recovered = candidate; break; }
                }
                catch (FileNotFoundException) { }
            }
            bytes = recovered ?? throw ContractException.Conflict("signing_source_document_required");
        }
        if (!ValidPdf(bytes, file.Length, file.FileHash))
            throw ContractException.Conflict("contract_document_integrity_failed");
        return bytes;
    }

    private static bool ValidPdf(byte[] bytes, long length, string hash) => bytes.Length == length &&
        bytes.Length is >= 5 and <= 10 * 1024 * 1024 && bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) &&
        Convert.ToHexString(SHA256.HashData(bytes)) == hash;

    private async Task CreateMainSourceAsync(Contract c, ContractDocument document, CancellationToken t)
    {
        if (mainData is null || mainRenderer is null || fileStore is null) throw new ContractException(503, "main_contract_document_source_unavailable");
        if (user?.UserId is not { } actor) throw new ContractException(403, "contract_role_forbidden");
        if (c.SnapshotHash != document.SnapshotHash || ContractDocumentSnapshot.Hash(document) != c.SnapshotHash)
            throw ContractException.Conflict("signed_terms_changed");
        await using var ownTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(t) : null;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"main-docx-source:" + c.Id},0))", t);
        if (!await db.Set<ContractDocumentFile>().AnyAsync(f => f.ContractId == c.Id && f.Kind == ContractFileKind.Preview &&
            f.SnapshotHash == c.SnapshotHash && f.TemplateId == "main-tenancy-docx-v1", t))
        {
            var settings = await mainData.SettingsAsync(c.Room.LocationId, c.StartDate, t)
                ?? throw ContractException.Conflict("owner_contract_settings_required");
            if (settings.OwnerSignerId != c.OwnerSignerId) throw ContractException.Conflict("owner_contract_settings_required");
            var tenant = await mainData.IdentityAsync(c.RoomId, c.RepresentativeResidentId, t);
            var ids = await db.Set<ContractResident>().Where(r => r.ContractId == c.Id).Select(r => r.ResidentId).ToArrayAsync(t);
            var occupants = new List<string>();
            foreach (var id in ids.Where(id => id != c.RepresentativeResidentId)) occupants.Add((await mainData.IdentityAsync(c.RoomId, id, t)).FullName);
            var charges = ContractChargeSnapshot.Read(c).Charges.Select(p => new PolicyDto(p.PolicyId, c.Room.LocationId, c.RoomId,
                (ChargeCategory)p.Category, p.ChargeCode, p.Name ?? p.ChargeCode, (ChargingMethod)p.Method, p.Rate, p.EffectiveFrom, p.EffectiveTo, p.Version)).ToArray();
            var input = new MainDraftInput(c.RoomId, c.RepresentativeResidentId, ids, c.StartDate, c.EndDate, "",
                await mainData.PhoneAsync(c.RoomId, c.RepresentativeResidentId, t), "");
            var state = new MainDraftState(input, charges, settings.Version, "", mainRenderer.TemplateHash);
            var docx = await mainRenderer.DocxAsync(new(c, state, settings, tenant, c.Room.Location.Name, c.Room.RoomNumber, c.Room.Location.Address, occupants.ToArray(), SigningReview: true), t);
            var bytes = await mainRenderer.PdfAsync(docx, t);
            var file = new ContractDocumentFile
            {
                ContractId = c.Id,
                Kind = ContractFileKind.Preview,
                SnapshotHash = c.SnapshotHash,
                TemplateId = "main-tenancy-docx-v1",
                TemplateVersion = mainRenderer.DocumentVersion,
                DevelopmentOnly = true,
                ContentType = "application/pdf",
                FileHash = Convert.ToHexString(SHA256.HashData(bytes)),
                Length = bytes.Length,
                RecordedAt = clock?.GetUtcNow() ?? DateTimeOffset.UtcNow,
                RecordedByUserId = actor
            };
            file.ObjectKey = $"contracts/{c.Id:N}/preview/{file.Id:N}.pdf";
            await fileStore.PutAsync(c.RoomId, file.ObjectKey, bytes, file.ContentType, t);
            db.Add(file); await db.SaveChangesAsync(t);
        }
        if (ownTransaction is not null) await ownTransaction.CommitAsync(t);
    }
}
