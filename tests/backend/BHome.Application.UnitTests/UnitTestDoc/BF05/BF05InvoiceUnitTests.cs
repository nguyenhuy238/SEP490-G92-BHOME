using BHome.Application.Billing;
using BHome.Domain.Billing;

namespace BHome.Application.UnitTests.UnitTestDoc.BF05;

// Unit test sheet "BF-05 Meter Invoice" - nhóm calculateInvoice, generateInvoices, finalizeInvoices, updateInvoiceLine (+ UTC09).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ được xem qua danh mục chữ ký để biết hàm cần gọi:
//   InvoiceService.GenerateAsync (tạo Draft Invoice cho 1 phòng/kỳ), FinalizeAsync (chốt hóa đơn), RefreshAsync (tính lại).
// Phụ thuộc (kho hóa đơn, kho phòng/chính sách giá) là bản giả trong bộ nhớ; Owner đăng nhập; đồng hồ cố định.
// Ghi chú phạm vi:
//   - JOB-10 chạy hàng loạt cho cả cơ sở nằm ở BillingAutomationEngine (Infrastructure, CSDL). Ở unit test, "chạy JOB-10"
//     được mô phỏng bằng việc gọi InvoiceService cho từng phòng/hợp đồng.
//   - Log Message (MSG09, MSG10) do tầng API trả về; service chỉ trả mã lỗi/danh sách thiếu nên "Log Message không quan sát
//     được ở tầng unit" ở các case đó.
public sealed class BF05InvoiceUnitTests
{
    // UTC09 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: ELEC reading for Room 204 (contract M1) is OCR-proposed only, not confirmed by Staff; Draft Invoice generation date reached
    // Đầu vào : runDate=Draft Invoice generation date; period=2026-11
    // Mong đợi: Return: OCR-proposed value not used for billing; M1 Invoice kept in Draft with ELEC identified as missing billing input; Exception: N/A; Log Message: "Required billing information is incomplete."
    // Căn cứ  : GBR-07; FE-04 4.2.1 (OCR values cannot be used for billing until Staff confirms them); UC-21 step 6; MSG09
    // Ghi chú : chỉ số chỉ có giá trị OCR đề xuất = không có chỉ số đã xác nhận cho ELEC. Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC09 - Chi so ELEC moi la OCR de xuat: khong dung tinh tien, hoa don giu Draft, thieu ELEC")]
    public async Task UTC09_OcrProposedReadingIsNotBilled()
    {
        var billing = new Bf05Billing();
        var room = billing.Room("204");
        room.Readings[UtilityType.Electricity] = null; // chỉ có OCR đề xuất 1,382.0, Staff chưa xác nhận

        var invoice = await billing.Generate(room);

        Assert.Equal(nameof(InvoiceStatus.Draft), invoice.Status);
        Assert.True(Bf05Billing.MissingContains(invoice.MissingInputs, "elec"), "ELEC phải được ghi nhận là thiếu dữ liệu tính tiền.");
        Assert.DoesNotContain(invoice.Lines, l => l.ChargeCode == Bf05Data.Elec && l.Amount > 0);
    }

    // UTC15 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M1 Active for full month 2026-11; configured policies: rent 3,500,000; ELEC 3,500/kWh; WATER 18,000/m³; internet 100,000; cleaning 100,000; confirmed usage ELEC 132 kWh, WATER 6 m³
    // Đầu vào : period=2026-11
    // Mong đợi: Return: charge items rent 3,500,000, ELEC 462,000, WATER 108,000, internet 100,000, cleaning 100,000; total 4,270,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-21 steps 2-4; UC-06; GBR-08; FE-04 4.3.1 Charge Item / Total Amount
    [Fact(DisplayName = "BF05 UTC15 - Tinh hoa don day du thang 2026-11: tong 4,270,000")]
    public async Task UTC15_FullMonthCharges()
    {
        var billing = new Bf05Billing();

        var invoice = await billing.Generate(billing.Room("204"));

        Assert.Equal(3_500_000m, Bf05Billing.Line(invoice, Bf05Data.Rent).Amount);
        Assert.Equal(462_000m, Bf05Billing.Line(invoice, Bf05Data.Elec).Amount);
        Assert.Equal(108_000m, Bf05Billing.Line(invoice, Bf05Data.Water).Amount);
        Assert.Equal(100_000m, Bf05Billing.Line(invoice, Bf05Data.Internet).Amount);
        Assert.Equal(100_000m, Bf05Billing.Line(invoice, Bf05Data.Cleaning).Amount);
        Assert.Equal(4_270_000m, invoice.Total);
    }

