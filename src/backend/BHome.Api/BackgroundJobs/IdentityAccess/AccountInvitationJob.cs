using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.IdentityAccess;

internal sealed class AccountInvitationJob(Compact24DbContext db, AccountInvitations invitations) : IBackgroundJobHandler
{
    public const string JobName = "post-activation-account-invitation";
    public string Name => JobName;
    public async Task ExecuteAsync(JobExecution job, CancellationToken t)
    {
        var accepted = await db.Database.SqlQuery<string>($"""
            SELECT COALESCE(task_data->>'invitationDispatchState','') AS "Value"
            FROM operational_tasks WHERE id={job.Id} AND task_type='SYSTEM_JOB'
            """).SingleAsync(t);
        if (accepted is "AcceptedByProvider" or "SupersededByExistingInvitation" or "Queued") return;
        var input = JsonSerializer.Deserialize<ApprovedTenantInvitation>(job.PayloadJson) ?? throw new InvalidOperationException("Invalid invitation intent.");
        var email = await db.Set<Native.Resident>().Where(r => r.Id == input.ResidentId &&
            db.Set<Native.Contract>().Any(c => c.Id == input.ContractId &&
                c.OwnerSignerId == input.OwnerId && c.Status == (short)BHome.Domain.TenantContracts.ContractStatus.Active &&
                c.ContractType != "HOLDING" &&
                db.Set<Native.ContractResident>().Any(cr => cr.ContractId == c.Id && cr.ResidentId == r.Id)))
            .Select(r => r.ContactEmail).SingleOrDefaultAsync(t);
        if (email is null) throw new InvalidOperationException("Active tenancy invitation requires Owner review.");
        if (await db.Set<Native.Resident>().AnyAsync(r => r.Id == input.ResidentId &&
            db.Users.Any(u => u.Id == r.UserId && u.EmailConfirmed), t)) return;
        await invitations.InviteApprovedAsync(input.OwnerId, input.ResidentId, new(email), t, job.Id);
    }
}
