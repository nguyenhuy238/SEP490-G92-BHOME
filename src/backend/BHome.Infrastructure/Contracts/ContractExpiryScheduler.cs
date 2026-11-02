using BHome.Application.Jobs;
using BHome.Infrastructure.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractExpiryScheduler(IServiceScopeFactory scopes,IOptions<JobWorkerOptions> options,TimeProvider clock,ILogger<ContractExpiryScheduler> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if(!options.Value.Enabled)return;
        while(!stoppingToken.IsCancellationRequested)
        {
            var local=TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(),"Asia/Ho_Chi_Minh");
            try
            {
                await using var scope=scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new(ContractExpiryProcessor.JobName,local.ToString("yyyy-MM-dd"),"{}"),stoppingToken);
            }
            catch(OperationCanceledException)when(stoppingToken.IsCancellationRequested){break;}
            catch(Exception e){logger.LogError("Contract expiry scheduling failed with {ErrorCode}",e.GetType().Name);await Task.Delay(TimeSpan.FromSeconds(30),stoppingToken);continue;}
            var next=new DateTimeOffset(local.Date.AddDays(1),local.Offset);
            await Task.Delay(next-clock.GetUtcNow(),stoppingToken);
        }
    }
}
