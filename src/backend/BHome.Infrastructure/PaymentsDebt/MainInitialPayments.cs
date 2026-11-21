using System.Text.Json;
using BHome.Application.Contracts;
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
    IMainDraftData drafts, IPaymentRepository payments, IPaymentCodeRegistry codes,
    ITransferQrGenerator qr, IMainInitialPaymentLedger orders, SePayOptions sepay, TimeProvider clock, IContractWorkflowMode workflowMode, IHoldingTestScope testScope) : IMainInitialPayments
{
    public async Task<MainInitialPaymentView> GetAsync(Guid id, bool issueQr, CancellationToken token)
    {
        await contracts.GetAsync(id, token); // Existing role and effective Location assignment.
        if (db is not Compact24DbContext) throw new PaymentException(503, "initial_payment_runtime_unavailable");
        return await payments.TransactionAsync(null, null, async () =>
        {
            var c = await contractData.FindAsync(id, token) ?? throw new PaymentException(404, "contract_not_found");
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
            var roomScopeMode = untaggedSandbox ? "Test" : ContractPaymentModes.Of(c);
            var reconcile = order is { SharedDepositContractId: null, SharedRentContractId: null, SharedInvoiceId: null } &&
                (!order.RoomScopeResolved || untaggedSandbox && order.RoomScopeMode != roomScopeMode) &&
                !await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AnyAsync(a =>
                    a.TargetInitialContractId == id || a.TargetDepositContractId == id, token);
            if (order is null || reconcile)
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
                foreach (var candidate in candidates.Where(other => ContractPaymentModes.Of(other) == roomScopeMode))
                {
                    var root = candidate;
                    while (root.PreviousContractId is { } previous)
                        root = await db.Set<Contract>().AsNoTracking().SingleAsync(other => other.Id == previous, token);
                    var previousOrder = await orders.ReadAsync(root.Id, token);
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
                IEnumerable<(int Category, int Method, string Code, string Name, decimal Rate)> policies;
                if (signedCharges is not null)
                    policies = signedCharges.Select(p => (p.Category, p.Method, p.ChargeCode, p.Name ?? p.ChargeCode, p.Rate));
                else
                {
                    var legacy = c.DraftMetadata != "{}" ? drafts.Unprotect(c).Charges : (await contractData.ResolvePricesAsync(c.RoomId, c.StartDate, token)).Charges;
                    policies = legacy.Select(p => ((int)p.Category, (int)p.Method, p.ChargeCode, p.Name, p.Rate));
                }
                var fees = policies.Where(p => p.Category == (int)ChargeCategory.ServiceFee && p.Method is (int)ChargingMethod.FixedPerRoomPerMonth or (int)ChargingMethod.FixedPerPersonPerMonth)
                    .Where(p => (rentSource is null && invoiceId is null) || p.Method == (int)ChargingMethod.FixedPerPersonPerMonth)
                    .Select(p => new MainInitialCharge(p.Code, p.Name, p.Rate * (p.Method == (int)ChargingMethod.FixedPerPersonPerMonth ? c.Residents.Count : 1)))
                    .OrderBy(p => p.Code, StringComparer.Ordinal).ToArray();
                if (fees.Any(f => f.Amount < 0 || decimal.Truncate(f.Amount) != f.Amount)) throw new PaymentException(409, "initial_charge_invalid_vnd_amount");
                if (reconcile && depositSource is null && rentSource is null && invoiceId is null)
                    fees = order!.Charges;
                order = new(c.Id, c.Room.LocationId, c.SnapshotHash, c.RequiredDeposit, c.MonthlyRent, fees, order?.CreatedAt ?? clock.GetUtcNow(),
                    depositSource, rentSource, invoiceId, RoomScopeResolved: true, RoomScopeMode: roomScopeMode);
                var raw = JsonSerializer.Serialize(order, MainInitialPaymentLedger.Json);
                var sourceKey = (reconcile ? untaggedSandbox ? "main-initial-sandbox-room:" : "main-initial-room:" : "main-initial:") + id;
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
            var account = await payments.ReceivingAccountAsync(order.LocationId, token);
            var payableMode = invoicePayable || pendingShared is not null ? roomScopeMode : ContractPaymentModes.Of(c);
            var bound = account is not null && account.Enabled && account.IsDevelopmentDemo == (payableMode == "Test") &&
                payableMode == sepay.Mode && sepay.ReceivingAccounts.Any(a => a.LocationId == order.LocationId && a.BankIdentifier == account.BankIdentifier && a.AccountNumber == account.AccountNumber);
            // IssueAsync joins this transaction; it must not clear tracked state or create nested transactions.
            var paymentKind = invoicePayable ? "Invoice" : "MainInitial";
            var paymentId = invoicePayable ? order.SharedInvoiceId!.Value : payable.ContractId;
            var reference = !sepay.Enabled || !bound || outstanding == 0 ? null : issueQr
                ? await codes.IssueAsync(paymentKind, paymentId, order.LocationId, token) : await codes.GetAsync(paymentKind, paymentId, token);
            var rendered = issueQr && bound && reference is not null && outstanding > 0 ? qr.Generate(account!.BankIdentifier, account.AccountNumber, outstanding, reference) : null;
            var availability = outstanding == 0 ? "Settled" : !sepay.Enabled ? "PaymentProviderDisabled" :
                !bound ? "ReceivingAccountUnavailable" : reference is null ? "PaymentCodeUnavailable" : rendered is null ? "InstructionsOnly" : "Available";
            return new MainInitialPaymentView(id, availability, c.Status.ToString(), signed,
                invoicePayable ? [new MainInitialCharge("INVOICE", "Số dư hóa đơn phòng", invoiceOutstanding)] :
                    new[] { new MainInitialCharge("RENT", "Tiền thuê tháng đầu", requiredRent) }.Concat(payable.Charges).ToArray(),
                requiredDeposit, payable.ContractId == id ? c.AppliedHoldingDeposit : 0, deposit, rent, outstanding, outstanding == 0, reference, bound ? account!.BankIdentifier : null, bound ? account!.AccountNumber : null, bound ? account!.AccountHolder : null, rendered?.PngDataUri, ContractPaymentModes.IsTest(c),
                outstandingDeposit, outstandingRentAndFees, meteredRates);
        }, token);
    }
}
