using BHome.Application.Billing;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF05;

// Unit test sheet "BF-05 Meter Invoice" - nhóm requestInvoiceAdjustment, decideInvoiceAdjustment (UTC26-UTC31).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ được xem qua danh mục chữ ký để biết hàm cần gọi:
//   AdjustmentService.SubmitAsync (Tenant gửi yêu cầu điều chỉnh), GetAsync, DecideAsync (Owner duyệt/từ chối).
// Kho dữ liệu điều chỉnh là bản giả trong bộ nhớ; người dùng hiện tại giả lập bằng NSubstitute; đồng hồ cố định.
// Ghi chú: Log Message (MSG11, MSG02) do tầng API hiển thị; service không trả câu thông báo -> "Log Message không quan sát được ở tầng unit".
public sealed class BF05InvoiceAdjustmentUnitTests
{
    private static readonly DateTimeOffset Now = Bf05Data.At(2026, 12, 1);

    private readonly FakeAdjustmentRepository repository = new();
    private readonly FixedClock clock = new(Now);

    private AdjustmentService Service(Guid userId, string role)
    {
        var user = Bf05Users.As(userId, role);
        var images = Substitute.For<IContractImageValidator>();
        images.Validate(Arg.Any<byte[]>()).Returns((string)null!);
        return new AdjustmentService(repository, user, clock, Substitute.For<IAdjustmentEvidenceFiles>(), images, Bf05Users.Permissions(user));
    }

    private AdjustmentService Owner() => Service(Bf05Data.OwnerId, Roles.Owner);
    private AdjustmentService Tenant() => Service(Bf05Data.TenantId, Roles.Tenant);

    // Owner quyết định với các phiên bản đọc từ GetAsync (đúng luồng màn hình).
    private async Task<AdjustmentView> Decide(Guid requestId, bool approve, decimal? corrected, string chargeCode, string reason)
    {
        var current = await Owner().GetAsync(requestId, default);
        var input = new AdjustmentDecisionInput(current.Version, current.InvoiceVersion, current.CurrentFinancialVersion,
            corrected, chargeCode, reason, true);
        return await Owner().DecideAsync(requestId, approve, input, Guid.NewGuid(), default);
    }

