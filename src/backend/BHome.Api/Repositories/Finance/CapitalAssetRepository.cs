using System.Text.Json;
using System.Security.Cryptography;
using BHome.Application.PropertyManagement;
using BHome.Application.Finance;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;

public sealed class CapitalAssetRepository(BHomePersistenceContext db, ISetupWorkspaceStore store,
    RoomInventoryReviewService roomReviews) : ICapitalAssetRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public Task<bool> LocationExistsAsync(Guid id, CancellationToken token) =>
        db.Set<BHome.Domain.Locations.Location>().AsNoTracking().AnyAsync(l => l.Id == id, token);

    public async Task<IReadOnlyList<CapitalAssetEntry>> ReadAsync(Guid id, CancellationToken token)
    {
        var assets = await db.Set<BHome.Domain.PropertyManagement.Asset>().AsNoTracking()
            .Where(a => a.LocationId == id)
            .Select(a => new
            {
                a.Id,
                a.RoomId,
                a.CommonArea,
                a.Name,
                a.Category,
                a.Status,
                a.PurchaseInfo
            }).ToArrayAsync(token);
        var names = await db.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.LocationId == id)
            .ToDictionaryAsync(r => r.Id, r => r.RoomNumber, token);
        var attestations = await db.Database.SqlQuery<CapitalVerificationRow>($"""
            SELECT (task_data->'document'->'data'->>'assetId')::uuid AS "AssetId",
                   (task_data->'document'->'data'->>'quantity')::integer AS "Quantity",
                   (task_data->'document'->'data'->>'verifiedBy')::uuid AS "VerifiedBy"
            FROM operational_tasks
            WHERE location_id={id} AND task_type='SYSTEM_JOB'
              AND task_data->>'recordType'='SetupAssetVerification'
              AND task_data->'document'->>'status'='Verified'
              AND task_data->'document'->'data'->>'source'='OwnerAttestation'
              AND task_data->'document'->'data'->>'assetId' IS NOT NULL
            """).ToArrayAsync(token);
        var verified = attestations.GroupBy(a => a.AssetId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(a => a.Quantity).First());
        var commonRequirements = (await store.ListAsync(id, "CommonAssetRequirements", token))
            .OrderByDescending(d => d.Version).FirstOrDefault();
        var commonItems = commonRequirements?.Data.Deserialize<CommonAssetRequirementsWrite>(Json)?.Items ?? [];
        var commonDocuments = await store.ListAsync(id, "CommonAssetInventoryVerification", token);
        var commonVerified = new Dictionary<Guid, Guid?>();
        foreach (var document in commonDocuments.Where(d => d.Status == "Verified"))
        {
            var data = document.Data;
            if (!data.TryGetProperty("itemId", out var itemId) ||
                !data.TryGetProperty("assetId", out var assetId) ||
                !data.TryGetProperty("fingerprint", out var fingerprint) ||
                assetId.ValueKind != JsonValueKind.String) continue;
            var item = commonItems.SingleOrDefault(i => i.Id == itemId.GetGuid());
            if (item is null) continue;
            var expected = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
            {
                item.Id,
                item.Name,
                item.Category,
                item.CommonArea,
                item.Quantity,
                item.Unit
            }, Json)));
            if (fingerprint.GetString() == expected) commonVerified[assetId.GetGuid()] = document.RecordedBy;
        }
        // A later inventory recheck can mark a common item Missing, or an Owner
        // may replace/remove its configuration. These changes must invalidate the
        // *current* checklist, but must not erase the historically verified
        // acquisition before the capital sync job has had a chance to post it.
        var commonHistorical = await db.Database.SqlQuery<CommonCapitalVerificationRow>($"""
            SELECT DISTINCT (revision->'document'->'data'->>'assetId')::uuid AS "AssetId",
                   COALESCE((revision->'document'->>'recordedBy')::uuid,
                            (revision->>'actorId')::uuid) AS "VerifiedBy"
            FROM operational_tasks t
            CROSS JOIN LATERAL jsonb_array_elements(t.history) revision
            WHERE t.location_id={id} AND t.task_type='SYSTEM_JOB'
              AND t.task_data->>'recordType'='SetupCommonAssetInventoryVerification'
              AND revision->'document'->>'status'='Verified'
              AND NULLIF(revision->'document'->'data'->>'assetId','') IS NOT NULL
            """).ToArrayAsync(token);
        var commonEverVerified = commonHistorical.GroupBy(row => row.AssetId)
            .ToDictionary(group => group.Key,
                group => group.Select(row => row.VerifiedBy).FirstOrDefault(actor => actor is not null && actor != Guid.Empty));
        foreach (var document in commonDocuments.Where(d => d.Status == "Verified" &&
                     d.Data.TryGetProperty("assetId", out var assetId) && assetId.ValueKind == JsonValueKind.String))
            commonEverVerified.TryAdd(document.Data.GetProperty("assetId").GetGuid(), document.RecordedBy);
        var investments = await db.Database.SqlQuery<AssetInvestmentRow>($"""
            SELECT asset_id AS "AssetId",amount AS "Amount",
                   occurred_on AS "OccurredOn",source_key AS "SourceKey",
                   CASE WHEN source_key LIKE 'asset-capital:%'
                        THEN (history->0->>'quantity')::integer ELSE NULL END AS "Quantity",
                   CASE WHEN source_key LIKE 'asset-capital:%'
                        THEN (history->0->>'unitCost')::numeric ELSE NULL END AS "UnitCost",
                   CASE WHEN source_key LIKE 'asset-capital:%'
                        THEN (history->0->>'metadataVersion')::integer ELSE NULL END AS "MetadataVersion",
                   CASE WHEN source_key LIKE 'asset-capital:%'
                        THEN (history->0->>'capturedAt')::timestamptz ELSE NULL END AS "CapturedAt"
            FROM expenses
            WHERE location_id={id} AND asset_id IS NOT NULL AND expense_type='INITIAL_INVESTMENT'
            """).ToArrayAsync(token);
        var ledger = investments.Where(e =>
                e.SourceKey == $"asset-capital:{e.AssetId:N}" ||
                e.SourceKey?.StartsWith($"asset-capital:{e.AssetId:N}:", StringComparison.Ordinal) == true)
            .GroupBy(e => e.AssetId).ToDictionary(g => g.Key, g => g.ToArray());
        var legacy = investments.Where(e => e.SourceKey is null || !e.SourceKey.StartsWith("asset-capital:", StringComparison.Ordinal))
            .GroupBy(e => e.AssetId).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
        var metadataHistory = await db.Database.SqlQuery<AssetMetadataHistoryRow>($"""
            SELECT id AS "AssetId", (task_data->'document'->>'version')::integer AS "CurrentVersion",
                   history::text AS "HistoryJson"
            FROM operational_tasks
            WHERE location_id={id} AND task_type='SYSTEM_JOB'
              AND task_data->>'recordType'='SetupAssetMetadata'
            """).ToArrayAsync(token);
        var historyByAsset = metadataHistory.ToDictionary(row => row.AssetId);
        var result = new List<CapitalAssetEntry>(assets.Length);
        foreach (var a in assets)
        {
            var data = a.PurchaseInfo;
            var quantity = data.TryGetProperty("quantity", out var qty) && qty.TryGetInt32(out var count) && count > 0 ? count : 1;
            decimal? purchase = null;
            if (data.TryGetProperty("purchaseCost", out var price) && price.ValueKind is JsonValueKind.Number or JsonValueKind.String &&
                decimal.TryParse(price.ToString(), System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture, out var value) && value >= 0)
                purchase = value;
            DateOnly? purchaseDate = data.TryGetProperty("purchaseDate", out var purchased) &&
                purchased.ValueKind == JsonValueKind.String &&
                DateOnly.TryParse(purchased.GetString(), out var date) ? date : null;
            var confirmed = (a.RoomId is not null
                    ? verified.TryGetValue(a.Id, out var checkedQty) && checkedQty.Quantity == quantity
                    : commonEverVerified.ContainsKey(a.Id));
            var currentCommonVerified = commonVerified.ContainsKey(a.Id) && a.Status == AssetStatus.Active &&
                      commonItems.Any(i => i.Name == a.Name && i.Category == a.Category &&
                          i.CommonArea == a.CommonArea && i.Quantity == quantity);
            var actor = a.RoomId is not null ? verified.GetValueOrDefault(a.Id)?.VerifiedBy :
                commonEverVerified.GetValueOrDefault(a.Id);
            var ledgerRows = ledger.GetValueOrDefault(a.Id) ?? [];
            var revisions = new List<AssetCapitalRevision>();
            var metadataVersion = 0;
            if (historyByAsset.TryGetValue(a.Id, out var historyRow))
            {
                metadataVersion = historyRow.CurrentVersion;
                using var revisionsJson = JsonDocument.Parse(historyRow.HistoryJson);
                foreach (var historyItem in revisionsJson.RootElement.EnumerateArray())
                {
                    if (!historyItem.TryGetProperty("document", out var document) ||
                        !document.TryGetProperty("version", out var version) ||
                        !document.TryGetProperty("data", out var dataElement))
                        continue;
                    var revisionMetadata = dataElement.Deserialize<AssetMetadata>(Json);
                    if (revisionMetadata is null || revisionMetadata.Quantity <= 0) continue;
                    DateTimeOffset? recordedAt = document.TryGetProperty("recordedAt", out var recorded) &&
                        recorded.ValueKind == JsonValueKind.String &&
                        DateTimeOffset.TryParse(recorded.GetString(), out var instant)
                            ? instant
                            : null;
                    DateOnly? recordedOn = recordedAt is { } timestamp
                        ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                            timestamp, "Asia/Ho_Chi_Minh").DateTime)
                        : null;
                    revisions.Add(new(version.GetInt32(), revisionMetadata.Quantity,
                        revisionMetadata.PurchaseCost, revisionMetadata.PurchaseDate, recordedOn, recordedAt));
                }
            }
            var posted = ledgerRows.Where(row => row.Quantity is > 0 && row.UnitCost is > 0)
                .Select(row => new AssetCapitalPosted(row.SourceKey!, row.Quantity!.Value,
                    row.UnitCost!.Value, row.Amount, row.MetadataVersion ??
                        (revisions.Where(r => r.Quantity == row.Quantity && r.UnitCost == row.UnitCost &&
                                (row.CapturedAt is null || r.RecordedAt is null || r.RecordedAt <= row.CapturedAt))
                            .Select(r => r.Version).DefaultIfEmpty(metadataVersion).First())))
                .ToArray();
            // A historic bare source key may predate quantity/unit-cost capture.
            // Its amount is already in the ledger; never generate a second base
            // acquisition from the same Asset when the old snapshot is incomplete.
            var unknownLegacyBase = ledgerRows.Any(row =>
                row.SourceKey == $"asset-capital:{a.Id:N}" &&
                (row.Quantity is not > 0 || row.UnitCost is not > 0));
            var pending = confirmed
                ? AssetCapitalMath.Pending(a.Id, quantity, purchase, purchaseDate,
                    metadataVersion, revisions, posted, legacy.ContainsKey(a.Id) || unknownLegacyBase)
                : [];
            // Missing legacy ledger entry is *unknown*, not VND 0. Dictionary's
            // GetValueOrDefault returns decimal.Zero and silently turns the
            // nullable LegacyAmount into a false zero-valued investment.
            decimal? legacyAmount = legacy.TryGetValue(a.Id, out var savedLegacy) ? savedLegacy : null;
            result.Add(new(a.Id, a.RoomId, a.CommonArea, a.Name,
                a.RoomId is { } room && names.TryGetValue(room, out var name) ? name : a.CommonArea ?? "Khu vực chung",
                confirmed, quantity, purchase, purchaseDate,
                ledgerRows.Length > 0 ? ledgerRows.Sum(row => row.Amount) : null,
                legacyAmount.HasValue, legacyAmount, actor,
                pending.Sum(item => item.Amount), pending,
                !legacy.ContainsKey(a.Id) && AssetCapitalMath.HasMissingHistoricalPrice(revisions, posted),
                a.RoomId is not null ? confirmed && a.Status == AssetStatus.Active : currentCommonVerified));
        }
        return result;
    }

    public async Task<int> UnreviewedRoomsAsync(Guid location, CancellationToken token)
    {
        // Never trust a saved Matched state alone. The live Owner checklist
        // compares the desired template/version, physical asset status and
        // mappings to the currently persisted configuration.
        return await roomReviews.CountRoomsRequiringReviewAsync(location, token);
    }

    public async Task<int> UnreviewedCommonAsync(Guid location, IReadOnlyList<CapitalAssetEntry> physical,
        CancellationToken token)
    {
        var requirements = (await store.ListAsync(location, "CommonAssetRequirements", token))
            .OrderByDescending(d => d.Version).FirstOrDefault();
        var required = requirements?.Data.Deserialize<CommonAssetRequirementsWrite>(Json)?.Items ?? [];
        if (required.Length == 0) return 0;
        return required.Count(item => !physical.Any(a =>
            a.RoomId is null && a.CurrentInventoryVerified && a.Name == item.Name &&
            a.CommonArea == item.CommonArea && a.Quantity == item.Quantity));
    }
}

public sealed class CapitalVerificationRow
{
    public Guid AssetId { get; set; }
    public int Quantity { get; set; }
    public Guid? VerifiedBy { get; set; }
}

public sealed class CommonCapitalVerificationRow
{
    public Guid AssetId { get; set; }
    public Guid? VerifiedBy { get; set; }
}

public sealed class AssetInvestmentRow
{
    public Guid AssetId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly OccurredOn { get; set; }
    public string? SourceKey { get; set; }
    public int? Quantity { get; set; }
    public decimal? UnitCost { get; set; }
    public int? MetadataVersion { get; set; }
    public DateTimeOffset? CapturedAt { get; set; }
}

public sealed class AssetMetadataHistoryRow
{
    public Guid AssetId { get; set; }
    public int CurrentVersion { get; set; }
    public string HistoryJson { get; set; } = "[]";
}
