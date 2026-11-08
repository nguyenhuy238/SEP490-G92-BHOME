using BHome.Application.Billing;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF06;

// Bối cảnh dùng chung cho sheet "BF-06 Payment Debt", BHOME_Unit_Test_Document_v1.0.xlsx.
// Toàn bộ dữ liệu (Invoice INV-204 4.270.000, mã thanh toán, Owner/Staff/Tenant, Location L1/L2, ...) lấy từ cột
// Pre-conditions / Input của sheet. Code chỉ được dùng để biết cách gọi hàm (danh mục chữ ký), không đọc logic.
// Kho dữ liệu là bản giả lập trong bộ nhớ (hành vi của một CSDL: lưu, tìm theo khóa, cộng tổng tiền đã thu).
// Phạm vi dữ liệu theo vai trò (Owner thấy toàn chuỗi, Staff chỉ Location được giao, Tenant chỉ dữ liệu của mình)
// được mô phỏng trong kho giả theo SRS GBR-02 / DBR-01.
internal sealed class BF06TestWorld
{
    public static readonly Guid Owner1 = Guid.Parse("00000000-0000-0000-0000-00000000a001");
    public static readonly Guid Staff1 = Guid.Parse("00000000-0000-0000-0000-00000000a002");
    public static readonly Guid Tenant1 = Guid.Parse("00000000-0000-0000-0000-00000000a003");
    public static readonly Guid L1 = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
    public static readonly Guid L2 = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    public static readonly Guid Room204 = Guid.Parse("00000000-0000-0000-0000-0000000000c4");
    public static readonly Guid Inv204 = Guid.Parse("00000000-0000-0000-0000-000000000204");
    public static readonly Guid Inv205 = Guid.Parse("00000000-0000-0000-0000-000000000205");

    public readonly ICurrentUser User = Substitute.For<ICurrentUser>();
    public readonly TimeProvider Clock = Substitute.For<TimeProvider>();
    public readonly IStaffLocationAccess StaffLocations = Substitute.For<IStaffLocationAccess>();
    public readonly FakePaymentRepository Payments;
    private DateTimeOffset now = new(2026, 12, 1, 9, 0, 0, TimeSpan.FromHours(7));

