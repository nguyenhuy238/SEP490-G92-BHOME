using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF04;

// Unit test cho sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx (15 test case).
// Kết quả mong đợi (Return / Exception / Log Message) chép nguyên từ sheet; căn cứ SRS v1.3 ghi ở từng test.
// Code chỉ được xem ở mức chữ ký (tên lớp, hàm, tham số) để biết cách gọi; không đọc phần xử lý.
// Quy ước khi sheet ghi "Return: không thực hiện ...; Exception: N/A": dịch vụ báo từ chối nghiệp vụ bằng
// ContractException (mã lỗi nghiệp vụ). Test chấp nhận từ chối nghiệp vụ đó và kiểm tra trạng thái không đổi;
// mọi loại exception khác vẫn làm test fail.
public sealed class BF04RenewalMoveOutUnitTests
{
    private static readonly DateOnly M1End = new(2026, 11, 30);

    private static async Task<ContractException?> Rejected(Func<Task> action)
    {
        try { await action(); return null; }
        catch (ContractException e) { return e; }
    }

    // ---------------------------------------------------------------- notifyContractExpiry

    // UTC01 (Boundary) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; end date 2026-12-06; staff1 responsible for the Location of M1
    // Đầu vào : runDate=2026-11-06 (JOB-02 daily run; 30 days before expiry)
    // Mong đợi: Return: upcoming-expiry notification sent to Owner, staff1 and Tenant of M1; M1 status unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-02; UC-19 Normal Flow 1-2; BF-04 Trigger (expire within 30 days)
    // Ghi chú : theo danh mục chữ ký, JOB-02 chỉ có ở ContractExpiryProcessor (Infrastructure, internal) và chạy trực tiếp trên
    //           CSDL PostgreSQL (BHomePersistenceContext); tầng Application không có hàm sinh thông báo hết hạn để gọi ở mức unit.
    [Fact(DisplayName = "BF04 UTC01 - JOB-02 con 30 ngay het han: gui thong bao Owner, staff1, Tenant",
        Skip = "JOB-02 chi co trong ContractExpiryProcessor (Infrastructure) gan voi CSDL PostgreSQL that; can integration test")]
    public void UTC01_ExpiryNoticeThirtyDaysBefore() { }

    // UTC02 (Boundary) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; end date 2026-12-07
    // Đầu vào : runDate=2026-11-06 (JOB-02 daily run; 31 days before expiry)
    // Mong đợi: Return: no expiry notification for M1; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-02 (only Contracts expiring within 30 days); UC-19 Precondition 3
    // Ghi chú : như UTC01 - chỉ kiểm thử được bằng integration test với CSDL.
    [Fact(DisplayName = "BF04 UTC02 - JOB-02 con 31 ngay het han: khong gui thong bao",
        Skip = "JOB-02 chi co trong ContractExpiryProcessor (Infrastructure) gan voi CSDL PostgreSQL that; can integration test")]
    public void UTC02_NoExpiryNoticeThirtyOneDaysBefore() { }

    // ---------------------------------------------------------------- renewContract

