using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace BHome.IntegrationTests;

internal static class TestDeploymentConfiguration
{
    // Feature tests must satisfy the same startup guards as a deployed API.
    // Use reserved synthetic origins; no external provider is enabled.
    internal static IWebHostBuilder UseTestEnvironment(this IWebHostBuilder builder, string environment)
    {
        builder.UseEnvironment(environment);
        if (environment is not ("Production" or "Staging")) return builder;
        const string owner = "https://owner.example.invalid";
        const string api = "https://api.example.invalid";
        return builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Deployment:Environment"] = environment,
            ["Deployment:OwnerOrigin"] = owner,
            ["Deployment:ApiOrigin"] = api,
            ["AllowedHosts"] = "localhost;owner.example.invalid;api.example.invalid",
            ["AuthWeb:AllowedOrigins:0"] = owner,
            ["Cors:AllowedOrigins:0"] = owner,
            ["AuthenticationEmail:WebResetUrl"] = owner + "/reset-password",
            ["AuthenticationEmail:WebInvitationUrl"] = owner + "/accept-invitation",
            ["AuthenticationEmail:WebVerificationUrl"] = owner + "/confirm-email",
            ["AuthenticationEmail:MobileResetUrl"] = "bhome://reset-password",
            ["AuthenticationEmail:MobileInvitationUrl"] = "bhome://accept-invitation",
            ["AuthenticationEmail:MobileVerificationUrl"] = "bhome://confirm-email",
            ["AuthenticationEmail:TrustedOrigins:0"] = owner,
            ["AuthenticationEmail:TrustedOrigins:1"] = "bhome://reset-password",
            ["AuthenticationEmail:TrustedOrigins:2"] = "bhome://accept-invitation",
            ["AuthenticationEmail:TrustedOrigins:3"] = "bhome://confirm-email",
            ["AnonymousSigning:PublicSigningUrl"] = owner + "/contract-signing",
            ["ContractSigning:InvitationLink:PublicOpenUrl"] = api + "/open/sign-contract",
            ["SePay:Enabled"] = "false",
            ["SePay:Mode"] = environment == "Production" ? "Live" : "Test"
        }));
    }
}