    public BF06TestWorld()
    {
        Clock.GetUtcNow().Returns(_ => now.ToUniversalTime());
        Clock.LocalTimeZone.Returns(TimeZoneInfo.Utc);
        Payments = new FakePaymentRepository();
        StaffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call => Payments.StaffAssignments.Contains((call.ArgAt<Guid>(0), call.ArgAt<Guid>(1))));
        AsOwner();
    }

    public DateTimeOffset Now => now;
    public void SetNow(DateTimeOffset value) => now = value;

    public void AsOwner() => LoggedIn(Owner1, Roles.Owner);
    public void AsStaff() => LoggedIn(Staff1, Roles.Staff);
    public void AsTenant() => LoggedIn(Tenant1, Roles.Tenant);

    private void LoggedIn(Guid id, string role)
    {
        User.UserId.Returns(id);
        User.IsInRole(Arg.Any<string>()).Returns(call => call.Arg<string>() == role);
    }

    public PermissionAccess Permissions() => new(User, new ResourceAccess(User, StaffLocations));

    public PaymentService PaymentService() => new(Payments, User, Clock);

    // Invoice INV-204: Finalized, tổng 4.270.000 (tiền phòng 3.500.000 + điện 500.000 + nước 270.000), hạn 2026-12-05.
    public static Invoice Invoice204(InvoiceStatus status = InvoiceStatus.Final) =>
        NewInvoice(Inv204, status, (ChargeCategory.Rent, "RENT", 3_500_000m), (ChargeCategory.Electricity, "ELECTRICITY", 500_000m),
            (ChargeCategory.Water, "WATER", 270_000m));

    // Invoice INV-205 (Draft): điện 500.000.
    public static Invoice Invoice205Draft() =>
        NewInvoice(Inv205, InvoiceStatus.Draft, (ChargeCategory.Rent, "RENT", 3_500_000m), (ChargeCategory.Electricity, "ELECTRICITY", 500_000m));

    private static Invoice NewInvoice(Guid id, InvoiceStatus status, params (ChargeCategory Category, string Code, decimal Amount)[] lines)
    {
        var invoice = new Invoice
        {
            RoomId = Room204,
            LocationId = L1,
            RoomNumber = "204",
            LocationName = "Location L1",
            BillingPeriod = new DateOnly(2026, 11, 1),
            RepresentativeContractId = Guid.Parse("00000000-0000-0000-0000-0000000000d4"),
            RepresentativeTenantUserId = Tenant1,
            Status = status,
            Version = 1,
            MissingInputs = [],
            ScheduleSnapshot = "{}",
            ScheduledFinalDate = new DateOnly(2026, 11, 30),
            DueDate = new DateOnly(2026, 12, 5),
            CreatedByUserId = Owner1,
            FinalizedByUserId = status == InvoiceStatus.Final ? Owner1 : null,
            FinalizedAt = status == InvoiceStatus.Final ? new DateTimeOffset(2026, 11, 30, 9, 0, 0, TimeSpan.Zero) : null,
            Lines = [],
            Recipients = [new InvoiceRecipient { InvoiceId = id, TenantUserId = Tenant1 }]
        };
        foreach (var (category, code, amount) in lines)
        {
            invoice.Lines.Add(new InvoiceLine
            {
                Id = Guid.NewGuid(),
                InvoiceId = id,
                Category = category,
                ChargeCode = code,
                Name = code,
                RateDate = new DateOnly(2026, 11, 1),
                Rate = amount,
                Quantity = 1,
                OccupiedDays = 30,
                PeriodDays = 30,
                Amount = amount,
                CalculatedAmount = amount
            });
        }
        invoice.Total = invoice.Lines.Sum(l => l.Amount);
        WithId(invoice, id);
        return invoice;
    }

    // Id của thực thể không có setter public: gán khi dựng dữ liệu điều kiện (precondition) bằng reflection.
    public static T WithId<T>(T entity, Guid id) where T : BHome.Domain.Common.AuditableEntity
    {
        typeof(BHome.Domain.Common.AuditableEntity).GetProperty(nameof(BHome.Domain.Common.AuditableEntity.Id))!.SetValue(entity, id);
        return entity;
    }

    // So sánh trạng thái theo nghĩa (bỏ qua hoa/thường, khoảng trắng, gạch dưới): "Partially Paid" == "PartiallyPaid".
    public static string Norm(string? value) =>
        new string((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();

    public static void AssertStatus(string expected, string? actual) =>
        Assert.True(Norm(expected) == Norm(actual), $"Trạng thái mong đợi \"{expected}\" nhưng thực tế \"{actual}\"");

    public static async Task<Exception?> Capture(Func<Task> action)
    {
        try { await action(); return null; }
        catch (Exception ex) { return ex; }
    }
}

// Kho dữ liệu thanh toán giả lập (thay cho CSDL) - IPaymentRepository.
internal sealed class FakePaymentRepository : IPaymentRepository
{
    public readonly List<Invoice> Invoices = [];
    public readonly List<PaymentTransfer> Transfers = [];
    public readonly List<PaymentAllocation> Allocations = [];
    public readonly List<PaymentReconciliation> Reconciliations = [];
    public readonly List<BankReferenceClaim> Claims = [];
    public readonly List<PaymentCommand> Commands = [];
    public readonly List<object> Others = [];
    public readonly List<DebtInvoiceView> DebtRows = [];
    public readonly HashSet<(Guid Staff, Guid Location)> StaffAssignments = [];
    public readonly List<(Guid Actor, string Action, Guid Target)> Audits = [];

    // Kho lưu được giao dịch lệch số tiền (thiếu/thừa) - SRS Payment lifecycle có Underpayment/Overpayment.
    public bool AmountMismatchSupported => true;

    public Task<T> TransactionAsync<T>(Guid? transferId, Guid? invoiceId, Func<Task<T>> work, CancellationToken t) => work();
    public Task<T> DepositTransactionAsync<T>(Guid transferId, Guid contractId, Func<Task<T>> work, CancellationToken t) => work();

    public Task<Invoice?> InvoiceAsync(Guid id, PaymentScope scope, CancellationToken t) =>
        Task.FromResult(Invoices.FirstOrDefault(i => i.Id == id && Visible(i.LocationId, i.RepresentativeTenantUserId, scope)));

    private bool Visible(Guid locationId, Guid tenantId, PaymentScope scope) =>
        scope.Owner || (scope.Staff && StaffAssignments.Contains((scope.ActorId, locationId))) || (scope.Tenant && tenantId == scope.ActorId);

    public Task<PaymentTransfer?> TransferAsync(Guid id, CancellationToken t) => Task.FromResult(Transfers.FirstOrDefault(x => x.Id == id));

    public Task<PaymentTransfer?> TransferReferenceAsync(string provider, string reference, CancellationToken t)
    {
        var wanted = PaymentRules.NormalizeReference(reference);
        return Task.FromResult(Transfers.FirstOrDefault(x => x.ProviderIdentity == provider &&
            (x.NormalizedReference == wanted || PaymentRules.NormalizeReference(x.BankReference) == wanted)));
    }

    public Task<PaymentAllocation?> AllocationAsync(Guid transferId, CancellationToken t) =>
        Task.FromResult(Allocations.FirstOrDefault(a => a.TransferId == transferId));

    public Task<PaymentReconciliation?> LatestReviewAsync(Guid transferId, CancellationToken t) =>
        Task.FromResult(Reconciliations.Where(r => r.TransferId == transferId).OrderBy(r => r.Sequence).LastOrDefault());

    public Task<IReadOnlyList<PaymentLedgerEntry>> HistoryAsync(Guid invoiceId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<PaymentLedgerEntry>>(Allocations.Where(a => a.InvoiceId == invoiceId)
            .Select(a => new PaymentLedgerEntry(a, Transfers.First(x => x.Id == a.TransferId))).ToList());

    public Task<decimal> AllocatedAsync(Guid invoiceId, CancellationToken t) =>
        Task.FromResult(Allocations.Where(a => a.InvoiceId == invoiceId).Sum(a => a.Amount));

    public Task<decimal> DepositAllocatedAsync(Guid contractId, CancellationToken t) => Task.FromResult(0m);
    public Task<BHome.Domain.TenantContracts.Contract?> HoldingAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult<BHome.Domain.TenantContracts.Contract?>(null);

    // Số dư theo SRS §3.2 Invoice: còn nợ = phải trả - đã trả; phần trả thừa = đã trả - phải trả.
    public Task<InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t)
    {
        var invoice = Invoices.First(i => i.Id == invoiceId);
        var paid = Allocations.Where(a => a.InvoiceId == invoiceId).Sum(a => a.Amount);
        return Task.FromResult(new InvoiceFinancialView(invoice.Total, 0m, invoice.Total, paid,
            Math.Max(0m, invoice.Total - paid), Math.Max(0m, paid - invoice.Total), 1, "None"));
    }

    public Task<bool> ReferenceClaimedAsync(string reference, CancellationToken t) =>
        Task.FromResult(Claims.Any(c => c.NormalizedReference == PaymentRules.NormalizeReference(reference)));

    public Task<bool> EligiblePayerAsync(Guid invoiceId, Guid payerId, CancellationToken t) => Task.FromResult(true);
    public Task<bool> PendingReviewAsync(Guid invoiceId, CancellationToken t) => Task.FromResult(false);

    public Task<PaymentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) =>
        Task.FromResult(Commands.FirstOrDefault(c => c.ActorId == actor && c.Key == key && c.Operation == operation));

    public Task<PagedResult<TransferView>> TransfersAsync(PaymentQuery query, CancellationToken t) =>
        Task.FromResult(new PagedResult<TransferView>([], query.Page, query.PageSize, 0));

    public Task<PagedResult<ReconciliationView>> ReviewsAsync(Guid transferId, int page, int pageSize, CancellationToken t)
    {
        var rows = Reconciliations.Where(r => r.TransferId == transferId).OrderBy(r => r.Sequence)
            .Select(r => new ReconciliationView(r.Sequence, r.InvoiceId, r.Decision, r.Reason, r.ActorId, r.OccurredAt)).ToList();
        return Task.FromResult(new PagedResult<ReconciliationView>(rows, page, pageSize, rows.Count));
    }

    public Task<ReceivingBankAccount?> ReceivingAccountAsync(Guid locationId, CancellationToken t) => Task.FromResult<ReceivingBankAccount?>(null);
    public Task<bool> ActiveLocationAsync(Guid locationId, CancellationToken t) => Task.FromResult(true);
    public Task<IReadOnlyList<PayerChoice>> PayersAsync(Guid invoiceId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<PayerChoice>>([new PayerChoice(BF06TestWorld.Tenant1, "Tenant 204")]);

    public Task<PagedResult<DebtInvoiceView>> DebtAsync(PaymentScope scope, PaymentQuery query, CancellationToken t)
    {
        var rows = DebtRows.Where(r => scope.Owner || (scope.Staff && StaffAssignments.Contains((scope.ActorId, r.LocationId))))
            .Where(r => query.LocationId is null || r.LocationId == query.LocationId).ToList();
        return Task.FromResult(new PagedResult<DebtInvoiceView>(rows, query.Page, query.PageSize, rows.Count));
    }

    public Task<PagedResult<PaymentHistoryEntry>> PaymentHistoryAsync(PaymentScope scope, PaymentQuery query, CancellationToken t) =>
        Task.FromResult(new PagedResult<PaymentHistoryEntry>([], query.Page, query.PageSize, 0));

    public void Add(object entity)
    {
        switch (entity)
        {
            case PaymentTransfer x: Transfers.Add(x); break;
            case PaymentAllocation x: Allocations.Add(x); break;
            case PaymentReconciliation x: Reconciliations.Add(x); break;
            case BankReferenceClaim x: Claims.Add(x); break;
            case PaymentCommand x: Commands.Add(x); break;
            default: Others.Add(entity); break;
        }
    }

    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) => Audits.Add((actor, action, target));
}

