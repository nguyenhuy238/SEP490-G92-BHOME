using BHome.Infrastructure.IdentityAccess;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests;

public sealed class SessionPolicyTests
{
    [Theory]
    [InlineData(0, 7)]
    [InlineData(8, 7)]
    [InlineData(7, 0)]
    [InlineData(7, 8)]
    public void ConfigurationCannotExtendOrDisableTheApprovedSessionDeadline(int refreshDays, int absoluteDays)
    {
        using var factory = new ApiFactory();
        using var host = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Sessions:RefreshTokenDays"] = refreshDays.ToString(),
                ["Sessions:AbsoluteLifetimeDays"] = absoluteDays.ToString()
            })));
        Assert.Throws<OptionsValidationException>(() => host.CreateClient());
    }

    [Fact]
    public void DefaultSessionAndRefreshLifetimesAreSevenDays()
    {
        using var factory = new ApiFactory();
        var options = factory.Services.GetRequiredService<IOptions<SessionOptions>>().Value;
        Assert.Equal(7, options.RefreshTokenDays);
        Assert.Equal(7, options.AbsoluteLifetimeDays);
    }
}
