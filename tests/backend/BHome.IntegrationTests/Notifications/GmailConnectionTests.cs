using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using BHome.Api.Configuration;
using BHome.Application.Contracts;
using BHome.Infrastructure;

namespace BHome.IntegrationTests.Notifications;

public sealed class GmailConnectionFactAttribute : FactAttribute
{
    public GmailConnectionFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("BHOME_GMAIL_CONNECTION") != "1")
            Skip = "Opt in with BHOME_GMAIL_CONNECTION=1 to check configured SMTP TLS/authentication without sending email.";
    }
}

public sealed class GmailConnectionTests
{
    [GmailConnectionFact]
    public async Task DevelopmentApiConfigurationRecognizesRealSigningEmailWithoutStartingWorkers()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "src", "backend", "BHome.sln"))) root = root.Parent;
        Assert.NotNull(root);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ApplicationName = "BHome.Api",
            EnvironmentName = "Development",
            ContentRootPath = Path.Combine(root.FullName, "src", "backend", "BHome.Api")
        });
        builder.Services.AddInfrastructure(builder.Configuration);
        builder.Services.AddApiFoundation(builder.Configuration);
        await using var app = builder.Build();
        if (app.Configuration.GetValue("Api:ReadDevelopmentEnvironmentFile", true))
            DevelopmentEnvironmentFile.Load(builder.Configuration, app.Environment.ContentRootPath);
        await using var scope = app.Services.CreateAsyncScope();
        var email = scope.ServiceProvider.GetRequiredService<IOptions<EmailOptions>>().Value;
        Assert.True(email.Enabled && email.Valid(), "API effective Email options are disabled or invalid.");
        Assert.True(scope.ServiceProvider.GetRequiredService<IAnonymousSigningSecurity>().EmailConfigured,
            "API effective signing email configuration is unavailable.");
        // Never start the app: no jobs, database initialization, invitations or email are executed.
    }

    [GmailConnectionFact]
    public async Task ConfiguredDevelopmentSmtpAuthenticatesWithoutSendingAnyMessage()
    {
        var configuration = new ConfigurationBuilder().AddUserSecrets("bhome-api-development").Build();
        var settings = configuration.GetSection("Email").Get<EmailOptions>() ?? new();
        Assert.True(settings.Enabled && settings.Valid(), "Development SMTP configuration is incomplete.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        using var client = new SmtpClient();
        try
        {
            await client.ConnectAsync(settings.Host, settings.Port, SecureSocketOptions.StartTls, timeout.Token);
            await client.AuthenticateAsync(settings.Username, settings.AppPassword.Replace(" ", ""), timeout.Token);
            Assert.True(client.IsSecure && client.IsAuthenticated);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            // Provider responses and credentials must never enter test output.
            Assert.Fail("SMTP connectivity check failed: " + MailKitEmailSender.Classify(error, false).Code);
        }
        finally
        {
            if (client.IsConnected)
            {
                try { using var quit = new CancellationTokenSource(TimeSpan.FromSeconds(2)); await client.DisconnectAsync(true, quit.Token); }
                catch (Exception error) when (error is not OutOfMemoryException) { }
            }
        }
    }
}
