using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace BHome.Application.UnitTests.UnitTestDoc.BF03;

// Unit test cho sheet "BF-03 Onboarding Contract" - chức năng proposeResidentFromOcr, confirmResident.
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: GBR-07, UC-13, NFR IV.2.x, MSG05, MSG06).
// Code chỉ dùng để biết cách gọi hàm: OcrWorkflowService.IdentityAsync(residentId, IdentityFront, image),
// CaptureService.ConfirmIdentityAsync(residentId, IdentityConfirmation). Phụ thuộc ngoài giả lập bằng NSubstitute.
public sealed class Bf03ResidentOcrUnitTests
{
    private static readonly Guid StaffId = Guid.Parse("00000000-0000-0000-0000-000000000102");
    private static readonly Guid LocationL1 = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid ResidentR1 = Guid.Parse("00000000-0000-0000-0000-0000000000e1");

    private readonly ICurrentUser user = Substitute.For<ICurrentUser>();
    private readonly IStaffLocationAccess staffLocations = Substitute.For<IStaffLocationAccess>();
    private readonly IOcrWorkflowResources resources = Substitute.For<IOcrWorkflowResources>();
    private readonly IOcrService ocr = Substitute.For<IOcrService>();

    public Bf03ResidentOcrUnitTests()
    {
        // Điều kiện chung: Staff đăng nhập và được giao Location L1.
        user.UserId.Returns(StaffId);
        user.IsInRole(Arg.Any<string>()).Returns(c => c.Arg<string>() == Roles.Staff);
        staffLocations.IsAssignedAsync(StaffId, LocationL1, Arg.Any<CancellationToken>()).Returns(true);
        resources.FindIdentityAsync(ResidentR1, Arg.Any<CancellationToken>())
            .Returns(new OcrWorkflowResource(new ResourceScope(LocationL1, null), true, OcrDocumentKind.IdentityFront));
    }

    private OcrWorkflowService Workflow() => new(resources, new ResourceAccess(user, staffLocations), ocr);

    private static MemoryStream CccdFrontImage() => new([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);

    private static readonly Dictionary<string, string> ReadableCccd = new()
    {
        ["citizenIdentityNumber"] = "079204001234",
        ["fullName"] = "NGUYEN VAN A",
        ["dateOfBirth"] = "2004-01-01"
    };

    // UTC01 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff logged in and assigned to Location L1; CCCD image readable by OCR
    // Đầu vào : image=CCCD front image
    // Mong đợi: Return: OCR proposal with identity fields pre-filled for Staff review, clearly shown as a proposal (distinguishable from confirmed values); no identity data becomes authoritative yet; Exception: N/A; Log Message: "OCR result is ready. Please confirm or correct it before saving."
    // Căn cứ  : GBR-07; NFR IV.2.1 Clear confirmation; MSG05; UC-13
    // Ghi chú : Log Message MSG05 không quan sát được ở tầng unit (kết quả trả về là OcrProposal, không có câu thông báo).
    [Fact(DisplayName = "BF03 UTC01 - OCR CCCD doc duoc: tra ve de xuat, chua luu thanh du lieu chinh thuc")]
    public async Task UTC01_OcrReturnsProposalOnly()
    {
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.IdentityFront, Arg.Any<CancellationToken>())
            .Returns(new OcrProposal(ReadableCccd, "ocr-test"));

        var proposal = await Workflow().IdentityAsync(ResidentR1, OcrDocumentKind.IdentityFront, CccdFrontImage(), default);

        Assert.NotNull(proposal);
        Assert.IsType<OcrProposal>(proposal);
        Assert.Equal("079204001234", proposal.ProposedFields["citizenIdentityNumber"]);
        Assert.Equal("NGUYEN VAN A", proposal.ProposedFields["fullName"]);
        // Không có dữ liệu định danh nào được ghi nhận chính thức ở bước đề xuất.
        await resources.DidNotReceiveWithAnyArgs().RecordMeterProposalAsync(default, default!, default);
    }

    // UTC02 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff logged in; internal OCR is unavailable and cannot produce a proposal
    // Đầu vào : image=CCCD front image
    // Mong đợi: Return: manual-fallback state within 10 s, identity fields left empty for manual entry; Exception: N/A; Log Message: "OCR assistance is unavailable. Please continue with manual entry."
    // Căn cứ  : NFR IV.2.2 Internal OCR Processing (proposal or manual-fallback within 10 s); NFR IV.2.1 Manual fallback; NFR IV.2.4 Integration Failure; MSG06
    // Ghi chú : Log Message MSG06 không quan sát được ở tầng unit. OCR "không khả dụng" được giả lập bằng việc dịch vụ OCR ném lỗi.
    [Fact(DisplayName = "BF03 UTC02 - OCR khong kha dung: chuyen sang nhap tay trong 10s, khong nem loi")]
    public async Task UTC02_OcrUnavailableFallsBackToManualEntry()
    {
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.IdentityFront, Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("OCR engine unavailable"));