    // UTC16 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: ELEC metered at 3,500/kWh; confirmed ELEC consumption 0 kWh
    // Đầu vào : period=2026-11
    // Mong đợi: Return: ELEC line amount=0; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-21 step 3; UC-06 metered charging method
    [Fact(DisplayName = "BF05 UTC16 - Tieu thu dien 0 kWh: dong ELEC = 0")]
    public async Task UTC16_ZeroElectricityUsage()
    {
        var billing = new Bf05Billing();

        var invoice = await billing.Generate(billing.Room("204", elecUsage: 0m));

        Assert.Equal(0m, Bf05Billing.Line(invoice, Bf05Data.Elec).Amount);
    }

    // UTC17 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant has remaining Tenant Credit 300,000; calculated invoice total 4,270,000
    // Đầu vào : period=2026-11
    // Mong đợi: Return: Tenant Credit 300,000 applied; amount payable 3,970,000; remaining credit 0; credit usage history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance entity (Tenant Credit applied to future Invoices; settlement history retained). Timing of credit application not stated (see open questions)
    // Ghi chú : danh mục chữ ký không có thực thể Tenant Credit/ExcessBalance, kho hóa đơn không cung cấp số dư credit,
    //           và InvoiceView không có "amount payable" hay "remaining credit".
    [Fact(DisplayName = "BF05 UTC17 - Ap dung Tenant Credit 300,000: con phai tra 3,970,000")]
    public void UTC17_TenantCreditPartlyApplied() =>
        Assert.Fail("Chưa tìm thấy chức năng áp dụng Tenant Credit khi tính hóa đơn (calculateInvoice) trong hệ thống (danh mục chữ ký).");

    // UTC18 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tenant has remaining Tenant Credit 5,000,000; calculated invoice total 4,270,000
    // Đầu vào : period=2026-11
    // Mong đợi: Return: amount payable 0; remaining credit 730,000 retained for future Invoices; Exception: N/A; Log Message: N/A
    // Căn cứ  : ExcessBalance entity (partial balances retained)
    [Fact(DisplayName = "BF05 UTC18 - Tenant Credit 5,000,000 lon hon tong: phai tra 0, con 730,000")]
    public void UTC18_TenantCreditExceedsTotal() =>
        Assert.Fail("Chưa tìm thấy chức năng áp dụng Tenant Credit khi tính hóa đơn (calculateInvoice) trong hệ thống (danh mục chữ ký).");

    // UTC19 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 configured Draft Invoice date=25, Finalization date=28 and Due Date; M1 Active; all billing inputs for 2026-11 confirmed
    // Đầu vào : runDate=2026-11-25
    // Mong đợi: Return: one Draft Invoice for M1, period 2026-11, with charge breakdown and total, available to Tenant for review; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-21 steps 1-7; JOB-10; BF-05B end condition
    [Fact(DisplayName = "BF05 UTC19 - Ngay 25: tao 1 Draft Invoice cho M1 ky 2026-11, Tenant xem duoc")]
    public async Task UTC19_DraftInvoiceGenerated()
    {
        var billing = new Bf05Billing();

        var invoice = await billing.Generate(billing.Room("204"));

        Assert.Equal(nameof(InvoiceStatus.Draft), invoice.Status);
        Assert.Equal(Bf05Data.Period, invoice.BillingPeriod);
        Assert.NotEmpty(invoice.Lines);
        Assert.Equal(invoice.Lines.Sum(l => l.Amount), invoice.Total);
        Assert.Equal(Bf05Data.TenantId, invoice.RepresentativeTenantUserId);
        var stored = Assert.Single(billing.Repository.Invoices);
        Assert.Contains(stored.Recipients, r => r.TenantUserId == Bf05Data.TenantId);
    }

    // UTC20 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice for M1 period 2026-11 already exists
    // Đầu vào : runDate=2026-11-25 (run again)
    // Mong đợi: Return: no second invoice (max 1 per contract per period); Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-10 Failure/Idempotency (retries must not duplicate charges or Invoices); GBR-18; DBR-06
    [Fact(DisplayName = "BF05 UTC20 - Chay lai ngay 25: khong tao hoa don thu hai")]
    public async Task UTC20_RunAgainDoesNotDuplicate()
    {
        var billing = new Bf05Billing();
        var room = billing.Room("204");
        var first = await billing.Generate(room);

        var second = await billing.Generate(room);

        Assert.Single(billing.Repository.Invoices);
        Assert.Equal(first.Id, second.Id);
    }

