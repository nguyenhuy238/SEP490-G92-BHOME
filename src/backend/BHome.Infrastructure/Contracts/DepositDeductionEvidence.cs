using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.Storage;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal sealed class DepositDeductionEvidence(BHomePersistenceContext db, IObjectStorage storage, IContractImageValidator images)
    : IDepositDeductionEvidence
{
    public async Task<IReadOnlyList<DeductionEvidence>> CaptureAsync(Guid contractId, Guid[] ids, CancellationToken token)
    {
        if (ids.Length > 5) throw ContractException.Invalid("deduction_evidence_limit");
        var files = await db.Set<ContractInspectionEvidence>().AsNoTracking().Where(e => e.ContractId == contractId && e.IsLinked && ids.Contains(e.Id))
            .OrderBy(e => e.Id).ToArrayAsync(token);
        if (files.Length != ids.Length) throw ContractException.Conflict("deduction_evidence_not_available");
        var result = new List<DeductionEvidence>();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        foreach (var file in files)
        {
            using var content = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, content, deadline.Token);
            if (content.Length > 5 * 1024 * 1024) throw ContractException.Conflict("deduction_evidence_integrity_failed");
            var bytes = content.ToArray();
            if (images.Validate(bytes) != file.ContentType) throw ContractException.Conflict("deduction_evidence_integrity_failed");
            result.Add(new(file.Id, bytes.LongLength, Convert.ToHexString(SHA256.HashData(bytes))));
        }
        return result;
    }
    public async Task VerifyAsync(DepositDeductionPlan plan, CancellationToken token)
    {
        var current = await CaptureAsync(plan.ContractId, plan.Evidence.Select(e => e.Id).Order().ToArray(), token);
        if (!current.OrderBy(e => e.Id).SequenceEqual(plan.Evidence.OrderBy(e => e.Id)))
            throw ContractException.Conflict("deduction_evidence_integrity_failed");
    }
}
