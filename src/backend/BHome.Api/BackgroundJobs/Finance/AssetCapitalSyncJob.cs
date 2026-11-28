using System.Text.Json;
using BHome.Application.Finance;
using BHome.Application.Jobs;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

/// <summary>
/// Persists first verified asset acquisition once, using the existing expenses
/// ledger. Subsequent re-inventory, metadata edits or retirement cannot change
/// the original money/quantity snapshot.
/// </summary>
internal sealed class AssetCapitalSyncJob(BHomePersistenceContext db, ICapitalAssetRepository capital,
    IBackgroundJobQueue queue, TimeProvider clock) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "finance-capital-assets";
    private DateOnly Today => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);

    public Task EnqueueDueAsync(CancellationToken token) =>
        queue.EnqueueAsync(new(Name, $"finance-capital-assets/{Today:yyyyMMdd}", "{}"), token);

    public async Task ExecuteAsync(JobExecution job, CancellationToken token)
    {
        var locations = await db.Set<Location>().AsNoTracking().Select(location => location.Id).ToArrayAsync(token);
        foreach (var location in locations)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(token);
            // Serialize with the existing Owner inventory/expense writes for this Location.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()},0))", token);
            var entries = await capital.ReadAsync(location, token);
            foreach (var asset in entries)
            {
                if (!asset.Verified || asset.VerifiedBy is not { } actor || actor == Guid.Empty)
                    continue;
                foreach (var purchase in asset.PendingEvents)
                {
                    if (purchase.Amount >= 1_000_000_000_000_000_000m) continue;
                    // The rule version is part of the source key, so re-running
                    // after verification cannot reinsert an existing acquisition.
                    var exists = await db.Database.SqlQuery<bool>($"""
                        SELECT EXISTS(SELECT 1 FROM expenses WHERE source_key={purchase.SourceKey}) AS "Value"
                        """).SingleAsync(token);
                    if (exists) continue;
                    var id = Guid.NewGuid();
                    var date = purchase.PurchaseDate ?? Today;
                    var history = JsonSerializer.Serialize(new[]
                    {
                        new
                        {
                            action = "VerifiedAssetInvestment",
                            assetId = asset.Id,
                            verifiedBy = actor,
                            capturedAt = clock.GetUtcNow(),
                            quantity = purchase.Quantity,
                            unitCost = purchase.UnitCost,
                            amount = purchase.Amount,
                            metadataVersion = purchase.MetadataVersion,
                            purchaseDate = purchase.PurchaseDate,
                            roomId = asset.RoomId,
                            commonArea = asset.CommonArea
                        }
                    });
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO expenses(
                            id,location_id,room_id,asset_id,task_id,incident_report_id,
                            expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
                        VALUES({id},{location},{asset.RoomId},{asset.Id},NULL,NULL,
                            'INITIAL_INVESTMENT','Vốn đầu tư tài sản',{purchase.Amount},{date},
                            {asset.Name},{purchase.SourceKey},{actor},{history}::jsonb)
                        """, token);
                }
            }
            await transaction.CommitAsync(token);
        }
    }
}