// Kho yêu cầu hoàn tiền giả lập - IRefundRepository. Nguồn hoàn tiền: phần trả thừa (ExcessBalance) 230.000 của Tenant.
internal sealed class FakeRefundRepository : IRefundRepository
{
    public static readonly Guid SourcePayment = Guid.Parse("00000000-0000-0000-0000-0000000000e1");
    public decimal Excess = 230_000m;
    public readonly List<RefundRecord> Records = [];
    public readonly List<(Guid Actor, string Action)> Saves = [];

    public Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken t) => work();

    public Task<RefundSourceData> SourceAsync(Guid id, CancellationToken t) =>
        Task.FromResult(new RefundSourceData(Excess, false, [new RefundPerson(BF06TestWorld.Tenant1, "Tenant 204")],
            Records.Where(r => r.SourcePaymentId == id).ToList()));

    public Task<RefundSourceData> DepositSourceAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult(new RefundSourceData(0m, false, [], []));

    public Task<RefundRecord> GetAsync(Guid id, CancellationToken t) =>
        Task.FromResult(Records.FirstOrDefault(r => r.Id == id) ?? throw new KeyNotFoundException("refund not found"));

    public Task<RefundRecord?> OperationAsync(Guid key, CancellationToken t) =>
        Task.FromResult(Records.FirstOrDefault(r => r.OperationKey == key));

    public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken t) =>
        Task.FromResult(Records.Any(r => r.Id != exceptId && r.ExternalReference == reference));

    public Task SaveAsync(RefundRecord record, bool create, Guid actor, string action, DateTimeOffset now, CancellationToken t)
    {
        if (create && Records.All(r => r.Id != record.Id)) Records.Add(record);
        Saves.Add((actor, action));
        return Task.CompletedTask;
    }
}

