using BHome.Application.Jobs;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PaymentsDebt;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.Infrastructure.PaymentsDebt;

// Each invocation gets a fresh scope. Concurrent webhook/polling jobs never share selected credentials.
internal sealed class SePayModeJob(IServiceScopeFactory scopes, SePayOptions configuration, string mode, bool polling) : IBackgroundJobHandler
{
    public string Name => "sepay-" + (polling ? "poll-" : "reconcile-") + mode.ToLowerInvariant();
    public bool Enabled => true; // Owner connections are loaded asynchronously inside the job scope.
    public async Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        _ = configuration;
        using var payload = JsonDocument.Parse(job.PayloadJson);
        Guid? owner = payload.RootElement.TryGetProperty("OwnerId", out var ownerValue) && ownerValue.ValueKind == JsonValueKind.String && ownerValue.TryGetGuid(out var ownerId) ? ownerId : null;
        if (!polling && owner is null && payload.RootElement.TryGetProperty("EventId", out var eventValue))
            owner = (await scope.ServiceProvider.GetRequiredService<ISePayRepository>().EventAsync(eventValue.GetGuid(), cancellationToken)).OwnerId;
        if (owner is { } configuredOwner)
            await scope.ServiceProvider.GetRequiredService<ISePayOwnerConnections>().ApplyOwnerAsync(configuredOwner, cancellationToken);
        var selected = scope.ServiceProvider.GetRequiredService<SePayOptions>(); selected.Select(mode);
        if (!selected.Enabled || polling && string.IsNullOrWhiteSpace(selected.ApiToken)) throw new PaymentException(503, "sepay_disabled");
        IBackgroundJobHandler handler = polling
            ? ActivatorUtilities.CreateInstance<SePayPollingJob>(scope.ServiceProvider)
            : ActivatorUtilities.CreateInstance<SePayReconciliationJob>(scope.ServiceProvider);
        await handler.ExecuteAsync(job, cancellationToken);
    }
}
