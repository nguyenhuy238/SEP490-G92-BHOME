using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Infrastructure.Viettel;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace BHome.DigitalSigning.MySign;

public static class MySignRegistration
{
    // The host supplies IViettelAccountSource from protected runtime configuration.
    public static IServiceCollection AddMySignClient(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpClient(ViettelMySignProvider.HttpClientName, c => c.Timeout = Timeout.InfiniteTimeSpan);
        services.AddSingleton<ViettelTokenCache>();
        services.AddScoped<ISigningProvider, ViettelMySignProvider>();
        return services;
    }
}
