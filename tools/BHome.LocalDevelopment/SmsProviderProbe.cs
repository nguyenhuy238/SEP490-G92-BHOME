using System.Net;
using BHome.Application.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.LocalDevelopment;

internal static class SmsProviderProbe
{
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
    internal static async Task RunAsync(IServiceProvider services)
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
        var receipt = await sender.SendAsync(new(Guid.Empty, phone, "SMS-03", new Dictionary<string, string>
        { ["ROOM"] = "BHOME-TEST", ["PERIOD"] = DateTimeOffset.UtcNow.ToString("MM/yyyy") }, "provider-probe:" + Guid.NewGuid()), default);
        Console.WriteLine($"Mode={mode}; Status={receipt.Status}; PhysicalDeliveryConfirmed=false");
    }
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
