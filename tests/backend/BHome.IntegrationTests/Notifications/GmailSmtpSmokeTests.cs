using System.Net.Http.Headers;
using System.Net.Http.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.IntegrationTests.Compact24;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MailKit.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace BHome.IntegrationTests.Notifications;

public sealed class GmailSmokeFactAttribute : FactAttribute
{
    public GmailSmokeFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("BHOME_GMAIL_SMOKE") != "1" ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")))
            Skip = "Opt-in only: set BHOME_GMAIL_SMOKE=1, configure user-secrets and run with disposable Compact24 PostgreSQL.";
    }
}

// This test deliberately sends one real message. It is excluded by default from every test run.
public sealed class GmailSmtpSmokeTests(Compact24Fixture fixture, ITestOutputHelper output) : IClassFixture<Compact24Fixture>
{
    [GmailSmokeFact]
    public async Task OneDevelopmentOwnerTestMessageIsAcceptedAndOptionallyFoundInTestInbox()
    {
        var secrets = new ConfigurationBuilder().AddUserSecrets("bhome-api-development").Build();
        var settings = new Dictionary<string, string?>
        {
            ["Email:Enabled"] = "true",
            ["Email:Host"] = "smtp.gmail.com",
            ["Email:Port"] = "587",
            ["Email:Username"] = secrets["Email:Username"],
            ["Email:FromEmail"] = secrets["Email:FromEmail"],
            ["Email:AppPassword"] = secrets["Email:AppPassword"],
            ["Email:TestEnabled"] = "true",
            ["Email:TestRecipient"] = secrets["Email:TestRecipient"],
            ["Email:UseStartTls"] = "true",
            ["NotificationChannels:Mode"] = "Unconfigured",
            ["NotificationChannels:Enabled"] = "false",
            ["NotificationChannels:AutomationEnabled"] = "false",
            ["Jobs:Enabled"] = "false"
        };
        // Never send the smoke message to a Tenant or another mailbox.
        Assert.True(EmailOptions.ValidAddress(settings["Email:TestRecipient"]));
        Assert.True(settings["Email:TestRecipient"] == settings["Email:FromEmail"]);
        using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Development"); b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(settings));
        });
        await using var scope = host.Services.CreateAsyncScope();
        const string password = "Synthetic!Smoke-Owner-827";
        var owner = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
            new ApplicationUser { Id = Guid.NewGuid(), UserName = Guid.NewGuid().ToString("N"), Email = Guid.NewGuid().ToString("N") + "@example.invalid", EmailConfirmed = true }, "Owner", password);
        using var client = host.CreateClient();
        (await client.GetAsync("/health/live")).EnsureSuccessStatusCode();
        (await client.GetAsync("/health/ready")).EnsureSuccessStatusCode();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = owner.Email, password }); login.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
        var response = await client.PostAsync("/api/v1/notifications/email-test", null); response.EnsureSuccessStatusCode();
        var result = (await response.Content.ReadFromJsonAsync<EmailTestResult>())!;
        Assert.Equal("SmtpAccepted", result.Status); Assert.False(result.InboxDeliveryConfirmed);
        Assert.StartsWith("smtp-accepted:", result.ProviderReference);
        output.WriteLine("SMTP_ACCEPTED: Gmail accepted one Development test message; no business-channel worker was enabled.");
        if (Environment.GetEnvironmentVariable("BHOME_GMAIL_VERIFY_INBOX") != "1")
        { output.WriteLine("INBOX_NOT_VERIFIED: opt in with BHOME_GMAIL_VERIFY_INBOX=1 to check only this test Message-Id through read-only IMAP."); return; }

        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        using var imap = new ImapClient();
        try
        {
            await imap.ConnectAsync("imap.gmail.com", 993, SecureSocketOptions.SslOnConnect, deadline.Token);
            await imap.AuthenticateAsync(settings["Email:Username"]!, settings["Email:AppPassword"]!.Replace(" ", ""), deadline.Token);
            await imap.Inbox.OpenAsync(FolderAccess.ReadOnly, deadline.Token);
            var id = result.ProviderReference["smtp-accepted:".Length..] + "@bhome.notification";
            for (var attempt = 0; attempt < 10; attempt++)
            {
                var found = await imap.Inbox.SearchAsync(SearchQuery.HeaderContains("Message-Id", id), deadline.Token);
                if (found.Count > 0)
                {
                    output.WriteLine("INBOX_CONFIRMED: exact test Message-Id found in INBOX through read-only IMAP; no unrelated messages were fetched.");
                    return;
                }
                await Task.Delay(TimeSpan.FromSeconds(2), deadline.Token);
            }
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            // Test-runner output must never serialize provider responses or account credentials.
            output.WriteLine("INBOX_NOT_VERIFIED: " + e.GetType().Name);
            Assert.Fail("Gmail accepted SMTP, but read-only inbox verification could not be completed. See safe test output.");
        }
        finally
        {
            if (imap.IsConnected)
            {
                try { using var quit = new CancellationTokenSource(TimeSpan.FromSeconds(2)); await imap.DisconnectAsync(true, quit.Token); }
                catch (Exception e) when (e is not OutOfMemoryException) { }
            }
        }
        Assert.Fail("Gmail accepted SMTP, but the test Message-Id was not found in INBOX within the polling window.");
    }
}
