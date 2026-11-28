using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace BHome.Infrastructure.UnitTests;

public sealed class HoldingTestScopeTests
{
    [Theory]
    [InlineData("Staging", "Staging", "postgres", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", true)]
    [InlineData("Production", "Staging", "postgres", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", false)]
    [InlineData("Production", "Production", "127.0.0.1", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", false)]
    [InlineData("Staging", "Production", "postgres", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", false)]
    [InlineData("Staging", null, "postgres", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", false)]
    [InlineData("Staging", "Staging", "postgres", "bhome", false)]
    [InlineData("Staging", "Staging", "postgres.example.invalid", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", false)]
    [InlineData("Staging", "Staging", "127.0.0.1", "bhome_compact24_dev_0123456789abcdef0123456789abcdef", true)]
    public void StagingDockerScopeRequiresStagingAnchorAndIsolatedDevelopmentDatabase(
        string environment, string? anchor, string host, string database, bool expected)
    {
        var location = Guid.NewGuid();
        var options = new SePayOptions
        {
            Enabled = true,
            Mode = "Test",
            WebhookSecret = "synthetic-staging-test-secret-at-least-32-bytes",
            ReceivingAccounts = [new() { LocationId = location, BankIdentifier = "970416", AccountNumber = "0000001234", Gateway = "ACB" }]
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Deployment:Environment"] = anchor,
            ["ConnectionStrings:Database"] = $"Host={host};Database={database};Username=synthetic"
        }).Build();
        var scope = new HoldingTestScope(configuration, new Host(environment), options);
        Assert.Equal(expected, scope.Allows(location));
        Assert.False(scope.AllowsExternalDatabase);
        options.Enabled = false;
        Assert.False(scope.Allows(location));
    }

    private sealed class Host(string environment) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environment;
        public string ApplicationName { get; set; } = "Synthetic";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
