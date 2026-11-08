using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using static BHome.Application.UnitTests.UnitTestDoc.BF06.BF06TestWorld;

namespace BHome.Application.UnitTests.UnitTestDoc.BF06;

// Unit test cho sheet "BF-06 Payment Debt" - nhóm receiveBankTransfer / reconcilePayment / verifyPaymentManually (UTC01-UTC12).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: UC-22, API-01, JOB-03, DBR-08, GBR-10, GBR-18, §3.2 Payment/Invoice).
// Code chỉ dùng để biết cách gọi hàm (danh mục chữ ký):
//   - Nhận giao dịch ngân hàng  -> PaymentService.RegisterAsync(PaymentTransferInput, key)
//     (hệ thống chỉ có cách nhận giao dịch này; không có đầu vào eventId/chữ ký của cổng thanh toán, eventId được ánh xạ sang khóa idempotency)
//   - Đối soát theo mã thanh toán -> giao dịch đăng ký kèm nội dung chứa Payment Code (PaymentRules.InvoiceReference), không chỉ định hóa đơn
//   - Xác minh thủ công         -> PaymentService.AllocateAsync(transferId, PaymentMatchInput, key)
//   - Trạng thái hóa đơn        -> PaymentService.InvoicePaymentAsync(invoiceId)
// Quy ước: "Exception: N/A" ở các case bị từ chối/bỏ qua được hiểu là không có lỗi hệ thống ngoài dự kiến; nếu hàm từ chối
// bằng ngoại lệ nghiệp vụ thì test vẫn kiểm tra đầy đủ trạng thái dữ liệu theo sheet.
// Log Message ở tầng này không quan sát được (hàm chỉ trả trạng thái/mã), câu thông báo do API/UI hiển thị.
public sealed class BF06PaymentReconciliationUnitTests
{
    private const string Provider = "BANK-GATEWAY";
    private readonly BF06TestWorld world = new();

    private string PaymentCode => PaymentRules.InvoiceReference(Inv204);

