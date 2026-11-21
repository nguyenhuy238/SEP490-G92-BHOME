using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class FinancialScenarioRepository(BHomePersistenceContext db) : IFinancialScenarioRepository
{
    private IQueryable<ScenarioRow> Rows => db.Database.SqlQueryRaw<ScenarioRow>("""
        SELECT id AS "Id",name AS "Name",location_id AS "LocationId",baseline_from AS "BaselineFrom",baseline_to AS "BaselineTo",
          forecast_months::integer AS "ForecastMonths",calculated_at AS "CalculatedAt",created_by_user_id AS "Actor",
          assumptions::text AS "Input",baseline_snapshot::text AS "Baseline",result_snapshot::text AS "Result",calculation_version AS "Version"
        FROM financial_scenarios
        """);
    private static ScenarioView View(ScenarioRow row) => new(row.Id, JsonSerializer.Deserialize<ScenarioInput>(row.Input)!,
        JsonSerializer.Deserialize<FinancialReport>(row.Baseline)!, JsonSerializer.Deserialize<ScenarioResult>(row.Result)!, row.Version);
    public async Task<ScenarioView?> GetAsync(Guid id, Guid actor, CancellationToken token) =>
        await Rows.SingleOrDefaultAsync(s => s.Id == id && s.Actor == actor, token) is { } row ? View(row) : null;
    public async Task<IReadOnlyList<ScenarioSummary>> ListAsync(Guid actor, int page, int pageSize, CancellationToken token) =>
        await Rows.Where(s => s.Actor == actor).OrderByDescending(s => s.CalculatedAt).ThenBy(s => s.Id).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(s => new ScenarioSummary(s.Id, s.Name, s.LocationId, s.BaselineFrom, s.BaselineTo, s.ForecastMonths, s.CalculatedAt)).ToArrayAsync(token);
    public async Task<ScenarioView> SaveAsync(Guid key, Guid actor, ScenarioView view, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        var source = "financial-scenario:" + key;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({source},0))", token);
        if (await Rows.SingleOrDefaultAsync(s => s.Id == key, token) is { } existing)
        {
            if (existing.Actor != actor || View(existing).Input != view.Input) throw new FinanceException(409, "scenario_idempotency_conflict");
            await tx.CommitAsync(token); return View(existing);
        }
        var input = view.Input; var assumptions = JsonSerializer.Serialize(input); var baseline = JsonSerializer.Serialize(view.Baseline); var result = JsonSerializer.Serialize(view.Result);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO financial_scenarios(id,location_id,name,baseline_from,baseline_to,forecast_months,assumptions,baseline_snapshot,result_snapshot,calculation_version,created_by_user_id,calculated_at)
            VALUES({key},{input.Baseline.LocationId},{input.Name},{input.Baseline.From},{input.Baseline.To},{(short)input.ForecastMonths},{assumptions}::jsonb,{baseline}::jsonb,{result}::jsonb,{view.CalculationVersion},{actor},{view.Baseline.SnapshotAt})
            """, token);
        await tx.CommitAsync(token); return view with { Id = key };
    }
}
public sealed class ScenarioRow
{
    public Guid Id { get; set; }
    public string Name { get; set; } = ""; public Guid? LocationId { get; set; }
    public DateOnly BaselineFrom { get; set; }
    public DateOnly BaselineTo { get; set; }
    public int ForecastMonths { get; set; }
    public DateTimeOffset CalculatedAt { get; set; }
    public Guid Actor { get; set; }
    public string Input { get; set; } = ""; public string Baseline { get; set; } = ""; public string Result { get; set; } = ""; public string Version { get; set; } = "";
}
