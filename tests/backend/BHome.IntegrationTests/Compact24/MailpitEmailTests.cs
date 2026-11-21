using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using MimeKit;

namespace BHome.IntegrationTests.Compact24;

public sealed class MailpitPostgresFactAttribute : FactAttribute
{
    public MailpitPostgresFactAttribute()
    {
        if (new[] { "BHOME_COMPACT24_TEST_ADMIN", "BHOME_MAILPIT_SMTP_PORT", "BHOME_MAILPIT_UI_PORT" }
            .Any(key => string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key))))
            Skip = "Requires disposable loopback PostgreSQL and a dedicated loopback Mailpit. Never uses application secrets or real recipients.";
    }
}

public sealed class MailpitBrowserFactAttribute : FactAttribute
{
    public MailpitBrowserFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("BHOME_RUN_EMAIL_BROWSER_E2E") != "true" ||
            new[] { "BHOME_COMPACT24_TEST_ADMIN", "BHOME_MAILPIT_SMTP_PORT", "BHOME_MAILPIT_UI_PORT" }
                .Any(key => string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key))))
            Skip = "Opt in with BHOME_RUN_EMAIL_BROWSER_E2E=true and dedicated loopback PostgreSQL/Mailpit; Node 22 and Edge are required.";
    }
}

public sealed partial class Compact24NotificationMvpTests
{
    [MailpitBrowserFact]
    public async Task MailpitReceivedInvitationOpensActualWebSetupAndRejectsReuseWithoutLeakingTokenToHistory()
    {
        var w = await Seed();
        var apiPort = LoopbackBrowserApiBridge.AvailablePort(); var webPort = LoopbackBrowserApiBridge.AvailablePort();
        var api = $"http://127.0.0.1:{apiPort}"; var web = $"http://127.0.0.1:{webPort}";
        using var host = MailpitHost().WithWebHostBuilder(builder =>
        {
            // HTTP loopback callbacks are permitted only in Development; deployment guards stay intact.
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AuthenticationEmail:WebInvitationUrl"] = web + "/accept-invitation",
                ["AuthenticationEmail:TrustedOrigins:4"] = web,
                ["Cors:AllowedOrigins:0"] = web,
                ["AuthWeb:AllowedOrigins:0"] = web,
                ["SePay:Enabled"] = "false",
                ["Sms:Enabled"] = "false",
                ["Email:TestEnabled"] = "false",
                ["DevelopmentDatabase:InitializeOnStartup"] = "false",
                ["Api:ReadDevelopmentEnvironmentFile"] = "false"
            }));
        });
        var address = $"browser-{Guid.NewGuid():N}@example.invalid";
        host.Services.GetRequiredService<IOptions<EmailOptions>>().Value.AllowedRecipients = [address];
        await using var scope = host.Services.CreateAsyncScope();
        var staff = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
            new BHome.Infrastructure.Persistence.ApplicationUser { Id = Guid.NewGuid(), UserName = address, Email = address, EmailConfirmed = false }, "Staff", "Synthetic!LegacyBrowser937");
        using var owner = await Client(w.Owner, host);
        (await owner.PostAsync($"/api/v1/staff/{staff.Id}/invitation", null)).EnsureSuccessStatusCode();
        await SendEmail(host, await AuthenticationDelivery(host, staff.Id));
        using var mail = Assert.Single(await ReceivedEmailsAsync(address));
        var link = Assert.IsType<string>(mail.TextBody).Split('\n', StringSplitOptions.RemoveEmptyEntries).Last().Trim();
        var token = QueryHelpers.ParseQuery(new Uri(link).Fragment.TrimStart('#'))["token"].ToString();
        DirectoryInfo? root = new(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "package.json"))) root = root.Parent;
        Assert.NotNull(root);
        var directory = Path.Combine(root.FullName, ".tools", "email-audit", "browser-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var configPath = Path.Combine(directory, "fixture.private.json");
        const string password = "Synthetic!BrowserSetup937";
        await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(new { api, web, email = address, password, token, html = mail.HtmlBody, output = directory }));
        await using var bridge = new LoopbackBrowserApiBridge(host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }), apiPort);
        var node = Environment.GetEnvironmentVariable("BHOME_TEST_NODE") ?? Path.Combine(root.FullName, ".tools", "node-v22.23.4-win-x64", "node.exe");
        var start = new ProcessStartInfo(node) { WorkingDirectory = root.FullName, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(root.FullName, "scripts", "Test-EmailInvitationBrowser.mjs")); start.ArgumentList.Add(configPath);
        using var child = Process.Start(start) ?? throw new InvalidOperationException("email_browser_not_started");
        var output = child.StandardOutput.ReadToEndAsync(); var errors = child.StandardError.ReadToEndAsync();
        try { using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(2)); await child.WaitForExitAsync(deadline.Token); }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); File.Delete(configPath); }
        await File.WriteAllTextAsync(Path.Combine(directory, "runner.log"), await output + "\n" + await errors);
        Assert.True(child.ExitCode == 0, "Actual email browser acceptance failed; private fixture credentials withheld.");
        Assert.True(File.Exists(Path.Combine(directory, "passed.json")));
        using var anonymous = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = address, password })).StatusCode);
    }

    private static int MailpitPort(string key) => int.Parse(Environment.GetEnvironmentVariable(key)!, System.Globalization.CultureInfo.InvariantCulture);
    private WebApplicationFactory<Program> MailpitHost() => AuthenticationHost(new SmtpProbe()).WithWebHostBuilder(builder =>
    {
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Email:DeliveryMode"] = "Capture",
            ["Email:Host"] = "127.0.0.1",
            ["Email:Port"] = MailpitPort("BHOME_MAILPIT_SMTP_PORT").ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["Email:TimeoutSeconds"] = "5",
            ["Email:FromEmail"] = "bhome@example.invalid",
            ["Email:FromName"] = "BHOME",
            ["NotificationChannels:Mode"] = "Unconfigured"
        }));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<INotificationChannelProvider>();
            services.AddScoped<INotificationChannelProvider, NotificationChannelProvider>();
        });
    });
    private static HttpClient MailpitClient() => new()
    { BaseAddress = new Uri($"http://127.0.0.1:{MailpitPort("BHOME_MAILPIT_UI_PORT")}"), Timeout = TimeSpan.FromSeconds(10) };

    private static async Task<MimeMessage[]> ReceivedEmailsAsync(string destination)
    {
        using var client = MailpitClient();
        using var list = JsonDocument.Parse(await client.GetStringAsync("/api/v1/messages"));
        var messages = new List<MimeMessage>();
        foreach (var entry in list.RootElement.GetProperty("messages").EnumerateArray())
        {
            if (!entry.GetProperty("To").EnumerateArray().Any(to => to.GetProperty("Address").GetString() == destination)) continue;
            var id = entry.GetProperty("ID").GetString();
            await using var raw = await client.GetStreamAsync($"/api/v1/message/{id}/raw");
            messages.Add(await MimeMessage.LoadAsync(raw));
        }
        return messages.ToArray();
    }

    [MailpitPostgresFact]
    public async Task MailpitReceivesOneStaffCredentialAfterSafeRetryAndCredentialLogsInChangesPasswordAndRevokesSessions()
    {
        var w = await Seed(); using var host = MailpitHost();
        var settings = host.Services.GetRequiredService<IOptions<EmailOptions>>().Value;
        settings.AllowedRecipients = [w.Staff.Email!];
        using var owner = await Client(w.Owner, host); using var oldSession = await Client(w.Staff, host);
        var path = $"/api/v1/staff/{w.Staff.Id}/issue-password";
        (await owner.PostAsync(path, null)).EnsureSuccessStatusCode();
        Assert.Equal("ExistingRequestPreserved", (await (await owner.PostAsync(path, null)).Content.ReadFromJsonAsync<TenantInvitationResult>())!.DeliveryState);
        var delivery = await AuthenticationDelivery(host, w.Staff.Id);
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var passwordHash = await db.Users.Where(u => u.Id == w.Staff.Id).Select(u => u.PasswordHash).SingleAsync();
        // A real refused loopback connection is safe to retry before SMTP DATA submission.
        using (var unusedPort = new TcpListener(IPAddress.Loopback, 0))
        {
            unusedPort.Start(); var closedPort = ((IPEndPoint)unusedPort.LocalEndpoint).Port; unusedPort.Stop();
            settings.Port = closedPort;
            await SendEmail(host, delivery);
        }
        Assert.Equal("Pending", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Empty(await ReceivedEmailsAsync(w.Staff.Email!));
        Assert.Equal(passwordHash, await db.Users.Where(u => u.Id == w.Staff.Id).Select(u => u.PasswordHash).SingleAsync());
        settings.Port = MailpitPort("BHOME_MAILPIT_SMTP_PORT");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE notifications SET next_delivery_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE id={delivery}");
        await Task.WhenAll(SendEmail(host, delivery), SendEmail(host, delivery));
        await SendEmail(host, delivery);
        using var mail = Assert.Single(await ReceivedEmailsAsync(w.Staff.Email!));
        Assert.Equal("BHOME | Thông tin tài khoản nhân viên", mail.Subject);
        Assert.Equal("bhome@example.invalid", Assert.Single(mail.From.Mailboxes).Address);
        Assert.Equal("BHOME", Assert.Single(mail.From.Mailboxes).Name);
        var password = Regex.Match(Assert.IsType<string>(mail.TextBody), @"Mật khẩu được cấp: ([^\r\n]+)").Groups[1].Value;
        Assert.Equal(12, password.Length);
        Assert.Contains(password, char.IsUpper); Assert.Contains(password, char.IsLower);
        Assert.Contains(password, char.IsDigit); Assert.Contains(password, c => !char.IsLetterOrDigit(c));
        Assert.Contains("Hồ sơ cá nhân", mail.TextBody);
        Assert.Contains("Thông tin tài khoản", mail.HtmlBody);
        Assert.DoesNotContain("reset-password", mail.HtmlBody);
        var stored = await db.Database.SqlQuery<string>($"SELECT event_data::text AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync();
        Assert.DoesNotContain(password, stored);
        Assert.Equal("Sent", await db.Database.SqlQuery<string>($"SELECT delivery_status AS \"Value\" FROM notifications WHERE id={delivery}").SingleAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldSession.GetAsync("/api/v1/auth/me")).StatusCode);
        using var staff = host.CreateClient();
        var login = await staff.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Staff.Email, password });
        login.EnsureSuccessStatusCode(); var session = await TestAuthResponse.ReadAsync(login.Content);
        staff.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
        const string changed = "Synthetic!Changed-Staff937";
        Assert.Equal(HttpStatusCode.NoContent, (await staff.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = password, newPassword = changed })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/v1/auth/me")).StatusCode);
        using var anonymous = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Staff.Email, password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = w.Staff.Email, password = changed })).StatusCode);
    }

    [MailpitPostgresFact]
    public async Task MailpitInvitationAndResetKeepExactWebAndMobileActionsAndTokensRemainOneUse()
    {
        var w = await Seed(); using var host = MailpitHost();
        var address = $"legacy-invitation-{Guid.NewGuid():N}@example.invalid";
        host.Services.GetRequiredService<IOptions<EmailOptions>>().Value.AllowedRecipients = [address];
        await using var scope = host.Services.CreateAsyncScope();
        var staff = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
            new BHome.Infrastructure.Persistence.ApplicationUser { Id = Guid.NewGuid(), UserName = address, Email = address, EmailConfirmed = false }, "Staff", "Synthetic!LegacySetup937");
        using var owner = await Client(w.Owner, host); using var anonymous = host.CreateClient();
        (await owner.PostAsync($"/api/v1/staff/{staff.Id}/invitation", null)).EnsureSuccessStatusCode();
        var invitationDelivery = await AuthenticationDelivery(host, staff.Id);
        await SendEmail(host, invitationDelivery);
        using var invitation = Assert.Single(await ReceivedEmailsAsync(address));
        var link = Assert.IsType<string>(invitation.TextBody).Split('\n', StringSplitOptions.RemoveEmptyEntries).Last().Trim();
        var uri = new Uri(link); Assert.Equal("owner.example.invalid", uri.Host); Assert.Equal("/accept-invitation", uri.AbsolutePath); Assert.Empty(uri.Query);
        var query = QueryHelpers.ParseQuery(uri.Fragment.TrimStart('#')); var token = query["token"].ToString();
        Assert.NotEmpty(token);
        Assert.Contains("href=\"" + WebUtility.HtmlEncode(link) + "\"", invitation.HtmlBody);
        Assert.Contains("bhome://accept-invitation?", invitation.TextBody);
        Assert.DoesNotContain(token, WebUtility.HtmlDecode(Regex.Replace(Assert.IsType<string>(invitation.HtmlBody), "<[^>]*>", "")));
        const string setupPassword = "Synthetic!StaffSetup937";
        var setup = new { token, newPassword = setupPassword };
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", setup)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/accept-invitation", setup)).StatusCode);
        (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { userName = address })).EnsureSuccessStatusCode();
        await SendEmail(host, await AuthenticationDelivery(host, staff.Id));
        var received = await ReceivedEmailsAsync(address); Assert.Equal(2, received.Length);
        using var reset = received.Single(message => message.Subject?.Contains("đặt lại", StringComparison.OrdinalIgnoreCase) == true);
        var resetLink = Assert.IsType<string>(reset.TextBody).Split('\n', StringSplitOptions.RemoveEmptyEntries).Last().Trim();
        var resetUri = new Uri(resetLink); Assert.Equal("owner.example.invalid", resetUri.Host); Assert.Equal("/reset-password", resetUri.AbsolutePath);
        var resetValues = QueryHelpers.ParseQuery(resetUri.Fragment.TrimStart('#'));
        var resetRequest = new { userName = address, token = resetValues["token"].ToString(), newPassword = "Synthetic!Reset937" };
        Assert.Contains("bhome://reset-password?", reset.TextBody);
        Assert.DoesNotContain(resetRequest.token, WebUtility.HtmlDecode(Regex.Replace(Assert.IsType<string>(reset.HtmlBody), "<[^>]*>", "")));
        Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", resetRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", resetRequest)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email = address, password = resetRequest.newPassword })).StatusCode);
        await SendEmail(host, invitationDelivery);
        Assert.Equal(2, (await ReceivedEmailsAsync(address)).Length);
        foreach (var message in received) message.Dispose();
    }
}
