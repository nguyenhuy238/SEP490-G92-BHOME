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
        // Notes and photos document the actual observation, including a passed
        // check. Never erase a previous observation while saving another item.
        var previous = prior ?? [];
        if (input is null) return previous;
        if (input.Length > RequiredCodes.Length || input.Any(item => item is null) ||
            input.Select(item => item.Code).Distinct(StringComparer.Ordinal).Count() != input.Length)
            throw ContractException.Invalid("invalid_handover_room_checks");
        var normalized = input.Select(Validate).ToArray();
        return previous.Where(item => !normalized.Any(next => next.Code == item.Code))
            .Concat(normalized).OrderBy(item => Array.IndexOf(RequiredCodes, item.Code)).ToArray();
    }

    private static HandoverRoomCheck Validate(HandoverRoomCheck item)
    {
        if (!RequiredCodes.Contains(item.Code) || item.Status is not ("Passed" or "Issue" or "NotApplicable") ||
            item.Notes?.Length > 2000 ||
            item.EvidenceIds is null or { Length: > 5 } ||
            item.EvidenceIds.Contains(Guid.Empty) ||
            item.EvidenceIds.Distinct().Count() != item.EvidenceIds.Length)
            throw ContractException.Invalid("invalid_handover_room_checks");
        return item with { Notes = item.Notes?.Trim() };
    }

    public static HandoverAccessItem[] NormalizeAccess(HandoverAccessItem[]? items)
    {
        if (items is null) return [];
        // Staff hands over a single counted bundle of keys. Historical access
        // types remain deserializable in already-confirmed legacy snapshots.
        if (items.Length != 1 || items[0] is null || items[0].Type != "RoomKey")
            throw ContractException.Invalid("invalid_handover_access_items");
        return items.Select(item =>
        {
            if (item.Type != "RoomKey" ||
                item.Quantity is < 0 or > 100 || item.Notes?.Length > 500)
                throw ContractException.Invalid("invalid_handover_access_items");
            return item with { Notes = item.Notes?.Trim() ?? "" };
        }).ToArray();
    }

    public static void RequireSeparateKeyEvidence(Guid[]? keys, Guid[] overall,
        HandoverRoomCheck[] rooms, HandoverAssetInput[] assets)
    {
        var photos = keys ?? [];
        if (photos.Intersect(overall).Any() ||
            photos.Intersect(rooms.SelectMany(room => room.EvidenceIds)).Any() ||
            photos.Intersect(assets.SelectMany(asset => asset.EvidenceIds ?? [])).Any())
            throw ContractException.Invalid("key_evidence_must_be_separate");
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
        if (access is not { Length: 1 } || access[0].Type != "RoomKey") result.Add("access_inventory");
        // A checked category and status are required; photos and notes are
        // optional supporting evidence for every status, including Issue.
        return result.ToArray();
    }
}
