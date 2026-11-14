using System.Net;
using System.Text.Json;
using static BHome.PlanIntegrationTests.BF06PaymentDebt.PaymentFlow;

namespace BHome.PlanIntegrationTests.BF06PaymentDebt;

/// <summary>
/// Sheet "BF-06 Payment Debt" (UC-22 reconcile bank payment, UC-23/25 debt and history, UC-24 invoice adjustment).
/// Steps and expected results come from the plan; routes/bodies from docs/api/PAYMENTS.md, INVOICE_ADJUSTMENTS.md and
/// the Postman collection. Environment variables and extra accounts: see <see cref="PaymentFlow"/>.
/// </summary>
[Collection(PlanCollection.Name)]
[Trait("Sheet", "BF-06 Payment Debt")]
public sealed class PaymentDebtTests(PlanSessions sessions)
{
    private readonly PlanApi _api = sessions.Api;

    [SkippableFact(DisplayName = "ITC-BF06-001 Test registering a transfer and allocating it to an invoice.")]
    [Trait("TestCase", "ITC-BF06-001")]
    public async Task ITC_BF06_001()
    {
        var invoiceId = Env("BHOME_IT_BF06_PAY_INVOICE_ID", "a Final unpaid invoice of the Room of 'tenant'");
        var owner = await sessions.TokenAsync("owner");
        var payer = (await sessions.SessionAsync("tenant")).UserId;
        var payment = await UnpaidAsync(_api, owner, invoiceId, "BHOME_IT_BF06_PAY_INVOICE_ID");

        // 1. Sign in as Owner and register a bank transfer.
        var transferId = await RegisterOkAsync(_api, owner, payment.Str("outstandingAmount")!, payment.Str("transferReference")!, invoiceId, "step 1 register");

        // 2. Allocate it to the invoice.
        await PlanAssert.SuccessAsync(await AllocateAsync(_api, owner, transferId, invoiceId, payer), "step 2 allocate");

        // 3. Register another transfer that does not match and reject it.
        var unmatchedId = await RegisterOkAsync(_api, owner, "100000", "IT UNMATCHED " + Guid.NewGuid().ToString("N")[..8], null, "step 3 register unmatched");
        var reason = "IT synthetic unmatched statement " + Guid.NewGuid().ToString("N")[..8];
        await PlanAssert.SuccessAsync(
            await _api.PostAsync($"api/v1/payment-transactions/{unmatchedId}/reject", new { reason }, owner, PlanData.IdempotencyKey()),
            "step 3 reject");

        // The matched transfer is recorded as a verified payment with the reconciliation history.
        var after = await PaymentAsync(_api, owner, invoiceId);
        Assert.Equal("Paid", after.Str("paymentStatus"));
        Assert.Contains(after.Find("history")?.EnumerateArray().ToList() ?? [], h => Dec(h.Str("amount")) == Dec(payment.Str("outstandingAmount")));
        var history = await GetOkAsync(_api, $"api/v1/payment-transactions/{transferId}/reconciliation-history?page=1&pageSize=20", owner, "matched history");
        Assert.NotEmpty(history.Items());

        // The unmatched transfer is rejected and the history keeps the reason.
        var rejected = await GetOkAsync(_api, $"api/v1/payment-transactions/{unmatchedId}/reconciliation-history?page=1&pageSize=20", owner, "unmatched history");
        Assert.Contains(rejected.AllStrings(), s => s.Contains(reason, StringComparison.Ordinal));
        await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/payment-transactions/{unmatchedId}", owner), "rejected transfer is kept");
    }

