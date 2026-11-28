using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class MainInitialPayments(BHomePersistenceContext db, ContractService contracts, IContractRepository contractData,
    IPaymentRepository payments, IPaymentCodeRegistry codes,
    ITransferQrGenerator qr, IMainInitialPaymentLedger orders, SePayOptions sepay, TimeProvider clock, IContractWorkflowMode workflowMode, IHoldingTestScope testScope, ICurrentUser user,
    ISePayOwnerConnections connections) : IMainInitialPayments
{
    public async Task<MainInitialPaymentView> GetAsync(Guid id, bool issueQr, CancellationToken token)
    {
        await contracts.GetAsync(id, token); // Existing role and effective Location assignment.
        if (db is not Compact24DbContext) throw new PaymentException(503, "initial_payment_runtime_unavailable");
        return await payments.TransactionAsync(null, null, async () =>
        {
            var c = await contractData.FindAsync(id, token) ?? throw new PaymentException(404, "contract_not_found");
            await connections.ApplyOwnerAsync(c.OwnerSignerId, token);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({c.Room.LocationId.ToString()},0))", token);
            await db.Locked<Room>(c.RoomId).SingleAsync(token);
            if (c.Kind != ContractKind.Main || c.PreviousContractId is not null) throw new PaymentException(409, "initial_main_contract_required");
            if (!c.InitialPaymentRequired) throw new PaymentException(409, "initial_payment_not_enabled_for_contract");
            if (MainSandboxAcceptance.Read(c) is not null &&
                !testScope.Allows(c.Room.LocationId))
                throw new PaymentException(403, "sandbox_signing_not_available");
            var signed = c.SigningMode == ContractSigningModes.Internal ? AnonymousContractSigningService.Complete(c) :
                new[] { c.OwnerSignerId, c.TenantUserId }.All(id => id is not null && c.Signatures.Any(s => s.SignerUserId == id && (c.IsDevelopmentDemo ? sepay.Mode == "Test" && workflowMode.SimulatedSigningEnabled && s.Status == SignatureStatus.Simulated : s.Status == SignatureStatus.Signed) && s.SignedAt is not null && s.SnapshotHash == c.SnapshotHash && !string.IsNullOrWhiteSpace(s.SignedObjectKey) && !string.IsNullOrWhiteSpace(s.ProviderReference)));
            if (!signed || c.Status is not (ContractStatus.PendingActivation or ContractStatus.Active)) throw new PaymentException(409, "initial_payment_signatures_required");
            if (!ContractChargeSnapshot.IsIntact(c)) throw new PaymentException(409, "signed_terms_changed");
            var signedCharges = string.IsNullOrWhiteSpace(c.AgreedPriceSnapshot) || c.AgreedPriceSnapshot == "{}"
                ? null : ContractChargeSnapshot.Read(c).Charges;
            var order = await orders.ReadAsync(id, token);
            if (order is not null && order.SnapshotHash != c.SnapshotHash)
                throw new PaymentException(409, "initial_payment_snapshot_changed");
            var untaggedSandbox = c.PaymentMode is null && !ContractPaymentModes.IsTest(c) && sepay.Enabled &&
                sepay.Mode == "Test" && testScope.Allows(c.Room.LocationId);
            if (order?.RoomScopeMode == "Test" && !ContractPaymentModes.IsTest(c) && !untaggedSandbox)
                throw new PaymentException(409, "sepay_environment_mismatch");
            var legacyPaymentCode = order is { CalculationVersion: < 2 } && await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_data->>'recordType'='PaymentCodeV1'
                  AND task_data->'state'->>'kind'='MainInitial' AND task_data->'state'->>'obligationId'={id.ToString()}) AS "Value"
                """).SingleAsync(token);
            var roomScopeMode = untaggedSandbox ? "Test" : ContractPaymentModes.Of(c);
            var reconcile = order is { SharedDepositContractId: null, SharedRentContractId: null, SharedInvoiceId: null } &&
                (!order.RoomScopeResolved || untaggedSandbox && order.RoomScopeMode != roomScopeMode) &&
                !legacyPaymentCode &&
                !await PaymentLedgerWrites.Allocations(db).AnyAsync(a =>
                    a.TargetInitialContractId == id || a.TargetDepositContractId == id, token);
            var legacyAllocations = order is { CalculationVersion: < 2 } && await PaymentLedgerWrites.Allocations(db)
                .AnyAsync(a => a.TargetInitialContractId == id || a.TargetDepositContractId == id, token);
            var replaceLegacyQuote = order is { CalculationVersion: < 2 } && !legacyAllocations && !legacyPaymentCode;
            if (order is null || reconcile || replaceLegacyQuote)
            {
                var period = new DateOnly(c.StartDate.Year, c.StartDate.Month, 1);
                var candidates = await db.Set<Contract>().AsNoTracking()
                    .Where(other => other.RoomId == c.RoomId && other.Id != id && other.Kind == ContractKind.Main &&
                        (other.Status == ContractStatus.Active || other.Status == ContractStatus.PendingActivation || other.Status == ContractStatus.Expired ||
                         other.Status == ContractStatus.Terminated && other.StartDate >= period && other.StartDate < period.AddMonths(1)))
                    .OrderBy(other => other.StartDate).ThenBy(other => other.Id).ToArrayAsync(token);
                Guid? depositSource = null;
                Guid? rentSource = null;
                Guid? invoiceSource = null;
                foreach (var candidate in candidates)
                {
                    var root = candidate;
                    while (root.PreviousContractId is { } previous)
                        root = await db.Set<Contract>().AsNoTracking().SingleAsync(other => other.Id == previous, token);
                    var previousOrder = await orders.ReadAsync(root.Id, token);
                    // An arrival into an already occupied Room does not buy another
                    // first month or another set of capacity-based service charges.
                    // Existing periodic debt remains on the Room's ordinary invoice.
                    if (candidate.Status == ContractStatus.Active && candidate.ActivatedAt is not null &&
                        candidate.StartDate <= c.StartDate && (candidate.ActualEndDate ?? candidate.EndDate) >= c.StartDate)
                    {
                        if (previousOrder is null && root.InitialPaymentRequired)
                            throw new PaymentException(409, "shared_initial_payment_requires_review");
                        depositSource ??= root.Id;
                        rentSource ??= root.Id;
                        continue;
                    }
                    if (reconcile && candidate.Status == ContractStatus.PendingActivation && previousOrder is not null &&
                        !previousOrder.RoomScopeResolved && (previousOrder.CreatedAt > order!.CreatedAt ||
                            previousOrder.CreatedAt == order.CreatedAt && root.Id.CompareTo(id) > 0))
                        continue;
                    if (previousOrder is null)
                    {
                        if (candidate.Status is ContractStatus.Active or ContractStatus.Expired && root.RequiredDeposit > 0)
                            depositSource ??= root.Id;
                        continue;
                    }
                    if (candidate.Status != ContractStatus.Terminated && previousOrder.RequiredDeposit > 0 &&
                        previousOrder.SharedDepositContractId != id)
                        depositSource ??= previousOrder.SharedDepositContractId ?? root.Id;
                    if (root.StartDate >= period && root.StartDate < period.AddMonths(1) && rentSource is null && invoiceSource is null)
                    {
                        if (candidate.Status == ContractStatus.Terminated && (await orders.OutstandingAsync(previousOrder, token)).RentAndFees != 0)
                            continue;
                        invoiceSource = previousOrder.SharedInvoiceId;
                        if (invoiceSource is null && previousOrder.SharedRentContractId != id)
                            rentSource = previousOrder.SharedRentContractId ?? root.Id;
                    }
                }
                var invoices = await (from invoice in db.Set<BHome.Domain.Billing.Invoice>()
                                      join representative in db.Set<Contract>() on invoice.RepresentativeContractId equals representative.Id
                                      where invoice.RoomId == c.RoomId && invoice.BillingPeriod == period && invoice.Type == "PERIODIC" &&
                                          invoice.Status == BHome.Domain.Billing.InvoiceStatus.Final && invoice.Lines.Any(line => line.ChargeCode == "RENT")
                                      select new { invoice.Id, Representative = representative }).ToArrayAsync(token);
                var invoiceId = rentSource is null
                    ? invoiceSource ?? invoices.Where(invoice => ContractPaymentModes.Of(invoice.Representative) == roomScopeMode)
                        .Select(invoice => (Guid?)invoice.Id).SingleOrDefault()
                    : null;
                // The initial activation transfer contains only the remaining deposit and first rent.
                // Contract charge snapshots remain intact and continue to feed periodic invoices.
                order = new(c.Id, c.Room.LocationId, c.SnapshotHash, c.RequiredDeposit, c.MonthlyRent, [], order?.CreatedAt ?? clock.GetUtcNow(),
                    depositSource, rentSource, invoiceId, RoomScopeResolved: true, RoomScopeMode: roomScopeMode, CalculationVersion: 2);
                var raw = JsonSerializer.Serialize(order, MainInitialPaymentLedger.Json);
                var sourceKey = (reconcile ? untaggedSandbox ? "main-initial-sandbox-room-v2:" : "main-initial-room-v2:" : "main-initial-v2:") + id;
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO operational_tasks(id,task_type,location_id,source_key,status,task_data)
                    VALUES({Guid.NewGuid()},'COMMAND',{order.LocationId},{sourceKey},'Issued',jsonb_build_object('recordType',{MainInitialPaymentLedger.Kind},'state',CAST({raw} AS jsonb)))
                    """, token);
            }
            if (order is null) throw new PaymentException(409, "initial_payment_order_required");
            var pendingShared = await orders.PendingSharedContractAsync(order, token);
            var payable = pendingShared is { } sharedId
                ? await orders.ReadAsync(sharedId, token) ?? throw new PaymentException(409, "shared_initial_payment_requires_review")
                : order;
            var (outstandingDeposit, outstandingRentAndFees) = await orders.OutstandingAsync(payable, token);
            var requiredDeposit = payable.SharedDepositContractId is null ? payable.RequiredDeposit : 0;
            var requiredRent = payable.SharedRentContractId is null && payable.SharedInvoiceId is null ? payable.MonthlyRent : 0;
            var deposit = requiredDeposit - outstandingDeposit;
            var rent = requiredRent + payable.Charges.Sum(f => f.Amount) - outstandingRentAndFees;
            var invoiceOutstanding = order.SharedInvoiceId is { } existingInvoiceId
                ? (await payments.FinancialsAsync(existingInvoiceId, token)).OutstandingAmount : 0;
            var invoicePayable = pendingShared is null && invoiceOutstanding > 0;
            if (invoicePayable)
            {
                outstandingDeposit = 0;
                outstandingRentAndFees = invoiceOutstanding;
                requiredDeposit = 0;
                deposit = 0;
                rent = 0;
            }
            var outstanding = outstandingDeposit + outstandingRentAndFees;
            var meteredRates = (signedCharges ?? []).Where(p => p.Method == (int)ChargingMethod.Metered &&
                    p.Category is (int)ChargeCategory.Electricity or (int)ChargeCategory.Water)
                .Select(p => p.Category == (int)ChargeCategory.Electricity
                    ? new MainInitialMeteredRate(p.ChargeCode, p.Name ?? "Điện", "kWh", p.Rate)
                    : new MainInitialMeteredRate(p.ChargeCode, p.Name ?? "Nước", "m³", p.Rate))
                .ToArray();
            var payableKind = invoicePayable ? "Invoice" : "MainInitial";
            var payableId = invoicePayable ? order.SharedInvoiceId!.Value : payable.ContractId;
            var payableMode = await codes.PersistedModeAsync(payableKind, payableId, token) ??
                (payable.ContractId == c.Id ? roomScopeMode : ContractPaymentModes.Of(
                    await contractData.FindAsync(payable.ContractId, token) ?? throw new PaymentException(404, "contract_not_found")));
            var account = await codes.AccountAsync(payableKind, payableId, order.LocationId, token) ??
                await payments.ReceivingAccountForModeAsync(order.LocationId, payableMode, token);
            var bound = account is not null && account.Enabled && account.IsDevelopmentDemo == (payableMode == "Test") &&
                sepay.For(payableMode).Enabled && sepay.For(payableMode).Matches(order.LocationId, account);
            if (issueQr && untaggedSandbox && bound && outstanding > 0)
            {
                // Resolve legacy, untagged Staging contracts only on an explicit QR
                // request with a verified provider/account binding. Never reclassify
                // an explicit Live contract or one that already has allocations.
                if (await PaymentLedgerWrites.Allocations(db).AnyAsync(a =>
                    a.TargetInitialContractId == id || a.TargetDepositContractId == id, token))
                    throw new PaymentException(409, "sepay_environment_mismatch");
                c.PaymentMode = "Test";
                await payments.AuditAsync(user.UserId ?? throw new PaymentException(401, "authentication_required"),
                    "MainInitialSandboxPaymentModeResolved", id, clock.GetUtcNow(), token);
                // Payment-code generation now reads persisted contract history rather
                // than a tracked projection. Publish the explicit mode in this same transaction.
                await db.SaveChangesAsync(token);
            }
            // IssueAsync joins this transaction; it must not clear tracked state or create nested transactions.
            var paymentKind = invoicePayable ? "Invoice" : "MainInitial";
            var paymentId = invoicePayable ? order.SharedInvoiceId!.Value : payable.ContractId;
            var reference = !sepay.Enabled || !bound || outstanding == 0 ? null : issueQr
                ? await codes.IssueAsync(paymentKind, paymentId, order.LocationId, token) : await codes.GetAsync(paymentKind, paymentId, token);
            var rendered = issueQr && bound && reference is not null && outstanding > 0 ? qr.Generate(account!.BankIdentifier, account.AccountNumber, outstanding, reference) : null;
            var availability = outstanding == 0 ? "Settled" : !sepay.Enabled ? "PaymentProviderDisabled" :
                !bound ? "ReceivingAccountUnavailable" : reference is null ? "PaymentCodeUnavailable" : rendered is null ? "InstructionsOnly" : "Available";
            List<MainInitialCharge> charges = invoicePayable
                ? [new("INVOICE", "Số dư hóa đơn phòng", invoiceOutstanding)]
                : [new("RENT", "Tiền thuê tháng đầu", requiredRent)];
            if (!invoicePayable && payable.CalculationVersion < 2) charges.AddRange(payable.Charges);
            return new MainInitialPaymentView(id, availability, c.Status.ToString(), signed,
                charges,
                invoicePayable ? 0 : requiredRent,
                requiredDeposit, payable.ContractId == id ? c.AppliedHoldingDeposit : 0, deposit, rent, outstanding, outstanding == 0, reference, bound ? account!.BankIdentifier : null, bound ? account!.AccountNumber : null, bound ? account!.AccountHolder : null, rendered?.PngDataUri, payableMode == "Test",
                outstandingDeposit, outstandingRentAndFees, payable.CalculationVersion < 2 ? meteredRates : []);
        }, token);
    }
}
