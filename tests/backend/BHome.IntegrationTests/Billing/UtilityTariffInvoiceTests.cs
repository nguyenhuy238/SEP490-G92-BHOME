using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Billing;

public sealed partial class InvoiceApiTests
{
    // Invoked by the Compact24 wrapper; this feature deliberately does not target the legacy source schema.
    internal async Task BoundChargesIgnoreNewRoomPricesAndRejectMissingSnapshot()
    {
        var w = await Setup(includeService: true); await ConfirmUtilities(w);
        var tariff = await Success<SetupDocument>(await w.Owner.Client.PostAsJsonAsync("/api/v1/utility-tariffs", new UtilityTariffWrite(w.Location, UtilityType.Electricity, w.Period, null,
            "Synthetic supplier", "Synthetic selected classification", "Synthetic source reference", [new(10, 1000), new(null, 2000)], VndRounding.AwayFromZero, true)));
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync("/api/v1/utility-profiles", new UtilityProfileWrite(w.Location, w.Room, UtilityType.Electricity, tariff.Id, w.Period, null, true, false))).StatusCode);
        var draft = await Draft(w); Assert.Empty(draft.MissingInputs); Assert.Equal(3219250m, draft.Total);
        var path = $"/api/v1/invoices/{draft.Id}";
        // Simulate independently versioned property prices, including a new fee,
        // without using the guarded pricing API. The stored signed terms win.
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var policies = await db.Set<BillingPolicy>().AsNoTracking().Where(p => p.LocationId == w.Location).ToArrayAsync();
            foreach (var p in policies) db.Add(new BillingPolicy { LocationId = w.Location, RoomId = w.Room, ChargeCode = p.ChargeCode,
                Category = p.Category, Name = p.Name + " new", Method = p.Method, Rate = p.Rate * 2, EffectiveFrom = w.Period });
            db.Add(new BillingPolicy { LocationId = w.Location, RoomId = w.Room, ChargeCode = "PARKING", Name = "New fee", Category = ChargeCategory.ServiceFee,
                Method = ChargingMethod.FixedPerRoomPerMonth, Rate = 50000, EffectiveFrom = w.Period });
            await db.SaveChangesAsync();
        }
        var ready = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{draft.Id}/refresh", new InvoiceFinalizeInput(draft.Version)));
        Assert.Empty(ready.MissingInputs); Assert.Equal(draft.Total, ready.Total);
        Assert.Equal(3000000m, ready.Lines.Single(l => l.ChargeCode == "RENT").Rate);
        Assert.Equal(3500m, ready.Lines.Single(l => l.ChargeCode == "ELECTRICITY").Rate);
        Assert.Equal(15000m, ready.Lines.Single(l => l.ChargeCode == "WATER").Rate);
        Assert.Equal(100000m, ready.Lines.Single(l => l.ChargeCode == "INTERNET").Rate);
        Assert.DoesNotContain(ready.Lines, l => l.ChargeCode == "PARKING");
        await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync(path + "/finalize", new InvoiceFinalizeInput(ready.Version)));
        var original = await w.Owner.Client.GetStringAsync(path);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            foreach (var c in await db.Set<Contract>().Where(c => c.RoomId == w.Room).ToArrayAsync()) c.AgreedPriceSnapshot = "{}";
            await db.SaveChangesAsync();
        }
        var legacy = await Success<InvoiceView>(await w.Owner.Client.PostAsJsonAsync("/api/v1/invoices/drafts", new DraftInvoiceInput(w.Room, w.Period.AddMonths(-1), w.Contract)));
        Assert.Contains("contract_price_snapshot_missing", legacy.MissingInputs); Assert.Empty(legacy.Lines);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.Client.PostAsJsonAsync($"/api/v1/invoices/{legacy.Id}/finalize", new InvoiceFinalizeInput(legacy.Version))).StatusCode);
        Assert.Equal(original, await w.Owner.Client.GetStringAsync(path));
    }
}