    [SkippableFact(DisplayName = "ITC-BF06-002 Test a full payment of a shared invoice.")]
    [Trait("TestCase", "ITC-BF06-002")]
    public async Task ITC_BF06_002()
    {
        var invoiceId = Env("BHOME_IT_BF06_SHARED_INVOICE_ID", "a Final unpaid invoice whose recipients include 'tenant' and 'tenant2'");
        var owner = await sessions.TokenAsync("owner");
        var tenant = await sessions.TokenAsync("tenant");
        var tenant2 = await sessions.TokenAsync("tenant2");
        var payment = await UnpaidAsync(_api, owner, invoiceId, "BHOME_IT_BF06_SHARED_INVOICE_ID");
        var issued = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Final before payment");
        var transferId = await RegisterOkAsync(_api, owner, payment.Str("outstandingAmount")!, payment.Str("transferReference")!, invoiceId, "register full amount");
        var key = Guid.NewGuid().ToString();

        // 1. Allocate the full amount.
        await PlanAssert.SuccessAsync(await AllocateAsync(_api, owner, transferId, invoiceId, null, key), "step 1 allocate");
        var paid = await PaymentAsync(_api, owner, invoiceId);

        // 2. Send the same allocation again.
        using (await AllocateAsync(_api, owner, transferId, invoiceId, null, key))
        {
        }

        // The repeated request has no effect and the final invoice is not changed.
        var again = await PaymentAsync(_api, owner, invoiceId);
        Assert.Equal(paid.Find("history")?.GetArrayLength(), again.Find("history")?.GetArrayLength());
        Assert.Equal(1, again.Find("history")?.GetArrayLength());
        Assert.Equal(Dec(paid.Str("paidAmount")), Dec(again.Str("paidAmount")));
        var final = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Final after payment");
        Assert.Equal(issued.Str("status"), final.Str("status"));
        Assert.Equal(issued.Str("version"), final.Str("version"));
        Assert.Equal(Dec(issued.Str("total")), Dec(final.Str("total")));

        // 3. Open the invoice as the other Tenants of the Room.  The invoice is Paid once and for all Tenants of the Room.
        Assert.Equal("Paid", again.Str("paymentStatus"));
        foreach (var token in new[] { tenant, tenant2 })
        {
            var view = await PaymentAsync(_api, token, invoiceId, "Tenant reads the shared invoice");
            Assert.Equal("Paid", view.Str("paymentStatus"));
            Assert.Equal(0m, Dec(view.Str("outstandingAmount")));
            Assert.Equal(1, view.Find("history")?.GetArrayLength());
        }
    }

    [SkippableFact(DisplayName = "ITC-BF06-003 Test two Tenants paying at the same time.")]
    [Trait("TestCase", "ITC-BF06-003")]
    public async Task ITC_BF06_003()
    {
        var invoiceId = Env("BHOME_IT_BF06_CONCURRENT_INVOICE_ID", "a Final unpaid invoice whose recipients include 'tenant' and 'tenant2'");
        var owner = await sessions.TokenAsync("owner");
        var payerA = (await sessions.SessionAsync("tenant")).UserId;
        var payerB = (await sessions.SessionAsync("tenant2")).UserId;
        var payment = await UnpaidAsync(_api, owner, invoiceId, "BHOME_IT_BF06_CONCURRENT_INVOICE_ID");
        var amount = payment.Str("outstandingAmount")!;
        var transferA = await RegisterOkAsync(_api, owner, amount, payment.Str("transferReference")!, invoiceId, "register transfer of tenant");
        var transferB = await RegisterOkAsync(_api, owner, amount, payment.Str("transferReference")!, invoiceId, "register transfer of tenant2");

        // 1. Two Tenants of the same Room pay the same invoice together.
        var results = await Task.WhenAll(
            AllocateAsync(_api, owner, transferA, invoiceId, payerA),
            AllocateAsync(_api, owner, transferB, invoiceId, payerB));
        foreach (var r in results)
        {
            Assert.True((int)r.StatusCode < 500, $"unexpected {(int)r.StatusCode}: {await r.TextAsync()}");
        }

        // The invoice is settled only once.
        var after = await PaymentAsync(_api, owner, invoiceId);
        Assert.Equal("Paid", after.Str("paymentStatus"));
        Assert.Equal(1, after.Find("history")?.GetArrayLength());
        Assert.Equal(Dec(after.Str("payableAmount")), Dec(after.Str("paidAmount")));

        // The second transfer is kept for Owner review (not allocated, still listed with its money).
        var views = new[]
        {
            await GetOkAsync(_api, $"api/v1/payment-transactions/{transferA}", owner, "transfer A"),
            await GetOkAsync(_api, $"api/v1/payment-transactions/{transferB}", owner, "transfer B"),
        };
        Assert.Single(views, v => Dec(v.Str("allocatedAmount")) > 0);
        Assert.Single(views, v => Dec(v.Str("allocatedAmount")) == 0 && Dec(v.Str("unallocatedAmount")) == Dec(amount));
    }

