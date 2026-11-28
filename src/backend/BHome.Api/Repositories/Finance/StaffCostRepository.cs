using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

public sealed class StaffCostRepository(BHomePersistenceContext db) : IStaffCostRepository
{
    public async Task<IReadOnlyList<StaffCostCandidate>> CandidatesAsync(DateOnly period, CancellationToken token)
    {
        var end = period.AddMonths(1).AddDays(-1);
        var rows = await db.Database.SqlQuery<StaffCostCandidateRow>($"""
            SELECT e.id AS "EmploymentId",e.staff_user_id AS "StaffId",
              COALESCE(NULLIF(u.full_name,''),u.email,u.id::text) AS "StaffName",
              e.start_date AS "StartDate",e.end_date AS "EndDate",e.salary_type AS "SalaryType",e.base_rate::text AS "BaseRate",
              COALESCE((SELECT jsonb_agg(jsonb_build_object('locationId',l.id,'locationName',l.name) ORDER BY l.name,l.id)
                FROM locations l WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a
                  WHERE (a->>'staffUserId')::uuid=e.staff_user_id AND (a->>'startDate')::date<=LEAST({end},COALESCE(e.end_date,{end}))
                    AND (a->>'endDate')::date>=GREATEST({period},e.start_date))),'[]'::jsonb)::text AS "Locations",
              EXISTS(SELECT 1 FROM expenses x WHERE x.source_key LIKE ('staff-cost:'||e.staff_user_id::text||':'||to_char({period}::date,'YYYYMM')||':salary:%')) AS "Recorded"
            FROM staff_employments e JOIN users u ON u.id=e.staff_user_id
            WHERE e.start_date<={end} AND (e.end_date IS NULL OR e.end_date>={period}) AND lower(e.status) IN ('active','ended')
            ORDER BY u.full_name,e.start_date,e.id
            """).ToArrayAsync(token);
        return rows.Select(r => new StaffCostCandidate(r.EmploymentId, r.StaffId, r.StaffName, r.StartDate, r.EndDate, r.SalaryType, r.BaseRate,
            JsonSerializer.Deserialize<StaffCostLocation[]>(r.Locations, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [], r.Recorded)).ToArray();
    }

    public async Task<IReadOnlyList<Guid>> RecordAsync(StaffCostInput input, Guid key, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var candidate = (await CandidatesAsync(input.Period, token)).SingleOrDefault(c => c.EmploymentId == input.EmploymentId)
            ?? throw new FinanceException(404, "staff_employment_not_found");
        var prefix = $"staff-cost:{candidate.StaffId}:{input.Period:yyyyMM}:" + (input.Category == "Lương" ? "salary:" : $"{key}:");
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({prefix},0))", token);
        var normalized = input with { Shares = input.Shares.OrderBy(s => s.LocationId).ToArray() };
        var snapshot = JsonSerializer.Serialize(new { operationKey = key, actorId = actor, input = normalized });
        var existing = await db.Database.SqlQuery<StaffCostExisting>($"""
            SELECT id AS "Id",history->0->>'snapshot' AS "Snapshot" FROM expenses WHERE source_key LIKE {prefix + "%"}
            ORDER BY source_key
            """).ToArrayAsync(token);
        if (existing.Length > 0)
        {
            if (existing.Length != input.Shares.Length || existing.Any(e => e.Snapshot != snapshot))
                throw new FinanceException(409, "staff_cost_already_recorded");
            await transaction.CommitAsync(token);
            return existing.Select(e => e.Id).ToArray();
        }
        if (input.Shares.Any(s => !candidate.Locations.Any(l => l.LocationId == s.LocationId)))
            throw new FinanceException(400, "staff_cost_location_not_assigned");
        var result = new List<Guid>();
        foreach (var share in normalized.Shares)
        {
            var id = Guid.NewGuid();
            var source = prefix + share.LocationId;
            var history = JsonSerializer.Serialize(new[] { new { action = "StaffCostAllocated", snapshot, recordedAt = now, employmentId = candidate.EmploymentId, staffId = candidate.StaffId, candidate.BaseRate } });
            var note = candidate.StaffName + " · " + input.Note;
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO expenses(id,location_id,expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
                VALUES({id},{share.LocationId},'OPERATING',{input.Category},{share.Amount},{input.Period},{note},{source},{actor},{history}::jsonb)
                """, token);
            result.Add(id);
        }
        await transaction.CommitAsync(token);
        return result;
    }
}
public sealed class StaffCostCandidateRow
{
    public Guid EmploymentId { get; set; }
    public Guid StaffId { get; set; }
    public string StaffName { get; set; } = "";
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string? SalaryType { get; set; }
    public string? BaseRate { get; set; }
    public string Locations { get; set; } = "[]";
    public bool Recorded { get; set; }
}
public sealed class StaffCostExisting
{
    public Guid Id { get; set; }
    public string? Snapshot { get; set; }
}