// Kho yêu cầu điều chỉnh hóa đơn giả lập - IAdjustmentRepository.
internal sealed class FakeAdjustmentRepository : IAdjustmentRepository
{
    public readonly List<Invoice> Invoices = [];
    public readonly List<InvoiceAdjustmentRequest> Requests = [];
    public readonly List<InvoiceAdjustmentDecision> Decisions = [];
    public readonly List<InvoiceAdjustmentCommand> Commands = [];
    public readonly List<InvoiceAdjustmentEvidence> Evidence = [];
    public readonly List<object> Others = [];

    public Task<T> TransactionAsync<T>(Guid invoiceId, Func<Task<T>> work, CancellationToken t) => work();

    public Task<Invoice?> InvoiceAsync(Guid id, InvoiceScope scope, CancellationToken t) =>
        Task.FromResult(Invoices.FirstOrDefault(i => i.Id == id && (scope.Owner || (scope.Tenant && i.RepresentativeTenantUserId == scope.Actor))));

    public Task<InvoiceAdjustmentRequest?> RequestAsync(Guid id, InvoiceScope scope, CancellationToken t) =>
        Task.FromResult(Requests.FirstOrDefault(r => r.Id == id && (scope.Owner || (scope.Tenant && r.RequesterId == scope.Actor))));

