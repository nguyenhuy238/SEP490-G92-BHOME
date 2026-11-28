using System.Text.Json;
using BHome.Application.Finance;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using FinancialScenario = BHome.Domain.Entities.FinancialScenario;

namespace BHome.Infrastructure.Finance;

public sealed class FinancialScenarioRepository(BHomePersistenceContext db) : IFinancialScenarioRepository
{
    public async Task<T> ReadSnapshotAsync<T>(Func<Task<T>> read, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, token);
        var value = await read();
        await tx.CommitAsync(token);
        return value;
    }

    public async Task<ForecastObligations> ObligationsAsync(ReportFilter baseline, DateOnly month, CancellationToken token)
    {
        var locationId = baseline.LocationId;
        var end = month.AddMonths(1).AddDays(-1);
        await using var tx = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, token) : null;
        var rules = await db.Database.SqlQuery<RecurringRuleRow>($"""
            SELECT id AS "Id",location_id AS "LocationId",
                (task_data->'document')::text AS "CurrentJson",history::text AS "HistoryJson"
            FROM operational_tasks WHERE task_type='SYSTEM_JOB'
              AND task_data->>'recordType'='SetupRecurringExpenseRule'
              AND ({locationId}::uuid IS NULL OR location_id={locationId})
            """).ToArrayAsync(token);
        var due = rules.SelectMany(rule => RecurringExpenseJob.DuePeriods(rule, end))
            .Where(item => item.Due >= month).ToArray();
        var candidates = await new StaffCostRepository(db).CandidatesAsync(month, token);
        var fullMonthAssignments = locationId is null ? Array.Empty<Guid>() :
            await db.Database.SqlQuery<Guid>($"""
                SELECT DISTINCT (a->>'staffUserId')::uuid AS "Value"
                FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
                WHERE l.id={locationId} AND (a->>'startDate')::date<={month}
                    AND (a->>'endDate')::date>={end}
                """).ToArrayAsync(token);
        var fullMonthStaff = fullMonthAssignments.ToHashSet();
        var staff = candidates.GroupBy(c => c.StaffId)
            .Where(g => locationId is null || g.Any(c => c.Locations.Any(l => l.LocationId == locationId))).ToArray();
        decimal salary = 0;
        var unresolved = 0;
        foreach (var group in staff)
        {
            var terms = group.ToArray();
            if (terms.Length != 1 || terms[0].StartDate > month || terms[0].EndDate < end ||
                terms[0].SalaryType != "Monthly" || !decimal.TryParse(terms[0].BaseRate,
                    System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var rate) ||
                rate < 0 || (locationId is not null && (terms[0].Locations.Count != 1 || !fullMonthStaff.Contains(group.Key))))
            {
                unresolved++;
                continue;
            }
            salary += rate;
        }
        var historical = await db.Database.SqlQuery<ForecastHistoricalCost>($"""
            SELECT COALESCE(sum(amount) FILTER(WHERE category='Chi phí định kỳ' AND source_key LIKE 'recurring-expense:%'),0) AS "Recurring",
                COALESCE(sum(amount) FILTER(WHERE category='Lương' AND source_key LIKE 'staff-cost:%:salary:%'),0) AS "Salary"
            FROM expenses WHERE expense_type='OPERATING' AND occurred_on>={baseline.From} AND occurred_on<={baseline.To}
                AND ({locationId}::uuid IS NULL OR location_id={locationId})
            """).SingleAsync(token);
        // Match original invoice lines and approved adjustments by their actual
        // charge codes. Unclassifiable adjustments or incomplete snapshots are
        // not silently treated as zero service revenue.
        var invoices = db.Set<Invoice>().AsNoTracking().Where(i =>
            i.Status == InvoiceStatus.Final && i.BillingPeriod >= baseline.From && i.BillingPeriod <= baseline.To &&
            (locationId == null || i.LocationId == locationId));
        var invoiceTotals = await invoices.Select(i => new { i.Id, i.Total }).ToArrayAsync(token);
        var lines = await db.Set<InvoiceLine>().AsNoTracking().Where(l => invoices.Any(i => i.Id == l.InvoiceId))
            .GroupBy(l => new { l.InvoiceId, l.ChargeCode, l.Category })
            .Select(g => new { g.Key.InvoiceId, g.Key.ChargeCode, g.Key.Category, Amount = g.Sum(l => l.Amount) }).ToArrayAsync(token);
        var adjustments = await db.Set<InvoiceAdjustmentDecision>().AsNoTracking()
            .Where(d => d.InvoiceStatus == InvoiceStatus.Final && d.Outcome == "Approved" && invoices.Any(i => i.Id == d.InvoiceId))
            .Select(d => new { d.InvoiceId, d.ChargeCode, d.Delta }).ToArrayAsync(token);
        var byInvoice = lines.ToLookup(l => l.InvoiceId);
        var byAdjustment = adjustments.ToLookup(d => d.InvoiceId);
        decimal? nonRent = invoiceTotals.Length == 0 ? null : 0;
        foreach (var invoice in invoiceTotals)
        {
            var items = byInvoice[invoice.Id].ToArray();
            if (items.Length == 0 || items.Sum(l => l.Amount) != invoice.Total ||
                items.Any(l => !Enum.IsDefined(l.Category)))
            {
                nonRent = null;
                break;
            }
            var codes = items.ToLookup(l => l.ChargeCode, StringComparer.Ordinal);
            var deltas = byAdjustment[invoice.Id].ToArray();
            if (deltas.Any(d => d.ChargeCode is null || codes[d.ChargeCode].Select(l => l.Category).Distinct().Count() != 1))
            {
                nonRent = null;
                break;
            }
            var amount = items.Where(l => l.Category != ChargeCategory.Rent).Sum(l => l.Amount) +
                deltas.Where(d => codes[d.ChargeCode!].First().Category != ChargeCategory.Rent).Sum(d => d.Delta);
            if (amount < 0)
            {
                nonRent = null;
                break;
            }
            nonRent += amount;
        }
        var cohort = await db.Database.SqlQuery<ForecastPaymentCohort>($"""
            WITH incurred AS (
              SELECT e.amount, count(h->'state') confirmations,
                COALESCE(sum((h->'state'->>'amount')::numeric) FILTER(
                  WHERE (h->'state'->>'paidOn')::date<={baseline.To}),0) paid
              FROM expenses e
              LEFT JOIN LATERAL (SELECT h FROM jsonb_array_elements(e.history) h WHERE h->>'recordType'='ExpensePaymentV1') p ON TRUE
              WHERE expense_type='OPERATING' AND occurred_on BETWEEN {baseline.From} AND {baseline.To}
                AND ({locationId}::uuid IS NULL OR location_id={locationId})
              GROUP BY e.id,e.amount
            )
            SELECT COALESCE(sum(amount),0) AS "Incurred", COALESCE(sum(paid),0) AS "Paid",
              COALESCE(bool_or(confirmations=0 OR paid<0 OR paid>amount),false) AS "Unknown"
            FROM incurred
            """).SingleAsync(token);
        // Calendar room-days, not contracts or residents. Conflicting signed
        // rent terms in a room are unresolved rather than choosing one payer.
        var rent = await db.Database.SqlQuery<ForecastRentRow>($"""
            WITH scoped AS (
              SELECT id FROM rooms WHERE ({locationId}::uuid IS NULL OR location_id={locationId})
            ), contracts_in_month AS (
              SELECT c.room_id,c.monthly_rent,c.start_date,COALESCE(c.actual_end_date,c.end_date) end_on
              FROM contracts c JOIN scoped r ON r.id=c.room_id
              WHERE c.contract_type='MAIN' AND c.status=3 AND c.activated_at IS NOT NULL
                AND c.start_date<={end} AND COALESCE(c.actual_end_date,c.end_date)>={month}
            ), rates AS (
              SELECT room_id,min(monthly_rent) rent,
                bool_and(monthly_rent IS NOT NULL AND monthly_rent>0)
                  AND min(monthly_rent)=max(monthly_rent) valid
              FROM contracts_in_month GROUP BY room_id
            ), coverage AS (
              SELECT c.room_id,count(DISTINCT d.day)::bigint days
              FROM contracts_in_month c CROSS JOIN LATERAL
                generate_series(GREATEST(c.start_date,{month})::timestamp,
                  LEAST(c.end_on,{end})::timestamp,interval '1 day') d(day)
              GROUP BY c.room_id
            )
            SELECT (SELECT count(*)::int FROM scoped) AS "Rooms",
              count(*)::int AS "ContractedRooms",COALESCE(sum(c.days),0)::bigint AS "OccupiedDays",
              count(*) FILTER(WHERE NOT COALESCE(r.valid,false))::int AS "UnresolvedRooms",
              COALESCE(sum(r.rent*c.days),0) AS "RentDays"
            FROM coverage c JOIN rates r ON r.room_id=c.room_id
            """).SingleAsync(token);
        var possible = (long)rent.Rooms * end.Day;
        if (tx is not null) await tx.CommitAsync(token);
        static string Number(decimal value) => value.ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
        return new(month, end, Number(due.Sum(x => x.Revision.Value.Amount)),
            unresolved == 0 ? Number(salary) : null, due.Length, staff.Length, unresolved,
            Number(historical.Recurring), Number(historical.Salary),
            nonRent is { } value ? Number(value) : null,
            !cohort.Unknown && cohort.Incurred > 0
                ? Number(decimal.Round(cohort.Paid / cohort.Incurred * 100, 2, MidpointRounding.AwayFromZero)) : null,
            new(rent.Rooms, rent.ContractedRooms, rent.OccupiedDays, possible, rent.UnresolvedRooms,
                rent.UnresolvedRooms == 0 && rent.OccupiedDays > 0
                    ? Number(decimal.Round(rent.RentDays / rent.OccupiedDays, 0, MidpointRounding.AwayFromZero)) : null,
                possible > 0 ? Number(decimal.Round(rent.OccupiedDays * 100m / possible, 6, MidpointRounding.AwayFromZero)) : null));
    }
    private static ScenarioView View(FinancialScenario row) => new(row.Id, row.Assumptions.Deserialize<ScenarioInput>()!,
        row.BaselineSnapshot.Deserialize<FinancialReport>()!, row.ResultSnapshot.Deserialize<ScenarioResult>()!, row.CalculationVersion);
    public async Task<ScenarioView?> GetAsync(Guid id, Guid actor, CancellationToken token)
    {
        var compact = (Compact24DbContext)db;
        return await compact.Set<FinancialScenario>().AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.CreatedByUserId == actor, token)
            is { } row ? View(row) : null;
    }
    public async Task<IReadOnlyList<ScenarioSummary>> ListAsync(Guid actor, int page, int pageSize, CancellationToken token)
    {
        var compact = (Compact24DbContext)db;
        return await compact.Set<FinancialScenario>().AsNoTracking().Where(s => s.CreatedByUserId == actor)
            .OrderByDescending(s => s.CalculatedAt).ThenBy(s => s.Id).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(s => new ScenarioSummary(s.Id, s.Name, s.LocationId, s.BaselineFrom, s.BaselineTo, s.ForecastMonths, s.CalculatedAt)).ToArrayAsync(token);
    }
    public async Task<ScenarioView> SaveAsync(Guid key, Guid actor, ScenarioView view, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        var source = "financial-scenario:" + key;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({source},0))", token);
        var compact = (Compact24DbContext)db;
        if (await compact.Set<FinancialScenario>().AsNoTracking().SingleOrDefaultAsync(s => s.Id == key, token) is { } existing)
        {
            if (existing.CreatedByUserId != actor || View(existing).Input != view.Input) throw new FinanceException(409, "scenario_idempotency_conflict");
            await tx.CommitAsync(token); return View(existing);
        }
        var input = view.Input;
        compact.Add(new FinancialScenario
        {
            Id = key,
            LocationId = input.Baseline.LocationId,
            Name = input.Name,
            BaselineFrom = input.Baseline.From,
            BaselineTo = input.Baseline.To,
            ForecastMonths = (short)input.ForecastMonths,
            Assumptions = JsonSerializer.SerializeToElement(input),
            BaselineSnapshot = JsonSerializer.SerializeToElement(view.Baseline),
            ResultSnapshot = JsonSerializer.SerializeToElement(view.Result),
            CalculationVersion = view.CalculationVersion,
            CreatedByUserId = actor,
            CalculatedAt = view.Baseline.SnapshotAt
        });
        await compact.SaveChangesAsync(token);
        await tx.CommitAsync(token); return view with { Id = key };
    }
}
public sealed class ForecastHistoricalCost
{
    public decimal Recurring { get; set; }
    public decimal Salary { get; set; }
}
public sealed class ForecastRentRow
{
    public int Rooms { get; set; }
    public int ContractedRooms { get; set; }
    public long OccupiedDays { get; set; }
    public int UnresolvedRooms { get; set; }
    public decimal RentDays { get; set; }
}
public sealed class ForecastPaymentCohort
{
    public decimal Incurred { get; set; }
    public decimal Paid { get; set; }
    public bool Unknown { get; set; }
}
