using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace BHome.Application.UnitTests.UnitTestDoc.BF05;

// Unit test sheet "BF-05 Meter Invoice" - nhóm generateMeterReadingTasks, confirmMeterReading, replaceMeter (UTC01-UTC14).
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3). Code chỉ được xem qua danh mục chữ ký để biết hàm cần gọi.
// Ghi chú phạm vi (theo danh mục chữ ký):
//   - generateMeterReadingTasks (JOB-09) và việc lưu/xác nhận chỉ số (confirmMeterReading) được thực hiện trong
//     BillingAutomationEngine / CaptureRepository của tầng Infrastructure, phụ thuộc trực tiếp CSDL (BHomePersistenceContext).
//     Tầng Application chỉ chuyển tiếp xuống interface, nên các case đó không kiểm tra được ở unit test -> đánh Skip kèm lý do
//     (cần integration test có CSDL). Không đánh Pass/Fail giả.
//   - replaceMeter: không có hàm/thực thể Meter Replacement nào trong danh mục chữ ký -> Assert.Fail (chưa có chức năng).
public sealed class BF05MeterReadingUnitTests
{
    private const string NeedsDatabase =
        "Không kiểm tra được ở tầng unit: logic nằm trong tầng Infrastructure phụ thuộc CSDL (BillingAutomationEngine/CaptureRepository). Cần integration test.";

    // UTC01 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 reading day=24; 10 occupied rooms × 2 meters
    // Đầu vào : runDate=2026-11-24
    // Mong đợi: Return: 20 meter-reading tasks for period 2026-11; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-09 Trigger and Required Processing (eligible occupied Rooms, active meters, electricity/water tasks per billing period)
    [Fact(DisplayName = "BF05 UTC01 - Ngay ghi so 24: tao 20 task ghi chi so cho 10 phong x 2 dong ho", Skip = NeedsDatabase)]
    public void UTC01_GenerateTwentyTasks() { }

    // UTC02 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Tasks for period 2026-11 already created
    // Đầu vào : runDate=2026-11-24 (run again)
    // Mong đợi: Return: 0 new tasks (one per room, meter, period); Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-09 Failure/Idempotency (one task per Room, meter type, billing period); GBR-18
    [Fact(DisplayName = "BF05 UTC02 - Chay lai JOB-09 cung ky: khong tao task moi", Skip = NeedsDatabase)]
    public void UTC02_RunAgainCreatesNothing() { }

    // UTC03 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Room 205 AVAILABLE, no contract
    // Đầu vào : runDate=2026-11-24
    // Mong đợi: Return: no task for Room 205; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-09 Required Processing (only eligible occupied Rooms)
    [Fact(DisplayName = "BF05 UTC03 - Phong 205 trong, khong hop dong: khong tao task", Skip = NeedsDatabase)]
    public void UTC03_AvailableRoomHasNoTask() { }

    // UTC04 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: L1 meter-reading date=24; Room 206 Occupied with no active WATER meter configured
    // Đầu vào : runDate=2026-11-24
    // Mong đợi: Return: no WATER task for Room 206; missing meter configuration reported for Owner review; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-09 Failure/Idempotency (missing meter configuration reported for Owner review)
    [Fact(DisplayName = "BF05 UTC04 - Phong 206 thieu dong ho nuoc: khong tao task WATER, bao Owner", Skip = NeedsDatabase)]
    public void UTC04_MissingWaterMeterReported() { }

    // UTC05 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Previous reading 1,250.0 kWh; OCR proposed 1,382.0
    // Đầu vào : confirmedValue=1382.0
    // Mong đợi: Return: status=CONFIRMED; consumption=132.0; task Completed; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-20 steps 5-10; MeterReading lifecycle Proposed -> Confirmed; FE-04 4.2.1
    [Fact(DisplayName = "BF05 UTC05 - Xac nhan dung gia tri OCR: CONFIRMED, tieu thu 132", Skip = NeedsDatabase)]
    public void UTC05_ConfirmOcrValue() { }

