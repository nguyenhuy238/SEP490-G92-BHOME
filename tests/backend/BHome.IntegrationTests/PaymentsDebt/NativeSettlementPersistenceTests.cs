using BHome.Application.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.IntegrationTests.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

[Trait("Category", "CompactPostgres")]
public sealed class NativeSettlementPersistenceTests(Compact24WorkflowFixture fixture) : IClassFixture<Compact24WorkflowFixture>
{
    [CompactPostgresFact]
    public Task SettlementReferenceRetainsJsonbRepresentation() =>
        new PaymentLedgerTests(fixture.Capture).SettlementReferenceRetainsJsonbRepresentation();
}

public sealed partial class PaymentLedgerTests
{
    internal async Task SettlementReferenceRetainsJsonbRepresentation()
    {
        var (workspace, _, _) = await DamageFixture();
        using var owner = await Client(workspace.Owner);
        var route = $"/api/v1/contracts/{workspace.Contract}/move-out/receivables";
        var original = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));

        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        // Persist the exact same inspection content with different whitespace.
        // Legacy readers cast the embedded snapshot string to jsonb before hashing.
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET move_out=jsonb_set(move_out,ARRAY['inspections'],
                (SELECT jsonb_agg(jsonb_set(e,ARRAY['observedSnapshot'],
                    to_jsonb(jsonb_pretty((e->>'observedSnapshot')::jsonb))) ORDER BY n)
                FROM jsonb_array_elements(move_out->'inspections') WITH ORDINALITY a(e,n)))
            WHERE id={workspace.Contract}
            """);
        Assert.Equal(1, affected);

        var repeated = await RefundValue<SettlementReceivablesView>(await owner.GetAsync(route));
        Assert.Equal(original.Reference, repeated.Reference);
        Assert.Equal(original.AvailableDeposit, repeated.AvailableDeposit);
    }
}
