namespace BHome.Application.PropertyManagement;

public sealed record SetupPage(IReadOnlyList<SetupDocument> Items, int Page, int PageSize, int TotalCount);
public sealed record LocationLegalRecordWrite(string DocumentType, string Name, string? Number,
    string? Issuer, DateOnly IssuedOn, DateOnly? ExpiresOn, string? Note, string Status, int ExpectedVersion);
public sealed record LocationLegalRecord(LocationLegalRecordWrite Details, string ObjectKey, string ContentType, long Length);
public sealed record LifecycleChecklistItem(string Code, string Label, bool NotApplicableReasonRequired);
public sealed record AssetLifecyclePolicyWrite(string Name, string Category, bool IndividualTracking,
    int? InspectionIntervalDays, int? MaintenanceIntervalDays, bool CertificationRequired,
    bool EvidenceRequired, LifecycleChecklistItem[] Checklist, string BasisType, string SourceReference,
    string? TechnicalStandard, string? ManufacturerInstructions, DateOnly EffectiveFrom,
    int ExpectedVersion = 0, Guid? ReplacesId = null);
public sealed record EquipmentUnitWrite(string Label, string? SerialNumber, string? Manufacturer,
    string? Model, DateOnly? ManufacturedOn, DateOnly? CommissionedOn, string Position,
    string Status, DateOnly? RetiredOn, string? RetirementReason, Guid? ReplacesUnitId, int ExpectedVersion = 0);
public sealed record EquipmentUnit(Guid AssetId, EquipmentUnitWrite Details);
public sealed record AssetLifecycleSummary(int Quantity, int RecordedUnits, int ActiveUnits, int FailedUnits,
    int RetiredUnits, string ConfigurationStatus);

public static class AssetLifecycleRules
{
    public static readonly string[] Categories = ["Furniture", "ElectricalEquipment", "FireSafetyEquipment", "SafetyEquipment", "TechnicalEquipment", "Other"];
    public static void Validate(AssetLifecyclePolicyWrite input)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 200 || !Categories.Contains(input.Category) ||
            input.InspectionIntervalDays is < 1 or > 36500 || input.MaintenanceIntervalDays is < 1 or > 36500 ||
            input.EffectiveFrom == default || input.BasisType is not ("Legal" or "TechnicalStandard" or "Manufacturer" or "OwnerPolicy") ||
            string.IsNullOrWhiteSpace(input.SourceReference) || input.SourceReference.Length > 4000 ||
            input.Checklist is null || input.Checklist.Length is < 1 or > 100 ||
            input.Checklist.Any(i => i is null || string.IsNullOrWhiteSpace(i.Code) || i.Code.Length > 80 || string.IsNullOrWhiteSpace(i.Label) || i.Label.Length > 500) ||
            input.Checklist.Select(i => i.Code).Distinct(StringComparer.Ordinal).Count() != input.Checklist.Length)
            throw new PropertyException(400, "invalid_lifecycle_policy");
    }
}
