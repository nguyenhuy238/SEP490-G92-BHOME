using System.Net;
using System.Net.Http.Json;
using BHome.Domain.Billing;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Native = BHome.Domain.Entities;

namespace BHome.IntegrationTests.Billing;

[Trait("Category", "CompactPostgres")]
public sealed class NativeBillingAutomationPersistenceTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public Task ScheduleAndExecutionPreserveVersionsAndLease() =>
        new InvoiceApiTests(fixture.Capture).NativeScheduleAndExecutionPreserveVersionsAndLease();
}

public sealed partial class InvoiceApiTests
{
    internal async Task NativeScheduleAndExecutionPreserveVersionsAndLease()
    {
        var w = await Setup();
        const string path = "/api/v1/billing-schedules";
        var input = Schedule(w);
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync(path, input));
        await Success<BillingSchedule>(await w.Owner.Client.PutAsJsonAsync(path, input with { ExpectedVersion = 1, DueDay = 15 }));
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PutAsJsonAsync(path, input with { ExpectedVersion = 1 })).StatusCode);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var location = await db.Set<Native.Location>().AsNoTracking().SingleAsync(l => l.Id == w.Location);
        Assert.Equal(2, location.OperatingSettings.GetProperty("billingSchedule").GetProperty("version").GetInt32());
        Assert.Equal(15, location.OperatingSettings.GetProperty("billingSchedule").GetProperty("dueDay").GetInt32());
        Assert.Equal(2, location.History.EnumerateArray().Count(h => h.TryGetProperty("recordType", out var type) && type.GetString() == "BillingSchedule"));

        var token = Guid.NewGuid();
        var execution = new BillingAutomationExecution
        {
            LocationId = w.Location,
            PlanId = Guid.NewGuid(),
            BillingPeriod = w.Period,
            Phase = "Meter",
            Status = "Processing",
            Attempts = 1,
            LastStartedAt = DateTimeOffset.UtcNow,
            LockToken = token,
            LockedUntil = DateTimeOffset.UtcNow.AddMinutes(2)
        };
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await NativeBillingJobPersistence.SaveAsync(db, execution, true, null, default);
            await tx.CommitAsync();
        }
        execution.Status = "Completed"; execution.LockedUntil = null; execution.LockToken = null;
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() =>
                NativeBillingJobPersistence.SaveAsync(db, execution, false, Guid.NewGuid(), default));
            await tx.RollbackAsync();
        }
        Assert.Equal(token, (await NativeBillingJobPersistence.ByIdAsync(db, execution.Id, default)).LockToken);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await NativeBillingJobPersistence.SaveAsync(db, execution, false, token, default);
            await NativeBillingJobPersistence.AppendAttemptAsync(db, new BillingAutomationAttempt
            {
                ExecutionId = execution.Id,
                Sequence = 1,
                Status = "Completed",
                StartedAt = execution.LastStartedAt,
                FinishedAt = DateTimeOffset.UtcNow
            }, default);
            await tx.CommitAsync();
        }
        var completed = await NativeBillingJobPersistence.ExecutionAsync(db, execution.PlanId, w.Period, "Meter", default);
        Assert.Equal("Completed", completed!.Status);
        Assert.Null(completed.LockToken);
        Assert.Single(await NativeBillingJobPersistence.AttemptsAsync(db, w.Location, w.Period, default));
    }
}