    [SkippableFact(DisplayName = "ITC-BF06-004 Test that a deposit reference and an invoice reference are not mixed.")]
    [Trait("TestCase", "ITC-BF06-004")]
    public async Task ITC_BF06_004()
    {
        var invoiceId = Env("BHOME_IT_BF06_INVOICE_ID", "a Final unpaid invoice");
        var depositReference = Env("BHOME_IT_BF06_DEPOSIT_REFERENCE", "the bank reference of a verified contract deposit");
        var invoiceReference = Env("BHOME_IT_BF06_INVOICE_BANK_REFERENCE", "a bank reference already allocated to an invoice payment");
        var contractId = Env("BHOME_IT_BF06_DEPOSIT_CONTRACT_ID", "a contract still waiting for its deposit verification");
        var depositAmount = Env("BHOME_IT_BF06_DEPOSIT_AMOUNT", "the required deposit of that contract (decimal string VND)");
        var owner = await sessions.TokenAsync("owner");
        var payment = await UnpaidAsync(_api, owner, invoiceId, "BHOME_IT_BF06_INVOICE_ID");

        // 1. Use a deposit bank reference to pay an invoice.  Refused (at registration, or else at allocation).
        using var register = await RegisterAsync(_api, owner, payment.Str("outstandingAmount")!, payment.Str("transferReference")!, invoiceId, depositReference);
        if (register.IsSuccessStatusCode)
        {
            var transferId = (await register.JsonAsync()).Str("id")!;
            await PlanAssert.RefusedAsync(await AllocateAsync(_api, owner, transferId, invoiceId, null), "step 1 allocate with a deposit reference");
        }
        else
        {
            await PlanAssert.RefusedAsync(register, "step 1 register with a deposit reference");
        }

        var still = await PaymentAsync(_api, owner, invoiceId);
        Assert.Equal(Dec(payment.Str("paidAmount")), Dec(still.Str("paidAmount")));

        // 2. Use an invoice bank reference to pay a deposit.  Refused.
        await PlanAssert.RefusedAsync(
            await _api.PostAsync(
                $"api/v1/contracts/{contractId}/deposit-verifications",
                new { bankTransactionReference = invoiceReference, amount = depositAmount, verificationReason = "SYNTHETIC IT - invoice reference reused" },
                owner,
                PlanData.IdempotencyKey()),
            "step 2 deposit with an invoice reference");
    }

