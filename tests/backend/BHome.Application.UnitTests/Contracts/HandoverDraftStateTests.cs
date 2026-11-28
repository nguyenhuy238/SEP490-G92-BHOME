using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class HandoverDraftStateTests
{
    [Fact]
    public void NewMainStartsAsDraftWithContractSnapshotButNoInventedInspectionOrApproval()
    {
        var instant = new DateTimeOffset(2026, 11, 19, 5, 0, 0, TimeSpan.Zero);
        var contract = new Contract { Kind = ContractKind.Main, SnapshotHashOrEmpty = "contract-sha256" };
        var result = HandoverDraftState.Create(contract, instant);

        Assert.Equal(1, result.Version);
        Assert.Equal("Draft", result.Status);
        Assert.Equal("contract-sha256", result.ContractSnapshotHash);
        Assert.Equal(instant, result.CreatedAt);
        Assert.Equal("", result.RoomCondition);
        Assert.Equal("", result.KeysAndAccess);
        Assert.Empty(result.EvidenceIds);
        Assert.Empty(result.KeyEvidenceIds ?? []);
        Assert.Empty(result.Assets);
        Assert.Empty(result.Requests);
        Assert.Null(result.OwnerReadyAt);
        Assert.Null(result.TenantConfirmedAt);
        Assert.Null(result.StaffPreparedAt);
    }

    [Fact]
    public void SerializedPreparationIsIndependentOfExistingImmutableHandoverCurrent()
    {
        var keyPhoto = Guid.NewGuid();
        var initial = HandoverDraftState.Create(new Contract { SnapshotHashOrEmpty = "first" },
            new DateTimeOffset(2026, 11, 19, 5, 0, 0, TimeSpan.Zero)) with
        { KeyEvidenceIds = [keyPhoto] };
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(initial, options);
        var deserialized = JsonSerializer.Deserialize<HandoverDraftState>(json, options);

        Assert.NotNull(deserialized);
        Assert.Equal(initial.Version, deserialized.Version);
        Assert.Equal(initial.Status, deserialized.Status);
        Assert.Equal(initial.ContractSnapshotHash, deserialized.ContractSnapshotHash);
        Assert.Empty(deserialized.Assets);
        Assert.Equal([keyPhoto], deserialized.KeyEvidenceIds ?? []);
        Assert.Empty(deserialized.Requests);
        Assert.Null(deserialized.TenantConfirmedBy);
    }

    [Fact]
    public void ChangingOneDraftVersionKeepsPendingTenantRequestAndOwnerReviewAudit()
    {
        var prior = HandoverDraftState.Create(new Contract(), DateTimeOffset.UtcNow);
        var request = new HandoverDraftRequest(Guid.NewGuid(), prior.Version,
            "Thiếu chìa khóa", "Pending", DateTimeOffset.UtcNow);
        var pending = prior with { Version = prior.Version + 1, Status = "ChangesRequested", Requests = [request] };
        var rejected = pending with
        {
            Version = pending.Version + 1,
            Status = "Ready",
            Requests = [request with { Status = "Rejected", DecisionReason = "Đã kiểm kê đủ" }]
        };

        Assert.Equal("Pending", Assert.Single(pending.Requests).Status);
        Assert.Equal("Rejected", Assert.Single(rejected.Requests).Status);
        Assert.Equal("Pending", Assert.Single(pending.Requests).Status);
        Assert.Equal(3, rejected.Version);
    }

    [Fact]
    public void RoomInspectionIsIncrementalButEveryCategoryAndAccessCountIsRequired()
    {
        var first = new HandoverRoomCheck("walls_ceiling_floor", "Passed", "", []);
        var second = new HandoverRoomCheck("doors_windows_locks", "NotApplicable", "Không có cửa sổ", []);
        var partial = HandoverRoomChecklist.Merge([], [first]);
        Assert.Contains("room_checklist", HandoverRoomChecklist.Missing(partial, [], []));
        var updated = HandoverRoomChecklist.Merge(partial, [second]);
        Assert.Equal(2, updated.Length);
        Assert.Contains(updated, check => check.Code == first.Code && check.Status == first.Status);

        var all = HandoverRoomChecklist.Merge(updated,
            HandoverRoomChecklist.RequiredCodes.Skip(2).Select(code =>
                new HandoverRoomCheck(code, "Passed", "", [])).ToArray());
        // No key photo is necessary to complete the counted handover.
        Assert.Empty(HandoverRoomChecklist.Missing(all,
            [new HandoverAccessItem("RoomKey", 5, "")], []));
        Assert.Contains("access_inventory", HandoverRoomChecklist.Missing(all, [], []));
        Assert.Contains("access_inventory", HandoverRoomChecklist.Missing(all,
            [new HandoverAccessItem("GateKey", 1, "")], []));
        Assert.Throws<ContractException>(() => HandoverRoomChecklist.NormalizeAccess([
            new HandoverAccessItem("RoomKey", 1, ""), new HandoverAccessItem("GateKey", 1, "")
        ]));
        Assert.Equal(0, Assert.Single(HandoverRoomChecklist.NormalizeAccess([
            new HandoverAccessItem("RoomKey", 0, "Không giao chìa khóa vật lý")
        ])).Quantity);
    }

    [Fact]
    public void DamagedRoomCanBeSavedWithoutOptionalNoteOrEvidenceButOnlyOwnerDecidesRemediation()
    {
        var code = "walls_ceiling_floor";
        var optional = HandoverRoomChecklist.Merge([], [new HandoverRoomCheck(code, "Issue", "", [])]);
        Assert.Equal("Issue", Assert.Single(optional).Status);
        Assert.Throws<ContractException>(() => HandoverRoomChecklist.Merge([], [
            new HandoverRoomCheck("unregistered_code", "Passed", "", [])]));
        Assert.Throws<ContractException>(() => HandoverRoomChecklist.NormalizeIssues([
            new HandoverOutstandingIssue(code, "Trám vết nứt", "Owner", new DateOnly(2026, 12, 1))]));
        var checks = HandoverRoomChecklist.RequiredCodes.Select(item =>
            new HandoverRoomCheck(item, item == code ? "Issue" : "Passed", item == code ? "Vết nứt cũ" : "", [])).ToArray();
        Assert.Empty(HandoverRoomChecklist.Missing(checks,
            [new HandoverAccessItem("RoomKey", 1, "")], []));
        var reviewed = HandoverRoomChecklist.Merge(checks,
            [new HandoverRoomCheck(code, "Issue", "Vết nứt cũ", [Guid.NewGuid()])]);
        Assert.Empty(HandoverRoomChecklist.NormalizeIssues([]));
        Assert.Empty(HandoverRoomChecklist.Missing(reviewed,
            [new HandoverAccessItem("RoomKey", 1, "")], []));
    }

    [Fact]
    public void PassedRoomRetainsOptionalNotesAndSavingAnotherItemDoesNotModifyIt()
    {
        const string code = "doors_windows_locks";
        var issue = new HandoverRoomCheck(code, "Issue", "Khóa cửa bị kẹt", [Guid.NewGuid()]);
        var changed = HandoverRoomChecklist.Merge([issue],
            [new HandoverRoomCheck(code, "Passed", "Khóa cửa bị kẹt", [])]);
        Assert.Equal("Khóa cửa bị kẹt", Assert.Single(changed).Notes);
        Assert.Empty(Assert.Single(changed).EvidenceIds);

        // Saving an unrelated section preserves the previous observation.
        HandoverRoomCheck[] prior = [new HandoverRoomCheck(code, "Passed", "Ghi chú từ trước", [])];
        Assert.Equal("Ghi chú từ trước", Assert.Single(HandoverRoomChecklist.Merge(prior, null)).Notes);
        Assert.Null(Assert.Single(HandoverRoomChecklist.Merge([], [
            new HandoverRoomCheck(code, "Passed", null, [])])).Notes);
        Assert.Null(Assert.Single(HandoverRoomChecklist.Merge([], [
            new HandoverRoomCheck(code, "Issue", null, [])])).Notes);
    }

    [Fact]
    public void KeyPhotoCannotReuseAnotherInspectionPhoto()
    {
        var fileId = Guid.NewGuid();
        Assert.Throws<ContractException>(() => HandoverRoomChecklist.RequireSeparateKeyEvidence(
            [fileId], [fileId], [], []));
        Assert.Throws<ContractException>(() => HandoverRoomChecklist.RequireSeparateKeyEvidence(
            [fileId], [], [new HandoverRoomCheck("doors_windows_locks", "Issue", "Hỏng", [fileId])], []));
        HandoverRoomChecklist.RequireSeparateKeyEvidence([fileId], [],
            [new HandoverRoomCheck("doors_windows_locks", "Passed", "", [])], []);
    }
}
