using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using NSubstitute;
using static BHome.Application.UnitTests.UnitTestDoc.BF06.BF06TestWorld;

namespace BHome.Application.UnitTests.UnitTestDoc.BF06;

// Unit test cho sheet "BF-06 Payment Debt" - nhóm requestInvoiceAdjustment / decideInvoiceAdjustment (UTC30-UTC33).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: UC-24, UC-21 A1, BF-06C, DBR-07, GBR-09, GBR-13, MSG11).
// Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký):
//   - requestInvoiceAdjustment -> AdjustmentService.SubmitAsync(invoiceId, AdjustmentSubmit, key)
//   - decideInvoiceAdjustment  -> AdjustmentService.DecideAsync(id, approve, AdjustmentDecisionInput, key)
//   - "Tenant notified"        -> sự kiện InvoiceAdjustmentEvent được ghi cho yêu cầu (kênh thông báo duy nhất thấy trong chữ ký).
// Log Message (MSG11) không quan sát được ở tầng unit.
public sealed class BF06InvoiceAdjustmentUnitTests
{
    private readonly BF06TestWorld world = new();
    private readonly FakeAdjustmentRepository repository = new();
    private readonly IAdjustmentEvidenceFiles files = Substitute.For<IAdjustmentEvidenceFiles>();
    private readonly IContractImageValidator images = Substitute.For<IContractImageValidator>();

    public BF06InvoiceAdjustmentUnitTests() =>
        images.Validate(Arg.Any<byte[]>()).Returns("image/jpeg");

    private AdjustmentService Service() => new(repository, world.User, world.Clock, files, images, world.Permissions());

    private Guid Photo(Guid invoiceId)
    {
        var evidence = new InvoiceAdjustmentEvidence
        {
            Id = Guid.NewGuid(),
            InvoiceId = invoiceId,
            UploaderId = Tenant1,
            ObjectKey = $"adjustment-evidence/{Guid.NewGuid()}",
            ContentType = "image/jpeg",
            Length = 2048,
            Uploaded = true,
            CleanupAfter = world.Now.AddHours(1)
        };
        repository.Evidence.Add(evidence);
        return evidence.Id;
    }

    private static InvoiceLine Electricity(Invoice invoice) => invoice.Lines.Single(l => l.Category == ChargeCategory.Electricity);

    // Tenant gửi yêu cầu: tiền điện 500.000 -> 400.000.
    private Task<AdjustmentView> TenantRequests(Invoice invoice)
    {
        world.AsTenant();
        return Service().SubmitAsync(invoice.Id,
            new AdjustmentSubmit(Electricity(invoice).Id, 400_000m, "Chi so dien bi ghi sai", [Photo(invoice.Id)], invoice.Version), Guid.NewGuid(), default);
    }

    private Task<AdjustmentView> OwnerDecides(AdjustmentView request, bool approve)
    {
        world.AsOwner();
        return Service().DecideAsync(request.Id, approve,
            new AdjustmentDecisionInput(request.Version, request.InvoiceVersion, request.FinancialVersion, approve ? 400_000m : null,
                request.ChargeCode, approve ? "Xac nhan ghi sai chi so dien" : "Chi so dien dung", true), Guid.NewGuid(), default);
    }

    private bool TenantNotified(Guid requestId) =>
        repository.Others.OfType<InvoiceAdjustmentEvent>().Any(e => e.RequestId == requestId && e.RequesterId == Tenant1);

    // UTC30 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant logged in; own Invoice INV-204 Finalized
    // Đầu vào : invoiceId=INV-204; disputedCharge=electricity; reason=<valid reason>; evidence=photo
    // Mong đợi: Return: InvoiceAdjustment request recorded with status Requested and made available to Owner; Invoice unchanged; Exception: N/A; Log Message: "Invoice adjustment request submitted successfully."
    // Căn cứ  : UC-24 NF 1-4; BF-06C trigger; FE-04 4.4.1; InvoiceAdjustment lifecycle; MSG11
    // Ghi chú : Log Message (MSG11) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF06 UTC30 - Tenant yeu cau dieu chinh tien dien: Requested, Owner thay duoc, hoa don khong doi")]
    public async Task UTC30_TenantRequestsAdjustment()
    {
        var invoice = Invoice204();
        repository.Invoices.Add(invoice);

        var view = await TenantRequests(invoice);
        world.AsOwner();
        var ownerList = await Service().ListAsync(new AdjustmentQuery { Page = 1, PageSize = 20 }, default);

        AssertStatus("Requested", view.Status);
        Assert.Contains(ownerList.Items, r => r.Id == view.Id);
        Assert.Equal(4_270_000m, invoice.Total);
        Assert.Equal(500_000m, Electricity(invoice).Amount);
        Assert.Equal(InvoiceStatus.Final, invoice.Status);
    }

