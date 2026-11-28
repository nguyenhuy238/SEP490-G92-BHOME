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
        var options = new SePayOptions
        {
            Enabled = enabled,
            Mode = mode,
            WebhookSecret = "SYNTHETIC-TEST-SECRET-AT-LEAST-32-CHARACTERS",
            ReceivingAccounts = [new() { LocationId = Guid.NewGuid(), BankIdentifier = "970422", Gateway = "MBBank", AccountNumber = "0000000001" }]
        };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["ConnectionStrings:Database"] = $"Host={host};Database={database}" }).Build();
        // These dependencies must never be accessed before the environment/target guard.
        var controller = new SePayHoldingPreviewController(null!, null!, options, config,
            new PreviewEnvironment { EnvironmentName = environment }, TimeProvider.System, null!, null!, null!, null!);
        Assert.IsType<NotFoundResult>(await controller.Get(Guid.NewGuid(), default));
    }

    [Theory]
    [InlineData("Development", true, true, true, "Test", "VerifyFull", true)]
    [InlineData("Testing", true, true, true, "Test", "VerifyFull", true)]
    [InlineData("Production", true, true, true, "Test", "VerifyFull", false)]
    [InlineData("Development", false, true, true, "Test", "VerifyFull", false)]
    [InlineData("Development", true, false, true, "Test", "VerifyFull", false)]
    [InlineData("Development", true, true, false, "Test", "VerifyFull", false)]
    [InlineData("Development", true, true, true, "Live", "VerifyFull", false)]
    [InlineData("Development", true, true, true, "Test", "Require", false)]
    public void NeonTestScopeRequiresExplicitDatabaseLocationAndVerifiedTls(string environment, bool enabled, bool hostMatches, bool locationEnabled, string mode, string ssl, bool expected)
    {
        var location = Guid.NewGuid();
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = $"Host=test.neon.tech;Database=neondb;SslMode={ssl};ChannelBinding=Require",
            ["HoldingTesting:Enabled"] = enabled.ToString(),
            ["HoldingTesting:DatabaseHost"] = hostMatches ? "test.neon.tech" : "other.neon.tech",
            ["HoldingTesting:DatabaseName"] = "neondb",
            ["HoldingTesting:LocationIds:0"] = locationEnabled ? location.ToString() : ""
        };
        var options = new SePayOptions
        {
            Enabled = true,
            Mode = mode,
            WebhookSecret = "SYNTHETIC-TEST-SECRET-AT-LEAST-32-CHARACTERS",
            ReceivingAccounts = [new() { LocationId = location, BankIdentifier = "970422", Gateway = "MBBank", AccountNumber = "0000000001" }]
        };
        var scope = new BHome.Infrastructure.Contracts.HoldingTestScope(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            new PreviewEnvironment { EnvironmentName = environment }, options);
        Assert.Equal(expected, scope.AllowsExternalDatabase); Assert.Equal(expected, scope.Allows(location)); Assert.False(scope.Allows(Guid.NewGuid()));
    }

    [Theory]
    [InlineData("Staging", true, "stage-db", "stage-test", true)]
    [InlineData("Staging", false, "stage-db", "stage-test", false)]
    [InlineData("Staging", true, "other-db", "stage-test", false)]
    [InlineData("Staging", true, "stage-db", "other-db", false)]
    [InlineData("Production", true, "stage-db", "stage-test", false)]
    public void DockerStagingScopeRequiresExplicitDatabaseAndSandboxReceivingLocation(
        string environment, bool enabled, string host, string database, bool expected)
    {
        var location = Guid.NewGuid();
        var withoutAccount = Guid.NewGuid();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = $"Host={host};Database={database}",
            ["HoldingTesting:Enabled"] = enabled.ToString(),
            ["HoldingTesting:DatabaseHost"] = "stage-db",
            ["HoldingTesting:DatabaseName"] = "stage-test",
            ["HoldingTesting:LocationIds:0"] = location.ToString(),
            ["HoldingTesting:LocationIds:1"] = withoutAccount.ToString()
        }).Build();
        var options = new SePayOptions
        {
            Enabled = true,
            WebhookSecret = "SYNTHETIC-TEST-SECRET-AT-LEAST-32-CHARACTERS",
            ReceivingAccounts = [new() { LocationId = location, BankIdentifier = "970422", Gateway = "MBBank", AccountNumber = "0000000001" }]
        };
        var scope = new BHome.Infrastructure.Contracts.HoldingTestScope(configuration,
            new PreviewEnvironment { EnvironmentName = environment }, options);

        Assert.Equal(expected, scope.Allows(location));
        Assert.False(scope.Allows(withoutAccount));
        Assert.False(scope.Allows(Guid.NewGuid()));
        Assert.False(scope.AllowsExternalDatabase);
    }

    [Theory]
    [InlineData("Staging", true, "Test", true, true)]
    [InlineData("Staging", false, "Test", true, true)]
    [InlineData("Staging", false, "Live", false, true)]
    [InlineData("Staging", true, "Live", true, true)]
    [InlineData("Staging", true, "Test", false, true)]
    [InlineData("Production", true, "Test", true, true)]
    [InlineData("Development", false, "Live", false, true)]
    public void MainSigningReviewDoesNotRequireTemplateApprovalOrSandboxScope(
        string environment, bool enabled, string paymentMode, bool inScope, bool expected)
    {
        var location = Guid.NewGuid();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MainDraft:AllowStagingSigningReview"] = enabled.ToString(),
            ["Deployment:Environment"] = environment,
            ["HoldingTesting:LocationIds:0"] = (inScope ? location : Guid.NewGuid()).ToString()
        }).Build();
        var renderer = new BHome.Infrastructure.Contracts.MainDraftRenderer(configuration, TimeProvider.System);
        var contract = new BHome.Domain.TenantContracts.Contract
        {
            PaymentMode = paymentMode,
            Room = new BHome.Domain.PropertyManagement.Room { LocationId = location }
        };

        Assert.Equal(expected, renderer.CanUseSigningReview(contract));
    }

    [Theory]
    [InlineData("Production", "Live", false, "matching", true)]
    [InlineData("Production", "Live", false, "missing", true)]
    [InlineData("Production", "Live", false, "different", true)]
    [InlineData("Production", "Test", false, "matching", false)]
    [InlineData("Production", "Live", true, "matching", false)]
    [InlineData("Staging", "Live", false, "matching", true)]
    [InlineData("Staging", "Live", false, "missing", true)]
    [InlineData("Staging", "Live", false, "different", true)]
    [InlineData("Staging", "Test", false, "matching", false)]
    [InlineData("Staging", "Live", true, "matching", false)]
    public void LiveDocumentClassificationDoesNotDependOnTemplateApproval(
        string environment, string mode, bool demo, string approval, bool expected)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();
        configuration["Deployment:Environment"] = environment;
        var renderer = new BHome.Infrastructure.Contracts.MainDraftRenderer(configuration, TimeProvider.System);
        configuration["MainDraft:ApprovedProductionTemplateSha256"] = approval switch
        {
            "matching" => renderer.TemplateHash.ToLowerInvariant(),
            "different" => new string('0', 64),
            _ => null
        };
        var contract = new BHome.Domain.TenantContracts.Contract { PaymentMode = mode, IsDevelopmentDemo = demo };

        Assert.Equal(expected, renderer.IsProductionSigningTemplate(contract));
        Assert.True(renderer.CanUseSigningReview(contract));
    }

    private sealed class PreviewEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "BHome.Api";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
