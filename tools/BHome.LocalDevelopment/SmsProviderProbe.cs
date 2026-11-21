using System.Net;
using System.Security.Cryptography;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

internal static class SmsProviderProbe
{
    internal static IConfiguration LoadConfiguration()
    {
        var builder = new ConfigurationBuilder();
        var environment = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        if (environment == "Development") builder.AddUserSecrets("bhome-api-development");
        return builder.AddEnvironmentVariables().Build();
    }

    internal static IReadOnlyDictionary<string, bool> RecoveryConfigurationChecks(IConfiguration config)
    {
        var sms = config.GetSection("Sms").Get<SmsOptions>() ?? new();
        var recovery = config.GetSection("SmsRecovery").Get<SmsRecoveryOptions>() ?? new();
        return new Dictionary<string, bool>
        {
            ["Sms:Enabled"] = sms.Enabled,
            ["Sms:Mode=Production"] = sms.Mode == "Production",
            ["Sms:ApiKey"] = !string.IsNullOrWhiteSpace(sms.ApiKey),
            ["Sms:SecretKey"] = !string.IsNullOrWhiteSpace(sms.SecretKey),
            ["Sms configuration validation"] = sms.Valid(),
            ["Sms:ProductionEnabled"] = sms.ProductionEnabled,
            ["Sms:Brandname"] = !string.IsNullOrWhiteSpace(sms.Brandname),
            ["Sms:EnabledTemplates includes SMS-01"] = sms.EnabledTemplates.Contains("SMS-01"),
            ["Sms:ApprovedTemplates includes SMS-01"] = sms.ApprovedTemplates.Contains("SMS-01"),
            ["SmsRecovery:Enabled"] = recovery.Enabled,
            ["SmsRecovery key and limits validation"] = recovery.Valid(),
            ["Jobs:Enabled"] = config.GetValue<bool>("Jobs:Enabled")
        };
    }

    internal static void ConfigureSimulation(IServiceCollection services, IConfiguration config)
    {
        var target = Environment.GetEnvironmentVariable("BHOME_SMS_SIMULATION_URL");
        if (string.IsNullOrEmpty(target)) return;
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) || uri.Scheme != "http" ||
            !IPAddress.TryParse(uri.Host, out var address) || !IPAddress.IsLoopback(address) ||
            config["Sms:Mode"] != "Sandbox" || config["Sms:ApiKey"] != "synthetic-api" || config["Sms:SecretKey"] != "synthetic-secret")
            throw new LocalTestAccountException("Local HTTP simulation requires loopback and synthetic Sandbox credentials.");
        services.ConfigureHttpClientDefaults(builder => builder.AddHttpMessageHandler(() => new SimulationHandler(uri)));
    }
    internal static async Task RunAsync(IServiceProvider services, bool otp = false)
    {
        var config = services.GetRequiredService<IConfiguration>();
        var mode = config["Sms:Mode"];
        if (mode is not ("Sandbox" or "Production") || mode == "Production" &&
            (!config.GetValue<bool>("Sms:LiveTestEnabled") || Environment.GetEnvironmentVariable("BHOME_SMS_CONFIRM_LIVE") != "true"))
            throw new LocalTestAccountException("Provider probe requires Sandbox, or explicit opt-in to an approved live test.");
        var phone = VietnameseSmsPhone.Normalize(Environment.GetEnvironmentVariable("BHOME_SMS_TEST_PHONE"));
        if (phone is null) throw new LocalTestAccountException("Configure BHOME_SMS_TEST_PHONE privately.");
        await using var scope = services.CreateAsyncScope();
        var sender = scope.ServiceProvider.GetRequiredService<ISmsSender>();
        var message = CreateMessage(phone, otp);
        var receipt = await sender.SendAsync(message, default);
        Console.WriteLine($"Mode={mode}; Template={message.TemplateId}; Status={receipt.Status}; PhysicalDeliveryConfirmed=false");
    }

    internal static SmsMessage CreateMessage(string phone, bool otp) => otp
        ? new(Guid.Empty, phone, "SMS-01", new Dictionary<string, string>
        {
            ["OTP"] = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture),
            ["MINUTES"] = "5"
        }, "provider-probe:" + Guid.NewGuid())
        : new(Guid.Empty, phone, "SMS-03", new Dictionary<string, string>
        { ["ROOM"] = "BHOME-TEST", ["PERIOD"] = DateTimeOffset.UtcNow.ToString("MM/yyyy") }, "provider-probe:" + Guid.NewGuid());

    private sealed class SimulationHandler(Uri target) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host != "rest.esms.vn") throw new InvalidOperationException("Unexpected simulation origin.");
            request.RequestUri = new Uri(target, request.RequestUri.AbsolutePath.TrimStart('/'));
            return base.SendAsync(request, cancellationToken);
        }
    }
}