    // UTC21 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Draft Invoice date reached; M1, M2, M3 Active in L1; M2 WATER reading not confirmed
    // Đầu vào : runDate=2026-11-25
    // Mong đợi: Return: M2 Draft Invoice kept in Draft with WATER identified as missing billing input; M1 and M3 Draft Invoices still generated; Exception: N/A; Log Message: "Required billing information is incomplete."
    // Căn cứ  : UC-21 precondition 2 and step 6; GBR-09; JOB-10; MSG09
    // Ghi chú : Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC21 - M2 thieu chi so nuoc: M2 giu Draft thieu WATER, M1 va M3 van tao")]
    public async Task UTC21_MissingWaterDoesNotBlockOthers()
    {
        var billing = new Bf05Billing();
        var m1 = billing.Room("201");
        var m2 = billing.Room("202");
        var m3 = billing.Room("203");
        m2.Readings[UtilityType.Water] = null;

        var invoice1 = await billing.Generate(m1);
        var invoice2 = await billing.Generate(m2);
        var invoice3 = await billing.Generate(m3);

        Assert.Equal(nameof(InvoiceStatus.Draft), invoice2.Status);
        Assert.True(Bf05Billing.MissingContains(invoice2.MissingInputs, "water"), "WATER phải được ghi nhận là thiếu dữ liệu tính tiền.");
        Assert.Equal(nameof(InvoiceStatus.Draft), invoice1.Status);
        Assert.Equal(nameof(InvoiceStatus.Draft), invoice3.Status);
        Assert.Empty(invoice1.MissingInputs);
        Assert.Empty(invoice3.MissingInputs);
        Assert.Equal(3, billing.Repository.Invoices.Count);
    }

