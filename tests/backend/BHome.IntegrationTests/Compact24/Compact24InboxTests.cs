using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24InboxTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task ExistingInboxApiIsolatesRecipientsAndExcludesAuditAndOutboxBeforePagination()
    {
        const string password = "Synthetic!Password-493";
        var id = Guid.NewGuid(); var other = Guid.NewGuid(); var inboxId = Guid.NewGuid(); var systemId = Guid.NewGuid();
        var email = $"{id:N}@example.invalid";
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            foreach (var actor in new[] { id, other })
            {
                var user = new ApplicationUser
                {
                    Id = actor,
                    UserName = actor.ToString(),
                    NormalizedUserName = actor.ToString().ToUpperInvariant(),
                    Email = $"{actor:N}@example.invalid",
                    NormalizedEmail = $"{actor:N}@example.invalid".ToUpperInvariant(),
                    SecurityStamp = Guid.NewGuid().ToString(),
                    ConcurrencyStamp = Guid.NewGuid().ToString()
                };
                user.PasswordHash = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ApplicationUser>>().HashPassword(user, password);
                db.Users.Add(user); db.Entry(user).Property("roles").CurrentValue = new[] { "Tenant" };
            }
            await db.SaveChangesAsync();
            var data = JsonSerializer.Serialize(new { audienceRole = "Tenant", category = "Invoice" });
            foreach (var actor in new[] { id, other })
            {
                var notification = actor == id ? inboxId : Guid.NewGuid();
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO notifications(id,record_kind,recipient_user_id,event_key,notification_type,title,message,event_data,event_at)
                    VALUES ({notification},'INBOX',{actor},{notification.ToString()},'Invoice','Synthetic notice','Synthetic message',CAST({data} AS jsonb),{DateTimeOffset.UtcNow})
                    """);
            }
            foreach (var kind in new[] { "AUDIT", "OUTBOX" })
            {
                var key = kind + id;
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at)
                    VALUES ({(kind == "AUDIT" ? systemId : Guid.NewGuid())},{kind},{key},'Synthetic',CAST({data} AS jsonb),{DateTimeOffset.UtcNow})
                    """);
            }
        }
        using var client = fixture.Factory!.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var session = (await login.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var response = await client.GetAsync("/api/v1/notifications?page=1&pageSize=1");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var page = (await response.Content.ReadFromJsonAsync<PagedResult<NotificationView>>())!;
        Assert.Equal(1, page.TotalCount); Assert.Equal(inboxId, Assert.Single(page.Items).Id);
        await using var check = fixture.Factory.Services.CreateAsyncScope();
        var repository = check.ServiceProvider.GetRequiredService<INotificationRepository>();
        var scopeValue = new NotificationScope(id, false, false, true, new DateOnly(2026, 11, 3));
        Assert.Equal(1, await repository.UnreadAsync(scopeValue, default));
        var denied = await Assert.ThrowsAsync<NotificationException>(() => repository.ReadAsync(scopeValue, systemId, DateTimeOffset.UtcNow, default));
        Assert.Equal(404, denied.Status);
        await repository.ReadAsync(scopeValue, inboxId, DateTimeOffset.UtcNow, default);
        Assert.Equal(0, await repository.UnreadAsync(scopeValue, default));
        Assert.Null(await repository.TargetAsync(scopeValue, inboxId, default));
    }
}
