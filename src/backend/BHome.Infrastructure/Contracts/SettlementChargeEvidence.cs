using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class SettlementChargeEvidence(BHomePersistenceContext db, IObjectStorage storage,
    IContractImageValidator images, IDepositDeductionEvidence inspectionEvidence) : ISettlementChargeEvidence
{
    public async Task<IReadOnlyList<DeductionEvidence>> CaptureUtilityAsync(Guid contractId, SettlementUtilitySource source, CancellationToken token)
    {
        var roomId = await db.Set<Contract>().AsNoTracking().Where(c => c.Id == contractId).Select(c => c.RoomId).SingleAsync(token);
        var points = new[] { source.Baseline, source.Final }.DistinctBy(p => p.ReadingId).ToArray();
        var ids = points.Select(p => p.ReadingId).ToArray();
        var files = await (from reading in db.Set<MeterReading>().AsNoTracking()
                           join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                           join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
                           join proof in db.Set<MeterEvidence>() on reading.EvidenceId equals proof.Id
                           where ids.Contains(reading.Id) && reading.MeterId == source.MeterId && meter.RoomId == roomId &&
                             task.Status == MeterTaskStatus.Completed && proof.IsLinked && proof.IsUploaded
                           select new
                           {
                               reading.Id,
                               reading.ConfirmedValue,
                               task.ReadingDate,
                               ProofId = proof.Id,
                               proof.ObjectKey,
                               proof.ImageHash,
                               proof.Length,
                               proof.ContentType
                           }).ToArrayAsync(token);
        if (files.Length != points.Length) throw ContractException.Conflict("settlement_evidence_integrity_failed");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var captured = new List<DeductionEvidence>();
        foreach (var file in files)
        {
            var expected = points.Single(p => p.ReadingId == file.Id);
            if (file.ConfirmedValue != expected.Value || file.ReadingDate != expected.Date || file.ProofId != expected.EvidenceId ||
                file.ImageHash != expected.ImageHash || file.Length != expected.Length || file.Length is <= 0 or > 5 * 1024 * 1024)
                throw ContractException.Conflict("settlement_evidence_integrity_failed");
            using var content = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, content, deadline.Token);
            if (content.Length != file.Length) throw ContractException.Conflict("settlement_evidence_integrity_failed");
            var bytes = content.ToArray(); var hash = Convert.ToHexString(SHA256.HashData(bytes));
            if (hash != expected.ImageHash || images.Validate(bytes) != file.ContentType) throw ContractException.Conflict("settlement_evidence_integrity_failed");
            captured.Add(new(file.ProofId, bytes.LongLength, hash));
        }
        return captured.OrderBy(e => e.Id).ToArray();
    }
    public async Task VerifyAsync(SettlementReceivable charge, CancellationToken token)
    {
        var current = charge.Utility is { } utility ? await CaptureUtilityAsync(charge.ContractId, utility, token) :
            await inspectionEvidence.CaptureAsync(charge.ContractId, charge.Evidence.Select(e => e.Id).Order().ToArray(), token);
        if (!current.OrderBy(e => e.Id).SequenceEqual(charge.Evidence.OrderBy(e => e.Id))) throw ContractException.Conflict("settlement_evidence_integrity_failed");
    }
}
