using BHome.Application.Contracts;
using BHome.Application.Finance;
using BHome.Application.Storage;
using NSubstitute;
using static BHome.Application.UnitTests.UnitTestDoc.BF06.BF06TestWorld;

namespace BHome.Application.UnitTests.UnitTestDoc.BF06;

// Unit test cho sheet "BF-06 Payment Debt" - nhóm requestRefund / approveRefund / rejectRefund / completeRefund /
// convertExcessToCredit (UTC13-UTC22). Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3 §3.2 RefundRequest,
// ExcessBalance, External Refund Execution, NFR 2.4, GBR-03, GBR-13, GBR-18).
// Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký):
//   - requestRefund  -> RefundService.CreateAsync(sourcePaymentId, RefundInput, key)
//   - approve/reject -> RefundService.DecideAsync(id, RefundDecision, key)
//   - completeRefund -> RefundService.ExecuteAsync(id, RefundExecution, key, evidenceImage)
//   - số tiền giữ chỗ/còn khả dụng -> RefundService.SourceAsync(sourcePaymentId)
//   - convertExcessToCredit -> KHÔNG có hàm tương ứng trong danh mục chữ ký.
// Nguồn hoàn tiền: ExcessBalance 230.000 của Tenant (kho giả lập). Đầu vào bankAccount của sheet không có tham số tương ứng.
// Quy ước: "Exception: N/A" ở các case bị từ chối được hiểu là không có lỗi hệ thống ngoài dự kiến; nếu hàm từ chối bằng
// ngoại lệ nghiệp vụ thì test vẫn kiểm tra đầy đủ trạng thái dữ liệu theo sheet. Log Message không quan sát được ở tầng unit.
public sealed class BF06RefundCreditUnitTests
{
    private static readonly byte[] ReceiptImage = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
    private readonly BF06TestWorld world = new();
    private readonly FakeRefundRepository refunds = new();
    private readonly IObjectStorage storage = Substitute.For<IObjectStorage>();
    private readonly IContractImageValidator images = Substitute.For<IContractImageValidator>();
    private static readonly Guid Source = FakeRefundRepository.SourcePayment;