    [SkippableFact(DisplayName = "ITC-BF06-005 Test invalid or unauthorized payment requests.")]
    [Trait("TestCase", "ITC-BF06-005")]
    public async Task ITC_BF06_005()
    {
        var invoiceId = Env("BHOME_IT_BF06_INVOICE_ID", "a Final unpaid invoice of the Room of 'tenant'");
        var owner = await sessions.TokenAsync("owner");
        var tenant = await sessions.TokenAsync("tenant");
        var payment = await UnpaidAsync(_api, owner, invoiceId, "BHOME_IT_BF06_INVOICE_ID");
        var amount = payment.Str("outstandingAmount")!;
        var reference = payment.Str("transferReference")!;

        // 1. Register a transfer as a Tenant.
        await PlanAssert.RefusedAsync(await RegisterAsync(_api, tenant, amount, reference, invoiceId), "step 1 Tenant registers");

        // 2. Allocate with an invalid or conflicting amount.
        await PlanAssert.RefusedAsync(await RegisterAsync(_api, owner, "-" + amount, reference, invoiceId), "step 2 negative amount");
        await PlanAssert.RefusedAsync(await RegisterAsync(_api, owner, "0", reference, invoiceId), "step 2 zero amount");
        await PlanAssert.RefusedAsync(await RegisterAsync(_api, owner, "abc", reference, invoiceId), "step 2 non-numeric amount");
        var key = Guid.NewGuid().ToString();
        var bankReference = "IT" + Guid.NewGuid().ToString("N")[..16].ToUpperInvariant();
        var registered = Parse(await PlanAssert.SuccessAsync(
            await RegisterAsync(_api, owner, "1000", "IT CONFLICT " + bankReference, null, bankReference, key), "register a small unmatched transfer"));
        await PlanAssert.RefusedAsync(await RegisterAsync(_api, owner, "2000", "IT CONFLICT " + bankReference, null, bankReference, key), "step 2 same key, other amount");
        await PlanAssert.RefusedAsync(await AllocateAsync(_api, owner, registered.Str("id")!, invoiceId, null), "step 2 allocate a transfer that does not match");

        // The requests are refused and no paid state is created.
        var after = await PaymentAsync(_api, owner, invoiceId);
        Assert.NotEqual("Paid", after.Str("paymentStatus"));
        Assert.Equal(Dec(payment.Str("paidAmount")), Dec(after.Str("paidAmount")));
        Assert.Equal(payment.Find("history")?.GetArrayLength(), after.Find("history")?.GetArrayLength());
    }

    [SkippableFact(DisplayName = "ITC-BF06-006 Test the debt list and the payment history by role.")]
    [Trait("TestCase", "ITC-BF06-006")]
    public async Task ITC_BF06_006()
    {
        var locationId = Env("BHOME_IT_BF06_LOCATION_ID", "a Location assigned to 'staff' (not to 'staff2') with paid and unpaid Final invoices");
        var paidInvoiceId = Env("BHOME_IT_BF06_PAID_INVOICE_ID", "a paid Final invoice of that Location shared by several Tenants");
        var owner = await sessions.TokenAsync("owner");
        var staff = await sessions.TokenAsync("staff");
        var staff2 = await sessions.TokenAsync("staff2");
        var tenant = await sessions.TokenAsync("tenant");

        // 1. Open the debt list as Owner and filter it.
        var debts = (await GetOkAsync(_api, $"api/v1/debts?locationId={locationId}&page=1&pageSize=100", owner, "step 1 Owner debts")).Items();
        var overdue = (await GetOkAsync(_api, $"api/v1/debts?locationId={locationId}&overdueOnly=true&page=1&pageSize=100", owner, "step 1 overdue filter")).Items();

        // A shared invoice is counted once. Paid invoices are removed from the debt.
        Assert.NotEmpty(debts);
        Assert.Equal(debts.Count, debts.Select(d => d.Str("invoiceId")).Distinct().Count());
        Assert.Equal(debts.Count, debts.Select(d => $"{d.Str("roomId")}|{d.Str("billingPeriod")}").Distinct().Count());
        Assert.DoesNotContain(debts, d => d.Str("invoiceId") == paidInvoiceId);
        Assert.All(debts, d => Assert.True(Dec(d.Str("outstandingAmount")) > 0, $"Debt without outstanding amount: {d}"));
        Assert.All(overdue, d => Assert.True(Dec(d.Str("outstandingAmount")) > 0 && Int(d, "overdueDays") > 0, $"Not an overdue debt: {d}"));
        Assert.All(debts, d => Assert.Equal(locationId, d.Str("locationId"), StringComparer.OrdinalIgnoreCase));

        // 2. Open it as Staff of the Location and as Staff of another Location.  Staff only sees the assigned Location.
        var staffDebts = (await GetOkAsync(_api, $"api/v1/debts?locationId={locationId}&page=1&pageSize=100", staff, "step 2 Staff of the Location")).Items();
        Assert.Equal(debts.Select(d => d.Str("invoiceId")).OrderBy(i => i), staffDebts.Select(d => d.Str("invoiceId")).OrderBy(i => i));
        using (var other = await _api.GetAsync($"api/v1/debts?locationId={locationId}&page=1&pageSize=100", staff2))
        {
            if (other.IsSuccessStatusCode)
            {
                Assert.Empty((await other.JsonAsync()).Items());
            }
            else
            {
                await PlanAssert.RefusedAsync(other, "step 2 Staff of another Location");
            }
        }

        var staff2All = (await GetOkAsync(_api, "api/v1/debts?page=1&pageSize=100", staff2, "Staff of another Location, no filter")).Items();
        Assert.DoesNotContain(staff2All, d => string.Equals(d.Str("locationId"), locationId, StringComparison.OrdinalIgnoreCase));

        // 3. Open the history as a Tenant.  A Tenant only sees their own.
        var history = (await GetOkAsync(_api, "api/v1/payment-history?page=1&pageSize=100", tenant, "step 3 Tenant history")).Items();
        foreach (var item in history)
        {
            Assert.Null(item.Str("bankReference"));
            Assert.Null(item.Str("verifiedByUserId"));
            await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/invoices/{item.Str("invoiceId")}", tenant), $"Tenant owns invoice {item.Str("invoiceId")}");
        }
    }