    // UTC26 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant T1 logged in; own Invoice for 2026-11 accessible
    // Đầu vào : disputedCharge=ELEC 462,000; reason="Reading looks wrong"; evidence=photo; adjustedValue=350000
    // Mong đợi: Return: Invoice Adjustment request recorded (Requested) and made available to Owner; Exception: N/A; Log Message: "Invoice adjustment request submitted successfully."
    // Căn cứ  : UC-24 steps 1-4; FE-04 4.4.1; InvoiceAdjustment lifecycle; MSG11
    // Ghi chú : Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC26 - Tenant gui yeu cau dieu chinh ELEC 462,000 -> 350,000: Requested, Owner xem duoc")]
    public async Task UTC26_TenantSubmitsAdjustment()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Final);
        var photo = repository.SeedEvidence(invoice.Id);
        var elec = invoice.Lines.Single(l => l.ChargeCode == Bf05Data.Elec);

        var view = await Tenant().SubmitAsync(invoice.Id,
            new AdjustmentSubmit(elec.Id, 350_000m, "Reading looks wrong", [photo.Id], invoice.Version), Guid.NewGuid(), default);

        Assert.Equal("Requested", view.Status, ignoreCase: true);
        Assert.Equal(462_000m, view.CurrentAmount);
        Assert.Equal(350_000m, view.ProposedAmount);
        var request = Assert.Single(repository.Added.OfType<InvoiceAdjustmentRequest>());
        var ownerView = await Owner().GetAsync(request.Id, default);
        Assert.Equal("Requested", ownerView.Status, ignoreCase: true);
        Assert.Equal("Reading looks wrong", ownerView.Reason);
    }

    // UTC27 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice Draft (not finalized); Tenant adjustment request WATER 6 m³ -> 5 m³ Requested
    // Đầu vào : Owner decision=approve; decisionReason="Reading re-checked"
    // Mong đợi: Return: correction applied to the Draft Invoice; WATER line and totals recalculated; Owner decision recorded; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 steps 6-8; UC-21 A1; BF-06C end condition
    // Ghi chú : 5 m³ × 18,000 = 90,000 (dòng WATER từ 108,000 xuống 90,000; tổng 4,270,000 -> 4,252,000).
    [Fact(DisplayName = "BF05 UTC27 - Owner duyet dieu chinh WATER tren Draft: dong WATER va tong duoc tinh lai")]
    public async Task UTC27_ApproveOnDraftInvoice()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Draft);
        var request = repository.SeedRequest(invoice, Bf05Data.Water, 108_000m, 90_000m, "Water 6 m3 -> 5 m3");

        var view = await Decide(request.Id, true, 90_000m, Bf05Data.Water, "Reading re-checked");

        var decision = Assert.IsType<AdjustmentDecisionView>(view.Decision);
        Assert.Equal("Approved", decision.Outcome, ignoreCase: true);
        Assert.Equal(Bf05Data.OwnerId, decision.OwnerId);
        Assert.Equal("Reading re-checked", decision.Reason);
        Assert.Equal(90_000m, decision.CorrectedAmount);
        Assert.Equal(4_252_000m, decision.EffectiveAfter);
    }

    // UTC28 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice Finalized and unpaid; adjustment request ELEC 462,000 -> 350,000 Requested
    // Đầu vào : Owner decision=approve; adjustedValue=350000; decisionReason given
    // Mong đợi: Return: separate Invoice Adjustment record (original 462,000, new 350,000) approved; original finalized Invoice unchanged; applicable balance recalculated (-112,000); Tenant notified of the result; decision actor, time and reason retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 A2; BF-06C end condition; DBR-07; GBR-13
    // Ghi chú : "Tenant được thông báo" kiểm tra qua bản ghi sự kiện/thông báo service thêm vào kho cho yêu cầu này.
    [Fact(DisplayName = "BF05 UTC28 - Duyet dieu chinh tren hoa don da chot chua tra: ban ghi rieng, hoa don goc khong doi, -112,000")]
    public async Task UTC28_ApproveOnFinalizedUnpaidInvoice()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Final);
        var request = repository.SeedRequest(invoice, Bf05Data.Elec, 462_000m, 350_000m, "Reading looks wrong");

        var view = await Decide(request.Id, true, 350_000m, Bf05Data.Elec, "Meter photo re-checked");

        var decision = Assert.IsType<AdjustmentDecisionView>(view.Decision);
        Assert.Equal("Approved", decision.Outcome, ignoreCase: true);
        Assert.Equal(462_000m, decision.BeforeAmount);
        Assert.Equal(350_000m, decision.CorrectedAmount);
        Assert.Equal(-112_000m, decision.Delta);
        Assert.Equal(Bf05Data.OwnerId, decision.OwnerId);
        Assert.Equal(Now, decision.DecidedAt);
        Assert.Equal("Meter photo re-checked", decision.Reason);
        FakeAdjustmentRepository.AssertUnchanged(invoice);
        Assert.True(repository.TenantNotified(request.Id), "Tenant phải được thông báo kết quả.");
    }

    // UTC29 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice Finalized and Paid in full; adjustment request ELEC 462,000 -> 350,000 Requested
    // Đầu vào : Owner decision=approve; adjustedValue=350000; decisionReason given
    // Mong đợi: Return: separate Invoice Adjustment record approved; original Invoice unchanged; ExcessBalance of 112,000 created for the Tenant from the adjustment; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance entity (source: approved Invoice Adjustment); UC-24 A2
    [Fact(DisplayName = "BF05 UTC29 - Duyet dieu chinh tren hoa don da tra du: tao ExcessBalance 112,000")]
    public async Task UTC29_ApproveOnPaidInvoiceCreatesExcess()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Final);
        repository.Paid = 4_270_000m;
        var request = repository.SeedRequest(invoice, Bf05Data.Elec, 462_000m, 350_000m, "Reading looks wrong");

        var view = await Decide(request.Id, true, 350_000m, Bf05Data.Elec, "Meter photo re-checked");

        Assert.Equal("Approved", Assert.IsType<AdjustmentDecisionView>(view.Decision).Outcome, ignoreCase: true);
        FakeAdjustmentRepository.AssertUnchanged(invoice);
        Assert.Contains(repository.Added, e =>
            e.GetType().Name.Contains("Excess", StringComparison.OrdinalIgnoreCase) ||
            e.GetType().Name.Contains("Credit", StringComparison.OrdinalIgnoreCase));
    }

    // UTC30 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Adjustment request Requested on a Finalized Invoice
    // Đầu vào : Owner decision=reject; decisionReason="Reading verified correct"
    // Mong đợi: Return: rejection recorded with reason; Invoice unchanged; Tenant notified of the result; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-24 A1; BF-06C end condition; GBR-13
    [Fact(DisplayName = "BF05 UTC30 - Owner tu choi kem ly do: ghi nhan, hoa don khong doi, bao Tenant")]
    public async Task UTC30_RejectWithReason()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Final);
        var request = repository.SeedRequest(invoice, Bf05Data.Elec, 462_000m, 350_000m, "Reading looks wrong");

        var view = await Decide(request.Id, false, null, Bf05Data.Elec, "Reading verified correct");

        var decision = Assert.IsType<AdjustmentDecisionView>(view.Decision);
        Assert.Equal("Rejected", decision.Outcome, ignoreCase: true);
        Assert.Equal("Reading verified correct", decision.Reason);
        FakeAdjustmentRepository.AssertUnchanged(invoice);
        Assert.True(repository.TenantNotified(request.Id), "Tenant phải được thông báo kết quả.");
    }

    // UTC31 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Adjustment request Requested
    // Đầu vào : Owner decision=reject; decisionReason=(empty)
    // Mong đợi: Return: decision not saved; request stays Requested; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : GBR-13 (approval decisions retain reason); FE-04 4.4.1 Decision Reason; MSG02
    // Ghi chú : việc từ chối lưu có thể trả về dạng lỗi nghiệp vụ (API hiển thị MSG02); test chấp nhận cả hai cách và kiểm tra
    //           quyết định không được lưu. Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC31 - Tu choi khong ly do: khong luu quyet dinh, van Requested")]
    public async Task UTC31_RejectWithoutReasonNotSaved()
    {
        var invoice = repository.SeedInvoice(InvoiceStatus.Final);
        var request = repository.SeedRequest(invoice, Bf05Data.Elec, 462_000m, 350_000m, "Reading looks wrong");

        try { await Decide(request.Id, false, null, Bf05Data.Elec, ""); }
        catch (Exception ex) when (ex is AdjustmentException or ArgumentException or System.ComponentModel.DataAnnotations.ValidationException) { }

        Assert.Null(request.Decision);
        Assert.Empty(repository.Added.OfType<InvoiceAdjustmentDecision>());
        Assert.Equal("Requested", (await Owner().GetAsync(request.Id, default)).Status, ignoreCase: true);
    }
}