    public Task<PagedResult<InvoiceAdjustmentRequest>> ListAsync(AdjustmentQuery query, InvoiceScope scope, CancellationToken t)
    {
        var rows = Requests.Where(r => scope.Owner || (scope.Tenant && r.RequesterId == scope.Actor)).ToList();
        return Task.FromResult(new PagedResult<InvoiceAdjustmentRequest>(rows, query.Page, query.PageSize, rows.Count));
    }

    public Task<InvoiceAdjustmentCommand?> CommandAsync(Guid actor, Guid key, string operation, CancellationToken t) =>
        Task.FromResult(Commands.FirstOrDefault(c => c.ActorId == actor && c.Key == key && c.Operation == operation));

    public Task<InvoiceAdjustmentEvidence[]> EvidenceAsync(Guid[] ids, CancellationToken t) =>
        Task.FromResult(Evidence.Where(e => ids.Contains(e.Id)).ToArray());

    // Số dư sau điều chỉnh đã duyệt (SRS §3.2 Invoice / InvoiceAdjustment): phải trả = phát hành + tổng điều chỉnh.
    public Task<InvoiceFinancialView> FinancialsAsync(Guid invoiceId, CancellationToken t)
    {
        var invoice = Invoices.First(i => i.Id == invoiceId);
        var adjustments = Decisions.Where(d => d.InvoiceId == invoiceId && d.InvoiceStatus == InvoiceStatus.Final).Sum(d => d.Delta);
        var payable = invoice.Total + adjustments;
        return Task.FromResult(new InvoiceFinancialView(invoice.Total, adjustments, payable, 0m, Math.Max(0m, payable), 0m,
            1 + Decisions.Count(d => d.InvoiceId == invoiceId), "None"));
    }

    public Task<decimal> ChargeAdjustmentsAsync(Guid invoiceId, string chargeCode, CancellationToken t) =>
        Task.FromResult(Decisions.Where(d => d.InvoiceId == invoiceId && d.ChargeCode == chargeCode && d.InvoiceStatus == InvoiceStatus.Final)
            .Sum(d => d.Delta));

    public Task<PagedResult<AdjustmentEffectView>> EffectsAsync(Guid invoiceId, int page, int pageSize, CancellationToken t)
    {
        var rows = Decisions.Where(d => d.InvoiceId == invoiceId)
            .Select(d => new AdjustmentEffectView(d.Id, d.InvoiceStatus.ToString(), d.ChargeCode, d.Delta, d.BeforeAmount, d.CorrectedAmount, d.DecidedAt))
            .ToList();
        return Task.FromResult(new PagedResult<AdjustmentEffectView>(rows, page, pageSize, rows.Count));
    }

    public void Add(object entity)
    {
        switch (entity)
        {
            case InvoiceAdjustmentRequest x:
                x.Invoice ??= Invoices.First(i => i.Id == x.InvoiceId); // như CSDL: yêu cầu luôn đọc kèm hóa đơn của nó
                Requests.Add(x);
                break;
            case InvoiceAdjustmentDecision x: Decisions.Add(x); break;
            case InvoiceAdjustmentCommand x: Commands.Add(x); break;
            default: Others.Add(entity); break;
        }
    }

    public void Audit(Guid actor, string action, Guid target, DateTimeOffset at) { }
}