    [SkippableFact(DisplayName = "ITC-BF06-007 Test a Staff who is also a Tenant.")]
    [Trait("TestCase", "ITC-BF06-007")]
    public async Task ITC_BF06_007()
    {
        var user = await sessions.TokenAsync("stafftenant");

        // 1. Open the debt as a user who is Staff and also a Tenant of a Room.
        var debts = (await GetOkAsync(_api, "api/v1/debts?page=1&pageSize=100", user, "step 1 debts")).Items();
        Skip.If(debts.Count == 0, "Account 'stafftenant' sees no debt; prepare unpaid Final invoices in its Location and its own Room.");

        // The user does not see the full financial details outside their own entitlement.
        foreach (var debt in debts)
        {
            using var own = await _api.GetAsync($"api/v1/invoices/{debt.Str("invoiceId")}", user);
            if (own.StatusCode != HttpStatusCode.OK)
            {
                Assert.True(debt.Str("payableAmount") is null && debt.Str("paidAmount") is null, $"Full amounts leaked outside the Tenant entitlement: {debt}");
            }
        }

        using var history = await _api.GetAsync("api/v1/payment-history?page=1&pageSize=100", user);
        if (history.IsSuccessStatusCode)
        {
            foreach (var item in (await history.JsonAsync()).Items())
            {
                await PlanAssert.SuccessAsync(await _api.GetAsync($"api/v1/invoices/{item.Str("invoiceId")}", user), $"history only for own invoice {item.Str("invoiceId")}");
            }
        }
    }

    [Fact(DisplayName = "ITC-BF06-008 Test the overdue reminder job (JOB-01).", Skip = PlanSkip.ServerClock + " JOB-01 also has no documented trigger route (" + PlanSkip.BackgroundJob + ")")]
    [Trait("TestCase", "ITC-BF06-008")]
    public void ITC_BF06_008()
    {
        // 1. Move the date after the due date.  2. Run the overdue reminder job twice.
        // Expected: one reminder is sent to the Tenant for each overdue invoice and no duplicate is created.
    }

