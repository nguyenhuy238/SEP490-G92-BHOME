namespace BHome.Domain.IncidentMaintenance;

// SRS v1.3 III.6 FE-06 / BF-07 status models. Numeric values are persisted; append only.
public enum IncidentSeverity { Normal, OperationalEmergency }
public enum IncidentStatus { Submitted, InProgress, Resolved, Rejected, Duplicate, Cancelled }
public enum IncidentReporterRole { Tenant, Staff, Owner }
public enum IncidentDecision { Rejected, Duplicate, WorkOrder, HandledDirectly, NoActionNeeded, Cancelled }
public enum WorkOrderStatus { Assigned, PendingApproval, InProgress, PendingVerification, Verified, Cancelled }
public enum EvidenceKind { Report, Before, After, Receipt, Emergency, Resolution, Progress }

public enum IncidentActionType { Acknowledged, ImmediateAction, Escalated }

public enum WorkOrderEntryType
{
    Created, Proposal, PlanApproved, PlanRejected, Started, Progress, Blocker, Submitted,
    Verified, Rework, Reassigned, Cancelled
}

// Object keys only; files stay private in object storage and are served through authorized endpoints.
public sealed record EvidenceRef(string Key, EvidenceKind Kind, Guid UploadedByUserId, DateTimeOffset At,
    long Length, string ContentType);

// UC-27 step 8: append-only acknowledgement and first-response entries.
public sealed record IncidentAction(IncidentActionType Type, Guid ActorUserId, DateTimeOffset At, string? Note,
    decimal? Amount, IReadOnlyList<string> EvidenceKeys);

// UC-29 step 15 / UC-28 A6: append-only Work Order history.
public sealed record WorkOrderEntry(WorkOrderEntryType Type, Guid ActorUserId, DateTimeOffset At,
    WorkOrderStatus? FromStatus, WorkOrderStatus? ToStatus, string? Note, Guid? StaffUserId = null);

// Expected business-rule violations. The application maps them to 400 / 409 without exposing internals.
public sealed class MaintenanceValidationException(string code) : Exception("Dữ liệu không hợp lệ.")
{
    public string Code { get; } = code;
}

public sealed class MaintenanceStateException(string code) : Exception("Trạng thái hiện tại không cho phép thao tác này.")
{
    public string Code { get; } = code;
}

internal static class Rules
{
    public const int MaxEvidencePerSubmission = 5;
    public const int MinDescriptionLength = 10;

    public static string Text(string? value, int max, string code, int min = 1)
    {
        var trimmed = value?.Trim() ?? "";
        if (trimmed.Length < min || trimmed.Length > max) throw new MaintenanceValidationException(code);
        return trimmed;
    }

    public static string? OptionalText(string? value, int max, string code)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        if (trimmed.Length > max) throw new MaintenanceValidationException(code);
        return trimmed;
    }

    public static decimal? Money(decimal? value, string code)
    {
        if (value is null) return null;
        if (value < 0 || value >= 1_000_000_000_000m || decimal.Round(value.Value, 2) != value)
            throw new MaintenanceValidationException(code);
        return value;
    }

    public static IReadOnlyList<EvidenceRef> Evidence(IReadOnlyList<EvidenceRef>? evidence, EvidenceKind kind, int min)
    {
        evidence ??= [];
        if (evidence.Count < min) throw new MaintenanceValidationException("evidence_required");
        if (evidence.Count > MaxEvidencePerSubmission) throw new MaintenanceValidationException("too_many_evidence_files");
        if (evidence.Any(e => e.Kind != kind)) throw new MaintenanceValidationException("evidence_kind_mismatch");
        return evidence;
    }
}
