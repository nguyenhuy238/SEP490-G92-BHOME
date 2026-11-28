namespace BHome.Application.Finance;

public interface IFinancialScenarioRepository
{
    Task<ScenarioView> SaveAsync(Guid key, Guid actor, ScenarioView view, CancellationToken token);
    Task<IReadOnlyList<ScenarioSummary>> ListAsync(Guid actor, int page, int pageSize, CancellationToken token);
    Task<ScenarioView?> GetAsync(Guid id, Guid actor, CancellationToken token);
    Task<ForecastObligations> ObligationsAsync(ReportFilter baseline, DateOnly month, CancellationToken token);
    Task<T> ReadSnapshotAsync<T>(Func<Task<T>> read, CancellationToken token);
}