    private static Guid KeyOf(string eventId) => new(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes(eventId)));

    private PaymentTransferInput Transfer(string reference, decimal amount, string content, string eventId) =>
        new(Provider, reference, amount, "VND", world.Now, content, $"Bank statement event {eventId}",
            $"Bank transaction data event {eventId}", null, true);

    private Task<TransferView> Receive(string reference, decimal amount, string content, string eventId) =>
        world.PaymentService().RegisterAsync(Transfer(reference, amount, content, eventId), KeyOf(eventId), default);

    private void Invoice204Outstanding4270000() => world.Payments.Invoices.Add(Invoice204());

    // Điều kiện "đã nhận và đã đối soát": nhận giao dịch có nội dung đúng bằng Payment Code; nếu chưa được gắn hóa đơn
    // thì Owner gắn vào INV-204 (cách dựng điều kiện, không phải đối tượng kiểm thử của case).
    private async Task<TransferView> ReceivedAndReconciled(string reference, string eventId)
    {
        var view = await Receive(reference, 4_270_000m, PaymentCode, eventId);
        if (!world.Payments.Allocations.Any(a => a.TransferId == view.Id))
            await world.PaymentService().AllocateAsync(view.Id, new PaymentMatchInput(Inv204, Tenant1, true), Guid.NewGuid(), default);
        Assert.Single(world.Payments.Allocations);
        return view;
    }

    private Task<InvoicePaymentView> InvoiceView() => world.PaymentService().InvoicePaymentAsync(Inv204, default);

    // UTC01 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Bank transaction data from Payment Gateway; provider authenticity and integrity valid; transaction not received before
    // Đầu vào : eventId=E1; ref=TX1001; amount=4270000; content="BH7K2Q9 phong 204"
    // Mong đợi: Return: transaction data accepted and passed to automatic matching with the related Invoice; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-22 NF 1-3; API-01 Required Behavior + Security
    [Fact(DisplayName = "BF06 UTC01 - Nhan giao dich ngan hang hop le: chap nhan va doi soat voi hoa don lien quan")]
    public async Task UTC01_ReceiveValidTransfer()
    {
        Invoice204Outstanding4270000();

        var view = await Receive("TX1001", 4_270_000m, $"{PaymentCode} phong 204", "E1");

        Assert.NotNull(view);
        Assert.True(view.AllocatedInvoiceId == Inv204 || view.ProposedInvoiceId == Inv204,
            $"Giao dịch không được gắn với hóa đơn liên quan (AllocatedInvoiceId={view.AllocatedInvoiceId}, ProposedInvoiceId={view.ProposedInvoiceId}, Status={view.Status})");
    }

    // UTC02 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Bank transaction data whose provider authenticity cannot be validated
    // Đầu vào : eventId=E2; signature=INVALID
    // Mong đợi: Return: transaction is not reconciled; no Payment recorded; Invoice unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : API-01 Security (provider authenticity and transaction integrity must be validated); UC-22 NF 2
    [Fact(DisplayName = "BF06 UTC02 - Giao dich khong xac thuc duoc nguon (chu ky sai): khong doi soat")]
    public void UTC02_InvalidProviderSignature() =>
        Assert.Fail("Chưa tìm thấy chức năng xác thực nguồn giao dịch (chữ ký nhà cung cấp/cổng thanh toán) trong hệ thống (danh mục chữ ký): " +
                    "chức năng nhận giao dịch không có đầu vào chữ ký/bằng chứng xác thực nên không thể từ chối signature=INVALID.");

    // UTC03 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Transaction event E1 already received and reconciled
    // Đầu vào : eventId=E1 (same event resent 3 times)
    // Mong đợi: Return: payment effect applied only once; no duplicate Payment or balance update; Exception: N/A; Log Message: N/A
    // Căn cứ  : DBR-08; GBR-10; GBR-18; NFR 2.3 Payment Integrity
    [Fact(DisplayName = "BF06 UTC03 - Gui lai cung su kien E1 3 lan: chi ghi nhan 1 lan")]
    public async Task UTC03_SameEventResentThreeTimes()
    {
        Invoice204Outstanding4270000();
        await ReceivedAndReconciled("TX1001", "E1");

        for (var i = 0; i < 3; i++)
            await Capture(() => Receive("TX1001", 4_270_000m, PaymentCode, "E1"));

        Assert.Single(world.Payments.Transfers);
        Assert.Single(world.Payments.Allocations);
        Assert.Equal(4_270_000m, world.Payments.Allocations.Sum(a => a.Amount));
    }

    // UTC04 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Payment with bank transaction reference TX1001 already exists
    // Đầu vào : eventId=E3; ref=TX1001
    // Mong đợi: Return: duplicate ignored; no new Payment; no additional balance effect; Exception: N/A; Log Message: N/A
    // Căn cứ  : DBR-08; GBR-10; API-01 Required Behavior
    [Fact(DisplayName = "BF06 UTC04 - Su kien moi E3 trung ma giao dich TX1001: bo qua, khong ghi them")]
    public async Task UTC04_DuplicateBankReference()
    {
        Invoice204Outstanding4270000();
        await ReceivedAndReconciled("TX1001", "E1");

        await Capture(() => Receive("TX1001", 4_270_000m, PaymentCode, "E3"));

        Assert.Single(world.Payments.Transfers);
        Assert.Single(world.Payments.Allocations);
        Assert.Equal(4_270_000m, world.Payments.Allocations.Sum(a => a.Amount));
    }

    // UTC05 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 Finalized; outstanding 4,270,000; Payment Code BH7K2Q9 current
    // Đầu vào : amount=4270000; paymentCode=BH7K2Q9
    // Mong đợi: Return: Payment status Matched; Invoice status Paid; outstanding balance 0; reconciliation evidence retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-22 NF 3-5; BF-06A end condition; Payment / Invoice lifecycle §3.2; FE-05 5.1.1
    [Fact(DisplayName = "BF06 UTC05 - Thanh toan du so tien dung ma: Matched, hoa don Paid, con no 0")]
    public async Task UTC05_ExactAmountMatched()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2005", 4_270_000m, $"{PaymentCode} phong 204", "E5");
        var invoice = await InvoiceView();

        AssertStatus("Matched", transfer.Status);
        AssertStatus("Paid", invoice.PaymentStatus);
        Assert.Equal(0m, invoice.OutstandingAmount);
        Assert.Contains(world.Payments.Reconciliations, r => r.TransferId == transfer.Id);
    }

    // UTC06 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 Finalized; outstanding 4,270,000
    // Đầu vào : amount=2000000; paymentCode=BH7K2Q9
    // Mong đợi: Return: Payment status Underpayment; Invoice status Partially Paid; paid amount 2,000,000; outstanding 2,270,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : Payment lifecycle (Underpayment); Invoice lifecycle (Partially Paid); FE-05 5.2.1 Paid/Outstanding Amount; UC-23 NF 2
    [Fact(DisplayName = "BF06 UTC06 - Thanh toan thieu 2.000.000: Underpayment, Partially Paid, con no 2.270.000")]
    public async Task UTC06_Underpayment()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2006", 2_000_000m, $"{PaymentCode} phong 204", "E6");
        var invoice = await InvoiceView();

        AssertStatus("Underpayment", transfer.Status);
        AssertStatus("Partially Paid", invoice.PaymentStatus);
        Assert.Equal(2_000_000m, invoice.PaidAmount);
        Assert.Equal(2_270_000m, invoice.OutstandingAmount);
    }

    // UTC07 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 Finalized; outstanding 4,270,000
    // Đầu vào : amount=4500000; paymentCode=BH7K2Q9
    // Mong đợi: Return: Payment status Overpayment; Invoice status Paid; ExcessBalance of 230,000 recorded as refund-eligible available amount for the Tenant; Exception: N/A; Log Message: N/A
    // Căn cứ  : Payment lifecycle (Overpayment); ExcessBalance purpose/lifecycle §3.2
    [Fact(DisplayName = "BF06 UTC07 - Thanh toan thua 4.500.000: Overpayment, Paid, ExcessBalance 230.000")]
    public async Task UTC07_Overpayment()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2007", 4_500_000m, $"{PaymentCode} phong 204", "E7");
        var invoice = await InvoiceView();

        AssertStatus("Overpayment", transfer.Status);
        AssertStatus("Paid", invoice.PaymentStatus);
        Assert.Equal(230_000m, invoice.PotentialExcessAmount);
    }

    // UTC08 (Boundary) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 Finalized; outstanding 4,270,000
    // Đầu vào : amount=4269999; paymentCode=BH7K2Q9
    // Mong đợi: Return: Payment status Underpayment; Invoice status Partially Paid; outstanding 1; Exception: N/A; Log Message: N/A
    // Căn cứ  : Limit = Invoice outstanding balance (§3.2 Invoice); Payment lifecycle Underpayment
    [Fact(DisplayName = "BF06 UTC08 - Thanh toan thieu 1 dong (4.269.999): Underpayment, con no 1")]
    public async Task UTC08_UnderpaymentByOne()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2008", 4_269_999m, $"{PaymentCode} phong 204", "E8");
        var invoice = await InvoiceView();

        AssertStatus("Underpayment", transfer.Status);
        AssertStatus("Partially Paid", invoice.PaymentStatus);
        Assert.Equal(1m, invoice.OutstandingAmount);
    }

    // UTC09 (Boundary) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice INV-204 Finalized; outstanding 4,270,000
    // Đầu vào : amount=4270001; paymentCode=BH7K2Q9
    // Mong đợi: Return: Payment status Overpayment; Invoice status Paid; ExcessBalance 1; Exception: N/A; Log Message: N/A
    // Căn cứ  : Limit = Invoice outstanding balance (§3.2 Invoice); Payment lifecycle Overpayment; ExcessBalance
    [Fact(DisplayName = "BF06 UTC09 - Thanh toan thua 1 dong (4.270.001): Overpayment, ExcessBalance 1")]
    public async Task UTC09_OverpaymentByOne()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2009", 4_270_001m, $"{PaymentCode} phong 204", "E9");
        var invoice = await InvoiceView();

        AssertStatus("Overpayment", transfer.Status);
        AssertStatus("Paid", invoice.PaymentStatus);
        Assert.Equal(1m, invoice.PotentialExcessAmount);
    }

    // UTC10 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Valid bank transaction without any Payment Code
    // Đầu vào : amount=4270000; content="chuyen tien phong 204"
    // Mong đợi: Return: Payment status Manual Review; no Invoice updated; transaction presented to Owner for manual review with reason retained; Exception: N/A; Log Message: "Transaction could not be matched automatically. Owner review is required."
    // Căn cứ  : UC-22 A1; BF-06A end condition; MSG12
    // Ghi chú : Log Message (MSG12) không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF06 UTC10 - Giao dich khong co ma thanh toan: Manual Review, khong cap nhat hoa don")]
    public async Task UTC10_NoPaymentCodeGoesToManualReview()
    {
        Invoice204Outstanding4270000();

        var transfer = await Receive("TX2010", 4_270_000m, "chuyen tien phong 204", "E10");
        var invoice = await InvoiceView();

        AssertStatus("Manual Review", transfer.Status);
        Assert.Null(transfer.AllocatedInvoiceId);
        Assert.Empty(world.Payments.Allocations);
        Assert.Equal(4_270_000m, invoice.OutstandingAmount);
        Assert.False(string.IsNullOrWhiteSpace(transfer.Reason), "Lý do chuyển sang xem xét thủ công không được lưu");
    }

    // UTC11 (Abnormal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Payment P1 automatic reconciliation failed temporarily; JOB-03 retries it
    // Đầu vào : paymentId=P1 (reconciled twice)
    // Mong đợi: Return: exactly one PaymentAllocation and one balance update for P1; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-03 Failure/Idempotency; DBR-08; PaymentAllocation lifecycle; GBR-18
    // Ghi chú : P1 là giao dịch đã nhận; "đối soát lại" là gọi lại thao tác gắn P1 vào INV-204 với cùng khóa thao tác (retry).
    [Fact(DisplayName = "BF06 UTC11 - Doi soat lai P1 hai lan: dung 1 PaymentAllocation")]
    public async Task UTC11_ReconcileRetryIsIdempotent()
    {
        Invoice204Outstanding4270000();
        var p1 = await Receive("TX2011", 4_270_000m, PaymentCode, "E11");
        var retryKey = Guid.NewGuid();
        var service = world.PaymentService();
        var match = new PaymentMatchInput(Inv204, Tenant1, true);

        var first = await Capture(() => service.AllocateAsync(p1.Id, match, retryKey, default));
        var second = await Capture(() => service.AllocateAsync(p1.Id, match, retryKey, default));

        Assert.Null(first);
        Assert.Null(second);
        Assert.Single(world.Payments.Allocations, a => a.TransferId == p1.Id);
        Assert.Equal(4_270_000m, world.Payments.Allocations.Where(a => a.InvoiceId == Inv204).Sum(a => a.Amount));
    }

    // UTC12 (Normal) - sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Owner owner1 logged in; transaction in Manual Review; Invoice INV-204 outstanding 4,270,000
    // Đầu vào : ownerId=owner1; invoiceId=INV-204; amount=4270000; evidence=bank statement
    // Mong đợi: Return: transaction associated with INV-204 and recorded once as verified Payment; Invoice status Paid; manual reconciliation evidence, Owner actor and time retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-22 A1; BF-06A end condition; GBR-13; NFR 2.3 Audit
    [Fact(DisplayName = "BF06 UTC12 - Owner xac minh thu cong: gan INV-204 mot lan, hoa don Paid, luu Owner va thoi gian")]
    public async Task UTC12_OwnerVerifiesManually()
    {
        Invoice204Outstanding4270000();
        var pending = await Receive("TX2012", 4_270_000m, "chuyen tien phong 204", "E12");
        world.AsOwner();

        var result = await world.PaymentService().AllocateAsync(pending.Id, new PaymentMatchInput(Inv204, Tenant1, true), Guid.NewGuid(), default);
        var invoice = await InvoiceView();

        Assert.Equal(Inv204, result.InvoiceId);
        var allocation = Assert.Single(world.Payments.Allocations, a => a.TransferId == pending.Id);
        Assert.Equal(Inv204, allocation.InvoiceId);
        Assert.Equal(4_270_000m, allocation.Amount);
        Assert.Equal(Owner1, allocation.VerifiedByUserId);
        AssertStatus("Paid", invoice.PaymentStatus);
        Assert.Contains(world.Payments.Reconciliations, r => r.TransferId == pending.Id && r.InvoiceId == Inv204 && r.ActorId == Owner1 && r.OccurredAt != default);
    }
}
