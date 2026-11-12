using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.IntegrationTests.Compact24;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MailKit.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace BHome.IntegrationTests.Notifications;

// Opt-in only. One real recovery email to the configured BHOME test mailbox, on a disposable DB.
public sealed class GmailAuthenticationSmokeTests(Compact24Fixture fixture, ITestOutputHelper output) : IClassFixture<Compact24Fixture>
{
    [GmailSmokeFact]
    public async Task RecoveryEmailReachesTestInboxAndItsLinkResetsSyntheticAccount()
    {
        var secrets = new ConfigurationBuilder().AddUserSecrets("bhome-api-development").Build();
        Assert.True(secrets["Email:TestRecipient"] == secrets["Email:FromEmail"], "Smoke must send only to the configured sender test mailbox.");
        var settings = new Dictionary<string, string?>
        {
            ["Email:Enabled"] = "true", ["Email:Username"] = secrets["Email:Username"], ["Email:FromEmail"] = secrets["Email:FromEmail"],
            ["Email:AppPassword"] = secrets["Email:AppPassword"], ["Email:TestEnabled"] = "false",
            ["NotificationChannels:Enabled"] = "true", ["NotificationChannels:AutomationEnabled"] = "false",
            ["NotificationChannels:Mode"] = "Unconfigured", ["NotificationChannels:TimeoutSeconds"] = "45", ["Jobs:Enabled"] = "false",
            ["AuthenticationEmail:WebResetUrl"] = "https://test-client.example.invalid/reset-password",
            ["AuthenticationEmail:WebInvitationUrl"] = "https://test-client.example.invalid/accept-invitation",
            ["AuthenticationEmail:MobileResetUrl"] = "bhome://reset-password",
            ["AuthenticationEmail:MobileInvitationUrl"] = "bhome://accept-invitation",
            ["AuthenticationEmail:TrustedOrigins:0"] = "https://test-client.example.invalid",
            ["AuthenticationEmail:TrustedOrigins:1"] = "bhome://reset-password",
            ["AuthenticationEmail:TrustedOrigins:2"] = "bhome://accept-invitation"
        };
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        { b.UseEnvironment("Development"); b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(settings)); });
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var user = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider, new ApplicationUser
        { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = secrets["Email:TestRecipient"], EmailConfirmed = true }, "Owner", "Synthetic!Original-725");
        using var client = host.CreateClient();
        (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = user.Email })).EnsureSuccessStatusCode();
        var delivery = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM notifications WHERE record_kind='OUTBOX' AND event_data ? 'protectedAuthenticationEmail' AND event_data->>'recipient'={user.Id.ToString()}").SingleAsync();
        await scope.ServiceProvider.GetRequiredService<NotificationChannelWorker>().DeliverAsync(delivery, default);
        var status = await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.Equal("Sent", status); output.WriteLine("SMTP_ACCEPTED: one real recovery email accepted for the configured test mailbox.");
        var history = await db.Database.SqlQuery<string>($"SELECT delivery_history::text AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        using var document = JsonDocument.Parse(history);
        var receipt = document.RootElement.EnumerateArray().Last(h => h.GetProperty("recordType").GetString() == "ChannelAttempt").GetProperty("providerReference").GetString()!;
        var messageId = receipt["smtp-accepted:".Length..] + "@bhome.notification";

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45)); using var imap = new ImapClient();
        try
        {
            await imap.ConnectAsync("imap.gmail.com", 993, SecureSocketOptions.SslOnConnect, timeout.Token);
            await imap.AuthenticateAsync(secrets["Email:Username"]!, secrets["Email:AppPassword"]!.Replace(" ", ""), timeout.Token);
            await imap.Inbox.OpenAsync(FolderAccess.ReadOnly, timeout.Token);
            for (var attempt = 0; attempt < 10; attempt++)
            {
                var ids = await imap.Inbox.SearchAsync(SearchQuery.HeaderContains("Message-Id", messageId), timeout.Token);
                if (ids.Count == 0) { await Task.Delay(TimeSpan.FromSeconds(2), timeout.Token); continue; }
                var message = await imap.Inbox.GetMessageAsync(ids[0], timeout.Token);
                var link = (message.TextBody ?? throw new InvalidOperationException("test_email_text_missing"))
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries).Last().Trim();
                Assert.True(Uri.TryCreate(link, UriKind.Absolute, out var uri) && uri.Host == "test-client.example.invalid", "Unexpected callback in controlled test message.");
                var values = QueryHelpers.ParseQuery(uri!.Fragment.TrimStart('#'));
                output.WriteLine("AUTH_RESET_INBOX_CONFIRMED: exact test message found; no unrelated mail fetched.");
                var reset = new { userName = values["userName"].ToString(), token = values["token"].ToString(), newPassword = "Synthetic!Recovered-725" };
                Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
                Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = reset.newPassword })).StatusCode);
                output.WriteLine("AUTH_RESET_LOGIN_CONFIRMED: actual email link reset the isolated synthetic account; reuse rejected and new password login succeeded.");
                return;
            }
            Assert.Fail("SMTP accepted, but controlled recovery mail was not found in INBOX in time.");
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            output.WriteLine("AUTH_SMOKE_NOT_COMPLETED: " + e.GetType().Name);
            Assert.Fail("Controlled authentication email smoke did not complete. Provider responses and link credentials are omitted.");
        }
        finally
        {
            if (imap.IsConnected)
            {
                try { using var quit = new CancellationTokenSource(TimeSpan.FromSeconds(2)); await imap.DisconnectAsync(true, quit.Token); }
                catch (Exception e) when (e is not OutOfMemoryException) { }
            }
        }
    }
}
