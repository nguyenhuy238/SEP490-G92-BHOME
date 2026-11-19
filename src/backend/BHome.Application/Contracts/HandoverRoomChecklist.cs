namespace BHome.Application.Contracts;

/// <summary>UC-17 minimum physical inspection before a Tenant receives a room.</summary>
public static class HandoverRoomChecklist
{
    public static readonly string[] RequiredCodes =
    [
        "walls_ceiling_floor", "doors_windows_locks", "electrical_lighting_outlets",
        "water_plumbing_drainage", "bathroom_toilet", "cleanliness", "safety_equipment"
    ];

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        ["walls_ceiling_floor"] = "Tường, trần và sàn",
        ["doors_windows_locks"] = "Cửa, cửa sổ và khóa",
        ["electrical_lighting_outlets"] = "Đèn, công tắc và ổ điện",
        ["water_plumbing_drainage"] = "Cấp nước, vòi và thoát nước",
        ["bathroom_toilet"] = "Nhà vệ sinh và thiết bị vệ sinh",
        ["cleanliness"] = "Vệ sinh và hiện trạng phòng",
        ["safety_equipment"] = "Thiết bị an toàn được trang bị"
    };

    public static HandoverRoomCheck[] Merge(HandoverRoomCheck[]? prior, HandoverRoomCheck[]? input)
    {
        if (input is null) return prior ?? [];
        if (input.Length > RequiredCodes.Length || input.Any(item => item is null) ||
            input.Select(item => item.Code).Distinct(StringComparer.Ordinal).Count() != input.Length)
            throw ContractException.Invalid("invalid_handover_room_checks");
        var normalized = input.Select(Validate).ToArray();
        return (prior ?? []).Where(item => !normalized.Any(next => next.Code == item.Code))
            .Concat(normalized).OrderBy(item => Array.IndexOf(RequiredCodes, item.Code)).ToArray();
    }

    private static HandoverRoomCheck Validate(HandoverRoomCheck item)
    {
        if (!RequiredCodes.Contains(item.Code) || item.Status is not ("Passed" or "Issue" or "NotApplicable") ||
            item.Notes is null || item.Notes.Length > 2000 ||
            item.Status != "Passed" && string.IsNullOrWhiteSpace(item.Notes) ||
            item.EvidenceIds is null or { Length: > 5 } ||
            item.EvidenceIds.Contains(Guid.Empty) ||
            item.EvidenceIds.Distinct().Count() != item.EvidenceIds.Length)
            throw ContractException.Invalid("invalid_handover_room_checks");
        return item with { Notes = item.Notes.Trim() };
    }

    public static HandoverAccessItem[] NormalizeAccess(HandoverAccessItem[]? items)
    {
        if (items is null) return [];
        if (items.Length > 10 || items.Any(item => item is null) ||
            items.Select(item => item.Type).Distinct(StringComparer.Ordinal).Count() != items.Length)
            throw ContractException.Invalid("invalid_handover_access_items");
        return items.Select(item =>
        {
            if (item.Type is not ("RoomKey" or "GateKey" or "AccessCard" or "Remote" or "DigitalAccess" or "Other") ||
                item.Quantity is < 0 or > 100 || item.Notes is null || item.Notes.Length > 500 ||
                item.Quantity == 0 && (item.Type != "DigitalAccess" || string.IsNullOrWhiteSpace(item.Notes)))
                throw ContractException.Invalid("invalid_handover_access_items");
            return item with { Notes = item.Notes.Trim() };
        }).ToArray();
    }

    // The legacy type remains readable for historical PDFs. Staff no longer
    // writes remediation proposals: condition, notes and photographs are enough.
    public static HandoverOutstandingIssue[] NormalizeIssues(HandoverOutstandingIssue[]? items)
    {
        if (items is null) return [];
        if (items.Length != 0)
            throw ContractException.Invalid("staff_repair_decision_forbidden");
        return [];
    }

    public static string[] Missing(HandoverRoomCheck[]? checks, HandoverAccessItem[]? access,
        HandoverOutstandingIssue[]? issues)
    {
        var result = new List<string>();
        var all = checks ?? [];
        if (all.Length != RequiredCodes.Length || RequiredCodes.Any(code => all.Count(item => item.Code == code) != 1))
            result.Add("room_checklist");
        if (all.Any(item => item.Status == "Issue" && item.EvidenceIds.Length == 0))
            result.Add("room_issue_evidence");
        if (access is not { Length: > 0 }) result.Add("access_inventory");
        // An Issue requires a factual observation and photograph only. The
        // Owner decides whether/how to repair it at the separate Ready step.
        return result.ToArray();
    }
}
