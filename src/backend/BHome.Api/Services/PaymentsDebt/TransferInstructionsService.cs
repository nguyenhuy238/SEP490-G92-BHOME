using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt;

public sealed record PaymentRuntimeMode(bool AllowDevelopmentDemo, bool AllowSandboxReceivingAccounts = false);
public sealed record ReceivingAccountInput(Guid LocationId, [Required] string BankIdentifier, [Required] string AccountNumber,
    [Required] string AccountHolder, [property: JsonRequired] bool Enabled, [property: JsonRequired] bool IsDevelopmentDemo,
    [property: JsonRequired] bool HumanVerified, int ExpectedVersion);
public sealed record OwnerReceivingAccountInput([Required] string BankIdentifier, [Required] string AccountNumber,
    [Required] string AccountHolder, [property: JsonRequired] bool Enabled, [property: JsonRequired] bool IsDevelopmentDemo,
    [property: JsonRequired] bool HumanVerified, int ExpectedVersion);
public sealed record PaymentModeInput(string Mode, string ExpectedMode);
public sealed record PaymentModeView(string Mode, bool TestAvailable, bool LiveAvailable);
public sealed record TransferQr(string Payload, string PngDataUri);
public interface ITransferQrGenerator { TransferQr? Generate(string bank, string account, decimal amount, string description); }
public sealed record TransferInstructions(Guid InvoiceId, string Availability, string? BankIdentifier, string? AccountNumber, string? AccountHolder,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    string TransferReference, string TransferDescription, string? QrPayload, string? QrImageDataUri, bool IsDevelopmentDemo, int? ReceivingAccountVersion);
public sealed class TransferInstructionsService(IPaymentRepository repository, PaymentService payments, ICurrentUser user,
    ITransferQrGenerator qr, PaymentRuntimeMode mode, TimeProvider clock, SePay.IPaymentCodeRegistry? codes = null,
    SePay.SePayOptions? sepay = null, IHoldingTestScope? holdingTestScope = null)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new PaymentException(401, "authentication_required");
    private void Owner() { _ = Actor; if (!user.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required"); }
    public async Task<ReceivingBankAccount?> GetAccountAsync(Guid locationId, CancellationToken t)
    {
        Owner();
        if (await repository.ReceivingOwnerAsync(locationId, t) != Actor) throw new PaymentException(404, "payment_location_not_found");
        return await repository.ReceivingAccountAsync(locationId, t);
    }
    public Task<ReceivingBankAccount?> GetOwnerAccountAsync(CancellationToken t)
    { Owner(); return repository.OwnerReceivingAccountAsync(Actor, t); }
    public Task<ReceivingBankAccount?> GetOwnerAccountForModeAsync(string paymentMode, CancellationToken t)
    {
        Owner(); _ = sepay?.For(paymentMode);
        if (paymentMode is not ("Test" or "Live")) throw new PaymentException(400, "invalid_payment_mode");
        return repository.OwnerReceivingAccountForModeAsync(Actor, paymentMode, t);
    }
    public async Task<PaymentModeView> GetPaymentModeAsync(CancellationToken t)
    {
        Owner();
        var selected = await repository.OwnerPaymentModeAsync(Actor, t) ??
            (sepay?.Enabled == true ? sepay.Mode : (await repository.OwnerReceivingAccountAsync(Actor, t))?.IsDevelopmentDemo == true ? "Test" : "Live");
        return new(selected, sepay?.For("Test").Enabled == true, sepay?.For("Live").Enabled == true);
    }
    public async Task<PaymentModeView> SetPaymentModeAsync(PaymentModeInput input, CancellationToken t)
    {
        Owner();
        if (input.Mode is not ("Test" or "Live") || input.ExpectedMode is not ("Test" or "Live")) throw new PaymentException(400, "invalid_payment_mode");
        return await repository.TransactionAsync<PaymentModeView>(null, null, async () =>
        {
            var previous = await repository.OwnerPaymentModeAsync(Actor, t);
            if ((await GetPaymentModeAsync(t)).Mode != input.ExpectedMode) throw new PaymentException(409, "payment_mode_changed");
            await repository.SetOwnerPaymentModeAsync(Actor, input.Mode, previous, t);
            await repository.AuditAsync(Actor, "SePayPaymentMode" + input.Mode, Actor, clock.GetUtcNow(), t);
            return await GetPaymentModeAsync(t);
        }, t);
    }
    private void ValidateAccount(string bank, string number, string holder, bool developmentDemo, bool humanVerified, int version)
    {
        if (version < 0 || !humanVerified ||
            !Regex.IsMatch(bank ?? "", "^[0-9]{6}$") || !Regex.IsMatch(number ?? "", "^[0-9]{6,19}$") ||
            !Regex.IsMatch(holder ?? "", "^[A-Z0-9 ]{5,50}$") || string.IsNullOrWhiteSpace(holder))
            throw new PaymentException(400, "invalid_receiving_bank_account");
    }
    public Task<ReceivingBankAccount> SaveOwnerAccountAsync(OwnerReceivingAccountInput x, CancellationToken t)
    {
        Owner();
        ValidateAccount(x.BankIdentifier, x.AccountNumber, x.AccountHolder, x.IsDevelopmentDemo, x.HumanVerified, x.ExpectedVersion);
        return repository.TransactionAsync<ReceivingBankAccount>(null, null, async () =>
        {
            var previous = await repository.OwnerReceivingAccountForModeAsync(Actor, x.IsDevelopmentDemo ? "Test" : "Live", t);
            if ((previous?.Version ?? 0) != x.ExpectedVersion) throw new PaymentException(409, "receiving_account_version_changed");
            var account = new ReceivingBankAccount
            {
                OwnerUserId = Actor,
                LocationId = Guid.Empty,
                BankIdentifier = x.BankIdentifier,
                AccountNumber = x.AccountNumber,
                AccountHolder = x.AccountHolder.Trim(),
                Enabled = x.Enabled,
                IsDevelopmentDemo = x.IsDevelopmentDemo,
                Version = x.ExpectedVersion + 1,
                ConfirmedByUserId = Actor,
                ConfirmedAt = PaymentRules.Timestamp(clock.GetUtcNow())
            };
            await repository.SaveOwnerReceivingAccountAsync(Actor, account, x.ExpectedVersion, t);
            await repository.AuditAsync(Actor, "OwnerReceivingBankAccountConfigured", account.Id, account.ConfirmedAt, t);
            return account;
        }, t);
    }
    public Task<ReceivingBankAccount> SaveAccountAsync(ReceivingAccountInput x, CancellationToken t)
    {
        Owner();
        if (x.LocationId == Guid.Empty || x.ExpectedVersion < 0 || !x.HumanVerified ||
            !Regex.IsMatch(x.BankIdentifier ?? "", "^[0-9]{6}$") || !Regex.IsMatch(x.AccountNumber ?? "", "^[0-9]{6,19}$") ||
            !Regex.IsMatch(x.AccountHolder ?? "", "^[A-Z0-9 ]{5,50}$") || string.IsNullOrWhiteSpace(x.AccountHolder))
            throw new PaymentException(400, "invalid_receiving_bank_account");
        if (x.IsDevelopmentDemo && !mode.AllowDevelopmentDemo && !mode.AllowSandboxReceivingAccounts &&
            (holdingTestScope?.Allows(x.LocationId) != true || sepay?.ReceivingAccounts.Any(account =>
                account.LocationId == x.LocationId && account.BankIdentifier == x.BankIdentifier &&
                account.AccountNumber == x.AccountNumber) != true))
            throw new PaymentException(400, "sandbox_receiving_account_unavailable");
        return repository.TransactionAsync<ReceivingBankAccount>(null, null, async () =>
        {
            if (!await repository.ActiveLocationAsync(x.LocationId, t)) throw new PaymentException(404, "payment_location_not_found");
            if (await repository.ReceivingOwnerAsync(x.LocationId, t) != Actor) throw new PaymentException(404, "payment_location_not_found");
            if (await repository.OwnerReceivingAccountAsync(Actor, t) is not null) throw new PaymentException(409, "owner_receiving_account_configured");
            var previous = await repository.ReceivingAccountAsync(x.LocationId, t);
            if ((previous?.Version ?? 0) != x.ExpectedVersion) throw new PaymentException(409, "receiving_account_version_changed");
            var account = new ReceivingBankAccount
            {
                LocationId = x.LocationId,
                BankIdentifier = x.BankIdentifier!,
                AccountNumber = x.AccountNumber!,
                AccountHolder = x.AccountHolder!.Trim(),
                Enabled = x.Enabled,
                IsDevelopmentDemo = x.IsDevelopmentDemo,
                Version = x.ExpectedVersion + 1,
                ConfirmedByUserId = Actor,
                ConfirmedAt = PaymentRules.Timestamp(clock.GetUtcNow())
            };
            await repository.AddAsync(account, t); await repository.AuditAsync(Actor, "ReceivingBankAccountConfigured", account.Id, account.ConfirmedAt, t); return account;
        }, t);
    }
    public async Task<TransferInstructions> GetAsync(Guid invoiceId, CancellationToken t)
    {
        var state = await payments.InvoicePaymentAsync(invoiceId, t);
        var invoice = await repository.InvoiceAsync(invoiceId, new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Tenant), false, default), t)
            ?? throw new PaymentException(404, "payment_invoice_not_found");
        var account = codes is null ? await repository.ReceivingAccountAsync(invoice.LocationId, t) :
            await codes.AccountAsync("Invoice", invoiceId, invoice.LocationId, t);
        var availability = invoice.Status != InvoiceStatus.Final ? "NotIssued" : state.OutstandingAmount <= 0 ? "Settled" :
            account is null || !account.Enabled ? "ReceivingAccountUnavailable" :
            account.IsDevelopmentDemo && !mode.AllowDevelopmentDemo && !mode.AllowSandboxReceivingAccounts ? "ReceivingAccountUnavailable" : "Available";
        var code = state.TransferReference;
        if (availability != "Available") return new(invoiceId, availability, null, null, null, state.OutstandingAmount, code, code, null, null, false, null);
        if (sepay is { Enabled: true } or { DualMode: true })
        {
            // Do not show a legacy invoice reference as a payable QR when automatic SePay
            // reconciliation is enabled: only a persisted BH registry code can be matched.
            var registered = codes is null ? null : await codes.IssueAsync("Invoice", invoiceId, invoice.LocationId, t);
            if (registered is null) return new(invoiceId, "PaymentCodeUnavailable", null, null, null,
                state.OutstandingAmount, code, code, null, null, false, null);
            code = registered;
        }
        else if (codes is not null) code = await codes.IssueAsync("Invoice", invoiceId, invoice.LocationId, t) ?? code;
        var rendered = qr.Generate(account!.BankIdentifier, account.AccountNumber, state.OutstandingAmount, code);
        return new(invoiceId, rendered is null ? "InstructionsOnly" : "Available", account.BankIdentifier, account.AccountNumber, account.AccountHolder,
            state.OutstandingAmount, code, code, rendered?.Payload, rendered?.PngDataUri, account.IsDevelopmentDemo, account.Version);
    }
}
