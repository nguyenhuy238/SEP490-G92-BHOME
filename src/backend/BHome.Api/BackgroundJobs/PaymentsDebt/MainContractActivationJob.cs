using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.Jobs;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainContractActivationJob(ContractService contracts) : IBackgroundJobHandler
{
    // Retain the existing persisted job name/key for backward compatibility; now handles Holding and Main.
    public const string JobName = "activate-paid-main-contract";
    public string Name => JobName;
    internal static JobSubmission Submission(Guid id) => new(JobName, $"paid-main:{id:N}", JsonSerializer.Serialize(id));
    public Task ExecuteAsync(JobExecution job, CancellationToken t) =>
        contracts.AutoActivatePaidMainAsync(JsonSerializer.Deserialize<Guid>(job.PayloadJson), t);
}

// Recovers paid contracts that predate automatic activation, and a missed scheduling attempt.
internal sealed class MainContractActivationScheduling(BHomePersistenceContext db, IBackgroundJobQueue jobs, ContractService contracts) : IJobScheduleContributor
{
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        if (db is not Compact24DbContext) return;
        var ids = await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => (c.ContractType == BHome.Domain.TenantContracts.ContractKind.Main || c.ContractType == BHome.Domain.TenantContracts.ContractKind.Holding) &&
            c.Status == ContractStatus.PendingActivation && c.PreviousContractId == null)
            .OrderBy(c => c.Id).Select(c => c.Id).ToArrayAsync(t);
        foreach (var id in ids)
            if (await contracts.AutomaticActivationReadyAsync(id, t))
                await jobs.EnqueueAsync(MainContractActivationJob.Submission(id), t);
    }
}