    // UTC31 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; adjustment request on Draft Invoice INV-205 (electricity 500,000 -> 400,000)
    // Đầu vào : ownerId=owner1; adjustmentId=<valid id>; decision=Approve; reason=<valid reason>
    // Mong đợi: Return: Draft Invoice INV-205 electricity charge updated to 400,000; Owner decision and result recorded; Tenant notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 NF 7-8; UC-21 A1; BF-06C end condition
    [Fact(DisplayName = "BF06 UTC31 - Owner duyet dieu chinh tren hoa don Draft: tien dien cap nhat 400.000")]
    public async Task UTC31_ApproveOnDraftInvoice()
    {
        var invoice = Invoice205Draft();
        repository.Invoices.Add(invoice);
        var request = await TenantRequests(invoice);

        var decided = await OwnerDecides(request, approve: true);

        Assert.Equal(400_000m, Electricity(invoice).Amount);
        Assert.NotNull(decided.Decision);
        Assert.Equal(Owner1, decided.Decision!.OwnerId);
        Assert.True(TenantNotified(request.Id), "Không có thông báo cho Tenant về kết quả điều chỉnh");
    }

    // UTC32 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; adjustment request on Finalized Invoice INV-204 (electricity 500,000 -> 400,000)
    // Đầu vào : ownerId=owner1; adjustmentId=<valid id>; decision=Approve; reason=<valid reason>
    // Mong đợi: Return: separate InvoiceAdjustment record created with original and new value; original Invoice INV-204 unchanged; applicable balance recalculated; Tenant notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 A2, Postconditions 3-4; BF-06C end condition; DBR-07; GBR-09
    [Fact(DisplayName = "BF06 UTC32 - Owner duyet dieu chinh tren hoa don Finalized: ban ghi rieng, hoa don goc khong doi")]
    public async Task UTC32_ApproveOnFinalizedInvoice()
    {
        var invoice = Invoice204();
        repository.Invoices.Add(invoice);
        var request = await TenantRequests(invoice);

        var decided = await OwnerDecides(request, approve: true);

        var record = Assert.Single(repository.Decisions);
        Assert.Equal(500_000m, record.BeforeAmount);
        Assert.Equal(400_000m, record.CorrectedAmount);
        Assert.Equal(500_000m, Electricity(invoice).Amount);
        Assert.Equal(4_270_000m, invoice.Total);
        Assert.NotNull(decided.Decision);
        Assert.Equal(decided.Decision!.EffectiveBefore - 100_000m, decided.Decision.EffectiveAfter);
        Assert.True(TenantNotified(request.Id), "Không có thông báo cho Tenant về kết quả điều chỉnh");
    }

    // UTC33 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; adjustment request on Invoice INV-204
    // Đầu vào : ownerId=owner1; adjustmentId=<valid id>; decision=Reject; reason=<valid reason>
    // Mong đợi: Return: adjustment status Rejected; rejection recorded; Invoice unchanged; Tenant notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 A1; BF-06C end condition; GBR-13
    [Fact(DisplayName = "BF06 UTC33 - Owner tu choi dieu chinh: Rejected, hoa don khong doi")]
    public async Task UTC33_RejectAdjustment()
    {
        var invoice = Invoice204();
        repository.Invoices.Add(invoice);
        var request = await TenantRequests(invoice);

        var decided = await OwnerDecides(request, approve: false);

        AssertStatus("Rejected", decided.Status);
        Assert.NotNull(decided.Decision);
        Assert.Equal(500_000m, Electricity(invoice).Amount);
        Assert.Equal(4_270_000m, invoice.Total);
        Assert.True(TenantNotified(request.Id), "Không có thông báo cho Tenant về kết quả điều chỉnh");
    }
}