    // UTC22 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Finalization date=28; configured Due Date=2026-12-05; M1 Draft Invoice with all billing data confirmed
    // Đầu vào : runDate=2026-11-28
    // Mong đợi: Return: Invoice Finalized from confirmed billing data; Due Date 2026-12-05 assigned; bank-transfer payment request for the Invoice created; Tenant notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-21 steps 8-10; BF-05B end condition; JOB-10; PaymentRequest entity (INVOICE). Co-occupant notification is OQ-08
    // Ghi chú : "payment request được tạo" và "Tenant được thông báo" được kiểm tra qua các bản ghi service thêm vào kho
    //           (thực thể có tên PaymentRequest / thông báo hoặc sự kiện phát hành hóa đơn).
    [Fact(DisplayName = "BF05 UTC22 - Ngay 28: chot hoa don, han 2026-12-05, tao yeu cau chuyen khoan, bao Tenant")]
    public async Task UTC22_FinalizeOnFinalizationDate()
    {
        var billing = new Bf05Billing();
        var draft = await billing.Generate(billing.Room("204"));
        billing.Clock.Now = Bf05Data.At(2026, 11, 28);

        var final = await billing.Finalize(draft.Id, draft.Version);

        Assert.Equal(nameof(InvoiceStatus.Final), final.Status);
        Assert.Equal(4_270_000m, final.Total);
        Assert.Equal(new DateOnly(2026, 12, 5), final.DueDate);
        Assert.Contains(billing.Repository.Added, e => e.GetType().Name.Contains("PaymentRequest", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(billing.Repository.Added, e =>
            (e is InvoiceIssuedEvent issued && issued.InvoiceId == final.Id) ||
            (e is BHome.Domain.Notifications.UserNotification n && n.RecipientUserId == Bf05Data.TenantId));
    }

    // UTC23 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Draft invoice still has missing inputs
    // Đầu vào : runDate=2026-11-28
    // Mong đợi: Return: Invoice not finalized, stays Draft/Pending; missing billing information identified for follow-up; Exception: N/A; Log Message: "Required billing information is incomplete."
    // Căn cứ  : UC-21 A3; GBR-09; JOB-10; MSG09
    // Ghi chú : việc từ chối có thể trả về dưới dạng lỗi nghiệp vụ (API hiển thị MSG09); test chấp nhận cả hai cách và kiểm tra
    //           hóa đơn vẫn Draft, còn danh sách thiếu. Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC23 - Ngay 28 con thieu du lieu: khong chot, giu Draft, neu ro du lieu thieu")]
    public async Task UTC23_MissingInputsBlockFinalization()
    {
        var billing = new Bf05Billing();
        var room = billing.Room("204");
        room.Readings[UtilityType.Water] = null;
        var draft = await billing.Generate(room);
        billing.Clock.Now = Bf05Data.At(2026, 11, 28);

        var result = await billing.TryFinalize(draft.Id, draft.Version);

        Assert.True(result is null || result.Status == nameof(InvoiceStatus.Draft), "Hóa đơn còn thiếu dữ liệu không được chốt.");
        var stored = Assert.Single(billing.Repository.Invoices);
        Assert.Equal(InvoiceStatus.Draft, stored.Status);
        Assert.NotEmpty(stored.MissingInputs);
    }

    // UTC24 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 Invoice kept Draft on Finalization Date because WATER was missing; WATER reading now confirmed by Staff
    // Đầu vào : next finalization processing (JOB-10)
    // Mong đợi: Return: Invoice finalized with the confirmed WATER usage; configured Due Date assigned; Tenant notified; only one finalized Invoice for M2 period 2026-11; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-21 A3 (finalization occurs after required data is confirmed); JOB-10 Failure/Idempotency; DBR-06
    [Fact(DisplayName = "BF05 UTC24 - Bo sung chi so nuoc: lan chot tiep theo chot hoa don M2, chi 1 hoa don")]
    public async Task UTC24_FinalizedAfterMissingWaterConfirmed()
    {
        var billing = new Bf05Billing();
        var m2 = billing.Room("202");
        m2.Readings[UtilityType.Water] = null;
        var draft = await billing.Generate(m2);
        billing.Clock.Now = Bf05Data.At(2026, 11, 28);
        Assert.True((await billing.TryFinalize(draft.Id, draft.Version)) is null or { Status: nameof(InvoiceStatus.Draft) },
            "Ngày 28 còn thiếu WATER: hóa đơn phải giữ Draft (điều kiện của case).");

        m2.Readings[UtilityType.Water] = Bf05Data.Reading(100m, 106m); // Staff xác nhận WATER 6 m3
        billing.Clock.Now = Bf05Data.At(2026, 11, 29);
        var current = Assert.Single(billing.Repository.Invoices);
        var final = await billing.Finalize(current.Id, current.Version);

        Assert.Equal(nameof(InvoiceStatus.Final), final.Status);
        Assert.Equal(108_000m, Bf05Billing.Line(final, Bf05Data.Water).Amount);
        Assert.Equal(new DateOnly(2026, 12, 5), final.DueDate);
        Assert.Contains(billing.Repository.Added, e =>
            (e is InvoiceIssuedEvent issued && issued.InvoiceId == final.Id) ||
            (e is BHome.Domain.Notifications.UserNotification n && n.RecipientUserId == Bf05Data.TenantId));
        Assert.Single(billing.Repository.Invoices, i => i.Status == InvoiceStatus.Final);
    }

    // UTC25 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Invoice Finalized
    // Đầu vào : any direct line change
    // Mong đợi: Return: change rejected; finalized Invoice unchanged; Exception: N/A; Log Message: "This Invoice has been finalized. Use an adjustment request for corrections."
    // Căn cứ  : DBR-07; GBR-09; FE-04 4.3.1; MSG10
    // Ghi chú : danh mục chữ ký không có hàm sửa dòng hóa đơn trực tiếp; thao tác thay đổi dòng duy nhất là RefreshAsync
    //           (tính lại các dòng). Test gọi RefreshAsync trên hóa đơn đã chốt. Log Message không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF05 UTC25 - Sua dong hoa don da chot: bi tu choi, hoa don khong doi")]
    public async Task UTC25_FinalizedInvoiceCannotBeChanged()
    {
        var billing = new Bf05Billing();
        var room = billing.Room("204");
        var draft = await billing.Generate(room);
        billing.Clock.Now = Bf05Data.At(2026, 11, 28);
        var final = await billing.Finalize(draft.Id, draft.Version);
        room.Readings[UtilityType.Electricity] = Bf05Data.Reading(1_250m, 1_300m); // dữ liệu dòng ELEC thay đổi
        var stored = Assert.Single(billing.Repository.Invoices);
        var linesBefore = stored.Lines.Select(l => (l.ChargeCode, l.Amount)).ToArray();

        await Assert.ThrowsAsync<InvoiceException>(() => billing.Service().RefreshAsync(final.Id, final.Version, default));

        Assert.Equal(InvoiceStatus.Final, stored.Status);
        Assert.Equal(4_270_000m, stored.Total);
        Assert.Equal(linesBefore, stored.Lines.Select(l => (l.ChargeCode, l.Amount)).ToArray());
    }
}
