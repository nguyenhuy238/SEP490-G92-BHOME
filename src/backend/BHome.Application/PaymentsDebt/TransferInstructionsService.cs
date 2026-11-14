using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;

namespace BHome.Application.PaymentsDebt;

public sealed record PaymentRuntimeMode(bool AllowDevelopmentDemo);
public sealed record ReceivingAccountInput(Guid LocationId, [Required] string BankIdentifier, [Required] string AccountNumber,
    [Required] string AccountHolder, [property: JsonRequired] bool Enabled, [property: JsonRequired] bool IsDevelopmentDemo,
    [property: JsonRequired] bool HumanVerified, int ExpectedVersion);
public sealed record TransferQr(string Payload, string PngDataUri);
public interface ITransferQrGenerator { TransferQr? Generate(string bank, string account, decimal amount, string description); }
public sealed record TransferInstructions(Guid InvoiceId, string Availability, string? BankIdentifier, string? AccountNumber, string? AccountHolder,
    [property: JsonNumberHandling(JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString)] decimal OutstandingAmount,
    string TransferReference, string TransferDescription, string? QrPayload, string? QrImageDataUri, bool IsDevelopmentDemo, int? ReceivingAccountVersion);
public sealed class TransferInstructionsService(IPaymentRepository repository, PaymentService payments, ICurrentUser user,
    ITransferQrGenerator qr, PaymentRuntimeMode mode, TimeProvider clock, SePay.IPaymentCodeRegistry? codes = null)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new PaymentException(401, "authentication_required");
    private void Owner() { _ = Actor; if (!user.IsInRole(Roles.Owner)) throw new PaymentException(403, "payment_owner_required"); }
    public Task<ReceivingBankAccount?> GetAccountAsync(Guid locationId, CancellationToken t)
    { Owner(); return repository.ReceivingAccountAsync(locationId, t); }
    public Task<ReceivingBankAccount> SaveAccountAsync(ReceivingAccountInput x, CancellationToken t)
    {
        Owner();
        if (x.LocationId == Guid.Empty || x.ExpectedVersion < 0 || !x.HumanVerified ||
            !Regex.IsMatch(x.BankIdentifier ?? "", "^[0-9]{6}$") || !Regex.IsMatch(x.AccountNumber ?? "", "^[0-9]{6,19}$") ||
            !Regex.IsMatch(x.AccountHolder ?? "", "^[A-Z0-9 ]{5,50}$") || string.IsNullOrWhiteSpace(x.AccountHolder) || x.IsDevelopmentDemo && !mode.AllowDevelopmentDemo)
            throw new PaymentException(400, "invalid_receiving_bank_account");
        return repository.TransactionAsync<ReceivingBankAccount>(null, null, async () =>
        {
            if (!await repository.ActiveLocationAsync(x.LocationId, t)) throw new PaymentException(404, "payment_location_not_found");
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
            repository.Add(account); repository.Audit(Actor, "ReceivingBankAccountConfigured", account.Id, account.ConfirmedAt); return account;
        }, t);
    }
    public async Task<TransferInstructions> GetAsync(Guid invoiceId, CancellationToken t)
    {
        var state = await payments.InvoicePaymentAsync(invoiceId, t);
        var invoice = await repository.InvoiceAsync(invoiceId, new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Tenant), false, default), t)
            ?? throw new PaymentException(404, "payment_invoice_not_found");
        var account = await repository.ReceivingAccountAsync(invoice.LocationId, t);
        var availability = invoice.Status != InvoiceStatus.Final ? "NotIssued" : state.OutstandingAmount <= 0 ? "Settled" :
            account is null || !account.Enabled ? "ReceivingAccountUnavailable" : account.IsDevelopmentDemo && !mode.AllowDevelopmentDemo ? "ReceivingAccountUnavailable" : "Available";
        var code = state.TransferReference;
        if (availability != "Available") return new(invoiceId, availability, null, null, null, state.OutstandingAmount, code, code, null, null, false, null);
        if (codes is not null) code = await codes.IssueAsync("Invoice", invoiceId, invoice.LocationId, t) ?? code;
        var rendered = qr.Generate(account!.BankIdentifier, account.AccountNumber, state.OutstandingAmount, code);
        return new(invoiceId, rendered is null ? "InstructionsOnly" : "Available", account.BankIdentifier, account.AccountNumber, account.AccountHolder,
            state.OutstandingAmount, code, code, rendered?.Payload, rendered?.PngDataUri, account.IsDevelopmentDemo, account.Version);
    }
}