    [SkippableFact(DisplayName = "ITC-BF06-009 Test submitting an adjustment request with evidence.")]
    [Trait("TestCase", "ITC-BF06-009")]
    public async Task ITC_BF06_009()
    {
        var invoiceId = Env("BHOME_IT_BF06_ADJ_INVOICE_ID", "an invoice whose recipients include 'tenant' and 'tenant2'");
        var owner = await sessions.TokenAsync("owner");
        var tenant = await sessions.TokenAsync("tenant");
        var tenant2 = await sessions.TokenAsync("tenant2");
        var staff = await sessions.TokenAsync("staff");

        // 1. Sign in as Tenant and open the invoice.
        var invoice = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", tenant, "step 1 open invoice");

        // 3. Upload the evidence (the API links uploaded evidence ids in the request, so it is uploaded first).
        var evidence = Parse(await PlanAssert.SuccessAsync(
            await _api.SendBytesAsync(HttpMethod.Put, $"api/v1/invoices/{invoiceId}/adjustment-evidence", PlanData.TinyPng, "image/png", tenant), "step 3 upload evidence"));
        var evidenceId = evidence.Str("id")!;

        // 2. Submit a request with a reason (sent twice with the same key).
        var key = Guid.NewGuid().ToString();
        object Submit(string id) => new { invoiceLineId = (string?)null, proposedAmount = (string?)null, reason = "IT synthetic adjustment reason", evidenceIds = new[] { id }, expectedInvoiceVersion = Int(invoice, "version") };
        var first = Parse(await PlanAssert.SuccessAsync(await _api.PostAsync($"api/v1/invoices/{invoiceId}/adjustment-requests", Submit(evidenceId), tenant, PlanData.IdempotencyKey(key)), "step 2 submit"));
        var requestId = first.Str("id")!;
        using (await _api.PostAsync($"api/v1/invoices/{invoiceId}/adjustment-requests", Submit(evidenceId), tenant, PlanData.IdempotencyKey(key)))
        {
        }

        // The request is saved once.
        var mine = (await GetOkAsync(_api, $"api/v1/invoice-adjustments?invoiceId={invoiceId}&page=1&pageSize=100", tenant, "Tenant requests")).Items();
        Assert.Single(mine, r => r.Str("id") == requestId);
        Assert.Single(mine, r => r.Find("evidence")?.EnumerateArray().Any(e => e.Str("id") == evidenceId) == true);

        // 4. Open the request as another user.  The evidence is private: only the requester and the Owner can open it.
        var evidencePath = $"api/v1/invoice-adjustments/{requestId}/evidence/{evidenceId}";
        await PlanAssert.SuccessAsync(await _api.GetAsync(evidencePath, tenant), "requester opens evidence");
        await PlanAssert.SuccessAsync(await _api.GetAsync(evidencePath, owner), "Owner opens evidence");
        await PlanAssert.RefusedAsync(await _api.GetAsync(evidencePath, tenant2), "co-Tenant opens evidence");
        await PlanAssert.RefusedAsync(await _api.GetAsync($"api/v1/invoice-adjustments/{requestId}", tenant2), "co-Tenant opens request");
        await PlanAssert.RefusedAsync(await _api.GetAsync(evidencePath, staff), "Staff opens evidence");
        await PlanAssert.RefusedAsync(await _api.GetAsync(evidencePath), "anonymous opens evidence");

        // The same evidence cannot be reused by another request.
        await PlanAssert.RefusedAsync(
            await _api.PostAsync($"api/v1/invoices/{invoiceId}/adjustment-requests", Submit(evidenceId), tenant, PlanData.IdempotencyKey()),
            "reuse evidence in another request");
    }