    // UTC06 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Previous 1,250.0; OCR misread as 1,832.0
    // Đầu vào : confirmedValue=1382.0
    // Mong đợi: Return: status=CORRECTED; OCR value 1,832.0 kept for audit; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-20 A2; MeterReading lifecycle Corrected; MeterReading attributes (OCR-proposed value and confirmed value both retained)
    [Fact(DisplayName = "BF05 UTC06 - OCR doc sai, Staff sua: CORRECTED, giu gia tri OCR", Skip = NeedsDatabase)]
    public void UTC06_CorrectOcrValue() { }

    // UTC07 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff opened assigned ELEC task for Room 204; image-reading assistance unavailable
    // Đầu vào : meter image captured; entryMethod=Manual; confirmedValue=1382.0
    // Mong đợi: Return: manual-fallback shown; Staff-confirmed reading stored with meter image and confirmation metadata (Staff, time), entry method Manual; task Completed; Exception: N/A; Log Message: "OCR assistance is unavailable. Please continue with manual entry."
    // Căn cứ  : UC-20 A1; NFR IV.2.1 Manual fallback; NFR IV.2.2 Internal OCR Processing; FE-04 4.2.1 Entry Method; MSG06
    // Ghi chú : phần "lưu chỉ số + task Completed" nằm ở CaptureRepository (CSDL) nên không kiểm tra được ở đây;
    //           test kiểm tra phần quan sát được: fallback nhập tay + thông báo MSG06, và việc xác nhận có ghi nhận Entry Method.
    [Fact(DisplayName = "BF05 UTC07 - OCR khong kha dung: hien nhap tay, thong bao MSG06, ghi Entry Method Manual")]
    public async Task UTC07_OcrUnavailableFallsBackToManualEntry()
    {
        var taskId = Guid.NewGuid();
        var staff = Bf05Users.As(Bf05Data.StaffId, Roles.Staff);
        var assigned = Substitute.For<IStaffLocationAccess>();
        assigned.IsAssignedAsync(Bf05Data.StaffId, Bf05Data.LocationId, Arg.Any<CancellationToken>()).Returns(true);
        var resources = Substitute.For<IOcrWorkflowResources>();
        resources.FindMeterTaskAsync(taskId, Arg.Any<CancellationToken>())
            .Returns(new OcrWorkflowResource(new ResourceScope(Bf05Data.LocationId, null), true, OcrDocumentKind.MechanicalElectricity, 1, 1_250m));
        // "image-reading assistance unavailable": bộ OCR không đọc được gì và trả về đề xuất dạng dự phòng (fallback).
        var ocr = Substitute.For<IOcrService>();
        var unavailable = new OcrProposal(new Dictionary<string, string>(), "unavailable") { IsFallback = true };
        ocr.ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrDocumentKind>(), Arg.Any<CancellationToken>()).Returns(unavailable);
        ocr.ExtractAsync(Arg.Any<Stream>(), Arg.Any<OcrInputKind>(), Arg.Any<CancellationToken>()).Returns(unavailable);
        var service = new OcrWorkflowService(resources, new ResourceAccess(staff, assigned), ocr);

        using var image = new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
        var proposal = await service.MeterAsync(taskId, image, default);

