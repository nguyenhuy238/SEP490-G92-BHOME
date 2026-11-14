using System.Globalization;
using System.Text.Json;

namespace BHome.PlanIntegrationTests.BF06PaymentDebt;

/// <summary>
/// Preconditions and documented calls for sheet "BF-06 Payment Debt" (docs/api/PAYMENTS.md, INVOICE_ADJUSTMENTS.md).
/// A Final invoice needs an active (signed) contract, so the invoices/requests come from environment variables:
///   BHOME_IT_BF06_PAY_INVOICE_ID          Final unpaid invoice of the Room of "tenant" (paid by ITC-BF06-001).
///   BHOME_IT_BF06_SHARED_INVOICE_ID       Final unpaid invoice whose recipients include "tenant" and "tenant2" (paid by ITC-BF06-002).
///   BHOME_IT_BF06_CONCURRENT_INVOICE_ID   Final unpaid invoice whose recipients include "tenant" and "tenant2" (paid by ITC-BF06-003).
///   BHOME_IT_BF06_INVOICE_ID              Final unpaid invoice (stays unpaid: ITC-BF06-004/005 only send refused requests).
///   BHOME_IT_BF06_DEPOSIT_REFERENCE       Bank reference already used by a verified contract deposit.
///   BHOME_IT_BF06_INVOICE_BANK_REFERENCE  Bank reference already allocated to an invoice payment.
///   BHOME_IT_BF06_DEPOSIT_CONTRACT_ID     Contract still waiting for its deposit verification.
///   BHOME_IT_BF06_DEPOSIT_AMOUNT          Required deposit of that contract (decimal string VND).
///   BHOME_IT_BF06_LOCATION_ID             Location (assigned to "staff", not to "staff2") with paid and unpaid Final invoices.
///   BHOME_IT_BF06_PAID_INVOICE_ID         Paid Final invoice of that Location shared by several Tenants.
///   BHOME_IT_BF06_ADJ_INVOICE_ID          Invoice whose recipients include "tenant" and "tenant2" (ITC-BF06-009 adds a request).
///   BHOME_IT_BF06_DRAFT_ADJUSTMENT_ID     Pending request on a complete Draft invoice whose Final date has arrived (consumed by ITC-BF06-010).
///   BHOME_IT_BF06_PENDING_ADJUSTMENT_ID   Pending request (consumed by ITC-BF06-011).
///   BHOME_IT_BF06_FINAL_ADJUSTMENT_ID     Pending request on a Final unpaid invoice (consumed by ITC-BF06-012).
///   BHOME_IT_BF06_REJECT_ADJUSTMENT_ID    Pending request on a Final invoice (consumed by ITC-BF06-013).
/// Accounts: "tenant2" (second Tenant of the same Room), "staff2" (Staff of another Location), "stafftenant" (Staff + Tenant).
/// </summary>
internal static class PaymentFlow
{
    public static string Env(string name, string prepare)
    {
        var value = Environment.GetEnvironmentVariable(name);
        Skip.If(string.IsNullOrWhiteSpace(value), $"Precondition not configured: set {name} to {prepare}.");
        return value!.Trim();
    }