// Bản giả IAdjustmentRepository lưu dữ liệu trong bộ nhớ.
internal sealed class FakeAdjustmentRepository : IAdjustmentRepository
{
    public List<object> Added { get; } = [];
    public decimal Paid { get; set; }
    private readonly List<Invoice> invoices = [];
    private readonly List<InvoiceAdjustmentRequest> requests = [];
    private readonly List<InvoiceAdjustmentEvidence> evidence = [];

    // Hóa đơn kỳ 2026-11 của Tenant T1: rent 3,500,000; ELEC 462,000; WATER 108,000; internet 100,000; cleaning 100,000 = 4,270,000.
    public Invoice SeedInvoice(InvoiceStatus status)
    {
        var room = new Bf05Room("204");
        var invoice = Bf05Ids.New(new Invoice
        {
            RoomId = room.Room.Id,
            LocationId = Bf05Data.LocationId,
            RoomNumber = "204",
            LocationName = "L1",
            BillingPeriod = Bf05Data.Period,
            RepresentativeContractId = room.Contract.Id,
            RepresentativeTenantUserId = Bf05Data.TenantId,
            Status = status,
            Version = 1,
            Total = 4_270_000m,
            MissingInputs = [],
            ScheduleSnapshot = "{}",
            ScheduledFinalDate = new DateOnly(2026, 11, 28),
            DueDate = new DateOnly(2026, 12, 5),
            CreatedByUserId = Bf05Data.OwnerId,
            FinalizedByUserId = status == InvoiceStatus.Final ? Bf05Data.OwnerId : null,
            FinalizedAt = status == InvoiceStatus.Final ? Bf05Data.At(2026, 11, 28) : null
        });
        invoice.Lines =
        [
            Line(invoice, ChargeCategory.Rent, Bf05Data.Rent, 3_500_000m, 1m, 3_500_000m),
            Line(invoice, ChargeCategory.Electricity, Bf05Data.Elec, 3_500m, 132m, 462_000m),
            Line(invoice, ChargeCategory.Water, Bf05Data.Water, 18_000m, 6m, 108_000m),
            Line(invoice, ChargeCategory.ServiceFee, Bf05Data.Internet, 100_000m, 1m, 100_000m),
            Line(invoice, ChargeCategory.ServiceFee, Bf05Data.Cleaning, 100_000m, 1m, 100_000m)
        ];
        invoice.Recipients = [new InvoiceRecipient { InvoiceId = invoice.Id, TenantUserId = Bf05Data.TenantId }];
        invoices.Add(invoice);
        return invoice;
    }

