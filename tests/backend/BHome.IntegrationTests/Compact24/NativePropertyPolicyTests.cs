using System.Net;
using System.Net.Http.Json;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24OwnerSetupTests
{
    [CompactPostgresFact]
    public async Task NativePolicyWritesKeepHistoryLineageParametersAndInclusivePeriods()
    {
        var w = await Seed();
        using var owner = await Client(w.Owner);
        var input = new PolicyWrite(w.Location, null, ChargeCategory.ServiceFee, "NATIVE_POLICY",
            "Native 100% fee", ChargingMethod.FixedPerRoomPerMonth, 1000, Today.AddDays(2), null);
        const string route = "/api/v1/billing-policies";
        var first = await Read<PolicyDto>(await owner.PostAsJsonAsync(route, input));
        Assert.Equal(first.Id, first.FamilyId);
        Assert.Equal(1, first.Edition);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsJsonAsync(route, input)).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE billing_policies SET parameters=jsonb_build_object('legacyMarker',true) WHERE id={first.Id}
            """);
        var revisedInput = input with { Name = "Native 100% fee revised", Rate = 1500 };
        var revised = await Read<PolicyDto>(await owner.PutAsJsonAsync($"{route}/{first.Id}",
            new PolicyUpdate(revisedInput, first.Version)));
        Assert.Equal(first.Version + 1, revised.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync($"{route}/{first.Id}",
            new PolicyUpdate(revisedInput with { Rate = 1800 }, first.Version))).StatusCode);
        var cutover = Today.AddDays(5);
        var next = await Read<PolicyDto>(await owner.PostAsJsonAsync($"{route}/{first.Id}/replacement",
            new PolicyReplacement(revisedInput with { EffectiveFrom = cutover, Rate = 2000 }, revised.Version)));
        Assert.Equal(first.Id, next.FamilyId);
        Assert.Equal(first.Id, next.PreviousPolicyId);
        Assert.Equal(2, next.Edition);
        var old = await Read<PolicyDto>(await owner.GetAsync($"{route}/{first.Id}"));
        Assert.Equal(cutover.AddDays(-1), old.EffectiveTo);
        Assert.Equal(revised.Version + 1, old.Version);
        var page = await Read<PagedResult<PolicyDto>>(await owner.GetAsync(
            $"{route}?locationId={w.Location}&search=100%25&effectiveOn={cutover:yyyy-MM-dd}"));
        Assert.Equal(next.Id, Assert.Single(page.Items).Id);
        Assert.Equal(1, page.TotalCount);
        var oldPrices = await Read<ResolvedPrices>(await owner.GetAsync(
            $"/api/v1/rooms/{w.Room}/prices?effectiveOn={cutover.AddDays(-1):yyyy-MM-dd}"));
        var newPrices = await Read<ResolvedPrices>(await owner.GetAsync(
            $"/api/v1/rooms/{w.Room}/prices?effectiveOn={cutover:yyyy-MM-dd}"));
        Assert.Equal(first.Id, Assert.Single(oldPrices.Charges).Id);
        Assert.Equal(next.Id, Assert.Single(newPrices.Charges).Id);
        var ended = await Read<PolicyDto>(await owner.PostAsJsonAsync($"{route}/{next.Id}/end",
            new PolicyEnd(cutover.AddDays(2), next.Version, "Synthetic policy end")));
        Assert.Equal(cutover.AddDays(2), ended.EffectiveTo);
        Assert.True(await db.Database.SqlQuery<bool>($"""
            SELECT (jsonb_array_length(history)=3 AND parameters->>'legacyMarker'='true'
                AND history->0->>'recordType'='BillingPolicy'
                AND history->0->>'recordKey'=id::text AND history->0->'state'->>'name'='Native 100% fee'
                AND history->1->'state'->>'name'='Native 100% fee revised'
                AND history->2->'state'->>'effectiveTo'={cutover.AddDays(-1).ToString("yyyy-MM-dd")}
                AND (SELECT count(*) FROM notifications n WHERE n.related_entity_id=p.id AND n.record_kind='AUDIT'
                    AND n.event_data->>'recordType'='PropertyChange')=3) AS "Value"
            FROM billing_policies p WHERE id={first.Id}
            """).SingleAsync());
    }
}