        var started = DateTimeOffset.UtcNow;
        var call = Workflow().IdentityAsync(ResidentR1, OcrDocumentKind.IdentityFront, CccdFrontImage(), default);
        var finished = await Task.WhenAny(call, Task.Delay(TimeSpan.FromSeconds(10)));

        Assert.Same(call, finished);
        Assert.True(DateTimeOffset.UtcNow - started <= TimeSpan.FromSeconds(10));
        var proposal = await call; // Exception: N/A
        Assert.NotNull(proposal);
        Assert.All(proposal.ProposedFields.Values, value => Assert.True(string.IsNullOrEmpty(value)));
    }

    // UTC03 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff logged in; CCCD image readable by OCR
    // Đầu vào : image=front.jpg
    // Mong đợi: Return: proposal; CCCD image not stored in file storage or logs; Exception: N/A; Log Message: N/A
    // Căn cứ  : NFR IV.2.3 Sensitive Identity Data (temporary CCCD OCR images not retained after processing); NFR IV.2.5 Privacy
    // Ghi chú : ở tầng unit kiểm tra được: có đề xuất, và ảnh không được chuyển cho bất kỳ thành phần lưu trữ nào ngoài OCR
    //           (OcrWorkflowService không nhận kho lưu file; IOcrWorkflowResources không nhận ảnh). Việc ghi log ở tầng hạ tầng không quan sát được.
    [Fact(DisplayName = "BF03 UTC03 - Anh CCCD chi dung cho OCR, khong duoc luu lai")]
    public async Task UTC03_CccdImageIsNotRetained()
    {
        ocr.ExtractAsync(Arg.Any<Stream>(), OcrDocumentKind.IdentityFront, Arg.Any<CancellationToken>())
            .Returns(new OcrProposal(ReadableCccd, "ocr-test"));

        var proposal = await Workflow().IdentityAsync(ResidentR1, OcrDocumentKind.IdentityFront, CccdFrontImage(), default);

        Assert.NotNull(proposal);
        var resourceCalls = resources.ReceivedCalls().SelectMany(c => c.GetArguments());
        Assert.DoesNotContain(resourceCalls, argument => argument is Stream);
    }

    // UTC04 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: OCR proposal exists; Staff corrected Full Name on the proposal
    // Đầu vào : actor=assigned Staff; action=confirm; fullName=corrected value; idNumber="079204001234"
    // Mong đợi: Return: Resident record saved with the Staff-confirmed identity fields (corrected Full Name) and verification status = verified; confirming Staff and time stored as verification metadata; CCCD image not stored; identity information access-controlled and masked where appropriate; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-07; NFR IV.2.5 (only Staff-confirmed identity fields and verification metadata stored); NFR IV.2.3 Sensitive Identity Data; Resident entity (verification status); UC-13
    // Ghi chú : kho lưu (ICaptureRepository) là giả lập, nên "lưu metadata, che (mask) dữ liệu" thuộc tầng hạ tầng - không quan sát được ở tầng unit.
    //           Ở đây kiểm tra: dữ liệu Staff xác nhận (họ tên đã sửa, số CCCD) được chuyển đi lưu đúng, kết quả trạng thái Verified kèm thời điểm xác nhận.
    [Fact(DisplayName = "BF03 UTC04 - Staff xac nhan danh tinh da sua: luu dung truong da xac nhan, trang thai Verified")]
    public async Task UTC04_StaffConfirmsCorrectedIdentity()
    {
        var capture = Substitute.For<ICaptureRepository>();
        var confirmedAt = new DateTimeOffset(2026, 11, 10, 2, 0, 0, TimeSpan.Zero);
        capture.ConfirmIdentityAsync(ResidentR1, Arg.Any<IdentityConfirmation>(), Arg.Any<CancellationToken>())
            .Returns(new IdentityConfirmationResult(ResidentR1, IdentityVerificationStatus.Verified, confirmedAt));
        var access = new ResourceAccess(user, staffLocations);
        var properties = new PropertyService(Substitute.For<IPropertyRepository>(), user, new PermissionAccess(user, access), TimeProvider.System);
        var service = new CaptureService(capture, user, properties);
        var corrected = new IdentityConfirmation(true, "079204001234", "NGUYEN VAN AN", new DateOnly(2004, 1, 1),
            "12 Duong A, Quan 1, TP HCM", "Nam", "Viet Nam", "TP HCM", new DateOnly(2021, 1, 1), new DateOnly(2046, 1, 1));

        var result = await service.ConfirmIdentityAsync(ResidentR1, corrected, default);

        await capture.Received(1).ConfirmIdentityAsync(ResidentR1,
            Arg.Is<IdentityConfirmation>(x => x.HumanConfirmed && x.FullName == "NGUYEN VAN AN" && x.CitizenIdentityNumber == "079204001234"),
            Arg.Any<CancellationToken>());
        Assert.Equal(IdentityVerificationStatus.Verified, result.VerificationStatus);
        Assert.NotNull(result.ConfirmedAt);
    }
}