    // UTC03 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; ends 2026-11-30; Renewal/Addendum for M1 prepared with end date 2027-11-30 and rent 3,700,000, reviewed by Owner and electronically signed by Owner and Tenant
    // Đầu vào : contractId=M1; newEndDate=2027-11-30; rent=3700000
    // Mong đợi: Return: Renewal/Addendum activated and linked to M1; M1 expiry date=2027-11-30 and rent terms updated; previous Contract version, signing evidence and change history retained; tenancy remains Active; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-16 Normal Flow 1-8; UC-16 Postcondition 1-2; UC-19 Normal Flow 4-5
    // Ghi chú : điều kiện "đã ký điện tử bởi Owner và Tenant" cần bằng chứng ký hợp lệ (file đã ký trong MinIO + mã băm của nhà cung cấp ký).
    //           Ở mức unit không dựng được bằng chứng đó: hệ thống từ chối với mã signing_evidence_integrity_failed.
    //           Bỏ qua ở unit test, cần kiểm thử bằng integration test với dịch vụ ký và MinIO.
    [Fact(DisplayName = "BF04 UTC03 - Gia han da ky du Owner va Tenant: kich hoat, han moi 2027-11-30, gia 3.700.000",
        Skip = "Khong dung duoc bang chung ky dien tu hop le o muc unit (signing_evidence_integrity_failed); can integration test")]
    public async Task UTC03_SignedRenewalIsActivated()
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Active, new DateOnly(2025, 12, 1), M1End);

        var renewalId = (await ctx.Service.RenewAsync(m1.Id, new RenewalInput(new DateOnly(2027, 11, 30), 3_700_000m, "Renewal terms 2027"), Guid.NewGuid(), default)).Id;
        Assert.NotEqual(m1.Id, renewalId);
        // Điều kiện: Owner đã duyệt, Owner và Tenant đã ký điện tử bản gia hạn.
        var renewal = ctx.Store.Contracts[renewalId];
        renewal.Status = ContractStatus.PendingActivation;
        renewal.Signatures.Add(BF04Contracts.Signature(renewal, BF04Contracts.OwnerId, SignatureStatus.Signed));
        renewal.Signatures.Add(BF04Contracts.Signature(renewal, BF04Contracts.TenantId, SignatureStatus.Signed));

        // Kích hoạt khi bản gia hạn bắt đầu có hiệu lực (ngày sau khi M1 hết hạn).
        ctx.Clock.Now = new DateTimeOffset(2026, 12, 1, 2, 0, 0, TimeSpan.Zero);
        var activated = await ctx.Service.ActivateAsync(renewalId, Guid.NewGuid(), default);

        Assert.Equal(nameof(ContractStatus.Active), activated.Status);
        Assert.Equal(m1.Id, activated.PreviousContractId);
        Assert.Equal(new DateOnly(2027, 11, 30), activated.EndDate);
        Assert.Equal(3_700_000m, activated.MonthlyRent);
        Assert.Equal(2, activated.Signatures.Count(s => s.Status == nameof(SignatureStatus.Signed)));
        var versions = await ctx.Service.VersionsAsync(renewalId, default);
        Assert.Contains(versions, v => v.Id == m1.Id && v.EndDate == M1End);
        Assert.Contains(versions, v => v.Id == renewalId && v.EndDate == new DateOnly(2027, 11, 30) && v.MonthlyRent == 3_700_000m);
    }

    // UTC04 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; ends 2026-11-30; Renewal/Addendum for M1 sent for signing; only Owner has signed
    // Đầu vào : contractId=M1; action=activate renewal
    // Mong đợi: Return: Renewal/Addendum remains Pending Signing and is not activated; M1 expiry date and terms unchanged; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-16 A2; UC-16 Postcondition 1
    [Fact(DisplayName = "BF04 UTC04 - Gia han moi Owner ky: khong kich hoat, M1 giu nguyen")]
    public async Task UTC04_RenewalSignedOnlyByOwnerIsNotActivated()
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Active, new DateOnly(2025, 12, 1), M1End);
        var renewalId = (await ctx.Service.RenewAsync(m1.Id, new RenewalInput(new DateOnly(2027, 11, 30), 3_700_000m, "Renewal terms 2027"), Guid.NewGuid(), default)).Id;
        var renewal = ctx.Store.Contracts[renewalId];
        renewal.Status = ContractStatus.PendingSigning;
        renewal.Signatures.Add(BF04Contracts.Signature(renewal, BF04Contracts.OwnerId, SignatureStatus.Signed));
        renewal.Signatures.Add(BF04Contracts.Signature(renewal, BF04Contracts.TenantId, SignatureStatus.Pending));

        await Rejected(() => ctx.Service.ActivateAsync(renewalId, Guid.NewGuid(), default));

        Assert.Equal(ContractStatus.PendingSigning, ctx.Store.Contracts[renewalId].Status);
        Assert.Equal(ContractStatus.Active, m1.Status);
        Assert.Equal(M1End, m1.EndDate);
        Assert.Equal(3_500_000m, m1.MonthlyRent);
    }

    // UTC05 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Contract M1 Terminated
    // Đầu vào : contractId=M1; action=initiate renewal
    // Mong đợi: Return: renewal not initiated; M1 remains Terminated; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-16 Precondition (active Main Tenancy Contract exists); UC-19 Precondition 1
    [Fact(DisplayName = "BF04 UTC05 - Hop dong da Terminated: khong khoi tao gia han")]
    public async Task UTC05_TerminatedContractCannotBeRenewed()
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Terminated, new DateOnly(2025, 12, 1), M1End);

        await Rejected(() => ctx.Service.RenewAsync(m1.Id, new RenewalInput(new DateOnly(2027, 11, 30), 3_700_000m, "Renewal terms 2027"), Guid.NewGuid(), default));

        Assert.DoesNotContain(ctx.Store.Contracts.Values, c => c.PreviousContractId == m1.Id);
        Assert.Equal(ContractStatus.Terminated, m1.Status);
    }

    // ---------------------------------------------------------------- handleContractNonRenewal

    // UTC06 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; ends 2026-11-30; expiry notification already sent
    // Đầu vào : contractId=M1; renewalConfirmed=false; plannedMoveOutDate=2026-11-30
    // Mong đợi: Return: Contract expiry and planned move-out date recorded; move-out inspection scheduled; Tenant notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-19 Normal Flow 3, 6-7
    // Ghi chú : "Tenant notified" không quan sát được ở tầng unit (ContractService không có phụ thuộc gửi thông báo).
    //           Chức năng được thực hiện bằng chuỗi hàm công khai: ghi nhận hết hạn/không gia hạn -> Owner xác nhận -> lên lịch kiểm tra.
    [Fact(DisplayName = "BF04 UTC06 - Khong gia han: ghi nhan het han, ngay chuyen di 2026-11-30, len lich kiem tra")]
    public async Task UTC06_NonRenewalRecordsMoveOutAndSchedulesInspection()
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Active, new DateOnly(2025, 12, 1), M1End);

        await ctx.Service.RequestTerminationAsync(m1.Id, new TerminationInput(M1End, "Tenant does not renew"), Guid.NewGuid(), true, default);
        if (ctx.Store.MoveOuts[m1.Id].Status == MoveOutStatus.Requested)
            await ctx.Service.ApproveTerminationAsync(m1.Id, Guid.NewGuid(), default);
        var view = await ctx.Service.ScheduleInspectionAsync(m1.Id,
            new InspectionScheduleInput(new DateTimeOffset(2026, 11, 30, 2, 0, 0, TimeSpan.Zero), BF04Contracts.StaffId), Guid.NewGuid(), default);

        var moveOut = ctx.Store.MoveOuts[m1.Id];
        Assert.True(moveOut.IsExpiry);
        Assert.Equal(M1End, view.ProposedDate);
        Assert.NotNull(view.InspectionScheduledAt);
    }

    // ---------------------------------------------------------------- requestContractTermination

    // UTC07 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; Tenant has submitted an early-termination request with proposed date 2026-12-15
    // Đầu vào : contractId=M1; Owner confirms early termination; terminationDate=2026-12-15
    // Mong đợi: Return: termination date and planned move-out date 2026-12-15 recorded; process continues to move-out inspection (inspection scheduled, Tenant notified); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-19 A1-A4; UC-19 Normal Flow 7; GBR-03 (Owner final decision on termination)
    // Ghi chú : "Tenant notified" không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF04 UTC07 - Owner xac nhan cham dut som 2026-12-15: ghi nhan va len lich kiem tra")]
    public async Task UTC07_OwnerConfirmsEarlyTermination()
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Active, new DateOnly(2025, 12, 1), new DateOnly(2027, 5, 31));
        var date = new DateOnly(2026, 12, 15);
        ctx.User.As(BF04Contracts.TenantId, Roles.Tenant);
        await ctx.Service.RequestTerminationAsync(m1.Id, new TerminationInput(date, "Tenant moves out early"), Guid.NewGuid(), false, default);

        ctx.User.As(BF04Contracts.OwnerId, Roles.Owner);
        var approved = await ctx.Service.ApproveTerminationAsync(m1.Id, Guid.NewGuid(), default);
        var scheduled = await ctx.Service.ScheduleInspectionAsync(m1.Id,
            new InspectionScheduleInput(new DateTimeOffset(2026, 12, 15, 2, 0, 0, TimeSpan.Zero), BF04Contracts.StaffId), Guid.NewGuid(), default);

        Assert.Equal(date, approved.ProposedDate);
        Assert.Equal(date, scheduled.ProposedDate);
        Assert.NotNull(scheduled.InspectionScheduledAt);
    }

    // ---------------------------------------------------------------- calculateDepositSettlement

    // UTC08 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Deposit 1,000,000 applied + 2,500,000 received; no debt
    // Đầu vào : deduction=0
    // Mong đợi: Return: refundable=3,500,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : SecurityDeposit entity (applied Holding Deposit, verified transfer, refundable amount); UC-15 Normal Flow 11; exact settlement rules subject to OQ-01
    // Ghi chú : "refundable" được đọc từ SettlementCalculation.AvailableSecurityDeposit (trường tiền cọc còn lại có thể hoàn).
    [Fact(DisplayName = "BF04 UTC08 - Coc 1.000.000 + 2.500.000, khong no, khong khau tru: hoan 3.500.000")]
    public void UTC08_RefundableWithoutDeduction()
    {
        var result = SettlementCalculator.Calculate([], 3_500_000m, new DepositLedgerPosition(3_500_000m, 0m, 0m, 0m), 0m);

        Assert.Equal(3_500_000m, result.AvailableSecurityDeposit);
    }

    // UTC09 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Security Deposit 3,500,000 Received; move-out inspection confirmed by Owner
    // Đầu vào : deduction=800000; reason="Broken wardrobe door"; decidedBy=Owner
    // Mong đợi: Return: deduction 800,000 and reason recorded; refundable=2,700,000; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-19 Normal Flow 13-14; SecurityDeposit entity (deduction amount and reason); GBR-03; subject to OQ-01/OQ-05
    // Ghi chú : hệ thống nhận khoản khấu trừ dạng danh sách mục (mã lý do, số tiền, mô tả, minh chứng); SRS/sheet chỉ nêu số tiền và lý do,
    //           không quy định mã lý do. Test dùng mã "Damage" gắn với tài sản tủ áo.
    [Fact(DisplayName = "BF04 UTC09 - Owner khau tru 800.000 (tu ao hong): ghi nhan, hoan 2.700.000")]
    public async Task UTC09_OwnerDeductionIsRecorded()
    {
        var deposit = new BF04Deposit();

        var plan = await deposit.Approve(800_000m, "Broken wardrobe door");

        Assert.Equal(800_000m, plan.Total);
        Assert.Equal("Broken wardrobe door", plan.Reason);
        Assert.Equal(BF04Contracts.OwnerId, plan.ApprovedByUserId);
        await deposit.Repository.Received(1).SaveAsync(Arg.Is<DepositDeductionPlan>(p => p.Total == 800_000m), Arg.Any<CancellationToken>());
        var result = SettlementCalculator.Calculate([], 3_500_000m, new DepositLedgerPosition(3_500_000m, 0m, 0m, 0m), plan.Total);
        Assert.Equal(2_700_000m, result.AvailableSecurityDeposit);
    }

    // UTC10 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Security Deposit 3,500,000 Received; move-out inspection confirmed by Owner
    // Đầu vào : deduction=500000; reason=empty
    // Mong đợi: Return: deduction not saved; reason requested; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : SecurityDeposit entity (deduction amount and reason); GBR-13 (financial decisions retain reason); MSG02
    // Ghi chú : Log Message không quan sát được ở tầng unit (dịch vụ chỉ trả mã lỗi, câu thông báo do tầng API/giao diện hiển thị).
    //           Lưu ý: cùng dữ liệu khoản khấu trừ như UTC09 (có lý do) cũng bị từ chối (invalid_deposit_deduction_item), nên
    //           test này chưa chứng minh được việc từ chối là do thiếu lý do.
    [Fact(DisplayName = "BF04 UTC10 - Khau tru 500.000 khong ly do: khong luu")]
    public async Task UTC10_DeductionWithoutReasonIsNotSaved()
    {
        var deposit = new BF04Deposit();

        await Rejected(() => deposit.Approve(500_000m, ""));

        await deposit.Repository.DidNotReceiveWithAnyArgs().SaveAsync(default!, default);
    }

    // ---------------------------------------------------------------- settleDeposit

    private static (BF04Contracts Ctx, Contract M1) MoveOutReadyForSettlement(SettlementLedgerState ledger, MoveOutStatus status = MoveOutStatus.Inspected)
    {
        var ctx = new BF04Contracts(new DateTimeOffset(2026, 12, 1, 9, 0, 0, TimeSpan.Zero));
        var m1 = ctx.MainContract(ContractStatus.Active, new DateOnly(2025, 12, 1), M1End);
        var electricity = Guid.NewGuid();
        var water = Guid.NewGuid();
        ctx.Store.MoveOuts[m1.Id] = new ContractMoveOut
        {
            ContractId = m1.Id, Status = status, ProposedDate = M1End, Reason = "Contract expiry", IsExpiry = true,
            RequestedByUserId = BF04Contracts.OwnerId, ApprovedByUserId = BF04Contracts.OwnerId, ApprovedAt = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero),
            InspectionScheduledAt = new DateTimeOffset(2026, 11, 30, 2, 0, 0, TimeSpan.Zero), InspectionStaffId = BF04Contracts.StaffId,
            InspectedByUserId = BF04Contracts.StaffId, InspectedAt = new DateTimeOffset(2026, 11, 30, 3, 0, 0, TimeSpan.Zero),
            InspectionNotes = "Final inspection", ElectricityReadingId = electricity, WaterReadingId = water, Version = 3, PendingReason = ""
        };
        ctx.Store.FinalInspections.Add(new ContractFinalInspection
        {
            ContractId = m1.Id, Version = 1, BaselineContractId = m1.Id, BaselineVersion = 1,
            BaselineSnapshot = "{}", ObservedSnapshot = "{}", StaffId = BF04Contracts.StaffId, InspectedAt = new DateTimeOffset(2026, 11, 30, 3, 0, 0, TimeSpan.Zero),
            OwnerDecision = "Confirmed", OwnerReason = "Inspection confirmed", OwnerId = BF04Contracts.OwnerId, ReviewedAt = new DateTimeOffset(2026, 11, 30, 4, 0, 0, TimeSpan.Zero)
        });
        ctx.Ledger.ReadAsync(m1.Id, electricity, water, Arg.Any<CancellationToken>()).Returns(ledger);
        ctx.Ledger.ReadAsync(m1.Id, Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(ledger);
        return (ctx, m1);
    }

    // UTC11 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Move-out inspection confirmed; Owner decided deduction; final invoice and deposit settlement result generated; refund evidence recorded; no outstanding amount
    // Đầu vào : contractId=M1
    // Mong đợi: Return: M1 move-out marked Settled; Security Deposit Settled; Room status updated according to the move-out result; audit history retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-19 Normal Flow 15-18; UC-19 Postcondition 2-4; BF-04 End condition
    // Ghi chú : "Room status updated according to the move-out result" - sheet không nêu trạng thái phòng cụ thể nên không khẳng định giá trị.
    [Fact(DisplayName = "BF04 UTC11 - Du dieu kien quyet toan: move-out Settled, coc Settled, luu lich su")]
    public async Task UTC11_SettlementCompletes()
    {
        var (ctx, m1) = MoveOutReadyForSettlement(new SettlementLedgerState(true, true, true, "SETTLE-M1"));

        var view = await ctx.Service.SettleAsync(m1.Id, new SettlementInput("Deposit settled after confirmed inspection", "SETTLE-M1"), Guid.NewGuid(), default);

        Assert.Equal(nameof(MoveOutStatus.Settled), view.Status);
        Assert.Equal(MoveOutStatus.Settled, ctx.Store.MoveOuts[m1.Id].Status);
        Assert.Contains(ctx.Store.SettlementReviews, r => r.ContractId == m1.Id && r.Settled);
        Assert.True(ctx.Store.Audits.Count > 0 || ctx.Store.MoveOutHistory.Count > 0, "audit history must be retained");
    }

    // UTC12 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Final invoice and deposit settlement result generated for M1; Tenant still has an unpaid remaining amount of 500,000
    // Đầu vào : contractId=M1
    // Mong đợi: Return: M1 not marked Settled; Tenant notified of the outstanding amount; amount remains tracked until fully settled; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-19 Normal Flow 17; UC-19 Postcondition 3; BF-04 End condition
    // Ghi chú : "Tenant notified" và "amount remains tracked" không quan sát được ở tầng unit (thông báo và sổ công nợ nằm ngoài ContractService).
    [Fact(DisplayName = "BF04 UTC12 - Con no 500.000: khong danh dau Settled")]
    public async Task UTC12_OutstandingAmountBlocksSettlement()
    {
        var (ctx, m1) = MoveOutReadyForSettlement(new SettlementLedgerState(false, true, true, "SETTLE-M1"));

        var rejected = await Rejected(() => ctx.Service.SettleAsync(m1.Id, new SettlementInput("Attempt settlement", "SETTLE-M1"), Guid.NewGuid(), default));

        Assert.NotEqual(MoveOutStatus.Settled, ctx.Store.MoveOuts[m1.Id].Status);
        Assert.DoesNotContain(ctx.Store.SettlementReviews, r => r.Settled);
    }

    // UTC13 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Move-out inspection confirmed; Owner has not yet decided the Security Deposit deduction/settlement
    // Đầu vào : contractId=M1
    // Mong đợi: Return: settlement not completed; M1 and Security Deposit not Settled; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-03 (Owner final decision on deposit settlement); UC-19 Normal Flow 14-15
    [Fact(DisplayName = "BF04 UTC13 - Owner chua quyet dinh khau tru coc: khong quyet toan")]
    public async Task UTC13_DepositNotDecidedBlocksSettlement()
    {
        var (ctx, m1) = MoveOutReadyForSettlement(new SettlementLedgerState(true, false, true, "SETTLE-M1"));

        await Rejected(() => ctx.Service.SettleAsync(m1.Id, new SettlementInput("Attempt settlement", "SETTLE-M1"), Guid.NewGuid(), default));

        Assert.NotEqual(MoveOutStatus.Settled, ctx.Store.MoveOuts[m1.Id].Status);
        Assert.DoesNotContain(ctx.Store.SettlementReviews, r => r.Settled);
    }

    // UTC14 (Abnormal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Contract M1 and its Security Deposit already Settled
    // Đầu vào : contractId=M1 (settlement submitted again)
    // Mong đợi: Return: no second settlement, refund or payment effect recorded; M1 remains Settled; Exception: N/A; Log Message: N/A
    // Căn cứ  : GBR-18; NFR 2.2 Idempotency; NFR 2.4 Financial Consistency
    [Fact(DisplayName = "BF04 UTC14 - Quyet toan lai lan 2: khong ghi them, van Settled")]
    public async Task UTC14_SecondSettlementHasNoEffect()
    {
        var (ctx, m1) = MoveOutReadyForSettlement(new SettlementLedgerState(true, true, true, "SETTLE-M1"), MoveOutStatus.Settled);
        ctx.Store.SettlementReviews.Add(new ContractSettlementReview
        {
            ContractId = m1.Id, Decision = "Deposit settled after confirmed inspection", LedgerReference = "SETTLE-M1",
            Settled = true, ReviewedByUserId = BF04Contracts.OwnerId, ReviewedAt = new DateTimeOffset(2026, 11, 30, 5, 0, 0, TimeSpan.Zero), FinancialSnapshot = "{}"
        });
        var before = ctx.Store.Added.Count;

        await Rejected(() => ctx.Service.SettleAsync(m1.Id, new SettlementInput("Deposit settled after confirmed inspection", "SETTLE-M1"), Guid.NewGuid(), default));

        Assert.Equal(MoveOutStatus.Settled, ctx.Store.MoveOuts[m1.Id].Status);
        Assert.Single(ctx.Store.SettlementReviews, r => r.Settled);
        Assert.DoesNotContain(ctx.Store.Added.Skip(before), e => e is ContractSettlementReview);
    }

    // ---------------------------------------------------------------- trackTemporaryResidence

    // UTC15 (Normal) - sheet "BF-04 Renewal Move-out", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active; Tenant t1 actual residence start date recorded; Temporary Residence Task for t1 is In Progress
    // Đầu vào : tenantId=t1; registrationResult=Registered via VNeID; evidence=1 file
    // Mong đợi: Return: temporary-residence status and evidence saved on the task; Owner and t1 notified; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-18 Normal Flow 10-12; UC-18 Postcondition 1-2; GBR-06; BF-04B End condition
    // Ghi chú : người thực hiện là Tenant t1 (SRS UC-18 Normal Flow 10). Kết quả "Registered via VNeID" được ghi bằng trạng thái hoàn tất
    //           (Completed) kèm ghi chú. "Owner and t1 notified" không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF04 UTC15 - Ghi nhan tam tru (VNeID) va 1 file minh chung tren task")]
    public async Task UTC15_TemporaryResidenceResultAndEvidenceSaved()
    {
        var contractId = Guid.NewGuid();
        var residentId = Guid.NewGuid();
        // UC-18 bước 10: Tenant ghi nhận kết quả đăng ký và tải minh chứng lên BHOME.
        var user = new BF04User();
        user.As(BF04Contracts.TenantId, Roles.Tenant);
        var staffLocations = Substitute.For<IStaffLocationAccess>();
        staffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var repository = Substitute.For<IOperationsRepository>();
        var files = Substitute.For<IOperationsFiles>();
        files.ValidateImage(Arg.Any<byte[]>()).Returns("image/jpeg");
        var task = new ResidenceTaskView(contractId, residentId, BF04Contracts.LocationId, Guid.NewGuid(), "101", "Tenant t1", "Representative",
            BF04Contracts.TenantId, new DateOnly(2025, 12, 1), new DateOnly(2025, 12, 1), "InProgress", false, null, false, null, []);
        repository.ResidenceAsync(contractId, residentId, Arg.Any<Guid?>(), Arg.Any<CancellationToken>()).Returns(task);
        repository.UpdateResidenceAsync(Arg.Any<Guid>(), contractId, residentId, Arg.Any<ResidenceUpdate>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(call => task with { Status = call.Arg<ResidenceUpdate>().Status, ResultAt = call.Arg<ResidenceUpdate>().ResultAt });
        repository.AttachResidenceEvidenceAsync(Arg.Any<Guid>(), contractId, residentId, Arg.Any<OperationsFile>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>())
            .Returns(task with { HasEvidence = true });
        var clock = new BF04Clock(new DateTimeOffset(2026, 12, 5, 9, 0, 0, TimeSpan.Zero));
        var service = new OperationsService(repository, files, user, new PermissionAccess(user, new ResourceAccess(user, staffLocations)), clock);

        var updated = await service.UpdateResidenceAsync(contractId, residentId,
            new ResidenceUpdate(new DateOnly(2025, 12, 1), "Completed", clock.GetUtcNow(), "Registered via VNeID"), default);
        using var evidence = new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);
        var withEvidence = await service.UploadResidenceEvidenceAsync(contractId, residentId, evidence, default);

        Assert.Equal("Completed", updated.Status);
        Assert.True(withEvidence.HasEvidence);
        await repository.Received(1).UpdateResidenceAsync(Arg.Any<Guid>(), contractId, residentId,
            Arg.Is<ResidenceUpdate>(u => u.Status == "Completed" && u.Note == "Registered via VNeID"), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
        await repository.Received(1).AttachResidenceEvidenceAsync(Arg.Any<Guid>(), contractId, residentId, Arg.Any<OperationsFile>(), Arg.Any<DateTimeOffset>(), Arg.Any<CancellationToken>());
    }
}