    public static JsonElement Parse(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    public static async Task<JsonElement> GetOkAsync(PlanApi api, string path, string token, string step)
        => Parse(await PlanAssert.SuccessAsync(await api.GetAsync(path, token), step));

    public static decimal Dec(string? text) => decimal.Parse(text ?? "0", NumberStyles.Number, CultureInfo.InvariantCulture);

    public static string Vnd(decimal value) => decimal.Round(value, 0).ToString("0", CultureInfo.InvariantCulture);

    public static int Int(JsonElement e, string path) => int.Parse(e.Str(path) ?? "0", CultureInfo.InvariantCulture);

    public static Task<JsonElement> PaymentAsync(PlanApi api, string token, string invoiceId, string step = "read invoice payment")
        => GetOkAsync(api, $"api/v1/invoices/{invoiceId}/payment", token, step);

    /// <summary>Payment read model of an unpaid Final invoice; skips when the configured invoice is already settled.</summary>
    public static async Task<JsonElement> UnpaidAsync(PlanApi api, string ownerToken, string invoiceId, string variable)
    {
        var payment = await PaymentAsync(api, ownerToken, invoiceId, "read unpaid invoice");
        Skip.If(Dec(payment.Str("outstandingAmount")) <= 0 || payment.Str("paymentStatus") == "Paid", $"{variable} is already paid; prepare a new unpaid Final invoice.");
        return payment;
    }

    /// <summary>Owner registers a verified bank statement line (POST /payment-transactions).</summary>
    public static Task<HttpResponseMessage> RegisterAsync(
        PlanApi api, string token, string amount, string description, string? invoiceId, string? bankReference = null, string? key = null)
        => api.PostAsync(
            "api/v1/payment-transactions",
            new
            {
                providerIdentity = "SYNTHETIC-IT",
                bankReference = bankReference ?? "IT" + Guid.NewGuid().ToString("N")[..16].ToUpperInvariant(),
                amount,
                currency = "VND",
                occurredAt = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O", CultureInfo.InvariantCulture),
                transferDescription = description,
                statementReference = "IT_SYNTHETIC_STATEMENT",
                verificationReason = "SYNTHETIC INTEGRATION TEST - NO REAL MONEY",
                proposedInvoiceId = invoiceId,
                humanVerified = true,
                isDevelopmentDemo = true,
            },
            token,
            PlanData.IdempotencyKey(key));

    public static async Task<string> RegisterOkAsync(PlanApi api, string token, string amount, string description, string? invoiceId, string step)
    {
        var body = await PlanAssert.SuccessAsync(await RegisterAsync(api, token, amount, description, invoiceId), step);
        return Parse(body).Str("id") ?? throw new InvalidOperationException("Transfer answer has no id: " + body);
    }

    public static Task<HttpResponseMessage> AllocateAsync(PlanApi api, string token, string transferId, string invoiceId, string? paidByUserId, string? key = null)
        => api.PostAsync(
            $"api/v1/payment-transactions/{transferId}/allocate",
            new { invoiceId, paidByUserId, humanVerified = true },
            token,
            PlanData.IdempotencyKey(key));

    /// <summary>Owner decision on an adjustment request (approve or reject) with the versions read from the request detail.</summary>
    public static Task<HttpResponseMessage> DecideAsync(PlanApi api, string token, JsonElement request, string decision, string? correctedAmount, string? chargeCode, string reason)
        => api.PostAsync(
            $"api/v1/invoice-adjustments/{request.Str("id")}/{decision}",
            new
            {
                expectedVersion = Int(request, "version"),
                expectedInvoiceVersion = Int(request, "currentInvoice.version"),
                expectedFinancialVersion = Int(request, "currentFinancialVersion"),
                correctedAmount,
                chargeCode,
                reason,
                humanConfirmed = true,
            },
            token,
            PlanData.IdempotencyKey());

    /// <summary>Pending request detail as Owner; skips when the configured request was already decided.</summary>
    public static async Task<JsonElement> PendingRequestAsync(PlanApi api, string ownerToken, string requestId, string variable)
    {
        var request = await GetOkAsync(api, $"api/v1/invoice-adjustments/{requestId}", ownerToken, "Owner reads the request");
        Skip.If(request.Str("status") != "Pending", $"{variable} is no longer Pending ({request.Str("status")}); prepare a new pending request.");
        return request;
    }

    /// <summary>A charge to correct (the request's own charge, else the first invoice line) and a corrected amount 1 000 VND lower.</summary>
    public static (string? ChargeCode, string Corrected) Correction(JsonElement request)
    {
        var chargeCode = request.Str("chargeCode");
        var lines = request.Find("currentInvoice.lines")?.EnumerateArray().ToList() ?? [];
        var line = chargeCode is null ? lines.FirstOrDefault() : lines.FirstOrDefault(l => l.Str("chargeCode") == chargeCode);
        chargeCode ??= line.ValueKind == JsonValueKind.Object ? line.Str("chargeCode") : null;
        var current = Dec(request.Str("currentChargeAmount") ?? (line.ValueKind == JsonValueKind.Object ? line.Str("amount") : request.Str("currentInvoice.total")));
        return (chargeCode, Vnd(Math.Max(current - 1000, 0)));
    }
}