    [SkippableFact(DisplayName = "ITC-BF06-010 Test approving a correction on a Draft invoice.")]
    [Trait("TestCase", "ITC-BF06-010")]
    public async Task ITC_BF06_010()
    {
        var requestId = Env("BHOME_IT_BF06_DRAFT_ADJUSTMENT_ID", "a pending request on a complete Draft invoice whose Final date has arrived");
        var owner = await sessions.TokenAsync("owner");
        var request = await PendingRequestAsync(_api, owner, requestId, "BHOME_IT_BF06_DRAFT_ADJUSTMENT_ID");
        Skip.If(request.Str("currentInvoice.status") != "Draft", "The invoice of BHOME_IT_BF06_DRAFT_ADJUSTMENT_ID is not a Draft.");
        var invoiceId = request.Str("invoiceId")!;
        var (chargeCode, corrected) = Correction(request);

        // 1. Owner approves a request for a Draft invoice.
        await PlanAssert.SuccessAsync(await DecideAsync(_api, owner, request, "approve", corrected, chargeCode, "IT synthetic Draft correction"), "step 1 approve");
        AssertCorrected(await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft after approval"), "after approval");

        // 2. Refresh the Draft.
        var draft = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft version");
        await PlanAssert.SuccessAsync(await _api.PostAsync($"api/v1/invoices/{invoiceId}/refresh", new { expectedVersion = Int(draft, "version") }, owner), "step 2 refresh");
        var refreshed = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Draft after refresh");
        AssertCorrected(refreshed, "after refresh");

        // 3. Finalize it.
        await PlanAssert.SuccessAsync(await _api.PostAsync($"api/v1/invoices/{invoiceId}/finalize", new { expectedVersion = Int(refreshed, "version") }, owner), "step 3 finalize");

        // The correction stays in the Draft after the refresh and after the finalization, with the source trace.
        var final = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Final");
        Assert.Equal("Final", final.Str("status"));
        AssertCorrected(final, "after finalization");

        void AssertCorrected(JsonElement invoice, string step)
        {
            var line = invoice.Find("lines")?.EnumerateArray().FirstOrDefault(l => l.Str("chargeCode") == chargeCode);
            Assert.True(line is { ValueKind: JsonValueKind.Object }, $"{step}: no line {chargeCode}. Invoice: {invoice}");
            Assert.Equal(Dec(corrected), Dec(line!.Value.Str("amount")));
            Assert.Equal(requestId, line.Value.Str("correctionRequestId"), StringComparer.OrdinalIgnoreCase);
        }
    }

    [SkippableFact(DisplayName = "ITC-BF06-011 Test approving and rejecting at the same time.")]
    [Trait("TestCase", "ITC-BF06-011")]
    public async Task ITC_BF06_011()
    {
        var requestId = Env("BHOME_IT_BF06_PENDING_ADJUSTMENT_ID", "a pending adjustment request");
        var owner = await sessions.TokenAsync("owner");
        var request = await PendingRequestAsync(_api, owner, requestId, "BHOME_IT_BF06_PENDING_ADJUSTMENT_ID");
        var (chargeCode, corrected) = Correction(request);

        // 1. Approve and reject the same request at the same moment.
        var answers = await Task.WhenAll(
            DecideAsync(_api, owner, request, "approve", corrected, chargeCode, "IT synthetic concurrent approval"),
            DecideAsync(_api, owner, request, "reject", null, null, "IT synthetic concurrent rejection"));

        // Only one decision is saved.
        Assert.Single(answers, a => a.IsSuccessStatusCode);
        foreach (var a in answers.Where(a => !a.IsSuccessStatusCode))
        {
            await PlanAssert.RefusedAsync(a, "losing decision");
        }

        var after = await GetOkAsync(_api, $"api/v1/invoice-adjustments/{requestId}", owner, "request after decisions");
        Assert.Contains(after.Str("status"), new[] { "Approved", "Rejected" });
        Assert.Equal(2, Int(after, "version"));
        Assert.True(after.Find("decision") is { ValueKind: JsonValueKind.Object }, $"No saved decision: {after}");
    }

    [SkippableFact(DisplayName = "ITC-BF06-012 Test an adjustment on a final invoice and a payment at the same time.")]
    [Trait("TestCase", "ITC-BF06-012")]
    public async Task ITC_BF06_012()
    {
        var requestId = Env("BHOME_IT_BF06_FINAL_ADJUSTMENT_ID", "a pending request on a Final unpaid invoice");
        var owner = await sessions.TokenAsync("owner");
        var request = await PendingRequestAsync(_api, owner, requestId, "BHOME_IT_BF06_FINAL_ADJUSTMENT_ID");
        var invoiceId = request.Str("invoiceId")!;
        var payment = await UnpaidAsync(_api, owner, invoiceId, "the invoice of BHOME_IT_BF06_FINAL_ADJUSTMENT_ID");
        var issued = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Final before");
        var (chargeCode, corrected) = Correction(request);
        var amount = payment.Str("outstandingAmount")!;
        var transferId = await RegisterOkAsync(_api, owner, amount, payment.Str("transferReference")!, invoiceId, "register transfer");

        // 1. Approve an adjustment for a final invoice.  2. Pay the invoice at the same time.
        var answers = await Task.WhenAll(
            DecideAsync(_api, owner, request, "approve", corrected, chargeCode, "IT synthetic Final adjustment"),
            AllocateAsync(_api, owner, transferId, invoiceId, null));
        await PlanAssert.SuccessAsync(answers[0], "step 1 approve");
        await PlanAssert.SuccessAsync(answers[1], "step 2 pay");

        // A separate adjustment effect is created and the final invoice is not edited.
        var effects = (await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}/adjustments?page=1&pageSize=20", owner, "adjustment effects")).Items();
        Assert.NotEmpty(effects);
        var final = await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}", owner, "Final after");
        Assert.Equal("Final", final.Str("status"));
        Assert.Equal(issued.Str("version"), final.Str("version"));
        Assert.Equal(Dec(issued.Str("total")), Dec(final.Str("total")));

        // The balance uses one financial basis and no incoming money is lost.
        var after = await PaymentAsync(_api, owner, invoiceId);
        var payable = Dec(after.Str("payableAmount"));
        var paid = Dec(after.Str("paidAmount"));
        Assert.Equal(Dec(after.Str("originalIssuedAmount")) + Dec(after.Str("approvedAdjustmentTotal")), payable);
        Assert.Equal(Math.Max(payable - paid, 0), Dec(after.Str("outstandingAmount")));
        Assert.Equal(Math.Max(paid - payable, 0), Dec(after.Str("potentialExcessAmount")));
        var transfer = await GetOkAsync(_api, $"api/v1/payment-transactions/{transferId}", owner, "transfer after");
        Assert.Equal(Dec(amount), Dec(transfer.Str("allocatedAmount")) + Dec(transfer.Str("unallocatedAmount")));
        Assert.Equal(Dec(transfer.Str("allocatedAmount")), paid - Dec(payment.Str("paidAmount")));
    }

