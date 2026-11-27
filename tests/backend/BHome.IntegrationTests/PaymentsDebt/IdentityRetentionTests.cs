using System.Net;
using BHome.Application.Operations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    internal async Task IdentityRetentionMetadataIsPrivateAuditedAndCannotEraseIdentity()
    {
        var w = await Setup(); using var owner = await Client(w.Owner); using var staff = await Client(w.Staff); using var tenant = await Client(w.Tenants[0]);
        Guid id; string? email;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(); var person = await db.Set<Resident>().SingleAsync(r => r.TenantUserId == w.Tenants[0]);
            person.IdentityData = "{\"syntheticEncryptedEnvelope\":\"ciphertext-untouched\"}"; person.IdentityHmac = new string('A', 64); person.HmacKeyVersion = "SYNTHETIC";
            await db.SaveChangesAsync(); id = person.Id; email = person.ContactEmail;
        }
        var route = $"/api/v1/residents/{id}/identity-retention";
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode); Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
        var context = await RefundValue<IdentityRetentionView>(await owner.GetAsync(route));
        Assert.False(context.CanDelete); Assert.Null(context.Policy.RetentionDays); Assert.Contains("contract_not_closed", context.BlockingReasons); Assert.Contains("current_residence", context.BlockingReasons); Assert.Contains("retention_policy_unapproved", context.BlockingReasons);
        var json = await owner.GetStringAsync(route); Assert.DoesNotContain("ciphertext-untouched", json); Assert.DoesNotContain("identityHmac", json); Assert.DoesNotContain("contactEmail", json);
        var input = new IdentityRetentionInput(context.Reference, "PlaceHold", null, "Synthetic dispute requires preserved evidence", true); var key = Guid.NewGuid();
        var replies = await Task.WhenAll(Post(owner, route + "/reviews", input, key), Post(owner, route + "/reviews", input, key));
        var held = await RefundValue<IdentityRetentionView>(replies[0]); Assert.Single(held.ActiveHolds); Assert.Single((await RefundValue<IdentityRetentionView>(replies[1])).History);
        Assert.Contains("identity_retention_hold_active", held.BlockingReasons);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/reviews", input with { Reason = "Different key content" }, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/reviews", input with { Action = "Review" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(owner, route + "/reviews", input with { Action = "Delete" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post(owner, route + "/reviews", new IdentityRetentionInput(held.Reference, "ReleaseHold", Guid.NewGuid(), "Synthetic wrong hold", true))).StatusCode);
        var released = await RefundValue<IdentityRetentionView>(await Post(owner, route + "/reviews", new IdentityRetentionInput(held.Reference, "ReleaseHold", held.ActiveHolds[0].Id, "Synthetic dispute reviewed, financial restrictions remain", true)));
        Assert.Empty(released.ActiveHolds); Assert.False(released.CanDelete); Assert.Contains("retention_policy_unapproved", released.BlockingReasons);
        var reviewed = await RefundValue<IdentityRetentionView>(await Post(owner, route + "/reviews", new IdentityRetentionInput(released.Reference, "Review", null, "Synthetic review records restrictions without erasing fields", true)));
        Assert.Equal(3, reviewed.History.Length); Assert.False(reviewed.CanDelete);
        await using var finalScope = fixture.Factory.Services.CreateAsyncScope(); var finalDb = finalScope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var retained = await finalDb.Set<Resident>().SingleAsync(r => r.Id == id);
        Assert.Equal("ciphertext-untouched", System.Text.Json.JsonDocument.Parse(retained.IdentityData).RootElement.GetProperty("syntheticEncryptedEnvelope").GetString());
        Assert.Equal(new string('A', 64), retained.IdentityHmac); Assert.Equal(email, retained.ContactEmail); Assert.Equal(w.Tenants[0], retained.TenantUserId);
        Assert.Equal(3, await finalDb.SecurityAudit.CountAsync(a => a.TargetId == id && a.Event.StartsWith("IdentityRetention")));
    }
}