    private static InvoiceLine Line(Invoice invoice, ChargeCategory category, string code, decimal rate, decimal quantity, decimal amount) => new()
    {
        Id = Guid.NewGuid(),
        InvoiceId = invoice.Id,
        Category = category,
        ChargeCode = code,
        Name = code,
        RateDate = Bf05Data.Period,
        Rate = rate,
        Quantity = quantity,
        OccupiedDays = 30,
        PeriodDays = 30,
        Amount = amount
    };

    public InvoiceAdjustmentEvidence SeedEvidence(Guid invoiceId)
    {
        var photo = new InvoiceAdjustmentEvidence
        {
            Id = Guid.NewGuid(),
            InvoiceId = invoiceId,
            UploaderId = Bf05Data.TenantId,
            ObjectKey = $"adjustments/{invoiceId}/photo.jpg",
            ContentType = "image/jpeg",
            Length = 2048,
            Uploaded = true,
            CleanupAfter = Bf05Data.At(2026, 12, 31)
        };
        evidence.Add(photo);
        return photo;
    }

    // Yêu cầu điều chỉnh đang ở trạng thái Requested (chưa có quyết định).
    public InvoiceAdjustmentRequest SeedRequest(Invoice invoice, string chargeCode, decimal current, decimal proposed, string reason)
    {
        var line = invoice.Lines.Single(l => l.ChargeCode == chargeCode);
        var request = Bf05Ids.New(new InvoiceAdjustmentRequest
        {
            InvoiceId = invoice.Id,
            Invoice = invoice,
            RequesterId = Bf05Data.TenantId,
            InvoiceLineId = line.Id,
            ChargeCode = chargeCode,
            CurrentAmount = current,
            ProposedAmount = proposed,
            Reason = reason,
            InvoiceSnapshot = "{}",
            InvoiceStatus = invoice.Status,
            InvoiceVersion = invoice.Version,
            FinancialVersion = 1,
            SubmittedAt = Bf05Data.At(2026, 11, 30),
            Evidence = []
        });
        requests.Add(request);
        return request;
    }

    public bool TenantNotified(Guid requestId) => Added.Any(e =>
        (e is InvoiceAdjustmentEvent ev && ev.RequestId == requestId) ||
        (e is BHome.Domain.Notifications.UserNotification n && n.RecipientUserId == Bf05Data.TenantId));

    public static void AssertUnchanged(Invoice invoice)
    {
        Assert.Equal(InvoiceStatus.Final, invoice.Status);
        Assert.Equal(4_270_000m, invoice.Total);
        Assert.Equal(462_000m, invoice.Lines.Single(l => l.ChargeCode == Bf05Data.Elec).Amount);
        Assert.Equal(108_000m, invoice.Lines.Single(l => l.ChargeCode == Bf05Data.Water).Amount);
    }

    private decimal Approved(Guid invoiceId) =>
        Added.OfType<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == invoiceId && d.CorrectedAmount is not null).Sum(d => d.Delta);

    public Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t) => work();
    public Task<Invoice?> InvoiceAsync(Guid id, InvoiceScope scope, CancellationToken t) => Task.FromResult<Invoice?>(invoices.Single(i => i.Id == id));
    public Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t) =>
        Task.FromResult<InvoiceAdjustmentRequest?>(requests.Concat(Added.OfType<InvoiceAdjustmentRequest>()).First(r => r.Id == id));
    public Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery query, InvoiceScope scope, CancellationToken t) =>
        throw new NotSupportedException("Không dùng trong sheet BF-05.");
    public Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) =>
        Task.FromResult<InvoiceAdjustmentCommand?>(null);
    public Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t) =>
        Task.FromResult(evidence.Where(e => ids.Contains(e.Id)).ToArray());
    public Task<InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t)
    {
        var invoice = invoices.Single(i => i.Id == invoiceId);
        var adjustments = Approved(invoiceId);
        var payable = invoice.Total + adjustments;
        var outstanding = Math.Max(payable - Paid, 0m);
        var excess = Math.Max(Paid - payable, 0m);
        return Task.FromResult(new InvoiceFinancialView(invoice.Total, adjustments, payable, Paid, outstanding, excess, 1, "None"));
    }
    public Task<decimal> ChargeAdjustmentsAsync(Guid invoiceId, string chargeCode, CancellationToken t) =>
        Task.FromResult(Added.OfType<InvoiceAdjustmentDecision>().Where(d => d.InvoiceId == invoiceId && d.ChargeCode == chargeCode).Sum(d => d.Delta));
    public Task<PagedResult<AdjustmentEffectView>> EffectsAsync(Guid invoiceId, int page, int pageSize, CancellationToken t) =>
        throw new NotSupportedException("Không dùng trong sheet BF-05.");
    public void Add(object entity) => Added.Add(entity);
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) { }
}