    [SkippableFact(DisplayName = "ITC-BF06-013 Test rejecting a request.")]
    [Trait("TestCase", "ITC-BF06-013")]
    public async Task ITC_BF06_013()
    {
        var requestId = Env("BHOME_IT_BF06_REJECT_ADJUSTMENT_ID", "a pending request on a Final invoice");
        var owner = await sessions.TokenAsync("owner");
        var request = await PendingRequestAsync(_api, owner, requestId, "BHOME_IT_BF06_REJECT_ADJUSTMENT_ID");
        var invoiceId = request.Str("invoiceId")!;
        var before = await PaymentAsync(_api, owner, invoiceId);
        var effectsBefore = (await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}/adjustments?page=1&pageSize=100", owner, "effects before")).Items().Count;

        // 1. Owner rejects the request with a reason.
        await PlanAssert.SuccessAsync(await DecideAsync(_api, owner, request, "reject", null, null, "IT synthetic rejection - review completed"), "step 1 reject");

        // 2. Check the invoice balance.  The rejection has no financial effect.
        var after = await PaymentAsync(_api, owner, invoiceId);
        foreach (var field in new[] { "payableAmount", "paidAmount", "outstandingAmount", "approvedAdjustmentTotal" })
        {
            Assert.Equal(Dec(before.Str(field)), Dec(after.Str(field)));
        }

        Assert.Equal(before.Str("financialVersion"), after.Str("financialVersion"));
        Assert.Equal(effectsBefore, (await GetOkAsync(_api, $"api/v1/invoices/{invoiceId}/adjustments?page=1&pageSize=100", owner, "effects after")).Items().Count);

        // A request that needs a new review is not applied by mistake (a later approval of the rejected request is refused).
        var (chargeCode, corrected) = Correction(request);
        await PlanAssert.RefusedAsync(await DecideAsync(_api, owner, request, "approve", corrected, chargeCode, "IT approval after rejection"), "approve after rejection");
        var still = await PaymentAsync(_api, owner, invoiceId);
        Assert.Equal(Dec(before.Str("payableAmount")), Dec(still.Str("payableAmount")));
        Assert.Equal("Rejected", (await GetOkAsync(_api, $"api/v1/invoice-adjustments/{requestId}", owner, "request after")).Str("status"));
    }
}
