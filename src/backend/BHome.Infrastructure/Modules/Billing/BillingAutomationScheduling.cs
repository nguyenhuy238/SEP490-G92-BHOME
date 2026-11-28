using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace BHome.Infrastructure.Modules.Billing;
internal sealed class BillingAutomationScheduling(BHomePersistenceContext db, IBillingAutomationSchedules schedules, IBackgroundJobQueue queue, TimeProvider clock, BillingAutomationRuntime runtime, BillingMeterOverdueNotifier overdue) : IJobScheduleContributor
{
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        if (!runtime.WorkerEnabled) return;
        var now = clock.GetUtcNow(); var today = clock.BusinessToday(); var month = new DateOnly(today.Year, today.Month, 1); Guid? after = null;
        while (true)
        {
            var locations = await db.Set<BillingAutomationPlan>().Where(p => after == null || p.LocationId.CompareTo(after.Value) > 0).Select(p => p.LocationId).Distinct().OrderBy(id => id).Take(100).ToArrayAsync(t);
            if (locations.Length == 0) break;
            foreach (var location in locations)
            {
                // Keep retrying unfinished prior periods even after the ordinary
                // two-month lookback window, without generating arbitrary old invoices.
                var pending = await db.Set<BillingAutomationExecution>().AsNoTracking()
                    .Where(e => e.LocationId == location && e.BillingPeriod < month.AddMonths(-2) &&
                        (e.Status == "PendingInputs" || e.Status == "Processing"))
                    .Select(e => e.BillingPeriod).Distinct().ToArrayAsync(t);
                foreach (var period in new[] { month, month.AddMonths(-1), month.AddMonths(-2) }.Concat(pending).Distinct())
                {
                    var plan = await schedules.ForPeriodAsync(location, period, t);
                    if (plan?.Enabled != true) continue;
                    foreach (var phase in new[] { "Meter", "Draft", "Final" })
                    {
                        if (phase == "Final" && !plan.AuthorizeAutomaticFinalization) continue;
                        if (today < BillingAutomationEngine.ScheduledDate(plan, period, phase)) continue;
                        if (!await schedules.AuthorizedAsync(plan, plan.AuthorizedByUserId, period, phase == "Final", t)) continue;
                        var execution = await db.Set<BillingAutomationExecution>().AsNoTracking().SingleOrDefaultAsync(e => e.PlanId == plan.Id && e.BillingPeriod == period && e.Phase == phase, t);
                        if (execution?.Status == "Completed" || execution is { Status: "Failed", Attempts: >= 4 }) continue;
                        if (execution?.LockedUntil > now) continue;
                        await queue.EnqueueAsync(new(phase == "Meter" ? "billing-meter" : phase == "Draft" ? "billing-draft" : "billing-final", $"{plan.Id:N}/{period:yyyyMM}/{phase}/{now:yyyyMMddHHmm}", JsonSerializer.Serialize(new BillingJobInput(plan.Id, period))), t);
                    }
                }
            }
            after = locations[^1];
        }
        await overdue.NotifyAsync(t);
    }
}
