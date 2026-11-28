using System.Globalization;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;

namespace BHome.Application.Finance;

public sealed record LegalBusinessProfileWrite(string SubjectType, string Name, string TaxIdentifier, string? RegistrationNumber,
    string Address, Guid[] LocationIds, DateOnly EffectiveFrom, DateOnly? EffectiveTo, int ExpectedVersion = 0);
public sealed record TaxObligationWrite(Guid BusinessProfileId, DateOnly PeriodFrom, DateOnly PeriodTo, string ObligationType,
    DateOnly Deadline, [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal DeclaredAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal PaidAmount,
    DateOnly? PaidOn, Guid? EvidenceRecordId, int? EvidenceVersion, string Status, string Note, int ExpectedVersion = 0);
public sealed record TaxObligation(TaxObligationWrite Details, int BusinessProfileVersion, Guid[] LocationIdsSnapshot,
    string ReferenceRevenue, DateTimeOffset ReferenceSnapshotAt);

public sealed class TaxTrackingService(ISetupWorkspaceStore store, ICurrentUser user, ResourceAccess access,
    PropertyService properties, FinancialReportService reports, TimeProvider clock) : SetupWorkspaceService(store, user, access)
{
    public async Task<SetupPage> ProfilesAsync(int page, int size, CancellationToken t)
    { Owner(); return await Store.PageAsync(null, "LegalBusinessProfile", null, page, size, t); }
    public async Task<SetupPage> ObligationsAsync(int page, int size, CancellationToken t)
    { Owner(); return await Store.PageAsync(null, "TaxObligation", null, page, size, t); }

    public async Task<SetupDocument> SaveProfileAsync(Guid id, LegalBusinessProfileWrite input, CancellationToken t)
    {
        Owner(); Text(input.SubjectType, 100); Text(input.Name, 200); Text(input.TaxIdentifier, 100); Text(input.Address, 500);
        if (id == Guid.Empty || input.LocationIds is null || input.LocationIds.Length is < 1 or > 100 ||
            input.LocationIds.Distinct().Count() != input.LocationIds.Length || input.LocationIds.Contains(Guid.Empty) ||
            input.EffectiveFrom == default || input.EffectiveTo < input.EffectiveFrom || input.RegistrationNumber?.Length > 200)
            throw new PropertyException(400, "invalid_business_profile");
        foreach (var location in input.LocationIds) await properties.GetLocationAsync(location, t);
        var previous = await Store.GetAsync(id, "LegalBusinessProfile", t);
        var anchor = previous?.LocationId ?? input.LocationIds[0];
        return await Store.TransactionAsync(anchor, async () =>
        {
            var saved = await Store.SaveAsync(id, anchor, "LegalBusinessProfile", "Recorded", input, input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(anchor, id, Actor, "LegalBusinessProfileSaved", t);
            return saved;
        }, t);
    }

    public async Task<SetupDocument> SaveObligationAsync(Guid id, TaxObligationWrite input, CancellationToken t)
    {
        Owner(); Text(input.ObligationType, 150); Text(input.Note, 2000);
        if (id == Guid.Empty || input.PeriodFrom == default || input.PeriodTo < input.PeriodFrom || input.PeriodTo.Year >= 9999 || input.Deadline == default ||
            input.Status is not ("Pending" or "InProgress" or "Recorded" or "Archived") ||
            input.DeclaredAmount is < 0 or >= 1_000_000_000_000_000_000m || input.PaidAmount is < 0 or >= 1_000_000_000_000_000_000m ||
            decimal.Truncate(input.DeclaredAmount) != input.DeclaredAmount || decimal.Truncate(input.PaidAmount) != input.PaidAmount ||
            input.PaidAmount > 0 && (input.PaidOn is null || input.EvidenceRecordId is null || input.EvidenceVersion is null) ||
            input.PaidOn > BHome.Application.Billing.BillingAutomationDates.BusinessDate(clock.GetUtcNow()))
            throw new PropertyException(400, "invalid_tax_tracking_record");
        var profile = await Document(input.BusinessProfileId, "LegalBusinessProfile", true, t);
        var profileVersion = profile.Version;
        // The existing report owns a repeatable-read snapshot. Capture it before the write transaction.
        var sourceReport = await Store.GetAsync(id, "TaxObligation", t) is null
            ? await reports.ReadAsync(new(input.PeriodFrom, input.PeriodTo), t) : null;
        return await Store.TransactionAsync(profile.LocationId, async () =>
        {
            profile = await Document(input.BusinessProfileId, "LegalBusinessProfile", true, t);
            var profileData = Read<LegalBusinessProfileWrite>(profile);
            var previous = await Store.GetAsync(id, "TaxObligation", t);
            var historical = previous is null ? null : Read<TaxObligation>(previous);
            if (historical is not null && (previous!.LocationId != profile.LocationId || historical.Details.BusinessProfileId != input.BusinessProfileId ||
                historical.Details.PeriodFrom != input.PeriodFrom || historical.Details.PeriodTo != input.PeriodTo))
                throw new PropertyException(409, "tax_period_and_subject_immutable");
            var locations = historical?.LocationIdsSnapshot ?? profileData.LocationIds;
            if (input.EvidenceRecordId is { } evidenceId)
            {
                var evidence = await Document(evidenceId, "LocationLegalRecord", true, t);
                if (!locations.Contains(evidence.LocationId) || !(await Store.HistoryAsync(evidenceId, evidence.Kind, t)).Any(v => v.Version == input.EvidenceVersion))
                    throw new PropertyException(400, "tax_evidence_scope_or_version_invalid");
            }
            TaxObligation data;
            if (historical is not null) data = historical with { Details = input };
            else
            {
                if (profile.Version != profileVersion || sourceReport is null) throw new PropertyException(409, "business_profile_changed_retry");
                if (input.PeriodFrom < profileData.EffectiveFrom || profileData.EffectiveTo < input.PeriodTo)
                    throw new PropertyException(400, "business_profile_period_inapplicable");
                var revenue = sourceReport.Locations.Where(l => locations.Contains(l.LocationId))
                    .Sum(l => decimal.Parse(l.Totals.VerifiedCollections, CultureInfo.InvariantCulture));
                data = new(input, profile.Version, locations, revenue.ToString(CultureInfo.InvariantCulture), sourceReport.SnapshotAt);
            }
            var saved = await Store.SaveAsync(id, profile.LocationId, "TaxObligation", input.Status, data, input.ExpectedVersion, Actor, t);
            await Store.AuditAsync(profile.LocationId, id, Actor, "TaxObligationRecorded", t);
            return saved;
        }, t);
    }

    public async Task<IReadOnlyList<SetupDocument>> HistoryAsync(Guid id, string kind, CancellationToken t)
    { Owner(); if (kind is not ("LegalBusinessProfile" or "TaxObligation")) throw new PropertyException(404, "resource_not_found"); await Document(id, kind, true, t); return await Store.HistoryAsync(id, kind, t); }
}
