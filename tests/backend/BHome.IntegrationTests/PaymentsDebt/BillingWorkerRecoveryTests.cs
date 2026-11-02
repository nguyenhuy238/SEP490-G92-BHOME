using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task ExistingPostgresWorkerRecoversExpiredQueueAndBusinessLeasesWithoutDuplicateTasks()
    {
        var(w,p,_)=await MeterWorkspace();var key=Guid.NewGuid().ToString();var unknown=Guid.NewGuid().ToString();Guid executionId;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var e=new BillingAutomationExecution{PlanId=p.Id,LocationId=w.Location,BillingPeriod=CurrentPeriod(),Phase="Meter",Status="Processing",Attempts=1,LastStartedAt=DateTimeOffset.UtcNow.AddMinutes(-5),LockedUntil=DateTimeOffset.UtcNow.AddMinutes(-3),LockToken=Guid.NewGuid()};db.Add(e);await db.SaveChangesAsync();executionId=e.Id;
            await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new("billing-meter",key,JsonSerializer.Serialize(new BillingJobInput(p.Id,CurrentPeriod()))),default);
            await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new("future-module.synthetic",unknown,"{}"),default);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BackgroundJobs\" SET \"AvailableAt\"={DateTimeOffset.UtcNow.AddDays(-2)} WHERE \"Name\"='future-module.synthetic' AND \"IdempotencyKey\"={unknown}");
            // Persisted state left by an interrupted process; the real worker performs recovery below.
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BackgroundJobs\" SET \"State\"='Processing',\"Attempts\"=1,\"LockedUntil\"={DateTimeOffset.UtcNow.AddMinutes(-3)},\"AvailableAt\"={DateTimeOffset.UtcNow.AddDays(-1)} WHERE \"Name\"='billing-meter' AND \"IdempotencyKey\"={key}");
        }
        var worker=fixture.Factory.Services.GetServices<IHostedService>().Single(x=>x.GetType().Name=="PostgresJobWorker");
        var process=worker.GetType().GetMethod("ProcessOneAsync",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!;
        Assert.True(await (Task<bool>)process.Invoke(worker,[CancellationToken.None])!);
        using(var owner=await Client(w.Owner))
        using(var tenant=await Client(w.Tenants[0]))
        {
            var route=$"/api/v1/billing-automation/queue?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}";
            var rows=(await owner.GetFromJsonAsync<BillingQueueView[]>(route))!;Assert.Contains(rows,j=>j.Name=="billing-meter"&&j.State=="Completed"&&j.Attempts==2);
            Assert.DoesNotContain("payload",(await owner.GetStringAsync(route)).ToLowerInvariant());Assert.Equal(HttpStatusCode.Forbidden,(await tenant.GetAsync(route)).StatusCode);
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            Assert.Equal(1,await db.Database.SqlQuery<int>($"SELECT COUNT(*)::int AS \"Value\" FROM \"BackgroundJobs\" WHERE \"Name\"='billing-meter' AND \"IdempotencyKey\"={key} AND \"State\"='Completed' AND \"Attempts\"=2").SingleAsync());
            Assert.Equal(1,await db.Database.SqlQuery<int>($"SELECT COUNT(*)::int AS \"Value\" FROM \"BackgroundJobs\" WHERE \"Name\"='future-module.synthetic' AND \"IdempotencyKey\"={unknown} AND \"State\"='Pending' AND \"Attempts\"=0").SingleAsync());
            Assert.Equal("Completed",(await db.Set<BillingAutomationExecution>().AsNoTracking().SingleAsync(e=>e.Id==executionId)).Status);
            Assert.Contains(await db.Set<BillingAutomationAttempt>().Where(a=>a.ExecutionId==executionId).ToArrayAsync(),a=>a.Status=="LeaseExpired");
            Assert.Equal(2,await db.Set<OperationalTask>().CountAsync(t=>t.AutomationPlanId==p.Id));
        }
        await Task.WhenAll(RunMeter(w),RunMeter(w));
        await using var last=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(2,await last.ServiceProvider.GetRequiredService<BHomeDbContext>().Set<OperationalTask>().CountAsync(t=>t.AutomationPlanId==p.Id));
    }
}