// Dựng DepositDeductionService: tiền cọc 3.500.000 đã nhận, Owner đã xác nhận kiểm tra phòng khi chuyển đi.
internal sealed class BF04Deposit
{
    public IDepositDeductionRepository Repository { get; } = Substitute.For<IDepositDeductionRepository>();
    public IDepositDeductionEvidence Evidence { get; } = Substitute.For<IDepositDeductionEvidence>();
    public Guid ContractId { get; } = Guid.NewGuid();
    public Guid WardrobeAssetId { get; } = Guid.NewGuid();
    private readonly DepositDeductionService service;
    private readonly DepositDeductionContext context;

    public BF04Deposit()
    {
        var user = new BF04User();
        user.As(BF04Contracts.OwnerId, Roles.Owner);
        var summary = new ContractSettlementSummary(ContractId, ContractId, Guid.NewGuid(), "101", BF04Contracts.TenantId,
            3_500_000m, 1_000_000m, 0m, 0m, 0m, 3_500_000m, [], [], false, false, "SETTLE-M1");
        context = new DepositDeductionContext(summary, nameof(ContractStatus.Active), nameof(MoveOutStatus.Inspected), Guid.NewGuid(), 1,
            true, false, [WardrobeAssetId], []);
        Repository.ContextAsync(ContractId, Arg.Any<CancellationToken>()).Returns(context);
        Repository.TransactionAsync(ContractId, Arg.Any<Func<Task<DepositDeductionPlan>>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<Func<Task<DepositDeductionPlan>>>()());
        Evidence.CaptureAsync(Arg.Any<Guid>(), Arg.Any<Guid[]>(), Arg.Any<CancellationToken>()).Returns(Array.Empty<DeductionEvidence>());
        service = new DepositDeductionService(Repository, Evidence, user, new BF04Clock(new DateTimeOffset(2026, 11, 30, 9, 0, 0, TimeSpan.Zero)));
    }

    public Task<DepositDeductionPlan> Approve(decimal amount, string reason) =>
        service.ApproveAsync(ContractId, new DepositDeductionInput(0, context.Summary.Reference, reason, true,
            [new DepositDeductionItem(WardrobeAssetId, "Damage", amount, reason, [])]), Guid.NewGuid(), default);
}