    public BF06RefundCreditUnitTests()
    {
        // Bộ kiểm tra ảnh bằng chứng: ảnh có nội dung là hợp lệ, file rỗng/không có là không hợp lệ.
        images.Validate(Arg.Any<byte[]>()).Returns(call =>
            call.Arg<byte[]>() is { Length: > 0 } ? "image/png" : throw new InvalidOperationException("evidence_required"));
        // Kho lưu trữ file giả lập: lưu đúng nội dung đã ghi và đọc lại được (như MinIO).
        storage.PutAsync(Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<long>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                using var copy = new MemoryStream();
                call.ArgAt<Stream>(1).CopyTo(copy);
                stored[call.ArgAt<string>(0)] = copy.ToArray();
                return Task.CompletedTask;
            });
        storage.CopyToAsync(Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<CancellationToken>())
            .Returns(call => call.ArgAt<Stream>(1).WriteAsync(stored[call.ArgAt<string>(0)]).AsTask());
    }

    private readonly Dictionary<string, byte[]> stored = [];

    private RefundService Service() => new(refunds, storage, images, world.User, world.Clock);

    private async Task<RefundSource> AmountsAsOwner()
    {
        world.AsOwner();
        return await Service().SourceAsync(Source, default);
    }

    // Điều kiện "RefundRequest Requested for 230,000": Tenant gửi yêu cầu (nếu Tenant không gửi được thì Owner tạo thay để có điều kiện).
    private async Task<RefundView> Requested230000()
    {
        var input = new RefundInput(Tenant1, 230_000m, "Hoan tien phan tra thua hoa don INV-204", true);
        world.AsTenant();
        var created = await Capture(() => Service().CreateAsync(Source, input, Guid.NewGuid(), default));
        if (created is not null)
        {
            world.AsOwner();
            await Service().CreateAsync(Source, input, Guid.NewGuid(), default);
        }
        var record = Assert.Single(refunds.Records);
        world.AsOwner();
        return (await Service().SourceAsync(Source, default)).Requests.Single(r => r.Id == record.Id);
    }

    private async Task<RefundView> Approved230000()
    {
        var requested = await Requested230000();
        world.AsOwner();
        return await Service().DecideAsync(requested.Id, new RefundDecision(requested.Version, true, "Dong y hoan tien", true), Guid.NewGuid(), default);
    }

    private Task<RefundView> Complete(RefundView approved, byte[]? evidence) =>
        Service().ExecuteAsync(approved.Id, new RefundExecution(approved.Version, world.Now, "FT26120600001", "Da chuyen khoan ngoai BHOME", true),
            Guid.NewGuid(), evidence is null ? Stream.Null : new MemoryStream(evidence), default);

    // UTC13 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in; ExcessBalance available 230,000
    // Đầu vào : amount=230000; reason=<valid reason>; bankAccount=<valid bank account>
    // Mong đợi: Return: RefundRequest status Requested; reserved amount 230,000; available amount 0; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest entity (attributes, lifecycle: Requested amounts remain reserved); ExcessBalance
    [Fact(DisplayName = "BF06 UTC13 - Tenant yeu cau hoan 230.000: Requested, giu cho 230.000, kha dung 0")]
    public async Task UTC13_TenantRequestsRefund()
    {
        world.AsTenant();

        var view = await Service().CreateAsync(Source, new RefundInput(Tenant1, 230_000m, "Hoan tien phan tra thua hoa don INV-204", true), Guid.NewGuid(), default);
        var amounts = await AmountsAsOwner();

        AssertStatus("Requested", view.Status);
        Assert.Equal(230_000m, amounts.ReservedAmount);
        Assert.Equal(0m, amounts.AvailableAmount);
    }

    // UTC14 (Boundary) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in; ExcessBalance available 230,000
    // Đầu vào : amount=230001; reason=<valid reason>; bankAccount=<valid bank account>
    // Mong đợi: Return: RefundRequest not created; available amount remains 230,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest purpose 'against available excess balances'; ExcessBalance available amount (message text not in MSG table, see OQ)
    [Fact(DisplayName = "BF06 UTC14 - Yeu cau hoan 230.001 vuot so kha dung: khong tao, kha dung van 230.000")]
    public async Task UTC14_RefundAboveAvailable()
    {
        world.AsTenant();

        await Capture(() => Service().CreateAsync(Source, new RefundInput(Tenant1, 230_001m, "Hoan tien phan tra thua hoa don INV-204", true), Guid.NewGuid(), default));
        var amounts = await AmountsAsOwner();

        Assert.Empty(refunds.Records);
        Assert.Equal(230_000m, amounts.AvailableAmount);
    }

    // UTC15 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; RefundRequest Requested for 230,000
    // Đầu vào : ownerId=owner1; refundId=<valid refund id>; decision=Approve
    // Mong đợi: Return: RefundRequest status Approved; 230,000 remains reserved; Owner decision, actor and time retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest lifecycle (Requested -> Approved, Approved amounts remain reserved); Refund Decision definition; GBR-03; GBR-13
    [Fact(DisplayName = "BF06 UTC15 - Owner duyet hoan tien: Approved, van giu cho 230.000, luu Owner va thoi gian")]
    public async Task UTC15_OwnerApprovesRefund()
    {
        var requested = await Requested230000();
        world.AsOwner();

        var view = await Service().DecideAsync(requested.Id, new RefundDecision(requested.Version, true, "Dong y hoan tien", true), Guid.NewGuid(), default);
        var amounts = await AmountsAsOwner();
        var record = refunds.Records.Single(r => r.Id == requested.Id);

        AssertStatus("Approved", view.Status);
        Assert.Equal(230_000m, amounts.ReservedAmount);
        Assert.Equal(Owner1, record.DecidedBy);
        Assert.NotNull(view.DecidedAt);
    }

    // UTC16 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; RefundRequest Requested for 230,000
    // Đầu vào : ownerId=owner1; refundId=<valid refund id>; reason=<valid reason>
    // Mong đợi: Return: RefundRequest status Rejected; reservation released (available 230,000); Owner decision reason, actor and time retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest lifecycle (reserved until rejection); attribute Owner decision/reason; GBR-13
    [Fact(DisplayName = "BF06 UTC16 - Owner tu choi hoan tien: Rejected, tra lai kha dung 230.000, luu ly do")]
    public async Task UTC16_OwnerRejectsRefund()
    {
        var requested = await Requested230000();
        world.AsOwner();

        var view = await Service().DecideAsync(requested.Id, new RefundDecision(requested.Version, false, "Tenant con no hoa don ky sau", true), Guid.NewGuid(), default);
        var amounts = await AmountsAsOwner();
        var record = refunds.Records.Single(r => r.Id == requested.Id);

        AssertStatus("Rejected", view.Status);
        Assert.Equal(230_000m, amounts.AvailableAmount);
        Assert.Equal("Tenant con no hoa don ky sau", view.DecisionReason);
        Assert.Equal(Owner1, record.DecidedBy);
        Assert.NotNull(view.DecidedAt);
    }

    // UTC17 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: RefundRequest Approved for 230,000; money transferred outside BHOME
    // Đầu vào : refundId=<valid refund id>; evidence=transfer receipt file
    // Mong đợi: Return: RefundRequest status Completed; completion time and external transfer evidence retained; reservation cleared and excess reduced by 230,000 once; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest lifecycle (Approved -> Completed); External Refund Execution / Refund Evidence definitions; NFR 2.4 Financial Consistency
    [Fact(DisplayName = "BF06 UTC17 - Hoan tat hoan tien co bien lai: Completed, luu bang chung, tru 230.000 mot lan")]
    public async Task UTC17_CompleteRefundWithEvidence()
    {
        var approved = await Approved230000();
        world.AsOwner();

        var view = await Complete(approved, ReceiptImage);
        var amounts = await AmountsAsOwner();

        AssertStatus("Completed", view.Status);
        Assert.NotNull(view.ExecutedAt);
        Assert.Equal("FT26120600001", view.ExternalReference);
        await storage.Received(1).PutAsync(Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<long>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        Assert.Equal(0m, amounts.ReservedAmount);
        Assert.Equal(230_000m, amounts.RefundedAmount);
        Assert.Equal(0m, amounts.AvailableAmount);
    }

    // UTC18 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: RefundRequest Approved
    // Đầu vào : refundId=<valid refund id>; evidence=null
    // Mong đợi: Return: RefundRequest remains Approved; amount remains reserved; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : Refund Evidence definition; RefundRequest attribute external transfer evidence; MSG02 (mandatory evidence to be confirmed, see OQ)
    // Ghi chú : Log Message (MSG02) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF06 UTC18 - Hoan tat khong co bang chung: van Approved, van giu cho")]
    public async Task UTC18_CompleteWithoutEvidence()
    {
        var approved = await Approved230000();
        world.AsOwner();

        await Capture(() => Complete(approved, null));
        var amounts = await AmountsAsOwner();

        AssertStatus("Approved", refunds.Records.Single(r => r.Id == approved.Id).Status);
        Assert.Equal(230_000m, amounts.ReservedAmount);
    }

    // UTC19 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: RefundRequest already Completed
    // Đầu vào : refundId=<valid refund id>; evidence=transfer receipt file
    // Mong đợi: Return: request not applied; RefundRequest remains Completed; excess not reduced again; Exception: N/A; Log Message: N/A
    // Căn cứ  : RefundRequest lifecycle (Completed is final); NFR 2.4 Financial Consistency; GBR-18
    [Fact(DisplayName = "BF06 UTC19 - Hoan tat lai yeu cau da Completed: khong ap dung, khong tru them")]
    public async Task UTC19_CompleteTwice()
    {
        var approved = await Approved230000();
        world.AsOwner();
        var completed = await Complete(approved, ReceiptImage);

        await Capture(() => Complete(completed, ReceiptImage));
        var amounts = await AmountsAsOwner();

        AssertStatus("Completed", refunds.Records.Single(r => r.Id == approved.Id).Status);
        Assert.Equal(230_000m, amounts.RefundedAmount);
        Assert.Equal(0m, amounts.AvailableAmount);
    }

    // UTC20 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: ExcessBalance available 230,000, unreserved; refund deadline 2026-12-05
    // Đầu vào : runDate=2026-12-06
    // Mong đợi: Return: 230,000 converted into Tenant Credit; converted credit 230,000; remaining credit 230,000; refund-eligible available amount 0; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance lifecycle (expired unreserved amounts convert once into Tenant Credit); attributes refund deadline, converted/remaining credit
    [Fact(DisplayName = "BF06 UTC20 - Qua han hoan tien: chuyen 230.000 thanh Tenant Credit")]
    public void UTC20_ConvertExpiredExcessToCredit() =>
        Assert.Fail("Chưa tìm thấy chức năng convertExcessToCredit trong hệ thống (danh mục chữ ký)");

    // UTC21 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: ExcessBalance 230,000; 100,000 reserved by Requested refund; refund deadline passed
    // Đầu vào : runDate=after deadline
    // Mong đợi: Return: 130,000 converted into Tenant Credit; reserved 100,000 untouched; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance lifecycle (only unreserved amounts convert); RefundRequest reserved amounts
    [Fact(DisplayName = "BF06 UTC21 - Chi chuyen phan khong giu cho (130.000) thanh Tenant Credit")]
    public void UTC21_ConvertOnlyUnreserved() =>
        Assert.Fail("Chưa tìm thấy chức năng convertExcessToCredit trong hệ thống (danh mục chữ ký)");

    // UTC22 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: ExcessBalance already converted into Tenant Credit
    // Đầu vào : runDate=after deadline (conversion runs again)
    // Mong đợi: Return: no change; credit not converted a second time; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance lifecycle ('convert once'); GBR-18
    [Fact(DisplayName = "BF06 UTC22 - Chay lai chuyen doi: khong chuyen lan hai")]
    public void UTC22_ConvertOnlyOnce() =>
        Assert.Fail("Chưa tìm thấy chức năng convertExcessToCredit trong hệ thống (danh mục chữ ký)");
}
