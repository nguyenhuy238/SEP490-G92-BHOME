using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;

namespace BHome.IntegrationTests.Billing;

public sealed partial class InvoiceApiTests
{
    // Invoked by the Compact24 wrapper; this feature deliberately does not target the legacy source schema.
    internal async Task TieredUtilityAndQuotaAreUsedByInvoiceAndMissingQuotaBlocksFinalization()
    {
        var w = await Setup(); await ConfirmUtilities(w);
        var tariff = await Success<SetupDocument>(await w.Owner.Client.PostAsJsonAsync("/api/v1/utility-tariffs", new UtilityTariffWrite(w.Location, UtilityType.Electricity, w.Period, null,
            "Synthetic supplier", "Synthetic selected classification", "Synthetic source reference", [new(10, 1000), new(null, 2000)], VndRounding.AwayFromZero, true)));
        await Success<SetupDocument>(await w.Owner.Client.PostAsJsonAsync("/api/v1/utility-profiles", new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, tariff.Id, w.Period, null, true, false)));
        var draft = await Draft(w); Assert.Contains("utility_quota_verification_required", draft.MissingInputs);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(draft.Version))).StatusCode);
        await Success<SetupDocument>(await w.Owner.Client.PostAsJsonAsync("/api/v1/utility-quotas", new UtilityQuotaWrite(w.Location, w.Room, UtilityType.Electricity, w.Period, 5.5m, "Synthetic quota record", true)));
        var ready = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(draft.Version)));
        Assert.Empty(ready.MissingInputs); Assert.Equal(3060000, ready.Total);
        var electricity = Assert.Single(ready.Lines, l => l.Category == "Electricity"); Assert.Equal(30000, electricity.Amount); Assert.Contains(tariff.Id.ToString(), electricity.UtilityCalculationSnapshot!);
        await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/finalize", new InvoiceFinalizeInput(ready.Version)));
        var persisted = await w.Tenant.Client.GetFromJsonAsync<InvoiceView>($"/api/v1/invoices/{draft.Id}"); Assert.Equal(electricity.UtilityCalculationSnapshot, persisted!.Lines.Single(l => l.Category == "Electricity").UtilityCalculationSnapshot);
    }
}
