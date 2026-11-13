using BHome.Api.Controllers.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace BHome.IntegrationTests.Compact24;

public sealed class SePayHoldingPreviewGuardTests
{
    [Theory]
    [InlineData("Development", "shared.example.invalid", "bhome_compact24_dev_ae130000000040008000000000000001", true, "Test")]
    [InlineData("Development", "127.0.0.1", "neondb", true, "Test")]
    [InlineData("Development", "127.0.0.1", "postgres", true, "Test")]
    [InlineData("Production", "127.0.0.1", "bhome_compact24_dev_ae130000000040008000000000000001", true, "Test")]
    [InlineData("Development", "127.0.0.1", "bhome_compact24_dev_ae130000000040008000000000000001", false, "Test")]
    [InlineData("Development", "127.0.0.1", "bhome_compact24_dev_ae130000000040008000000000000001", true, "Live")]
    public async Task UnavailableOutsideEnabledTestModeAndDedicatedLoopbackDatabase(string environment, string host, string database, bool enabled, string mode)
    {
        var options = new SePayOptions { Enabled = enabled, Mode = mode, WebhookSecret = "SYNTHETIC-TEST-SECRET-AT-LEAST-32-CHARACTERS",
            ReceivingAccounts = [new() { LocationId = Guid.NewGuid(), BankIdentifier = "970422", Gateway = "MBBank", AccountNumber = "0000000001" }] };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["ConnectionStrings:Database"] = $"Host={host};Database={database}" }).Build();
        // These dependencies must never be accessed before the environment/target guard.
        var controller = new SePayHoldingPreviewController(null!, null!, options, config,
            new PreviewEnvironment { EnvironmentName = environment }, TimeProvider.System, null!, null!, null!, null!);
        Assert.IsType<NotFoundResult>(await controller.Get(Guid.NewGuid(), default));
    }

    private sealed class PreviewEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "BHome.Api";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