        Assert.True(proposal.ManualEntryAvailable, "Phải hiển thị nhập tay khi OCR không khả dụng.");
        Assert.Contains("OCR assistance is unavailable. Please continue with manual entry.", proposal.Warnings);
        // FE-04 4.2.1 Entry Method: dữ liệu xác nhận chỉ số phải mang được phương thức nhập (Manual).
        Assert.True(typeof(MeterConfirmation).GetProperty("EntryMethod") is not null,
            "MeterConfirmation không có trường Entry Method nên không lưu được 'entry method Manual' (FE-04 4.2.1).");
    }

    // UTC08 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Previous confirmed reading 1,250.0
    // Đầu vào : confirmedValue=1250.0
    // Mong đợi: Return: reading Confirmed; consumption=0; task Completed; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-20 steps 7-9. SRS states no lower-limit rule, so this is not a Boundary case (see open questions)
    [Fact(DisplayName = "BF05 UTC08 - Chi so bang ky truoc: Confirmed, tieu thu 0", Skip = NeedsDatabase)]
    public void UTC08_ZeroConsumption() { }

    // UTC09: xem BF05InvoiceUnitTests (kiểm tra qua bước tạo hóa đơn Draft).

    // UTC10 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Room 204 active ELEC meter identity = E-204
    // Đầu vào : room=204; meter identity on captured reading=E-999; confirmedValue=1382.0
    // Mong đợi: Return: reading not stored; Staff must correct the meter/reading before confirming; task not Completed; Exception: N/A; Log Message: N/A
    // Căn cứ  : Meter entity (authoritative meter identity used to validate Meter Readings); UC-20 step 8
    // Ghi chú : MeterConfirmation(HumanConfirmed, ConfirmedValue, EvidenceId) không nhận định danh đồng hồ trên ảnh,
    //           nên không có cách đưa "E-999" vào để hệ thống đối chiếu.
    [Fact(DisplayName = "BF05 UTC10 - Dinh danh dong ho tren anh khac E-204: khong luu chi so")]
    public void UTC10_MeterIdentityMismatchRejected() =>
        Assert.Fail("Chưa tìm thấy chức năng đối chiếu định danh đồng hồ khi xác nhận chỉ số (confirmMeterReading) trong hệ thống (danh mục chữ ký).");

    // UTC11 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Old meter closing reading 1,382.0
    // Đầu vào : Staff request; newBaseline=0.0
    // Mong đợi: Return: request status=Pending Approval; old meter still Active; Exception: N/A; Log Message: N/A
    // Căn cứ  : Meter Replacement entity (Pending Approval; requested Staff; old closing reading; new baseline); DBR-05
    [Fact(DisplayName = "BF05 UTC11 - Staff yeu cau thay dong ho: Pending Approval")]
    public void UTC11_StaffRequestsReplacement() =>
        Assert.Fail("Chưa tìm thấy chức năng replaceMeter trong hệ thống (danh mục chữ ký).");

    // UTC12 (Normal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Replacement request Pending Approval; old ELEC meter closing reading 1,382.0; new meter baseline 0.0
    // Đầu vào : Owner decision=approve; decisionReason given
    // Mong đợi: Return: replacement Approved with Owner decision, reason and time; old meter Removed with removal time retained; new meter Active with baseline 0.0; old closing reading retained for billing continuity; only one active ELEC meter for Room 204; Exception: N/A; Log Message: N/A
    // Căn cứ  : Meter Replacement entity; Meter entity lifecycle (installation/removal history); DBR-05. Usage formula across a replacement not stated (see open questions)
    [Fact(DisplayName = "BF05 UTC12 - Owner duyet thay dong ho: dong ho moi Active, dong ho cu Removed")]
    public void UTC12_OwnerApprovesReplacement() =>
        Assert.Fail("Chưa tìm thấy chức năng replaceMeter trong hệ thống (danh mục chữ ký).");

    // UTC13 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Replacement request Pending Approval
    // Đầu vào : Owner decision=reject; reason given
    // Mong đợi: Return: status=Rejected; baseline unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : Meter Replacement entity (Rejected; Owner decision reason)
    [Fact(DisplayName = "BF05 UTC13 - Owner tu choi thay dong ho: Rejected")]
    public void UTC13_OwnerRejectsReplacement() =>
        Assert.Fail("Chưa tìm thấy chức năng replaceMeter trong hệ thống (danh mục chữ ký).");

    // UTC14 (Abnormal) - sheet "BF-05 Meter Invoice", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Replacement request Pending Approval, requested by Staff S1
    // Đầu vào : actor=Staff S1; decision=approve
    // Mong đợi: Return: decision not recorded; request stays Pending Approval; Exception: N/A; Log Message: "You do not have permission to perform this action."
    // Căn cứ  : Meter Replacement entity (Owner decision); GBR-03; MSG03
    [Fact(DisplayName = "BF05 UTC14 - Staff tu duyet thay dong ho: khong ghi nhan, MSG03")]
    public void UTC14_StaffCannotApproveReplacement() =>
        Assert.Fail("Chưa tìm thấy chức năng replaceMeter trong hệ thống (danh mục chữ ký).");
}
