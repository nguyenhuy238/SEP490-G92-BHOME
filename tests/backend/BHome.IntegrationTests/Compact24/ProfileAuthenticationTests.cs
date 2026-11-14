using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Application.Operations;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class Compact24NotificationMvpTests
{
    [CompactPostgresFact]
    public async Task ProfileContactChangeKeepsBothSessionsRequiresProofAndReverifiesEmailWithoutReusingInvitation()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe);
        using var a = await Client(w.Tenants[0], host); using var b = await Client(w.Tenants[0], host);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var id = w.Tenants[0].Id; var before = await db.Users.AsNoTracking().SingleAsync(u => u.Id == id);
        var oldName = before.UserName;
        // A historical accepted setup must not block verification of a subsequently changed email.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users SET reset_token_hash={new string('A', 64)},reset_expires_at={DateTimeOffset.UtcNow.AddMinutes(-1)},reset_consumed_at={DateTimeOffset.UtcNow.AddHours(-1)} WHERE id={id}");
        await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new(AccountInvitationJob.JobName, "profile-historical:" + id,
            JsonSerializer.Serialize(new ApprovedTenantInvitation(w.Owner.Id, w.Residents[0], w.Contracts[0]))), default);
        var profile = (await a.GetFromJsonAsync<ProfileView>("/api/v1/account/profile"))!;
        var email = Guid.NewGuid().ToString("N") + "@example.invalid";
        var input = new ProfileUpdate("Synthetic updated Tenant", "0901234567", email, profile.Version);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PutAsJsonAsync("/api/v1/account/profile", input)).StatusCode);
        var updated = await a.PutAsJsonAsync("/api/v1/account/profile", input with { CurrentPassword = Password });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await b.GetAsync("/api/v1/auth/me")).StatusCode);
        var after = await db.Users.AsNoTracking().SingleAsync(u => u.Id == id);
        Assert.Equal(before.SecurityStamp, after.SecurityStamp); Assert.Equal(before.PasswordHash, after.PasswordHash);
        Assert.False(after.EmailConfirmed); Assert.False(after.PhoneNumberConfirmed);
        Assert.Equal(email, after.Email); Assert.Equal(email, after.UserName);
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT history::text LIKE {'%' + Password + '%'} AS \"Value\" FROM users WHERE id={id}").SingleAsync());
        using var anonymous = host.CreateClient();
        (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = email })).EnsureSuccessStatusCode();
        Assert.Empty(probe.Messages);
        (await anonymous.PostAsJsonAsync("/api/v1/auth/request-email-verification", new { userName = email })).EnsureSuccessStatusCode();
        await SendEmail(host, await AuthenticationDelivery(host, id)); var mail = Assert.Single(probe.Messages);
        Assert.Equal(email, mail.Destination);
        var values = QueryHelpers.ParseQuery(new Uri(mail.ActionUrl!).Fragment.TrimStart('#'));
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/confirm-email", new { userName = values["userName"].ToString(), token = values["token"].ToString() })).StatusCode);
        var saved = (await a.GetFromJsonAsync<ProfileView>("/api/v1/account/profile"))!;
        var nameOnly = await a.PutAsJsonAsync("/api/v1/account/profile", new ProfileUpdate("Synthetic renamed Tenant", saved.Phone, saved.Email!, saved.Version));
        Assert.Equal(HttpStatusCode.OK, nameOnly.StatusCode);
        Assert.Equal(email, (await db.Users.AsNoTracking().SingleAsync(u => u.Id == id)).UserName);
        Assert.NotEqual(oldName, email);
    }

    [CompactPostgresFact]
    public async Task ProfileRejectsWrongContactPasswordAndOverpostingWithoutChangingContactsOrEndingTheSession()
    {
        var w = await Seed(); var probe = new SmtpProbe(); using var host = AuthenticationHost(probe); using var client = await Client(w.Tenants[1], host);
        var p = (await client.GetFromJsonAsync<ProfileView>("/api/v1/account/profile"))!;
        var input = new ProfileUpdate("Synthetic profile", "0912345678", p.Email!, p.Version, "Wrong!Profile-795");
        var rejected = await client.PutAsJsonAsync("/api/v1/account/profile", input);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        var fresh = (await client.GetFromJsonAsync<ProfileView>("/api/v1/account/profile"))!;
        Assert.Equal(p.Phone, fresh.Phone); Assert.Equal(p.FullName, fresh.FullName);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        Assert.Equal(1, (await db.Users.AsNoTracking().SingleAsync(u => u.Id == p.UserId)).AccessFailedCount);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/v1/account/profile", input with { CurrentPassword = Password, Version = fresh.Version })).StatusCode);
        fresh = (await client.GetFromJsonAsync<ProfileView>("/api/v1/account/profile"))!;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/account/profile", new { fullName = "Attacker", phone = fresh.Phone, email = fresh.Email, version = fresh.Version, userId = w.Owner.Id, roles = new[] { "Owner" }, isActive = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/account/profile", new ProfileUpdate("", fresh.Phone, fresh.Email!, fresh.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/v1/account/profile", new ProfileUpdate("Synthetic", null, fresh.Email!, fresh.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Empty(probe.Messages);
    }
}
