using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainContractActivationJob(ContractService contracts) : IBackgroundJobHandler
{
    public const string JobName = "activate-paid-main-contract";
    public string Name => JobName;
    internal static JobSubmission Submission(Guid id) => new(JobName, $"paid-main:{id:N}", JsonSerializer.Serialize(id));
    public Task ExecuteAsync(JobExecution job, CancellationToken t) =>
        contracts.AutoActivatePaidMainAsync(JsonSerializer.Deserialize<Guid>(job.PayloadJson), t);
}

// Recovers paid contracts that predate automatic activation, and a missed scheduling attempt.
internal sealed class MainContractActivationScheduling(BHomePersistenceContext db, IBackgroundJobQueue jobs)
{
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        if (db is not Compact24DbContext) return;
        var ids = await db.Set<Contract>().AsNoTracking().Where(c => c.Kind == ContractKind.Main &&
            c.Status == ContractStatus.PendingActivation && c.InitialPaymentRequired && c.PreviousContractId == null &&
            db.Set<PaymentAllocation>().Any(a => a.TargetInitialContractId == c.Id))
            .OrderBy(c => c.Id).Select(c => c.Id).Take(100).ToArrayAsync(t);
        foreach (var id in ids) await jobs.EnqueueAsync(MainContractActivationJob.Submission(id), t);
    }
}
